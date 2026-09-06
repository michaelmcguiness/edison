import { z } from "zod";
import { demandHistoryCursorSchema, uuidSchema, type DemandIdea, type DemandIdeaResult, type DemandRequest, type DemandWorkspace } from "@edison/contracts";

function mergeById<T extends { id: string }>(current: T[], incoming: T[], choose: (old: T, next: T) => T) {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) records.set(record.id, records.has(record.id) ? choose(records.get(record.id)!, record) : record);
  return [...records.values()];
}

const requestRank: Record<DemandRequest["status"], number> = { queued: 0, running: 1, failed: 2, succeeded: 3 };

/** Workspace snapshots are bounded server views, not deletion instructions. */
export function mergeDemandWorkspaces(current: DemandWorkspace | null, incoming: DemandWorkspace, preferIncoming = true): DemandWorkspace {
  if (!current || current.workspaceId !== incoming.workspaceId) return incoming;
  const requests = mergeById(current.requests, incoming.requests, (old, next) => {
    const time = next.updatedAt.localeCompare(old.updatedAt);
    if (time) return time > 0 ? next : old;
    if (next.status !== old.status) return requestRank[next.status] > requestRank[old.status] ? next : old;
    return preferIncoming ? next : old;
  }).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 120);
  const loops = mergeById(current.loops, incoming.loops, (old, next) => {
    if (next.revision !== old.revision) return next.revision > old.revision ? next : old;
    const time = next.updatedAt.localeCompare(old.updatedAt);
    return time ? time > 0 ? next : old : preferIncoming ? next : old;
  }).slice(0, 30);
  const ideas = mergeById(current.ideas, incoming.ideas, (old, next) => ({
    ...(preferIncoming ? next : old),
    // Commissioning is irreversible for an idea: an older snapshot must not
    // turn its existing request into another "unwritten" commission.
    articleRequestId: next.articleRequestId ?? old.articleRequestId,
  })).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || a.rank - b.rank).slice(0, 360);
  return { workspaceId: incoming.workspaceId, readerKind: incoming.readerKind, loops, ideas, requests };
}

export class DemandWorkspaceResponses {
  private epoch = 0;
  private sequence = 0;
  private lastPoll = 0;
  private pending = new Map<number, { workspaceId: string | null; savedIdeaId?: string }>();
  private savedVersions = new Map<string, number>();
  constructor(private workspace: DemandWorkspace | null) {}
  hydrate(next: DemandWorkspace) {
    if (this.workspace && this.workspace.workspaceId !== next.workspaceId) return this.replaceWorkspace(next);
    this.workspace = mergeDemandWorkspaces(this.workspace, next, false);
    return this.workspace;
  }
  beginPoll() { return { epoch: this.epoch, sequence: ++this.sequence }; }
  private replaceWorkspace(next: DemandWorkspace) {
    this.workspace = next;
    this.epoch++;
    this.pending.clear();
    this.savedVersions.clear();
    return next;
  }
  acceptPoll(ticket: { epoch: number; sequence: number }, next: DemandWorkspace) {
    if (this.pending.size || ticket.epoch !== this.epoch || ticket.sequence <= this.lastPoll) return null;
    this.lastPoll = ticket.sequence;
    if (this.workspace && this.workspace.workspaceId !== next.workspaceId) return this.replaceWorkspace(next);
    this.workspace = mergeDemandWorkspaces(this.workspace, next);
    return this.workspace;
  }
  isCurrentPoll(ticket: { epoch: number; sequence: number }) {
    return !this.pending.size && ticket.epoch === this.epoch && ticket.sequence > this.lastPoll;
  }
  beginMutation(scope: { savedIdeaId?: string } = {}) {
    this.epoch++;
    const ticket = ++this.sequence;
    this.pending.set(ticket, { workspaceId: this.workspace?.workspaceId ?? null, ...scope });
    return ticket;
  }
  acceptMutation(ticket: number, next: DemandWorkspace) {
    const scope = this.pending.get(ticket);
    if (!scope || scope.workspaceId !== (this.workspace?.workspaceId ?? null)) return null;
    if (this.workspace && this.workspace.workspaceId !== next.workspaceId) return this.replaceWorkspace(next);
    const previous = this.workspace;
    this.workspace = mergeDemandWorkspaces(previous, next, false);
    // Only a save mutation owns the mutable saved bit. Other mutation snapshots
    // may predate an independent save, even when they arrive later.
    if (scope.savedIdeaId && ticket > (this.savedVersions.get(scope.savedIdeaId) ?? -1)) {
      const saved = next.ideas.find(({ id }) => id === scope.savedIdeaId);
      if (saved) {
        this.workspace = { ...this.workspace, ideas: this.workspace.ideas.map((idea) => idea.id === saved.id ? { ...idea, saved: saved.saved } : idea) };
        this.savedVersions.set(saved.id, ticket);
      }
    }
    this.finishMutation(ticket);
    return this.workspace;
  }
  finishMutation(ticket: number) {
    if (this.pending.delete(ticket)) this.epoch++;
  }
  recoverRequest(request: DemandRequest) {
    if (!this.workspace) return null;
    const existing = this.workspace.requests.find(({ id }) => id === request.id);
    const recovered = existing && existing.updatedAt > request.updatedAt ? existing : request;
    this.workspace = { ...this.workspace, requests: [recovered, ...this.workspace.requests.filter(({ id }) => id !== request.id)].slice(0, 120) };
    return this.workspace;
  }
}

/** A delayed response may update shared records but cannot navigate a new scope. */
export async function runScopedDemandRequest<T>(input: {
  run: () => Promise<T>;
  isCurrent: () => boolean;
  onSharedResult: (result: T) => void;
  onCurrentResult: (result: T) => void;
  onCurrentError: (error: unknown) => void;
}) {
  try {
    const result = await input.run();
    input.onSharedResult(result);
    if (input.isCurrent()) input.onCurrentResult(result);
  } catch (error) {
    if (input.isCurrent()) input.onCurrentError(error);
  }
}

const position = z.number().finite().min(0).max(10_000_000);
export const DEMAND_READING_POSITION_LIMIT = 120;
const readingPositionsSchema = z.object({
  version: z.literal(1),
  workspaceId: uuidSchema,
  entries: z.array(z.object({ ideaId: uuidSchema, articleRequestId: uuidSchema, scrollY: position }).strict())
    .max(DEMAND_READING_POSITION_LIMIT),
}).strict().refine(({ entries }) => new Set(entries.map(({ ideaId }) => ideaId)).size === entries.length);
export type DemandReadingPositions = z.infer<typeof readingPositionsSchema>;

export function restoreDemandReadingPositions(raw: string | null, workspaceId: string): DemandReadingPositions {
  const empty: DemandReadingPositions = { version: 1, workspaceId, entries: [] };
  if (!raw || raw.length > 32_768) return empty;
  try {
    const parsed = readingPositionsSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.workspaceId === workspaceId ? parsed.data : empty;
  } catch { return empty; }
}

export function demandReadingPositionForIdea(state: DemandReadingPositions | null, workspaceId: string, idea: DemandIdea) {
  if (state?.workspaceId !== workspaceId || !idea.articleRequestId) return 0;
  // Stored IDs never establish ownership or content identity. Only restore after
  // matching the idea and immutable request returned by this reader's API.
  return state.entries.find((entry) => entry.ideaId === idea.id && entry.articleRequestId === idea.articleRequestId)?.scrollY ?? 0;
}

export function rememberDemandReadingPosition(state: DemandReadingPositions | null, workspaceId: string, idea: DemandIdea, scrollY: number): DemandReadingPositions {
  const current = state?.workspaceId === workspaceId ? state : restoreDemandReadingPositions(null, workspaceId);
  if (!idea.articleRequestId || !position.safeParse(scrollY).success) return current;
  return { ...current, entries: [{ ideaId: idea.id, articleRequestId: idea.articleRequestId, scrollY },
    ...current.entries.filter(({ ideaId }) => ideaId !== idea.id)].slice(0, DEMAND_READING_POSITION_LIMIT) };
}

export const demandContinuitySchema = z.object({
  version: z.literal(1),
  workspaceId: uuidSchema,
  view: z.enum(["home", "loop", "library", "profile", "request", "article"]),
  activeLoopId: z.union([uuidSchema, z.literal("for-you")]),
  selectedIdeaId: uuidSchema.nullable(),
  origin: z.object({
    view: z.enum(["home", "loop", "library"]), loopId: uuidSchema.nullable(),
    scrollY: position, ideaId: uuidSchema,
    history: z.object({ scope: z.enum(["all", "saved"]), loopId: uuidSchema.optional(), cursor: demandHistoryCursorSchema.nullable() }).strict().optional(),
  }).strict().nullable(),
  articleScrollY: position,
  history: z.object({ scope: z.enum(["all", "saved"]), loopId: uuidSchema.optional(), cursor: demandHistoryCursorSchema.nullable() }).strict().optional(),
}).strict();
export type DemandContinuity = z.infer<typeof demandContinuitySchema>;

export function restoredDemandArticlePosition(state: DemandContinuity) {
  return state.view === "article" || state.view === "request" ? state.articleScrollY : null;
}

export function restoreDemandContinuity(raw: string | null, workspace: DemandWorkspace): DemandContinuity | null {
  if (!raw || raw.length > 4096) return null;
  let parsed: ReturnType<typeof demandContinuitySchema.safeParse>;
  try { parsed = demandContinuitySchema.safeParse(JSON.parse(raw)); } catch { return null; }
  if (!parsed.success) return null;
  const state = parsed.data;
  if (state.workspaceId !== workspace.workspaceId) return null;
  const loopIds = new Set(workspace.loops.map(({ id }) => id));
  if (state.activeLoopId !== "for-you" && !loopIds.has(state.activeLoopId)) return null;
  if (state.view === "loop" && state.activeLoopId === "for-you") return null;
  if (state.history && (!(["home", "loop", "library"] as string[]).includes(state.view) ||
    state.history.scope !== (state.view === "library" ? "saved" : "all") ||
    (state.history.loopId ?? null) !== (state.view === "loop" ? state.activeLoopId : null))) return null;
  if (state.origin) {
    const originIdea = workspace.ideas.find(({ id }) => id === state.origin!.ideaId);
    if (!originIdea || (state.origin.view === "loop" ? state.origin.loopId !== originIdea.loopId : state.origin.loopId !== null)) return null;
    const history = state.origin.history;
    if (history && (history.scope !== (state.origin.view === "library" ? "saved" : "all") ||
      (history.loopId ?? null) !== (state.origin.view === "loop" ? state.origin.loopId : null))) return null;
  }
  if (state.view === "article" || state.view === "request") {
    const idea = workspace.ideas.find(({ id }) => id === state.selectedIdeaId);
    if (!idea?.articleRequestId || idea.loopId !== state.activeLoopId) return null;
    const request = workspace.requests.find(({ id }) => id === idea.articleRequestId);
    if (request && (request.kind !== "article" || request.ideaId !== idea.id || request.loopId !== idea.loopId)) return null;
    // The bounded workspace may omit an old request. The caller fetches this
    // exact retained articleRequestId; restoration never commissions a body.
  } else if (state.selectedIdeaId !== null) return null;
  return state;
}

/** At most two exact metadata reads; no article commission or body fetch. */
export async function recoverDemandContinuity(raw: string | null, workspace: DemandWorkspace,
  getIdea: (id: string) => Promise<DemandIdeaResult>) {
  let candidate: DemandContinuity;
  try {
    if (!raw || raw.length > 4096) return { saved: null, recovered: [] };
    const parsed = demandContinuitySchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.workspaceId !== workspace.workspaceId) return { saved: null, recovered: [] };
    candidate = parsed.data;
  } catch { return { saved: null, recovered: [] }; }
  if (!workspace.loops.some(({ id }) => id === candidate.activeLoopId) && candidate.activeLoopId !== "for-you") return { saved: null, recovered: [] };
  const ids = new Set([candidate.selectedIdeaId, candidate.origin?.ideaId].filter((id): id is string => Boolean(id)));
  const recovered = await Promise.all([...ids].filter((id) => !workspace.ideas.some((idea) => idea.id === id)).map(async (id) => {
    const result = await getIdea(id);
    if (result.workspaceId !== workspace.workspaceId || result.idea.id !== id) throw new Error("Your reading session changed. Reload to open the current workspace.");
    return result;
  }));
  // A transient validation view, never inserted into the capped workspace.
  const saved = restoreDemandContinuity(raw, { ...workspace, ideas: [...workspace.ideas, ...recovered.map(({ idea }) => idea)],
    requests: [...workspace.requests, ...recovered.flatMap(({ request }) => request ? [request] : [])] });
  return { saved, recovered };
}

export type SubmittedDemandFeedback = { operation: "apply" | "undo"; text: string; requestId: string | null };
export function clearsSubmittedDemandFeedback(submission: SubmittedDemandFeedback | null, requestId: string, currentDraft: string) {
  return submission?.operation === "apply" && submission.requestId === requestId && submission.text === currentDraft;
}
