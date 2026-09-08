import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { demandWorkspaceSchema, type DemandIdea, type DemandRequest } from "@edison/contracts";
import { appendStableIdeas, articlePreparationLabel, loopDraftChanged, readScopedDraft, saveScopedDraft } from "../components/edison/demand-v10/reader-state";
import { mergeConversationTurns } from "../components/edison/demand-v10/article-conversation";
import { loopOverflow, ReaderShell } from "../components/edison/demand-v10/reader-shell";
import { copyReaderShare } from "../components/edison/demand-v10/share-panel";
import { DemandReader } from "../components/edison/demand-reader";

const now = "2026-09-07T12:00:00.000Z";
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function idea(number: number, batch = 100, rank = 1): DemandIdea {
  return { id: id(number), loopId: id(1), batchRequestId: id(batch), batchRevision: 1, rank, title: `Article ${number}`, deck: "A real stored choice", articleRequestId: null, saved: false, createdAt: now };
}
function request(number: number, status: DemandRequest["status"] = "queued"): DemandRequest {
  return { id: id(number), loopId: id(1), ideaId: id(2), kind: "question", status, stage: status === "failed" ? "failed" : "queued", failure: null, createdAt: now, updatedAt: now };
}

test("stable arrivals append without replacing prior cards, and saved state refreshes in place", () => {
  const first = [idea(2, 100, 1), idea(3, 100, 2)];
  const incoming = [idea(5, 101, 2), { ...first[0]!, saved: true }, idea(4, 101, 1)];
  const result = appendStableIdeas(first, incoming);
  assert.deepEqual(result.map(({ id }) => id), [id(2), id(3), id(4), id(5)]);
  assert.equal(result[0]!.saved, true);
  assert.equal(first[0]!.saved, false);
  assert.deepEqual(appendStableIdeas(result, incoming), result);
  assert.equal(result.length, 4, "partial results are never padded to six");
});

test("actual preparation stages distinguish unknown/queued, writing and checking", () => {
  assert.equal(articlePreparationLabel(), "Preparing your article…");
  assert.equal(articlePreparationLabel(request(3)), "Preparing your article…");
  assert.equal(articlePreparationLabel({ ...request(3), stage: "writing" }), "Writing your article…");
  assert.equal(articlePreparationLabel({ ...request(3), stage: "checking" }), "Checking your article…");
  assert.equal(articlePreparationLabel({ ...request(3), stage: "repairing" }), "Checking your article…");
});

test("finite overflow bounds do not expose an infinite carousel or detached menu", () => {
  assert.deepEqual(loopOverflow(0, 300, 300), { left: false, right: false });
  assert.deepEqual(loopOverflow(0, 300, 800), { left: false, right: true });
  assert.deepEqual(loopOverflow(250, 300, 800), { left: true, right: true });
  assert.deepEqual(loopOverflow(500, 300, 800), { left: true, right: false });
  const loops = ["<b>Biology</b>", "Sports", "A long literal direction with & symbols"].map((title, index) => ({ id: id(index + 1), title }));
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(ReaderShell, { loops, activeLoopId: id(1), onSelectLoop: noop, onAddLoop: noop, onOpenHome: noop, onOpenLibrary: noop, onOpenProfile: noop, onEditLoop: noop, showLoopNavigation: true, showEditLoop: true }, "Reading"));
  assert.match(html, /&lt;b&gt;Biology&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Biology|<details|pulse-loop-overflow/);
  assert.match(html, /demand-loop-scroller/);
  assert.ok(html.indexOf("For You") < html.indexOf("Sports"));
  assert.ok(html.indexOf("demand-new-loop") > html.indexOf("A long literal direction"));
  assert.match(html, /Curate/);
});

test("loop drafts distinguish unapplied edits including removing all instructions", () => {
  const saved = { name: "Biology", instructions: "Explain mechanisms." };
  assert.equal(loopDraftChanged(saved, saved), false);
  assert.equal(loopDraftChanged({ ...saved, instructions: "" }, saved), true);
  assert.equal(loopDraftChanged({ ...saved, name: "<b>Cells</b>" }, saved), true);
  assert.deepEqual(saved, { name: "Biology", instructions: "Explain mechanisms." });
});

test("device drafts are scoped, validated and remain optional when storage fails", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
    const isText = (value: unknown): value is string => typeof value === "string";
    saveScopedDraft("owner-one:article-v1", "draft");
    assert.equal(readScopedDraft("owner-one:article-v1", "", isText), "draft");
    assert.equal(readScopedDraft("owner-two:article-v1", "", isText), "");
    assert.equal(readScopedDraft("owner-one:article-v2", "", isText), "");
    values.set("bad", '{"draft":[]');
    assert.equal(readScopedDraft("bad", "fallback", isText), "fallback");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.doesNotThrow(() => saveScopedDraft("key", "draft"));
    assert.equal(readScopedDraft("key", "fallback", isText), "fallback");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("conversation pages prepend and replace by durable request identity without inventing answers", () => {
  const recent = { request: { ...request(9), createdAt: "2026-09-07T12:05:00.000Z" }, question: "How does that work?", answer: null };
  const earlier = { request: request(8, "failed"), question: "My real earlier question", answer: null };
  const updated = { ...recent, request: { ...recent.request, status: "running" as const, stage: "answering" as const } };
  const result = mergeConversationTurns([recent], [earlier, updated]);
  assert.deepEqual(result.map(({ request }) => request.id), [id(8), id(9)]);
  assert.equal(result[1]!.request.status, "running");
  assert.equal(result[0]!.question, earlier.question);
  assert.equal(result[0]!.answer, null);
  assert.deepEqual(mergeConversationTurns(result, [updated]), result);
  assert.equal(mergeConversationTurns(result, [recent])[1]!.request.status, "running", "an older page cannot regress a current pending turn");
  const newer = { ...updated, request: { ...updated.request, updatedAt: "2026-09-07T12:06:00.000Z", status: "failed" as const } };
  assert.equal(mergeConversationTurns([newer], [updated])[0]!.request.status, "failed");
});

test("clipboard completion requires a fulfilled browser write, never a simulated copy", async () => {
  let copied = "";
  await copyReaderShare("https://edisonreader.com/s/demand/example", { writeText: async (value) => { copied = value; } });
  assert.equal(copied, "https://edisonreader.com/s/demand/example");
  await assert.rejects(copyReaderShare("https://example.com/", undefined), /Clipboard access is unavailable/);
  await assert.rejects(copyReaderShare("https://example.com/", { writeText: async () => { throw new Error("denied"); } }), /denied/);
});

test("archived loops and their cards leave navigation/feed without deleting saved records", () => {
  const loop = { id: id(1), title: "Archived loop", originalCuriosity: "Keep this full request", instructions: "", archivedAt: now, revision: 2, principles: [], lastMutationId: null, canUndo: false, createdAt: now, updatedAt: now };
  const workspace = demandWorkspaceSchema.parse({ workspaceId: id(99), readerKind: "guest", loops: [loop, { ...loop, id: id(3), title: "Active loop", archivedAt: null }], ideas: [idea(2)], requests: [] });
  const before = structuredClone(workspace);
  const html = renderToStaticMarkup(createElement(DemandReader, { initialWorkspace: workspace }));
  assert.doesNotMatch(html, /title="Archived loop"|data-idea-id=/);
  assert.deepEqual(workspace, before);
});

test("route, question and sharing source boundaries remain explicit and non-generating on recovery", () => {
  const root = new URL("../components/edison/", import.meta.url);
  const source = readFileSync(new URL("demand-reader.tsx", root), "utf8");
  const chat = readFileSync(new URL("demand-v10/article-conversation.tsx", root), "utf8");
  const share = readFileSync(new URL("demand-v10/share-panel.tsx", root), "utf8");
  const editor = readFileSync(new URL("demand-v10/loop-editor.tsx", root), "utf8");
  assert.match(source, /readDemandRouteSelection\(\{ selection, workspaceId: next.workspaceId, getArticle: client.getDemandArticle, getIdea: client.getDemandIdea \}\)/);
  assert.match(source, /window.addEventListener\("popstate"/);
  assert.match(chat, /ask\(attempt.question, attempt.key\)/);
  assert.match(chat, /request.failure\?\.retryable/);
  assert.match(chat, /Load earlier conversation/);
  assert.match(chat, /anchor.requestId/);
  assert.match(chat, /pages < 20/);
  assert.match(chat, /restoringScroll.current && loaded/);
  assert.match(editor, /saveScopedDraft\(`\$\{key\}:attempt`, currentAttempt\)/);
  assert.match(editor, /onSave\(currentAttempt.draft, currentAttempt.id, currentAttempt.baseRevision\)/);
  assert.match(editor, /Check change status/);
  assert.doesNotMatch(editor, /instructions.trim\(\)/);
  assert.match(source, /confirmPublic: true/);
  assert.match(share, /failure.name === "AbortError"/);
  assert.match(share, /await copyReaderShare\(link, navigator.clipboard\); setMessage\("Link copied."\)/);
  assert.doesNotMatch(chat, /applyDemandFeedback|Article idea|Math.random|setInterval/);
});
