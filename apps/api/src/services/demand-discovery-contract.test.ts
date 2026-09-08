import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as database from "@edison/db";
import { createEmptyLoopPrincipleState } from "@edison/domain";
import { READER_FIRST_CHECKER_CONTRACT_VERSION, READER_FIRST_DISCOVERY_CONTRACT_VERSION, READER_FIRST_PROMPT_VERSION } from "@edison/ai";
import type { DemandPrincipal } from "../auth/verify-demand-principal";
import { demandDiscoveryContractCompatibilityFailure, demandDiscoveryOptions } from "./demand-discovery-contract";
import { demandFingerprint, type DemandLoopRow, type DemandRequestRow } from "./demand-reading";
import { demandCheckpoint, demandProgressCompatibilityFailure, initialDemandState } from "./demand-runner";
import { advanceReaderFirstPipeline, type ReaderFirstPipelineState } from "./reader-first-pipeline";

// Actual admission and pipeline code with synthetic storage/transport only.
// No database, provider or private incident content is accessed.
const PIN = READER_FIRST_DISCOVERY_CONTRACT_VERSION;
const ABSENT = Symbol("frozen legacy discovery");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = new Date("2026-09-08T18:00:00.000Z");
const owner = { id: id(1), accountUserId: id(2), guestTokenHash: null, expiresAt: null, revokedAt: null,
  createdAt: date, updatedAt: date } as DemandPrincipal;
const loop: DemandLoopRow = { id: id(3), principalId: owner.id, title: "Constructed measurement loop",
  originalCuriosity: "How do repeated measurements reveal a signal?", revision: 0, editorInstructions: null, archivedAt: null,
  principles: { ...createEmptyLoopPrincipleState({ loopId: id(3), originalCuriosity: "How do repeated measurements reveal a signal?" }) },
  createdAt: date, updatedAt: date };
const evidence = { sources: [], passages: [] };
const context = { loopId: loop.id, revision: 0, originalCuriosity: loop.originalCuriosity, directions: [], declaredKnowledge: [],
  readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-08" };
const brief = { id: id(4), key: "measurement", loopId: loop.id, loopRevision: 0,
  headline: "How do repeated measurements reveal a signal?", deck: "Compare a sample and reference.",
  readerQuestion: loop.originalCuriosity, payoff: "Distinguish a stable signal from a fluctuation.",
  advanceBeyondPrevious: "A first constructed explanation.", qualifications: [], passageIds: [] };
const idea = { ...brief, principalId: owner.id, brief, evidence, articleRequestId: null };
function row(kind: DemandRequestRow["kind"] = "article", marker: unknown = ABSENT, version = 2): DemandRequestRow {
  return { id: id(5), principalId: owner.id, loopId: loop.id, ideaId: idea.id, kind, status: "running", stage: "writing",
    idempotencyKey: "constructed-discovery-admission", requestFingerprint: "a".repeat(64),
    snapshot: { version, context, selection: { idea: brief, evidence },
      ...(marker === ABSENT ? {} : { discoveryContractVersion: marker }) },
    result: null, progress: null, failureCode: null, workflowRunId: "constructed-discovery-run", leaseExpiresAt: date,
    nextAttemptAt: date, attempts: 1, reservedMicrousd: 1_200_000, createdAt: date, updatedAt: date };
}

test("discovery pin survives exact JSON replay in every article phase without relabeling the global or checker contract", () => {
  for (const marker of [ABSENT, PIN]) for (const checker of [false, true]) {
    const request = row("article", marker);
    if (checker) request.snapshot.checkerContractVersion = READER_FIRST_CHECKER_CONTRACT_VERSION;
    const before = JSON.stringify(request);
    const initial = initialDemandState(request);
    assert.equal(initial.promptVersion, READER_FIRST_PROMPT_VERSION);
    assert.equal(initial.promptVersion, "edison-reader-first-v2.5");
    assert.equal(Object.hasOwn(initial, "discoveryContractVersion"), marker !== ABSENT);
    assert.equal(Object.hasOwn(initial, "checkerContractVersion"), checker);
    for (const phase of ["write", "retrieve", "check", "repair", "recheck", "ready", "failed"]) {
      const saved = { ...initial, phase, repairAttempted: phase === "recheck" };
      const parsed = JSON.parse(JSON.stringify(saved)) as typeof saved;
      assert.equal(demandProgressCompatibilityFailure(request, parsed), null);
      assert.equal(demandCheckpoint(parsed), demandCheckpoint(saved));
      assert.deepEqual(demandDiscoveryOptions(request, parsed), marker === ABSENT ? {} : { discoveryContractVersion: PIN });
    }
    assert.equal(JSON.stringify(request), before, "no saved request upgrade");
  }
});

test("absence preserves all supported legacy kinds; explicit invalid or ineligible discovery selectors fail closed", () => {
  for (const kind of ["ideas", "article", "question", "feedback"] as const) for (const version of [1, 2]) {
    const request = row(kind, ABSENT, version), state = initialDemandState(request);
    assert.equal(demandDiscoveryContractCompatibilityFailure(request, state), null);
    assert.deepEqual(demandDiscoveryOptions(request, state), {});
  }
  for (const marker of [undefined, null, "", "edison-reader-first-v2.5-discovery-v999", {}, [], true, 1]) {
    const request = row(); request.snapshot.discoveryContractVersion = marker;
    const state = initialDemandState(request);
    assert.equal(Object.hasOwn(state, "discoveryContractVersion"), true);
    assert.equal(demandProgressCompatibilityFailure(request, state), "pipeline_version_unsupported");
    assert.throws(() => demandDiscoveryOptions(request, state), { code: "pipeline_version_unsupported" });
  }
  for (const [kind, version] of [["ideas", 2], ["question", 2], ["feedback", 2], ["article", 1], ["article", 3]] as const) {
    const request = row(kind, PIN, version);
    assert.equal(demandDiscoveryContractCompatibilityFailure(request, initialDemandState(request)), "pipeline_version_unsupported");
  }
});

test("adding, removing or replacing either persisted selector is rejected even after recomputing the snapshot hash", () => {
  for (const marker of [ABSENT, PIN]) for (const phase of ["write", "retrieve", "repair", "check", "ready", "failed"]) {
    const original = row("article", marker);
    const mutations = [
      (request: DemandRequestRow) => { request.snapshot.discoveryContractVersion = marker === ABSENT ? PIN : "unknown"; },
      (request: DemandRequestRow) => { delete request.snapshot.discoveryContractVersion; },
      (_request: DemandRequestRow, state: ReaderFirstPipelineState) => { state.discoveryContractVersion = marker === ABSENT ? PIN : null; },
      (_request: DemandRequestRow, state: ReaderFirstPipelineState) => { delete state.discoveryContractVersion; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      if (marker === ABSENT && [1, 3].includes(index)) continue;
      const request = structuredClone(original), state = { ...initialDemandState(request), phase } as ReaderFirstPipelineState;
      mutate(request, state); state.snapshotFingerprint = demandFingerprint(request.snapshot);
      const before = structuredClone({ request, state });
      assert.notEqual(demandProgressCompatibilityFailure(request, state), null);
      assert.deepEqual({ request, state }, before, "rejection never rewrites retained bytes");
    }
  }
});

test("actual pipeline rejects malformed, ineligible and mismatched pins before provider, acquisition or ready publication", async () => {
  for (const phase of ["write", "retrieve", "repair", "check", "ready", "failed"]) {
    const cases = [row("article", null), row("question", PIN), row("ideas", PIN), row("article", PIN)];
    for (const [index, request] of cases.entries()) {
      const state = { ...initialDemandState(request), phase } as ReaderFirstPipelineState;
      if (index === 3) delete state.discoveryContractVersion;
      const before = structuredClone({ request, state }); let calls = 0;
      const result = await advanceReaderFirstPipeline({ request, state }, {
        provider: async () => { calls++; throw new Error("Unexpected provider call"); },
        retrievePage: async () => { calls++; throw new Error("Unexpected retrieval"); },
      });
      assert.equal(calls, 0); assert.equal(result.outcome, undefined); assert.equal(result.state.phase, "failed");
      assert.equal(result.failureCode, index === 3 ? "pipeline_state_invalid" : "pipeline_version_unsupported");
      assert.deepEqual({ request, state }, before);
    }
  }
});

const require = createRequire(import.meta.url);
function admissionHarness(queries: Array<{ table: unknown; rows: unknown[] }>) {
  const inserts: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const events: string[] = []; let selections = 0;
  const tx = {
    select() {
      const next = queries[selections++]; assert.ok(next, "only the expected bounded storage reads execute");
      const query = { from(table: unknown) { assert.equal(table, next.table); events.push("read"); return query; },
        where() { return query; }, for() { return query; }, orderBy() { return query; }, limit() { return Promise.resolve(next.rows); },
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(next.rows).then(resolve, reject); } };
      return query;
    },
    execute: async () => [],
    insert(table: unknown) { return { values(value: Record<string, unknown>) {
      events.push("insert"); inserts.push({ table, value });
      return { returning: async () => [table === database.demandLoops ? { revision: 0, archivedAt: null, ...value } : { id: id(99), ...value }] };
    } }; },
    update() { events.push("update"); return { set() { return { where: async () => [] }; } }; },
  };
  const exports = {};
  new Script(ts.transpileModule(readFileSync(new URL("./demand-reading.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText).runInNewContext({ exports, Buffer, Date, JSON, Set, Object, Error, process,
    require(name: string) {
      if (name === "@edison/db") return { ...database, withDemandWorkerDb: async (operation: (db: typeof tx) => unknown) => operation(tx) };
      if (name === "./demand-admission") return { lockDemandAdmission: async () => { events.push("lock"); },
        assertDemandAdmissionCapacity: async () => { events.push("capacity"); } };
      if (name === "./demand-allowance") return { prepareDemandAllowance: async () => ({ requestedCount: 6 }), allocateDemandAllowance: async () => {} };
      if (name === "./demand-result-compatibility") return { demandQuestionMaterial: () => ({ context, evidence, articleVersion: id(8), storedDraft: {} }) };
      if (name === "./demand-question-history") return { demandQuestionHistory: () => ({ evidence, previousMessages: [] }) };
      return require(name);
    },
  });
  return { service: exports as typeof import("./demand-reading"), inserts, events, get selections() { return selections; } };
}

for (const kind of ["create", "ideas", "article", "question", "feedback"] as const) {
  test(`fresh ${kind} admission pins discovery only for articles and leaves existing reservation policy intact`, async () => {
    const queries: Array<{ table: unknown; rows: unknown[] }> = [{ table: database.demandRequests, rows: [] }];
    if (kind === "article" || kind === "question") queries.push({ table: database.demandIdeas,
      rows: [{ ...idea, articleRequestId: kind === "question" ? id(8) : null }] });
    if (kind === "question") queries.push({ table: database.demandRequests, rows: [{ ...row(), id: id(8), status: "succeeded", result: { draft: {} } }] });
    if (kind !== "create") queries.push({ table: database.demandLoops, rows: [loop] });
    if (kind === "ideas") queries.push({ table: database.demandRequests, rows: [] });
    queries.push({ table: database.demandEvents, rows: [] });
    if (kind === "question") queries.push({ table: database.demandRequests, rows: [] });
    queries.push({ table: database.demandRequests, rows: [] });
    const harness = admissionHarness(queries), key = { idempotencyKey: `constructed-new-${kind}` };
    const result = kind === "create" ? await harness.service.createDemandLoop(owner, { ...key, curiosity: loop.originalCuriosity })
      : kind === "ideas" ? await harness.service.requestDemandIdeas(owner, loop.id, { ...key, baseRevision: 0 })
      : kind === "article" ? await harness.service.requestDemandArticle(owner, idea.id, key)
      : kind === "question" ? await harness.service.requestDemandQuestion(owner, idea.id, { ...key, question: "What makes a stable signal?" })
      : await harness.service.requestDemandFeedback(owner, loop.id, { ...key, operation: "apply", text: "Prefer simple examples.", baseRevision: 0 });
    assert.equal(harness.selections, queries.length); assert.equal(harness.events[0], "lock");
    assert.equal(Object.hasOwn(result.snapshot, "discoveryContractVersion"), kind === "article");
    if (kind === "article") assert.equal(result.snapshot.discoveryContractVersion, PIN);
    assert.equal(Object.hasOwn(result.snapshot, "checkerContractVersion"), ["article", "question"].includes(kind));
    assert.equal(result.reservedMicrousd, { create: 600_000, ideas: 600_000, article: 1_200_000, question: 250_000, feedback: 100_000 }[kind]);
    assert.equal(harness.inserts.filter((entry) => entry.table === database.demandRequests).length, 1);
    const requestInsert = harness.events.lastIndexOf("insert");
    assert.ok(harness.events.indexOf("capacity") < requestInsert, "existing capacity guard remains ahead of request creation");
  });
}

test("idempotency and canonical article replay preserve failed legacy and selected rows without new reservation or upgrade", async () => {
  for (const marker of [ABSENT, PIN]) for (const canonical of [false, true]) {
    const input = { idempotencyKey: "constructed-replayed-article" };
    const saved = row("article", marker); saved.status = "failed"; saved.failureCode = "provider_invalid";
    saved.requestFingerprint = demandFingerprint({ intent: "article", ideaId: idea.id, ...input });
    saved.progress = { retainedRawResponse: "constructed historical bytes", repairAttempted: true };
    const before = structuredClone(saved);
    const queries = canonical ? [
      { table: database.demandRequests, rows: [] }, { table: database.demandIdeas, rows: [{ ...idea, articleRequestId: saved.id }] },
      { table: database.demandRequests, rows: [saved] },
    ] : [{ table: database.demandRequests, rows: [saved] }];
    const harness = admissionHarness(queries);
    const result = await harness.service.requestDemandArticle(owner, idea.id, input);
    assert.equal(result, saved); assert.deepEqual(saved, before); assert.equal(harness.selections, queries.length);
    assert.deepEqual(harness.inserts, []); assert.equal(harness.events.includes("capacity"), false); assert.equal(harness.events.includes("update"), false);
  }
});
