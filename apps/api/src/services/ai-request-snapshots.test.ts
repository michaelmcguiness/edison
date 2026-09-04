import assert from "node:assert/strict";
import test from "node:test";

import {
  articleQuestionRequestSnapshotSchema,
  preferenceCommandRequestSnapshotSchema,
  snapshotArticleQuestion,
  snapshotPreferenceCommand,
} from "./ai-request-snapshots";

test("article-question retries retain the original provider input", () => {
  const article = {
    title: "Original article",
    deck: "Original deck",
    body: [
      {
        type: "paragraph" as const,
        text: "Original body",
        citations: [],
      },
    ],
  };
  const history = [
    { role: "user" as const, content: "An earlier question" },
  ];
  const snapshot = snapshotArticleQuestion({
    article,
    sources: [],
    history,
    question: "What changed?",
  });

  article.title = "Concurrent article edit";
  history.push({ role: "user", content: "A later concurrent question" });

  const retried = articleQuestionRequestSnapshotSchema.parse(
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.equal(retried.article.title, "Original article");
  assert.deepEqual(retried.history, [
    { role: "user", content: "An earlier question" },
  ]);
});

test("feed-command retries retain the original preference context", () => {
  const currentPreferences = {
    articleLength: "standard" as const,
    editorialBrief: "Prefer primary sources",
    depth: 60,
    novelty: 40,
    categoryVisibility: { technology: true },
    categoryOrder: ["technology"],
    inferredPreferences: ["technical detail"],
    knowledgeState: [
      { topic: "databases", level: "intermediate" as const, note: null },
    ],
  };
  const currentInterests = {
    active: ["databases"],
    muted: ["celebrity news"],
  };
  const snapshot = snapshotPreferenceCommand({
    command: "More database coverage",
    currentPreferences,
    currentInterests,
  });

  currentPreferences.depth = 10;
  currentInterests.active.push("a later concurrent interest");

  const retried = preferenceCommandRequestSnapshotSchema.parse(
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.equal(retried.currentPreferences.depth, 60);
  assert.deepEqual(retried.currentInterests.active, ["databases"]);
});

test("feed-command snapshots cannot exceed the retained-interest cap", () => {
  const currentPreferences = {
    articleLength: "standard" as const,
    editorialBrief: "",
    depth: 60,
    novelty: 60,
    categoryVisibility: {},
    categoryOrder: [],
    inferredPreferences: [],
    knowledgeState: [],
  };
  const topics = Array.from({ length: 51 }, (_, index) => `Topic ${index}`);

  assert.doesNotThrow(() =>
    snapshotPreferenceCommand({
      command: "Adjust my interests",
      currentPreferences,
      currentInterests: {
        active: topics.slice(0, 25),
        muted: topics.slice(25, 50),
      },
    }),
  );
  assert.throws(() =>
    snapshotPreferenceCommand({
      command: "Adjust my interests",
      currentPreferences,
      currentInterests: {
        active: topics.slice(0, 26),
        muted: topics.slice(26),
      },
    }),
  );
});
