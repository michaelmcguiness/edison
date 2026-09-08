import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { demandIdeas, demandLoops, demandRequests, demandStages, demandUsage, withDemandWorkerDb,
  type DemandTransaction } from "@edison/db";
import { compileReaderFirstArticle, readerFirstCheckOutputSchema, READER_FIRST_PROMPT_VERSION,
  type OnDemandProvider, type OnDemandProviderResponse } from "@edison/ai";
import { demandFingerprint, type DemandIdeaRow, type DemandRequestRow } from "./demand-reading";
import { advanceReaderFirstPipeline, readerFirstSelection, type ReaderFirstPipelineState } from "./reader-first-pipeline";
import { bindDemandResearchBudget, demandRecordedSearchToolCalls, demandStagePricing,
  demandUsageWithinProviderLimits, prepareDemandStage } from "./demand-provider-stages";
import { demandRequestHeldMicrousd } from "./demand-admission";
import { demandReadableIdeaBrief } from "./demand-idea-art";

type Stage = typeof demandStages.$inferSelect;
type Usage = typeof demandUsage.$inferSelect;
type OwnedLoop = Pick<typeof demandLoops.$inferSelect, "id" | "principalId">;
export type DemandCheckRecoveryInput = {
  principalId: string; principalActive: boolean; request: DemandRequestRow;
  idea: Pick<DemandIdeaRow, "id" | "loopId" | "principalId" | "brief" | "articleRequestId">;
  loop: OwnedLoop; stages: readonly Stage[]; usage: readonly Usage[]; now?: Date;
};
export type DemandCheckRecoveryReceipt = {
  version: 1; reason: "cached_check_location_binding"; recoveredAt: string;
  originalFailure: { status: "failed"; failureCode: "provider_invalid"; stage: string; updatedAt: string;
    workflowRunId: string | null; attempts: number; progressFingerprint: string };
  checkpointFingerprint: string;
  stages: Array<{ id: string; stageKey: string; requestFingerprint: string; snapshotFingerprint: string;
    outputFingerprint: string; usageFingerprint: string; providerResponseId: string; costMicrousd: number }>;
  readmittedMicrousd: number;
};
export type DemandCheckRecovery = { checkpoint: ReaderFirstPipelineState; receipt: DemandCheckRecoveryReceipt; releasedHoldMicrousd: number };

function requireProof(condition: unknown): asserts condition {
  if (!condition) throw new Error("check_recovery_not_proven");
}
function same(a: unknown, b: unknown) { return demandFingerprint(a) === demandFingerprint(b); }

/** No database, network, or provider I/O: the only provider implementation below
 * returns the two supplied immutable envelopes, after exact stage reconstruction. */
export async function qualifyDemandCheckRecovery(input: DemandCheckRecoveryInput,
  environment: Readonly<Record<string, string | undefined>> = process.env): Promise<DemandCheckRecovery | null> {
  try {
    const { request, idea, loop, stages, usage } = input;
    requireProof(input.principalActive && input.principalId === request.principalId &&
      loop.principalId === input.principalId && loop.id === request.loopId &&
      idea.principalId === input.principalId && idea.loopId === request.loopId &&
      idea.id === request.ideaId && idea.articleRequestId === request.id);
    requireProof(request.status === "failed" && request.failureCode === "provider_invalid" && request.stage === "failed" &&
      request.kind === "article" && request.result === null && request.leaseExpiresAt === null &&
      request.attempts >= 1 && request.attempts < 3 && request.snapshot.version === 2);
    requireProof(request.requestFingerprint === demandFingerprint({ intent: "article", ideaId: request.ideaId, idempotencyKey: request.idempotencyKey }));
    const saved = structuredClone(request.progress) as ReaderFirstPipelineState | null;
    // This narrowly proved historical location correction is not a rescue path
    // for the new producer contract (including malformed or relabeled markers).
    requireProof(!Object.hasOwn(request.snapshot, "checkerContractVersion") && saved &&
      !Object.hasOwn(saved, "checkerContractVersion"));
    requireProof(saved && saved.version === 2 && saved.snapshotVersion === 2 && saved.phase === "failed" &&
      saved.promptVersion === READER_FIRST_PROMPT_VERSION && saved.failureCode === "provider_invalid" &&
      saved.requestId === request.id && saved.requestFingerprint === request.requestFingerprint && saved.kind === "article" &&
      saved.snapshotFingerprint === demandFingerprint(request.snapshot) && saved.repairAttempted === false &&
      saved.draft && saved.evidence && !saved.check && !saved.deterministicFindings &&
      (!saved.checkRecoveries || (Array.isArray(saved.checkRecoveries) && saved.checkRecoveries.length === 0)));
    requireProof(saved.models?.article === environment.OPENAI_ARTICLE_MODEL && saved.models.utility === environment.OPENAI_UTILITY_MODEL);
    const selection = readerFirstSelection(request, saved.evidence);
    requireProof(same(selection.idea, demandReadableIdeaBrief(idea.brief)));
    requireProof(stages.length === 2 && usage.length === 2 && new Set(stages.map((stage) => stage.id)).size === 2 &&
      new Set(usage.map((entry) => entry.responseId)).size === 2);
    const write = stages.find((stage) => stage.snapshot.stage === "write");
    const check = stages.find((stage) => stage.snapshot.stage === "check");
    requireProof(write && check && write !== check);
    let spent = 0;
    for (const stage of [write, check]) {
      requireProof(stage.requestId === request.id && stage.principalId === input.principalId && stage.status === "succeeded" &&
        stage.pricingStatus === "priced" && stage.providerResponseId && stage.output && stage.usage &&
        stage.createdAt >= request.createdAt && stage.updatedAt <= request.updatedAt);
      const response = stage.output as unknown as OnDemandProviderResponse;
      requireProof(same(response.usage, stage.usage) && response.usage.providerResponseId === stage.providerResponseId &&
        response.usage.model === stage.snapshot.model);
      const searchPrice = stage.snapshot.searchPriceMicrousd;
      requireProof(typeof searchPrice === "number" && Number.isSafeInteger(searchPrice) && searchPrice >= 0);
      const price = demandStagePricing(response.usage, searchPrice);
      requireProof(price.pricingStatus === "priced" && price.costMicrousd !== null && price.costMicrousd === stage.costMicrousd);
      const entry = usage.find((row) => row.stageId === stage.id);
      requireProof(entry && entry.principalId === input.principalId && entry.requestId === request.id &&
        entry.responseId === stage.providerResponseId && entry.pricingStatus === "priced" && entry.costMicrousd === price.costMicrousd &&
        entry.model === response.usage.model && entry.inputTokens === response.usage.inputTokens &&
        entry.cachedInputTokens === response.usage.cachedInputTokens && entry.outputTokens === response.usage.outputTokens &&
        entry.searchCalls === (response.usage.webSearchCalls ?? 0) && entry.createdAt <= request.updatedAt);
      spent += price.costMicrousd;
    }
    requireProof(write.createdAt <= check.createdAt && spent < request.reservedMicrousd);
    const callsBeforeCheck = demandRecordedSearchToolCalls([write]);
    const totalCalls = demandRecordedSearchToolCalls([write, check]);
    requireProof(callsBeforeCheck !== null && totalCalls !== null && totalCalls <= 8);
    const consumed: string[] = [];
    const cached: OnDemandProvider = async (call) => {
      const row = consumed.length === 0 ? write : check;
      requireProof(consumed.length < 2 && call.stage === row.snapshot.stage);
      const prepared = prepareDemandStage(request.id, input.principalId, call, environment);
      const identity = bindDemandResearchBudget(prepared.identity, consumed.length === 0 ? 0 : callsBeforeCheck);
      requireProof(row.stageKey === identity.stageKey && row.requestFingerprint === identity.requestFingerprint && same(row.snapshot, identity.snapshot));
      const response = row.output as unknown as OnDemandProviderResponse;
      requireProof(demandUsageWithinProviderLimits(identity.snapshot, response.usage, consumed.length === 0 ? callsBeforeCheck : totalCalls));
      consumed.push(row.id);
      return structuredClone(response);
    };
    const noRetrieval = async (): Promise<never> => { throw new Error("check_recovery_must_not_retrieve"); };
    // Reconstruct the original write input using the selection-time packet. A
    // redirected/refreshed final source is compiled only after cached writing.
    const initial: ReaderFirstPipelineState = { ...saved, phase: "write", failureCode: undefined, evidence: undefined,
      draft: undefined, acquisition: undefined };
    const writing = await advanceReaderFirstPipeline({ request, state: initial }, { provider: cached, retrievePage: noRetrieval });
    requireProof(!writing.failureCode && writing.state.draft && consumed.length === 1);
    const compiled = compileReaderFirstArticle(selection, writing.state.draft, selection.evidence);
    requireProof(same(compiled, saved.draft));
    const checkpoint: ReaderFirstPipelineState = { ...saved, phase: "check" };
    delete checkpoint.failureCode;
    const replay = await advanceReaderFirstPipeline({ request, state: structuredClone(checkpoint) }, { provider: cached, retrievePage: noRetrieval });
    requireProof(Number(consumed.length) === 2 && !replay.failureCode && !replay.outcome && replay.state.phase === "repair" &&
      replay.state.repairAttempted === false && replay.state.check && !replay.state.deterministicFindings);
    const original = readerFirstCheckOutputSchema.parse((check.output as unknown as OnDemandProviderResponse).output);
    requireProof(original.verdict === "repair");
    const normalized = replay.state.check;
    requireProof(original.findings.length === normalized.findings.length &&
      original.findings.some((finding, index) => finding.location !== normalized.findings[index].location));
    // Only location correction qualifies; all editorial findings and verdicts
    // must survive exactly. This is never an automatic publishing path.
    requireProof(same({ ...original, findings: original.findings.map((finding) => ({ ...finding, location: "" })) },
      { ...normalized, findings: normalized.findings.map((finding) => ({ ...finding, location: "" })) }));
    const unused = request.reservedMicrousd - spent;
    const releasedHoldMicrousd = unused - demandRequestHeldMicrousd(request, stages, spent);
    requireProof(releasedHoldMicrousd === unused && unused > 0);
    const receipt: DemandCheckRecoveryReceipt = {
      version: 1, reason: "cached_check_location_binding", recoveredAt: (input.now ?? new Date()).toISOString(),
      originalFailure: { status: "failed", failureCode: "provider_invalid", stage: request.stage,
        updatedAt: request.updatedAt.toISOString(), workflowRunId: request.workflowRunId, attempts: request.attempts,
        progressFingerprint: demandFingerprint(request.progress) },
      checkpointFingerprint: demandFingerprint(checkpoint),
      stages: [write, check].map((row) => ({ id: row.id, stageKey: row.stageKey, requestFingerprint: row.requestFingerprint,
        snapshotFingerprint: demandFingerprint(row.snapshot), outputFingerprint: demandFingerprint(row.output), usageFingerprint: demandFingerprint(row.usage),
        providerResponseId: row.providerResponseId!, costMicrousd: row.costMicrousd! })),
      readmittedMicrousd: releasedHoldMicrousd,
    };
    // Application append-preserving audit; existing envelope rows remain the
    // immutable raw proof. This is not a new database-enforced audit journal.
    checkpoint.checkRecoveries = [...(saved.checkRecoveries as unknown[] | undefined ?? []), receipt];
    requireProof(Buffer.byteLength(JSON.stringify(checkpoint), "utf8") <= 4_000_000);
    return { checkpoint, receipt, releasedHoldMicrousd };
  } catch { return null; }
}

/** Caller already holds admission → principal → request; then loop → stages. */
export async function loadDemandCheckRecovery(tx: DemandTransaction, principalId: string, request: DemandRequestRow, lock = false) {
  const loops = tx.select({ id: demandLoops.id, principalId: demandLoops.principalId }).from(demandLoops)
    .where(and(eq(demandLoops.id, request.loopId), eq(demandLoops.principalId, principalId))).limit(1);
  const [loop] = await (lock ? loops.for("update") : loops);
  const [idea] = await tx.select({ id: demandIdeas.id, principalId: demandIdeas.principalId, loopId: demandIdeas.loopId,
    brief: demandIdeas.brief, articleRequestId: demandIdeas.articleRequestId }).from(demandIdeas)
    .where(and(eq(demandIdeas.id, request.ideaId ?? "00000000-0000-0000-0000-000000000000"), eq(demandIdeas.principalId, principalId))).limit(1);
  if (!loop || !idea) return null;
  const query = tx.select().from(demandStages).where(and(eq(demandStages.requestId, request.id), eq(demandStages.principalId, principalId))).limit(5);
  const stages = await (lock ? query.for("update") : query);
  const usage = await tx.select().from(demandUsage).where(and(eq(demandUsage.requestId, request.id), eq(demandUsage.principalId, principalId))).limit(5);
  return qualifyDemandCheckRecovery({ principalId, principalActive: true, request, idea, loop, stages, usage });
}

/** Advisory UI affordance only; POST repeats full proof and budget admission
 * under locks. No saved content or private receipt leaves worker scope. */
export async function recoverableDemandCheckIds(principalId: string, requestIds: readonly string[]) {
  if (!requestIds.length) return new Set<string>();
  return withDemandWorkerDb(async (tx) => {
    const [active] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
    if (active?.active !== true) return new Set<string>();
    const candidates = await tx.select().from(demandRequests).where(and(eq(demandRequests.principalId, principalId),
      inArray(demandRequests.id, [...requestIds].slice(0, 120)), eq(demandRequests.kind, "article"), eq(demandRequests.status, "failed"),
      eq(demandRequests.failureCode, "provider_invalid"), lt(demandRequests.attempts, 3)))
      .orderBy(desc(demandRequests.createdAt)).limit(8);
    const qualified = new Set<string>();
    for (const request of candidates) if (await loadDemandCheckRecovery(tx, principalId, request)) qualified.add(request.id);
    return qualified;
  });
}
