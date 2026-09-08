import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LibraryResponse } from "@edison/contracts";
import { LibraryView } from "../components/edison/library-profile";
import { makeDemoStories } from "../lib/demo-content";

const [story] = makeDemoStories("2026-09-04T12:00:00.000Z");

test("the live library exposes durable conversations and completed stories", () => {
  const library: LibraryResponse = {
    saved: [],
    completed: [{ ...story, completed: true }],
    learningThreads: [],
    conversations: [{
      id: "00000000-0000-4000-8000-000000000001",
      articleId: story.id,
      articleTitle: story.title,
      title: "A continuing question",
      updatedAt: "2026-09-04T12:00:00.000Z",
    }],
  };

  const markup = renderToStaticMarkup(createElement(LibraryView, {
    dataMode: "live",
    library,
    fallbackSaved: [],
    loading: false,
    error: "",
    back: () => undefined,
    open: async () => undefined,
    openArticle: () => undefined,
  }));

  assert.match(markup, /Article conversations/);
  assert.match(markup, /A continuing question/);
  assert.match(markup, /Completed stories/);
  assert.match(markup, new RegExp(story.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
