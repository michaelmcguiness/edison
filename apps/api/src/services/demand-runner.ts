import { and, eq, sql } from "drizzle-orm";
import { RetryableError } from "workflow";
import {
  getArticleModel, getUtilityModel, ON_DEMAND_PROMPT_VERSION, READER_FIRST_PROMPT_VERSION, ProviderResponseValidationError,
  onDemandWriterOutputSchema,
  type OnDemandContext, type OnDemandEvidence, type OnDemandIdea,
  type OnDemandWriterOutput, type OnDemandCheckOutput, type OnDemandFeedbackOutput,
  type OnDemandAnswerOutput, type SelectedOnDemandInput,
} from "@edison/ai";
import { demandIdeas, demandLoops, demandMutations, demandRequests,
  withDemandWorkerDb, type DemandTransaction } from "@edison/db";
import { LoopPrincipleError, reduceLoopPrinciples } from "@edison/domain";
import { demandFingerprint, demandPrincipleState, type DemandRequestRow } from "./demand-reading";
import { advanceDemandPipeline, initialDemandPhase, type DemandPipelineState } from "./demand-pipeline";
import { demandArtifactId, demandFeedbackOperations, publishableDemandArticle, publishableDemandAnswer } from "./demand-publication";
import { DemandUsagePersistenceError } from "./demand-provider-stages";
import { requireDemandEnabled } from "./demand-configuration";
import { HttpError } from "../http/errors";
import {
  advanceReaderFirstPipeline, initialReaderFirstPhase, readerFirstQuestion, readerFirstSelection,
  type ReaderFirstPipelineState,
} from "./reader-first-pipeline";
import { publishReaderFirstAnswer, publishReaderFirstArticle } from "./reader-first-publication";
import { lockDemandAdmission } from "./demand-admission";
import { assertDemandAllowanceSettlement } from "./demand-allowance";
import { demandCheckerContractCompatibilityFailure, demandCheckerOptions } from "./demand-checker-contract";
import { demandProviderPolicyCompatibilityFailure } from "./demand-provider-policy";

const JOB_LEASE_MS = 5 * 60_000;
const DEMAND_PIPELINE_VERSION = 1;
const DEMAND_SNAPSHOT_VERSION = 1;
type ReadingPipelineState = DemandPipelineState | ReaderFirstPipelineState;

type DemandProgressIdentity = Pick<
  DemandRequestRow,
  "id" | "kind" | "requestFingerprint" | "snapshot"
>;

export function demandCheckpoint(state: ReadingPipelineState) {
  // Retrieval can retain its visible phase while advancing through source groups.
  // A fingerprint binds replay/CAS to the complete persisted checkpoint, not
  // merely to a repeated label such as "retrieve".
  return `${state.phase}:${demandFingerprint(state)}`;
}

export function demandVisibleStage(phase: string): string {
  if (phase === "research" || phase.startsWith("retrieve")) return "researching";
  return ({ ideas: "queued", ideas_check: "checking-ideas", write: "writing", check: "checking", repair: "repairing",
    recheck: "checking", feedback: "updating", answer: "answering", answer_check: "checking",
    answer_repair: "repairing", answer_recheck: "checking", ready: "ready", failed: "failed" } as Record<string, string>)[phase] ?? "queued";
}

export function initialDemandState(
  request: DemandProgressIdentity,
): ReadingPipelineState {
  const readerFirst = request.snapshot.version === 2;
  return {
    version: readerFirst ? 2 : DEMAND_PIPELINE_VERSION,
    snapshotVersion: request.snapshot.version,
    snapshotFingerprint: demandFingerprint(request.snapshot),
    promptVersion: readerFirst ? READER_FIRST_PROMPT_VERSION : ON_DEMAND_PROMPT_VERSION,
    ...(Object.hasOwn(request.snapshot, "checkerContractVersion")
      ? { checkerContractVersion: request.snapshot.checkerContractVersion } : {}),
    ...(Object.hasOwn(request.snapshot, "providerPolicy")
      ? { providerPolicy: structuredClone(request.snapshot.providerPolicy) } : {}),
    phase: readerFirst ? initialReaderFirstPhase(request.kind) : initialDemandPhase(request.kind),
    requestId: request.id,
    requestFingerprint: request.requestFingerprint,
    kind: request.kind,
    models: { article: getArticleModel(), utility: getUtilityModel() },
  };
}

export function demandProgressCompatibilityFailure(
  request: DemandProgressIdentity,
  state: ReadingPipelineState,
) {
  const readerFirst = request.snapshot.version === 2;
  const snapshotVersion = readerFirst ? 2 : DEMAND_SNAPSHOT_VERSION;
  if (
    request.snapshot.version !== snapshotVersion ||
    state.version !== (readerFirst ? 2 : DEMAND_PIPELINE_VERSION) ||
    state.snapshotVersion !== snapshotVersion ||
    state.promptVersion !== (readerFirst ? READER_FIRST_PROMPT_VERSION : ON_DEMAND_PROMPT_VERSION) ||
    (readerFirst && request.kind === "feedback")
  ) {
    return "pipeline_version_unsupported";
  }
  const checkerFailure = demandCheckerContractCompatibilityFailure(request, state);
  if (checkerFailure) return checkerFailure;
  const providerFailure = demandProviderPolicyCompatibilityFailure(request, state);
  if (providerFailure) return providerFailure;
  if (
    state.requestId !== request.id ||
    state.requestFingerprint !== request.requestFingerprint ||
    state.kind !== request.kind ||
    state.snapshotFingerprint !== demandFingerprint(request.snapshot)
  ) {
    return "pipeline_state_invalid";
  }
  return null;
}

/**
 * A changed checkpoint means the write that appeared to fail actually committed
 * or another delivery advanced it. Return that durable checkpoint for replay;
 * only an unchanged checkpoint may be marked failed.
 */
export function demandFailureReplayCheckpoint(
  status: DemandRequestRow["status"],
  state: ReadingPipelineState | null,
  expectedCheckpoint?: string,
) {
  if (status !== "running" || state === null) return null;
  const currentCheckpoint = demandCheckpoint(state);
  return expectedCheckpoint === undefined || currentCheckpoint !== expectedCheckpoint
    ? currentCheckpoint
    : null;
}

export function demandRunnerFailure(error: unknown) {
  if (error instanceof DemandUsagePersistenceError) return "provider_uncertain";
  if (error instanceof ProviderResponseValidationError) return "provider_invalid";
  if (error instanceof LoopPrincipleError) return error.code === "limit_exceeded" ? "loop_context_full"
    : error.code === "stale_revision" ? "loop_changed" : "feedback_unclear";
  const code = error instanceof HttpError ? error.code : error instanceof Error ? error.message : "";
  return ["provider_uncertain", "provider_invalid", "budget_exhausted", "reading_session_expired", "evidence_unavailable", "editorial_withheld", "feedback_unclear", "loop_changed", "pipeline_version_unsupported", "pipeline_state_invalid", "pipeline_snapshot_invalid"].includes(code)
    ? code : code.startsWith("provider_") ? "provider_invalid" : "worker_interrupted";
}

/** Display-only projection for the database's trimmed columns. The approved
 * brief and its exact checker/provider snapshots must remain unchanged. */
export function demandIdeaDisplay(idea: Pick<OnDemandIdea, "headline" | "deck">) {
  const title = idea.headline.trim();
  const deck = idea.deck.trim();
  if (!title || title.length > 180 || !deck || deck.length > 500) {
    throw new Error("provider_invalid");
  }
  return { title, deck };
}

async function lockRequest(tx: DemandTransaction, id: string) {
  const [identity] = await tx.select({ principalId: demandRequests.principalId }).from(demandRequests).where(eq(demandRequests.id, id)).limit(1);
  if (!identity) return null;
  // Weekly reservations, settlement, claims and reset use one lock order.
  // Inactive work still needs to reach its ordinary terminal failure path.
  await lockDemandAdmission(tx, identity.principalId, false);
  const [request] = await tx.select().from(demandRequests).where(and(eq(demandRequests.id, id), eq(demandRequests.principalId, identity.principalId))).for("update").limit(1);
  return request ?? null;
}

async function active(tx: DemandTransaction, principalId: string) {
  const [row] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
  return row?.active === true;
}

export async function claimDemandRequest(id: string, runId: string): Promise<string | null> {
  requireDemandEnabled();
  return withDemandWorkerDb(async (tx) => {
    const request = await lockRequest(tx, id);
    if (!request || !["queued", "running"].includes(request.status) ||
        (request.workflowRunId !== null && request.workflowRunId !== runId) || request.nextAttemptAt > new Date()) return null;
    if (!await active(tx, request.principalId)) {
      await tx.update(demandRequests).set({ status: "failed", stage: "failed", failureCode: "reading_session_expired", leaseExpiresAt: null }).where(eq(demandRequests.id, id));
      return null;
    }
    const state = request.progress as ReadingPipelineState | null ?? initialDemandState(request);
    const compatibilityFailure = demandProgressCompatibilityFailure(request, state);
    if (compatibilityFailure) {
      await failInTransaction(tx, id, compatibilityFailure);
      return null;
    }
    await tx.update(demandRequests).set({ status: "running", stage: demandVisibleStage(state.phase),
      workflowRunId: runId, leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS), progress: state,
    }).where(eq(demandRequests.id, id));
    return demandCheckpoint(state);
  });
}

async function failInTransaction(tx: DemandTransaction, id: string, code: string, state?: ReadingPipelineState) {
  await tx.update(demandRequests).set({ status: "failed", stage: "failed", failureCode: code,
    leaseExpiresAt: null, ...(state ? { progress: state } : {}) }).where(eq(demandRequests.id, id));
}

async function finish(tx: DemandTransaction, request: DemandRequestRow, state: ReadingPipelineState, outcome: string) {
  const compatibilityFailure = demandProgressCompatibilityFailure(request, state);
  if (compatibilityFailure) throw new Error(compatibilityFailure);
  const context = request.snapshot.context as OnDemandContext;
  const [loop] = await tx.select().from(demandLoops).where(and(eq(demandLoops.id, request.loopId), eq(demandLoops.principalId, request.principalId))).for("update").limit(1);
  if (!loop) throw new Error("reading_session_expired");
  if ((outcome === "ideas" || outcome === "feedback") && loop.revision !== context.revision) {
    await failInTransaction(tx, request.id, "loop_changed", state);
    return;
  }
  let result: Record<string, unknown>;
  if (outcome === "ideas") {
    const ideas = state.ideas as OnDemandIdea[];
    if (!ideas?.length) throw new Error("evidence_unavailable");
    await assertDemandAllowanceSettlement(tx,request.id,ideas.length);
    const rows = ideas.map((idea, index) => {
      const id = demandArtifactId(`${request.id}:idea:${idea.key}`);
      if (idea.loopId !== loop.id || idea.loopRevision !== loop.revision) throw new Error("loop_changed");
      return { id, principalId: request.principalId, loopId: loop.id, batchRequestId: request.id,
        batchRevision: loop.revision, rank: index + 1, ...demandIdeaDisplay(idea),
        brief: { ...idea, id }, evidence: state.evidence as unknown as Record<string, unknown> };
    });
    await tx.insert(demandIdeas).values(rows);
    result = { ideaIds: rows.map((row) => row.id) };
  } else if (outcome === "article") {
    if (state.version === 2) {
      if (!state.draft || !state.check) throw new Error("editorial_withheld");
      const selection = readerFirstSelection(request, state.evidence);
      const article = publishReaderFirstArticle({ requestId: request.id, selection, draft: state.draft, check: state.check,
        ...demandCheckerOptions(request, state) });
      result = { version: 2, article, draft: state.draft, check: state.check, evidence: selection.evidence };
    } else {
      const selection = { context, ...(request.snapshot.selection as { idea: OnDemandIdea; evidence: OnDemandEvidence }) } satisfies SelectedOnDemandInput;
      const article = publishableDemandArticle({ requestId: request.id, selection,
        draft: state.draft as OnDemandWriterOutput, check: state.check as OnDemandCheckOutput, publishedAt: new Date().toISOString() });
      result = { article, draft: state.draft, check: state.check };
    }
  } else if (outcome === "feedback") {
    const feedback = request.snapshot.feedback as { text: string; baseRevision: number };
    const mutationId = demandArtifactId(`${request.id}:mutation`);
    const beforeState = demandPrincipleState(loop);
    const mutationRequest = {
      type: "apply", loopId: loop.id, expectedRevision: feedback.baseRevision,
      idempotencyKey: request.idempotencyKey, mutationId, interpretationVersion: state.promptVersion as string,
      evidence: { source: "reader-feedback", sourceId: request.id, exactText: feedback.text },
      operations: demandFeedbackOperations(request.id, state.feedback as OnDemandFeedbackOutput),
    } as const;
    const reduced = reduceLoopPrinciples({ state: beforeState, request: mutationRequest, historyIsDurable: true });
    await tx.update(demandLoops).set({ revision: reduced.state.revision, principles: { ...reduced.state } }).where(eq(demandLoops.id, loop.id));
    await tx.insert(demandMutations).values({ id: mutationId, principalId: request.principalId, loopId: loop.id, requestId: request.id,
      receipt: { receipt: reduced.receipt, request: mutationRequest, beforeState, afterState: reduced.state } });
    result = { receipt: reduced.receipt };
  } else if (outcome === "question") {
    if (state.version === 2) {
      if (!state.answer || !state.check) throw new Error("editorial_withheld");
      const question = readerFirstQuestion(request, state.evidence);
      result = { version: 2, answer: publishReaderFirstAnswer({ requestId: request.id, question,
        answer: state.answer, check: state.check, ...demandCheckerOptions(request, state) }), check: state.check, evidence: question.evidence };
    } else {
    const answer = state.answer as OnDemandAnswerOutput;
    const question = request.snapshot.question as { articleVersion: string; evidence: OnDemandEvidence; draft: unknown;
      question: string; previousMessages: Array<{ role: "user" | "assistant"; text: string }> };
    const draft = onDemandWriterOutputSchema.parse(question.draft);
    if (!draft.article) throw new Error("editorial_withheld");
    result = { answer: publishableDemandAnswer({ articleId: question.articleVersion, articleVersion: 1,
      article: draft.article, evidence: question.evidence, question: question.question, conversation: question.previousMessages },
    answer, state.check as OnDemandCheckOutput), check: state.check };
    }
  } else throw new Error("provider_invalid");
  await tx.update(demandRequests).set({ status: "succeeded", stage: "ready", result, progress: state,
    leaseExpiresAt: null, failureCode: null }).where(eq(demandRequests.id, request.id));
}

/** One remote stage per durable step; only IDs and phase names enter Workflow's log. */
export async function advanceDemandRequest(id: string, runId: string, expectedCheckpoint: string): Promise<string | null> {
  requireDemandEnabled();
  const loaded = await withDemandWorkerDb(async (tx) => {
    const request = await lockRequest(tx, id);
    if (!request || request.status !== "running" || request.workflowRunId !== runId) return null;
    if (!await active(tx, request.principalId)) { await failInTransaction(tx, id, "reading_session_expired"); return null; }
    const state = request.progress as ReadingPipelineState | null;
    if (!state) throw new Error("demand_progress_missing");
    const compatibilityFailure = demandProgressCompatibilityFailure(request, state);
    if (compatibilityFailure) {
      await failInTransaction(tx, id, compatibilityFailure);
      return null;
    }
    if (demandCheckpoint(state) !== expectedCheckpoint) return { request, state };
    await tx.update(demandRequests).set({ leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS) }).where(eq(demandRequests.id, id));
    return { request, state };
  });
  if (!loaded) return null;
  if (demandCheckpoint(loaded.state) !== expectedCheckpoint) return demandCheckpoint(loaded.state);
  try {
    const next = loaded.state.version === 2
      ? await advanceReaderFirstPipeline({ request: loaded.request, state: loaded.state })
      : await advanceDemandPipeline({ request: loaded.request, state: loaded.state });
    return await withDemandWorkerDb(async (tx) => {
      const current = await lockRequest(tx, id);
      if (!current || current.status !== "running" || current.workflowRunId !== runId) return null;
      const state = current.progress as ReadingPipelineState;
      const compatibilityFailure = demandProgressCompatibilityFailure(current, state);
      if (compatibilityFailure) {
        await failInTransaction(tx, id, compatibilityFailure);
        return null;
      }
      if (demandCheckpoint(state) !== expectedCheckpoint) return demandCheckpoint(state);
      if (!await active(tx, current.principalId)) { await failInTransaction(tx, id, "reading_session_expired"); return null; }
      const nextCompatibilityFailure = demandProgressCompatibilityFailure(current, next.state);
      if (nextCompatibilityFailure) {
        await failInTransaction(tx, id, nextCompatibilityFailure);
        return null;
      }
      if (next.failureCode) { await failInTransaction(tx, id, next.failureCode, next.state); return null; }
      if (next.outcome) { await finish(tx, current, next.state, next.outcome); return null; }
      await tx.update(demandRequests).set({ progress: next.state, stage: demandVisibleStage(next.state.phase),
        leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS) }).where(eq(demandRequests.id, id));
      return demandCheckpoint(next.state);
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === "provider_stage_busy") {
      throw new RetryableError("The saved provider stage is still running", { retryAfter: "60s" });
    }
    return failDemandRequest(id, runId, demandRunnerFailure(error), expectedCheckpoint);
  }
}

export async function failDemandRequest(
  id: string,
  runId: string,
  code = "worker_interrupted",
  expectedCheckpoint?: string,
): Promise<string | null> {
  return withDemandWorkerDb(async (tx) => {
    const current = await lockRequest(tx, id);
    if (!current || !["queued", "running"].includes(current.status) || current.workflowRunId !== runId) return null;
    const replay = demandFailureReplayCheckpoint(
      current.status,
      current.progress as ReadingPipelineState | null,
      expectedCheckpoint,
    );
    if (replay) return replay;
    await failInTransaction(tx, id, code);
    return null;
  });
}
