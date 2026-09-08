import type { DemandHistory, DemandHistoryQuery, DemandIdea, DemandIdeaResult, DemandRequest, DemandWorkspace } from "@edison/contracts";

export type HistoryScope = Pick<DemandHistoryQuery, "scope" | "loopId">;
export const demandHistoryScopeKey = (query: HistoryScope) => `${query.scope}:${query.loopId ?? "all"}`;
type PageTicket = { workspaceId: string; sequence: number; epoch: number };
type ExactTicket = { workspaceId: string; ideaId: string; sequence: number };
export type DemandHistoryWindow = {
  query: HistoryScope; cursor: string | null; page: DemandHistory | null; loading: boolean; error: string;
};
export type DemandHistorySnapshot = {
  workspaceId: string | null; window: DemandHistoryWindow | null; exact: DemandIdeaResult[];
};

function newestRequest(old: DemandRequest | undefined, next: DemandRequest) {
  if (!old) return next;
  if (old.updatedAt !== next.updatedAt) return old.updatedAt > next.updatedAt ? old : next;
  const rank = { queued: 0, running: 1, failed: 2, succeeded: 3 };
  return rank[old.status] > rank[next.status] ? old : next;
}

/** One 60-card page plus at most 24 exact metadata records; never article bodies. */
export class DemandReaderHistory {
  private state: DemandHistorySnapshot = { workspaceId: null, window: null, exact: [] };
  private sequence = 0;
  private epoch = 0;
  private pageSequence = 0;
  private exactSequences = new Map<string, number>();
  private pendingMutations = new Set<string>();
  snapshot() { return this.state; }
  reset(workspaceId: string) {
    if (this.state.workspaceId === workspaceId) return;
    this.epoch++;
    this.pageSequence = ++this.sequence;
    this.exactSequences.clear();
    this.pendingMutations.clear();
    this.state = { workspaceId, window: null, exact: [] };
  }
  close() {
    this.pageSequence = ++this.sequence;
    this.state = { ...this.state, window: null };
  }
  beginPage(query: HistoryScope, cursor: string | null, refresh = false): PageTicket {
    if (!this.state.workspaceId) throw new Error("Reading workspace is unavailable.");
    const workspaceId = this.state.workspaceId;
    this.pageSequence = ++this.sequence;
    const same = this.state.window && demandHistoryScopeKey(this.state.window.query) === demandHistoryScopeKey(query) && this.state.window.cursor === cursor;
    this.state = { ...this.state, window: { query, cursor, page: same ? this.state.window!.page : null, loading: !refresh, error: "" } };
    return { workspaceId, sequence: this.pageSequence, epoch: this.epoch };
  }
  private pageIsCurrent(ticket: PageTicket) {
    return ticket.workspaceId === this.state.workspaceId && ticket.sequence === this.pageSequence && ticket.epoch === this.epoch && !this.pendingMutations.size;
  }
  acceptPage(ticket: PageTicket, page: DemandHistory) {
    if (!this.pageIsCurrent(ticket) || !this.state.window) return false;
    if (page.workspaceId !== ticket.workspaceId) throw new Error("Your reading session changed. Reload to open the current workspace.");
    const query = this.state.window.query;
    if (page.ideas.some((idea) => (query.scope === "saved" && !idea.saved) || (query.loopId && idea.loopId !== query.loopId))) throw new Error("Reading history did not match this view.");
    const knownIdeas = new Map((this.state.window.page?.ideas ?? []).map((idea) => [idea.id, idea]));
    const knownRequests = new Map((this.state.window.page?.requests ?? []).map((request) => [request.id, request]));
    for (const entry of this.state.exact) {
      knownIdeas.set(entry.idea.id, entry.idea);
      if (entry.request) knownRequests.set(entry.request.id, newestRequest(knownRequests.get(entry.request.id), entry.request));
    }
    for (const request of page.requests) knownRequests.set(request.id, newestRequest(knownRequests.get(request.id), request));
    const ideas = page.ideas.map((idea) => ({ ...idea, articleRequestId: idea.articleRequestId ?? knownIdeas.get(idea.id)?.articleRequestId ?? null }));
    const requests = ideas.flatMap((idea) => idea.articleRequestId && knownRequests.has(idea.articleRequestId) ? [knownRequests.get(idea.articleRequestId)!] : []);
    page = { ...page, ideas, requests };
    const ids = new Set(page.ideas.map(({ id }) => id));
    // A later-started page already supplied these entities. Retire earlier
    // exact-read tickets, including their unversioned saved bits; do not assign
    // fictitious timestamps to saved state or allow that older response back in.
    for (const ideaId of ids) {
      if ((this.exactSequences.get(ideaId) ?? 0) < ticket.sequence) this.exactSequences.set(ideaId, ticket.sequence);
    }
    while (this.exactSequences.size > 100) this.exactSequences.delete(this.exactSequences.keys().next().value!);
    this.state = { ...this.state, window: { ...this.state.window, page, loading: false, error: "" },
      exact: this.state.exact.filter(({ idea }) => !ids.has(idea.id)) };
    return true;
  }
  failPage(ticket: PageTicket, message: string) {
    if (!this.pageIsCurrent(ticket) || !this.state.window) return false;
    this.state = { ...this.state, window: { ...this.state.window, loading: false, error: message } };
    return true;
  }
  invalidateMutation(ideaId?: string) {
    this.epoch++;
    if (ideaId) { this.exactSequences.set(ideaId, ++this.sequence); this.pendingMutations.add(ideaId); }
    if (this.state.window?.loading) this.state = { ...this.state, window: { ...this.state.window, loading: false, error: "Reading changed. Refresh this page to continue." } };
  }
  finishMutation(ideaId: string) {
    if (this.pendingMutations.delete(ideaId)) {
      this.epoch++;
      if (this.state.window?.loading) this.state = { ...this.state, window: { ...this.state.window, loading: false, error: "Reading changed. Refresh this page to continue." } };
    }
  }
  beginExact(ideaId: string, mutation = false): ExactTicket | null {
    if (!this.state.workspaceId) throw new Error("Reading workspace is unavailable.");
    if (this.pendingMutations.has(ideaId) && !mutation) return null;
    const sequence = ++this.sequence;
    this.exactSequences.set(ideaId, sequence);
    // Only the bounded metadata cache and active request tickets are retained.
    if (this.exactSequences.size > 100) this.exactSequences.delete(this.exactSequences.keys().next().value!);
    return { workspaceId: this.state.workspaceId, ideaId, sequence };
  }
  exactIsCurrent(ticket: ExactTicket) {
    return ticket.workspaceId === this.state.workspaceId && this.exactSequences.get(ticket.ideaId) === ticket.sequence;
  }
  acceptExact(ticket: ExactTicket, result: DemandIdeaResult) {
    if (!this.exactIsCurrent(ticket)) return false;
    if (result.workspaceId !== ticket.workspaceId || result.idea.id !== ticket.ideaId) throw new Error("Your reading session changed. Reload to open the current workspace.");
    this.epoch++;
    const window = this.state.window;
    const page = window?.page;
    const previous = this.state.exact.find(({ idea }) => idea.id === result.idea.id);
    const knownIdea = previous?.idea ?? page?.ideas.find(({ id }) => id === result.idea.id);
    const articleRequestId = result.idea.articleRequestId ?? knownIdea?.articleRequestId ?? null;
    const knownRequest = previous?.request ?? page?.requests.find(({ id }) => id === articleRequestId);
    result = { ...result, idea: { ...result.idea, articleRequestId }, request: result.request
      ? newestRequest(knownRequest?.id === result.request.id ? knownRequest : undefined, result.request)
      : knownRequest?.id === articleRequestId ? knownRequest : null };
    let nextWindow = window?.loading ? { ...window, loading: false, error: "Reading changed. Refresh this page to continue." } : window;
    if (page?.ideas.some(({ id }) => id === result.idea.id)) {
      const ideas = page.ideas.map((idea) => idea.id === result.idea.id ? result.idea : idea)
        .filter((idea) => window!.query.scope !== "saved" || idea.saved);
      const requests = page.requests.filter((request) => request.ideaId !== result.idea.id);
      if (result.request && ideas.some(({ id }) => id === result.idea.id)) requests.push(result.request);
      nextWindow = { ...nextWindow!, page: { ...page, ideas, requests } };
    }
    this.state = { ...this.state, window: nextWindow,
      exact: [result, ...this.state.exact.filter(({ idea }) => idea.id !== result.idea.id)].slice(0, 24) };
    return true;
  }
  seed(result: DemandIdeaResult, mutation = false) {
    if (result.workspaceId !== this.state.workspaceId) return;
    const ticket = this.beginExact(result.idea.id, mutation);
    if (ticket) this.acceptExact(ticket, result);
  }
  /** Sync authoritative recent state without placing older rows inside its cap. */
  syncWorkspace(workspace: DemandWorkspace) {
    this.reset(workspace.workspaceId);
    const ideas = new Map(workspace.ideas.map((idea) => [idea.id, idea]));
    const requests = new Map(workspace.requests.map((request) => [request.id, request]));
    const window = this.state.window;
    const page = window?.page;
    this.state = { ...this.state,
      exact: this.state.exact.map((entry) => ({ ...entry,
        idea: { ...entry.idea, articleRequestId: ideas.get(entry.idea.id)?.articleRequestId ?? entry.idea.articleRequestId },
        request: entry.idea.articleRequestId && requests.has(entry.idea.articleRequestId)
          ? newestRequest(entry.request ?? undefined, requests.get(entry.idea.articleRequestId)!) : entry.request })),
      window: page ? { ...window!, page: { ...page,
        ideas: page.ideas.map((idea) => ({ ...idea, articleRequestId: ideas.get(idea.id)?.articleRequestId ?? idea.articleRequestId })),
        requests: page.requests.map((request) => requests.has(request.id) ? newestRequest(request, requests.get(request.id)!) : request),
      } } : window,
    };
  }
}

export function demandHistoryRecords(workspace: DemandWorkspace | null, state: DemandHistorySnapshot) {
  const ideas = new Map<string, DemandIdea>((workspace?.ideas ?? []).map((idea) => [idea.id, idea]));
  const requests = new Map<string, DemandRequest>((workspace?.requests ?? []).map((request) => [request.id, request]));
  if (workspace?.workspaceId === state.workspaceId) {
    for (const idea of state.window?.page?.ideas ?? []) ideas.set(idea.id, idea);
    for (const request of state.window?.page?.requests ?? []) requests.set(request.id, newestRequest(requests.get(request.id), request));
    for (const entry of state.exact) {
      ideas.set(entry.idea.id, entry.idea);
      if (entry.request) requests.set(entry.request.id, newestRequest(requests.get(entry.request.id), entry.request));
    }
  }
  return { ideas: [...ideas.values()], requests: [...requests.values()] };
}
