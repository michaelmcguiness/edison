import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import * as orm from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { zodTextFormat } from "openai/helpers/zod";
import ts from "typescript";
import { z } from "zod";
import * as ai from "@edison/ai";
import { ProviderResponseValidationError, type OnDemandProviderRequest, type OnDemandProviderResponse } from "@edison/ai";
import * as domain from "@edison/domain";
import { demandLoops, demandPrincipals, demandRequests, demandStages, demandUsage } from "../../../../packages/db/src/schema";
import { HttpError } from "../http/errors";
import type { durableDemandProvider } from "./demand-provider-stages";

// Execute the actual private production store, not the wrapper's memory-store
// seam. Only transactions and remote transport are replaced. Real Drizzle
// columns/predicates and the production pricing helper remain in use. This does
// not establish PostgreSQL locking, RLS or transaction atomicity.
const environment = { OPENAI_ARTICLE_MODEL: "gpt-5.6-terra", OPENAI_UTILITY_MODEL: "gpt-5.6-luna", OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
const now = new Date("2026-09-08T18:00:00.000Z");
const principalId = "constructed-principal";
const requestId = "constructed-request";
const loopId = "constructed-loop";
const stageId = "constructed-current-stage";
const context = { loopId, revision: 1 };
const dialect = new PgDialect();
const plain = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const forbidden = () => { throw new Error("No database or remote provider may be opened by this constructed test"); };
const fastPolicy = {
  version: "edison-demand-provider-policy-v1", requestedServiceTier: "priority",
  pricingVersion: "openai-terra-luna-2026-09-08-v1",
} as const satisfies ai.DemandProviderPolicy;

function compiled(file: string, imports: Record<string, unknown>) {
  const url = new URL(file, import.meta.url);
  const exports: Record<string, unknown> = {};
  new Script(ts.transpileModule(readFileSync(url, "utf8"), {
    fileName: url.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText).runInNewContext({
    exports, Buffer, Date, JSON, Error, Object, Set, structuredClone,
    process: { env: {} },
    require(name: string) {
      if (!Object.hasOwn(imports, name)) throw new Error(`Unapproved isolated dependency: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

const pricing = compiled("./ai-request-reservations.ts", {
  "drizzle-orm": orm, "@edison/domain": domain, "@edison/ai": ai, "../http/errors": { HttpError },
  "@edison/db": { getDb: forbidden, aiRequestReservations: {}, usageLedger: {} },
});

function providerRequest(): OnDemandProviderRequest {
  return { stage: "repair", promptVersion: "constructed-settlement-v1", instructions: "Repair this constructed explanation.",
    input: { context }, schema: z.object({ article: z.string() }), model: environment.OPENAI_ARTICLE_MODEL,
    idempotencyKey: "constructed-repair", safetyIdentifier: principalId, timeoutMs: 90_000, maxOutputTokens: 2_000,
    research: true, researchPolicy: { mode: "auto", reason: "Constructed usage accounting.", maxCalls: 8 } };
}

function observedUsage(calls: number, id = "constructed-response") {
  return { providerResponseId: id, model: environment.OPENAI_ARTICLE_MODEL,
    inputTokens: 100, cachedInputTokens: 10, outputTokens: 100,
    webSearchCalls: calls, webSearchToolCalls: calls, webSearchPricingStatus: "priced" as const };
}

function rawResponse(): OnDemandProviderResponse {
  return { output: { article: 'Constructed “raw” response — keep \\ escapes and <literal> bytes. '.repeat(100),
    nested: { untouched: ["first", "second"], optionalFinding: { excerpt: "Do not normalize this." } } },
  usage: observedUsage(2), researchedUrls: ["https://example.test/constructed"],
  researchProvenance: { consultedUrls: ["https://example.test/constructed"], openedUrls: [], citedUrls: [] } };
}

type Row = Record<string, unknown>;
type Scenario = "normal" | "missing-tool-count" | "malformed-usage" | "unpriced-usage" | "excess-tools" | "revoked" | "over-budget";
type SelectEvent = { transaction: number; table: unknown; selection: Record<string, unknown> | undefined;
  predicate: orm.SQL; lock?: string; limit?: number };
type HarnessOptions = {
  providerPolicy?: unknown; parentPolicy?: unknown; omitParentPolicy?: boolean; actualTier?: string | null;
  parentPolicyAfterCall?: unknown;
  reservedMicrousd?: number; spent?: number; transport?: "refusal" | "unknown";
  stageAfterCall?: Row; existingReceipt?: "legacy" | "observed"; extraUsageFields?: boolean;
};

function harness(scenario: Scenario = "normal", options: HarnessOptions = {}) {
  const events: string[] = [];
  const selects: SelectEvent[] = [];
  const insertedUsage: Row[] = [];
  const existingUsage: Row[] = [];
  const stageUpdates: Row[] = [];
  const response = rawResponse();
  if (Object.hasOwn(options, "actualTier")) response.usage.serviceTier = options.actualTier;
  if (options.extraUsageFields) Object.assign(response.usage, { prompt: "not accounting", article: "not accounting", rawResponse: { text: "not accounting" } });
  const stagePolicy = Object.hasOwn(options, "providerPolicy") ? { providerPolicy: options.providerPolicy } : {};
  const parentPolicy = options.omitParentPolicy ? {} : Object.hasOwn(options, "parentPolicy") ? { providerPolicy: options.parentPolicy } : stagePolicy;
  const request = { ...providerRequest(), ...stagePolicy } as OnDemandProviderRequest;
  const providerFailure = options.transport === "refusal"
    ? new ProviderResponseValidationError("Constructed refusal with retained usage.", response.usage)
    : new Error("Constructed unknown delivery; no observed provider response.");
  let transaction = 0;
  let connectionHeld = false;
  let providerCalls = 0;
  let currentStage: Row | undefined;
  let stageAtResponse: Row | undefined;
  let settlementProjectionReads = 0;
  const priorStage = { id: "constructed-prior-stage", stageKey: "write:constructed-prior", status: "succeeded",
    snapshot: { version: 1, researchPolicy: { mode: "auto", maxCalls: 8 }, ...stagePolicy },
    usage: { ...observedUsage(6, "constructed-prior-response"), ...(Object.hasOwn(stagePolicy, "providerPolicy") ? { serviceTier: "priority" } : {}) },
    // The settlement projection must not return or deserialize this raw field.
    output: { output: { article: "Prior raw output. ".repeat(10_000) } } };
  const requestRow = { id: requestId, principalId, loopId, kind: "article", status: "running",
    snapshot: { version: 2, context, ...parentPolicy }, reservedMicrousd: options.reservedMicrousd ?? 1_200_000,
    leaseExpiresAt: new Date(now.getTime() + 300_000) };

  function predicateIs(predicate: orm.SQL, expected: orm.SQL) {
    assert.deepEqual(dialect.sqlToQuery(predicate), dialect.sqlToQuery(expected));
  }
  function read(event: SelectEvent): Row[] {
    selects.push(event);
    const { table, selection, predicate, lock } = event;
    if (table === demandPrincipals) {
      predicateIs(predicate, orm.eq(demandPrincipals.id, principalId));
      assert.equal(lock, "update"); events.push("principal:lock"); return [{ id: principalId }];
    }
    if (table === demandRequests) {
      predicateIs(predicate, orm.and(orm.eq(demandRequests.id, requestId), orm.eq(demandRequests.principalId, principalId))!);
      assert.equal(lock, "update"); events.push("request:lock"); return [requestRow];
    }
    if (table === demandLoops) {
      predicateIs(predicate, orm.and(orm.eq(demandLoops.id, loopId), orm.eq(demandLoops.principalId, principalId))!);
      assert.equal(lock, "update"); events.push("loop:lock"); return [{ id: loopId }];
    }
    if (table === demandStages) {
      if (lock && dialect.sqlToQuery(predicate).params.includes(stageId)) {
        predicateIs(predicate, orm.and(orm.eq(demandStages.id, stageId), orm.eq(demandStages.requestId, requestId), orm.eq(demandStages.principalId, principalId))!);
        assert.equal(lock, "update"); assert.equal(selection, undefined);
        events.push("stage:lock"); return [currentStage!];
      }
      predicateIs(predicate, orm.and(orm.eq(demandStages.requestId, requestId), orm.eq(demandStages.principalId, principalId))!);
      if (lock) {
        assert.equal(lock, "update"); assert.equal(selection, undefined, "reserve must retain full raw rows for exact cached replay");
        events.push("stages:lock"); return [priorStage, ...(currentStage ? [currentStage] : [])];
      }
      assert.equal(transaction, 2);
      assert.deepEqual(Object.keys(selection ?? {}).sort(), ["id", "snapshot", "usage"],
        "settlement must project only id, snapshot and usage, not prior raw responses");
      assert.equal(selection!.id, demandStages.id); assert.equal(selection!.snapshot, demandStages.snapshot);
      assert.equal(selection!.usage, demandStages.usage);
      settlementProjectionReads++; events.push("stages:projection");
      // Reserve always sees valid prior usage; corrupt only the constructed
      // settlement read, so negative cases cannot pass by stopping at admission.
      const usage: Row = { ...priorStage.usage };
      if (scenario === "missing-tool-count") delete usage.webSearchToolCalls;
      if (scenario === "malformed-usage") usage.inputTokens = -1;
      if (scenario === "unpriced-usage") usage.webSearchPricingStatus = "unpriced";
      if (scenario === "excess-tools") { usage.webSearchCalls = 7; usage.webSearchToolCalls = 7; }
      return [{ id: priorStage.id, snapshot: priorStage.snapshot, usage },
        { id: stageId, snapshot: currentStage!.snapshot, usage: null }];
    }
    assert.equal(table, demandUsage);
    if (!selection) {
      predicateIs(predicate, orm.eq(demandUsage.responseId, response.usage.providerResponseId));
      assert.equal(event.limit, 1); events.push("usage:identity"); return existingUsage;
    }
    predicateIs(predicate, orm.eq(demandUsage.requestId, requestId));
    if ("spent" in selection) { events.push("usage:reservation-total"); return [{ spent: options.spent ?? 0, unpriced: 0 }]; }
    assert.deepEqual(Object.keys(selection), ["totalSpent"]); events.push("usage:settlement-total");
    return [{ totalSpent: scenario === "over-budget" ? requestRow.reservedMicrousd + 1
      : (options.spent ?? 0) + [...existingUsage, ...insertedUsage].reduce((sum, row) => sum + Number(row.costMicrousd ?? 0), 0) }];
  }

  const tx = {
    select(selection?: Record<string, unknown>) {
      return { from(table: unknown) { return { where(predicate: orm.SQL) {
        const event = { transaction, table, selection, predicate };
        return {
          for(lock: string) { return Promise.resolve(read({ ...event, lock })); },
          limit(limit: number) { return Promise.resolve(read({ ...event, limit })); },
          then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve().then(() => read(event)).then(resolve, reject);
          },
        };
      } }; } };
    },
    async execute(query: orm.SQL) {
      predicateIs(query, orm.sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
      events.push("membership:check");
      return [{ active: !(transaction === 2 && scenario === "revoked") }];
    },
    insert(table: unknown) {
      return { values(values: Row) {
        assert.equal(values.principalId, principalId); assert.equal(values.requestId, requestId);
        if (table === demandStages) {
          assert.equal(transaction, 1); events.push("stage:reserve");
          currentStage = { ...values, id: stageId, providerResponseId: null, usage: null, output: null };
          return { returning: async () => [currentStage] };
        }
        assert.equal(table, demandUsage); assert.equal(transaction, 2);
        assert.equal(values.stageId, stageId); events.push("usage:insert"); insertedUsage.push(values);
        return Promise.resolve();
      } };
    },
    update(table: unknown) {
      assert.equal(table, demandStages);
      return { set(values: Row) { return { async where(predicate: orm.SQL) {
        if (values.status === "uncertain") {
          predicateIs(predicate, orm.and(orm.eq(demandStages.id, stageId), orm.eq(demandStages.principalId, principalId),
            orm.eq(demandStages.requestId, requestId), orm.eq(demandStages.status, "reserved"),
            orm.eq(demandStages.leaseExpiresAt, currentStage!.leaseExpiresAt as Date))!);
          events.push("stage:uncertain"); stageUpdates.push(values); currentStage = { ...currentStage, ...values };
          return;
        }
        predicateIs(predicate, orm.and(orm.eq(demandStages.id, stageId), orm.eq(demandStages.status, "reserved"),
          orm.eq(demandStages.leaseExpiresAt, currentStage!.leaseExpiresAt as Date))!);
        events.push("stage:settle"); stageUpdates.push(values); currentStage = { ...currentStage, ...values };
      } }; } };
    },
  };
  const app = compiled("./demand-provider-stages.ts", {
    "node:crypto": { createHash }, "drizzle-orm": orm, "openai/helpers/zod": { zodTextFormat }, "zod": { z },
    "@edison/ai": { ...ai, openAIOnDemandProvider: forbidden },
    "@edison/domain": domain, "../http/errors": { HttpError }, "./ai-request-reservations": pricing,
    "@edison/db": { demandLoops, demandPrincipals, demandRequests, demandStages, demandUsage,
      async withDemandWorkerDb(callback: (connection: typeof tx) => Promise<unknown>) {
        assert.equal(connectionHeld, false); connectionHeld = true; transaction++; events.push("transaction:begin");
        try { return await callback(tx); }
        finally { connectionHeld = false; events.push("transaction:end"); }
      } },
  });
  // Deliberately omit the injectable store: this runs production reserve/record.
  const provider = (app.durableDemandProvider as typeof durableDemandProvider)(requestId, principalId, {
    environment, now: () => now,
    provider: async (input) => {
      assert.equal(connectionHeld, false, "provider work must stay outside the worker transaction");
      providerCalls++; events.push("provider:synthetic");
      assert.equal(input.researchPolicy?.maxCalls, 2, "prior six tool calls leave exactly two in the frozen allowance");
      assert.deepEqual(plain(input.providerPolicy), plain(request.providerPolicy));
      // Construct a corrupted parent only after reservation to exercise the
      // settlement recheck, not a pre-call rejection. Never mutate live data.
      if (Object.hasOwn(options, "parentPolicyAfterCall")) {
        (requestRow.snapshot as Record<string, unknown>).providerPolicy = options.parentPolicyAfterCall;
      }
      if (options.stageAfterCall) currentStage = { ...currentStage, ...options.stageAfterCall };
      stageAtResponse = structuredClone(currentStage!);
      if (options.existingReceipt) existingUsage.push({ stageId, responseId: response.usage.providerResponseId,
        costMicrousd: 123, pricingStatus: "priced", observedUsage: options.existingReceipt === "legacy" ? null
          : { ...response.usage, serviceTier: "default" } });
      if (options.transport) throw providerFailure;
      return response;
    },
  });
  return { run: (input = request) => provider(input), events, selects, insertedUsage, existingUsage, stageUpdates, response, request, requestRow, providerFailure,
    stage: () => structuredClone(currentStage), stageAtResponse: () => structuredClone(stageAtResponse),
    providerCalls: () => providerCalls, projectionReads: () => settlementProjectionReads };
}

test("production settlement projects prior-stage accounting only and preserves raw output and cached replay", async () => {
  const app = harness();
  const original = JSON.stringify(app.response);
  assert.equal(JSON.stringify(await app.run()), original);
  assert.equal(app.projectionReads(), 1); assert.equal(app.providerCalls(), 1);
  assert.equal(app.insertedUsage.length, 1); assert.equal(app.stageUpdates.length, 1);
  assert.equal(app.stageUpdates[0].status, "succeeded");
  assert.equal(JSON.stringify(app.stageUpdates[0].output), original);
  assert.deepEqual(plain(app.stageUpdates[0].usage), app.response.usage);
  assert.deepEqual(app.events, ["transaction:begin", "principal:lock", "membership:check", "request:lock", "loop:lock",
    "stages:lock", "usage:reservation-total", "stage:reserve", "transaction:end", "provider:synthetic",
    "transaction:begin", "principal:lock", "request:lock", "stage:lock", "usage:identity", "usage:insert",
    "membership:check", "usage:settlement-total", "stages:projection", "stage:settle", "transaction:end"]);
  // The current row's null usage was excluded; six prior + two current calls
  // were accepted once. Full-row reserve must still return the saved envelope.
  assert.equal(JSON.stringify(await app.run()), original);
  assert.equal(app.providerCalls(), 1); assert.equal(app.projectionReads(), 1);
  assert.equal(app.insertedUsage.length, 1); assert.equal(app.stageUpdates.length, 1);
  assert.deepEqual(app.events.slice(-7), ["transaction:begin", "principal:lock", "membership:check", "request:lock",
    "loop:lock", "stages:lock", "transaction:end"]);
});

for (const scenario of ["missing-tool-count", "malformed-usage", "unpriced-usage", "excess-tools", "revoked", "over-budget"] as const) {
  test(`production settlement retains incurred spend and withholds raw output for ${scenario}`, async () => {
    const app = harness(scenario);
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError &&
      error.code === (scenario === "over-budget" ? "budget_exhausted" : "provider_invalid"));
    assert.equal(app.providerCalls(), 1, "this rejection must exercise settlement, not stop at reservation");
    assert.equal(app.projectionReads(), 1); assert.equal(app.insertedUsage.length, 1);
    assert.equal(app.insertedUsage[0].responseId, app.response.usage.providerResponseId);
    assert.equal(app.insertedUsage[0].inputTokens, app.response.usage.inputTokens);
    assert.equal(app.insertedUsage[0].outputTokens, app.response.usage.outputTokens);
    assert.equal(app.insertedUsage[0].searchCalls, 2);
    assert.equal(app.insertedUsage[0].pricingStatus, "priced");
    assert.ok(Number(app.insertedUsage[0].costMicrousd) > 0);
    assert.equal(app.stageUpdates.length, 1); assert.equal(app.stageUpdates[0].status, "failed");
    assert.equal(app.stageUpdates[0].output, null);
    assert.deepEqual(plain(app.stageUpdates[0].usage), app.response.usage);
    assert.ok(app.events.indexOf("usage:insert") < app.events.lastIndexOf("membership:check"));
    assert.ok(app.events.indexOf("stages:projection") < app.events.indexOf("stage:settle"));
  });
}

test("Fast stage requires the exact valid parent policy before any provider call or ledger write", async () => {
  const cases: HarnessOptions[] = [
    { providerPolicy: fastPolicy, omitParentPolicy: true },
    { parentPolicy: fastPolicy },
    { providerPolicy: fastPolicy, parentPolicy: { ...fastPolicy, requestedServiceTier: "default" } },
    { providerPolicy: fastPolicy, parentPolicy: null },
    { providerPolicy: fastPolicy, parentPolicy: undefined },
    { providerPolicy: null, parentPolicy: fastPolicy },
    { providerPolicy: { ...fastPolicy, pricingVersion: "constructed-unknown-pricing" }, parentPolicy: fastPolicy },
  ];
  for (const options of cases) {
    const app = harness("normal", { ...options, actualTier: "priority" });
    await assert.rejects(app.run(), error => error instanceof Error, JSON.stringify(options));
    assert.equal(app.providerCalls(), 0); assert.equal(app.insertedUsage.length, 0);
    assert.equal(app.stageUpdates.length, 0); assert.equal(app.events.includes("stage:reserve"), false);
  }
});

test("Fast reservation is denied before calling when only the standard estimate fits the unchanged hold", async () => {
  const limits = { reservedMicrousd: 140_000, spent: 60_000 };
  const standard = harness("normal", { ...limits, actualTier: "default" });
  await standard.run();
  assert.equal(standard.providerCalls(), 1);
  const fast = harness("normal", { ...limits, providerPolicy: fastPolicy, actualTier: "priority" });
  await assert.rejects(fast.run(), (error: unknown) => error instanceof HttpError && error.code === "budget_exhausted");
  assert.equal(fast.providerCalls(), 0); assert.equal(fast.insertedUsage.length, 0);
  assert.equal(fast.stageUpdates.length, 0); assert.equal(fast.events.includes("stage:reserve"), false);
  assert.equal(fast.requestRow.reservedMicrousd, limits.reservedMicrousd);
});

for (const [actualTier, costMicrousd] of [["priority", 22_764], ["default", 21_382]] as const) {
  test(`Fast ${actualTier} settlement uses actual-tier token pricing, unchanged tool fees and exact cached replay`, async () => {
    const app = harness("normal", { providerPolicy: fastPolicy, actualTier });
    const original = JSON.stringify(app.response);
    assert.equal(JSON.stringify(await app.run()), original);
    assert.equal(app.insertedUsage[0].costMicrousd, costMicrousd);
    assert.deepEqual(plain(app.insertedUsage[0].observedUsage), app.response.usage);
    assert.equal(app.insertedUsage[0].pricingStatus, "priced");
    assert.equal(app.insertedUsage[0].searchCalls, 2, "the two searches still cost 20,000 microUSD in either tier");
    assert.equal(app.stageUpdates[0].costMicrousd, costMicrousd);
    assert.equal((app.stageUpdates[0].usage as Row).serviceTier, actualTier);
    assert.equal(JSON.stringify(app.stageUpdates[0].output), original);
    const before = JSON.stringify({ request: app.requestRow, ledger: app.insertedUsage, settlements: app.stageUpdates });
    assert.equal(JSON.stringify(await app.run()), original);
    assert.equal(app.providerCalls(), 1); assert.equal(app.projectionReads(), 1);
    assert.equal(JSON.stringify({ request: app.requestRow, ledger: app.insertedUsage, settlements: app.stageUpdates }), before);
    await assert.rejects(app.run({ ...app.request, providerPolicy: { ...fastPolicy, requestedServiceTier: "default" } }));
    assert.equal(app.providerCalls(), 1, "changed policy cannot borrow the cached response or commission a replacement");
    assert.equal(JSON.stringify({ request: app.requestRow, ledger: app.insertedUsage, settlements: app.stageUpdates }), before);
  });
}

for (const tier of ["unknown-tier", null, undefined] as const) {
  test(`Fast ${String(tier)} actual tier preserves unpriced usage and withholds the response without another call`, async () => {
    const app = harness("normal", { providerPolicy: fastPolicy, ...(tier === undefined ? {} : { actualTier: tier }) });
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_model_unpriced");
    assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 1);
    assert.equal(app.insertedUsage[0].costMicrousd, null); assert.equal(app.insertedUsage[0].pricingStatus, "unpriced");
    assert.equal(app.insertedUsage[0].inputTokens, 100); assert.equal(app.insertedUsage[0].outputTokens, 100);
    assert.equal(app.insertedUsage[0].searchCalls, 2);
    assert.deepEqual(plain(app.insertedUsage[0].observedUsage), app.response.usage);
    assert.equal(app.stageUpdates[0].status, "failed"); assert.equal(app.stageUpdates[0].output, null);
    assert.deepEqual(plain(app.stageUpdates[0].usage), app.response.usage);
    const before = JSON.stringify({ ledger: app.insertedUsage, settlements: app.stageUpdates });
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_invalid");
    assert.equal(app.providerCalls(), 1);
    assert.equal(JSON.stringify({ ledger: app.insertedUsage, settlements: app.stageUpdates }), before);
  });
}

test("fresh legacy explicit non-default tiers are unpriced, but absent/default metadata preserves standard pricing", async () => {
  for (const options of [{}, { actualTier: "default" }] as HarnessOptions[]) {
    const app = harness("normal", options);
    await app.run(); assert.equal(app.insertedUsage[0].costMicrousd, 21_382);
    assert.equal(app.insertedUsage[0].pricingStatus, "priced");
  }
  for (const actualTier of ["priority", "unknown-tier", null]) {
    const app = harness("normal", { actualTier });
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_model_unpriced");
    assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage[0].costMicrousd, null);
    assert.equal(app.insertedUsage[0].pricingStatus, "unpriced"); assert.equal(app.stageUpdates[0].output, null);
  }
});

test("Fast refusal records actual priority charges before surfacing the validation failure", async () => {
  const app = harness("normal", { providerPolicy: fastPolicy, actualTier: "priority", transport: "refusal" });
  await assert.rejects(app.run(), error => error === app.providerFailure);
  assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 1);
  assert.equal(app.insertedUsage[0].costMicrousd, 22_764); assert.equal(app.insertedUsage[0].pricingStatus, "priced");
  assert.equal(app.stageUpdates[0].status, "failed"); assert.equal(app.stageUpdates[0].output, null);
  assert.deepEqual(plain(app.stageUpdates[0].usage), app.response.usage);
  await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_invalid");
  assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 1);
});

test("Fast settlement rechecks changed parent policy only after retaining the incurred charge", async () => {
  for (const parentPolicyAfterCall of [null, { ...fastPolicy, requestedServiceTier: "default" }]) {
    const app = harness("normal", { providerPolicy: fastPolicy, actualTier: "priority", parentPolicyAfterCall });
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_invalid");
    assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 1);
    assert.equal(app.insertedUsage[0].costMicrousd, 22_764); assert.equal(app.insertedUsage[0].pricingStatus, "priced");
    assert.equal(app.stageUpdates[0].status, "failed"); assert.equal(app.stageUpdates[0].output, null);
    assert.deepEqual(plain(app.stageUpdates[0].usage), app.response.usage);
    const before = JSON.stringify({ ledger: app.insertedUsage, settlements: app.stageUpdates });
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_snapshot_mismatch");
    assert.equal(app.providerCalls(), 1);
    assert.equal(JSON.stringify({ ledger: app.insertedUsage, settlements: app.stageUpdates }), before);
  }
});

test("Fast unknown transport stays uncertain with its existing reservation and cannot call again", async () => {
  const app = harness("normal", { providerPolicy: fastPolicy, transport: "unknown" });
  const before = JSON.stringify(app.requestRow);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(app.run(), (error: unknown) => error instanceof HttpError && error.code === "provider_uncertain");
  }
  assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 0);
  assert.equal(app.stageUpdates.length, 1); assert.equal(app.stageUpdates[0].status, "uncertain");
  assert.equal(JSON.stringify(app.requestRow), before);
  assert.equal(app.projectionReads(), 0, "no invented response usage can settle the unresolved provider call");
});

for (const tier of ["priority", "default", "unknown-tier", null, undefined] as const) {
  test(`late ${String(tier)} response appends observed usage without changing the uncertain stage or retrying`, async () => {
    const app = harness("normal", { providerPolicy: fastPolicy, ...(tier === undefined ? {} : { actualTier: tier }),
      stageAfterCall: { status: "uncertain" } });
    const priced = tier === "priority" || tier === "default";
    await assert.rejects(app.run(), error => error instanceof HttpError &&
      error.code === (priced ? "provider_invalid" : "provider_model_unpriced"));
    assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 1);
    assert.equal(app.insertedUsage[0].costMicrousd, tier === "priority" ? 22_764 : tier === "default" ? 21_382 : null);
    assert.equal(app.insertedUsage[0].pricingStatus, priced ? "priced" : "unpriced");
    assert.deepEqual(plain(app.insertedUsage[0].observedUsage), app.response.usage);
    assert.deepEqual(app.stage(), app.stageAtResponse(), "the complete uncertain row, including lease and null metadata, is immutable");
    assert.equal(app.stage()!.usage, null); assert.equal(app.stage()!.output, null);
    assert.equal(app.stage()!.providerResponseId, null); assert.equal(app.stageUpdates.length, 0);
    const before = JSON.stringify({ stage: app.stage(), usage: app.insertedUsage, request: app.requestRow });
    await assert.rejects(app.run(), error => error instanceof HttpError && error.code === "provider_uncertain");
    assert.equal(app.providerCalls(), 1);
    assert.equal(JSON.stringify({ stage: app.stage(), usage: app.insertedUsage, request: app.requestRow }), before);
  });
}

test("late refusal appends its actual charge and observed tier while retaining the immutable uncertain stage", async () => {
  const app = harness("normal", { providerPolicy: fastPolicy, actualTier: "priority", transport: "refusal",
    stageAfterCall: { status: "uncertain" }, extraUsageFields: true });
  await assert.rejects(app.run(), error => error === app.providerFailure);
  assert.equal(app.insertedUsage.length, 1); assert.equal(app.insertedUsage[0].costMicrousd, 22_764);
  assert.deepEqual(plain(app.insertedUsage[0].observedUsage), { ...observedUsage(2), serviceTier: "priority" },
    "the receipt whitelists accounting fields rather than persisting prompt, output or arbitrary provider metadata");
  assert.deepEqual(app.stage(), app.stageAtResponse()); assert.equal(app.stageUpdates.length, 0);
  await assert.rejects(app.run(), error => error instanceof HttpError && error.code === "provider_uncertain");
  assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 1);
});

test("late settlement cannot overwrite terminal or foreign-lease stage metadata", async () => {
  for (const stageAfterCall of [
    { status: "uncertain", providerResponseId: "previous-response", usage: { serviceTier: "default" }, output: { retained: true } },
    { status: "succeeded", providerResponseId: "previous-response", usage: { serviceTier: "default" }, output: { retained: true } },
    { leaseExpiresAt: new Date(now.getTime() + 999_000) },
  ]) {
    const app = harness("normal", { providerPolicy: fastPolicy, actualTier: "priority", stageAfterCall });
    await assert.rejects(app.run(), error => error instanceof HttpError && error.code === "provider_invalid");
    assert.deepEqual(app.stage(), app.stageAtResponse()); assert.equal(app.stageUpdates.length, 0);
    assert.equal(app.insertedUsage[0].costMicrousd, 22_764);
    assert.deepEqual(plain(app.insertedUsage[0].observedUsage), app.response.usage);
  }
});

test("foreign fingerprint prevents attributing a late response to the wrong stage", async () => {
  const app = harness("normal", { providerPolicy: fastPolicy, actualTier: "priority",
    stageAfterCall: { status: "uncertain", requestFingerprint: "another-fingerprint" } });
  await assert.rejects(app.run(), error => error instanceof Error && error.name === "DemandUsagePersistenceError");
  assert.equal(app.providerCalls(), 1); assert.equal(app.insertedUsage.length, 0);
  assert.equal(app.stageUpdates.length, 0); assert.deepEqual(app.stage(), app.stageAtResponse());
});

test("duplicate late response never backfills or reprices an existing legacy or observed receipt", async () => {
  for (const existingReceipt of ["legacy", "observed"] as const) {
    const app = harness("normal", { providerPolicy: fastPolicy, actualTier: "priority", existingReceipt,
      stageAfterCall: { status: "uncertain" } });
    await assert.rejects(app.run(), error => error instanceof HttpError && error.code === "provider_invalid");
    assert.equal(app.insertedUsage.length, 0); assert.equal(app.existingUsage.length, 1);
    assert.equal(app.existingUsage[0].costMicrousd, 123);
    assert.deepEqual(plain(app.existingUsage[0].observedUsage), existingReceipt === "legacy" ? null
      : { ...app.response.usage, serviceTier: "default" });
    assert.deepEqual(app.stage(), app.stageAtResponse()); assert.equal(app.stageUpdates.length, 0);
    const before = JSON.stringify(app.existingUsage);
    await assert.rejects(app.run(), error => error instanceof HttpError && error.code === "provider_uncertain");
    assert.equal(app.providerCalls(), 1); assert.equal(JSON.stringify(app.existingUsage), before);
  }
});
