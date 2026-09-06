import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import {
  demandEvents, demandIdeas, demandLoops, demandMutations, demandPrincipals, demandRequests,
  withDemandDb, withDemandWorkerDb, type DemandTransaction,
} from "@edison/db";
import {
  articleSchema, demandIdeaSchema, demandLoopSchema, demandRequestSchema, demandResultSchema,
  demandWorkspaceSchema, type DemandWorkspace,
} from "@edison/contracts";
import {
  assembleLoopPrincipleContext, createEmptyLoopPrincipleState, reduceLoopPrinciples,
  type LoopPrincipleState,
} from "@edison/domain";
import { onDemandWriterOutputSchema, onDemandEvidenceSchema, type OnDemandContext } from "@edison/ai";
import { HttpError } from "../http/errors";
import { assertDemandPrincipalActive, type DemandPrincipal } from "../auth/verify-demand-principal";
import { demandFailure, demandLimits, demandReservationMicrousd } from "./demand-configuration";

export type DemandLoopRow = typeof demandLoops.$inferSelect;
export type DemandRequestRow = typeof demandRequests.$inferSelect;
export type DemandIdeaRow = typeof demandIdeas.$inferSelect;

export const demandRequestSummarySelection = {
  id: demandRequests.id, loopId: demandRequests.loopId, ideaId: demandRequests.ideaId,
  kind: demandRequests.kind, status: demandRequests.status, stage: demandRequests.stage,
  failureCode: demandRequests.failureCode, createdAt: demandRequests.createdAt, updatedAt: demandRequests.updatedAt,
};
export const demandIdeaSummarySelection = {
  id: demandIdeas.id, loopId: demandIdeas.loopId, batchRequestId: demandIdeas.batchRequestId,
  batchRevision: demandIdeas.batchRevision, rank: demandIdeas.rank, title: demandIdeas.title,
  deck: demandIdeas.deck, articleRequestId: demandIdeas.articleRequestId, saved: demandIdeas.saved, createdAt: demandIdeas.createdAt,
};

export function demandFingerprint(value: unknown) {
  const stable = (input: unknown): unknown => Array.isArray(input) ? input.map(stable)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : input;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function demandPrincipleState(loop: DemandLoopRow): LoopPrincipleState {
  const state = loop.principles as unknown as LoopPrincipleState;
  const assembled = assembleLoopPrincipleContext(state);
  if (!assembled.ok || state.loopId !== loop.id || state.revision !== loop.revision || state.originalCuriosity !== loop.originalCuriosity) {
    throw new Error("demand_loop_state_invalid");
  }
  return state;
}

export function demandLoopDto(loop: DemandLoopRow) {
  const state = demandPrincipleState(loop);
  return demandLoopSchema.parse({
    id: loop.id, title: loop.title, originalCuriosity: loop.originalCuriosity, revision: loop.revision,
    principles: state.principles.filter((item) => item.status === "active").map((item) => ({
      id: item.id, kind: item.kind, instruction: item.instruction, source: "reader",
    })),
    lastMutationId: state.lastMutation?.mutationId ?? null, canUndo: Boolean(state.lastMutation),
    createdAt: loop.createdAt.toISOString(), updatedAt: loop.updatedAt.toISOString(),
  });
}

export function demandRequestDto(request: Pick<DemandRequestRow,
  "id" | "loopId" | "ideaId" | "kind" | "status" | "stage" | "failureCode" | "createdAt" | "updatedAt"
>) {
  return demandRequestSchema.parse({
    id: request.id, loopId: request.loopId, ideaId: request.ideaId, kind: request.kind,
    status: request.status, stage: request.stage,
    failure: request.status === "failed" ? demandFailure(request.failureCode) : null,
    createdAt: request.createdAt.toISOString(), updatedAt: request.updatedAt.toISOString(),
  });
}

export function demandIdeaDto(idea: Pick<DemandIdeaRow,
  "id" | "loopId" | "batchRequestId" | "batchRevision" | "rank" | "title" | "deck" | "articleRequestId" | "saved" | "createdAt"
>) {
  return demandIdeaSchema.parse({
    id: idea.id, loopId: idea.loopId, batchRequestId: idea.batchRequestId, batchRevision: idea.batchRevision,
    rank: idea.rank, title: idea.title, deck: idea.deck,
    articleRequestId: idea.articleRequestId, saved: idea.saved, createdAt: idea.createdAt.toISOString(),
  });
}

export function rejectDistinctPendingIdeasRequest(
  pending: Pick<DemandRequestRow, "snapshot"> | undefined,
  revision: number,
) {
  if ((pending?.snapshot.context as OnDemandContext | undefined)?.revision === revision) {
    throw new HttpError(
      409,
      "reading_busy",
      "Ideas are already being prepared for this loop. Keep this request open while they finish.",
    );
  }
}

export async function demandWorkspace(principal: DemandPrincipal): Promise<DemandWorkspace> {
  return withDemandDb(principal.id, async (tx) => {
    const loops = await tx.select().from(demandLoops).where(eq(demandLoops.principalId, principal.id)).orderBy(demandLoops.createdAt).limit(30);
    const ideas = await tx.select(demandIdeaSummarySelection).from(demandIdeas).where(eq(demandIdeas.principalId, principal.id)).orderBy(desc(demandIdeas.createdAt), asc(demandIdeas.rank)).limit(360);
    const requests = await tx.select(demandRequestSummarySelection).from(demandRequests).where(eq(demandRequests.principalId, principal.id)).orderBy(desc(demandRequests.createdAt)).limit(120);
    return demandWorkspaceSchema.parse({ workspaceId: principal.id, readerKind: principal.accountUserId ? "account" : "guest",
      loops: loops.map(demandLoopDto), ideas: ideas.map(demandIdeaDto), requests: requests.map(demandRequestDto) });
  });
}

export async function demandRequestResult(principal: DemandPrincipal, id: string) {
  return withDemandDb(principal.id, async (tx) => {
    const [request] = await tx.select().from(demandRequests).where(and(eq(demandRequests.id, id), eq(demandRequests.principalId, principal.id))).limit(1);
    if (!request) throw new HttpError(404, "request_not_found", "That reading request was not found.");
    return demandResultSchema.parse({ request: demandRequestDto(request),
      article: request.status === "succeeded" && request.kind === "article" ? request.result?.article ?? null : null,
      answer: request.status === "succeeded" && request.kind === "question" ? request.result?.answer ?? null : null,
    });
  });
}

async function lockAdmission(tx: DemandTransaction, principalId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission', 0))`);
  const [principal] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id, principalId)).for("update").limit(1);
  if (!principal) throw new HttpError(401, "reading_session_required", "That reading session is unavailable.");
  assertDemandPrincipalActive(principal);
  const active = await tx.execute(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
  if (active[0]?.active !== true) throw new HttpError(401, "reading_session_required", "That reading session is unavailable.");
}

async function loopForUpdate(tx: DemandTransaction, principalId: string, loopId: string) {
  const [loop] = await tx.select().from(demandLoops).where(and(eq(demandLoops.id, loopId), eq(demandLoops.principalId, principalId))).for("update").limit(1);
  if (!loop) throw new HttpError(404, "loop_not_found", "That learning loop was not found.");
  return loop;
}

async function replayRequest(tx: DemandTransaction, principalId: string, key: string, fingerprint: string) {
  const [existing] = await tx.select().from(demandRequests).where(and(eq(demandRequests.principalId, principalId), eq(demandRequests.idempotencyKey, key))).limit(1);
  if (existing && existing.requestFingerprint !== fingerprint) {
    throw new HttpError(409, "idempotency_key_reused", "That request identity was already used for different input.");
  }
  return existing ?? null;
}

export function demandBaselinePreferences(value?: { article_length: string; depth: number }): OnDemandContext["preferences"] {
  if (!value) return { length: "standard", depth: 50 };
  if (!["brief", "standard", "deep"].includes(value.article_length) ||
      !Number.isInteger(value.depth) || value.depth < 0 || value.depth > 100) {
    throw new HttpError(503, "reading_preferences_unavailable", "Your reading preferences could not be loaded safely.");
  }
  return { length: value.article_length as OnDemandContext["preferences"]["length"], depth: value.depth };
}

export async function assembleDemandContext(tx: DemandTransaction, loop: DemandLoopRow): Promise<OnDemandContext> {
  const state = demandPrincipleState(loop);
  const context = assembleLoopPrincipleContext(state);
  if (!context.ok) throw new HttpError(409, "loop_context_full", "Please simplify this loop's instructions before requesting more reading.");
  const [accountPreferences] = await tx.execute<{ article_length: string; depth: number }>(
    sql`select * from private.demand_reader_preferences(${loop.principalId}::uuid)`);
  const opened = await tx.select({ ideaId: demandEvents.ideaId }).from(demandEvents)
    .where(and(eq(demandEvents.principalId, loop.principalId), eq(demandEvents.loopId, loop.id), eq(demandEvents.type, "opened")))
    .orderBy(desc(demandEvents.createdAt)).limit(60);
  const openedIds = [...new Set(opened.map((item) => item.ideaId).filter((id): id is string => Boolean(id)))].slice(0, 20);
  const previous = openedIds.length ? await tx.select({ result: demandRequests.result }).from(demandRequests)
    .where(and(eq(demandRequests.principalId, loop.principalId), eq(demandRequests.loopId, loop.id),
      eq(demandRequests.kind, "article"), eq(demandRequests.status, "succeeded"), inArray(demandRequests.ideaId, openedIds)))
    .orderBy(desc(demandRequests.createdAt)).limit(20) : [];
  return {
    loopId: loop.id, revision: loop.revision, originalCuriosity: loop.originalCuriosity,
    directions: context.context.principles.directions.map((item) => item.instruction),
    declaredKnowledge: context.context.principles.knowledge.map((item) => item.instruction),
    readingPreferences: context.context.principles.preferences.map((item) => item.instruction),
    preferences: demandBaselinePreferences(accountPreferences),
    previousArticles: previous.flatMap((row) => {
      const parsed = articleSchema.safeParse(row.result?.article);
      return parsed.success ? [{ title: parsed.data.title, summary: parsed.data.summary }] : [];
    }),
    currentDate: new Date().toISOString().slice(0, 10),
  };
}

async function reserveRequest(tx: DemandTransaction, input: {
  principalId: string; loopId: string; ideaId?: string; kind: DemandRequestRow["kind"];
  idempotencyKey: string; requestFingerprint: string; snapshot: Record<string, unknown>;
}) {
  const limits = demandLimits();
  const recent = await tx.select({ kind: demandRequests.kind, status: demandRequests.status }).from(demandRequests)
    .where(and(eq(demandRequests.principalId, input.principalId), gt(demandRequests.reservedMicrousd, 0), gte(demandRequests.createdAt, new Date(Date.now() - 86_400_000))));
  const ceiling = { ideas: limits.dailyIdeas, article: limits.dailyArticles, feedback: limits.dailyFeedback, question: limits.dailyQuestions }[input.kind];
  const [oldCounts] = await tx.execute<{ article: number; feedback: number; question: number }>(sql`select * from private.demand_legacy_daily_counts(${input.principalId}::uuid)`);
  const oldCount = input.kind === "ideas" ? 0 : Number(oldCounts?.[input.kind] ?? 0);
  if (recent.filter((row) => row.kind === input.kind).length + oldCount >= ceiling) {
    throw new HttpError(429, "daily_reading_limit", "This reading session's daily allowance is used up. Existing reading remains available.");
  }
  const [{ outstanding }] = await tx.select({ outstanding: count() }).from(demandRequests)
    .where(and(eq(demandRequests.principalId, input.principalId), inArray(demandRequests.status, ["queued", "running"])));
  if (outstanding >= limits.maxConcurrent) {
    throw new HttpError(429, "reading_busy", "Two requests are already being prepared. You can keep reading while they finish.");
  }
  // Global admission remains effective even if someone farms fresh guest
  // sessions. Unknown/ambiguous spend keeps its full reservation; known terminal
  // work releases only unused capacity, never deletes accounting or daily jobs.
  const totals = await tx.execute(sql`
    with costs as (
      select greatest(0, case when r.status in ('queued','running')
        or (r.status='failed' and r.failure_code in ('worker_interrupted','workflow_dispatch_failed') and r.attempts < 3)
        or exists (
          select 1 from private.demand_stages s where s.request_id=r.id and s.status in ('reserved','uncertain')
        ) then r.reserved_microusd-coalesce(u.cost,0) else 0 end) as held,
        coalesce(u.monthly,0) as monthly, coalesce(u.daily,0) as daily,
        coalesce(u.unpriced, false) as unpriced
      from private.demand_requests r
      left join lateral (
        select sum(cost_microusd) as cost,
          sum(cost_microusd) filter (where created_at >= date_trunc('month', now())) as monthly,
          sum(cost_microusd) filter (where created_at >= now()-interval '24 hours') as daily,
          bool_or(pricing_status='unpriced') as unpriced
        from private.demand_usage where request_id=r.id
      ) u on true
    ) select coalesce(sum(monthly+held),0)::text as monthly,
      coalesce(sum(daily+held),0)::text as daily,
      coalesce(bool_or(unpriced),false) as unpriced from costs
  `);
  const total = totals[0] as { monthly: string; daily: string; unpriced: boolean };
  const [legacy] = await tx.execute<{ monthly: string; daily: string; unpriced: boolean; outstanding: boolean }>(sql`select * from private.demand_legacy_budget()`);
  const reservedMicrousd = demandReservationMicrousd[input.kind];
  if (!legacy || total.unpriced || legacy.unpriced || legacy.outstanding ||
      Number(total.monthly) + Number(legacy.monthly) + reservedMicrousd > limits.monthlyMicrousd ||
      Number(total.daily) + Number(legacy.daily) + reservedMicrousd > limits.dailyMicrousd) {
    throw new HttpError(429, "reading_budget_reached", "New reading is at its current spending limit. Saved articles remain available.");
  }
  const [created] = await tx.insert(demandRequests).values({ ...input, stage: "queued", reservedMicrousd }).returning();
  if (!created) throw new Error("demand_request_not_created");
  return created;
}

export async function createDemandLoop(principal: DemandPrincipal, input: { curiosity: string; idempotencyKey: string }) {
  const fingerprint = demandFingerprint({ intent: "create-loop", ...input });
  return withDemandWorkerDb(async (tx) => {
    await lockAdmission(tx, principal.id);
    const replay = await replayRequest(tx, principal.id, input.idempotencyKey, fingerprint);
    if (replay) return replay;
    const [{ size }] = await tx.select({ size: count() }).from(demandLoops).where(eq(demandLoops.principalId, principal.id));
    if (size >= 30) throw new HttpError(409, "loop_limit", "This reading session has reached its loop limit.");
    const id = randomUUID();
    const [loop] = await tx.insert(demandLoops).values({ id, principalId: principal.id,
      title: input.curiosity.slice(0, 120).trim(), originalCuriosity: input.curiosity,
      principles: { ...createEmptyLoopPrincipleState({ loopId: id, originalCuriosity: input.curiosity }) },
    }).returning();
    const context = await assembleDemandContext(tx, loop);
    return reserveRequest(tx, { principalId: principal.id, loopId: id, kind: "ideas", idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, snapshot: { version: 1, context, principleState: loop.principles } });
  });
}

export async function requestDemandIdeas(principal: DemandPrincipal, loopId: string, input: { baseRevision: number; idempotencyKey: string }) {
  const fingerprint = demandFingerprint({ intent: "ideas", loopId, ...input });
  return withDemandWorkerDb(async (tx) => {
    await lockAdmission(tx, principal.id);
    const replay = await replayRequest(tx, principal.id, input.idempotencyKey, fingerprint);
    if (replay) return replay;
    const loop = await loopForUpdate(tx, principal.id, loopId);
    if (loop.revision !== input.baseRevision) throw new HttpError(409, "loop_changed", "The loop changed. Reload its current settings and try again.");
    const [pending] = await tx.select().from(demandRequests).where(and(eq(demandRequests.principalId, principal.id), eq(demandRequests.loopId, loopId),
      eq(demandRequests.kind, "ideas"), inArray(demandRequests.status, ["queued", "running"]))).limit(1);
    // replayRequest above is the only successful path for an acknowledged key.
    // Returning another key's request here would make a lost response create a
    // second paid batch once that pending request becomes terminal.
    rejectDistinctPendingIdeasRequest(pending, loop.revision);
    return reserveRequest(tx, { principalId: principal.id, loopId, kind: "ideas", idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, snapshot: { version: 1, context: await assembleDemandContext(tx, loop), principleState: loop.principles } });
  });
}

export async function requestDemandArticle(principal: DemandPrincipal, ideaId: string, input: { idempotencyKey: string }) {
  const fingerprint = demandFingerprint({ intent: "article", ideaId, ...input });
  return withDemandWorkerDb(async (tx) => {
    await lockAdmission(tx, principal.id);
    const replay = await replayRequest(tx, principal.id, input.idempotencyKey, fingerprint);
    if (replay) return replay;
    const [idea] = await tx.select().from(demandIdeas).where(and(eq(demandIdeas.id, ideaId), eq(demandIdeas.principalId, principal.id))).for("update").limit(1);
    if (!idea) throw new HttpError(404, "idea_not_found", "That article idea was not found.");
    if (idea.articleRequestId) {
      const [existing] = await tx.select().from(demandRequests).where(and(eq(demandRequests.id, idea.articleRequestId), eq(demandRequests.principalId, principal.id))).limit(1);
      if (!existing) throw new Error("demand_article_request_missing");
      return existing;
    }
    const loop = await loopForUpdate(tx, principal.id, idea.loopId);
    const request = await reserveRequest(tx, { principalId: principal.id, loopId: loop.id, ideaId, kind: "article", idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, snapshot: { version: 1, context: await assembleDemandContext(tx, loop), principleState: loop.principles,
        selection: { idea: idea.brief, evidence: idea.evidence } } });
    await tx.update(demandIdeas).set({ articleRequestId: request.id }).where(and(eq(demandIdeas.id, ideaId), eq(demandIdeas.principalId, principal.id)));
    return request;
  });
}

export async function requestDemandFeedback(principal: DemandPrincipal, loopId: string, input:
  | { operation: "apply"; text: string; baseRevision: number; idempotencyKey: string }
  | { operation: "undo"; mutationId: string; baseRevision: number; idempotencyKey: string },
) {
  const fingerprint = demandFingerprint({ intent: "feedback", loopId, ...input });
  return withDemandWorkerDb(async (tx) => {
    await lockAdmission(tx, principal.id);
    const replay = await replayRequest(tx, principal.id, input.idempotencyKey, fingerprint);
    if (replay) return replay;
    const loop = await loopForUpdate(tx, principal.id, loopId);
    if (loop.revision !== input.baseRevision) throw new HttpError(409, "loop_changed", "The loop changed. Review its current settings and try again.");
    if (input.operation === "undo") {
      const mutationId = randomUUID();
      const beforeState = demandPrincipleState(loop);
      const mutationRequest = {
        type: "undo", loopId, expectedRevision: input.baseRevision, idempotencyKey: input.idempotencyKey,
        mutationId, targetMutationId: input.mutationId,
      } as const;
      const reduced = reduceLoopPrinciples({ state: beforeState, request: mutationRequest });
      const [request] = await tx.insert(demandRequests).values({ principalId: principal.id, loopId, kind: "feedback", status: "succeeded", stage: "ready",
        idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, reservedMicrousd: 0,
        snapshot: { version: 1, feedback: input, principleState: beforeState }, result: { receipt: reduced.receipt },
      }).returning();
      await tx.update(demandLoops).set({ revision: reduced.state.revision, principles: { ...reduced.state }, updatedAt: new Date() }).where(eq(demandLoops.id, loopId));
      await tx.insert(demandMutations).values({ id: mutationId, principalId: principal.id, loopId, requestId: request.id,
        receipt: { receipt: reduced.receipt, request: mutationRequest, beforeState, afterState: reduced.state } });
      return request;
    }
    return reserveRequest(tx, { principalId: principal.id, loopId, kind: "feedback", idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, snapshot: { version: 1, context: await assembleDemandContext(tx, loop), principleState: loop.principles, feedback: input } });
  });
}

export async function requestDemandQuestion(principal: DemandPrincipal, ideaId: string, input: { question: string; idempotencyKey: string }) {
  const fingerprint = demandFingerprint({ intent: "question", ideaId, ...input });
  return withDemandWorkerDb(async (tx) => {
    await lockAdmission(tx, principal.id);
    const replay = await replayRequest(tx, principal.id, input.idempotencyKey, fingerprint);
    if (replay) return replay;
    const [idea] = await tx.select().from(demandIdeas).where(and(eq(demandIdeas.id, ideaId), eq(demandIdeas.principalId, principal.id))).limit(1);
    if (!idea?.articleRequestId) throw new HttpError(409, "article_not_ready", "Open the prepared article before asking a question.");
    const [article] = await tx.select().from(demandRequests).where(and(eq(demandRequests.id, idea.articleRequestId), eq(demandRequests.principalId, principal.id))).limit(1);
    if (article?.status !== "succeeded" || !article.result?.draft) throw new HttpError(409, "article_not_ready", "That article is not ready yet.");
    const draft = onDemandWriterOutputSchema.parse(article.result.draft);
    if (!draft.article) throw new HttpError(409, "article_not_ready", "That article is not ready yet.");
    const includedSources = new Set(draft.article.sources.map((source) => source.key));
    const retained = onDemandEvidenceSchema.parse(idea.evidence);
    const evidence = { sources: retained.sources.filter((source) => includedSources.has(source.id)),
      passages: retained.passages.filter((passage) => includedSources.has(passage.sourceId)) };
    const history = await tx.select({ snapshot: demandRequests.snapshot, result: demandRequests.result }).from(demandRequests)
      .where(and(eq(demandRequests.principalId, principal.id), eq(demandRequests.ideaId, ideaId), eq(demandRequests.kind, "question"), eq(demandRequests.status, "succeeded")))
      .orderBy(desc(demandRequests.createdAt)).limit(6);
    return reserveRequest(tx, { principalId: principal.id, loopId: idea.loopId, ideaId, kind: "question", idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, snapshot: { version: 1, context: article.snapshot.context, question: {
        question: input.question, articleVersion: article.id, draft, evidence,
        previousMessages: history.reverse().flatMap((row) => [
          { role: "user", text: (row.snapshot.question as { question: string }).question },
          { role: "assistant", text: (row.result?.answer as { text: string }).text },
        ]),
      } } });
  });
}

export async function recordDemandEvent(principal: DemandPrincipal, ideaId: string, input: {
  type: "opened" | "saved" | "progress"; saved?: boolean; progress?: number; idempotencyKey: string;
}) {
  return withDemandDb(principal.id, async (tx) => {
    const [idea] = await tx.select().from(demandIdeas).where(and(eq(demandIdeas.id, ideaId), eq(demandIdeas.principalId, principal.id))).for("update").limit(1);
    if (!idea) throw new HttpError(404, "idea_not_found", "That idea was not found.");
    const [existing] = await tx.select().from(demandEvents).where(and(eq(demandEvents.principalId, principal.id), eq(demandEvents.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) {
      if (existing.ideaId !== ideaId || demandFingerprint(existing.data) !== demandFingerprint(input)) throw new HttpError(409, "idempotency_key_reused", "That reading event was already used for different input.");
      return;
    }
    if (input.type !== "saved") {
      const [article] = idea.articleRequestId ? await tx.select({ status: demandRequests.status }).from(demandRequests)
        .where(and(eq(demandRequests.id, idea.articleRequestId), eq(demandRequests.principalId, principal.id))).limit(1) : [];
      if (article?.status !== "succeeded") throw new HttpError(409, "article_not_ready", "That article is not ready to read yet.");
    }
    await tx.insert(demandEvents).values({ principalId: principal.id, loopId: idea.loopId, ideaId, type: input.type, idempotencyKey: input.idempotencyKey, data: { ...input } });
    if (input.type === "saved") await tx.update(demandIdeas).set({ saved: input.saved }).where(and(eq(demandIdeas.id, ideaId), eq(demandIdeas.principalId, principal.id)));
  });
}
