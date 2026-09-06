import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  answerOnDemandQuestion,
  assertAcceptedOnDemandAnswerCheck,
  assertAcceptedOnDemandArticleCheck,
  assertOnDemandDraft,
  assertOnDemandEvidence,
  checkOnDemandAnswer,
  checkOnDemandArticle,
  checkOnDemandIdeas,
  discoveryEvidence,
  generateSelectedArticle,
  interpretLoopFeedback,
  onDemandAnswerOutputSchema,
  onDemandCheckOutputSchema,
  onDemandFeedbackOutputSchema,
  onDemandIdeaChecksSchema,
  onDemandResearchOutputSchema,
  onDemandWriterOutputSchema,
  repairOnDemandArticle,
  researchOnDemandIdeas,
  writeOnDemandArticle,
  type OnDemandCheckOutput,
  type OnDemandContext,
  type OnDemandEvidence,
  type OnDemandIdea,
  type OnDemandProvider,
  type OnDemandProviderRequest,
  type OnDemandResearchOutput,
  type OnDemandStageOptions,
  type OnDemandWriterOutput,
} from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";

const requireFromAiPackage = createRequire(new URL("../packages/ai/package.json", import.meta.url));
const { zodTextFormat } = requireFromAiPackage("openai/helpers/zod") as {
  zodTextFormat: (schema: unknown, name: string) => { type: string; strict: boolean; schema: Record<string, unknown> };
};

// Constructed evidence and injected responses exercise contracts/state gates,
// NOT a real provider's research quality, writing skill or grading accuracy.
const context: OnDemandContext = {
  loopId: "loop-synthetic-biology", revision: 2,
  originalCuriosity: "How can synthetic biology help us understand living systems?",
  directions: ["Focus on applications in medicine"],
  declaredKnowledge: ["I understand the basics of DNA"],
  readingPreferences: ["Include practical examples"],
  preferences: { length: "brief", depth: 70 },
  previousArticles: [{ title: "What makes a gene circuit?", summary: ["A gene circuit regulates expression."] }],
  currentDate: "2026-09-06",
};
const evidence: OnDemandEvidence = {
  sources: [
    { id: "source-1", url: "https://example.org/study", title: "Constructed study", publisher: "Example Institute", publishedDate: "2025", datePrecision: "year" },
    { id: "source-2", url: "https://example.org/replication", title: "Constructed replication", publisher: "Example Institute", publishedDate: "2025-04-12", datePrecision: "day" },
  ],
  passages: [
    { id: "passage-1", sourceId: "source-1", text: "The tested circuit responded to its input under controlled laboratory conditions. The experiment does not establish clinical efficacy.", locator: "Results, paragraph 2", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
    { id: "passage-2", sourceId: "source-2", text: "The response was replicated in a second laboratory strain. Clinical applications were not studied.", locator: "Results, paragraph 1", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
  ],
};
const idea: OnDemandIdea = {
  id: "batch-1:circuit", key: "circuit", loopId: context.loopId, loopRevision: context.revision,
  headline: "What a gene circuit must prove before it becomes medicine",
  deck: "A laboratory response and a clinical treatment answer different questions.",
  readerQuestion: "What remains between a working circuit and a medical application?",
  payoff: "Distinguish laboratory function from evidence of clinical value.",
  advanceBeyondPrevious: "Build on a known circuit mechanism to explain its evidence limits.",
  qualifications: ["No clinical efficacy was studied."], passageIds: ["passage-1", "passage-2"],
};
function draft(): OnDemandWriterOutput {
  const article = {
    category: "tech-science" as const, kicker: "Biology", topic: "Synthetic biology",
    title: idea.headline, deck: idea.deck,
    summary: ["The experiment tested laboratory behavior.", "A second strain showed a response.", "Neither experiment tested clinical efficacy."],
    whyWritten: "This develops the difference between a mechanism and an application.", readingMinutes: 3,
    body: Array.from({ length: 6 }, (_, index) => ({ type: "paragraph" as const, text: `Constructed explanation ${index + 1}: a laboratory response is not a clinical trial.`, citations: [{ sourceKey: index % 2 ? "source-2" : "source-1", label: "Example Institute" }] })),
    sources: evidence.sources.map((source) => ({ key: source.id, title: source.title, publisher: source.publisher, url: source.url, publishedAt: source.datePrecision === "day" ? `${source.publishedDate}T00:00:00.000Z` : null })),
  };
  const locations = ["title", "deck", "summary.0", "summary.1", "summary.2", ...article.body.map((_, index) => `body.${index}`)];
  return { status: "written", article, reason: null, claims: locations.map((location, index) => ({ id: `claim-${index}`, text: "A laboratory response does not establish clinical efficacy.", locations: [location], passageIds: ["passage-1", "passage-2"] })) };
}
function passed(value = draft()): OnDemandCheckOutput {
  return { verdict: "pass", promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true, sourceMetadataPassed: true,
    claims: value.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds, reason: "The constructed source explicitly distinguishes the evidence limits." })),
    missedMaterialClaims: [], findings: [] };
}
function research(): OnDemandResearchOutput {
  const candidate = { key: idea.key, headline: idea.headline, deck: idea.deck, readerQuestion: idea.readerQuestion, payoff: idea.payoff, advanceBeyondPrevious: idea.advanceBeyondPrevious, qualifications: idea.qualifications, passageIds: idea.passageIds };
  return structuredClone({ ideas: [candidate], sources: evidence.sources, passages: evidence.passages.map((passage) => ({ id: passage.id, sourceId: passage.sourceId, text: passage.text, locator: passage.locator })), insufficiencyReason: null });
}
const usage = { providerResponseId: "response-1", model: "injected-test-model", inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, webSearchCalls: 0 };
function options(output: unknown, key = "request-1", capture?: OnDemandProviderRequest[]): OnDemandStageOptions {
  const provider: OnDemandProvider = async (request) => {
    capture?.push(request);
    return { output, usage, researchedUrls: evidence.sources.map((source) => source.url) };
  };
  return { provider, model: "injected-test-model", idempotencyKey: key, safetyIdentifier: "test-reader" };
}
const selected = { context, idea, evidence };

test("all on-demand provider schemas convert using the installed Structured Outputs helper", () => {
  for (const schema of [onDemandResearchOutputSchema, onDemandIdeaChecksSchema, onDemandWriterOutputSchema, onDemandCheckOutputSchema, onDemandAnswerOutputSchema, onDemandFeedbackOutputSchema]) {
    const format = zodTextFormat(schema, "test");
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    assert.equal(format.schema.type, "object");
    assert.equal(format.schema.additionalProperties, false);
  }
});

test("idea discovery returns compact briefs and never self-certifies fetched evidence", async () => {
  const requests: OnDemandProviderRequest[] = [];
  const result = await researchOnDemandIdeas(context, options(research(), "idea-job", requests));
  assert.equal(result.stage, "ideas");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].research, true);
  assert.equal("body" in result.output.ideas[0], false);
  assert.equal(discoveryEvidence(result.output).passages[0].provenance, "model_reported");
  assert.equal(discoveryEvidence(result.output).passages[0].retrievedAt, null);
});

test("discovery rejects fabricated researched URLs and retains billable usage", async () => {
  const value = research(); value.sources[0] = { ...value.sources[0], url: "https://not-searched.example/study" };
  await assert.rejects(researchOnDemandIdeas(context, options(value)), (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage.providerResponseId === "response-1");
});

test("discovery cannot smuggle a prewritten body or a fetched-provenance field", async () => {
  await assert.rejects(researchOnDemandIdeas(context, options({ ...research(), ideas: [{ ...research().ideas[0], body: "Full unused article" }] })), ProviderResponseValidationError);
  await assert.rejects(researchOnDemandIdeas(context, options({ ...research(), passages: [{ ...research().passages[0], provenance: "retrieved" }] })), ProviderResponseValidationError);
});

test("ideas are offered only after a separate supported-premise check", async () => {
  const result = await checkOnDemandIdeas({ context, research: research(), evidence, batchId: "batch-1" }, options({ ideas: [{ key: "circuit", verdict: "pass", premiseSupported: true, fitsLoop: true, distinctContribution: true, passageIds: ["passage-1"], reason: "Supports a discussion of laboratory and clinical limits." }] }));
  assert.equal(result.ideas[0].id, "batch-1:circuit");
  assert.equal(result.ideas[0].loopId, context.loopId);
  assert.deepEqual(result.ideas[0].passageIds, ["passage-1"]);
});

test("URL membership plus model-reported quotes cannot pass an idea", async () => {
  const report = { ideas: [{ key: "circuit", verdict: "pass", premiseSupported: true, fitsLoop: true, distinctContribution: true, passageIds: ["passage-1"], reason: "Claimed support" }] };
  await assert.rejects(checkOnDemandIdeas({ context, research: research(), evidence: discoveryEvidence(research()), batchId: "batch-1" }, options(report)), ProviderResponseValidationError);
});

test("failed idea checks omit a headline rather than drafting a replacement body", async () => {
  const result = await checkOnDemandIdeas({ context, research: research(), evidence, batchId: "batch-1" }, options({ ideas: [{ key: "circuit", verdict: "insufficient_evidence", premiseSupported: false, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "The premise exceeds the available evidence." }] }));
  assert.deepEqual(result.ideas, []);
});

test("writer preserves loop identity and receives explicit DNA, medicine, length and depth context", async () => {
  const requests: OnDemandProviderRequest[] = [];
  const result = await writeOnDemandArticle(selected, options(draft(), "write-job", requests));
  assert.equal(result.output.article!.title, idea.headline);
  assert.equal(requests[0].research, false);
  assert.deepEqual((requests[0].input as typeof selected).context, context);
  assert.match(requests[0].instructions, /Declared knowledge is not inferred mastery/);
  assert.equal(requests[0].maxOutputTokens, 12000);
});

test("a different loop or future idea revision fails before any paid writer call", () => {
  let calls = 0;
  const stageOptions = { ...options(draft()), provider: async () => { calls++; return { output: draft(), usage }; } };
  assert.throws(() => writeOnDemandArticle({ ...selected, context: { ...context, loopId: "loop-history" } }, stageOptions));
  assert.throws(() => writeOnDemandArticle({ ...selected, context: { ...context, revision: 1 } }, stageOptions));
  assert.equal(calls, 0);
});

test("an older offered brief can use the newer context frozen when selected", async () => {
  const result = await writeOnDemandArticle({ ...selected, context: { ...context, revision: 3 } }, options(draft()));
  assert.equal(result.output.status, "written");
  assert.equal(idea.loopRevision, 2);
});

test("changed reader context changes the retained writer input without altering old articles", async () => {
  const previous = draft(); const requests: OnDemandProviderRequest[] = [];
  const updated = { ...selected, context: { ...context, revision: 3, directions: ["Focus on industrial applications"], preferences: { length: "deep" as const, depth: 90 } }, idea: { ...idea, loopRevision: 3 } };
  await writeOnDemandArticle(updated, options(draft(), "new-context", requests));
  assert.equal((requests[0].input as typeof updated).context.directions[0], "Focus on industrial applications");
  assert.equal((requests[0].input as typeof updated).context.preferences.length, "deep");
  assert.equal(previous.article!.title, idea.headline);
});

test("structural checks reject selected-headline replacement and fabricated date precision", async () => {
  const replacement = draft(); replacement.article!.title = "Gene circuits cure disease";
  await assert.rejects(writeOnDemandArticle(selected, options(replacement)), ProviderResponseValidationError);
  const date = draft(); date.article!.sources[0].publishedAt = "2025-01-01T00:00:00.000Z";
  await assert.rejects(writeOnDemandArticle(selected, options(date)), ProviderResponseValidationError);
});

test("fetched metadata mismatch, missing claim coverage and headings-only articles fail", () => {
  const metadata = draft(); metadata.article!.sources[0].publisher = "Wrong publisher";
  assert.throws(() => assertOnDemandDraft(selected, metadata));
  const missing = draft(); missing.claims = missing.claims.filter((claim) => !claim.locations.includes("deck"));
  assert.throws(() => assertOnDemandDraft(selected, missing));
  const empty = draft(); empty.article!.body = Array.from({ length: 6 }, () => ({ type: "heading", level: 2, text: "Heading" })); empty.claims = empty.claims.filter((claim) => !claim.locations.some((location) => location.startsWith("body.")));
  assert.throws(() => assertOnDemandDraft(selected, empty));
});

test("fabricated quote blocks fail before semantic checking", () => {
  const value = draft(); value.article!.body[0] = { type: "quote", text: "This treatment cures every disease.", attribution: "Example Institute", citations: [{ sourceKey: "source-1", label: "Example" }] };
  assert.throws(() => assertOnDemandDraft(selected, value));
});

test("checker must cover all claims; a missing claim is not an implicit pass", async () => {
  const check = passed(); check.claims.pop();
  await assert.rejects(checkOnDemandArticle({ ...selected, draft: draft() }, options(check)), ProviderResponseValidationError);
});

test("article publication gate binds accepted checks to every actual claim and retained passage", () => {
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selected, draft(), passed()));
  const absent = { ...passed(), claims: [] };
  const unknown = passed(); unknown.claims[0].claimId = "not-a-draft-claim";
  const duplicate = passed(); duplicate.claims[1] = { ...duplicate.claims[0] };
  const unsupported = passed(); unsupported.claims[0].passageIds = ["not-a-passage"];
  for (const check of [absent, unknown, duplicate, unsupported, { ...passed(), privacyPassed: false }]) {
    assert.throws(() => assertAcceptedOnDemandArticleCheck(selected, draft(), check));
  }
  const modelReported = structuredClone(selected);
  modelReported.evidence.passages[0].provenance = "model_reported";
  modelReported.evidence.passages[0].retrievedAt = null;
  assert.throws(() => assertAcceptedOnDemandArticleCheck(modelReported, draft(), passed()));
});

test("checked support must appear in the article source list and relevant displayed body citations", async () => {
  const anotherSource = structuredClone(selected);
  anotherSource.evidence.sources.push({ ...evidence.sources[0], id: "source-3", url: "https://example.org/third" });
  anotherSource.evidence.passages.push({ ...evidence.passages[0], id: "passage-3", sourceId: "source-3" });
  const omitted = passed(); omitted.claims[0].passageIds = ["passage-3"];
  assert.throws(() => assertAcceptedOnDemandArticleCheck(anotherSource, draft(), omitted), /absent from article sources/);
  const uncited = passed();
  const bodyClaim = draft().claims.find((claim) => claim.locations.includes("body.0"))!;
  uncited.claims.find((claim) => claim.claimId === bodyClaim.id)!.passageIds = ["passage-2"];
  // Source 2 exists in the overall article list, but this body block cites only source 1.
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selected, draft(), uncited), /displayed body citation/);
  await assert.rejects(checkOnDemandArticle({ ...selected, draft: draft() }, options(uncited)),
    (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage.providerResponseId === usage.providerResponseId);
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selected, draft(), passed()));
});

test("extra displayed citations need checked block support without requiring exact passage-ID equality", () => {
  const value = draft();
  const block = value.article!.body[0];
  assert.equal(block.type, "paragraph");
  block.citations.push({ sourceKey: "source-2", label: "Example Institute" });
  const bodyClaim = value.claims.find((claim) => claim.locations.includes("body.0"))!;
  const partial = passed(value);
  partial.claims.find((claim) => claim.claimId === bodyClaim.id)!.passageIds = ["passage-1"];
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selected, value, partial), /extra displayed citation/);
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selected, value, passed(value)));
  const sameSource = structuredClone(selected);
  sameSource.evidence.passages.push({ ...evidence.passages[0], id: "another-passage-1" });
  const alternate = passed();
  alternate.claims.find((claim) => claim.claimId === bodyClaim.id)!.passageIds = ["another-passage-1"];
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(sameSource, draft(), alternate));
});

test("factual heading claims can be mapped and must be checked; neutral headings need no invented claim", () => {
  const value = draft();
  value.article!.body[0] = { type: "heading", level: 2, text: "The circuit has not established clinical efficacy" };
  const headingClaim = value.claims.find((claim) => claim.locations.includes("body.0"))!;
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selected, value, passed(value)));
  const missingHeading = passed(value);
  missingHeading.claims = missingHeading.claims.filter((claim) => claim.claimId !== headingClaim.id);
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selected, value, missingHeading), /every claim/);
  const neutral = structuredClone(value);
  neutral.article!.body[0] = { type: "heading", level: 2, text: "What comes next" };
  neutral.claims = neutral.claims.filter((claim) => claim.id !== headingClaim.id);
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selected, neutral, passed(neutral)));
});

test("positive overall verdict cannot override contradiction, missing claims, private context or broken headline promise", async () => {
  for (const check of [
    { ...passed(), promiseFulfilled: false },
    { ...passed(), privacyPassed: false },
    { ...passed(), missedMaterialClaims: [{ location: "body.0", text: "An unsupported additional clinical claim" }] },
    { ...passed(), claims: passed().claims.map((claim, index) => index ? claim : { ...claim, verdict: "contradicted" as const }) },
  ]) {
    const result = await checkOnDemandArticle({ ...selected, draft: draft() }, options(check));
    assert.equal(result.accepted, false);
  }
});

test("writer -> checker success returns only checked reading and separate usage", async () => {
  const result = await generateSelectedArticle(selected, { write: writeOnDemandArticle, check: checkOnDemandArticle, repair: repairOnDemandArticle }, { write: options(draft(), "w"), check: options(passed(), "c"), repair: options(draft(), "r"), recheck: options(passed(), "rc") });
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.trace.map((entry) => entry.stage), ["write", "check"]);
  assert.equal(result.trace.reduce((sum, entry) => sum + entry.usage.outputTokens, 0), 100);
});

test("bounded repair is followed by a complete recheck and cannot loop", async () => {
  const failed = { ...passed(), verdict: "repair" as const, promiseFulfilled: false, findings: [{ location: "deck", severity: "material" as const, reason: "The promise is not fulfilled.", repair: "Explain the laboratory-to-clinical distinction." }] };
  const result = await generateSelectedArticle(selected, { write: writeOnDemandArticle, check: checkOnDemandArticle, repair: repairOnDemandArticle }, { write: options(draft(), "w"), check: options(failed, "c"), repair: options(draft(), "r"), recheck: options(failed, "rc") });
  assert.equal(result.status, "withheld");
  assert.equal(result.article, null);
  assert.deepEqual(result.trace.map((entry) => entry.stage), ["write", "check", "repair", "check"]);
});

test("insufficient-evidence verdict skips repair rather than scheduling a human queue", async () => {
  const result = await generateSelectedArticle(selected, { write: writeOnDemandArticle, check: checkOnDemandArticle, repair: repairOnDemandArticle }, { write: options(draft(), "w"), check: options({ ...passed(), verdict: "insufficient_evidence", promiseFulfilled: false }, "c"), repair: options(draft(), "r"), recheck: options(passed(), "rc") });
  assert.equal(result.status, "withheld");
  assert.equal(result.trace.length, 2);
});

test("every stage must have its own stable idempotency key", async () => {
  await assert.rejects(generateSelectedArticle(selected, { write: writeOnDemandArticle, check: checkOnDemandArticle, repair: repairOnDemandArticle }, { write: options(draft()), check: options(passed()), repair: options(draft()), recheck: options(passed()) }));
});

test("malformed provider output preserves billable usage even with no usable content", async () => {
  await assert.rejects(writeOnDemandArticle(selected, options({ status: "written" })), (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage.inputTokens === 100 && !error.message.includes(context.originalCuriosity));
});

test("article questions use exact version/evidence and produce no persistent mutations", async () => {
  const input = { articleId: "article-1", articleVersion: 4, article: draft().article!, evidence, question: "Does this establish that it works in patients?", conversation: [] };
  const answer = { status: "answered" as const, answer: "No. These experiments did not study clinical efficacy.", claims: [{ id: "answer-1", text: "Clinical efficacy was not studied.", locations: ["answer"], passageIds: ["passage-1", "passage-2"] }], missingEvidence: null };
  const requests: OnDemandProviderRequest[] = [];
  const result = await answerOnDemandQuestion(input, options(answer, "answer", requests));
  assert.equal((requests[0].input as typeof input).articleVersion, 4);
  assert.equal("operations" in result.output, false);
  const checked = await checkOnDemandAnswer({ ...input, answer }, options({ ...passed(), claims: [{ claimId: "answer-1", verdict: "supported", passageIds: ["passage-1"], reason: "The evidence explicitly excludes clinical efficacy." }] }));
  assert.equal(checked.accepted, true);
});

test("answer publication gate rejects missing coverage, invented passages, and inconsistent answer status", () => {
  const question = { articleId: "article-1", articleVersion: 4, article: draft().article!, evidence,
    question: "Was clinical efficacy tested?", conversation: [] };
  const answer = { status: "answered" as const, answer: "Clinical efficacy was not studied.",
    claims: [{ id: "answer-1", text: "Clinical efficacy was not studied.", locations: ["answer"], passageIds: ["passage-1"] }], missingEvidence: null };
  const check = { ...passed(), claims: [{ claimId: "answer-1", verdict: "supported" as const, passageIds: ["passage-1"], reason: "The passage states the limitation." }] };
  assert.doesNotThrow(() => assertAcceptedOnDemandAnswerCheck(question, answer, check));
  assert.throws(() => assertAcceptedOnDemandAnswerCheck(question, answer, { ...check, claims: [] }));
  assert.throws(() => assertAcceptedOnDemandAnswerCheck(question, answer, { ...check, claims: [{ ...check.claims[0], claimId: "other-answer" }] }));
  assert.throws(() => assertAcceptedOnDemandAnswerCheck(question, answer, { ...check, claims: [{ ...check.claims[0], passageIds: ["invented"] }] }));
  assert.throws(() => assertAcceptedOnDemandAnswerCheck(question, { ...answer, claims: [] }, { ...check, claims: [] }));
  assert.throws(() => assertAcceptedOnDemandAnswerCheck(question, { ...answer, missingEvidence: "Unresolved support" }, check));
  assert.throws(() => assertAcceptedOnDemandAnswerCheck(question, answer, { ...check, readerFit: false }));
});

test("shorter feedback only returns its one explicit operation; existing example preference remains outside the mutation", async () => {
  const requests: OnDemandProviderRequest[] = [];
  const input = { loopId: context.loopId, revision: 2, originalCuriosity: context.originalCuriosity, principles: [{ id: "length", kind: "preference" as const, instruction: "Use standard length articles" }, { id: "examples", kind: "preference" as const, instruction: "Include practical examples" }], feedback: "Make articles shorter" };
  const result = await interpretLoopFeedback(input, options({ status: "changes", operations: [{ type: "set", targetPrincipleId: "length", kind: "preference", instruction: "Make articles shorter" }], message: "Shorter articles requested." }, "feedback", requests));
  assert.equal(result.output.operations.length, 1);
  assert.equal(input.principles[1].instruction, "Include practical examples");
  assert.match(requests[0].instructions, /Keep every previous constraint/);
});

test("feedback rejects invented/other-loop IDs and contradictory duplicate targets", async () => {
  const input = { loopId: context.loopId, revision: 2, originalCuriosity: context.originalCuriosity, principles: [{ id: "examples", kind: "preference" as const, instruction: "Use examples" }], feedback: "Remove examples" };
  await assert.rejects(interpretLoopFeedback(input, options({ status: "changes", operations: [{ type: "remove", targetPrincipleId: "other-loop-principle" }], message: "Removed." })), ProviderResponseValidationError);
  await assert.rejects(interpretLoopFeedback(input, options({ status: "changes", operations: [{ type: "remove", targetPrincipleId: "examples" }, { type: "set", targetPrincipleId: "examples", kind: "preference", instruction: "Keep examples" }], message: "Changed." })), ProviderResponseValidationError);
});

test("irrelevant feedback explicitly returns no change rather than invented principles", async () => {
  const result = await interpretLoopFeedback({ loopId: context.loopId, revision: 2, originalCuriosity: context.originalCuriosity, principles: [], feedback: "Please email my friend" }, options({ status: "clarification", operations: [], message: "What would you like to change about the reading in this loop?" }));
  assert.equal(result.output.status, "clarification");
  assert.deepEqual(result.output.operations, []);
});

test("evidence date precision, duplicate IDs and missing retrieval timestamps fail closed", () => {
  for (const value of [
    { ...evidence, sources: evidence.sources.map((source, index) => index ? source : { ...source, datePrecision: "day" as const }) },
    { ...evidence, passages: [evidence.passages[0], evidence.passages[0]] },
    { ...evidence, passages: evidence.passages.map((passage) => ({ ...passage, retrievedAt: null })) },
  ]) assert.throws(() => assertOnDemandEvidence(value));
});
