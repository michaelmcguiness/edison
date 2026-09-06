import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HttpError } from "../http/errors";
import { demandBaselinePreferences, rejectDistinctPendingIdeasRequest } from "./demand-reading";

test("account reading defaults remain distinct from guest defaults and scoped loop instructions", () => {
  assert.deepEqual(demandBaselinePreferences(), { length: "standard", depth: 50 });
  assert.deepEqual(demandBaselinePreferences({ article_length: "brief", depth: 85 }), { length: "brief", depth: 85 });
  assert.throws(() => demandBaselinePreferences({ article_length: "unknown", depth: 50 }), HttpError);
  assert.throws(() => demandBaselinePreferences({ article_length: "deep", depth: 101 }), HttpError);
});

test("a distinct key cannot be acknowledged as another pending ideas request", () => {
  assert.throws(
    () => rejectDistinctPendingIdeasRequest({
      snapshot: { context: { revision: 4 } },
    }, 4),
    (error) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "reading_busy",
  );
  assert.doesNotThrow(() => rejectDistinctPendingIdeasRequest({
    snapshot: { context: { revision: 3 } },
  }, 4));
  assert.doesNotThrow(() => rejectDistinctPendingIdeasRequest(undefined, 4));
});

test("same-key replay remains ahead of the distinct pending-key conflict", () => {
  const source = readFileSync(
    new URL("./demand-reading.ts", import.meta.url),
    "utf8",
  );
  const requestStart = source.indexOf("export async function requestDemandIdeas");
  const requestEnd = source.indexOf("export async function requestDemandArticle");
  const request = source.slice(requestStart, requestEnd);
  const replay = request.indexOf("replayRequest(");
  const conflict = request.indexOf("rejectDistinctPendingIdeasRequest(");
  const reserve = request.indexOf("reserveRequest(");

  assert.ok(replay >= 0 && replay < conflict && conflict < reserve);
  assert.doesNotMatch(request, /return pending/);
});

test("Ask admission freezes current owned loop context after replay while retaining immutable article material", () => {
  const source = readFileSync(new URL("./demand-reading.ts", import.meta.url), "utf8");
  const request = source.slice(source.indexOf("export async function requestDemandQuestion"), source.indexOf("export async function recordDemandEvent"));
  const replay = request.indexOf("replayRequest(");
  const lock = request.indexOf("loopForUpdate(tx, principal.id, idea.loopId)");
  const assemble = request.indexOf("currentContext: await assembleDemandContext(tx, loop)");
  assert.ok(replay >= 0 && replay < lock && lock < assemble);
  assert.match(request, /articleContext: article\.snapshot\.context/);
  assert.match(request, /demandQuestionHistory\(\{ articleEvidence: material\.evidence, history: history\.reverse\(\) \}\)/);
  assert.match(request, /draft: material\.storedDraft, evidence: conversation\.evidence/);
  assert.match(request, /previousMessages: conversation\.previousMessages/);
});
