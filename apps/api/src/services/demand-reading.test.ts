import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HttpError } from "../http/errors";
import { demandBaselinePreferences, demandRequestDto, demandRequestWithRecovery, rejectDistinctPendingIdeasRequest } from "./demand-reading";

test("account reading defaults remain distinct from guest defaults and scoped loop instructions", () => {
  assert.deepEqual(demandBaselinePreferences(), { length: "standard", depth: 50 });
  assert.deepEqual(demandBaselinePreferences({ article_length: "brief", depth: 85 }), { length: "brief", depth: 85 });
  assert.throws(() => demandBaselinePreferences({ article_length: "unknown", depth: 50 }), HttpError);
  assert.throws(() => demandBaselinePreferences({ article_length: "deep", depth: 101 }), HttpError);
});

test("only a privately qualified failed provider result exposes saved-repair retry without leaking the proof", () => {
  const now = new Date("2026-09-07T00:00:00Z");
  const input = { id: "00000000-0000-4000-8000-000000000101", loopId: "00000000-0000-4000-8000-000000000102",
    ideaId: "00000000-0000-4000-8000-000000000103", kind: "article" as const, status: "failed" as const,
    stage: "failed", failureCode: "provider_invalid", createdAt: now, updatedAt: now,
    progress: { checkRecoveries: ["private-proof"], draft: "private-draft" }, snapshot: { secret: "private-assignment" } };
  const ordinary = demandRequestDto(input);
  assert.equal(ordinary.failure?.retryable, false);
  assert.deepEqual(demandRequestWithRecovery(ordinary, false), ordinary);
  const qualified = demandRequestWithRecovery(ordinary, true);
  assert.equal(qualified.failure?.retryable, true);
  assert.match(qualified.failure?.message ?? "", /saved work.*remaining repair allowance/);
  assert.equal(qualified.id, input.id);
  assert.equal(qualified.status, "failed");
  assert.equal(qualified.createdAt, ordinary.createdAt);
  assert.equal(ordinary.failure?.retryable, false);
  assert.doesNotMatch(JSON.stringify(qualified), /private-proof|private-draft|private-assignment|checkRecoveries|snapshot/);
  for (const failureCode of ["editorial_withheld", "provider_uncertain", "budget_exhausted"]) {
    const terminal = demandRequestDto({ ...input, failureCode });
    assert.deepEqual(demandRequestWithRecovery(terminal, true), terminal);
  }
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
