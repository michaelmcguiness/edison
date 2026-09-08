import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demandAllowanceSchema, demandWorkspaceSchema, type DemandIdea, type DemandLoop, type DemandLoops, type DemandRequest } from "@edison/contracts";
import { ArticleCard, ArticleFeedToolbar } from "../components/edison/demand-v11/feed";
import { ReaderAccount } from "../components/edison/demand-v11/account";
import { articleBalance, currentLoopArticles, currentReadingArticles, nextArticleCount, allowanceResetLabel } from "../components/edison/demand-v11/state";
import { parseReadingSet, readingSetMatches, sameReadingSet, type ReadingSet } from "../components/edison/demand-v11/reading-origin";
import { clearMatchingResetAttempt, definitiveResetRejection, resetPasswordFingerprint, validResetAttempt } from "../components/edison/demand-v11/reset-state";
import { loopProjection, mergeLoopPage, offWindowPendingLoops, recoverCreatedLoop } from "../components/edison/demand-v11/loop-pages";

const now = "2026-09-07T12:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const noop = () => {};
const loop: DemandLoop = { id: id(1), title: "Mechanisms", originalCuriosity: "How does this work?", instructions: "Explain mechanisms.", revision: 1, principles: [], canUndo: false, lastMutationId: null, archivedAt: null, currentBatchRequestId: id(100), createdAt: now, updatedAt: now };
function idea(n: number, batch = 100, rank = 1): DemandIdea { return { id: id(n), loopId: id(1), batchRequestId: id(batch), batchRevision: 1, rank, title: `Stored article ${n}`, deck: "An accepted article choice.", articleRequestId: null, saved: false, createdAt: batch === 100 ? now : "2026-09-07T13:00:00.000Z" }; }
function request(n: number, status: DemandRequest["status"]): DemandRequest { return { id: id(n), loopId: id(1), ideaId: null, kind: "ideas", status, stage: status === "succeeded" ? "ready" : status === "failed" ? "failed" : "queued", failure: null, createdAt: now, updatedAt: now }; }
const allowance = demandAllowanceSchema.parse({ limit: 500, used: 496, periodUsed: 496, reserved: 0, remaining: 4, available: 4, periodStart: "2026-09-07T00:00:00.000Z", resetsAt: "2026-09-14T00:00:00.000Z", revision: 0, manualResetAt: null });
const workspace = demandWorkspaceSchema.parse({ workspaceId: id(99), readerKind: "account", loops: [loop], ideas: [idea(2), idea(3, 100, 2)], requests: [request(100, "succeeded")], allowance, accountGate: { canCreateLoop: true, canRefresh: true, reason: null } });

test("legacy alternating card colors cannot override v11 paper surfaces at tablet widths", () => {
  const css = readFileSync(new URL("../app/demand.css", import.meta.url), "utf8");
  for (const index of [2, 3, 4]) {
    assert.ok(css.includes(`.demand-idea-card:not(.demand-article-card):nth-child(4n + ${index})`));
    assert.ok(!css.includes(`.demand-idea-card:nth-child(4n + ${index})`));
  }
  assert.match(css, /\.demand-v11 \.demand-article-card \{[^}]*background: #fff; color: #242625;/);
});

test("refresh keeps the accepted set through pending, failure and zero results, then replaces by exact batch", () => {
  const before = [idea(2), idea(3, 100, 2)];
  for (const status of ["queued", "running", "failed", "succeeded"] as const) {
    assert.deepEqual(currentLoopArticles(loop, before, [request(100, "succeeded"), request(101, status)]), before, `${status} without accepted rows must retain current set`);
  }
  const after = [idea(5, 101, 2), idea(4, 101, 1)];
  assert.deepEqual(currentLoopArticles({ ...loop, currentBatchRequestId: id(101) }, [...before, ...after], [request(101, "succeeded")]).map(({ id }) => id), [id(4), id(5)]);
  assert.deepEqual(before.map(({ id }) => id), [id(2), id(3)], "history inputs are never erased");
  const historical = { ...loop }; delete historical.currentBatchRequestId;
  assert.deepEqual(currentLoopArticles(historical, [...before, ...after], [request(101, "failed")]), before, "legacy projection cannot show rejected candidate rows");
});

test("For You contains each active loop current set, not a global six-card cap", () => {
  const loops = [loop, { ...loop, id: id(11) }, { ...loop, id: id(21), archivedAt: now }];
  const rows = loops.flatMap((owner, index) => Array.from({ length: 6 }, (_, i) => ({ ...idea(30 + index * 6 + i, 100, i + 1), loopId: owner.id })));
  const result = currentReadingArticles(loops, rows, []);
  assert.equal(result.length, 12);
  assert.ok(result.every((row) => row.loopId !== id(21)));
});

test("the final one to five articles stay actionable; zero opens allowance rather than a disabled button", () => {
  for (let available = 0; available <= 6; available++) {
    const value = { ...allowance, remaining: available, available, used: 500 - available, periodUsed: 500 - available };
    assert.equal(nextArticleCount(value), available);
    const html = renderToStaticMarkup(createElement(ArticleFeedToolbar, { balance: articleBalance(value), count: nextArticleCount(value), pending: false, disabled: false, onRefresh: noop, onAllowance: noop }));
    assert.doesNotMatch(html, /disabled/);
    assert.match(html, new RegExp(`${available} of 500 articles left this week`));
    if (available > 0 && available < 6) assert.match(html, new RegExp(`Refresh ${available} article`));
  }
  assert.equal(nextArticleCount({ ...allowance, reserved: 3, available: 1 }), 1);
  assert.equal(nextArticleCount(undefined), null, "missing server capacity is not invented");
});

test("reset dates use authoritative server instant and disclose the reader timezone", () => {
  assert.match(allowanceResetLabel(allowance, "en-US", "America/New_York"), /September 13, 2026.*8:00.*EDT/);
  assert.match(allowanceResetLabel(allowance, "en-US", "UTC"), /September 14, 2026.*12:00.*UTC/);
});

test("D44 removes guest commissioning and signup-continuation surfaces", () => {
  const reader = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  const account = readFileSync(new URL("../components/edison/demand-v11/account.tsx", import.meta.url), "utf8");
  assert.match(reader, /workspace\?\.readerKind !== "account"/);
  assert.match(reader, /Edison is invite-only/);
  assert.doesNotMatch(reader, /beginDemandAccountFlow|readDemandAccountContinuation|Keep your curiosity going|Create account or sign in/);
  assert.doesNotMatch(account, /Create account or sign in|Create an account to keep going/);
});

test("article card retains distinct real Save action and no fabricated art or article metadata", () => {
  const plain = renderToStaticMarkup(createElement(ArticleCard, { idea: idea(2), action: "Read article", saving: false, onOpen: noop, onSave: noop }));
  assert.match(plain, /aria-label="Read article: Stored article 2"/);
  assert.match(plain, /aria-label="Save article: Stored article 2"/);
  assert.doesNotMatch(plain, /<svg[^>]*data-editorial-art|Article idea|Checking art|readingMinutes| min/);
  const artistic = renderToStaticMarkup(createElement(ArticleCard, { idea: { ...idea(2), art: { version: 1, composition: "living-system", palette: "sage", variant: 0 } }, action: "Read article", saving: false, onOpen: noop, onSave: noop }));
  assert.match(artistic, /data-editorial-art="living-system"/);
  assert.match(artistic, /aria-hidden="true"/);
});

test("refresh does not reinterpret the original article set on Next or reload", () => {
  const origin = { view: "loop" as const, loopId: loop.id, ideaId: id(2), scrollY: 580 };
  const snapshot: ReadingSet = { workspaceId: workspace.workspaceId, originIdeaId: id(2), view: "loop", loopId: loop.id, ideas: [idea(2), idea(3, 100, 2)] };
  const stored = JSON.stringify(snapshot);
  assert.deepEqual(parseReadingSet(stored, workspace.workspaceId, origin), snapshot);
  assert.equal(readingSetMatches(snapshot, workspace.workspaceId, origin), true);
  assert.equal(sameReadingSet(snapshot.ideas, [idea(4, 101), idea(5, 101, 2)]), false);
  assert.equal(parseReadingSet(stored, id(999), origin), null);
  assert.equal(parseReadingSet(stored, workspace.workspaceId, { ...origin, loopId: id(22) }), null);
  assert.equal(parseReadingSet(stored, workspace.workspaceId, { ...origin, ideaId: id(44) }), null);
  assert.equal(parseReadingSet(JSON.stringify({ ...snapshot, ideas: [idea(2), idea(2)] }), workspace.workspaceId, origin), null);
  assert.equal(parseReadingSet(stored, workspace.workspaceId, { ...origin, history: { scope: "saved", cursor: null } }), null);
});

test("paginated loops remain an independent projection beyond the bounded workspace", () => {
  const page: DemandLoops = { workspaceId: workspace.workspaceId, loops: [], ideas: [], requests: [], nextCursor: "next-page" };
  for (let i = 0; i < 90; i++) page.loops.push({ ...loop, id: id(200 + i) });
  const result = loopProjection(workspace, page);
  assert.equal(result.loops.length, 91);
  assert.equal(workspace.loops.length, 1);
  const archived = { ...loop, revision: 2, archivedAt: now };
  assert.equal(mergeLoopPage({ ...page, loops: [archived] }, { ...page, loops: [loop] }).loops[0]?.archivedAt, now, "late pages cannot undo deletion");
  assert.equal(loopProjection({ ...workspace, workspaceId: id(98) }, page).loops.length, 1);
});

test("reset recovery stores no password and old responses cannot erase a newer operation", async () => {
  const fingerprint = await resetPasswordFingerprint("a test-only wrong password");
  assert.equal(fingerprint.length, 64);
  assert.notEqual(fingerprint, await resetPasswordFingerprint("another test password"));
  const a = { idempotencyKey: `allowance:${id(1)}`, expectedRevision: 0, periodStart: allowance.periodStart, fingerprint };
  const b = { ...a, idempotencyKey: `allowance:${id(2)}`, expectedRevision: 1 };
  assert.equal(validResetAttempt(a), true);
  assert.equal(validResetAttempt({ ...a, expectedRevision: -1 }), false);
  assert.equal(validResetAttempt({ ...a, password: "must not persist" }), false);
  const data = new Map([["reset", JSON.stringify(b)]]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } };
  clearMatchingResetAttempt(storage, "reset", a.idempotencyKey);
  assert.equal(data.get("reset"), JSON.stringify(b));
  clearMatchingResetAttempt(storage, "reset", b.idempotencyKey);
  assert.equal(data.size, 0);
  assert.equal(definitiveResetRejection({ status: 400 }), true);
  assert.equal(definitiveResetRejection({ status: 408 }), false);
  assert.equal(definitiveResetRejection({ status: 502 }), false);
  assert.doesNotThrow(() => clearMatchingResetAttempt(() => { throw new Error("Storage getter denied"); }, "reset", a.idempotencyKey));
});

for (const outcome of ["success", "rejection"] as const) test(`late reset A ${outcome} after remount cannot clear reset B`, async () => {
  const fingerprint = await resetPasswordFingerprint("test password");
  const a = { idempotencyKey: `allowance:${id(1)}`, expectedRevision: 0, periodStart: allowance.periodStart, fingerprint };
  const b = { ...a, idempotencyKey: `allowance:${id(2)}`, expectedRevision: 1 };
  const data = new Map([["reset", JSON.stringify(a)]]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } };
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const deferred = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
  const completion = deferred.then(() => clearMatchingResetAttempt(storage, "reset", a.idempotencyKey), () => clearMatchingResetAttempt(storage, "reset", a.idempotencyKey));
  clearMatchingResetAttempt(storage, "reset", a.idempotencyKey); // Remounted recovery A confirms first.
  data.set("reset", JSON.stringify(b));
  if (outcome === "success") resolve(); else reject(new Error("Old definitive rejection"));
  await completion;
  assert.equal(data.get("reset"), JSON.stringify(b));
});

test("Account uses real allowance, historical usage, reset status and honest available capabilities", () => {
  const html = renderToStaticMarkup(createElement(ReaderAccount, { workspace: { ...workspace, allowance: { ...allowance, periodUsed: 996, manualResetAt: now } }, initialSection: "usage", hasPendingReset: true, getIdentity: async () => null, signOut: async () => {}, onBack: noop, onReading: noop, onAllowance: noop }));
  assert.match(html, /4 of 500 articles left this week/);
  assert.match(html, /Articles received this week/);
  assert.match(html, /996/);
  assert.match(html, /Check reset status/);
  assert.doesNotMatch(html, /Stripe|Subscribe|Buy|\$\d|subscriber|payment method/);
});

test("reset never auto-submits generation or bypasses the server password check", () => {
  const root = new URL("../components/edison/", import.meta.url);
  const reader = readFileSync(new URL("demand-reader.tsx", root), "utf8");
  const wall = readFileSync(new URL("demand-v11/allowance-wall.tsx", root), "utf8");
  const editor = readFileSync(new URL("demand-v10/loop-editor.tsx", root), "utf8");
  assert.match(wall, /await onReset\(\{ password, idempotencyKey: operation.idempotencyKey, expectedRevision: operation.expectedRevision, expectedPeriodStart: operation.periodStart \}\)/);
  assert.doesNotMatch(wall, /bulb|remaining:\s*500|setAllowance|password\s*===|password\s*!==/);
  assert.match(wall, /type="password"/);
  assert.match(wall, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(wall, /if \(lock.current \|\| !password\) return/);
  const reset = reader.slice(reader.indexOf("onReset={async (input) =>"), reader.indexOf("}} /> : null}", reader.indexOf("onReset={async (input) =>")));
  assert.doesNotMatch(reset, /commissionIdeas|requestDemandIdeas|createDemandLoop/);
  assert.match(reader, /writeStoredAttempt\("ideas", owner, attempt\)/);
  assert.match(reader, /if \(!stored && !gateArticleAction/);
  assert.match(reader, /actionOverlayRef.current/);
  assert.match(editor, /<Dialog open/);
  assert.equal((editor.match(/<textarea/g) ?? []).length, 1);
  assert.match(editor, />Direction<\/label>/);
  assert.doesNotMatch(editor, /instructions\.trim\(\)|demand-saved-instructions/);
});

test("a later accepted batch page cannot regress to a stale workspace pointer with tied loop edit metadata", () => {
  const newer = { ...request(101, "succeeded"), createdAt: "2026-09-07T13:00:00.000Z" };
  const page = { workspaceId: workspace.workspaceId, loops: [{ ...loop, currentBatchRequestId: id(101) }], ideas: [idea(8, 101)], requests: [newer], nextCursor: null };
  const result = loopProjection(workspace, page);
  assert.equal(result.loops[0]?.currentBatchRequestId, id(101));
  assert.deepEqual(currentReadingArticles(result.loops, result.ideas, result.requests).map((item) => item.id), [id(8)]);
});

test("off-window refresh admission and retained pending pages remain eligible for exact polling", () => {
  const pending = { ...request(102, "running"), loopId: id(31) };
  assert.deepEqual(offWindowPendingLoops(workspace, [pending, request(103, "running")], []), [id(31)]);
  assert.deepEqual(offWindowPendingLoops(workspace, [], [id(31)]), [id(31)], "an admitted request may be omitted by the bounded workspace");
  assert.deepEqual(offWindowPendingLoops(workspace, [{ ...pending, status: "succeeded" }], []), []);
  const reader = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  assert.match(reader, /if \(!previous.requestId\) continue/, "older success cannot settle a refresh before admission supplies its exact request");
  assert.match(reader, /previousRequestId: workspace \? latestRequest\(\{ \.\.\.workspace, requests: projection.requests \}/, "refresh on a paginated loop retains its previous exact request");
});

test("created loop31 is recovered from its exact admitted request, never inferred or recommissioned", async () => {
  const owner = { ...loop, id: id(31) };
  const admitted = { ...request(101, "queued"), loopId: owner.id };
  const calls: string[] = [];
  const page = { workspaceId: workspace.workspaceId, loops: [owner], ideas: [], requests: [admitted], nextCursor: null };
  const result = await recoverCreatedLoop(admitted.id, workspace.workspaceId, async (requestId) => { calls.push(requestId); return { request: admitted, article: null, answer: null }; }, async (loopId) => { calls.push(loopId); return page; });
  assert.equal(result.loop.id, id(31));
  assert.deepEqual(calls, [id(101), id(31)]);
  await assert.rejects(recoverCreatedLoop(id(999), workspace.workspaceId, async () => ({ request: admitted, article: null, answer: null }), async () => page), /could not be confirmed/);
  await assert.rejects(recoverCreatedLoop(admitted.id, id(999), async () => ({ request: admitted, article: null, answer: null }), async () => page), /workspace changed/);
});

test("Latest articles persists the new feed entry while older article entries keep their original set", () => {
  const reader = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  const latest = reader.slice(reader.indexOf("function showLatestArticles"), reader.indexOf("function retryContinuityRestoration"));
  assert.match(latest, /ideaId: null/);
  assert.match(latest, /"replace", "\/"/);
  assert.doesNotMatch(latest, /removeItem|storeReadingSet/);
  assert.match(reader, /readingSetMatches\(readingSetRef.current, workspaceIdentityRef.current, origin\) \? readingSetRef.current/);
});
