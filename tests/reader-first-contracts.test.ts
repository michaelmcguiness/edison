import assert from "node:assert/strict";
import test from "node:test";
import {
  articleSchema,
  demandAnswerSchema,
  demandAnswerV2Schema,
  demandArticleSchema,
  sharedArticleSnapshotSchema,
} from "@edison/contracts";

const now = "2026-09-06T23:00:00.000Z";
const source = {
  id: "00000000-0000-4000-8000-000000000011",
  title: "A source consulted for this result",
  publisher: "Example Institute",
  url: "https://example.com/explanation",
  publishedAt: null,
  accessedAt: now,
};
const prose = { type: "paragraph" as const, text: "A familiar concept, explained directly.", citations: [] };
const citedProse = { ...prose, citations: [{ sourceId: source.id, label: "1" }] };
const article = {
  id: "00000000-0000-4000-8000-000000000010",
  slug: "familiar-concept",
  category: "tech-science",
  kicker: "Science",
  topic: "A familiar concept",
  title: "How does the concept work?",
  deck: "A direct explanation at the reader’s level.",
  readingMinutes: 1,
  sourceCount: 0,
  researchedAt: null,
  reason: "You asked how this works.",
  summary: ["The core idea", "A concrete example", "Its useful limit"],
  saved: false,
  completed: false,
  body: [prose],
  sources: [],
  writtenFor: "This loop",
  shareId: null,
  basis: "general_knowledge",
};
const answer = { version: 2, body: [prose], sources: [], basis: "general_knowledge", researchedAt: null };

test("reader-first demand articles allow short unresearched factual explanations without weakening legacy contracts", () => {
  const parsed = demandArticleSchema.parse(article);
  assert.equal(parsed.researchedAt, null);
  assert.equal(parsed.basis, "general_knowledge");
  assert.equal(parsed.body.length, 1);
  assert.equal(articleSchema.safeParse(article).success, false);
  const snapshot = {
    version: 1, category: article.category, kicker: article.kicker, topic: article.topic,
    title: article.title, deck: article.deck, body: article.body, summary: article.summary,
    readingMinutes: 1, sourceCount: 0, researchedAt: null, publishedAt: now, sources: [],
  };
  assert.equal(sharedArticleSnapshotSchema.safeParse(snapshot).success, false);
  assert.equal(sharedArticleSnapshotSchema.safeParse({ ...snapshot, researchedAt: now }).success, false);
});

test("historical demand articles infer basis only when absent and never invent a research date", () => {
  const historical = { ...article, basis: undefined };
  const oldResearched = demandArticleSchema.parse({ ...historical, body: [citedProse],
    sourceCount: 1, sources: [source], researchedAt: now });
  assert.equal(oldResearched.basis, "researched");
  assert.equal(oldResearched.researchedAt, now);
  const oldUnresearched = demandArticleSchema.parse({ ...historical, researchedAt: now });
  assert.equal(oldUnresearched.basis, "general_knowledge");
  assert.equal(oldUnresearched.researchedAt, null);
  assert.equal(demandArticleSchema.safeParse({ ...historical, body: [citedProse],
    sourceCount: 1, sources: [source], researchedAt: null }).success, false);
});

test("explicit research basis, timestamp, source count and citation ownership must agree", () => {
  for (const invalid of [
    { ...article, researchedAt: now },
    { ...article, basis: "researched" },
    { ...article, basis: "mixed" },
    { ...article, sourceCount: 1 },
    { ...article, body: [citedProse] },
    { ...article, basis: "mixed", researchedAt: now, sourceCount: 1, sources: [source, source] },
    { ...article, basis: "general_knowledge", researchedAt: now, sourceCount: 1, sources: [source] },
  ]) assert.equal(demandArticleSchema.safeParse(invalid).success, false);
  for (const basis of ["mixed", "researched"]) {
    assert.equal(demandArticleSchema.safeParse({ ...article, basis, researchedAt: now,
      sourceCount: 1, sources: [source], body: [prose, citedProse] }).success, true);
  }
});

test("canonical answers own their citations and support ordinary uncited explanations", () => {
  assert.equal(demandAnswerV2Schema.safeParse(answer).success, true);
  assert.equal(demandAnswerV2Schema.safeParse({ ...answer, basis: "mixed", researchedAt: now,
    sources: [source], body: [prose, citedProse] }).success, true);
  for (const invalid of [
    { ...answer, body: [citedProse] },
    { ...answer, body: [citedProse], sources: [{ ...source, id: "00000000-0000-4000-8000-000000000012" }],
      basis: "researched", researchedAt: now },
    { ...answer, basis: "mixed", researchedAt: now, sources: [source, source] },
    { ...answer, researchedAt: now },
    { ...answer, sourceIds: [source.id] },
    { ...answer, body: [{ type: "heading", level: 2, text: "No answer" }] },
    { ...answer, body: [{ ...prose, text: "a".repeat(8001) }] },
  ]) assert.equal(demandAnswerSchema.safeParse(invalid).success, false);
});

test("historical text/sourceIds answers remain unchanged while malformed v2 cannot fall back to legacy", () => {
  const historical = { text: "An earlier saved answer.", sourceIds: [source.id, "old-missing-reference"] };
  assert.deepEqual(demandAnswerSchema.parse(historical), historical);
  assert.equal(demandAnswerSchema.safeParse({ ...historical, version: 2 }).success, false);
  assert.equal(demandAnswerSchema.safeParse({ ...answer, ...historical }).success, false);
});
