import assert from "node:assert/strict";
import test from "node:test";
import {
  demandAnswerConversationText,
  demandPreviousArticleContext,
  demandQuestionMaterial,
  readDemandStoredDraft,
} from "../apps/api/src/services/demand-result-compatibility";
import {
  onDemandContextSchema,
  onDemandEvidenceSchema,
  onDemandWriterOutputSchema,
} from "../packages/ai/src/on-demand-schemas";
import { readerFirstWriterOutputSchema } from "../packages/ai/src/reader-first-schemas";

// Constructed records test read compatibility, not real source or quality acceptance.
const now = "2026-09-06T23:00:00.000Z";
const articleId = "00000000-0000-4000-8000-000000000031";
const sourceId = "00000000-0000-4000-8000-000000000032";
const context = onDemandContextSchema.parse({
  loopId: "saved-loop", revision: 3, originalCuriosity: "How does a cell respond to a signal?",
  directions: ["Focus on concrete examples"], declaredKnowledge: ["I know the basics of DNA"],
  readingPreferences: ["Keep explanations concise"], preferences: { length: "brief", depth: 60 },
  previousArticles: [{ title: "A previously read explanation", summary: ["Previous reading is not proof of mastery."] }],
  currentDate: "2026-09-06",
});

function evidence(name: string) {
  return onDemandEvidenceSchema.parse({
    sources: [{ id: name, url: `https://example.com/${name}`, title: `${name} source`, publisher: "example.com",
      publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: `${name}-passage`, sourceId: name, text: `Constructed ${name} evidence.`, locator: "Example paragraph",
      provenance: "retrieved", retrievedAt: now }],
  });
}

const legacyDraft = onDemandWriterOutputSchema.parse({
  status: "written", reason: null,
  article: { category: "tech-science", kicker: "Biology", topic: "Cell signals", title: "How does a cell respond?",
    deck: "A concrete illustration of sensing and response.", summary: ["The signal", "The response", "A useful limit"],
    whyWritten: "You asked for a concrete explanation.", readingMinutes: 3,
    body: Array.from({ length: 6 }, (_, index) => ({ type: "paragraph", text: `Saved paragraph ${index + 1}.`,
      citations: [{ sourceKey: "saved", label: "1" }] })),
    sources: [{ key: "saved", title: "Saved source", publisher: "example.com", url: "https://example.com/saved", publishedAt: null }],
  },
  claims: [{ id: "saved-claim", text: "Historical claim bookkeeping.", locations: ["body.0"], passageIds: ["saved-passage"] }],
});
const currentDraft = readerFirstWriterOutputSchema.parse({
  status: "written", reason: null,
  article: { ...legacyDraft.article!, readingMinutes: 1, sources: [],
    body: [{ type: "paragraph", text: "A short familiar concept explained without invented research.", citations: [] }] },
  research: { sources: [], passages: [] },
});

function questionInput(overrides: Partial<Parameters<typeof demandQuestionMaterial>[0]> = {}) {
  return { articleId, articleResult: { draft: currentDraft, evidence: evidence("final") },
    articleProgress: { evidence: evidence("progress") }, articleContext: context, currentContext: context,
    legacyIdeaEvidence: evidence("idea"), currentDate: "2026-09-07", ...overrides };
}

test("saved v1 writer output becomes structural v2 input without rewriting its article or historical bookkeeping", () => {
  const before = structuredClone(legacyDraft);
  const read = readDemandStoredDraft(legacyDraft);
  assert.equal(read.status, "written");
  assert.deepEqual(read.article, legacyDraft.article);
  assert.deepEqual(read.research, { sources: [], passages: [] });
  assert.equal("claims" in read, false);
  assert.deepEqual(legacyDraft, before);
  assert.notEqual(read.article, legacyDraft.article);
  read.article!.title = "A separate in-memory value";
  assert.deepEqual(legacyDraft, before);
});

test("saved v2 output keeps its actual research and short source-less structure", () => {
  assert.deepEqual(readDemandStoredDraft(currentDraft), currentDraft);
  const withResearch = { ...currentDraft, research: {
    sources: evidence("answer-discovery").sources,
    passages: [{ id: "lead", sourceId: "answer-discovery", text: "A discovery lead, not fetched evidence.", locator: "Model-reported lead" }],
  } };
  assert.deepEqual(readDemandStoredDraft(withResearch), withResearch);
});

test("Ask uses final article evidence over progress or older idea evidence and refreshes the question date", () => {
  const input = questionInput();
  const before = structuredClone(input);
  const material = demandQuestionMaterial(input);
  assert.deepEqual(material.evidence, evidence("final"));
  assert.deepEqual(material.context, { ...context, currentDate: "2026-09-07" });
  assert.equal(material.articleVersion, articleId);
  assert.deepEqual(material.draft, currentDraft);
  assert.deepEqual(input, before);
  assert.notEqual(material.context, context);
});

test("new Ask snapshots use current loop knowledge and preferences without changing saved article context or evidence", () => {
  const currentContext = { ...context, revision: context.revision + 1,
    declaredKnowledge: ["I know the basics of DNA", "I understand receptors"],
    readingPreferences: ["Keep explanations shorter and use an everyday analogy"],
    preferences: { length: "brief", depth: 35 },
  };
  const input = questionInput({ currentContext });
  const original = structuredClone(input);
  const material = demandQuestionMaterial(input);
  assert.deepEqual(material.context, { ...currentContext, currentDate: "2026-09-07" });
  assert.deepEqual(material.storedDraft, input.articleResult.draft);
  assert.deepEqual(material.evidence, evidence("final"));
  assert.deepEqual(input, original);
  assert.equal(onDemandContextSchema.parse(input.articleContext).revision, context.revision);
  for (const invalid of [{ ...currentContext, loopId: "another-loop" },
    { ...currentContext, revision: context.revision - 1 },
    { ...currentContext, revision: context.revision, originalCuriosity: "Unversioned replacement" }]) {
    assert.throws(() => demandQuestionMaterial(questionInput({ currentContext: invalid })), /pipeline_snapshot_invalid/);
  }
});

test("explicit revisioned instruction replacement keeps saved article conversation readable without restoring removed direction", () => {
  const currentContext = { ...context, revision: context.revision + 1, originalCuriosity: "Signals",
    directions: [], declaredKnowledge: [], readingPreferences: [] };
  const input = questionInput({ currentContext });
  const before = structuredClone(input);
  const material = demandQuestionMaterial(input);
  assert.equal(material.context.originalCuriosity, "Signals");
  assert.deepEqual(material.context.directions, []);
  assert.deepEqual(material.storedDraft, currentDraft);
  assert.deepEqual(material.evidence, evidence("final"));
  assert.deepEqual(input, before);
});

test("an intentionally source-less final article never borrows old idea research", () => {
  const material = demandQuestionMaterial(questionInput({ articleResult: { draft: currentDraft,
    evidence: { sources: [], passages: [] } } }));
  assert.deepEqual(material.evidence, { sources: [], passages: [] });
  assert.deepEqual(material.draft.article, currentDraft.article);
});

test("legacy articles use progress evidence first and old idea evidence only when both saved result locations are absent", () => {
  const progressRead = demandQuestionMaterial(questionInput({ articleResult: { draft: legacyDraft } }));
  assert.deepEqual(progressRead.evidence, evidence("progress"));
  assert.deepEqual(progressRead.draft.article, legacyDraft.article);
  const oldestRead = demandQuestionMaterial(questionInput({ articleResult: { draft: legacyDraft }, articleProgress: null }));
  assert.deepEqual(oldestRead.evidence, evidence("idea"));
  assert.deepEqual(oldestRead.context, { ...context, currentDate: "2026-09-07" });
});

test("malformed final evidence and unavailable articles fail closed rather than falling back to plausible older evidence", () => {
  assert.throws(() => demandQuestionMaterial(questionInput({ articleResult: { draft: currentDraft,
    evidence: { sources: "not-an-evidence-packet", passages: [] } } })));
  assert.throws(() => demandQuestionMaterial(questionInput({ articleResult: { draft: {
    ...currentDraft, status: "insufficient_evidence", article: null,
  } } })), /article_not_ready/);
  assert.throws(() => demandQuestionMaterial(questionInput({ currentDate: "not-a-date" })));
});

test("conversation text uses canonical v2 body in order and preserves legacy text exactly", () => {
  assert.equal(demandAnswerConversationText({ version: 2, basis: "general_knowledge", researchedAt: null, sources: [],
    body: [{ type: "heading", level: 2, text: "A useful distinction" },
      { type: "paragraph", text: "The direct explanation.", citations: [] },
      { type: "paragraph", text: "Its important limit.", citations: [] }],
  }), "A useful distinction\n\nThe direct explanation.\n\nIts important limit.");
  assert.equal(demandAnswerConversationText({ text: "The exact old answer.\nKeep its line break.", sourceIds: ["old-reference"] }),
    "The exact old answer.\nKeep its line break.");
  assert.throws(() => demandAnswerConversationText({ version: 2, text: "Do not fall back to this malformed result.", sourceIds: [] }));
});

test("previous-article context includes source-less reading and historical sourced articles without leaking private fields", () => {
  const article = { id: articleId, slug: "saved-explanation", category: "tech-science", kicker: "Biology", topic: "Cell signals",
    title: "A source-less explanation", deck: "An ordinary concept.", readingMinutes: 1, sourceCount: 0, researchedAt: null,
    basis: "general_knowledge", reason: "Private reader direction", summary: ["The signal", "The response", "Its limit"],
    saved: false, completed: false, body: [{ type: "paragraph", text: "The explanation.", citations: [] }],
    sources: [], writtenFor: "Private loop context", shareId: null };
  assert.deepEqual(demandPreviousArticleContext(article), [{ title: article.title, summary: article.summary }]);
  const historical = { ...article, basis: undefined, researchedAt: now, sourceCount: 1,
    sources: [{ id: sourceId, title: "Historical source", publisher: "example.com", url: "https://example.com/old",
      publishedAt: null, accessedAt: now }] };
  assert.deepEqual(demandPreviousArticleContext(historical), [{ title: article.title, summary: article.summary }]);
  assert.deepEqual(demandPreviousArticleContext({ ...article, summary: "invalid" }), []);
});

test("quoted answer history preserves attribution without inventing one for unattributed quotes", () => {
  const answer = { version: 2, basis: "mixed", researchedAt: now,
    sources: [{ id: sourceId, title: "Constructed source", publisher: "example.com", url: "https://example.com/quote",
      publishedAt: null, accessedAt: now }],
    body: [{ type: "quote", text: "An attributed quotation.", attribution: "Example author", citations: [{ sourceId, label: "1" }] },
      { type: "quote", text: "An unattributed quotation.", attribution: null, citations: [{ sourceId, label: "1" }] }],
  };
  assert.equal(demandAnswerConversationText(answer), "An attributed quotation. — Example author\n\nAn unattributed quotation.");
});

test("historical paragraphs valid under the saved v1 contract remain readable at the v2 boundary", () => {
  const largerParagraph = structuredClone(legacyDraft);
  largerParagraph.article!.body[0]!.text = "A".repeat(6001);
  assert.equal(onDemandWriterOutputSchema.safeParse(largerParagraph).success, true);
  const read = readDemandStoredDraft(largerParagraph);
  assert.equal(read.article!.body[0]!.text, largerParagraph.article!.body[0]!.text);
});
