import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { ProviderResponseValidationError, type OnDemandProviderRequest, type OnDemandProviderResponse } from "@edison/ai";
import { onDemandProviderBody, onDemandResearchProvenance, onDemandSearchUsage } from "../../../../packages/ai/src/on-demand-provider";
import {
  DEMAND_STAGE_INPUT_BYTES,
  DemandUsagePersistenceError,
  bindDemandResearchBudget,
  demandRecordedSearchToolCalls,
  demandStageDisposition,
  demandStagePricing,
  demandUsageWithinProviderLimits,
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
      const totalCalls = (value.identity.snapshot.researchCallsBefore ?? 0) + (value.usage.webSearchToolCalls ?? value.usage.webSearchCalls ?? 0);
      const usable = !value.invalid && Boolean(value.response) && pricing.pricingStatus === "priced" && demandUsageWithinProviderLimits(value.identity.snapshot, value.usage, totalCalls);
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

test("reader-first research freezes mode, reason and cap independently", () => {
  const policy = { mode: "auto" as const, reason: "Verify uncertain details", maxCalls: 4 };
  const original = prepareDemandStage("request-1", "principal-1", request({ research: true, researchPolicy: policy }), environment);
  for (const researchPolicy of [{ ...policy, mode: "required" as const }, { ...policy, reason: "Check a current source" }, { ...policy, maxCalls: 3 }]) {
    const changed = prepareDemandStage("request-1", "principal-1", request({ research: true, researchPolicy }), environment);
    assert.notEqual(changed.identity.requestFingerprint, original.identity.requestFingerprint);
  }
  policy.reason = "Changed after preparation";
  policy.maxCalls = 8;
  assert.deepEqual(original.identity.snapshot.researchPolicy, { mode: "auto", reason: "Verify uncertain details", maxCalls: 4 });
  assert.deepEqual(original.providerRequest.researchPolicy, original.identity.snapshot.researchPolicy);
  const smaller = prepareDemandStage("request-1", "principal-1", request({ research: true, researchPolicy: { mode: "auto", reason: "Verify uncertain details", maxCalls: 1 } }), environment);
  assert.ok(smaller.identity.snapshot.estimatedCeilingMicrousd < original.identity.snapshot.estimatedCeilingMicrousd);
});

test("v2 research is permitted only in generation and repair, with validated policy bounds", () => {
  const researchPolicy = { mode: "required" as const, reason: "Exact claim needs a current source", maxCalls: 2 };
  for (const stage of ["ideas", "write", "answer", "repair"] as const) {
    assert.doesNotThrow(() => prepareDemandStage("request-1", "principal-1", request({ stage, research: true, researchPolicy }), environment));
  }
  for (const stage of ["check", "ideas_check", "feedback"] as const) {
    assert.throws(() => prepareDemandStage("request-1", "principal-1", request({ stage, research: true, researchPolicy }), environment));
    assert.doesNotThrow(() => prepareDemandStage("request-1", "principal-1", request({ stage, research: false, researchPolicy: { mode: "none", reason: "Independent review", maxCalls: 0 } }), environment));
  }
  for (const policy of [{ ...researchPolicy, maxCalls: 9 }, { ...researchPolicy, maxCalls: -1 }, { ...researchPolicy, maxCalls: 1.5 }, { ...researchPolicy, maxCalls: 0 }, { ...researchPolicy, reason: " " }, { ...researchPolicy, mode: "none" as const }]) {
    assert.throws(() => prepareDemandStage("request-1", "principal-1", request({ research: true, researchPolicy: policy }), environment));
  }
});

test("v2 uses documented bounded web_search and explicit optional or required choice; legacy stays unchanged", () => {
  for (const mode of ["auto", "required"] as const) {
    const body = onDemandProviderBody(request({ research: true, researchPolicy: { mode, reason: "Check supporting facts", maxCalls: 3 } }));
    assert.deepEqual(body.tools, [{ type: "web_search", search_context_size: "medium" }]);
    assert.equal(body.tool_choice, mode);
    assert.equal(body.max_tool_calls, 3);
    assert.deepEqual(body.include, ["web_search_call.action.sources"]);
  }
  for (const mode of ["none", "auto"] as const) {
    const body = onDemandProviderBody(request({ research: mode !== "none", researchPolicy: { mode, reason: "No available research allowance", maxCalls: 0 } }));
    assert.equal(body.tools, undefined);
    assert.equal(body.max_tool_calls, undefined);
    assert.equal(body.tool_choice, undefined);
  }
  const legacy = onDemandProviderBody(request({ stage: "ideas", research: true }));
  assert.deepEqual(legacy.tools, [{ type: "web_search_preview", search_context_size: "medium" }]);
  assert.equal(legacy.max_tool_calls, 8);
});

test("tool metadata and URL annotations remain separate from structured model source claims", () => {
  const provenance = onDemandResearchProvenance([
    { type: "web_search_call", action: { type: "search", sources: [{ url: "https://example.org/consulted" }, { url: "https://example.org/consulted" }, { url: "javascript:alert(1)" }] } },
    { type: "web_search_call", action: { type: "open_page", url: "https://example.org/opened" } },
    { type: "web_search_call", action: { type: "find_in_page", url: "https://example.org/found" } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ sources: [{ url: "https://example.org/claimed-only" }] }), annotations: [{ type: "url_citation", url: "https://example.org/cited" }, { type: "file_citation", url: "https://example.org/not-url-citation" }, { type: "url_citation", url: "https://user:password@example.org/private" }] }] },
    { type: "message", content: [{ annotations: null }] },
    null,
  ]);
  assert.deepEqual(provenance, { consultedUrls: ["https://example.org/consulted", "https://example.org/opened", "https://example.org/found"], openedUrls: ["https://example.org/opened"], citedUrls: ["https://example.org/cited"] });
  assert.deepEqual(onDemandResearchProvenance([{ type: "message", content: [{ type: "output_text", text: '{"sources":[{"url":"https://example.org/claim"}]}' }] }]), { consultedUrls: [], openedUrls: [], citedUrls: [] });
});

test("v2 prices searches, bounds every action, and never prices unknown action metadata as free", () => {
  const output = ["search", "open_page", "find_in_page", "search"].map((type) => ({ type: "web_search_call", action: { type } }));
  assert.deepEqual(onDemandSearchUsage(output, true), { webSearchCalls: 2, webSearchToolCalls: 4, webSearchPricingStatus: "priced" });
  assert.deepEqual(onDemandSearchUsage(output, false), { webSearchCalls: 4 });
  const usage = { ...response().usage, ...onDemandSearchUsage(output, true) };
  assert.equal(demandStagePricing(usage, 10000).costMicrousd! - demandStagePricing({ ...usage, webSearchCalls: 0 }, 10000).costMicrousd!, 20000);
  for (const item of [{ type: "web_search_call" }, { type: "web_search_call", action: { type: "future_action" } }]) {
    const unknown = { ...response().usage, ...onDemandSearchUsage([...output, item], true) };
    assert.equal(unknown.webSearchToolCalls, 5);
    assert.equal(unknown.webSearchCalls, 2);
    assert.deepEqual(demandStagePricing(unknown, 10000), { pricingStatus: "unpriced", costMicrousd: null });
  }
});

test("request-total allocation freezes only the remaining allowance and replay basis", () => {
  const prepared = prepareDemandStage("request-1", "principal-1", request({ stage: "repair", research: true, researchPolicy: { mode: "auto", reason: "Verify the repaired claim", maxCalls: 8 } }), environment);
  const bound = bindDemandResearchBudget(prepared.identity, 6);
  assert.equal(bound.snapshot.researchPolicy!.maxCalls, 2);
  assert.equal(bound.snapshot.requestedResearchMaxCalls, 8);
  assert.equal(bound.snapshot.researchCallsBefore, 6);
  assert.equal(prepared.identity.snapshot.researchPolicy!.maxCalls, 8);
  assert.notEqual(bound.requestFingerprint, prepared.identity.requestFingerprint);
  assert.deepEqual(bound, bindDemandResearchBudget(prepared.identity, 6));
  assert.ok(bound.snapshot.estimatedCeilingMicrousd < prepared.identity.snapshot.estimatedCeilingMicrousd);
  assert.equal(bindDemandResearchBudget(prepared.identity, 8).snapshot.researchPolicy!.maxCalls, 0);
  const required = prepareDemandStage("request-1", "principal-1", request({ research: true, researchPolicy: { mode: "required", reason: "Needs current research", maxCalls: 4 } }), environment);
  assert.throws(() => bindDemandResearchBudget(required.identity, 8), (error: unknown) => error instanceof HttpError && error.code === "provider_search_budget_exhausted");
  assert.throws(() => bindDemandResearchBudget(prepared.identity, 9));
});

test("v2 stages cannot fall back to billable-only counts, and actual usage respects both frozen and total caps", () => {
  const prepared = prepareDemandStage("request-1", "principal-1", request({ research: true, researchPolicy: { mode: "auto", reason: "Verify facts", maxCalls: 2 } }), environment);
  const usage = { ...response().usage, webSearchCalls: 1, webSearchToolCalls: 2, webSearchPricingStatus: "priced" as const };
  assert.equal(demandRecordedSearchToolCalls([{ snapshot: prepared.identity.snapshot, usage }]), 2);
  assert.equal(demandRecordedSearchToolCalls([{ snapshot: prepared.identity.snapshot, usage: response().usage }]), null);
  assert.equal(demandRecordedSearchToolCalls([{ snapshot: {}, usage: { ...response().usage, webSearchCalls: 3 } }]), 3);
  assert.equal(demandUsageWithinProviderLimits(prepared.identity.snapshot, usage, 8), true);
  assert.equal(demandUsageWithinProviderLimits(prepared.identity.snapshot, { ...usage, webSearchToolCalls: 3 }, 3), false);
  assert.equal(demandUsageWithinProviderLimits(prepared.identity.snapshot, usage, 9), false);
  assert.equal(demandUsageWithinProviderLimits(prepared.identity.snapshot, usage, null), false);
  assert.equal(demandUsageWithinProviderLimits(prepared.identity.snapshot, response().usage, 0), false);
});

test("allocated provider policy and full provenance replay once; excess actual calls are charged then withheld", async () => {
  for (const actualCalls of [2, 3]) {
    const memory = memoryStore(); let calls = 0; let receivedCap: number | undefined;
    const reserve = memory.store.reserve;
    memory.store.reserve = async (identity, at) => {
      const bound = bindDemandResearchBudget(identity, 6);
      const result = await reserve(bound, at);
      return result.disposition === "call" ? { ...result, identity: bound } : result;
    };
    const observed = { ...response(), researchProvenance: { consultedUrls: ["https://example.org/study"], openedUrls: [], citedUrls: ["https://example.org/study"] }, usage: { ...response().usage, webSearchCalls: 1, webSearchToolCalls: actualCalls, webSearchPricingStatus: "priced" as const } };
    const provider = durableDemandProvider("request-1", "principal-1", { store: memory.store, environment, now: () => now, provider: async (request) => { calls++; receivedCap = request.researchPolicy?.maxCalls; return observed; } });
    const input = request({ stage: "repair", research: true, researchPolicy: { mode: "auto", reason: "Repair verification", maxCalls: 8 } });
    if (actualCalls === 2) {
      const result = await provider(input);
      assert.deepEqual(await provider(input), result);
      assert.deepEqual(result.researchProvenance, observed.researchProvenance);
    } else {
      await assert.rejects(provider(input), (error: unknown) => error instanceof HttpError && error.code === "provider_invalid");
      await assert.rejects(provider(input));
    }
    assert.equal(receivedCap, 2);
    assert.equal(calls, 1);
    assert.equal(memory.records.length, 1);
    assert.equal(memory.records[0].usage.webSearchToolCalls, actualCalls);
    assert.equal(memory.records[0].usage.webSearchCalls, 1);
    assert.ok(demandStagePricing(memory.records[0].usage, 10000).costMicrousd! > 10000);
  }
});

test("source guard allocates under lock before dispatch and retains spend before total-call validation", () => {
  const source = readFileSync(new URL("./demand-provider-stages.ts", import.meta.url), "utf8");
  const reserve = source.slice(source.indexOf("async reserve(identity"), source.indexOf("async record(result"));
  const record = source.slice(source.indexOf("async record(result"), source.indexOf("async uncertain(identity"));
  assert.ok(reserve.indexOf("demandRecordedSearchToolCalls(stages)") < reserve.indexOf("tx.insert(demandStages)"));
  assert.ok(reserve.indexOf("bindDemandResearchBudget(identity, priorToolCalls)") < reserve.indexOf("tx.insert(demandStages)"));
  assert.ok(record.indexOf("tx.insert(demandUsage)") < record.indexOf("demandUsageWithinProviderLimits"));
  assert.match(source, /ideas: 2, article: 4, feedback: 1, question: 4/);
  assert.match(source, /question: new Set\(\["answer", "check", "repair"\]\)/);
});
