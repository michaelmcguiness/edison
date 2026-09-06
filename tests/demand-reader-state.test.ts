import assert from "node:assert/strict";
import test from "node:test";
import type { DemandRequest, DemandWorkspace } from "@edison/contracts";
import {
  clearsSubmittedDemandFeedback, DEMAND_READING_POSITION_LIMIT, demandReadingPositionForIdea,
  DemandWorkspaceResponses, mergeDemandWorkspaces, rememberDemandReadingPosition, restoreDemandReadingPositions,
  restoreDemandContinuity, restoredDemandArticlePosition, runScopedDemandRequest,
  type DemandContinuity,
} from "../lib/demand-reader-state";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const now = "2026-09-06T16:00:00.000Z";
function workspace(): DemandWorkspace {
  return { workspaceId: id(1), readerKind: "guest", loops: [10, 20].map((number) => ({
    id: id(number), title: `Loop ${number}`, originalCuriosity: `A distinct curiosity ${number}`,
    revision: 1, principles: [], lastMutationId: null, canUndo: false, createdAt: now, updatedAt: now,
  })), ideas: [11, 21].map((number) => ({
    id: id(number), loopId: id(number - 1), batchRequestId: id(number + 100), batchRevision: 1,
    rank: 1, title: `Article ${number}`, deck: `Source-informed idea ${number}`, articleRequestId: null,
    saved: false, createdAt: now,
  })), requests: [] };
}
function requested(base: DemandWorkspace, number: number): DemandWorkspace {
  const idea = base.ideas.find((idea) => idea.id === id(number))!;
  const request: DemandRequest = { id: id(number + 200), loopId: idea.loopId, ideaId: idea.id,
    kind: "article", stage: "queued", status: "queued", failure: null, createdAt: now, updatedAt: now };
  return { ...base, ideas: base.ideas.map((entry) => entry.id === idea.id ? { ...entry, articleRequestId: request.id } : entry), requests: [...base.requests, request] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a delayed retry updates shared records but never selects A or overwrites B's error after navigation", async () => {
  for (const shouldFail of [false, true]) {
    const response = deferred<DemandWorkspace>();
    let current = "A";
    let selected = "A";
    let error = "";
    let shared = 0;
    const task = runScopedDemandRequest({ run: () => response.promise, isCurrent: () => current === "A",
      onSharedResult: () => { shared++; }, onCurrentResult: () => { selected = "A retried"; },
      onCurrentError: () => { error = "A failed"; } });
    current = "B"; selected = "B"; error = "B error";
    if (shouldFail) response.reject(new Error("late failure")); else response.resolve(workspace());
    await task;
    assert.equal(selected, "B"); assert.equal(error, "B error"); assert.equal(shared, shouldFail ? 0 : 1);
  }
});

test("a pre-mutation poll cannot erase a newer pending B request or stop its polling", async () => {
  const base = workspace();
  const responses = new DemandWorkspaceResponses(base);
  const poll = deferred<DemandWorkspace>();
  const ticket = responses.beginPoll();
  const pendingPoll = poll.promise.then((value) => responses.acceptPoll(ticket, value));
  const mutation = responses.beginMutation();
  const after = responses.acceptMutation(mutation, requested(base, 21))!;
  assert.equal(after.requests[0]?.status, "queued");
  poll.resolve(base);
  assert.equal(await pendingPoll, null);
  const fresh = responses.beginPoll();
  assert.equal(responses.acceptPoll(fresh, requested(base, 21))?.requests.length, 1);
});

test("reverse-ordered independent mutations preserve both requests and irreversible commission IDs", async () => {
  const base = workspace();
  const responses = new DemandWorkspaceResponses(base);
  const a = deferred<DemandWorkspace>(); const b = deferred<DemandWorkspace>();
  const at = responses.beginMutation(); const bt = responses.beginMutation();
  const ap = a.promise.then((value) => responses.acceptMutation(at, value));
  const bp = b.promise.then((value) => responses.acceptMutation(bt, value));
  b.resolve(requested(base, 21)); await bp;
  a.resolve(requested(base, 11)); const final = (await ap)!;
  assert.equal(final.requests.length, 2);
  assert.ok(final.requests.every(({ status }) => status === "queued"));
  assert.ok(final.ideas.every(({ articleRequestId }) => articleRequestId !== null));
});

test("reverse independent Save responses keep A and B saved rather than preferring every field from B", async () => {
  const base = workspace(); const responses = new DemandWorkspaceResponses(base);
  const a = deferred<DemandWorkspace>(); const b = deferred<DemandWorkspace>();
  const at = responses.beginMutation({ savedIdeaId: id(11) });
  const bt = responses.beginMutation({ savedIdeaId: id(21) });
  const ap = a.promise.then((value) => responses.acceptMutation(at, value));
  const bp = b.promise.then((value) => responses.acceptMutation(bt, value));
  b.resolve({ ...base, ideas: base.ideas.map((idea) => ({ ...idea, saved: idea.id === id(21) })) }); await bp;
  a.resolve({ ...base, ideas: base.ideas.map((idea) => ({ ...idea, saved: idea.id === id(11) })) });
  assert.deepEqual((await ap)!.ideas.map(({ saved }) => saved), [true, true]);
});

test("same-idea response ordering and unrelated snapshots cannot revert a later Save decision", () => {
  const base = workspace(); const responses = new DemandWorkspaceResponses(base);
  const old = responses.beginMutation({ savedIdeaId: id(11) });
  const latest = responses.beginMutation({ savedIdeaId: id(11) });
  const unrelated = responses.beginMutation();
  responses.acceptMutation(latest, base);
  responses.acceptMutation(unrelated, { ...base, ideas: base.ideas.map((idea) => ({ ...idea, saved: true })) });
  assert.equal(responses.acceptMutation(old, { ...base, ideas: base.ideas.map((idea) => ({ ...idea, saved: true })) })!.ideas[0]!.saved, false);
});

test("newer polls win over reverse-ordered earlier polls and running polls are ignored during a mutation", () => {
  const base = workspace(); const responses = new DemandWorkspaceResponses(base);
  const first = responses.beginPoll(); const next = responses.beginPoll();
  assert.ok(responses.acceptPoll(next, requested(base, 11)));
  assert.equal(responses.acceptPoll(first, base), null);
  const during = responses.beginPoll(); const mutation = responses.beginMutation();
  assert.equal(responses.acceptPoll(during, base), null);
  responses.finishMutation(mutation);
  assert.equal(responses.acceptPoll(during, base), null);
});

test("cross-workspace responses replace records and retired principal tickets cannot restore them", () => {
  const base = requested(workspace(), 11);
  const account = { ...workspace(), workspaceId: id(2), readerKind: "account" as const, loops: [], ideas: [], requests: [] };
  assert.deepEqual(mergeDemandWorkspaces(base, account), account);
  const responses = new DemandWorkspaceResponses(base);
  const oldMutation = responses.beginMutation(); const currentMutation = responses.beginMutation();
  assert.deepEqual(responses.acceptMutation(currentMutation, account), account);
  assert.equal(responses.acceptMutation(oldMutation, base), null);
  assert.deepEqual(responses.acceptPoll(responses.beginPoll(), account), account);
});

test("Undo preserves unsent feedback; apply clears only the exact submitted request and text", () => {
  assert.equal(clearsSubmittedDemandFeedback({ operation: "undo", text: "Unsent draft", requestId: id(90) }, id(90), "Unsent draft"), false);
  const apply = { operation: "apply" as const, text: "More examples", requestId: id(91) };
  assert.equal(clearsSubmittedDemandFeedback(apply, id(91), "More examples"), true);
  assert.equal(clearsSubmittedDemandFeedback(apply, id(91), "Keep this new draft"), false);
  assert.equal(clearsSubmittedDemandFeedback(apply, id(90), "More examples"), false);
  assert.equal(clearsSubmittedDemandFeedback(null, id(91), "More examples"), false);
});

function continuity(overrides: Partial<DemandContinuity> = {}): DemandContinuity {
  return { version: 1, workspaceId: id(1), view: "loop", activeLoopId: id(20), selectedIdeaId: null,
    origin: null, articleScrollY: 0, ...overrides };
}
test("reload restores the second loop rather than silently choosing the first", () => {
  const saved = continuity();
  assert.deepEqual(restoreDemandContinuity(JSON.stringify(saved), workspace()), saved);
});

test("half-read Library article recovery retains exact selection, origin and position without a visible request row", () => {
  const base = requested(workspace(), 21);
  const saved = continuity({ view: "article", selectedIdeaId: id(21), articleScrollY: 1820,
    origin: { view: "library", loopId: null, ideaId: id(21), scrollY: 640 } });
  const recovered = restoreDemandContinuity(JSON.stringify(saved), { ...base, requests: [] })!;
  assert.deepEqual(recovered, saved);
  assert.equal(restoredDemandArticlePosition(recovered), 1820);
  assert.equal(base.ideas.find(({ id: ideaId }) => ideaId === recovered.selectedIdeaId)!.articleRequestId, id(221));
  // Repeated reload while that exact body is still loading must not lose position.
  const stillLoading = restoreDemandContinuity(JSON.stringify({ ...recovered, view: "request" }), base)!;
  assert.equal(restoredDemandArticlePosition(stillLoading), 1820);
});

test("For You reading origin survives recovery, while uncommissioned/cross-loop/cross-workspace states are rejected", () => {
  const base = requested(workspace(), 21);
  const saved = continuity({ view: "article", selectedIdeaId: id(21), articleScrollY: 800,
    origin: { view: "home", loopId: null, ideaId: id(21), scrollY: 300 } });
  assert.equal(restoreDemandContinuity(JSON.stringify(saved), base)?.origin?.view, "home");
  assert.equal(restoreDemandContinuity(JSON.stringify(saved), workspace()), null);
  for (const invalid of [{ ...saved, activeLoopId: id(10) }, { ...saved, workspaceId: id(2) },
    { ...saved, origin: { ...saved.origin, loopId: id(10) } }, { ...saved, articleScrollY: -1 }]) {
    assert.equal(restoreDemandContinuity(JSON.stringify(invalid), base), null);
  }
  assert.equal(restoreDemandContinuity("not JSON", base), null);
  assert.equal(restoreDemandContinuity(JSON.stringify(saved), { ...base, requests: [{ ...base.requests[0]!, ideaId: id(11) }] }), null);
});

test("read halfway, Back to loop or Library, and reopen resumes the same article—even after feed reload", () => {
  for (const feed of ["loop", "library"] as const) {
    const base = requested(requested(workspace(), 11), 21);
    const first = base.ideas.find(({ id: ideaId }) => ideaId === id(11))!;
    const second = base.ideas.find(({ id: ideaId }) => ideaId === id(21))!;
    let positions = restoreDemandReadingPositions(null, base.workspaceId);
    assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, first), 0);
    // Capture at the article before Back changes the visible surface's scroll.
    positions = rememberDemandReadingPosition(positions, base.workspaceId, first, 1820);
    const feedState = continuity({ view: feed, activeLoopId: id(10), articleScrollY: 0 });
    const savedFeed = JSON.stringify(feedState);
    const savedPositions = JSON.stringify(positions);
    assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, first), 1820);
    assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, second), 0);
    // Reloading a feed intentionally has no selected article, but it must not
    // erase the separate per-article reading map or commission another body.
    assert.equal(restoreDemandContinuity(savedFeed, base)?.view, feed);
    positions = restoreDemandReadingPositions(savedPositions, base.workspaceId);
    assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, first), 1820);
    positions = rememberDemandReadingPosition(positions, base.workspaceId, second, 900);
    assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, first), 1820);
    assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, second), 900);
  }
});

test("reading positions are principal- and immutable-request-bound, never borrowed by a new article", () => {
  const base = requested(workspace(), 11);
  const idea = base.ideas[0]!;
  const positions = rememberDemandReadingPosition(null, base.workspaceId, idea, 1300);
  assert.equal(demandReadingPositionForIdea(positions, id(2), idea), 0);
  assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, { ...idea, articleRequestId: id(999) }), 0);
  assert.equal(demandReadingPositionForIdea(positions, base.workspaceId, { ...idea, articleRequestId: null }), 0);
  assert.deepEqual(restoreDemandReadingPositions(JSON.stringify(positions), id(2)).entries, []);
  assert.deepEqual(rememberDemandReadingPosition(positions, id(2), { ...idea, articleRequestId: null }, 200).entries, []);
});

test("local reading positions reject malformed or oversized payloads and retain only the most recent bounded entries", () => {
  const base = requested(workspace(), 11);
  const idea = base.ideas[0]!;
  let positions = restoreDemandReadingPositions(null, base.workspaceId);
  for (let index = 0; index < DEMAND_READING_POSITION_LIMIT + 5; index++) {
    positions = rememberDemandReadingPosition(positions, base.workspaceId,
      { ...idea, id: id(1000 + index), articleRequestId: id(2000 + index) }, index + 1);
  }
  assert.equal(positions.entries.length, DEMAND_READING_POSITION_LIMIT);
  assert.equal(positions.entries[0]?.ideaId, id(1124));
  assert.ok(!positions.entries.some(({ ideaId }) => ideaId === id(1000)));
  assert.ok(JSON.stringify(positions).length < 32_768);
  assert.deepEqual(restoreDemandReadingPositions(JSON.stringify(positions), base.workspaceId), positions);
  assert.deepEqual(rememberDemandReadingPosition(positions, base.workspaceId, idea, Number.NaN), positions);
  for (const raw of ["not JSON", " ".repeat(32_769), JSON.stringify({ ...positions, extra: true }),
    JSON.stringify({ ...positions, entries: [{ ...positions.entries[0], scrollY: -1 }] }),
    JSON.stringify({ ...positions, entries: [positions.entries[0], positions.entries[0]] }),
    JSON.stringify({ ...positions, entries: [...positions.entries, { ideaId: id(9999), articleRequestId: id(8888), scrollY: 1 }] })]) {
    assert.deepEqual(restoreDemandReadingPositions(raw, base.workspaceId).entries, []);
  }
});
