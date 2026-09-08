import assert from "node:assert/strict";
import test from "node:test";
import { uuidSchema } from "@edison/contracts";
import {
  compileReaderFirstAnswer, compileReaderFirstArticle,
  readerFirstAnswerFingerprint, readerFirstArticleFingerprint,
  type ReaderFirstAnswerOutput, type ReaderFirstCheckOutput, type ReaderFirstQuestion,
  type ReaderFirstSelection, type ReaderFirstWriterOutput,
} from "../packages/ai/src/reader-first";
import type { OnDemandEvidence } from "../packages/ai/src/on-demand";
import { publishReaderFirstAnswer, publishReaderFirstArticle } from "../apps/api/src/services/reader-first-publication";

// Synthetic evidence and injected passing checks exercise the publication
// boundary. They are not provider runs or measured factual/editorial acceptance.
const articleId = "00000000-0000-4000-8000-000000000051";
const answerId = "00000000-0000-4000-8000-000000000052";
const empty: OnDemandEvidence = { sources: [], passages: [] };
const evidence: OnDemandEvidence = {
  sources: [
    { id: "s1", title: "Final retrieved report", publisher: "research.example.org", url: "https://research.example.org/final-report",
      publishedDate: "2026-08-17", datePrecision: "day" },
    { id: "s2", title: "Final retrieved background", publisher: "reference.example.org", url: "https://reference.example.org/background",
      publishedDate: "2026-08", datePrecision: "month" },
  ],
  passages: [
    { id: "p1", sourceId: "s1", text: "The sensor missed two flashes.", locator: "Results", provenance: "retrieved", retrievedAt: "2026-09-06T10:00:00.000Z" },
    { id: "p2", sourceId: "s2", text: "A sensor connects an input signal to a measurable output.", locator: "Background", provenance: "retrieved", retrievedAt: "2026-09-06T11:00:00.000Z" },
    { id: "p3", sourceId: "s1", text: "The design and the result are distinct.", locator: "Discussion", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
    { id: "lead", sourceId: "s1", text: "A model-reported discovery lead is not independently fetched evidence.", locator: "Discovery", provenance: "model_reported", retrievedAt: null },
  ],
};

function selection(packet = empty): ReaderFirstSelection {
  return {
    context: { loopId: "loop-publication", revision: 2, originalCuriosity: "How does a cell sensor work?",
      directions: ["Use concrete examples"], declaredKnowledge: [], readingPreferences: ["Keep it concise"],
      preferences: { length: "brief", depth: 60 }, previousArticles: [], currentDate: "2026-09-06" },
    idea: { id: "idea-sensor", key: "sensor", loopId: "loop-publication", loopRevision: 2,
      headline: "How does a cell sensor work?", deck: "Connect a signal to an observable response.",
      readerQuestion: "What links an input to an output?", payoff: "Understand the sensing mechanism and its limit.",
      advanceBeyondPrevious: "A first explanation", qualifications: [], passageIds: [] },
    evidence: packet,
  };
}

function rawDraft(input: ReaderFirstSelection, sourceKeys: string[] = []): ReaderFirstWriterOutput {
  return { status: "written", reason: null, research: { sources: [], passages: [] }, article: {
    category: "tech-science", kicker: "Biology", topic: "Cell sensors", title: input.idea.headline, deck: input.idea.deck,
    summary: ["A signal provides the input.", "The sensor connects input to output.", "A test measures performance."],
    whyWritten: "A concrete mechanism answers your question.", readingMinutes: 20,
    body: [{ type: "paragraph", text: "A sensor connects an input signal to an observable output. The design describes the intended connection; a test measures what happens.",
      citations: sourceKeys.map((sourceKey) => ({ sourceKey, label: "Guessed label" })) }],
    sources: sourceKeys.map((key) => ({ key, title: "Model-guessed title", publisher: "Model-guessed publisher",
      url: `https://guessed.example.org/${key}`, publishedAt: "2026-01-01T00:00:00.000Z" })),
  } };
}

function passed(fingerprint: string): ReaderFirstCheckOutput {
  return { fingerprint, verdict: "pass", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    readerFit: true, continuity: true, privacyPassed: true, findings: [] };
}

function articleInput(packet = empty, sourceKeys: string[] = []) {
  const input = selection(packet);
  const draft = compileReaderFirstArticle(input, rawDraft(input, sourceKeys));
  return { requestId: articleId, selection: input, draft, check: passed(readerFirstArticleFingerprint(input, draft)) };
}

function answerInput(sourceKeys: string[] = []) {
  const original = articleInput(evidence, ["s1"]);
  const question: ReaderFirstQuestion = { context: original.selection.context, articleVersion: articleId,
    draft: original.draft, evidence, question: "How would I tell whether the sensor works?", previousMessages: [] };
  const raw: ReaderFirstAnswerOutput = { status: "answered", reason: null, research: { sources: [], passages: [] },
    body: [{ type: "paragraph", text: "Compare the intended behavior with measured performance. The report says the sensor missed two flashes.",
      citations: sourceKeys.map((sourceKey) => ({ sourceKey, label: "Guessed label" })) }],
    sources: rawDraft(original.selection, sourceKeys).article!.sources };
  const answer = compileReaderFirstAnswer(question, raw);
  return { requestId: answerId, question, answer, check: passed(readerFirstAnswerFingerprint(question, answer)) };
}

test("source-free articles publish truthful metadata, actual reading time and no invented sources", () => {
  const input = articleInput();
  const before = structuredClone(input);
  const article = publishReaderFirstArticle(input);
  assert.equal(article.id, articleId);
  assert.equal(article.title, input.selection.idea.headline);
  assert.equal(article.readingMinutes, 1, "reading time is measured rather than copied from the model's 20-minute estimate");
  assert.equal(article.sourceCount, 0);
  assert.equal(article.researchedAt, null);
  assert.equal(article.basis, "general_knowledge");
  assert.deepEqual(article.sources, []);
  assert.equal(article.body[0].type, "paragraph");
  assert.deepEqual(article.body[0].citations, []);
  assert.equal(article.shareId, null);
  assert.deepEqual(input, before);
  assert.deepEqual(publishReaderFirstArticle(input), article);
});

test("sourced publication uses final retrieved identity, date precision and the latest actual access time", () => {
  const input = articleInput(evidence, ["s1", "s2"]);
  const article = publishReaderFirstArticle(input);
  assert.equal(article.basis, "mixed");
  assert.equal(article.sourceCount, 2);
  assert.equal(article.researchedAt, "2026-09-06T12:00:00.000Z");
  assert.deepEqual(article.sources.map(({ id, ...metadata }) => {
    assert.equal(uuidSchema.safeParse(id).success, true);
    return metadata;
  }), [
    { title: evidence.sources[0].title, publisher: evidence.sources[0].publisher, url: evidence.sources[0].url,
      publishedAt: "2026-08-17T00:00:00.000Z", accessedAt: "2026-09-06T12:00:00.000Z" },
    { title: evidence.sources[1].title, publisher: evidence.sources[1].publisher, url: evidence.sources[1].url,
      publishedAt: null, accessedAt: "2026-09-06T11:00:00.000Z" },
  ]);
  assert.equal(article.body[0].type, "paragraph");
  assert.deepEqual(article.body[0].citations, article.sources.map((source, index) => ({ sourceId: source.id, label: String(index + 1) })));
  assert.deepEqual(publishReaderFirstArticle(input), article, "transaction replay retains source identity");
  assert.doesNotMatch(JSON.stringify(article), /Guessed|guessed|2026-01-01/);
});

test("research metadata includes only displayed acquired sources, not unrelated retained evidence", () => {
  const unusedNewer = structuredClone(evidence);
  unusedNewer.passages[1].retrievedAt = "2026-09-06T14:00:00.000Z";
  const article = publishReaderFirstArticle(articleInput(unusedNewer, ["s1"]));
  assert.equal(article.sourceCount, 1);
  assert.equal(article.researchedAt, "2026-09-06T12:00:00.000Z");
  assert.equal(article.sources[0].url, evidence.sources[0].url);
});

test("answers own canonical source IDs and new citations while preserving the saved article", () => {
  const input = answerInput(["s1", "s2"]);
  const before = structuredClone(input);
  const article = publishReaderFirstArticle(articleInput(evidence, ["s1"]));
  const answer = publishReaderFirstAnswer(input);
  assert.equal(answer.version, 2);
  assert.equal(answer.basis, "mixed");
  assert.equal(answer.researchedAt, "2026-09-06T12:00:00.000Z");
  assert.equal(answer.sources.length, 2);
  assert.notEqual(answer.sources[0].id, article.sources[0].id, "even a reused source belongs to this answer's request");
  assert.equal(answer.sources[1].url, evidence.sources[1].url, "new answer-only research is displayed");
  assert.equal(answer.body[0].type, "paragraph");
  assert.deepEqual(answer.body[0].citations, answer.sources.map((source, index) => ({ sourceId: source.id, label: String(index + 1) })));
  assert.equal("text" in answer, false);
  assert.equal("sourceIds" in answer, false);
  assert.deepEqual(publishReaderFirstAnswer(input), answer);
  const nextRequest = publishReaderFirstAnswer({ ...input, requestId: "00000000-0000-4000-8000-000000000053" });
  assert.notEqual(nextRequest.sources[0].id, answer.sources[0].id);
  assert.deepEqual(input, before);
  assert.equal(input.question.draft.article!.sources.length, 1);
});

test("a source-free answer does not manufacture a research timestamp from its article's existing evidence", () => {
  const answer = publishReaderFirstAnswer(answerInput());
  assert.equal(answer.version, 2);
  assert.equal(answer.basis, "general_knowledge");
  assert.equal(answer.researchedAt, null);
  assert.deepEqual(answer.sources, []);
});

test("article publication fails closed when any checked text, selection, context or evidence changes", () => {
  const original = articleInput(evidence, ["s1"]);
  const changes: Array<(input: typeof original) => void> = [
    (input) => { input.draft.article!.body[0].text += " An unchecked assertion."; },
    (input) => { input.draft.article!.body.push({ type: "heading", level: 2, text: "An unchecked heading" }); },
    (input) => { input.draft.article!.summary[0] += " Extra summary claim."; },
    (input) => { input.draft.article!.sources[0].publishedAt = "2026-01-01T00:00:00.000Z"; },
    (input) => { input.selection.idea.payoff = "An entirely different promised payoff."; },
    (input) => { input.selection.context.readingPreferences = ["A changed instruction."]; },
    (input) => { input.selection.evidence.passages[0].text += " Additional retained evidence."; },
    (input) => { input.check.fingerprint = "0".repeat(64); },
  ];
  for (const change of changes) {
    const changed = structuredClone(original);
    change(changed);
    assert.throws(() => publishReaderFirstArticle(changed), /editorial_withheld/);
  }
});

test("answer publication fails closed when its exact answer, question, history or article context changes", () => {
  const original = answerInput(["s2"]);
  const changes: Array<(input: typeof original) => void> = [
    (input) => { input.answer.body[0].text += " An unchecked answer claim."; },
    (input) => { input.answer.sources[0].url = "https://forged.example.org/source"; },
    (input) => { input.question.question = "A different question."; },
    (input) => { input.question.articleVersion = "a-different-article-version"; },
    (input) => { input.question.previousMessages = [{ role: "user", text: "A changed conversation." }]; },
    (input) => { input.question.draft.article!.body[0].text += " Changed saved content."; },
    (input) => { input.check.fingerprint = "0".repeat(64); },
  ];
  for (const change of changes) {
    const changed = structuredClone(original);
    change(changed);
    assert.throws(() => publishReaderFirstAnswer(changed), /editorial_withheld/);
  }
});

test("nominal passes cannot override failed accuracy, grounding, reader value or material findings", () => {
  const article = articleInput();
  const answer = answerInput();
  for (const flag of ["accuracyPassed", "verificationPassed", "promiseFulfilled", "readerFit", "continuity", "privacyPassed"] as const) {
    assert.throws(() => publishReaderFirstArticle({ ...article, check: { ...article.check, [flag]: false } }), /editorial_withheld/, flag);
    assert.throws(() => publishReaderFirstAnswer({ ...answer, check: { ...answer.check, [flag]: false } }), /editorial_withheld/, flag);
  }
  assert.throws(() => publishReaderFirstArticle({ ...article, check: { ...article.check, findings: [{ location: "body.0",
    excerpt: "A sensor", severity: "material", kind: "verification_required", reason: "This claim still needs support.",
    repair: "Acquire real support or correct the claim.", passageIds: [] }] } }), /editorial_withheld/);
});

test("publication never accepts model-reported passages as independent source acquisition", () => {
  const input = articleInput(evidence, ["s1"]);
  input.selection.evidence = { ...evidence, passages: evidence.passages.map((passage) => ({ ...passage,
    provenance: "model_reported" as const, retrievedAt: null })) };
  input.check = passed(readerFirstArticleFingerprint(input.selection, input.draft));
  assert.throws(() => publishReaderFirstArticle(input), /editorial_withheld/);
  const answer = answerInput(["s2"]);
  answer.question.evidence = input.selection.evidence;
  answer.check = passed(readerFirstAnswerFingerprint(answer.question, answer.answer));
  assert.throws(() => publishReaderFirstAnswer(answer), /editorial_withheld/);
});
