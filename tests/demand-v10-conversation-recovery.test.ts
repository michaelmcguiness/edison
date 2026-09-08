import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DemandAnswer, DemandRequest, DemandResult } from "@edison/contracts";
import { conversationRequestSettled, mergeConversationTurns, reconcileConversationRequests,
  type ReaderConversationTurn } from "../components/edison/demand-v10/article-conversation";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const ideaId = id(1);
const loopId = id(2);
const now = "2026-09-07T15:00:00.000Z";
const next = "2026-09-07T15:01:00.000Z";
const done = "2026-09-07T15:02:00.000Z";
const answer: DemandAnswer = { version: 2, body: [{ type: "paragraph", text: "A retained answer from the server.", citations: [] }],
  sources: [], basis: "general_knowledge", researchedAt: null };

function turn(number: number, status: DemandRequest["status"] = "succeeded", updatedAt = now): ReaderConversationTurn {
  return { question: `The actual question ${number}`, answer: status === "succeeded" ? answer : null,
    request: { id: id(number), ideaId, loopId, kind: "question", status,
      stage: status === "succeeded" ? "ready" : status === "failed" ? "failed" : status === "running" ? "answering" : "queued",
      createdAt: now, updatedAt, failure: status === "failed" ? { code: "provider_invalid", message: "Retained failure", retryable: true } : null } };
}
function result(saved: ReaderConversationTurn): DemandResult { return { request: saved.request, answer: saved.answer, article: null }; }
const scope = { ideaId, loopId };

test("an older failed turn resumes and completes outside the latest 60 without losing its actual question", async () => {
  const older = turn(100, "failed");
  const latest = Array.from({ length: 60 }, (_, index) => turn(200 + index));
  const resuming = { requestId: older.request.id, question: older.question };
  const reads: string[] = [];
  let saved = turn(100, "queued", next);
  let turns = await reconcileConversationRequests({ ...scope, turns: mergeConversationTurns([older], latest), attempt: null, resuming,
    getResult: async (requestId) => { reads.push(requestId); return result(saved); } });
  assert.equal(turns.length, 61);
  assert.equal(turns[0]!.request.status, "queued");
  assert.equal(conversationRequestSettled(turns, older.request.id), false);
  assert.equal(turns[0]!.question, older.question);

  saved = turn(100, "succeeded", done);
  turns = await reconcileConversationRequests({ ...scope, turns: mergeConversationTurns(turns, latest), attempt: null, resuming,
    getResult: async (requestId) => { reads.push(requestId); return result(saved); } });
  assert.deepEqual(reads, [older.request.id, older.request.id]);
  assert.deepEqual(turns[0]!.answer, answer);
  assert.equal(conversationRequestSettled(turns, older.request.id), true);
  assert.equal(mergeConversationTurns(turns, [older])[0]!.request.status, "succeeded", "a delayed older page must not resurrect the failure");
  assert.equal(latest.length, 60, "recovery does not alter pagination or pad the latest page");
});

test("a restored accepted attempt outside the latest page recovers its exact terminal result and becomes unblocked", async () => {
  const latest = Array.from({ length: 60 }, (_, index) => turn(200 + index));
  const attempt = { key: `question:${id(500)}`, question: "My actual retained submission", requestId: id(100) };
  const reads: string[] = [];
  const recovered = await reconcileConversationRequests({ ...scope, turns: latest, attempt,
    getResult: async (requestId) => { reads.push(requestId); return result(turn(100, "succeeded", done)); } });
  assert.deepEqual(reads, [attempt.requestId]);
  assert.equal(recovered[0]!.question, attempt.question);
  assert.deepEqual(recovered[0]!.answer, answer);
  assert.equal(conversationRequestSettled(recovered, attempt.requestId), true);
  assert.equal(conversationRequestSettled(recovered, null), false);
});

test("a restored pending attempt stays identifiable until success or failure, using server question text when available", async () => {
  const attempt = { key: `question:${id(500)}`, question: "Retained local submission", requestId: id(100) };
  const pending = await reconcileConversationRequests({ ...scope, turns: [], attempt, getResult: async () => result(turn(100, "running", next)) });
  assert.equal(conversationRequestSettled(pending, attempt.requestId), false);
  assert.equal(pending[0]!.answer, null);
  const terminal = await reconcileConversationRequests({ ...scope, turns: mergeConversationTurns(pending, [turn(100, "running", next)]), attempt,
    getResult: async () => result(turn(100, "failed", done)) });
  assert.equal(terminal[0]!.question, "The actual question 100");
  assert.equal(conversationRequestSettled(terminal, attempt.requestId), true);
  assert.equal(terminal[0]!.request.failure?.retryable, true);
  assert.equal(terminal[0]!.answer, null);
});

test("up to 60 older pending turns reconcile once per exact identity, retaining answer-owned sources", async () => {
  const pending = Array.from({ length: 60 }, (_, index) => turn(100 + index, "running"));
  const sourceId = id(700);
  const sourced: DemandAnswer = { version: 2, body: [{ type: "paragraph", text: "A sourced retained answer.", citations: [{ sourceId, label: "1" }] }],
    sources: [{ id: sourceId, title: "The answer's own source", publisher: "Synthetic", url: "https://example.com/answer", publishedAt: null, accessedAt: done }],
    basis: "researched", researchedAt: done };
  const reads: string[] = [];
  const recovered = await reconcileConversationRequests({ ...scope, turns: pending, attempt: null,
    resuming: { requestId: pending[0]!.request.id, question: pending[0]!.question },
    getResult: async (requestId) => {
      reads.push(requestId);
      const existing = pending.find(({ request }) => request.id === requestId)!;
      return { request: { ...existing.request, status: "succeeded", stage: "ready", updatedAt: done }, article: null, answer: sourced };
    } });
  assert.equal(reads.length, 60);
  assert.equal(new Set(reads).size, 60);
  assert.equal(recovered.length, 60);
  assert.ok(recovered.every(({ answer: actual }) => JSON.stringify(actual) === JSON.stringify(sourced)));
  assert.deepEqual(recovered.map(({ question }) => question), pending.map(({ question }) => question));
});

test("unconfirmed submissions and settled history cannot manufacture an exact request or trigger a fresh question", async () => {
  let reads = 0;
  const turns = [turn(100)];
  const recovered = await reconcileConversationRequests({ ...scope, turns,
    attempt: { key: `question:${id(500)}`, question: "An uncertain submission", requestId: null },
    getResult: async () => { reads++; throw new Error("No exact request is known"); } });
  assert.equal(reads, 0);
  assert.deepEqual(recovered, turns);
  assert.equal(conversationRequestSettled(recovered, null), false);
});

test("exact recovery rejects wrong identity, kind, idea, loop and malformed answer lifecycle without changing retained turns", async () => {
  const previous = [turn(100, "running")];
  const valid = result(turn(100, "succeeded", done));
  for (const invalid of [
    { ...valid, request: { ...valid.request, id: id(999) } },
    { ...valid, request: { ...valid.request, kind: "article" as const } },
    { ...valid, request: { ...valid.request, ideaId: id(999) } },
    { ...valid, request: { ...valid.request, loopId: id(999) } },
    { ...valid, answer: null },
    { ...valid, request: { ...valid.request, status: "running" as const } },
  ]) {
    await assert.rejects(reconcileConversationRequests({ ...scope, turns: previous, attempt: null, getResult: async () => invalid }));
    assert.equal(previous[0]!.request.status, "running");
    assert.equal(previous[0]!.answer, null);
  }
  await assert.rejects(reconcileConversationRequests({ ...scope, turns: previous, attempt: null,
    getResult: async () => { throw new Error("Temporary exact read failure"); } }), /Temporary exact read failure/);
});

test("equivalent timestamp precision and delayed same-status stages do not regress exact recovery", () => {
  const checking = { ...turn(100, "running", next), request: { ...turn(100, "running", next).request, stage: "checking" as const } };
  const stale = { ...turn(100, "running", "2026-09-07T15:01:00.000000Z") };
  assert.equal(mergeConversationTurns([checking], [stale])[0]!.request.stage, "checking");
  const succeeded = turn(100, "succeeded", next);
  assert.equal(mergeConversationTurns([succeeded], [stale])[0]!.request.status, "succeeded");
  const precise = turn(100, "failed", "2026-09-07T15:01:00.000100Z");
  assert.equal(mergeConversationTurns([precise], [succeeded])[0]!.request.status, "failed", "real submillisecond ordering remains intact");
  const resumed = turn(100, "queued", done);
  assert.equal(mergeConversationTurns([precise], [resumed])[0]!.request.status, "queued", "a genuinely newer retry may leave terminal failure");
});

test("exact refreshes and later pages preserve immutable microsecond creation order", async () => {
  const earlier = { ...turn(900, "running"), request: { ...turn(900, "running").request, createdAt: "2026-09-07T15:00:00.000100Z" } };
  const later = { ...turn(100, "running"), request: { ...turn(100, "running").request, createdAt: "2026-09-07T15:00:00.000900Z" } };
  const exactResults = [result(turn(900, "succeeded", done)), result(turn(100, "succeeded", done))];
  const originals = structuredClone(exactResults);
  const refreshed = await reconcileConversationRequests({ ...scope, turns: [earlier, later], attempt: null,
    getResult: async (requestId) => exactResults.find(({ request }) => request.id === requestId)! });
  assert.deepEqual(refreshed.map(({ request }) => request.id), [id(900), id(100)], "random ID order must not replace actual creation order");
  assert.deepEqual(refreshed.map(({ request }) => request.createdAt), [earlier.request.createdAt, later.request.createdAt]);
  assert.deepEqual(exactResults, originals, "exact server response objects remain unchanged");
  const onlyExact = exactResults.map(({ request, answer }) => ({ request, answer, question: "Actual submitted question" }));
  assert.deepEqual(mergeConversationTurns(onlyExact, [earlier, later]).map(({ request }) => request.createdAt),
    [earlier.request.createdAt, later.request.createdAt], "an older page can restore immutable precision even when its lifecycle is stale");
});

test("a fresh terminal exact result wins despite ms truncation, without allowing a stale page to undo it", async () => {
  const pending = { ...turn(100, "running", "2026-09-07T15:01:00.123456Z") };
  const exact = result(turn(100, "succeeded", "2026-09-07T15:01:00.123Z"));
  const original = structuredClone(exact);
  const refreshed = await reconcileConversationRequests({ ...scope, turns: [pending], attempt: null, getResult: async () => exact });
  assert.equal(refreshed[0]!.request.status, "succeeded");
  assert.deepEqual(refreshed[0]!.answer, answer);
  assert.equal(refreshed[0]!.request.updatedAt, exact.request.updatedAt, "do not invent an exact microsecond update time");
  assert.equal(refreshed[0]!.exactUpdatedAfter, pending.request.updatedAt);
  assert.deepEqual(exact, original);
  assert.equal(mergeConversationTurns(refreshed, [pending])[0]!.request.status, "succeeded");
  assert.equal(mergeConversationTurns([pending], [{ request: exact.request, question: pending.question, answer }])[0]!.request.status,
    "running", "an arbitrary page does not gain fresh-exact-read provenance");

  const failed = result(turn(100, "failed", "2026-09-07T15:01:00.123Z"));
  const terminal = await reconcileConversationRequests({ ...scope, turns: [pending], attempt: null, getResult: async () => failed });
  assert.equal(terminal[0]!.request.status, "failed");
  const genuineRetry = turn(100, "queued", "2026-09-07T15:01:00.123900Z");
  assert.equal(mergeConversationTurns(terminal, [genuineRetry])[0]!.request.status, "queued", "a genuinely later retry still advances beyond a terminal failure");
});

test("component source guards exact responses and preserves durable recovery plus the existing scroll anchor", () => {
  const source = readFileSync(new URL("../components/edison/demand-v10/article-conversation.tsx", import.meta.url), "utf8");
  const reconcileIndex = source.indexOf("const merged = await reconcileConversationRequests");
  assert.ok(reconcileIndex > 0);
  assert.match(source.slice(reconcileIndex, source.indexOf("setError(\"\"); setLoaded(true)", reconcileIndex)),
    /if \(!mounted.current \|\| serial !== fetchSerial.current\) return;/);
  assert.match(source, /settledAttempt.*conversationRequestSettled/);
  assert.match(source, /persist\(\{ \.\.\.localRef.current, resuming: \{ requestId: turn.request.id, question: turn.question \} \}\);/);
  assert.match(source, /if \(!busy \|\| sending \|\| retrying !== null \|\| loading/);
  const retrySource = source.slice(source.indexOf("async function retryTurn"), source.indexOf("function rememberPlace"));
  assert.ok(retrySource.indexOf("fetchSerial.current++") < retrySource.indexOf("await retry(turn.request.id)"));
  assert.match(retrySource, /if \(mounted.current\) await load\(\)/);
  assert.match(source, /anchor.requestId/);
  assert.match(source, /pages < 20/);
  assert.match(source, /oldTop \+ page.current.scrollHeight - oldHeight/);
  assert.match(source, /turn.request.status !== "failed" \|\| !turn.request.failure\?\.retryable/);
});
