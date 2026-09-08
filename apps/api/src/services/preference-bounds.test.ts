import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  knowledgeStateSchema,
  maxKnowledgeStateItems,
  maxRetainedExplicitInterests,
} from "@edison/contracts";
import {
  applyKnowledgeStateChange,
  canRetainExplicitInterest,
  retainedExplicitInterestCount,
  type KnowledgeStateEntry,
} from "./preference-bounds";

function interest(
  index: number,
  status: "active" | "muted" | "deleted" = "active",
  kind = "explicit",
) {
  return { id: String(index), kind, status };
}

function knowledge(index: number): KnowledgeStateEntry {
  return {
    topic: `Topic ${index}`,
    level: "intermediate",
    note: `Context ${index}`,
  };
}

test("the retained explicit-interest cap counts active and muted truth", () => {
  const interests = Array.from(
    { length: maxRetainedExplicitInterests },
    (_, index) => interest(index, index % 2 ? "active" : "muted"),
  );
  interests.push(interest(100, "deleted"));
  interests.push(interest(101, "active", "inferred"));

  assert.equal(retainedExplicitInterestCount(interests), 50);
  assert.equal(canRetainExplicitInterest(interests), false);
  assert.equal(canRetainExplicitInterest(interests, interests[0]), true);
  assert.equal(canRetainExplicitInterest(interests, interests[50]), false);
});

test("knowledge-state additions stop at the durable limit and report partial truth", () => {
  const existing = Array.from(
    { length: maxKnowledgeStateItems - 1 },
    (_, index) => knowledge(index),
  );
  const result = applyKnowledgeStateChange(existing, {
    path: "knowledgeState",
    operation: "add",
    value: ["Last retained topic", "Over capacity"],
    explanation: "The reader said they already know these topics.",
  });

  assert.equal(result.knowledgeState.length, maxKnowledgeStateItems);
  assert.deepEqual(result.appliedTopics, ["Last retained topic"]);
  assert.equal(
    result.knowledgeState.some((entry) => entry.topic === "Over capacity"),
    false,
  );
});

test("knowledge-state updates remain possible at capacity without reordering", () => {
  const existing = Array.from(
    { length: maxKnowledgeStateItems },
    (_, index) => knowledge(index),
  );
  const result = applyKnowledgeStateChange(existing, {
    path: "knowledgeState",
    operation: "add",
    value: "topic 4",
    explanation: "Updated context from the reader.",
  });

  assert.equal(result.knowledgeState.length, maxKnowledgeStateItems);
  assert.equal(result.knowledgeState[4]?.topic, "topic 4");
  assert.equal(
    result.knowledgeState[4]?.note,
    "Updated context from the reader.",
  );
  assert.deepEqual(result.appliedTopics, ["topic 4"]);
});

test("knowledge-state removal frees capacity and no-op updates preserve order", () => {
  const existing = Array.from(
    { length: maxKnowledgeStateItems },
    (_, index) => knowledge(index),
  );
  const removed = applyKnowledgeStateChange(existing, {
    path: "knowledgeState",
    operation: "remove",
    value: "TOPIC 0",
    explanation: "Remove stale context.",
  });
  const restored = applyKnowledgeStateChange(removed.knowledgeState, {
    path: "knowledgeState",
    operation: "add",
    value: "A newly retained topic",
    explanation: "New context from the reader.",
  });
  const noOp = applyKnowledgeStateChange(restored.knowledgeState, {
    path: "knowledgeState",
    operation: "add",
    value: "A newly retained topic",
    explanation: "New context from the reader.",
  });

  assert.deepEqual(removed.appliedTopics, ["Topic 0"]);
  assert.deepEqual(restored.appliedTopics, ["A newly retained topic"]);
  assert.deepEqual(noOp.appliedTopics, []);
  assert.deepEqual(noOp.knowledgeState, restored.knowledgeState);
});

test("contracts and provider snapshots reject oversized knowledge state", () => {
  const oversized = Array.from(
    { length: maxKnowledgeStateItems + 1 },
    (_, index) => knowledge(index),
  );
  assert.equal(knowledgeStateSchema.safeParse(oversized).success, false);

  const snapshotSource = readFileSync(
    new URL("./ai-request-snapshots.ts", import.meta.url),
    "utf8",
  );
  const generationSource = readFileSync(
    new URL("../../workflows/generate-article.ts", import.meta.url),
    "utf8",
  );
  assert.match(snapshotSource, /knowledgeState: knowledgeStateSchema/);
  assert.match(generationSource, /knowledgeState: knowledgeStateSchema/);
});

test("both interest write paths share one capacity rule and lock identity", () => {
  const workflowSource = readFileSync(
    new URL("../../workflows/apply-feed-command.ts", import.meta.url),
    "utf8",
  );
  const directRouteSource = readFileSync(
    new URL("../../app/v1/me/interests/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(workflowSource, /canRetainExplicitInterest\(interests, explicit\)/);
  assert.match(directRouteSource, /canRetainExplicitInterest\(interests/);
  assert.match(workflowSource, /edison-interests:/);
  assert.match(directRouteSource, /edison-interests:/);
});

test("provider context includes every retained explicit interest deterministically", () => {
  const generationSource = readFileSync(
    new URL("../../workflows/generate-article.ts", import.meta.url),
    "utf8",
  );
  const commandRouteSource = readFileSync(
    new URL("../../app/v1/feed/commands/route.ts", import.meta.url),
    "utf8",
  );

  for (const source of [generationSource, commandRouteSource]) {
    assert.match(source, /eq\(userInterests\.kind, "explicit"\)/);
    assert.match(
      source,
      /inArray\(userInterests\.status, \["active", "muted"\]\)/,
    );
    assert.match(
      source,
      /orderBy\(asc\(userInterests\.createdAt\), asc\(userInterests\.id\)\)/,
    );
    assert.match(source, /limit\(maxRetainedExplicitInterests\)/);
  }
});

test("production readiness requires both database preference guards", () => {
  const healthSource = readFileSync(
    new URL("../../app/v1/health/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(healthSource, /feed_preferences_knowledge_state_bounded/);
  assert.match(healthSource, /user_interests_retained_explicit_limit/);
});

test("database guards use the same public capacity constants", () => {
  const migrationSource = readFileSync(
    new URL(
      "../../../../supabase/migrations/20260904192144_preference_bounds.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(maxKnowledgeStateItems, 80);
  assert.equal(maxRetainedExplicitInterests, 50);
  assert.match(migrationSource, /jsonb_array_length\(state_value\) > 80/);
  assert.match(migrationSource, /HAVING count\(\*\) > 50/);
  assert.match(migrationSource, /retained_count >= 50/);
  assert.match(migrationSource, /edison-interests:/);
});
