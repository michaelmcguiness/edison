import assert from "node:assert/strict";
import test from "node:test";
import {
  articleCategorySchema,
  articleCategories,
  categorySettingsSchema,
  createExplicitInterestRequestSchema,
  createGenerationJobSchema,
  explicitInterestSchema,
  explicitInterestsResponseSchema,
  feedCommandRequestSchema,
  feedCommandResponseSchema,
  preferenceChangeSchema,
  removeInferredPreferenceRequestSchema,
  sharedArticleSnapshotSchema,
  timeZoneSchema,
  updateExplicitInterestRequestSchema,
  updatePreferencesRequestSchema,
} from "../packages/contracts/src/index";
import {
  generatedArticleSchema,
  parsedPreferenceCommandSchema,
} from "../packages/ai/src/schemas";
import {
  buildArticleGenerationInput,
  buildPreferenceCommandInput,
} from "../packages/ai/src/index";

const snapshot = {
  version: 1 as const,
  category: "tech-science" as const,
  kicker: "Science · Systems",
  topic: "A test topic",
  title: "A grounded article",
  deck: "A deliberately public description.",
  body: [
    {
      type: "paragraph" as const,
      text: "A sourced claim.",
      citations: [
        {
          sourceId: "00000000-0000-4000-8000-000000000001",
          label: "1",
        },
      ],
    },
  ],
  summary: ["First", "Second", "Third"],
  readingMinutes: 6,
  sourceCount: 1,
  researchedAt: "2026-09-02T12:00:00.000Z",
  publishedAt: "2026-09-02T12:00:00.000Z",
  sources: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      title: "A primary source",
      publisher: "Example Institute",
      url: "https://example.com/source",
      publishedAt: null,
      accessedAt: "2026-09-02T12:00:00.000Z",
    },
  ],
};

test("public share snapshots reject personalization fields", () => {
  assert.equal(sharedArticleSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(
    sharedArticleSnapshotSchema.safeParse({
      ...snapshot,
      whyWritten: "Because the reader privately asked about this.",
    }).success,
    false,
  );
});

test("public snapshots reject uncited prose at every publishing boundary", () => {
  assert.equal(
    sharedArticleSnapshotSchema.safeParse({
      ...snapshot,
      body: [{
        type: "paragraph",
        text: "An unsupported claim.",
        citations: [],
      }],
    }).success,
    false,
  );
});

test("feed commands reject empty and oversized prompts", () => {
  const idempotencyKey = "command-00000000-0000-4000-8000-000000000001";
  assert.equal(
    feedCommandRequestSchema.safeParse({ command: "   ", idempotencyKey })
      .success,
    false,
  );
  assert.equal(
    feedCommandRequestSchema.safeParse({
      command: "x".repeat(1001),
      idempotencyKey,
    }).success,
    false,
  );
  assert.equal(
    feedCommandRequestSchema.safeParse({
      command: "More history, please.",
      idempotencyKey,
    }).success,
    true,
  );
});

test("preference changes only allow implemented path and operation pairs", () => {
  assert.equal(
    preferenceChangeSchema.safeParse({
      path: "depth",
      operation: "increase",
      value: 10,
      explanation: "Prefer more depth.",
    }).success,
    true,
  );
  assert.equal(
    preferenceChangeSchema.safeParse({
      path: "sourcePreferences",
      operation: "add",
      value: "Primary sources",
      explanation: "Prefer primary sources.",
    }).success,
    false,
  );
  assert.equal(
    preferenceChangeSchema.safeParse({
      path: "knowledgeState",
      operation: "increase",
      value: "Biology",
      explanation: "This operation has no defined behavior.",
    }).success,
    false,
  );
});

test("preference parsing receives both positive and negative interest context", () => {
  assert.deepEqual(
    buildPreferenceCommandInput({
      command: "Less startup news",
      currentPreferences: { novelty: 60 },
      currentInterests: {
        active: ["Startups", "Urban planning"],
        muted: ["Celebrity news"],
      },
    }),
    {
      command: "Less startup news",
      currentPreferences: { novelty: 60 },
      currentInterests: {
        active: ["Startups", "Urban planning"],
        muted: ["Celebrity news"],
      },
    },
  );
});

test("preference commands can report an explicit no-op", () => {
  assert.equal(
    parsedPreferenceCommandSchema.safeParse({
      changes: [],
      confirmation: "That topic was not an active interest.",
    }).success,
    true,
  );
  assert.equal(
    feedCommandResponseSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      status: "no-op",
      changes: [],
      message: "That request did not change your current edition preferences.",
    }).success,
    true,
  );
});

test("article generation carries muted interests as negative topic signals", () => {
  const input = buildArticleGenerationInput(
    {
      userId: "00000000-0000-4000-8000-000000000001",
      goals: [],
      interests: ["Urban planning"],
      mutedInterests: ["Startups"],
      knowledgeState: [],
      recentTitles: [],
      preferredLength: "standard",
      depth: 60,
      novelty: 60,
      allowedCategories: ["business"],
    },
    "2026-09-03",
  );

  assert.deepEqual(input.reader.mutedInterestsToAvoid, ["Startups"]);
  assert.deepEqual(input.reader.interests, ["Urban planning"]);
});

test("direct interest controls validate explicit-only public states", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    createExplicitInterestRequestSchema.parse({
      topic: "  Synthetic biology  ",
    }),
    { topic: "Synthetic biology" },
  );
  assert.equal(
    createExplicitInterestRequestSchema.safeParse({ topic: " ".repeat(8) })
      .success,
    false,
  );
  assert.equal(
    createExplicitInterestRequestSchema.safeParse({ topic: "x".repeat(201) })
      .success,
    false,
  );
  assert.equal(
    updateExplicitInterestRequestSchema.safeParse({ status: "muted" })
      .success,
    true,
  );
  assert.equal(
    updateExplicitInterestRequestSchema.safeParse({ status: "deleted" })
      .success,
    false,
  );
  assert.equal(
    updatePreferencesRequestSchema.safeParse({
      inferredPreferences: ["Do not allow direct mutation"],
    }).success,
    false,
  );
  assert.equal(updatePreferencesRequestSchema.safeParse({}).success, false);
  assert.equal(
    updatePreferencesRequestSchema.safeParse({ timezone: "America/New_York" })
      .success,
    true,
  );
  assert.equal(
    updatePreferencesRequestSchema.safeParse({ timezone: "Not/A_Zone" }).success,
    false,
  );
  assert.equal(
    removeInferredPreferenceRequestSchema.safeParse({
      preference: "Synthetic biology",
    }).success,
    true,
  );
  assert.equal(
    removeInferredPreferenceRequestSchema.safeParse({
      preference: "Synthetic biology",
      unsupported: true,
    }).success,
    false,
  );
  assert.equal(
    explicitInterestSchema.safeParse({
      id,
      topic: "Synthetic biology",
      status: "active",
    }).success,
    true,
  );
  assert.equal(
    explicitInterestsResponseSchema.safeParse({
      items: [{ id, topic: "Synthetic biology", status: "deleted" }],
    }).success,
    false,
  );
});

test("MVP generation only accepts implemented job and article categories", () => {
  assert.equal(articleCategorySchema.safeParse("tech-science").success, true);
  assert.equal(articleCategorySchema.safeParse("for-you").success, false);
  assert.equal(
    createGenerationJobSchema.safeParse({
      kind: "feed-replenishment",
      topic: "The history of public libraries",
      idempotencyKey: "generation-request-1",
    }).success,
    true,
  );
  assert.equal(
    createGenerationJobSchema.safeParse({
      kind: "feed-replenishment",
      category: "sports",
      idempotencyKey: "generation-request-sports",
    }).success,
    true,
  );
  assert.equal(
    createGenerationJobSchema.safeParse({
      kind: "feed-replenishment",
      category: "for-you",
      idempotencyKey: "generation-request-for-you",
    }).success,
    false,
  );
  assert.equal(
    createGenerationJobSchema.safeParse({
      kind: "article-follow-up",
      articleId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "generation-request-2",
    }).success,
    false,
  );
});

test("category settings are complete, unique, and keep one section visible", () => {
  const settings = articleCategories.map((category, position) => ({
    category,
    position,
    visible: position === 0,
  }));
  assert.equal(categorySettingsSchema.safeParse(settings).success, true);
  assert.equal(
    categorySettingsSchema.safeParse(
      settings.map((setting) => ({ ...setting, visible: false })),
    ).success,
    false,
  );
  assert.equal(
    categorySettingsSchema.safeParse([
      ...settings.slice(0, -1),
      { ...settings[0], position: settings.length - 1 },
    ]).success,
    false,
  );
});

test("reader timezones must be recognized by the runtime", () => {
  assert.equal(timeZoneSchema.safeParse("America/New_York").success, true);
  assert.equal(timeZoneSchema.safeParse("UTC").success, true);
  assert.equal(timeZoneSchema.safeParse("Definitely/Not_A_Zone").success, false);
});

const generatedArticle = {
  category: "tech-science",
  kicker: "Science",
  topic: "A test topic",
  title: "A generated article",
  deck: "A test deck.",
  summary: ["First", "Second", "Third"],
  whyWritten: "It advances a stated learning goal.",
  readingMinutes: 6,
  body: Array.from({ length: 6 }, (_, index) => ({
    type: "heading" as const,
    level: 2 as const,
    text: `Section ${index + 1}`,
  })),
  sources: [
    {
      key: "source-1",
      title: "Source one",
      publisher: "Example Institute",
      url: "https://example.com/one",
      publishedAt: null,
    },
    {
      key: "source-2",
      title: "Source two",
      publisher: "Example Institute",
      url: "https://example.com/two",
      publishedAt: null,
    },
  ],
};

test("generated articles require unique source keys and URLs", () => {
  assert.equal(generatedArticleSchema.safeParse(generatedArticle).success, true);
  assert.equal(
    generatedArticleSchema.safeParse({
      ...generatedArticle,
      sources: generatedArticle.sources.map((source) => ({
        ...source,
        key: "duplicate",
      })),
    }).success,
    false,
  );
  assert.equal(
    generatedArticleSchema.safeParse({
      ...generatedArticle,
      sources: generatedArticle.sources.map((source) => ({
        ...source,
        url: "https://example.com/duplicate",
      })),
    }).success,
    false,
  );
});
