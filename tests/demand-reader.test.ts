import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  demandWorkspaceSchema,
  type DemandWorkspace,
} from "@edison/contracts";
import { demandIdeaAction, DemandReader, restoreDemandDialogFocus } from "../components/edison/demand-reader";
import {
  DemandClientError,
  resolveDemandAccessToken,
  startDemandSession,
} from "../lib/demand-client";

const root = new URL("../", import.meta.url);
const readerSource = readFileSync(new URL("components/edison/demand-reader.tsx", root), "utf8");
const clientSource = readFileSync(new URL("lib/demand-client.ts", root), "utf8");
const pageSource = readFileSync(new URL("app/demand/page.tsx", root), "utf8");
const styles = readFileSync(new URL("app/demand.css", root), "utf8");

const loopId = "00000000-0000-4000-8000-000000000101";
const readyIdeaId = "00000000-0000-4000-8000-000000000102";
const pendingIdeaId = "00000000-0000-4000-8000-000000000103";
const pendingRequestId = "00000000-0000-4000-8000-000000000104";
const omittedIdeaId = "00000000-0000-4000-8000-000000000107";
const omittedRequestId = "00000000-0000-4000-8000-000000000108";
const olderBatchId = "00000000-0000-4000-8000-000000000109";
const newestBatchId = "00000000-0000-4000-8000-000000000110";
const now = "2026-09-06T16:00:00.000Z";

const workspace: DemandWorkspace = demandWorkspaceSchema.parse({
  workspaceId: "00000000-0000-4000-8000-000000000100",
  readerKind: "guest",
  loops: [{
    id: loopId,
    title: "A topic returned by the server",
    originalCuriosity: "How do cities keep summer heat from becoming dangerous?",
    revision: 2,
    principles: [{
      id: "00000000-0000-4000-8000-000000000105",
      kind: "preference",
      instruction: "Compare practical tradeoffs without pretending there is one universal answer.",
      source: "reader",
    }],
    lastMutationId: "00000000-0000-4000-8000-000000000106",
    canUndo: true,
    createdAt: now,
    updatedAt: now,
  }],
  ideas: [{
    id: readyIdeaId,
    loopId,
    batchRequestId: olderBatchId,
    batchRevision: 2,
    rank: 1,
    title: "Shade is infrastructure",
    deck: "What street trees and building shadows can do—and where they fall short.",
    articleRequestId: null,
    saved: true,
    createdAt: "2026-09-06T16:01:00.000Z",
  }, {
    id: pendingIdeaId,
    loopId,
    batchRequestId: newestBatchId,
    batchRevision: 2,
    rank: 1,
    title: "The night that never cools",
    deck: "Why overnight temperature can matter more than the afternoon peak.",
    articleRequestId: pendingRequestId,
    saved: false,
    createdAt: "2026-09-06T16:02:00.000Z",
  }, {
    id: omittedIdeaId,
    loopId,
    batchRequestId: olderBatchId,
    batchRevision: 1,
    rank: 2,
    title: "An older commissioned article",
    deck: "Its request is intentionally outside the bounded workspace history.",
    articleRequestId: omittedRequestId,
    saved: false,
    createdAt: "2026-09-06T15:00:00.000Z",
  }],
  requests: [{
    id: pendingRequestId,
    loopId,
    ideaId: pendingIdeaId,
    kind: "article",
    status: "running",
    stage: "checking",
    failure: null,
    createdAt: "2026-09-06T16:03:00.000Z",
    updatedAt: "2026-09-06T16:04:00.000Z",
  }],
});

test("the demand reader renders only persisted workspace ideas and truthful request states", () => {
  const properties: ComponentProps<typeof DemandReader> = { initialWorkspace: workspace };
  const html = renderToStaticMarkup(createElement(DemandReader, properties));

  assert.match(html, /A topic returned by the server/);
  assert.match(html, /How do cities keep summer heat from becoming dangerous\?/);
  assert.match(html, /Shade is infrastructure/);
  assert.match(html, /The night that never cools/);
  assert.match(html, /Read article/);
  assert.match(html, /Checking sources…/);
  assert.match(html, /Choose an article\. We’ll write it for you\./);
  assert.match(html, /aria-label="Read article: Shade is infrastructure"/);
  assert.match(html, /aria-label="Checking sources…: The night that never cools"/);
  assert.match(html, /Open article/);
  assert.match(html, /Earlier ideas/);
  assert.ok(html.indexOf("The night that never cools") < html.indexOf("Earlier ideas"));
  assert.ok(html.indexOf("Earlier ideas") < html.indexOf("Shade is infrastructure"));
  assert.match(html, /Checking the article and its sources/);
  assert.match(html, /aria-label="Remove saved idea: Shade is infrastructure"/);
  assert.doesNotMatch(html, /Opening your reading workspace/);
  assert.doesNotMatch(html, /Share/);
  assert.equal((html.match(/<main/g) ?? []).length, 1);
});

test("the approved create and Curate language stays exact and topic-general", () => {
  for (const copy of [
    "What do you want to learn about?",
    "e.g. art, history, synthetic biology, writing, etc.",
    "Suggested topics",
    "How can we improve this loop for you?",
    "What’s shaping this loop",
    "Tell us what to change",
    "e.g. Make articles shorter and include more examples",
    "For future ideas and articles in this loop.",
  ]) {
    assert.ok(readerSource.includes(copy), `missing approved copy: ${copy}`);
  }
  for (const topic of [
    "Health", "History", "Technology", "Science", "Sports", "Culture",
    "Cryptocurrency", "Startups", "Design", "Architecture", "Writing", "Art",
  ]) {
    assert.ok(readerSource.includes(`"${topic}"`), `missing suggestion: ${topic}`);
  }
  assert.match(readerSource, /Edison default/);
  assert.match(readerSource, /your declared knowledge/);
  assert.doesNotMatch(readerSource, /includes\(\s*["']medicine|includes\(\s*["']DNA/i);
});

test("the browser client uses the same-origin proxy and keeps session credentials out of browser storage", () => {
  for (const route of [
    "session", "workspace", "loops", "/ideas", "/article", "/feedback",
    "/questions", "/events", "/retry",
  ]) {
    assert.ok(clientSource.includes(route), `missing client route: ${route}`);
  }
  assert.match(clientSource, /fetch\(`?\/api\/demand\//);
  assert.match(clientSource, /credentials:\s*"same-origin"/);
  assert.match(clientSource, /cache:\s*"no-store"/);
  assert.match(clientSource, /let sessionPromise:/);
  assert.match(clientSource, /getSession\(\)/);
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(clientSource, /access_token[^\n]*(?:localStorage|sessionStorage)/);
});

test("guest access requires a successful no-session read and auth failures fail closed", async () => {
  let calls = 0;
  const skipped = await resolveDemandAccessToken({
    configured: false,
    getSession: async () => {
      calls += 1;
      return { data: { session: null }, error: null };
    },
  });
  assert.equal(skipped, null);
  assert.equal(calls, 0);

  assert.equal(await resolveDemandAccessToken({
    configured: true,
    getSession: async () => ({ data: { session: null }, error: null }),
  }), null);
  assert.equal(await resolveDemandAccessToken({
    configured: true,
    getSession: async () => ({
      data: { session: { access_token: "access-token-for-test" } },
      error: null,
    }),
  }), "access-token-for-test");

  for (const getSession of [
    async () => ({ data: { session: null }, error: new Error("secret provider detail") }),
    async () => {
      throw new Error("secret thrown detail");
    },
  ]) {
    await assert.rejects(
      resolveDemandAccessToken({ configured: true, getSession }),
      (error: unknown) => {
        assert.ok(error instanceof DemandClientError);
        assert.equal(error.code, "session_unavailable");
        assert.equal(error.status, 503);
        assert.equal(error.message, "Edison could not verify your sign-in. Please try again.");
        assert.doesNotMatch(error.message, /secret|provider|thrown/);
        return true;
      },
    );
  }
});

test("concurrent first-session calls share one request without caching an old workspace forever", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ workspace });
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      startDemandSession(),
      startDemandSession(),
    ]);
    assert.deepEqual(first, workspace);
    assert.deepEqual(second, workspace);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/demand/session");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
    assert.equal(calls[0]?.init?.cache, "no-store");

    await startDemandSession();
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the route is server-gated and fails closed unless on-demand reading is explicitly enabled", () => {
  assert.match(pageSource, /process\.env\.EDISON_ON_DEMAND_ENABLED\s*!==\s*"true"/);
  assert.match(pageSource, /notFound\(\)/);
  assert.match(pageSource, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(pageSource, /<DemandReader\s*\/>/);
});

test("the approved dialogs remain bounded, responsive, touch-sized and reduced-motion safe", () => {
  assert.match(styles, /\.demand-dialog\s*\{[\s\S]*?max-width:\s*480px/);
  assert.match(styles, /\.demand-dialog\s*\{[\s\S]*?padding:\s*28px/);
  assert.match(styles, /\.demand-dialog \[data-slot="dialog-title"\]\s*\{[\s\S]*?font-size:\s*27px/);
  assert.match(styles, /\.demand-dialog textarea\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(styles, /\.demand-suggestions button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /@media \(max-width:\s*600px\)[\s\S]*?padding:\s*24px 22px/);
  assert.match(styles, /@media \(max-width:\s*600px\)[\s\S]*?font-size:\s*25px/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("pending work is recovered from the server workspace and next-reading copy does not claim unwritten content is ready", () => {
  assert.match(readerSource, /workspace\?\.requests\.some/);
  assert.match(readerSource, /client\.getDemandWorkspace\(\)/);
  assert.match(readerSource, /client\.getDemandResult\(selectedRequestId\)/);
  assert.match(readerSource, /setSelectedRequestId\(idea\.articleRequestId\)/);
  assert.match(readerSource, /!nextIdea\.articleRequestId \? "Write next article"/);
  assert.match(readerSource, /nextRequest\?\.status === "succeeded" \? "Next article" : "View next article"/);
  assert.ok((readerSource.match(/maxLength=\{500\}/g) ?? []).length >= 2);
  assert.match(readerSource, /Your loop is saved\. Try again when you’re ready\./);
  assert.match(readerSource, /Your idea is saved\. Try again, or explore another\./);
});

test("article completion cannot steal navigation and reading progress starts at the article top", () => {
  assert.match(readerSource, /view !== "request"/);
  assert.match(readerSource, /selectedRequestIdeaId !== selectedIdeaId/);
  assert.match(readerSource, /setSelectedRequestId\(idea\.articleRequestId\)/);
  assert.match(readerSource, /window\.scrollTo\(0, 0\)/);
  assert.match(readerSource, /window\.scrollTo\(0, target\?\.scrollY \?\? 0\)/);
  assert.match(readerSource, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(readerSource, /showCurate=\{view === "loop" \|\| view === "home"\}/);
});

test("mutations are synchronously locked, scoped, replayable, and truthful about retryability", () => {
  assert.match(readerSource, /if \(previous\?\.inFlight\) return null/);
  assert.match(readerSource, /beginScopedAttempt\(feedbackAttemptRefs, activeLoop\.id/);
  assert.match(readerSource, /beginScopedAttempt\(questionAttemptRefs, selectedIdea\.id/);
  assert.match(readerSource, /idempotencyKey: attempt\.idempotencyKey/g);
  assert.match(readerSource, /writeStoredAttempt\("feedback", activeLoop\.id, attempt\)/);
  assert.match(readerSource, /writeStoredAttempt\("question", selectedIdea\.id, attempt\)/);
  assert.match(readerSource, /readStoredAttempt\("feedback", activeLoop\.id\)/);
  assert.match(readerSource, /readStoredAttempt\("question", selectedIdea\.id\)/);
  assert.match(readerSource, /failure\?\.retryable \? "Try again" : "Browse other ideas"/);
  assert.match(readerSource, /canRetryIdeas \? "Try again" : "Find fresh ideas"/);
  const freshPolicy = readerSource.slice(
    readerSource.indexOf("function canRequestFreshIdeasAfter"),
    readerSource.indexOf("function latestRequest"),
  );
  assert.doesNotMatch(freshPolicy, /provider_uncertain|budget_exhausted/);
  assert.match(readerSource, /Load article again/);
  assert.match(readerSource, /Load answer again/);
});

test("nonsecret drafts and pending work are rebound to their loop or idea", () => {
  assert.match(readerSource, /edison:demand:\$\{kind\}:\$\{ownerId\}/);
  assert.match(readerSource, /readDraft\("feedback", loop\.id, 500\)/);
  assert.match(readerSource, /readDraft\("question", idea\.id, 1000\)/);
  assert.match(readerSource, /feedbackRequest\.loopId !== curateLoopId/);
  assert.match(readerSource, /questionRequest\?\.ideaId !== selectedIdeaId/);
  assert.match(readerSource, /latestRequest\(workspace, loop\.id, "feedback"\)/);
  assert.doesNotMatch(readerSource, /localStorage[^\n]*(?:token|authorization|cookie)/i);
});

test("card actions follow persisted backend state without suggesting a pending article is ready", () => {
  const idea = workspace.ideas[1]!;
  const request = workspace.requests[0]!;
  assert.equal(demandIdeaAction(workspace.ideas[0]!, undefined), "Read article");
  assert.equal(demandIdeaAction(idea, { ...request, stage: "writing" }), "Preparing…");
  assert.equal(demandIdeaAction(idea, { ...request, stage: "repairing" }), "Checking sources…");
  assert.equal(demandIdeaAction(idea, { ...request, status: "failed", stage: "failed" }), "View status");
  assert.equal(demandIdeaAction(idea, { ...request, status: "succeeded", stage: "ready" }), "Read article");
});

test("dialog close restores a connected opener or a connected enabled reading surface without scrolling", () => {
  const focused: string[] = [];
  function element(name: string, connected = true, disabled = false) {
    return { isConnected: connected, hasAttribute: (attribute: string) => attribute === "disabled" && disabled,
      getAttribute: () => null, focus: (options: FocusOptions) => { assert.deepEqual(options, { preventScroll: true }); focused.push(name); } } as unknown as HTMLElement;
  }
  const fallback = element("reading surface");
  assert.equal(restoreDemandDialogFocus(element("opener"), fallback), true);
  assert.equal(restoreDemandDialogFocus(element("removed opener", false), fallback), true);
  assert.equal(restoreDemandDialogFocus(element("disabled opener", true, true), fallback), true);
  assert.equal(restoreDemandDialogFocus(null, element("removed surface", false)), false);
  assert.deepEqual(focused, ["opener", "reading surface", "reading surface"]);
});

test("Ask is a sticky-toolbar dialog, For You is combined ideas, and Curate requires an explicit target there", () => {
  assert.match(readerSource, /aria-haspopup="dialog" aria-expanded=\{askOpen\} onClick=\{openAsk\}/);
  assert.doesNotMatch(readerSource, /<section className="demand-question"/);
  assert.match(readerSource, /<ArticleQuestionDialog/);
  assert.match(readerSource, /const requiresChoice = view === "home" \|\| !activeLoop/);
  assert.match(readerSource, /<option value="" disabled>Choose a loop<\/option>/);
  assert.match(readerSource, /combinedIdeas\.map\(\(idea\) => <IdeaCard/);
  assert.doesNotMatch(readerSource, /activeLoop \?\? workspace\?\.loops\[0\]/);
  assert.match(readerSource, /href="\/\?view=profile">Account reading preferences/);
  assert.equal((readerSource.match(/const content = useEditorialDialogViewport\(open\)/g) ?? []).length, 3);
  assert.equal((readerSource.match(/onCloseAutoFocus=/g) ?? []).length, 3);
  assert.match(styles, /\.demand-create-dialog textarea \{ min-height: 60px/);
  assert.match(styles, /\.demand-curate-dialog form > textarea \{ min-height: 96px/);
});

test("opening existing reading uses the validated position map and end-of-article Back remains available after Next", () => {
  assert.match(readerSource, /articlePositionRef\.current = demandReadingPositionForIdea/);
  assert.match(readerSource, /rememberCurrentReadingPosition\(\);\s*const target = returnTarget/);
  assert.match(readerSource, /edison:demand:reading-positions:v1/);
  const endNavigation = readerSource.slice(readerSource.indexOf('<nav className="demand-next"'), readerSource.indexOf("</nav>", readerSource.indexOf('<nav className="demand-next"')));
  assert.match(endNavigation, /nextIdea \?/);
  assert.match(endNavigation, /: null\}\s*<button type="button" className="demand-end-back" onClick=\{returnFromReading\}/);
  assert.match(styles, /\.demand-next > \.demand-end-back \{[^}]*min-height: 44px[^}]*font-size: 13px/);
});

test("older history is a separate paged surface and all exact-recovery errors retain non-commissioning retries", () => {
  assert.match(readerSource, /client\.getDemandHistory\(/);
  assert.match(readerSource, /client\.getDemandIdea\(ideaId\)/);
  assert.match(readerSource, /loadHistoryPage\(\{ scope: "saved" \}, null\)/);
  assert.match(readerSource, /Browse reading history/);
  assert.match(readerSource, /Older reading/);
  assert.match(readerSource, /Try loading again/);
  assert.match(readerSource, /Try restoring again/);
  assert.match(readerSource, /Reload saved status/);
  assert.match(readerSource, /await recoverIdea\(idea\.id, true\)/);
  assert.match(readerSource, /historyReader\.finishMutation\(idea\.id\)/);
  assert.match(readerSource, /historyReader\.seed\(\{ workspaceId: response\.workspace\.workspaceId, idea: \{ \.\.\.idea, articleRequestId: response\.requestId \}/);
  assert.match(readerSource, /pendingHistoryReturn\.current = target\?\.history \? target : null/);
  assert.match(readerSource, /visibleHistory\.cursor !== target\.history\.cursor/);
  assert.doesNotMatch(readerSource, /const saved = combinedIdeas\.filter/);
});

test("server batch identity and provider rank control fresh-versus-earlier idea order", () => {
  assert.match(readerSource, /batchCreatedAt\.get\(idea\.batchRequestId\)/);
  assert.match(readerSource, /left\.batchRequestId === right\.batchRequestId/);
  assert.match(readerSource, /left\.rank - right\.rank/);
  assert.match(readerSource, /Earlier ideas/);
  assert.match(readerSource, /Find fresh ideas/);
});
