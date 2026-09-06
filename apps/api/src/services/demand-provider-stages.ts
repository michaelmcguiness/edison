import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  ProviderResponseValidationError,
  openAIOnDemandProvider,
  type ObservedProviderUsage,
  type OnDemandProvider,
  type OnDemandProviderRequest,
  type OnDemandProviderResponse,
} from "@edison/ai";
import { demandLoops, demandPrincipals, demandRequests, demandStages, demandUsage, withDemandWorkerDb } from "@edison/db";
import { isPricedOpenAiModel } from "@edison/domain";
import { HttpError } from "../http/errors";
import { priceRecordedAiUsage } from "./ai-request-reservations";

export const DEMAND_STAGE_INPUT_BYTES = 96_000;
export const DEMAND_STAGE_OUTPUT_BYTES = 2_000_000;
export const DEMAND_REQUEST_SEARCH_TOOL_CALLS = 8;
const STAGE_LIMITS = { ideas: 2, article: 4, feedback: 1, question: 4 } as const;
const ALLOWED_STAGES = {
  ideas: new Set(["ideas", "ideas_check"]),
  article: new Set(["write", "check", "repair"]),
  feedback: new Set(["feedback"]),
  question: new Set(["answer", "check", "repair"]),
};

type Snapshot = Record<string, unknown> & {
  version: 1;
  stage: OnDemandProviderRequest["stage"];
  model: string;
  searchPriceMicrousd: number;
  estimatedCeilingMicrousd: number;
  researchPolicy?: OnDemandProviderRequest["researchPolicy"];
  researchCallsBefore?: number;
  requestedResearchMaxCalls?: number;
};
type StageRow = typeof demandStages.$inferSelect;
type StageIdentity = { requestId: string; principalId: string; stageKey: string; requestFingerprint: string; snapshot: Snapshot };
type ReservedStage = { id: string; leaseExpiresAt: Date };
type Reservation = { disposition: "call"; stage: ReservedStage; identity?: StageIdentity } | { disposition: "replay"; response: OnDemandProviderResponse } | { disposition: "stop"; code: string };
type RecordedResult = { stage: ReservedStage; identity: StageIdentity; response: OnDemandProviderResponse | null; usage: ObservedProviderUsage; invalid: boolean };
export interface DemandStageStore {
  reserve(identity: StageIdentity, now: Date): Promise<Reservation>;
  record(result: RecordedResult, now: Date): Promise<{ usable: boolean; code?: string }>;
  uncertain(identity: StageIdentity, stage: ReservedStage, now: Date): Promise<void>;
}

export class DemandUsagePersistenceError extends ProviderResponseValidationError {
  constructor(usage: ObservedProviderUsage) {
    super("Observed on-demand provider usage could not be durably recorded", usage);
    this.name = "DemandUsagePersistenceError";
  }
}

function stop(code: string, status = 503): never {
  throw new HttpError(status, code, "This preparation stage could not safely continue. Existing reading is unchanged.");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function json(value: unknown) { return JSON.stringify(canonical(value)); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function bytes(value: unknown) { return Buffer.byteLength(json(value), "utf8"); }

const usageSchema = z.object({
  providerResponseId: z.string().min(1).max(200), model: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative().max(2_000_000_000),
  cachedInputTokens: z.number().int().nonnegative().max(2_000_000_000),
  outputTokens: z.number().int().nonnegative().max(2_000_000_000),
  webSearchCalls: z.number().int().nonnegative().max(1000).optional(),
  webSearchToolCalls: z.number().int().nonnegative().max(1000).optional(),
  webSearchPricingStatus: z.enum(["priced", "unpriced"]).optional(),
}).refine((usage) => usage.cachedInputTokens <= usage.inputTokens)
  .refine((usage) => usage.webSearchToolCalls === undefined || (usage.webSearchCalls ?? 0) <= usage.webSearchToolCalls);
const urlsSchema = z.array(z.string().max(2048)).max(200);
const responseSchema = z.object({ output: z.unknown(), usage: usageSchema, researchedUrls: urlsSchema.optional(), researchProvenance: z.object({ consultedUrls: urlsSchema, openedUrls: urlsSchema, citedUrls: urlsSchema }).optional() });
const researchPolicySchema = z.object({ mode: z.enum(["none", "auto", "required"]), reason: z.string().trim().min(1).max(2000), maxCalls: z.number().int().nonnegative().max(DEMAND_REQUEST_SEARCH_TOOL_CALLS) }).strict()
  .refine((policy) => policy.mode !== "none" || policy.maxCalls === 0)
  .refine((policy) => policy.mode !== "required" || policy.maxCalls > 0);

export function demandStagePricing(usage: ObservedProviderUsage, searchPriceMicrousd: number) {
  usageSchema.parse(usage);
  const pricing = priceRecordedAiUsage(usage);
  if (usage.webSearchPricingStatus === "unpriced") return { pricingStatus: "unpriced" as const, costMicrousd: null };
  return {
    pricingStatus: pricing.pricingStatus,
    costMicrousd: pricing.costMicrousd === null ? null : pricing.costMicrousd + (usage.webSearchCalls ?? 0) * searchPriceMicrousd,
  };
}

export function prepareDemandStage(
  requestId: string,
  principalId: string,
  request: OnDemandProviderRequest,
  environment: Readonly<Record<string, string | undefined>>,
): { identity: StageIdentity; providerRequest: OnDemandProviderRequest } {
  const allowedModels = [environment.OPENAI_ARTICLE_MODEL, environment.OPENAI_UTILITY_MODEL].filter(Boolean);
  if (!allowedModels.includes(request.model) || !isPricedOpenAiModel(request.model)) stop("provider_model_not_allowed");
  if (!request.idempotencyKey || request.idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(request.idempotencyKey)) stop("provider_request_identity_invalid");
  if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 12_000 || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 120_000) stop("provider_stage_limit_invalid");
  if (request.researchPolicy) {
    const policy = researchPolicySchema.safeParse(request.researchPolicy);
    if (!policy.success || request.research !== (policy.data.mode !== "none") || (policy.data.mode !== "none" && !new Set(["ideas", "write", "answer", "repair"]).has(request.stage))) stop("provider_stage_tools_invalid");
  } else if (request.research !== (request.stage === "ideas")) stop("provider_stage_tools_invalid");
  const rawSearchPrice = environment.OPENAI_WEB_SEARCH_COST_MICROUSD?.trim();
  const searchPriceMicrousd = Number(rawSearchPrice);
  if (!rawSearchPrice || !Number.isSafeInteger(searchPriceMicrousd) || searchPriceMicrousd < 0 || searchPriceMicrousd > 1_000_000) stop("provider_search_price_invalid");
  const stageKey = `${request.stage}:${hash(request.idempotencyKey).slice(0, 40)}`;
  const converted = zodTextFormat(request.schema, `edison_demand_${request.stage}`);
  const wireFormat = { type: "json_schema" as const, name: converted.name, schema: converted.schema as Record<string, unknown>, strict: true };
  const frozen = JSON.parse(json({
    stage: request.stage, promptVersion: request.promptVersion, instructions: request.instructions, input: request.input,
    model: request.model, idempotencyKey: `edison-demand:${requestId}:${stageKey}`,
    safetyIdentifier: `edison-demand:${principalId}`, timeoutMs: request.timeoutMs,
    maxOutputTokens: request.maxOutputTokens, research: request.research, wireFormat,
    ...(request.researchPolicy ? { researchPolicy: request.researchPolicy } : {}),
  })) as Omit<OnDemandProviderRequest, "schema">;
  const inputBytes = bytes(frozen);
  if (inputBytes > DEMAND_STAGE_INPUT_BYTES) stop("provider_input_limit");
  // Pessimistic byte-to-token estimate for supplied input, plus a bounded search
  // allowance. This is admission headroom, not a guarantee of provider charges;
  // actual usage is always retained and overspend stops subsequent stages.
  const searchCalls = request.researchPolicy?.maxCalls ?? (request.research ? 8 : 0);
  const estimated = demandStagePricing({ providerResponseId: "reservation", model: request.model, inputTokens: inputBytes + searchCalls * 4000, cachedInputTokens: 0, outputTokens: request.maxOutputTokens, webSearchCalls: searchCalls }, searchPriceMicrousd);
  const snapshot: Snapshot = { version: 1, ...frozen, stage: request.stage, model: request.model, searchPriceMicrousd, estimatedCeilingMicrousd: estimated.costMicrousd! };
  return {
    identity: { requestId, principalId, stageKey, requestFingerprint: hash(json(snapshot)), snapshot },
    providerRequest: { ...frozen, schema: request.schema },
  };
}

/** All actions consume the request's tool allowance; only search actions are
 * billable search calls. Historical snapshots predate that distinction. */
export function demandRecordedSearchToolCalls(stages: readonly Pick<StageRow, "snapshot" | "usage">[]): number | null {
  let total = 0;
  for (const stage of stages) {
    const usage = usageSchema.safeParse(stage.usage);
    if (!usage.success) return null;
    const calls = stage.snapshot.researchPolicy
      ? usage.data.webSearchToolCalls
      : usage.data.webSearchToolCalls ?? usage.data.webSearchCalls ?? 0;
    if (calls === undefined || usage.data.webSearchPricingStatus === "unpriced") return null;
    total += calls;
  }
  return total;
}

/** Allocation runs under the request lock. Freeze the effective cap and the
 * allocation basis so replay reconstructs this exact fingerprint, never a new
 * allowance from the current ledger. The original requested cap remains visible. */
export function bindDemandResearchBudget(identity: StageIdentity, callsBefore: number): StageIdentity {
  if (!Number.isSafeInteger(callsBefore) || callsBefore < 0 || callsBefore > DEMAND_REQUEST_SEARCH_TOOL_CALLS) stop("provider_search_budget_exhausted");
  const policy = identity.snapshot.researchPolicy;
  if (!policy) {
    if (identity.snapshot.research && callsBefore > 0) stop("provider_search_budget_exhausted");
    return identity;
  }
  const maxCalls = Math.min(policy.maxCalls, DEMAND_REQUEST_SEARCH_TOOL_CALLS - callsBefore);
  if (policy.mode === "required" && maxCalls === 0) stop("provider_search_budget_exhausted");
  const researchPolicy = { ...policy, maxCalls };
  const metadata = new Set(["version", "searchPriceMicrousd", "estimatedCeilingMicrousd", "researchCallsBefore", "requestedResearchMaxCalls"]);
  const frozen = { ...Object.fromEntries(Object.entries(identity.snapshot).filter(([key]) => !metadata.has(key))), researchPolicy };
  const estimated = demandStagePricing({ providerResponseId: "reservation", model: identity.snapshot.model, inputTokens: bytes(frozen) + maxCalls * 4000, cachedInputTokens: 0, outputTokens: Number(identity.snapshot.maxOutputTokens), webSearchCalls: maxCalls }, identity.snapshot.searchPriceMicrousd);
  const snapshot = { ...identity.snapshot, researchPolicy, researchCallsBefore: callsBefore, requestedResearchMaxCalls: policy.maxCalls, estimatedCeilingMicrousd: estimated.costMicrousd! };
  return { ...identity, snapshot, requestFingerprint: hash(json(snapshot)) };
}

export function demandUsageWithinProviderLimits(snapshot: Snapshot, usage: ObservedProviderUsage, totalToolCalls: number | null): boolean {
  const policy = snapshot.researchPolicy;
  const calls = policy ? usage.webSearchToolCalls : usage.webSearchToolCalls ?? usage.webSearchCalls ?? 0;
  return calls !== undefined && totalToolCalls !== null && totalToolCalls <= DEMAND_REQUEST_SEARCH_TOOL_CALLS
    && usage.outputTokens <= Number(snapshot.maxOutputTokens)
    && calls <= (policy?.maxCalls ?? (snapshot.research ? 8 : 0))
    && (policy?.mode !== "required" || calls > 0);
}

export function demandStageDisposition(stage: Pick<StageRow, "status" | "requestFingerprint" | "leaseExpiresAt" | "output">, fingerprint: string, now: Date): "replay" | "busy" | "uncertain" | "failed" | "mismatch" {
  if (stage.requestFingerprint !== fingerprint) return "mismatch";
  if (stage.status === "succeeded") return stage.output ? "replay" : "failed";
  if (stage.status === "uncertain") return "uncertain";
  if (stage.status === "failed") return "failed";
  return stage.leaseExpiresAt && stage.leaseExpiresAt > now ? "busy" : "uncertain";
}

const databaseStore: DemandStageStore = {
  async reserve(identity, now) {
    return withDemandWorkerDb(async (tx) => {
      const [principal] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id, identity.principalId)).for("update");
      const [access] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${identity.principalId}::uuid) as active`);
      if (!principal || !access?.active) return { disposition: "stop", code: "reading_session_expired" };
      const [request] = await tx.select().from(demandRequests).where(and(eq(demandRequests.id, identity.requestId), eq(demandRequests.principalId, identity.principalId))).for("update");
      if (!request) return { disposition: "stop", code: "provider_request_not_found" };
      const [loop] = await tx.select().from(demandLoops).where(and(eq(demandLoops.id, request.loopId), eq(demandLoops.principalId, identity.principalId))).for("update");
      if (!loop) return { disposition: "stop", code: "provider_loop_not_found" };
      const input = identity.snapshot.input as { context?: { loopId?: unknown }; loopId?: unknown } | null;
      if ((input?.context && (input.context.loopId !== loop.id || json(input.context) !== json(request.snapshot.context))) || (input?.loopId && input.loopId !== loop.id)) return { disposition: "stop", code: "provider_snapshot_mismatch" };
      const stages = await tx.select().from(demandStages).where(and(eq(demandStages.requestId, request.id), eq(demandStages.principalId, identity.principalId))).for("update");
      const existing = stages.find((stage) => stage.stageKey === identity.stageKey);
      if (existing) {
        if (identity.snapshot.researchPolicy) {
          if (typeof existing.snapshot.researchCallsBefore !== "number") return { disposition: "stop", code: "provider_snapshot_mismatch" };
          identity = bindDemandResearchBudget(identity, existing.snapshot.researchCallsBefore);
        }
        const disposition = demandStageDisposition(existing, identity.requestFingerprint, now);
        if (disposition === "replay") {
          const cached = responseSchema.parse(existing.output);
          if (!Object.hasOwn(existing.output!, "output") || existing.pricingStatus !== "priced" || cached.usage.providerResponseId !== existing.providerResponseId) return { disposition: "stop", code: "provider_cache_invalid" };
          return { disposition: "replay", response: { ...cached, output: cached.output } };
        }
        if (disposition === "uncertain" && existing.status === "reserved") await tx.update(demandStages).set({ status: "uncertain", updatedAt: now }).where(eq(demandStages.id, existing.id));
        return { disposition: "stop", code: disposition === "busy" ? "provider_stage_busy" : disposition === "mismatch" ? "provider_snapshot_mismatch" : disposition === "failed" ? "provider_invalid" : "provider_uncertain" };
      }
      if (request.status !== "running" || !request.leaseExpiresAt || request.leaseExpiresAt <= now) return { disposition: "stop", code: "provider_request_not_running" };
      if (!ALLOWED_STAGES[request.kind].has(identity.snapshot.stage) || stages.length >= STAGE_LIMITS[request.kind]) return { disposition: "stop", code: "provider_stage_limit" };
      const pending = stages.find((stage) => stage.status === "reserved" || stage.status === "uncertain" || stage.status === "failed");
      if (pending) {
        if (pending.status === "reserved" && (!pending.leaseExpiresAt || pending.leaseExpiresAt <= now)) await tx.update(demandStages).set({ status: "uncertain", updatedAt: now }).where(eq(demandStages.id, pending.id));
        return { disposition: "stop", code: pending.status === "reserved" && pending.leaseExpiresAt && pending.leaseExpiresAt > now ? "provider_stage_busy" : "provider_uncertain" };
      }
      const priorToolCalls = demandRecordedSearchToolCalls(stages);
      if (priorToolCalls === null) return { disposition: "stop", code: "provider_usage_unpriced" };
      identity = bindDemandResearchBudget(identity, priorToolCalls);
      const [{ spent, unpriced }] = await tx.select({ spent: sql<number>`coalesce(sum(${demandUsage.costMicrousd}), 0)::integer`, unpriced: sql<number>`count(*) filter (where ${demandUsage.pricingStatus} = 'unpriced')::integer` }).from(demandUsage).where(eq(demandUsage.requestId, request.id));
      if (unpriced || spent + identity.snapshot.estimatedCeilingMicrousd > request.reservedMicrousd) return { disposition: "stop", code: "budget_exhausted" };
      const leaseExpiresAt = new Date(now.getTime() + Number(identity.snapshot.timeoutMs) + 30_000);
      const [stage] = await tx.insert(demandStages).values({ principalId: identity.principalId, requestId: request.id, stageKey: identity.stageKey, requestFingerprint: identity.requestFingerprint, snapshot: identity.snapshot, status: "reserved", leaseExpiresAt }).returning();
      return { disposition: "call", stage: { id: stage.id, leaseExpiresAt }, identity };
    });
  },
  async record(result, now) {
    const pricing = demandStagePricing(result.usage, result.identity.snapshot.searchPriceMicrousd);
    return withDemandWorkerDb(async (tx) => {
      // Match reserve's lock order. Taking a stage lock before its parent can
      // deadlock a concurrent reservation against the usage row's foreign key.
      const [principal] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id, result.identity.principalId)).for("update");
      const [request] = await tx.select().from(demandRequests).where(and(eq(demandRequests.id, result.identity.requestId), eq(demandRequests.principalId, result.identity.principalId))).for("update");
      const [stage] = await tx.select().from(demandStages).where(and(eq(demandStages.id, result.stage.id), eq(demandStages.requestId, result.identity.requestId), eq(demandStages.principalId, result.identity.principalId))).for("update");
      if (!stage || stage.requestFingerprint !== result.identity.requestFingerprint) stop("provider_usage_persistence_failed");
      const [priorUsage] = await tx.select().from(demandUsage).where(eq(demandUsage.responseId, result.usage.providerResponseId)).limit(1);
      if (priorUsage && priorUsage.stageId !== stage.id) return { usable: false, code: "provider_response_identity_conflict" };
      if (!priorUsage) await tx.insert(demandUsage).values({ principalId: result.identity.principalId, requestId: result.identity.requestId, stageId: stage.id, responseId: result.usage.providerResponseId, model: result.usage.model, inputTokens: result.usage.inputTokens, cachedInputTokens: result.usage.cachedInputTokens, outputTokens: result.usage.outputTokens, searchCalls: result.usage.webSearchCalls ?? 0, costMicrousd: pricing.costMicrousd, pricingStatus: pricing.pricingStatus });
      // Recheck live membership AFTER retaining any incurred spend. Revocation
      // denies releasing the response; it must not erase its usage record.
      const [access] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${result.identity.principalId}::uuid) as active`);
      const [{ totalSpent }] = await tx.select({ totalSpent: sql<number>`coalesce(sum(${demandUsage.costMicrousd}), 0)::integer` }).from(demandUsage).where(eq(demandUsage.requestId, result.identity.requestId));
      const sameLease = stage.leaseExpiresAt?.getTime() === result.stage.leaseExpiresAt.getTime();
      const returnedExpectedModel = result.usage.model === result.identity.snapshot.model || (result.usage.model.startsWith(`${result.identity.snapshot.model}-`) && /^\d{4}-\d{2}-\d{2}$/.test(result.usage.model.slice(result.identity.snapshot.model.length + 1)));
      const withinBudget = Boolean(request && totalSpent <= request.reservedMicrousd);
      const previousStages = await tx.select().from(demandStages).where(and(eq(demandStages.requestId, result.identity.requestId), eq(demandStages.principalId, result.identity.principalId)));
      const totalToolCalls = demandRecordedSearchToolCalls([...previousStages.filter((previous) => previous.id !== stage.id), { snapshot: stage.snapshot, usage: result.usage }]);
      const withinProviderLimits = demandUsageWithinProviderLimits(result.identity.snapshot, result.usage, totalToolCalls);
      const usable = !result.invalid && Boolean(result.response) && pricing.pricingStatus === "priced" && returnedExpectedModel && withinBudget && withinProviderLimits && stage.status === "reserved" && sameLease && Boolean(stage.leaseExpiresAt && stage.leaseExpiresAt > now) && Boolean(principal && access?.active) && request?.status === "running";
      // Spend is committed even if the principal was revoked, a worker lease
      // became uncertain, or the request was cancelled while the provider ran.
      if (stage.status === "reserved" && sameLease) await tx.update(demandStages).set({ status: usable ? "succeeded" : "failed", providerResponseId: result.usage.providerResponseId, output: usable ? result.response as unknown as Record<string, unknown> : null, usage: result.usage, costMicrousd: pricing.costMicrousd, pricingStatus: pricing.pricingStatus, updatedAt: now }).where(and(eq(demandStages.id, stage.id), eq(demandStages.status, "reserved"), eq(demandStages.leaseExpiresAt, result.stage.leaseExpiresAt)));
      return { usable, ...(!usable ? { code: pricing.pricingStatus === "unpriced" || !returnedExpectedModel ? "provider_model_unpriced" : !withinBudget ? "budget_exhausted" : "provider_invalid" } : {}) };
    });
  },
  async uncertain(identity, stage, now) {
    await withDemandWorkerDb(async (tx) => {
      await tx.update(demandStages).set({ status: "uncertain", updatedAt: now }).where(and(eq(demandStages.id, stage.id), eq(demandStages.principalId, identity.principalId), eq(demandStages.requestId, identity.requestId), eq(demandStages.status, "reserved"), eq(demandStages.leaseExpiresAt, stage.leaseExpiresAt)));
    });
  },
};

export function durableDemandProvider(
  requestId: string,
  principalId: string,
  dependencies: { provider?: OnDemandProvider; store?: DemandStageStore; now?: () => Date; environment?: Readonly<Record<string, string | undefined>> } = {},
): OnDemandProvider {
  const store = dependencies.store ?? databaseStore;
  const provider = dependencies.provider ?? openAIOnDemandProvider;
  const now = dependencies.now ?? (() => new Date());
  return async (request) => {
    const prepared = prepareDemandStage(requestId, principalId, request, dependencies.environment ?? process.env);
    const reserved = await store.reserve(prepared.identity, now());
    if (reserved.disposition === "stop") stop(reserved.code, reserved.code === "provider_stage_busy" ? 409 : 503);
    if (reserved.disposition === "replay") return reserved.response;
    const identity = reserved.identity ?? prepared.identity;
    const providerRequest = { ...prepared.providerRequest, ...(identity.snapshot.researchPolicy ? { researchPolicy: identity.snapshot.researchPolicy } : {}) };
    let response: OnDemandProviderResponse;
    try {
      response = await provider(providerRequest);
    } catch (error) {
      if (error instanceof ProviderResponseValidationError) {
        try { await store.record({ identity, stage: reserved.stage, response: null, usage: error.observedUsage, invalid: true }, now()); }
        catch { throw new DemandUsagePersistenceError(error.observedUsage); }
        throw error;
      }
      // No observed response is not proof that no billable work happened. An
      // expired lease is likewise NEVER reclaimed into another model request.
      await store.uncertain(identity, reserved.stage, now());
      stop("provider_uncertain");
    }
    const tooLarge = bytes(response) > DEMAND_STAGE_OUTPUT_BYTES || !responseSchema.safeParse(response).success;
    let result: Awaited<ReturnType<DemandStageStore["record"]>>;
    try { result = await store.record({ identity, stage: reserved.stage, response: tooLarge ? null : response, usage: response.usage, invalid: tooLarge }, now()); }
    catch { throw new DemandUsagePersistenceError(response.usage); }
    if (!result.usable) stop(result.code ?? "provider_invalid");
    return response;
  };
}
