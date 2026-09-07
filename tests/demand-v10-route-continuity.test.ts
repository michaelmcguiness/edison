import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { demandWorkspaceSchema, type DemandIdea, type DemandIdeaResult, type DemandRequest } from "@edison/contracts";
import { acceptedIdeaArrival, resolvedLoopEditDraft } from "../components/edison/demand-v10/reader-state";
import { loopRevealScroll } from "../components/edison/demand-v10/reader-shell";
import { availableDemandOrigin, demandRouteHref, navigationForSelection, parseDemandNavigation, parseDemandRoute, readDemandRouteSelection, readyRouteHistoryMode, resolveDemandOrigin,
  type DemandOrigin } from "../components/edison/demand-v10/route-continuity";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-09-07T12:00:00.000Z";
const loop = { id: id(1), title: "Biology", originalCuriosity: "Explain biology", revision: 1, principles: [], lastMutationId: null, canUndo: false, createdAt: now, updatedAt: now };
const ideaA: DemandIdea = { id: id(2), loopId: loop.id, batchRequestId: id(20), batchRevision: 1, rank: 1, title: "Article A", deck: "Saved article", articleRequestId: id(30), saved: true, createdAt: now };
const ideaB: DemandIdea = { ...ideaA, id: id(3), rank: 2, title: "Article B", articleRequestId: id(31) };
const workspace = demandWorkspaceSchema.parse({ workspaceId: id(9), readerKind: "guest", loops: [loop], ideas: [ideaA, ideaB], requests: [] });
const origin: DemandOrigin = { view: "library", loopId: null, ideaId: ideaA.id, scrollY: 1234, history: { scope: "saved", cursor: "second_page_cursor" } };
const pending = { kind: "idea" as const, id: ideaB.id };
const ready = { kind: "article" as const, id: ideaB.articleRequestId! };
const getIdea = async (ideaId: string): Promise<DemandIdeaResult> => ({ workspaceId: workspace.workspaceId, idea: ideaId === ideaA.id ? ideaA : ideaB, request: null });

test("Library page two origin A survives Next B, serialization and direct ready reload", async () => {
  const pendingState = navigationForSelection(workspace.workspaceId, origin, pending);
  const reloaded = parseDemandNavigation(JSON.parse(JSON.stringify(pendingState)), workspace.workspaceId);
  const selected = await resolveDemandOrigin({ navigation: reloaded, workspace, selectedIdea: ideaB, getIdea });
  assert.deepEqual(selected.origin, origin);
  assert.notEqual(selected.origin.ideaId, ideaB.id);
  const readyState = navigationForSelection(workspace.workspaceId, selected.origin, ready);
  assert.deepEqual((await resolveDemandOrigin({ navigation: readyState, workspace, selectedIdea: ideaB, getIdea })).origin, origin);
  assert.equal(readyState.origin.history!.cursor, "second_page_cursor");
});

test("pending B has its own URL immediately and becoming ready replaces only B's history entry", () => {
  const a = { kind: "article" as const, id: ideaA.articleRequestId! };
  const stack = ["/", demandRouteHref(a), demandRouteHref(pending)];
  assert.equal(stack[2], `/?idea=${ideaB.id}`);
  assert.deepEqual(parseDemandRoute("/", `?idea=${ideaB.id}`), pending);
  assert.equal(readyRouteHistoryMode(pending, ideaB.id, ready.id), "replace");
  stack[stack.length - 1] = demandRouteHref(ready);
  assert.equal(stack.length, 3);
  assert.equal(stack[stack.length - 2], demandRouteHref(a), "browser Back returns A, not a second pending B entry");
  assert.equal(readyRouteHistoryMode(ready, ideaB.id, ready.id), "none");
});

test("pending route restoration performs only its exact owned read even before admission is confirmed", async () => {
  const calls: string[] = [];
  const value = await readDemandRouteSelection({ selection: pending, workspaceId: workspace.workspaceId,
    getArticle: async () => { throw new Error("must not fetch a previous ready article"); },
    getIdea: async (ideaId) => { calls.push(ideaId); return { workspaceId: workspace.workspaceId, idea: { ...ideaB, articleRequestId: null }, request: null }; } });
  assert.deepEqual(calls, [ideaB.id]);
  assert.equal(value.idea.articleRequestId, null);
  assert.equal(value.article, null);
  assert.equal(value.request, null);
});

test("route and origin records reject malformed, cross-workspace and mismatched scope data", async () => {
  const valid = navigationForSelection(workspace.workspaceId, origin, pending);
  for (const value of [
    { ...valid, workspaceId: id(99) },
    { ...valid, origin: { ...origin, scrollY: Infinity } },
    { ...valid, origin: { ...origin, scrollY: -1 } },
    { ...valid, origin: { ...origin, ideaId: "javascript:alert(1)" } },
    { ...valid, origin: { ...origin, history: { scope: "all", cursor: "cursor" } } },
    { ...valid, origin: { ...origin, history: { scope: "saved", loopId: loop.id, cursor: "cursor" } } },
    { ...valid, origin: { ...origin, history: { scope: "saved", cursor: "x".repeat(513) } } },
    { ...valid, origin: { ...origin, history: { scope: "saved", cursor: "bad?cursor" } } },
  ]) assert.equal(parseDemandNavigation(value, workspace.workspaceId), null);
  assert.equal(parseDemandRoute("/", `?idea=${ideaB.id}&idea=${ideaB.id}`), null);
  assert.equal(parseDemandRoute("/", "?idea=not-an-id"), null);
  assert.equal(parseDemandRoute("/s/demand/public", `?idea=${ideaB.id}`), null);
  await assert.rejects(readDemandRouteSelection({ selection: pending, workspaceId: workspace.workspaceId, getArticle: async () => { throw new Error("unused"); },
    getIdea: async () => ({ workspaceId: id(99), idea: ideaB, request: null }) }), /different reading workspace/);
});

test("off-window origin A is recovered independently from B through the owner API", async () => {
  const reads: string[] = [];
  const record = navigationForSelection(workspace.workspaceId, origin, ready);
  const result = await resolveDemandOrigin({ navigation: record, workspace: { ...workspace, ideas: [ideaB] }, selectedIdea: ideaB,
    getIdea: async (ideaId) => { reads.push(ideaId); return getIdea(ideaId); } });
  assert.deepEqual(reads, [ideaA.id]);
  assert.deepEqual(result.origin, origin);
  assert.equal(result.recovered?.idea.id, ideaA.id);
  const wrongOwner = await resolveDemandOrigin({ navigation: record, workspace: { ...workspace, ideas: [ideaB] }, selectedIdea: ideaB,
    getIdea: async () => ({ workspaceId: id(99), idea: ideaA, request: null }) });
  assert.equal(wrongOwner.origin.ideaId, ideaB.id);
  assert.equal(wrongOwner.recovered, null);
});

test("archived or absent origin loop falls back to home without denying existing reading", async () => {
  const loopOrigin: DemandOrigin = { view: "loop", loopId: loop.id, ideaId: ideaA.id, scrollY: 400, history: { scope: "all", loopId: loop.id, cursor: "page_2" } };
  const archived = { ...workspace, loops: [{ ...loop, archivedAt: now }] };
  const result = await resolveDemandOrigin({ navigation: navigationForSelection(workspace.workspaceId, loopOrigin, ready), workspace: archived, selectedIdea: ideaB, getIdea });
  assert.equal(result.origin.view, "home");
  assert.equal(result.origin.ideaId, ideaB.id);
  assert.deepEqual(availableDemandOrigin(loopOrigin, archived), { view: "home", loopId: null, ideaId: null, scrollY: 0 });
});

test("an uncertain save A completing after newer draft B preserves B and keeps editor open", () => {
  const submitted = { name: "Cells", instructions: "  Preserve literal direction.\n" };
  const later = { name: "Cell Biology", instructions: "Newer unsaved draft" };
  assert.deepEqual(resolvedLoopEditDraft(later, submitted), { draft: later, close: false });
  assert.deepEqual(resolvedLoopEditDraft(submitted, submitted), { draft: submitted, close: true });
  assert.deepEqual(resolvedLoopEditDraft({ ...submitted, name: " Cells " }, { ...submitted, name: " Cells " }), { draft: submitted, close: true });
});

test("loop reveal uses item position within its own scroller, not document offset", () => {
  assert.equal(loopRevealScroll(0, 300, 360, 100), 160);
  assert.equal(loopRevealScroll(160, 300, 360, 100), 160);
  assert.equal(loopRevealScroll(160, 300, 70, 100), 70);
  assert.equal(loopRevealScroll(0, 300, 0, 100), 0);
});

test("a successful retried batch announces only its actual accepted new identities", () => {
  const failed: DemandRequest = { id: id(20), loopId: loop.id, ideaId: null, kind: "ideas", status: "failed", stage: "failed", failure: { code: "recoverable", message: "Failed", retryable: true }, createdAt: now, updatedAt: now };
  assert.deepEqual(acceptedIdeaArrival([ideaA, ideaB], failed, new Set()), []);
  const readyRequest = { ...failed, status: "succeeded" as const, stage: "ready" as const, failure: null };
  assert.deepEqual(acceptedIdeaArrival([ideaA, ideaB, { ...ideaA, id: id(4), batchRequestId: id(99) }], readyRequest, new Set([ideaA.id])), [ideaB.id]);
  assert.deepEqual(acceptedIdeaArrival([], readyRequest, new Set()), []);
});

test("reader restoration and every selection exit use the validated shared route record", () => {
  const source = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /candidate.ideaId === result.idea.id|demandFeed|demandOrigin/);
  assert.match(source, /returnToOrigin\(origin, navigationIntentRef.current\)/);
  assert.match(source, /returnToOrigin\(availableDemandOrigin\(origin, workspace\), intent\)/);
  assert.match(source, /const \{ cursor, \.\.\.query \} = origin.history;\s*void loadHistoryPage\(query, cursor\)/);
  assert.match(source, /readStoredAttempt\("article", `\$\{workspace.workspaceId\}:\$\{idea.id\}`\)/);
  assert.match(source, /writeStoredAttempt\("article", `\$\{workspace.workspaceId\}:\$\{idea.id\}`, attempt\)/);
  const route = source.slice(source.indexOf("const restoreArticleRoute ="), source.indexOf("const readingRecords ="));
  assert.doesNotMatch(route, /requestDemandArticle|openIdea\(/);
  assert.match(route, /if \(!isCurrent\(\)\) return/);
  assert.match(source, /Check article status/);
  const exits = source.slice(source.indexOf("function openLoop("), source.indexOf("function openCreate("));
  assert.doesNotMatch(exits, /pathname.startsWith\("\/articles\/"\)/);
});
