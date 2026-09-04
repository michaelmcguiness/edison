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
