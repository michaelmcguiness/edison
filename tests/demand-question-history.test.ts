import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertReaderFirstPreviousMessages, type ReaderFirstPreviousMessage } from "../packages/ai/src/reader-first";
import type { OnDemandEvidence } from "../packages/ai/src/on-demand";
import { demandQuestionHistory } from "../apps/api/src/services/demand-question-history";
import { demandArtifactId } from "../apps/api/src/services/demand-publication";

// Saved-answer fixtures exercise identity and retention, not factual quality or
// live retrieval. No provider, database, or network calls are made here.
const earlier = "2026-09-06T10:00:00.000Z";
const later = "2026-09-06T11:00:00.000Z";
const empty: OnDemandEvidence = { sources: [], passages: [] };
function packet(url = "https://research.example.org/one", retrievedAt = earlier, text = "Retrieved answer-specific evidence."): OnDemandEvidence {
  return { sources: [{ id: "source1", url, title: "Saved report", publisher: "Research",
    publishedDate: null, datePrecision: "unknown" }], passages: [
    { id: "passage1", sourceId: "source1", text, locator: "Results", provenance: "retrieved", retrievedAt },
  ] };
}
function entry(id: string, evidence = packet(), accessedAt = evidence.passages[0].retrievedAt!) {
  const displayId = demandArtifactId(`${id}:source:source1`);
  return { id, snapshot: { question: { question: `Question ${id}`, articleVersion: "article-version", evidence } },
    result: { evidence, answer: { version: 2 as const, basis: "mixed" as const, researchedAt: accessedAt,
      body: [{ type: "paragraph" as const, text: `Answer ${id} cites source [1].`, citations: [{ sourceId: displayId, label: "1" }] }],
      sources: [{ id: displayId, title: `Displayed report ${id}`, publisher: "Research", url: evidence.sources[0].url,
        publishedAt: null, accessedAt }] } } };
}
function assistants(messages: ReaderFirstPreviousMessage[]) {
  return messages.filter((message) => message.role === "assistant");
}
function reference(messages: ReaderFirstPreviousMessage[], index = 0) { return assistants(messages)[index].references![0]; }
function generatedKey(kind: "s" | "p", value: string) {
  return `qh-${kind}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

test("source-free article keeps each answer's separate source [1] identity and support", () => {
  const first = entry("first");
  const second = entry("second", packet("https://research.example.org/two", later));
  const result = demandQuestionHistory({ articleEvidence: empty, history: [first, second] });
  const one = reference(result.previousMessages);
  const two = reference(result.previousMessages, 1);
  assert.deepEqual(result.previousMessages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
  assert.deepEqual([one.label, two.label], ["1", "1"]);
  assert.notEqual(one.sourceId, two.sourceId);
  assert.notEqual(one.evidenceSourceKey, two.evidenceSourceKey);
  assert.equal(one.url, first.result.answer.sources[0].url);
  assert.equal(two.title, second.result.answer.sources[0].title);
  assert.equal(result.evidence.sources.length, 2);
  for (const mapping of [one, two]) {
    assert.equal(result.evidence.passages.find((passage) => passage.id === mapping.passageIds[0])?.sourceId, mapping.evidenceSourceKey);
  }
  assertReaderFirstPreviousMessages(result.previousMessages, result.evidence);
});

test("same URL deduplicates source identity while preserving exact retrieval versions", () => {
  const first = entry("first", packet(undefined, earlier, "Original wording."));
  const second = entry("second", packet(undefined, later, "Updated wording."));
  const result = demandQuestionHistory({ articleEvidence: empty, history: [first, second] });
  const one = reference(result.previousMessages);
  const two = reference(result.previousMessages, 1);
  assert.equal(result.evidence.sources.length, 1);
  assert.equal(result.evidence.passages.length, 2);
  assert.equal(one.evidenceSourceKey, two.evidenceSourceKey);
  assert.notDeepEqual(one.passageIds, two.passageIds);
  assert.equal(result.evidence.passages.find((passage) => passage.id === one.passageIds[0])?.retrievedAt, earlier);
  assert.equal(result.evidence.passages.find((passage) => passage.id === two.passageIds[0])?.retrievedAt, later);
});

test("identical passage text at different retrieval times remains separate", () => {
  const result = demandQuestionHistory({ articleEvidence: empty, history: [entry("first"), entry("second", packet(undefined, later))] });
  assert.equal(result.evidence.passages.length, 2);
  assert.notDeepEqual(reference(result.previousMessages).passageIds, reference(result.previousMessages, 1).passageIds);
});

test("duplicate saved versions reuse exact source and passage identities", () => {
  const result = demandQuestionHistory({ articleEvidence: packet(), history: [entry("first"), entry("second")] });
  assert.deepEqual(result.evidence, packet());
  assert.equal(reference(result.previousMessages).evidenceSourceKey, "source1");
  assert.deepEqual(reference(result.previousMessages).passageIds, ["passage1"]);
  assert.deepEqual(reference(result.previousMessages, 1).passageIds, ["passage1"]);
});

test("collision-safe generated keys never overwrite original article evidence", () => {
  const historical = packet();
  const desiredSourceKey = generatedKey("s", historical.sources[0].url);
  const passage = historical.passages[0];
  const identity = JSON.stringify([historical.sources[0].url, passage.text, passage.locator, passage.provenance, passage.retrievedAt]);
  const desiredPassageKey = generatedKey("p", identity);
  const article = packet("https://article.example.org/original");
  article.sources[0].id = desiredSourceKey;
  article.passages[0].sourceId = desiredSourceKey;
  article.passages[0].id = desiredPassageKey;
  const before = structuredClone(article);
  const result = demandQuestionHistory({ articleEvidence: article, history: [entry("first", historical)] });
  const mapping = reference(result.previousMessages);
  assert.notEqual(mapping.evidenceSourceKey, desiredSourceKey);
  assert.notEqual(mapping.passageIds[0], desiredPassageKey);
  assert.deepEqual(result.evidence.sources[0], before.sources[0]);
  assert.deepEqual(result.evidence.passages[0], before.passages[0]);
  assert.ok(result.evidence.sources.every((source) => source.id.length <= 40));
  assert.ok(result.evidence.passages.every((item) => item.id.length <= 40));
});

test("article, saved result and snapshot inputs remain immutable and replay is deterministic", () => {
  const input = { articleEvidence: packet("https://article.example.org/original"), history: [entry("one"), entry("two", packet(undefined, later))] };
  const before = structuredClone(input);
  const first = demandQuestionHistory(input);
  const second = demandQuestionHistory(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  first.evidence.sources[0].title = "Local mutation";
  assert.deepEqual(input, before);
});

test("newest answer gets remaining source slot and unavailable older reference remains honest", () => {
  const article: OnDemandEvidence = { sources: Array.from({ length: 15 }, (_, index) => ({ ...packet(`https://article.example.org/${index}`).sources[0], id: `a${index}` })), passages: [] };
  const result = demandQuestionHistory({ articleEvidence: article, history: [entry("older"), entry("newer", packet("https://research.example.org/two", later))] });
  const oldReference = reference(result.previousMessages);
  assert.equal(result.evidence.sources.length, 16);
  assert.equal(oldReference.url, "https://research.example.org/one");
  assert.equal(oldReference.title, "Displayed report older");
  assert.equal(oldReference.accessedAt, earlier);
  assert.equal(oldReference.evidenceSourceKey, null);
  assert.deepEqual(oldReference.passageIds, []);
  assert.ok(reference(result.previousMessages, 1).evidenceSourceKey);
});

test("passage ceiling preserves versions without borrowing a same-URL newer passage", () => {
  const article = packet();
  article.passages = Array.from({ length: 47 }, (_, index) => ({ ...article.passages[0], id: `a${index}`, text: `Article passage ${index}` }));
  const result = demandQuestionHistory({ articleEvidence: article, history: [entry("older"), entry("newer", packet(undefined, later))] });
  assert.equal(result.evidence.passages.length, 48);
  assert.equal(reference(result.previousMessages).evidenceSourceKey, null);
  assert.deepEqual(reference(result.previousMessages).passageIds, []);
  assert.equal(reference(result.previousMessages, 1).evidenceSourceKey, "source1");
});

test("byte ceiling refuses a whole oversized source version without changing identity", () => {
  const article = packet("https://article.example.org/original");
  article.passages = Array.from({ length: 3 }, (_, index) => ({ ...article.passages[0], id: `a${index}`, text: "a".repeat(12_000) }));
  const result = demandQuestionHistory({ articleEvidence: article, history: [entry("large", packet(undefined, earlier, "b".repeat(5000)))] });
  assert.deepEqual(result.evidence, article);
  assert.equal(reference(result.previousMessages).url, "https://research.example.org/one");
  assert.equal(reference(result.previousMessages).evidenceSourceKey, null);
  assert.ok(Buffer.byteLength(JSON.stringify(result.evidence)) <= 40_000);
});

test("final evidence takes precedence and invalid present evidence never falls back", () => {
  const historical = entry("one");
  const mismatched = packet("https://unrelated.example.org/report");
  for (const evidence of [null, {}, mismatched]) {
    const result = demandQuestionHistory({ articleEvidence: empty, history: [{ ...historical, result: { ...historical.result, evidence } }] });
    assert.equal(reference(result.previousMessages).evidenceSourceKey, null);
    assert.deepEqual(result.evidence, empty);
  }
  const result = demandQuestionHistory({ articleEvidence: empty, history: [{ ...historical, result: { answer: historical.result.answer } }] });
  assert.ok(reference(result.previousMessages).evidenceSourceKey);
});

test("model-reported text and unsupported display timestamps are not retained support", () => {
  const historical = entry("one");
  historical.result.evidence.passages[0].provenance = "model_reported";
  historical.result.evidence.passages[0].retrievedAt = null;
  const model = demandQuestionHistory({ articleEvidence: empty, history: [historical] });
  assert.equal(reference(model.previousMessages).evidenceSourceKey, null);
  const stale = demandQuestionHistory({ articleEvidence: empty, history: [entry("one", packet(), later)] });
  assert.equal(reference(stale.previousMessages).evidenceSourceKey, null);
});

test("displayed latest retrieval retains real earlier passages but excludes later versions", () => {
  const evidence = packet();
  evidence.passages.push({ ...evidence.passages[0], id: "second", text: "Later saved support", retrievedAt: later });
  evidence.passages.push({ ...evidence.passages[0], id: "future", text: "A different later version", retrievedAt: "2026-09-06T12:00:00.000Z" });
  const result = demandQuestionHistory({ articleEvidence: empty, history: [entry("one", evidence, later)] });
  assert.deepEqual(result.evidence.passages.map((passage) => passage.retrievedAt), [earlier, later]);
  assert.equal(reference(result.previousMessages).passageIds.length, 2);
});

test("legacy source IDs resolve only against their saved article version and retain original prose", () => {
  const evidence = packet();
  const sourceId = demandArtifactId("article-version:source:source1");
  const result = demandQuestionHistory({ articleEvidence: empty, history: [{ id: "legacy",
    snapshot: { question: { articleVersion: "article-version", question: "What did [1] mean?", evidence } },
    result: { answer: { text: "The original legacy answer.", sourceIds: ["unresolvable", sourceId, sourceId] } } }] });
  const message = assistants(result.previousMessages)[0];
  assert.equal(message.text, "The original legacy answer.");
  assert.equal(message.references!.length, 1);
  assert.equal(message.references![0].label, "1");
  assert.equal(message.references![0].sourceId, sourceId);
  assert.ok(message.references![0].evidenceSourceKey);
});

test("quote attribution survives historical answer prose and reference identity", () => {
  const historical = entry("one");
  const result = demandQuestionHistory({ articleEvidence: empty, history: [{ ...historical, result: { ...historical.result,
    answer: { ...historical.result.answer, body: [{ type: "quote", text: "Quoted finding", attribution: "Original researcher", citations: historical.result.answer.body[0].citations }] } } }] });
  assert.equal(assistants(result.previousMessages)[0].text, "Quoted finding — Original researcher");
});

test("the helper refuses oversized original packets and more than six prior answers", () => {
  assert.throws(() => demandQuestionHistory({ articleEvidence: empty, history: Array.from({ length: 7 }, (_, index) => entry(String(index))) }), /bounded conversation/);
  const oversized = packet();
  oversized.passages = Array.from({ length: 4 }, (_, index) => ({ ...oversized.passages[0], id: `p${index}`, text: "a".repeat(12_000) }));
  assert.throws(() => demandQuestionHistory({ articleEvidence: oversized, history: [] }), /bounded packet/);
});
