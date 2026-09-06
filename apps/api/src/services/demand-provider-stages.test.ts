import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { ProviderResponseValidationError, type OnDemandProviderRequest, type OnDemandProviderResponse } from "@edison/ai";
import {
  DEMAND_STAGE_INPUT_BYTES,
  DemandUsagePersistenceError,
  demandStageDisposition,
  demandStagePricing,
  durableDemandProvider,
  prepareDemandStage,
  type DemandStageStore,
} from "./demand-provider-stages";
import { HttpError } from "../http/errors";

const environment = { OPENAI_ARTICLE_MODEL: "gpt-5.6-terra", OPENAI_UTILITY_MODEL: "gpt-5.6-luna", OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
const now = new Date("2026-09-06T15:00:00.000Z");
function request(overrides: Partial<OnDemandProviderRequest> = {}): OnDemandProviderRequest {
  return { stage: "write", promptVersion: "test-v1", instructions: "Write the selected supported article.", input: { context: { loopId: "loop-1", revision: 1 }, idea: { title: "Test selected idea" } }, schema: z.object({ article: z.string() }), model: "gpt-5.6-terra", idempotencyKey: "selected-article:write", safetyIdentifier: "reader-1", timeoutMs: 90_000, maxOutputTokens: 12000, research: false, ...overrides };
}
function response(model = "gpt-5.6-terra"): OnDemandProviderResponse {
  return { output: { article: "Constructed response for cache tests." }, usage: { providerResponseId: "resp-test-1", model, inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100, webSearchCalls: 0 }, researchedUrls: ["https://example.org/study"] };
}

// This injected store validates wrapper control flow. SQL locking, FK/RLS and
// transaction atomicity require the separate disposable-Postgres integration run.
function memoryStore() {
  type Identity = Parameters<DemandStageStore["reserve"]>[0];
  type RecordInput = Parameters<DemandStageStore["record"]>[0];
  let state: "reserved" | "succeeded" | "failed" | "uncertain" | null = null;
  let first: Identity | null = null;
  let cached: OnDemandProviderResponse | null = null;
  const records: RecordInput[] = [];
  const store: DemandStageStore = {
    async reserve(identity, at) {
      if (first && first.requestFingerprint !== identity.requestFingerprint) return { disposition: "stop", code: "provider_snapshot_mismatch" };
      if (state === "succeeded" && cached) return { disposition: "replay", response: structuredClone(cached) };
      if (state) return { disposition: "stop", code: state === "reserved" ? "provider_stage_busy" : state === "uncertain" ? "provider_uncertain" : "provider_invalid" };
      first = structuredClone(identity); state = "reserved";
      return { disposition: "call", stage: { id: "stage-1", leaseExpiresAt: new Date(at.getTime() + 120000) } };
    },
    async record(value) {
      records.push(structuredClone(value));
      const pricing = demandStagePricing(value.usage, value.identity.snapshot.searchPriceMicrousd);
      const usable = !value.invalid && Boolean(value.response) && pricing.pricingStatus === "priced";
      state = usable ? "succeeded" : "failed";
      cached = usable ? structuredClone(value.response) : null;
      return { usable, ...(!usable ? { code: pricing.pricingStatus === "unpriced" ? "provider_model_unpriced" : "provider_invalid" } : {}) };
    },
    async uncertain() { state = "uncertain"; },
  };
  return { store, records, state: () => state, identity: () => first };
}

test("stage fingerprint freezes every material provider option and is stable across JSON key ordering", () => {
  const first = prepareDemandStage("request-1", "principal-1", request(), environment);
  const reordered = prepareDemandStage("request-1", "principal-1", request({ input: { idea: { title: "Test selected idea" }, context: { revision: 1, loopId: "loop-1" } } }), environment);
  assert.equal(first.identity.requestFingerprint, reordered.identity.requestFingerprint);
  for (const changed of [request({ promptVersion: "v2" }), request({ instructions: "Changed task" }), request({ model: "gpt-5.6-luna" }), request({ maxOutputTokens: 100 }), request({ timeoutMs: 60000 }), request({ schema: z.object({ article: z.string(), extra: z.string() }) }), request({ input: { context: { loopId: "loop-2" } } })]) {
    assert.notEqual(prepareDemandStage("request-1", "principal-1", changed, environment).identity.requestFingerprint, first.identity.requestFingerprint);
  }
  assert.notEqual(prepareDemandStage("request-1", "principal-1", request(), { ...environment, OPENAI_WEB_SEARCH_COST_MICROUSD: "12000" }).identity.requestFingerprint, first.identity.requestFingerprint);
});

test("provider keys are namespaced to the logical request and safety identity to its principal", () => {
  const first = prepareDemandStage("request-1", "principal-1", request(), environment);
  const second = prepareDemandStage("request-2", "principal-2", request(), environment);
  assert.notEqual(first.providerRequest.idempotencyKey, second.providerRequest.idempotencyKey);
  assert.equal(first.providerRequest.safetyIdentifier, "edison-demand:principal-1");
  assert.ok(first.identity.stageKey.length <= 80);
  assert.equal(first.providerRequest.wireFormat!.strict, true);
});

test("provider stage freezes input and wire schema before an awaited reservation", async () => {
  const memory = memoryStore();
  const original = request();
  let captured: OnDemandProviderRequest | null = null;
  const reserve = memory.store.reserve;
  memory.store.reserve = async (...args) => {
    (original.input as { idea: { title: string } }).idea.title = "Changed after reservation";
    return reserve(...args);
  };
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async (value) => { captured = value; return response(); } });
  await provider(original);
  assert.equal(((captured! as OnDemandProviderRequest).input as { idea: { title: string } }).idea.title, "Test selected idea");
  assert.equal(memory.identity()!.snapshot.input && JSON.stringify(memory.identity()!.snapshot.input).includes("Changed after reservation"), false);
});

test("successful raw response and researched URLs replay without another provider call", async () => {
  const memory = memoryStore(); let calls = 0;
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; return response(); } });
  const first = await provider(request()); const second = await provider(request());
  assert.deepEqual(second, first);
  assert.deepEqual(second.researchedUrls, ["https://example.org/study"]);
  assert.equal(calls, 1);
  assert.equal(memory.records.length, 1);
});

test("a concurrent request encounters the reserved stage and cannot commission a duplicate", async () => {
  const memory = memoryStore(); let finish!: (value: OnDemandProviderResponse) => void; let calls = 0;
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
  const running = provider(request());
  await assert.rejects(provider(request()), (error: unknown) => error instanceof HttpError && error.code === "provider_stage_busy");
  finish(response()); await running;
  assert.equal(calls, 1);
});

test("ambiguous transport outcome stops automatic retries and never assumes no charge", async () => {
  const memory = memoryStore(); let calls = 0;
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; throw new Error("Transport timeout after possible dispatch"); } });
  await assert.rejects(provider(request()), (error: unknown) => error instanceof HttpError && error.code === "provider_uncertain");
  await assert.rejects(provider(request()), (error: unknown) => error instanceof HttpError && error.code === "provider_uncertain");
  assert.equal(memory.state(), "uncertain");
  assert.equal(memory.records.length, 0);
  assert.equal(calls, 1);
});

test("expired reserved leases become uncertain instead of reclaimable", () => {
  assert.equal(demandStageDisposition({ status: "reserved", leaseExpiresAt: new Date(now.getTime() - 1), requestFingerprint: "same", output: null }, "same", now), "uncertain");
  assert.equal(demandStageDisposition({ status: "reserved", leaseExpiresAt: new Date(now.getTime() + 1000), requestFingerprint: "same", output: null }, "same", now), "busy");
  assert.equal(demandStageDisposition({ status: "succeeded", leaseExpiresAt: null, requestFingerprint: "same", output: {} }, "changed", now), "mismatch");
});

test("bad structured output, refusal or incomplete response retains observed usage", async () => {
  const memory = memoryStore(); let calls = 0;
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; throw new ProviderResponseValidationError("Unusable provider JSON", response().usage); } });
  await assert.rejects(provider(request()), ProviderResponseValidationError);
  assert.equal(memory.records.length, 1);
  assert.equal(memory.records[0].usage.providerResponseId, "resp-test-1");
  assert.equal(memory.records[0].response, null);
  assert.equal(memory.records[0].invalid, true);
  await assert.rejects(provider(request()));
  assert.equal(calls, 1);
});

test("unexpected unpriced model preserves its real token usage and cannot return reading", async () => {
  const memory = memoryStore();
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => response("unexpected-model") });
  await assert.rejects(provider(request()), (error: unknown) => error instanceof HttpError && error.code === "provider_model_unpriced");
  const pricing = demandStagePricing(memory.records[0].usage, 10000);
  assert.deepEqual(pricing, { pricingStatus: "unpriced", costMicrousd: null });
  assert.equal(memory.records[0].usage.inputTokens, 1000);
  assert.equal(memory.state(), "failed");
});

test("configured search charges are included alongside existing token pricing", () => {
  const usage = { ...response().usage, webSearchCalls: 3 };
  assert.equal(demandStagePricing(usage, 12000).costMicrousd! - demandStagePricing({ ...usage, webSearchCalls: 0 }, 12000).costMicrousd!, 36000);
});

test("a usage-storage failure preserves observed metadata and the reservation blocks re-dispatch", async () => {
  const memory = memoryStore(); let calls = 0;
  memory.store.record = async () => { throw new Error("Database unavailable"); };
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; return response(); } });
  await assert.rejects(provider(request()), (error: unknown) => error instanceof DemandUsagePersistenceError && error.observedUsage.providerResponseId === "resp-test-1");
  await assert.rejects(provider(request()));
  assert.equal(calls, 1);
});

test("input, output-token, tool and model limits fail before provider dispatch", async () => {
  const memory = memoryStore(); let calls = 0;
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; return response(); } });
  for (const value of [request({ input: { text: "x".repeat(DEMAND_STAGE_INPUT_BYTES) } }), request({ maxOutputTokens: 12001 }), request({ research: true }), request({ model: "unapproved-model" }), request({ timeoutMs: 120001 })]) await assert.rejects(provider(value));
  assert.equal(calls, 0);
});

test("oversized returned output is withheld but its usage still reaches storage", async () => {
  const memory = memoryStore();
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => ({ ...response(), output: { article: "x".repeat(2_000_001) } }) });
  await assert.rejects(provider(request()));
  assert.equal(memory.records[0].invalid, true);
  assert.equal(memory.records[0].usage.outputTokens, 100);
});

test("same request key cannot quietly substitute updated prompt content", async () => {
  const memory = memoryStore(); let calls = 0;
  const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async () => { calls++; return response(); } });
  await provider(request());
  await assert.rejects(provider(request({ instructions: "A silently changed assignment" })), (error: unknown) => error instanceof HttpError && error.code === "provider_snapshot_mismatch");
  assert.equal(calls, 1);
});

test("source guard retains incurred usage before rechecking live account membership", () => {
  // This protects the integration ordering; it is not a substitute for the
  // disposable-Postgres revocation/ledger test owned by release security.
  const source = readFileSync(new URL("./demand-provider-stages.ts", import.meta.url), "utf8");
  const reserve = source.slice(source.indexOf("async reserve(identity"), source.indexOf("async record(result"));
  const record = source.slice(source.indexOf("async record(result"), source.indexOf("async uncertain(identity"));
  assert.ok(reserve.indexOf("private.demand_principal_is_active") < reserve.indexOf('disposition === "replay"'));
  assert.ok(record.indexOf("tx.insert(demandUsage)") < record.indexOf("private.demand_principal_is_active"));
  assert.match(record, /Boolean\(principal && access\?\.active\)/);
});
