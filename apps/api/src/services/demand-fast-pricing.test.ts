import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { DEMAND_PROVIDER_PRICING_VERSION, type DemandProviderPolicy, type ObservedProviderUsage, type OnDemandProviderRequest } from "@edison/ai";
import { estimatedTieredOpenAiCostMicrousd } from "@edison/domain";
import { priceRecordedAiUsage } from "./ai-request-reservations";
import { bindDemandResearchBudget, demandStagePolicyMatchesRequest, demandStagePricing, prepareDemandStage } from "./demand-provider-stages";
import { assertDemandBudgetCapacity } from "./demand-admission";
import { demandReservationMicrousd } from "./demand-configuration";

const policy: DemandProviderPolicy = { version: "edison-demand-provider-policy-v1", requestedServiceTier: "priority", pricingVersion: DEMAND_PROVIDER_PRICING_VERSION };
const environment = { OPENAI_ARTICLE_MODEL: "gpt-5.6-terra", OPENAI_UTILITY_MODEL: "gpt-5.6-luna", OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
const usage: ObservedProviderUsage = { providerResponseId: "constructed-fast-usage", model: "gpt-5.6-terra", inputTokens: 1000, cachedInputTokens: 250, outputTokens: 100, webSearchCalls: 3 };
function request(providerPolicy?: DemandProviderPolicy): OnDemandProviderRequest {
  return { stage: "write", promptVersion: "constructed-fast-pricing", instructions: "Write the selected explanation.", input: { context: { loopId: "loop" } },
    schema: z.object({ article: z.string() }), model: environment.OPENAI_ARTICLE_MODEL, idempotencyKey: "fast-pricing:write", safetyIdentifier: "principal",
    timeoutMs: 90_000, maxOutputTokens: 12_000, research: true,
    researchPolicy: { mode: "auto", reason: "Verify specific claims", maxCalls: 8 }, ...(providerPolicy ? { providerPolicy } : {}) };
}

test("frozen tier pricing uses actual returned tier and leaves tool costs separate", () => {
  for (const [model, standard, priority] of [["gpt-5.6-terra", 2750, 5500], ["gpt-5.6-luna", 275, 550]] as const) {
    for (const suffix of ["", "-2026-09-01"]) {
      assert.equal(demandStagePricing({ ...usage, model: model + suffix, serviceTier: "priority" }, 10_000, policy).costMicrousd, priority + 30_000);
      assert.equal(demandStagePricing({ ...usage, model: model + suffix, serviceTier: "default" }, 10_000, policy).costMicrousd, standard + 30_000);
    }
  }
});

test("Fast multiplies unrounded token rates including cached input", () => {
  const base = { model: "gpt-5.6-luna", inputTokens: 2, cachedInputTokens: 0, outputTokens: 0, pricingVersion: DEMAND_PROVIDER_PRICING_VERSION };
  assert.equal(estimatedTieredOpenAiCostMicrousd({ ...base, serviceTier: "default" }), 0);
  assert.equal(estimatedTieredOpenAiCostMicrousd({ ...base, serviceTier: "priority" }), 1);
  assert.equal(estimatedTieredOpenAiCostMicrousd({ ...base, inputTokens: 13, cachedInputTokens: 13, serviceTier: "priority" }), 1);
});

test("missing and unknown actual tiers retain unpriced status, never assume requested tier", () => {
  for (const value of [usage, ...[null, undefined, "fast", "auto", "flex", "scale", "unknown", " "].map((serviceTier) => ({ ...usage, serviceTier }))]) {
    assert.deepEqual(demandStagePricing(value, 10_000, policy), { pricingStatus: "unpriced", costMicrousd: null });
  }
  assert.deepEqual(demandStagePricing({ ...usage, serviceTier: "priority", webSearchPricingStatus: "unpriced" }, 10_000, policy), { pricingStatus: "unpriced", costMicrousd: null });
});

test("fresh legacy absent/default usage keeps old prices but explicit other tiers cannot underbill", () => {
  assert.equal(demandStagePricing(usage, 10_000).costMicrousd, 32_750);
  assert.equal(demandStagePricing({ ...usage, serviceTier: "default" }, 10_000).costMicrousd, 32_750);
  for (const serviceTier of ["priority", "fast", "unknown", null, undefined]) {
    assert.equal(priceRecordedAiUsage({ ...usage, serviceTier }).pricingStatus, "unpriced");
  }
});

test("frozen pricing does not extrapolate to unknown models, versions or long context", () => {
  const input = { ...usage, serviceTier: "priority", pricingVersion: DEMAND_PROVIDER_PRICING_VERSION };
  assert.doesNotThrow(() => estimatedTieredOpenAiCostMicrousd({ ...input, inputTokens: 272_000 }));
  for (const changed of [{ inputTokens: 272_001 }, { model: "gpt-5.6-sol" }, { model: "gpt-5.6-terra-regional" }, { pricingVersion: "future" },
    { serviceTier: undefined }, { inputTokens: -1 }, { cachedInputTokens: 1001 }, { outputTokens: 0.1 }]) {
    assert.throws(() => estimatedTieredOpenAiCostMicrousd({ ...input, ...changed }));
  }
  assert.equal(priceRecordedAiUsage({ ...usage, serviceTier: "priority", inputTokens: 272_001 }, DEMAND_PROVIDER_PRICING_VERSION).pricingStatus, "unpriced");
});

test("both initial and tool-adjusted reservations retain exact frozen tier pricing", () => {
  const initial = prepareDemandStage("request", "principal", request(policy), environment);
  const bound = bindDemandResearchBudget(initial.identity, 6);
  assert.deepEqual(bound.snapshot.providerPolicy, policy);
  assert.equal(bound.snapshot.researchPolicy?.maxCalls, 2);
  assert.ok(bound.snapshot.estimatedCeilingMicrousd < initial.identity.snapshot.estimatedCeilingMicrousd);
  for (const identity of [initial.identity, bound]) {
    const metadata = new Set(["version", "searchPriceMicrousd", "estimatedCeilingMicrousd", "researchCallsBefore", "requestedResearchMaxCalls"]);
    const frozen = Object.fromEntries(Object.entries(identity.snapshot).filter(([key]) => !metadata.has(key)));
    const calls = identity.snapshot.researchPolicy!.maxCalls;
    const estimate = demandStagePricing({ ...usage, inputTokens: Buffer.byteLength(JSON.stringify(frozen)) + calls * 4000, cachedInputTokens: 0,
      outputTokens: 12_000, webSearchCalls: calls, serviceTier: "priority" }, 10_000, policy);
    assert.equal(identity.snapshot.estimatedCeilingMicrousd, estimate.costMicrousd);
  }
  assert.equal(bindDemandResearchBudget(initial.identity, 6).requestFingerprint, bound.requestFingerprint);
  assert.notEqual(prepareDemandStage("request", "principal", request(), environment).identity.requestFingerprint, initial.identity.requestFingerprint);
  const standard = prepareDemandStage("request", "principal", request({ ...policy, requestedServiceTier: "default" }), environment);
  assert.notEqual(standard.identity.requestFingerprint, initial.identity.requestFingerprint);
});

test("policy preparation rejects own malformed values rather than erasing their identity", () => {
  for (const providerPolicy of [undefined, null, {}, { ...policy, version: "unknown" }, { ...policy, pricingVersion: "unknown" }, { ...policy, extra: true }]) {
    assert.throws(() => prepareDemandStage("request", "principal", { ...request(), providerPolicy } as OnDemandProviderRequest, environment));
  }
  assert.throws(() => prepareDemandStage("request", "principal", { ...request(policy), stage: "feedback" }, environment));
});

test("stage pin is independently bound to an eligible locked parent before replay", () => {
  const pinned = prepareDemandStage("request", "principal", request(policy), environment).identity.snapshot;
  assert.equal(demandStagePolicyMatchesRequest(pinned, { kind: "article", snapshot: { version: 2, providerPolicy: policy } }), true);
  for (const parent of [{ kind: "article", snapshot: { version: 2 } }, { kind: "feedback", snapshot: { version: 2, providerPolicy: policy } },
    { kind: "article", snapshot: { version: 1, providerPolicy: policy } }, { kind: "article", snapshot: { version: 2, providerPolicy: null } }]) {
    assert.equal(demandStagePolicyMatchesRequest(pinned, parent), false);
  }
});

test("Fast preserves ordinary request holds and global dollar caps including unresolved spend blocking", () => {
  assert.deepEqual(demandReservationMicrousd, { ideas: 600_000, article: 1_200_000, feedback: 100_000, question: 250_000 });
  const totals = { daily: 0, monthly: 0, unpriced: false, legacy: { daily: 0, monthly: 0, unpriced: false, outstanding: false }, additionalMicrousd: 600_000 };
  const limits = { EDISON_DEMAND_FAST_ENABLED: "true", EDISON_DEMAND_DAILY_MICROUSD: "10000000", EDISON_DEMAND_MONTHLY_MICROUSD: "40000000" };
  assert.doesNotThrow(() => assertDemandBudgetCapacity(totals, limits));
  for (const changes of [{ daily: 9_400_001 }, { monthly: 39_400_001 }, { unpriced: true }]) {
    assert.throws(() => assertDemandBudgetCapacity({ ...totals, ...changes }, limits));
  }
});
