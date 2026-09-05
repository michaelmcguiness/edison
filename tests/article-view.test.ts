import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleView } from "../components/edison/article-view";
import { makeDemoArticle, makeDemoStories } from "../lib/demo-content";

const story = makeDemoStories("2026-09-04T12:00:00.000Z")[0];
const article = makeDemoArticle(story, "a demo reader");

function render(dataMode: "prototype" | "guest" | "public" | "live") {
  return renderToStaticMarkup(createElement(ArticleView, {
    article,
    conversationMessages: [],
    dataMode,
    back: () => undefined,
    save: () => undefined,
    onError: () => undefined,
    onCompleted: () => undefined,
    onShared: () => undefined,
  }));
}

test("public starter articles expose their stable page URL for sharing", () => {
  const markup = render("guest");

  assert.match(markup, /Back to edition/);
  assert.match(markup, /aria-label="Share public article"/);
  assert.doesNotMatch(
    markup,
    /aria-label="Share public article"[^>]*disabled/,
  );
  assert.doesNotMatch(markup, /stable public share link is not available/i);
});

test("prototype articles keep sharing explicitly disabled", () => {
  const markup = render("prototype");

  assert.match(
    markup,
    /aria-label="Article sharing is unavailable in this demo"[^>]*disabled/,
  );
});

test("signed-in readers see honest public-edition controls without a sign-in prompt", () => {
  const markup = render("public");

  assert.match(markup, /Public starter stories cannot be saved to your private library/);
  assert.match(markup, /aria-label="Share public article"/);
  assert.match(markup, /Feedback on public starter stories is separate from your private publication/);
  assert.doesNotMatch(markup, /Sign in/);
});

test("Pulse reading has a real Next headline and contextual Back without a required finish form", () => {
  const next = { ...story, id: "00000000-0000-4000-8000-000000000009", title: "The real next headline" };
  const markup = renderToStaticMarkup(createElement(ArticleView, {
    article, conversationMessages: [], dataMode: "guest", pulse: true, deviceSave: true,
    backLabel: "Back to Sleep", nextArticle: next, onNext: () => undefined, onAsk: () => undefined,
    back: () => undefined, save: () => undefined, onError: () => undefined,
    onCompleted: () => undefined, onShared: () => undefined,
  }));
  assert.match(markup, /Next article/);
  assert.match(markup, /The real next headline/);
  assert.match(markup, /Back to Sleep/);
  assert.match(markup, /Ask about this article/);
  assert.match(markup, /Save on this device/);
  assert.doesNotMatch(markup, /Mark as read|Sign in to track reading|Was this worth your time/);
  assert.match(markup, /data-reader-block/);
});

test("last Pulse article offers return without inventing a Next destination", () => {
  const markup = renderToStaticMarkup(createElement(ArticleView, {
    article, conversationMessages: [], dataMode: "guest", pulse: true,
    backLabel: "Back to History", nextArticle: null,
    back: () => undefined, save: () => undefined, onError: () => undefined,
    onCompleted: () => undefined, onShared: () => undefined,
  }));
  assert.match(markup, /Back to History/);
  assert.doesNotMatch(markup, /Next article|Mark as read/);
});

test("a corrected article shows its separate dated editorial disclosure", () => {
  const markup = renderToStaticMarkup(createElement(ArticleView, {
    article: { ...article, correction: { note: "Source dates were corrected.", correctedAt: "2026-09-05T00:00:00.000Z" } },
    conversationMessages: [], dataMode: "live", pulse: true,
    back: () => undefined, save: () => undefined, onError: () => undefined,
    onCompleted: () => undefined, onShared: () => undefined,
  }));
  assert.match(markup, /Editorial correction/);
  assert.match(markup, /Sep 5, 2026/);
  assert.match(markup, /Source dates were corrected/);
});
