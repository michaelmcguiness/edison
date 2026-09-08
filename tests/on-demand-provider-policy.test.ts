import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as policyModule from "../packages/ai/src/provider-policy";
import * as usageModule from "../packages/ai/src/provider-response-error";
import { onDemandProviderBody } from "../packages/ai/src/on-demand-provider";
import type { OnDemandProvider, OnDemandProviderRequest } from "../packages/ai/src/on-demand";

const { DEMAND_PROVIDER_POLICY_VERSION, DEMAND_PROVIDER_PRICING_VERSION,
  demandProviderPolicySchema, readDemandProviderPolicy } = policyModule;
const { ProviderResponseValidationError, providerResponseUsage } = usageModule;
const requireFromAi = createRequire(new URL("../packages/ai/package.json", import.meta.url));
const zodHelpers = requireFromAi("openai/helpers/zod") as {
  zodTextFormat: (schema: z.ZodTypeAny, name: string) => unknown;
};
const policy: policyModule.DemandProviderPolicy = {
  version: DEMAND_PROVIDER_POLICY_VERSION, requestedServiceTier: "priority", pricingVersion: DEMAND_PROVIDER_PRICING_VERSION,
};
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const observed = { providerResponseId: "constructed-tier-response", model: "gpt-5.6-terra",
  inputTokens: 321, cachedInputTokens: 21, outputTokens: 123 };

function request(overrides: Partial<OnDemandProviderRequest> = {}): OnDemandProviderRequest {
  return { stage: "write", promptVersion: "constructed-policy-test", instructions: "Keep this constructed request unchanged.",
    input: { context: "Constructed input only.", order: ["first", "second"] }, schema: z.object({ article: z.string() }),
    model: "gpt-5.6-terra", idempotencyKey: "constructed-policy-request", safetyIdentifier: "constructed-reader",
    timeoutMs: 90_000, maxOutputTokens: 12_000, research: false, ...overrides };
}
function response() {
  return { id: observed.providerResponseId, model: observed.model, status: "completed", output_text: '{"article":"Constructed output."}',
    output: [] as unknown[], usage: { input_tokens: observed.inputTokens,
      input_tokens_details: { cached_tokens: observed.cachedInputTokens }, output_tokens: observed.outputTokens } };
}
function withReportedTier(value: unknown) { return { ...response(), service_tier: value }; }

// Compile the actual provider boundary with only its client acquisition replaced.
// The injected create method is local and never imports/calls a remote client.
function boundary(result: unknown = response()) {
  const calls: Array<{ body: unknown; options: unknown }> = [];
  let clients = 0;
  const imports: Record<string, unknown> = {
    "openai/helpers/zod": zodHelpers, "./provider-policy": policyModule,
    "./provider-response-error": usageModule,
    "./client": { getOpenAIClient() {
      clients++;
      return { responses: { async create(body: unknown, options: unknown) {
        calls.push({ body, options }); return result;
      } } };
    } },
  };
  const file = new URL("../packages/ai/src/on-demand-provider.ts", import.meta.url);
  const exports: Record<string, unknown> = {};
  new Script(ts.transpileModule(readFileSync(file, "utf8"), { fileName: file.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText).runInNewContext({ exports, URL, JSON, Set, Object, Error,
    require(name: string) {
      if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected provider dependency: ${name}`);
      return imports[name];
    } });
  return { call: exports.openAIOnDemandProvider as OnDemandProvider, calls, clients: () => clients };
}

const invalidPolicies: unknown[] = [undefined, null, false, [], {}, "priority", { ...policy, version: "unknown" },
  { ...policy, pricingVersion: "unknown" }, { ...policy, requestedServiceTier: "fast" },
  { ...policy, requestedServiceTier: "auto" }, { ...policy, requestedServiceTier: null },
  { version: policy.version, requestedServiceTier: "priority" }, { ...policy, extra: true }];

test("provider policy is a strict, separately versioned contract with a cloned closed tier value", () => {
  assert.equal(DEMAND_PROVIDER_POLICY_VERSION, "edison-demand-provider-policy-v1");
  assert.equal(DEMAND_PROVIDER_PRICING_VERSION, "openai-terra-luna-2026-09-08-v1");
  for (const requestedServiceTier of ["default", "priority"] as const) {
    const original = { ...policy, requestedServiceTier };
    const parsed = demandProviderPolicySchema.parse(original);
    assert.deepEqual(parsed, original); assert.notEqual(parsed, original);
    assert.deepEqual(readDemandProviderPolicy({ providerPolicy: original }), original);
  }
  assert.equal(readDemandProviderPolicy({}), undefined);
  for (const value of invalidPolicies) {
    assert.equal(demandProviderPolicySchema.safeParse(value).success, false);
    assert.throws(() => readDemandProviderPolicy({ providerPolicy: value } as Parameters<typeof readDemandProviderPolicy>[0]));
  }
});

test("absent-policy body remains exact legacy wire; a valid policy changes only service_tier", () => {
  for (const extra of [{}, { research: true },
    { research: true, researchPolicy: { mode: "auto" as const, reason: "Constructed research.", maxCalls: 8 } },
    { research: false, researchPolicy: { mode: "none" as const, reason: "Constructed check.", maxCalls: 0 } }]) {
    const original = request(extra);
    const legacy = onDemandProviderBody(original);
    assert.equal(Object.hasOwn(legacy, "service_tier"), false);
    assert.equal(Object.hasOwn(legacy, "providerPolicy"), false);
    assert.equal(legacy.model, original.model); assert.equal(legacy.instructions, original.instructions);
    assert.equal(legacy.input, JSON.stringify(original.input));
    assert.deepEqual(plain(legacy.text?.format), plain(zodHelpers.zodTextFormat(original.schema, "edison_demand_write")));
    assert.deepEqual(legacy.reasoning, { effort: "low" }); assert.equal(legacy.text?.verbosity, "medium");
    assert.equal(legacy.max_output_tokens, 12_000); assert.equal(legacy.store, false);
    for (const requestedServiceTier of ["default", "priority"] as const) {
      const body = onDemandProviderBody({ ...original, providerPolicy: { ...policy, requestedServiceTier } });
      const { service_tier, ...unchanged } = body;
      assert.equal(service_tier, requestedServiceTier);
      assert.equal(JSON.stringify(unchanged), JSON.stringify(legacy));
      assert.equal(JSON.stringify(body).includes("pricingVersion"), false);
    }
  }
});

test("own undefined, null and malformed policies stop before client creation or a provider request", async () => {
  for (const value of invalidPolicies) {
    const invalid = request({ providerPolicy: value } as Partial<OnDemandProviderRequest>);
    const app = boundary();
    assert.throws(() => onDemandProviderBody(invalid));
    await assert.rejects(app.call(invalid));
    assert.equal(app.clients(), 0); assert.equal(app.calls.length, 0);
  }
});

test("observed tier keeps exact bounded metadata while absence preserves the legacy usage shape", () => {
  assert.deepEqual(providerResponseUsage(response()), observed);
  assert.equal(Object.hasOwn(providerResponseUsage(response()), "serviceTier"), false);
  assert.deepEqual(providerResponseUsage(response(), { requireServiceTier: true }), { ...observed, serviceTier: null });
  assert.deepEqual(providerResponseUsage(withReportedTier("")), { ...observed, serviceTier: null },
    "empty metadata must reach usage storage as null, not fail the ledger's nonempty-string schema");
  for (const value of ["default", "priority", "fast", "flex", "", " priority", "x".repeat(80), "x".repeat(81), undefined, null, false, 5, [], {}]) {
    assert.deepEqual(providerResponseUsage(withReportedTier(value)), {
      ...observed, serviceTier: typeof value === "string" && value.length > 0 && value.length <= 80 ? value : null,
    });
  }
  const inherited = Object.assign(Object.create({ service_tier: "priority" }), response());
  assert.deepEqual(providerResponseUsage(inherited), observed);
  assert.deepEqual(providerResponseUsage(inherited, { requireServiceTier: true }), { ...observed, serviceTier: null });
});

test("tier-aware provider accepts actual priority and standard fallback without changing one-call controls", async () => {
  for (const requestedServiceTier of ["default", "priority"] as const) for (const actual of ["default", "priority"]) {
    const app = boundary(withReportedTier(actual));
    const result = await app.call(request({ providerPolicy: { ...policy, requestedServiceTier } }));
    assert.deepEqual(plain(result.output), { article: "Constructed output." });
    assert.deepEqual(plain(result.usage), { ...observed, serviceTier: actual, webSearchCalls: 0 });
    assert.equal(app.calls.length, 1); assert.equal(app.clients(), 1);
    assert.equal((app.calls[0].body as { service_tier: string }).service_tier, requestedServiceTier);
    assert.deepEqual(plain(app.calls[0].options), { idempotencyKey: "constructed-policy-request",
      headers: { "Idempotency-Key": "constructed-policy-request" }, timeout: 90_000, maxRetries: 0 });
  }
});

test("new missing or unknown actual tier withholds valid output but retains observed token and tool usage", async () => {
  for (const metadata of [response(), ...[undefined, null, "fast", "flex", "unknown", "", "x".repeat(81), 3, {}].map(withReportedTier)]) {
    metadata.output = [
      { type: "web_search_call", action: { type: "search", sources: [{ url: "https://example.test/constructed" }] } },
      { type: "web_search_call", action: { type: "open_page", url: "https://example.test/constructed" } },
    ];
    const app = boundary(metadata);
    await assert.rejects(app.call(request({ providerPolicy: policy, research: true,
      researchPolicy: { mode: "auto", reason: "Constructed research.", maxCalls: 8 } })), (error: unknown) => {
      assert.ok(error instanceof ProviderResponseValidationError);
      assert.deepEqual(plain(error.observedUsage), { ...providerResponseUsage(metadata, { requireServiceTier: true }),
        webSearchCalls: 1, webSearchToolCalls: 2, webSearchPricingStatus: "priced" });
      return true;
    });
    assert.equal(app.calls.length, 1, "unknown billing is not an automatic retry or downgrade");
  }
});

test("invalid JSON, incomplete and refused outputs still retain actual tier before rejection", async () => {
  for (const metadata of [
    { ...withReportedTier("priority"), output_text: "not JSON" },
    { ...withReportedTier("default"), status: "incomplete" },
    { ...withReportedTier("priority"), output: [{ type: "message", content: [{ type: "refusal", refusal: "Constructed refusal." }] }] },
  ]) {
    const app = boundary(metadata);
    await assert.rejects(app.call(request({ providerPolicy: policy })), (error: unknown) => {
      assert.ok(error instanceof ProviderResponseValidationError);
      assert.deepEqual(plain(error.observedUsage), { ...observed, serviceTier: metadata.service_tier, webSearchCalls: 0 });
      return true;
    });
    assert.equal(app.calls.length, 1);
  }
});

test("fresh legacy explicit tier is retained for ledger classification, never silently erased", async () => {
  for (const metadata of [response(), withReportedTier("default"), withReportedTier("priority"), withReportedTier("unknown"), withReportedTier(null)]) {
    const app = boundary(metadata); const result = await app.call(request());
    assert.deepEqual(plain(result.usage), { ...providerResponseUsage(metadata), webSearchCalls: 0 });
    assert.equal(Object.hasOwn(app.calls[0].body as object, "service_tier"), false);
    assert.equal(app.calls.length, 1);
  }
});
