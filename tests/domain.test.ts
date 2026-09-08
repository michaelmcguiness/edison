import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyEditionIdempotencyKey,
  dailyEditionTimeInZone,
  decodeFeedCursor,
  encodeFeedCursor,
  estimatedArticleCostMicrousd,
  nextReadingStreak,
  partitionInterestSignals,
  resolveActiveInterestRemoval,
  slugifyArticleTitle,
} from "../packages/domain/src/index";

test("daily editions use each reader's local calendar date and hour", () => {
  const instant = new Date("2026-09-03T02:30:00.000Z");
  assert.deepEqual(dailyEditionTimeInZone(instant, "America/New_York"), {
    dateKey: "2026-09-02",
    hour: 22,
  });
  assert.deepEqual(dailyEditionTimeInZone(instant, "Asia/Kathmandu"), {
    dateKey: "2026-09-03",
    hour: 8,
  });
});

test("daily edition scheduling isolates invalid stored timezones", () => {
  assert.equal(
    dailyEditionTimeInZone(new Date("2026-09-03T02:30:00.000Z"), "Not/AZone"),
    null,
  );
});

test("daily edition slots have stable per-day idempotency keys", () => {
  assert.equal(
    dailyEditionIdempotencyKey("2026-09-03", 2),
    "daily-edition:2026-09-03:slot:2",
  );
  assert.notEqual(
    dailyEditionIdempotencyKey("2026-09-03", 2),
    dailyEditionIdempotencyKey("2026-09-03", 3),
  );
  assert.notEqual(
    dailyEditionIdempotencyKey("2026-09-03", 2),
    dailyEditionIdempotencyKey("2026-09-04", 2),
  );
});

test("feed cursors round-trip without exposing pagination syntax", () => {
  const cursor = {
    editionDate: "2026-09-02",
    rank: "12.500000",
    id: "8c7b5448-f2d7-4e8a-b388-b7fab50d657b",
  };
  assert.deepEqual(decodeFeedCursor(encodeFeedCursor(cursor)), cursor);
  assert.throws(() => decodeFeedCursor("not-a-cursor"), /invalid_feed_cursor/);
  assert.throws(
    () =>
      decodeFeedCursor(
        Buffer.from(
          JSON.stringify({ ...cursor, editionDate: "2026-99-99" }),
        ).toString("base64url"),
      ),
    /invalid_feed_cursor/,
  );
  assert.throws(
    () =>
      decodeFeedCursor(
        Buffer.from(JSON.stringify({ ...cursor, rank: "not-a-number" })).toString(
          "base64url",
        ),
      ),
    /invalid_feed_cursor/,
  );
});

test("reading streaks increment once per local calendar day", () => {
  assert.deepEqual(
    nextReadingStreak({
      currentStreak: 4,
      lastReadDate: "2026-09-01",
      readDate: "2026-09-02",
    }),
    { currentStreak: 5, lastReadDate: "2026-09-02" },
  );
  assert.deepEqual(
    nextReadingStreak({
      currentStreak: 5,
      lastReadDate: "2026-09-02",
      readDate: "2026-09-02",
    }),
    { currentStreak: 5, lastReadDate: "2026-09-02" },
  );
});

test("a missed day resets the streak", () => {
  assert.equal(
    nextReadingStreak({
      currentStreak: 12,
      lastReadDate: "2026-08-30",
      readDate: "2026-09-02",
    }).currentStreak,
    1,
  );
});

test("article titles become stable URL-safe slugs", () => {
  assert.equal(
    slugifyArticleTitle("Why Cities Remember What People Forget"),
    "why-cities-remember-what-people-forget",
  );
});

test("cost estimates use integer microdollars", () => {
  assert.equal(
    estimatedArticleCostMicrousd({
      model: "gpt-5.6-terra",
      inputTokens: 10_000,
      cachedInputTokens: 2_000,
      outputTokens: 2_000,
      webSearchCalls: 3,
    }),
    40_400,
  );
});

test("cost estimates fail closed for an unknown or loosely matched model", () => {
  const estimate = (model: string) =>
    estimatedArticleCostMicrousd({
      model,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      webSearchCalls: 0,
    });

  assert.throws(() => estimate("future-model"), /unpriced_openai_model/);
  assert.throws(() => estimate("custom-luna-proxy"), /unpriced_openai_model/);
  assert.doesNotThrow(() => estimate("gpt-5.6-luna-2026-09-04"));
});

test("interest signals preserve active and muted preference context", () => {
  assert.deepEqual(
    partitionInterestSignals([
      { topic: "Urban planning", status: "active" },
      { topic: "Startups", status: "muted" },
      { topic: "STARTUPS", status: "muted" },
      { topic: "Old topic", status: "deleted" },
    ]),
    {
      active: ["Urban planning"],
      muted: ["Startups"],
    },
  );
});

test("interest removals only resolve currently active matching topics", () => {
  const interests = [
    { id: "active-id", topic: "Startups", status: "active" },
    { id: "muted-id", topic: "Celebrity news", status: "muted" },
  ];

  assert.deepEqual(
    resolveActiveInterestRemoval(
      [" startups ", "Celebrity news", "Unknown topic"],
      interests,
    ),
    { ids: ["active-id"], topics: ["Startups"] },
  );
  assert.deepEqual(
    resolveActiveInterestRemoval(["Unknown topic"], interests),
    { ids: [], topics: [] },
  );
});
