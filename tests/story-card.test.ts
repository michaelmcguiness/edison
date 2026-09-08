import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryCard } from "../components/edison/story-card";
import { makeDemoStories } from "../lib/demo-content";

const story = makeDemoStories("2026-09-04T12:00:00.000Z")[0];
const callbacks = {
  open: async () => undefined,
  summary: () => undefined,
  save: async () => undefined,
  timerRef: { current: null },
  tone: "blue" as const,
};

test("subject-specific sample art never decorates an unrelated live story", () => {
  const live = renderToStaticMarkup(createElement(StoryCard, {
    ...callbacks,
    story,
    dataMode: "live",
  }));
  const prototype = renderToStaticMarkup(createElement(StoryCard, {
    ...callbacks,
    story,
    dataMode: "prototype",
  }));

  assert.doesNotMatch(live, /story-art(?:\s|\")/);
  assert.match(live, /without-art/);
  assert.match(prototype, /story-art(?:\s|\")/);
  assert.match(prototype, /edison-source-assemblage\.webp/);
});

test("public and guest story actions never promise a save they cannot make", () => {
  const guest = renderToStaticMarkup(createElement(StoryCard, {
    ...callbacks,
    story,
    dataMode: "guest",
  }));
  const publicStarter = renderToStaticMarkup(createElement(StoryCard, {
    ...callbacks,
    story,
    dataMode: "public",
  }));

  assert.match(guest, /Sign in to save/);
  assert.doesNotMatch(guest, /aria-pressed/);
  assert.match(publicStarter, /Public starter story cannot be saved/);
  assert.doesNotMatch(publicStarter, /aria-pressed/);
});
