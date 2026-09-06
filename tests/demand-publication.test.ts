import assert from "node:assert/strict";
import test from "node:test";
import { uuidSchema } from "@edison/contracts";
import type { OnDemandCheckOutput, OnDemandWriterOutput, SelectedOnDemandInput } from "../packages/ai/src/on-demand";
import { demandArtifactId, demandFeedbackOperations, publishableDemandArticle } from "../apps/api/src/services/demand-publication";

const selected: SelectedOnDemandInput = {
  context: { loopId: "test-loop", revision: 1, originalCuriosity: "Test subject", directions: [],
    declaredKnowledge: [], readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-06" },
  idea: { id: "test-idea", key: "idea", loopId: "test-loop", loopRevision: 0,
    headline: "A test headline", deck: "A test deck", readerQuestion: "What does the test show?",
    payoff: "A bounded explanation", advanceBeyondPrevious: "No prior reading", qualifications: [], passageIds: ["p1", "p2"] },
  evidence: {
    sources: ["a", "b"].map((id) => ({ id, url: `https://example.org/${id}`, title: `Test source ${id}`,
      publisher: "example.org", publishedDate: null, datePrecision: "unknown" as const })),
    passages: ["a", "b"].map((sourceId, index) => ({ id: `p${index + 1}`, sourceId,
      text: "A synthetic source passage for validating publication mapping only.", locator: "Test paragraph",
      provenance: "retrieved" as const, retrievedAt: "2026-09-06T10:00:00.000Z" })),
  },
};
const draft: OnDemandWriterOutput = {
  status: "written", reason: null,
  article: {
    category: "tech-science", kicker: "Test", topic: "Test subject", title: "A test headline", deck: "A test deck",
    summary: ["First test point", "Second test point", "Third test point"], whyWritten: "A useful test explanation", readingMinutes: 3,
    body: Array.from({ length: 6 }, () => ({ type: "paragraph" as const, text: "This is synthetic test prose with one supported test assertion.",
      citations: [{ sourceKey: "a", label: "Incorrect model label" }, { sourceKey: "b", label: "Another label" }] })),
    sources: selected.evidence.sources.map((source) => ({ key: source.id, title: source.title, publisher: source.publisher, url: source.url, publishedAt: null })),
  },
  claims: [{ id: "claim", text: "The test assertion", locations: ["title", "deck", "summary.0", "summary.1", "summary.2", ...Array.from({ length: 6 }, (_, index) => `body.${index}`)], passageIds: ["p1", "p2"] }],
};
const check: OnDemandCheckOutput = {
  verdict: "pass", promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true,
  sourceMetadataPassed: true, missedMaterialClaims: [], findings: [],
  claims: [{ claimId: "claim", verdict: "supported", passageIds: ["p1", "p2"], reason: "Synthetic test acceptance" }],
};
const input = { requestId: "4c8c3c82-67c6-421e-a55b-76b8e0027c7d", selection: selected, draft, check, publishedAt: "2026-09-06T11:00:00.000Z" };

test("published sources/citations have stable IDs, retained metadata, and measured read time", () => {
  const article = publishableDemandArticle(input);
  assert.deepEqual(article, publishableDemandArticle(input));
  assert.equal(article.title, selected.idea.headline);
  assert.equal(article.readingMinutes, 1);
  assert.equal(article.sourceCount, 2);
  assert.equal(article.sources[0].publishedAt, null);
  assert.equal(article.researchedAt, "2026-09-06T10:00:00.000Z");
  assert.equal(article.shareId, null);
  const block = article.body[0];
  assert.equal(block.type, "paragraph");
  assert.deepEqual(block.citations, article.sources.map((source, index) => ({ sourceId: source.id, label: String(index + 1) })));
  article.sources.forEach((source) => assert.ok(uuidSchema.safeParse(source.id).success));
});

test("a failed editorial check never materializes a ready article", () => {
  assert.throws(() => publishableDemandArticle({ ...input, check: { ...check, privacyPassed: false } }), /editorial_withheld/);
  assert.throws(() => publishableDemandArticle({ ...input, check: { ...check, missedMaterialClaims: [{ location: "deck", text: "Unmapped claim" }] } }), /editorial_withheld/);
  assert.throws(() => publishableDemandArticle({ ...input, check: { ...check, claims: [] } }), /editorial_withheld/);
  assert.throws(() => publishableDemandArticle({ ...input, check: { ...check, claims: [{ claimId: "invented", verdict: "supported", passageIds: ["p1"], reason: "Not this writer's claim" }] } }), /editorial_withheld/);
});

test("model-reported passage text cannot become a source just through publication", () => {
  const selection = structuredClone(selected);
  selection.evidence.passages[0].provenance = "model_reported";
  selection.evidence.passages[0].retrievedAt = null;
  assert.throws(() => publishableDemandArticle({ ...input, selection }), /independently retrieved/);
});

test("feedback materialization is additive and assigns stable server IDs", () => {
  const output = { status: "changes" as const, message: "Candidate interpretation", operations: [
    { type: "set" as const, targetPrincipleId: null, kind: "preference" as const, instruction: "Use more examples" },
    { type: "set" as const, targetPrincipleId: "existing", kind: "preference" as const, instruction: "Keep it shorter" },
  ] };
  const operations = demandFeedbackOperations(input.requestId, output);
  assert.deepEqual(operations, demandFeedbackOperations(input.requestId, output));
  assert.equal(operations[0].op, "add");
  assert.equal(operations[1].op, "replace");
  assert.notEqual(demandArtifactId("reader-a"), demandArtifactId("reader-b"));
  assert.throws(() => demandFeedbackOperations(input.requestId, { status: "clarification", operations: [], message: "Please clarify" }), /feedback_unclear/);
});
