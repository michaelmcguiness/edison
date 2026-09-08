import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as database from "@edison/db";
import { createEmptyLoopPrincipleState } from "@edison/domain";
import { READER_FIRST_CHECKER_CONTRACT_VERSION, type DemandProviderPolicy, type OnDemandContext, type OnDemandProviderRequest, type ReaderFirstWriterOutput } from "@edison/ai";
import * as policy from "./demand-provider-policy";
import { demandFingerprint, type DemandLoopRow, type DemandRequestRow } from "./demand-reading";
import { demandCheckpoint, demandProgressCompatibilityFailure, initialDemandState } from "./demand-runner";
import { advanceReaderFirstPipeline, type ReaderFirstPipelineState } from "./reader-first-pipeline";
import type { DemandPrincipal } from "../auth/verify-demand-principal";
import { demandReservationMicrousd } from "./demand-configuration";

const require = createRequire(import.meta.url);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ABSENT = Symbol("absent legacy policy");
const fast: DemandProviderPolicy = { version: "edison-demand-provider-policy-v1", requestedServiceTier: "priority", pricingVersion: "openai-terra-luna-2026-09-08-v1" };
const context: OnDemandContext = { loopId: id(1), revision: 1, originalCuriosity: "How does a thermostat work?", directions: [], declaredKnowledge: [],
  readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-08" };
const evidence = { sources: [], passages: [] };
const idea = { id: id(2), key: "thermostat", loopId: id(1), loopRevision: 1, headline: "How does a thermostat control heat?", deck: "Follow a feedback example.",
  readerQuestion: "What is compared?", payoff: "Distinguish a reading from its target.", advanceBeyondPrevious: "A first explanation.", qualifications: [], passageIds: [] };
const draft: ReaderFirstWriterOutput = { status: "written", reason: null, research: evidence, article: {
  category: "tech-science", kicker: "Feedback", topic: "Thermostats", title: idea.headline, deck: idea.deck,
  summary: ["Read a temperature.", "Compare it with a target.", "Adjust the heat."], whyWritten: "An everyday example explains feedback.", readingMinutes: 1,
  body: [{ type: "paragraph", text: "A thermostat compares a temperature reading with a target.", citations: [] }], sources: [],
} };
function row(kind: DemandRequestRow["kind"], pin: unknown = ABSENT, version = 2): DemandRequestRow {
  const now = new Date("2026-09-08T00:00:00.000Z");
  return { id: id(3), principalId: id(4), loopId: id(1), ideaId: kind === "ideas" ? null : id(2), kind, status: "queued", stage: "queued",
    idempotencyKey: "policy-admission", requestFingerprint: "a".repeat(64), snapshot: { version, context,
      ...(pin === ABSENT ? {} : { providerPolicy: pin }),
      ...(kind === "article" || kind === "question" ? { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION } : {}),
      ...(kind === "article" ? { selection: { idea, evidence } } : {}),
      ...(kind === "question" ? { question: { articleVersion: id(8), question: "What does it compare?", draft, evidence, previousMessages: [] } } : {}),
    }, progress: null, result: null, failureCode: null, workflowRunId: null, leaseExpiresAt: null, nextAttemptAt: now, attempts: 0,
    reservedMicrousd: demandReservationMicrousd[kind], createdAt: now, updatedAt: now };
}
function flag(value: string | undefined) {
  const previous = process.env.EDISON_DEMAND_FAST_ENABLED;
  if (value === undefined) delete process.env.EDISON_DEMAND_FAST_ENABLED; else process.env.EDISON_DEMAND_FAST_ENABLED = value;
  return () => { if (previous === undefined) delete process.env.EDISON_DEMAND_FAST_ENABLED; else process.env.EDISON_DEMAND_FAST_ENABLED = previous; };
}
const phases = ["ideas", "ideas_check", "write", "check", "repair", "recheck", "answer", "answer_check", "answer_repair", "answer_recheck", "retrieve", "ready", "failed"];

test("Fast admission is exact opt-in, server-only and eligible v2 work only", () => {
  for (const value of [undefined, "false", "TRUE", "1", "true"]) {
    const restore = flag(value);
    try {
      for (const kind of ["ideas", "article", "question", "feedback"] as const) for (const version of [1, 2, 3]) {
        const snapshot = { version, literal: "Retain my exact context. " }; const before = structuredClone(snapshot);
        const selected = policy.admissionDemandProviderPolicy(kind, snapshot);
        assert.deepEqual(selected, value === "true" && version === 2 && kind !== "feedback" ? { providerPolicy: fast } : {});
        assert.deepEqual(snapshot, before);
      }
    } finally { restore(); }
  }
});

test("pinned default/priority and legacy absence survive every checkpoint and environment flip without changing saved snapshots", () => {
  for (const kind of ["ideas", "article", "question"] as const) for (const pin of [ABSENT, fast, { ...fast, requestedServiceTier: "default" }]) {
    const request = row(kind, pin); const before = structuredClone(request.snapshot); const initial = initialDemandState(request);
    assert.equal(Object.hasOwn(initial, "providerPolicy"), pin !== ABSENT);
    if (pin !== ABSENT) assert.notEqual(initial.providerPolicy, request.snapshot.providerPolicy, "progress does not alias mutable snapshot objects");
    for (const phase of phases) for (const setting of ["true", "false"]) {
      const restore = flag(setting);
      try {
        const state = { ...structuredClone(initial), phase }; const checkpoint = demandCheckpoint(state);
        assert.equal(demandProgressCompatibilityFailure(request, state), null);
        assert.deepEqual(policy.demandProviderOptions(request, state), pin === ABSENT ? {} : { providerPolicy: pin });
        assert.equal(demandCheckpoint(state), checkpoint); assert.deepEqual(request.snapshot, before);
      } finally { restore(); }
    }
  }
});

test("own malformed policies, including undefined, cannot silently become legacy", () => {
  for (const pin of [undefined, null, {}, [], "priority", { ...fast, extra: true }, { ...fast, requestedServiceTier: "auto" },
    { ...fast, version: "future" }, { ...fast, pricingVersion: "future" }, { version: fast.version, requestedServiceTier: "priority" }]) {
    const request = row("article"); request.snapshot.providerPolicy = pin; const state = initialDemandState(request);
    assert.equal(Object.hasOwn(state, "providerPolicy"), true);
    assert.notEqual(demandProgressCompatibilityFailure(request, state), null);
    assert.throws(() => policy.demandProviderOptions(request, state));
  }
  for (const [kind, version] of [["feedback", 2], ["ideas", 1], ["article", 1], ["question", 1], ["article", 3]] as const) {
    const request = row(kind, fast, version); assert.notEqual(demandProgressCompatibilityFailure(request, initialDemandState(request)), null);
  }
});

test("adding, removing or changing either policy rejects replay even with a recomputed snapshot fingerprint", () => {
  for (const original of [ABSENT, fast]) for (const phase of phases) {
    for (const target of ["snapshot", "progress"] as const) for (const mutation of [ABSENT, null, { ...fast, requestedServiceTier: "default" }]) {
      const request = row("article", original); const state = { ...initialDemandState(request), phase } as ReturnType<typeof initialDemandState>;
      if (original === ABSENT && mutation === ABSENT) continue;
      const selected: Record<string, unknown> = target === "snapshot" ? request.snapshot : state;
      if (mutation === ABSENT) delete selected.providerPolicy; else selected.providerPolicy = mutation;
      state.snapshotFingerprint = demandFingerprint(request.snapshot);
      assert.notEqual(demandProgressCompatibilityFailure(request, state), null);
    }
  }
});

test("valid policies reach the real reader-first stage without changing its input, prompt, model or identities", async () => {
  for (const kind of ["ideas", "article", "question"] as const) {
    const calls: OnDemandProviderRequest[] = [];
    for (const pin of [ABSENT, fast]) {
      const request = row(kind, pin); const state = initialDemandState(request) as ReaderFirstPipelineState; const before = structuredClone(request.snapshot);
      const restore = flag(pin === ABSENT ? "true" : "false");
      try {
        await advanceReaderFirstPipeline({ request, state }, { provider: async (call) => { calls.push(call); throw new Error("Synthetic transport stops after capturing the request."); },
          retrievePage: async () => { throw new Error("Unexpected network boundary"); } });
      } finally { restore(); }
      assert.deepEqual(request.snapshot, before);
    }
    assert.equal(calls.length, 2);
    const { providerPolicy: absent, ...legacy } = calls[0]; const { providerPolicy: pinned, ...current } = calls[1];
    assert.equal(Object.hasOwn(calls[0], "providerPolicy"), false); assert.equal(absent, undefined); assert.deepEqual(pinned, fast);
    assert.deepEqual(current, legacy, "Fast does not alter the prompt, model, artifact or exact stage identity inputs");
  }
});

test("invalid policy stops at pipeline entry and ready replay before provider dispatch, retrieval or publication", async () => {
  for (const phase of ["ideas", "write", "answer", "retrieve", "ready"]) {
    const request = row(phase === "ideas" ? "ideas" : phase === "answer" ? "question" : "article", fast);
    const state = { ...initialDemandState(request), phase, providerPolicy: { ...fast, requestedServiceTier: "default" } } as ReaderFirstPipelineState;
    let calls = 0;
    const result = await advanceReaderFirstPipeline({ request, state }, { provider: async () => { calls++; throw new Error("Must not dispatch"); },
      retrievePage: async () => { calls++; throw new Error("Must not retrieve"); } });
    assert.equal(result.failureCode, "pipeline_state_invalid"); assert.equal(result.outcome, undefined); assert.equal(calls, 0);
  }
});

// Complete service module with scripted database I/O only. Real fingerprints,
// context assembly, policies, DTO types and replay branches remain in use.
function admissionHarness(queries: Array<{ table: unknown; rows: unknown[] }>) {
  const inserts: Array<{ table: unknown; value: Record<string, unknown> }> = []; let selections = 0; let policySelections = 0;
  const tx = {
    select() {
      const next = queries[selections++]; assert.ok(next, "Unexpected database read");
      const query = { from(table: unknown) { assert.equal(table, next.table); return query; }, where() { return query; }, for() { return query; }, orderBy() { return query; },
        limit() { return Promise.resolve(next.rows); }, then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(next.rows).then(resolve, reject); } };
      return query;
    },
    execute: async () => [],
    insert(table: unknown) { return { values(value: Record<string, unknown>) { inserts.push({ table, value }); return {
      returning: async () => [table === database.demandLoops ? { revision: 0, archivedAt: null, ...value } : { id: id(99), ...value }],
    }; } }; },
    update() { return { set() { return { where: async () => [] }; } }; },
  };
  const exports: Record<string, unknown> = {};
  const file = new URL("./demand-reading.ts", import.meta.url);
  new Script(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)
    .runInNewContext({ exports, Buffer, Date, JSON, Set, Object, Error, process, require(name: string) {
      if (name === "@edison/db") return { ...database, withDemandWorkerDb: async (operation: (connection: typeof tx) => Promise<unknown>) => operation(tx) };
      if (name === "./demand-provider-policy") return { ...policy, admissionDemandProviderPolicy: (...args: Parameters<typeof policy.admissionDemandProviderPolicy>) => { policySelections++; return policy.admissionDemandProviderPolicy(...args); } };
      if (name === "./demand-admission") return { lockDemandAdmission: async () => {}, assertDemandAdmissionCapacity: async () => {} };
      if (name === "./demand-allowance") return { prepareDemandAllowance: async () => ({ requestedCount: 6 }), allocateDemandAllowance: async () => {} };
      if (name === "./demand-result-compatibility") return { demandQuestionMaterial: () => ({ context, evidence, articleVersion: id(8), storedDraft: draft }) };
      if (name === "./demand-question-history") return { demandQuestionHistory: () => ({ evidence, previousMessages: [] }) };
      return require(name);
    } });
  return { service: exports as unknown as typeof import("./demand-reading"), inserts, get selections() { return selections; }, get policySelections() { return policySelections; } };
}
const owner = { id: id(4), accountUserId: id(5), guestTokenHash: null, createdAt: new Date(), expiresAt: null, revokedAt: null } as DemandPrincipal;
const loop: DemandLoopRow = { id: id(1), principalId: id(4), revision: 0, originalCuriosity: context.originalCuriosity, title: "Thermostats", archivedAt: null, editorInstructions: null,
  principles: { ...createEmptyLoopPrincipleState({ loopId: id(1), originalCuriosity: context.originalCuriosity }) }, createdAt: new Date(), updatedAt: new Date() };

test("all fresh admission paths pin only when enabled and retain ordinary kind holds", async () => {
  for (const setting of [undefined, "true"]) for (const kind of ["create", "ideas", "article", "question", "feedback"] as const) {
    const restore = flag(setting);
    try {
      const queries: Array<{ table: unknown; rows: unknown[] }> = [{ table: database.demandRequests, rows: [] }];
      if (kind === "article" || kind === "question") queries.push({ table: database.demandIdeas, rows: [{ ...idea, principalId: owner.id, articleRequestId: kind === "question" ? id(8) : null, brief: idea, evidence }] });
      if (kind === "question") queries.push({ table: database.demandRequests, rows: [{ ...row("article"), id: id(8), status: "succeeded", result: { draft } }] });
      if (kind !== "create") queries.push({ table: database.demandLoops, rows: [loop] });
      if (kind === "ideas") queries.push({ table: database.demandRequests, rows: [] });
      queries.push({ table: database.demandEvents, rows: [] });
      if (kind === "question") queries.push({ table: database.demandRequests, rows: [] });
      queries.push({ table: database.demandRequests, rows: [] });
      const h = admissionHarness(queries); const input = { idempotencyKey: `fresh-${kind}` };
      const result = kind === "create" ? await h.service.createDemandLoop(owner, { ...input, curiosity: context.originalCuriosity })
        : kind === "ideas" ? await h.service.requestDemandIdeas(owner, loop.id, { ...input, baseRevision: 0 })
          : kind === "article" ? await h.service.requestDemandArticle(owner, idea.id, input)
            : kind === "question" ? await h.service.requestDemandQuestion(owner, idea.id, { ...input, question: "What does it compare?" })
              : await h.service.requestDemandFeedback(owner, loop.id, { ...input, operation: "apply", text: "Keep examples concise.", baseRevision: 0 });
      assert.equal(h.selections, queries.length); assert.equal(h.policySelections, 1);
      assert.equal(result.snapshot.version, kind === "feedback" ? 1 : 2);
      assert.equal(Object.hasOwn(result.snapshot, "providerPolicy"), setting === "true" && kind !== "feedback");
      if (setting === "true" && kind !== "feedback") assert.deepEqual(result.snapshot.providerPolicy, fast);
      assert.equal(result.reservedMicrousd, demandReservationMicrousd[kind === "create" ? "ideas" : kind]);
      assert.equal(h.inserts.filter(({ table }) => table === database.demandRequests).length, 1);
    } finally { restore(); }
  }
});

test("idempotency replay and canonical article recovery never consult the current flag or rewrite saved policy", async () => {
  for (const kind of ["create", "ideas", "article", "question", "feedback"] as const) for (const pin of [ABSENT, fast]) {
    const input = { idempotencyKey: `replay-${kind}` }; const request = row(kind === "create" ? "ideas" : kind, pin);
    request.requestFingerprint = demandFingerprint(kind === "create" ? { intent: "create-loop", ...input, curiosity: context.originalCuriosity }
      : kind === "ideas" ? { intent: "ideas", loopId: loop.id, ...input, baseRevision: 0 }
        : kind === "article" ? { intent: "article", ideaId: idea.id, ...input }
          : kind === "question" ? { intent: "question", ideaId: idea.id, ...input, question: "What does it compare?" }
            : { intent: "feedback", loopId: loop.id, ...input, operation: "apply", text: "Keep examples concise.", baseRevision: 0 });
    const h = admissionHarness([{ table: database.demandRequests, rows: [request] }]); const before = structuredClone(request);
    const restore = flag(pin === ABSENT ? "true" : "false");
    try {
      const result = kind === "create" ? await h.service.createDemandLoop(owner, { ...input, curiosity: context.originalCuriosity })
        : kind === "ideas" ? await h.service.requestDemandIdeas(owner, loop.id, { ...input, baseRevision: 0 })
          : kind === "article" ? await h.service.requestDemandArticle(owner, idea.id, input)
            : kind === "question" ? await h.service.requestDemandQuestion(owner, idea.id, { ...input, question: "What does it compare?" })
              : await h.service.requestDemandFeedback(owner, loop.id, { ...input, operation: "apply", text: "Keep examples concise.", baseRevision: 0 });
      assert.equal(result, request); assert.deepEqual(request, before); assert.equal(h.policySelections, 0); assert.equal(h.inserts.length, 0);
      if (kind === "article") {
        const canonical = admissionHarness([{ table: database.demandRequests, rows: [] }, { table: database.demandIdeas, rows: [{ ...idea, articleRequestId: request.id }] }, { table: database.demandRequests, rows: [request] }]);
        assert.equal(await canonical.service.requestDemandArticle(owner, idea.id, { idempotencyKey: "different-key" }), request);
        assert.equal(canonical.policySelections, 0); assert.equal(canonical.inserts.length, 0);
      }
    } finally { restore(); }
  }
});
