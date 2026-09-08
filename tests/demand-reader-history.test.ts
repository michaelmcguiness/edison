import assert from "node:assert/strict";
import test from "node:test";
import type { DemandHistory, DemandIdeaResult, DemandWorkspace } from "@edison/contracts";
import { demandHistoryRecords, DemandReaderHistory } from "../lib/demand-reader-history";
import { recoverDemandContinuity, restoreCurrentDemandContinuity, type DemandContinuity } from "../lib/demand-reader-state";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-09-06T12:00:00.000Z";
function workspace(): DemandWorkspace {
  return { workspaceId: id(1), readerKind: "guest", loops: [{ id: id(2), title: "A long-running loop", originalCuriosity: "How do cities work?", revision: 1,
    principles: [], lastMutationId: null, canUndo: false, createdAt: now, updatedAt: now }], ideas: [], requests: [] };
}
function exact(n = 400, saved = false, status: "queued" | "succeeded" | null = null): DemandIdeaResult {
  const articleRequestId = status ? id(n + 10_000) : null;
  return { workspaceId: id(1), idea: { id: id(n), loopId: id(2), batchRequestId: id(3), batchRevision: 1,
    rank: 1, title: `Older reading ${n}`, deck: "An idea outside the recent workspace cap.", articleRequestId, saved, createdAt: now },
    request: status ? { id: articleRequestId!, loopId: id(2), ideaId: id(n), kind: "article", status,
      stage: status === "succeeded" ? "ready" : "queued", failure: null, createdAt: now,
      updatedAt: status === "succeeded" ? "2026-09-06T12:05:00.000Z" : now } : null };
}
function page(entries = [exact()], nextCursor: string | null = "older_cursor"): DemandHistory {
  return { workspaceId: id(1), ideas: entries.map(({ idea }) => idea), requests: entries.flatMap(({ request }) => request ? [request] : []), nextCursor };
}
function reader() { const value = new DemandReaderHistory(); value.reset(id(1)); return value; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("older pages stay outside workspace360, replace one bounded window and retain the server's continuation", () => {
  const history = reader(); const recent = workspace();
  for (let index = 0; index < 10; index++) {
    const rows = Array.from({ length: 60 }, (_, n) => exact(400 + index * 60 + n));
    const ticket = history.beginPage({ scope: "all", loopId: id(2) }, index ? `cursor_${index}` : null);
    assert.equal(history.acceptPage(ticket, page(rows, index === 9 ? null : `cursor_${index + 1}`)), true);
    assert.equal(history.snapshot().window?.page?.ideas.length, 60);
    assert.equal(demandHistoryRecords(recent, history.snapshot()).ideas.length, 60);
  }
  assert.equal(recent.ideas.length, 0);
  assert.equal(history.snapshot().window?.page?.nextCursor, null);
  assert.equal(history.snapshot().window?.cursor, "cursor_9");
});

test("Library reads saved history independently of recent ideas and rejects wrong-scope results", () => {
  const history = reader();
  const ticket = history.beginPage({ scope: "saved" }, null);
  assert.equal(history.acceptPage(ticket, page([exact(900, true)], null)), true);
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).ideas[0]?.saved, true);
  assert.throws(() => history.acceptPage(history.beginPage({ scope: "saved" }, null), page([exact(900, false)])), /did not match/);
});

test("a delayed previous page cannot replace a newer scope, and failure retains its exact cursor for retry", async () => {
  const history = reader(); const late = deferred<DemandHistory>();
  const oldTicket = history.beginPage({ scope: "all" }, "older_cursor");
  const pending = late.promise.then((result) => history.acceptPage(oldTicket, result));
  const current = history.beginPage({ scope: "saved" }, "saved_cursor");
  assert.equal(history.failPage(current, "Temporary connection problem"), true);
  assert.equal(history.snapshot().window?.cursor, "saved_cursor");
  assert.equal(history.snapshot().window?.error, "Temporary connection problem");
  late.resolve(page()); assert.equal(await pending, false);
  assert.equal(history.snapshot().window?.query.scope, "saved");
  const retry = history.beginPage({ scope: "saved" }, "saved_cursor");
  assert.equal(history.acceptPage(retry, page([exact(600, true)])), true);
});

test("pages started before OR during a Save cannot erase its later exact persisted result", async () => {
  for (const startDuring of [false, true]) {
    const history = reader(); history.seed(exact());
    const late = deferred<DemandHistory>();
    let ticket;
    if (!startDuring) ticket = history.beginPage({ scope: "all" }, null);
    history.invalidateMutation(id(400));
    if (startDuring) ticket = history.beginPage({ scope: "all" }, null);
    const response: Promise<boolean> = late.promise.then((result) => history.acceptPage(ticket!, result));
    assert.equal(history.beginExact(id(400)), null, "polls cannot supersede the in-flight mutation's exact recovery");
    history.acceptExact(history.beginExact(id(400), true)!, exact(400, true));
    history.finishMutation(id(400));
    late.resolve(page([exact(400, false)]));
    assert.equal(await response, false);
    assert.equal(demandHistoryRecords(workspace(), history.snapshot()).ideas[0]?.saved, true);
    assert.equal(history.snapshot().window?.loading, false);
  }
});

test("a page begun before a newer exact read cannot erase that read or a canonical article request", async () => {
  const history = reader(); const stale = deferred<DemandHistory>();
  const ticket = history.beginPage({ scope: "all" }, null);
  const pending = stale.promise.then((result) => history.acceptPage(ticket, result));
  history.acceptExact(history.beginExact(id(400))!, exact(400, true, "queued"));
  stale.resolve(page([exact()]));
  assert.equal(await pending, false);
  const records = demandHistoryRecords(workspace(), history.snapshot());
  assert.equal(records.ideas[0]?.articleRequestId, id(10400));
  assert.equal(records.requests[0]?.status, "queued");
  assert.equal(history.snapshot().window?.loading, false);
  assert.match(history.snapshot().window?.error ?? "", /Refresh/);
});

test("equal-timestamp stale status never turns accepted historical reading back into pending", () => {
  const history = reader();
  const ready = exact(400, true, "succeeded");
  history.seed(ready);
  const stale = { ...exact(400, true, "queued").request!, updatedAt: ready.request!.updatedAt };
  history.syncWorkspace({ ...workspace(), ideas: [ready.idea], requests: [stale] });
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).requests[0]?.status, "succeeded");
  history.acceptExact(history.beginExact(id(400))!, { ...ready, request: stale });
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).requests[0]?.status, "succeeded");
  history.acceptPage(history.beginPage({ scope: "all" }, null), { ...page([ready]), requests: [stale] });
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).requests[0]?.status, "succeeded");
  history.seed(ready);
  history.acceptPage(history.beginPage({ scope: "all" }, null), page([exact(400, true)]));
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).ideas[0]?.articleRequestId, ready.idea.articleRequestId);
});

test("an exact read begun before a newer accepted page cannot regress its ready request or saved bit", async () => {
  const history = reader(); const late = deferred<DemandIdeaResult>();
  const exactTicket = history.beginExact(id(400))!;
  const response = late.promise.then((result) => history.acceptExact(exactTicket, result));
  history.acceptPage(history.beginPage({ scope: "all" }, "old_page"), page([exact(400, true, "succeeded")]));
  late.resolve(exact(400, false));
  assert.equal(await response, false);
  const records = demandHistoryRecords(workspace(), history.snapshot());
  assert.equal(records.ideas[0]?.saved, true);
  assert.equal(records.ideas[0]?.articleRequestId, id(10400));
  assert.equal(records.requests[0]?.status, "succeeded");
});

test("old-idea commission, exact status polling and reopen retain one canonical request outside workspace caps", async () => {
  const history = reader(); const recent = workspace();
  history.acceptPage(history.beginPage({ scope: "all" }, "old_page"), page([exact()]));
  let commissions = 0; let metadataReads = 0; let bodyReads = 0;
  const commission = async () => { commissions++; return { workspace: recent, requestId: id(10400) }; };
  const getIdea = async (ready: boolean) => { metadataReads++; return exact(400, false, ready ? "succeeded" : "queued"); };
  history.invalidateMutation(id(400));
  const response = await commission();
  assert.equal(response.workspace.ideas.length, 0);
  history.seed({ ...exact(), idea: { ...exact().idea, articleRequestId: response.requestId } }, true);
  history.acceptExact(history.beginExact(id(400), true)!, await getIdea(false));
  history.finishMutation(id(400));
  assert.equal(demandHistoryRecords(recent, history.snapshot()).requests[0]?.status, "queued");
  history.acceptExact(history.beginExact(id(400))!, await getIdea(true));
  const selected = demandHistoryRecords(recent, history.snapshot()).ideas[0]!;
  assert.equal(selected.articleRequestId, id(10400));
  if (!selected.articleRequestId) await commission();
  if (demandHistoryRecords(recent, history.snapshot()).requests[0]?.status === "succeeded") bodyReads++;
  assert.equal(commissions, 1); assert.equal(metadataReads, 2); assert.equal(bodyReads, 1);
  assert.equal(recent.ideas.length, 0);
});

test("unsaving an old Library card applies exact state, preserves cursor, and never refills from recent workspace", () => {
  const history = reader(); history.acceptPage(history.beginPage({ scope: "saved" }, "saved_old"), page([exact(400, true)]));
  history.invalidateMutation(id(400));
  history.acceptExact(history.beginExact(id(400), true)!, exact(400, false)); history.finishMutation(id(400));
  assert.equal(history.snapshot().window?.page?.ideas.length, 0);
  assert.equal(history.snapshot().window?.cursor, "saved_old");
  assert.equal(history.snapshot().window?.page?.nextCursor, "older_cursor");
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).ideas[0]?.saved, false);
});

test("stale exact reads, seed-on-open and workspace snapshots cannot reverse a settled saved bit", () => {
  const history = reader(); const stale = history.beginExact(id(400))!;
  history.invalidateMutation(id(400));
  const mutation = history.beginExact(id(400), true)!;
  history.seed(exact()); // Opening the card while Save is pending must not steal its recovery ticket.
  assert.equal(history.acceptExact(mutation, exact(400, true)), true);
  history.finishMutation(id(400));
  assert.equal(history.acceptExact(stale, exact(400, false)), false);
  history.syncWorkspace({ ...workspace(), ideas: [exact().idea] });
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).ideas[0]?.saved, true);
});

test("history/exact tickets fail closed across principals and metadata cache remains bounded", () => {
  const history = reader(); const pageTicket = history.beginPage({ scope: "all" }, null); const exactTicket = history.beginExact(id(400))!;
  history.reset(id(9));
  assert.equal(history.acceptPage(pageTicket, page()), false);
  assert.equal(history.acceptExact(exactTicket, exact()), false);
  assert.equal(demandHistoryRecords(workspace(), history.snapshot()).ideas.length, 0);
  history.reset(id(1));
  assert.throws(() => history.acceptExact(history.beginExact(id(400))!, { ...exact(), workspaceId: id(9) }), /session changed/);
  assert.throws(() => history.acceptPage(history.beginPage({ scope: "all" }, null), { ...page(), workspaceId: id(9) }), /session changed/);
  for (let index = 0; index < 30; index++) history.seed(exact(400 + index));
  assert.equal(history.snapshot().exact.length, 24);
});

function savedReading(): DemandContinuity {
  return { version: 1, workspaceId: id(1), view: "article", activeLoopId: id(2), selectedIdeaId: id(400), articleScrollY: 1500,
    origin: { view: "library", loopId: null, ideaId: id(400), scrollY: 450, history: { scope: "saved", cursor: "saved_page_8" } } };
}
test("off-cap reload recovers exact metadata, half-read position and original page cursor without commissioning", async () => {
  const calls: string[] = [];
  const restored = await recoverDemandContinuity(JSON.stringify(savedReading()), workspace(), async (ideaId) => { calls.push(ideaId); return exact(400, true, "succeeded"); });
  assert.deepEqual(calls, [id(400)]);
  assert.equal(restored.saved?.articleScrollY, 1500);
  assert.equal(restored.saved?.origin?.history?.cursor, "saved_page_8");
  assert.equal(restored.recovered[0]?.idea.articleRequestId, id(10400));
  const feed = { ...savedReading(), view: "library", selectedIdeaId: null, origin: null, articleScrollY: 0, history: { scope: "saved", cursor: "saved_page_8" } };
  const recoveredFeed = await recoverDemandContinuity(JSON.stringify(feed), workspace(), async () => { throw new Error("Feed reload must not read bodies or exact articles."); });
  assert.equal(recoveredFeed.saved?.history?.cursor, "saved_page_8");
});

test("off-cap recovery failure stays a retryable metadata read, rejects principal mismatch and bounds distinct origin recovery", async () => {
  const raw = JSON.stringify(savedReading()); let calls = 0;
  await assert.rejects(recoverDemandContinuity(raw, workspace(), async () => { calls++; throw new Error("Temporary metadata failure"); }), /Temporary metadata failure/);
  assert.equal(calls, 1);
  await assert.rejects(recoverDemandContinuity(raw, workspace(), async () => ({ ...exact(400, true, "succeeded"), workspaceId: id(9) })), /session changed/);
  const differentOrigin = savedReading(); differentOrigin.origin!.ideaId = id(401);
  const recoveredIds: string[] = [];
  const result = await recoverDemandContinuity(JSON.stringify(differentOrigin), workspace(), async (ideaId) => { recoveredIds.push(ideaId); return exact(ideaId === id(400) ? 400 : 401, true, "succeeded"); });
  assert.equal(recoveredIds.length, 2);
  assert.equal(result.saved?.selectedIdeaId, id(400));
});

function restorationHarness() {
  let generation = 0;
  const state = { view: "loop", activeLoopId: id(2), selectedIdeaId: null as string | null,
    articleScrollY: 0, historyCursor: null as string | null, recovering: true, error: "", restored: 0 };
  const history = reader();
  return {
    state, history,
    intent: () => generation,
    navigate: (view: "library" | "loop") => {
      generation++;
      Object.assign(state, { view, activeLoopId: view === "loop" ? id(5) : id(2), selectedIdeaId: null,
        articleScrollY: 0, historyCursor: view === "library" ? "new_library_page" : "new_loop_page", recovering: false, error: "" });
    },
    retry: () => { generation++; state.recovering = true; state.error = ""; return generation; },
    restore: (intent: number, getIdea: (id: string) => Promise<DemandIdeaResult>) => restoreCurrentDemandContinuity({
      raw: JSON.stringify(savedReading()), workspace: workspace(), getIdea, isCurrent: () => intent === generation,
      onRestored: ({ saved, recovered }) => {
        for (const result of recovered) history.seed(result);
        state.restored++;
        state.recovering = false;
        if (saved) Object.assign(state, { view: saved.view, activeLoopId: saved.activeLoopId,
          selectedIdeaId: saved.selectedIdeaId, articleScrollY: saved.articleScrollY, historyCursor: saved.origin?.history?.cursor ?? null });
      },
      onFailure: (error) => { state.recovering = false; state.error = (error as Error).message; },
    }),
  };
}

test("delayed off-cap restoration success or failure cannot replace a newer Library or loop destination", async () => {
  for (const destination of ["library", "loop"] as const) {
    for (const fail of [false, true]) {
      const harness = restorationHarness(); const metadata = deferred<DemandIdeaResult>(); let reads = 0;
      const pending = harness.restore(harness.intent(), async () => { reads++; return metadata.promise; });
      assert.equal(reads, 1);
      harness.navigate(destination);
      assert.equal(harness.state.recovering, false, "the explicit destination is usable before the old response settles");
      const destinationState = structuredClone(harness.state);
      if (fail) metadata.reject(new Error("Old article could not be recovered"));
      else metadata.resolve(exact(400, true, "succeeded"));
      await pending;
      assert.deepEqual(harness.state, destinationState);
      assert.equal(harness.history.snapshot().exact.length, 0, "cancelled restoration does not seed old selection metadata");
    }
  }
});

test("unchanged navigation intent restores the actual off-cap article, position, and older page", async () => {
  const harness = restorationHarness(); const metadata = deferred<DemandIdeaResult>();
  const pending = harness.restore(harness.intent(), () => metadata.promise);
  metadata.resolve(exact(400, true, "succeeded"));
  await pending;
  assert.equal(harness.state.view, "article");
  assert.equal(harness.state.selectedIdeaId, id(400));
  assert.equal(harness.state.articleScrollY, 1500);
  assert.equal(harness.state.historyCursor, "saved_page_8");
  assert.equal(harness.state.recovering, false);
  assert.equal(harness.state.error, "");
  assert.equal(harness.history.snapshot().exact[0]?.idea.articleRequestId, id(10400));
});

test("a current restoration failure remains retryable and a deliberate retry owns a fresh intent", async () => {
  const harness = restorationHarness(); let reads = 0;
  await harness.restore(harness.intent(), async () => { reads++; throw new Error("Temporary metadata failure"); });
  assert.equal(harness.state.error, "Temporary metadata failure");
  assert.equal(harness.state.recovering, false);
  const retry = harness.retry(); const metadata = deferred<DemandIdeaResult>();
  const pending = harness.restore(retry, async () => { reads++; return metadata.promise; });
  assert.equal(harness.state.error, ""); assert.equal(harness.state.recovering, true);
  metadata.resolve(exact(400, true, "succeeded"));
  await pending;
  assert.equal(reads, 2);
  assert.equal(harness.state.restored, 1);
  assert.equal(harness.state.selectedIdeaId, id(400));
});

test("navigation before bootstrap or a queued retry starts never lends it the newer destination's intent", async () => {
  for (const retry of [false, true]) {
    const harness = restorationHarness();
    const captured = retry ? harness.retry() : harness.intent();
    harness.navigate("library");
    await harness.restore(captured, async () => { throw new Error("Cancelled restoration must not fetch metadata"); });
    assert.equal(harness.state.view, "library");
    assert.equal(harness.state.historyCursor, "new_library_page");
    assert.equal(harness.state.recovering, false);
    assert.equal(harness.state.error, "");
    assert.equal(harness.state.restored, 0);
  }
});
