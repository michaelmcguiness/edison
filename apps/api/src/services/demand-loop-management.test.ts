import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import { demandLoops, demandPrincipals, type DemandTransaction } from "@edison/db";
import { createEmptyLoopPrincipleState, reduceLoopPrinciples } from "@edison/domain";
import { editDemandLoopSchema, archiveDemandLoopSchema, type EditDemandLoop } from "@edison/contracts";
import { HttpError } from "../http/errors";
import {
  conciseDemandLoopName, effectiveDemandLoopInstructions, contextDemandLoopCuriosity, managedDemandLoopDto,
  manageDemandLoopInTransaction, transitionDemandLoop, type DemandLoopEditReceipt,
} from "./demand-loop-management";

const principalId = "20000000-0000-4000-8000-000000000001";
const loopId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-07T13:00:00.000Z");
const originalCuriosity = "Help me understand how a light sensor converts a signal into a measurement.";
const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;

function loop() {
  const state = reduceLoopPrinciples({ state: createEmptyLoopPrincipleState({ loopId, originalCuriosity }), request: {
    type: "apply", loopId, mutationId: "20000000-0000-4000-8000-000000000003", idempotencyKey: "feedback-original",
    expectedRevision: 0, interpretationVersion: "constructed-test.v1",
    evidence: { source: "reader-feedback", sourceId: "feedback-original", exactText: "I know basic circuits. Use examples." },
    operations: [
      { op: "add", principle: { id: "20000000-0000-4000-8000-000000000004", kind: "knowledge", instruction: "I know basic circuits." } },
      { op: "add", principle: { id: "20000000-0000-4000-8000-000000000005", kind: "preference", instruction: "Use examples." } },
    ],
  } }).state;
  return { id: loopId, principalId, title: "Light sensors", originalCuriosity, editorInstructions: null,
    archivedAt: null, revision: 1, principles: { ...state }, createdAt: now, updatedAt: now };
}
const edit = (value: Partial<EditDemandLoop> = {}) => ({
  kind: "edit" as const, input: editDemandLoopSchema.parse({ name: "Light sensors", instructions: originalCuriosity,
    baseRevision: 1, idempotencyKey: "editor-save-1", ...value }),
});

test("names are bounded literal display text; original learning text is not shortened", () => {
  assert.equal(conciseDemandLoopName("  Light   sensors  "), "Light sensors");
  const curiosity = "Help me understand the underlying mechanisms and practical limitations of sensors, including examples for a beginner.";
  const title = conciseDemandLoopName(curiosity);
  assert.ok(title.length <= 48);
  assert.equal(title, "Help me understand the underlying mechanisms");
  assert.equal(conciseDemandLoopName("x".repeat(100)), "x".repeat(48));
  const hospitality = "Luxury Hospitality. Help me stay on top of the latest trends in hospitality and learn how luxury hotels are operated.";
  assert.equal(conciseDemandLoopName(hospitality), "Luxury Hospitality");
  assert.equal(conciseDemandLoopName("Sensor mechanisms\nExplain how measurements work."), "Sensor mechanisms");
  assert.equal(hospitality, "Luxury Hospitality. Help me stay on top of the latest trends in hospitality and learn how luxury hotels are operated.");
  const before = loop();
  const after = transitionDemandLoop(before, edit({ name: "<b>Biology</b>" }), now);
  assert.equal(managedDemandLoopDto(after).title, "<b>Biology</b>");
  assert.equal(after.originalCuriosity, before.originalCuriosity);
  assert.throws(() => edit({ name: " " }));
  assert.throws(() => edit({ instructions: "x".repeat(501) }));
  assert.throws(() => edit({ instructions: "bad\u0000input" }));
  assert.throws(() => transitionDemandLoop(before, edit({ name: "x".repeat(81) }), now), code("loop_name_too_long"));
  const historical = { ...before, title: "x".repeat(120) };
  assert.equal(transitionDemandLoop(historical, edit({ name: historical.title, instructions: "Use short examples." }), now).title, historical.title);
});

test("short topics and longer topic prefixes preserve initialisms and decimal versions", () => {
  for (const topic of ["U.S. politics", "GPT-5.6", "A.I. research", "3.14 and pi", "Dr. Jane's research"]) {
    assert.equal(conciseDemandLoopName(`  ${topic}  `), topic);
  }
  for (const topic of ["U.S. politics", "U. S. politics", "GPT-5.6", "A.I. research", "3.14 and pi", "Dr. Jane's research", "dr. Jane's research"]) {
    const instructions = `${topic}. Explain the important mechanisms with examples and their practical limitations.`;
    assert.equal(conciseDemandLoopName(instructions), topic);
  }
  assert.equal(conciseDemandLoopName("  U.S.   politics  "), "U.S. politics");
});

test("instruction replacement is literal, clears superseded typed instructions, and never rewrites history", () => {
  const before = loop();
  const original = structuredClone(before);
  const text = "Explain measurement errors.\nI prefer concise practical examples.";
  const after = transitionDemandLoop(before, edit({ name: "Measurements", instructions: text }), now);
  assert.equal(after.revision, 2);
  assert.equal(after.editorInstructions, text);
  assert.equal(effectiveDemandLoopInstructions(after), text);
  assert.equal(after.originalCuriosity, originalCuriosity);
  assert.deepEqual(after.principles.principles, []);
  assert.equal(after.principles.lastMutation, null);
  assert.deepEqual(before, original);
  assert.equal(managedDemandLoopDto(before).principles[0].kind, "knowledge");
  assert.equal(managedDemandLoopDto(after).canUndo, false);
});

test("removal stays explicitly empty; it does not resurrect the original request", () => {
  const after = transitionDemandLoop(loop(), edit({ instructions: "" }), now);
  assert.equal(after.editorInstructions, "");
  assert.equal(effectiveDemandLoopInstructions(after), "");
  assert.equal(managedDemandLoopDto(after).instructions, "");
  assert.equal(contextDemandLoopCuriosity(after), "Light sensors");
  assert.equal(contextDemandLoopCuriosity({ ...after, editorInstructions: " \n " }), "Light sensors");
  assert.equal(contextDemandLoopCuriosity(loop()), originalCuriosity);
  assert.equal(after.originalCuriosity, originalCuriosity);
  assert.deepEqual(managedDemandLoopDto(after).principles, []);
});

test("name-only save preserves categorized instructions; no-op preserves revision and undo", () => {
  const before = loop();
  assert.equal(transitionDemandLoop(before, edit(), now), before);
  assert.equal(managedDemandLoopDto(before).canUndo, true);
  const after = transitionDemandLoop(before, edit({ name: "Sensor mechanisms" }), now);
  assert.deepEqual(after.principles.principles, before.principles.principles);
  assert.equal(after.editorInstructions, null);
  assert.equal(after.revision, 2);
  assert.equal(after.principles.lastMutation, null);
  assert.equal(before.principles.lastMutation?.appliedRevision, 1);
});

test("confirmed archive preserves revision, prior reading identity and in-flight generation context", () => {
  const before = loop();
  const original = structuredClone(before);
  const pending = { loopId, context: { revision: before.revision, originalCuriosity: before.originalCuriosity }, requestId: "unchanged" };
  assert.throws(() => archiveDemandLoopSchema.parse({ confirmed: false, baseRevision: 1, idempotencyKey: "delete-loop-1" }));
  const after = transitionDemandLoop(before, { kind: "archive", input: { confirmed: true, baseRevision: 1, idempotencyKey: "delete-loop-1" } }, now);
  assert.equal(after.archivedAt, now);
  assert.equal(after.id, pending.loopId);
  assert.equal(after.revision, pending.context.revision);
  assert.deepEqual(after.principles, before.principles);
  assert.deepEqual(before, original);
  assert.equal(managedDemandLoopDto(after).archivedAt, now.toISOString());
  assert.throws(() => transitionDemandLoop(after, edit(), now), code("loop_archived"));
  assert.throws(() => transitionDemandLoop(before, edit({ baseRevision: 0 }), now), code("loop_changed"));
});

function transactionHarness() {
  let current = loop();
  let principal: { revokedAt: Date | null; expiresAt: Date | null } | undefined = { revokedAt: null, expiresAt: null };
  let active = true;
  let hasLoop = true;
  let updates = 0;
  const receipts: { id: string; request_fingerprint: string; receipt: DemandLoopEditReceipt; key: string }[] = [];
  const queries: { sql: string; params: unknown[] }[] = [];
  const locks: string[] = [];
  const dialect = new PgDialect();
  const tx = {
    select: () => ({ from: (table: unknown) => ({ where: () => ({ for: (mode: string) => ({ limit: async () => {
      assert.equal(mode, "update");
      locks.push(table === demandPrincipals ? "principal" : "loop");
      assert.ok(table === demandPrincipals || table === demandLoops);
      return table === demandPrincipals ? (principal ? [principal] : []) : hasLoop ? [current] : [];
    } }) }) }) }),
    update: (table: unknown) => ({ set: (values: Partial<typeof current>) => ({ where: () => ({ returning: async () => {
      assert.equal(table, demandLoops); updates++; current = { ...current, ...values }; return [current];
    } }) }) }),
    execute: async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement); queries.push(query);
      if (query.sql.includes("demand_principal_is_active")) return [{ active }];
      if (query.sql.startsWith("select id, request_fingerprint")) return receipts.filter((receipt) => receipt.key === query.params[1]);
      if (query.sql.startsWith("insert into private.demand_loop_edits")) {
        receipts.push({ id: String(query.params[0]), key: String(query.params[3]), request_fingerprint: String(query.params[4]), receipt: JSON.parse(String(query.params[6])) });
        return [];
      }
      throw new Error("unexpected SQL");
    },
  } as unknown as DemandTransaction;
  return { tx, receipts, queries, locks, current: () => current, updates: () => updates,
    revoke: () => { principal = { revokedAt: now, expiresAt: null }; },
    expire: () => { principal = { revokedAt: null, expiresAt: new Date(0) }; },
    inactive: () => { active = false; }, foreign: () => { hasLoop = false; }, missing: () => { principal = undefined; } };
}

test("atomic service receipt supports exact repeat after later edits and rejects key reuse", async () => {
  const h = transactionHarness();
  const original = structuredClone(h.current());
  const first = await manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ instructions: "Use sensor examples." }));
  assert.equal(h.updates(), 1);
  assert.deepEqual(h.locks, ["principal", "loop"]);
  assert.equal(h.receipts.length, 1);
  assert.deepEqual(h.receipts[0].receipt.before, JSON.parse(JSON.stringify(original)));
  assert.equal(h.receipts[0].receipt.after.editorInstructions, "Use sensor examples.");
  assert.equal(h.receipts[0].receipt.operation.kind, "edit");
  await manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ name: "Revised", instructions: "New direction.", baseRevision: 2, idempotencyKey: "editor-save-2" }));
  const replay = await manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ instructions: "Use sensor examples." }));
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(h.current().revision, 3);
  assert.equal(h.updates(), 2);
  assert.equal(h.receipts.length, 2);
  await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ instructions: "Different text." })), code("idempotency_key_reused"));
  await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, "20000000-0000-4000-8000-000000000099", edit({ instructions: "Use sensor examples." })), code("idempotency_key_reused"));
  assert.ok(h.queries.every((query) => query.params.includes(principalId)), "all raw worker SQL is explicitly principal-scoped");
});

test("foreign, revoked, expired and inactive-member readers cannot edit or replay receipts", async () => {
  for (const [method, expected] of [["foreign", "loop_not_found"], ["revoke", "reading_session_expired"], ["expire", "reading_session_expired"],
    ["inactive", "reading_session_required"], ["missing", "reading_session_required"]] as const) {
    const h = transactionHarness(); h[method]();
    await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, loopId, edit()), code(expected));
    assert.equal(h.updates(), 0); assert.equal(h.receipts.length, 0);
  }
  const h = transactionHarness();
  await manageDemandLoopInTransaction(h.tx, principalId, loopId, edit());
  h.inactive();
  await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, loopId, edit()), code("reading_session_required"));
  assert.equal(h.receipts.length, 1);
});

test("archive replay is stable and fresh edits remain blocked without any generated request", async () => {
  const h = transactionHarness();
  const operation = { kind: "archive" as const, input: { confirmed: true as const, baseRevision: 1, idempotencyKey: "delete-loop-1" } };
  const first = await manageDemandLoopInTransaction(h.tx, principalId, loopId, operation);
  const replay = await manageDemandLoopInTransaction(h.tx, principalId, loopId, operation);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(h.updates(), 1); assert.equal(h.current().revision, 1);
  await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, loopId, edit()), code("loop_archived"));
  assert.ok(h.queries.every((query) => !/demand_requests|demand_stages|demand_usage/.test(query.sql)));
});

test("stale editor saves cannot overwrite newer settings and malformed stored response ownership fails closed", async () => {
  const h = transactionHarness();
  await manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ instructions: "New direction." }));
  await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ name: "Stale name", idempotencyKey: "stale-save-1" })), code("loop_changed"));
  assert.equal(h.current().title, "Light sensors");
  assert.equal(h.current().editorInstructions, "New direction.");
  assert.equal(h.receipts.length, 1);
  h.receipts[0].receipt.result.workspaceId = "20000000-0000-4000-8000-000000000099";
  await assert.rejects(manageDemandLoopInTransaction(h.tx, principalId, loopId, edit({ instructions: "New direction." })), /demand_loop_receipt_invalid/);
});
