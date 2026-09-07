import assert from "node:assert/strict";
import test from "node:test";
import {
  generateReaderFirstIdeas, checkReaderFirstIdeas, writeReaderFirstArticle, repairReaderFirstArticle,
  answerReaderFirstQuestion, repairReaderFirstAnswer, compileReaderFirstArticle, compileReaderFirstAnswer,
  readerFirstResearchOutputSchema, readerFirstWriterProviderSchema, readerFirstAnswerProviderSchema,
  type ReaderFirstResearchOutput, type ReaderFirstSelection, type ReaderFirstQuestion, type ReaderFirstStageOptions,
} from "../packages/ai/src/reader-first";
import type { OnDemandEvidence, OnDemandProviderRequest, OnDemandProviderResponse } from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";

// Minimal constructed reproduction of D30 request 94e80796-4024-436f-bedf-03a1cd39d27b.
// No retained publisher prose or private reader data. Stubbed verdicts prove
// contract behavior, not semantic accuracy or an improvement from a paid run.
const empty: OnDemandEvidence = { sources: [], passages: [] };
const context: ReaderFirstSelection["context"] = {
  loopId: "loop-1", revision: 1, originalCuriosity: "How do sensors work?", directions: [], declaredKnowledge: [],
  readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-06",
};
const source = (id: string, url: string): OnDemandEvidence["sources"][number] => ({
  id, url, title: "A sensor report", publisher: "example.org", publishedDate: "2025-08-01", datePrecision: "year",
});
const idea = (key: string, passageIds: string[]) => ({
  key, headline: "How does a light sensor work?", deck: "Connect a signal to an output.", readerQuestion: context.originalCuriosity,
  payoff: "Understand a sensor's response.", advanceBeyondPrevious: "A first mechanism.", qualifications: [], passageIds,
});
function research(): ReaderFirstResearchOutput {
  return { sources: [source("s1", "https://example.org/report")],
    passages: [{ id: "p1", sourceId: "s1", text: "The sensor detected three flashes in a test.", locator: "Results" }],
    ideas: [idea("sensor", ["p1"])], insufficiencyReason: null };
}
const usage = { providerResponseId: "constructed-response", model: "injected-model", inputTokens: 100, cachedInputTokens: 0, outputTokens: 80, webSearchCalls: 1, webSearchToolCalls: 1 };
const provenance = (...urls: string[]) => ({ consultedUrls: urls, openedUrls: [], citedUrls: [] });
function options(output: unknown, extra: Partial<OnDemandProviderResponse> = {}, calls: OnDemandProviderRequest[] = []): ReaderFirstStageOptions {
  // Return the exact original object so mutation tests do not hide a write
  // behind a cloning stub. Real transport retains this raw billed envelope.
  return { model: usage.model, idempotencyKey: "request:stage", safetyIdentifier: "reader-1", provider: async (request) => {
    calls.push(request); return { output, usage, ...extra };
  } };
}
function invalidWithUsage(error: unknown) {
  return error instanceof ProviderResponseValidationError && error.observedUsage === usage;
}
const selection: ReaderFirstSelection = { context, evidence: empty, idea: {
  ...idea("sensor", []), id: "batch:sensor", loopId: context.loopId, loopRevision: 1,
} };
function rawArticle() {
  return readerFirstWriterProviderSchema.parse({ status: "written", article: {
    category: "tech-science", kicker: "An explanation", topic: "Sensors", title: selection.idea.headline, deck: selection.idea.deck,
    summary: ["A sensor receives an input.", "It produces a response.", "Tests measure that response."],
    whyWritten: "Connect an input to a response.", readingMinutes: 1,
    body: [{ type: "paragraph", text: "A sensor turns a change in its environment into an output.", citations: [] }], sourceKeys: [],
  }, research: empty, reason: null });
}

test("inconsistent discovery date hints normalize only a cloned new result, retaining raw output, provenance and observed usage", async () => {
  const raw = research(); const before = structuredClone(raw); const actual = provenance(raw.sources[0].url);
  assert.equal(readerFirstResearchOutputSchema.safeParse(raw).success, true, "original failure was after structural parsing");
  const calls: OnDemandProviderRequest[] = [];
  const result = await generateReaderFirstIdeas(context, options(raw, { researchProvenance: actual }, calls));
  assert.deepEqual(result.output.sources[0], { ...raw.sources[0], publishedDate: null, datePrecision: "unknown" });
  assert.deepEqual(raw, before); assert.notEqual(result.output, raw); assert.notEqual(result.output.sources[0], raw.sources[0]);
  assert.equal(result.usage, usage); assert.equal(result.researchProvenance, actual);
  assert.equal(calls[0].promptVersion, "edison-reader-first-v2.4"); assert.equal(calls.length, 1);
});

test("ideas quarantine an exact HTML/PDF provenance mismatch and its whole dependent idea without changing surviving briefs", async () => {
  const raw = research(); raw.sources.push(source("s2", "https://example.org/second?version=1"));
  raw.passages.push({ id: "p2", sourceId: "s2", text: "A different sensor was tested.", locator: "Results" });
  raw.ideas.push(idea("second", ["p1", "p2"]));
  const before = structuredClone(raw);
  const result = await generateReaderFirstIdeas(context, options(raw, {
    researchProvenance: provenance(raw.sources[0].url, "https://example.org/second.pdf?version=1"),
  }));
  assert.deepEqual(result.output.sources.map((item) => item.id), ["s1"]);
  assert.deepEqual(result.output.passages.map((item) => item.id), ["p1"]);
  assert.deepEqual(result.output.ideas, [before.ideas[0]], "do not amputate an idea's evidence or guess a replacement URL");
  assert.equal(result.output.insufficiencyReason, null); assert.deepEqual(raw, before);
});

test("unconsulted sources never survive through legacy URL membership and all dependent ideas become honestly unavailable", async () => {
  for (const extra of [{}, { researchedUrls: ["https://example.org/report"] }, { researchProvenance: provenance("https://example.org/report.pdf") }]) {
    const result = await generateReaderFirstIdeas(context, options(research(), extra));
    assert.deepEqual(result.output.ideas, []); assert.deepEqual(result.output.sources, []); assert.deepEqual(result.output.passages, []);
    assert.match(result.output.insufficiencyReason!, /absent from the actual research provenance/);
    assert.equal(result.usage, usage, "quarantine does not erase the incurred provider observation");
  }
  const raw = research(); raw.ideas = [idea("stable-concept", [])];
  const stable = await generateReaderFirstIdeas(context, options(raw));
  assert.deepEqual(stable.output.ideas, raw.ideas); assert.deepEqual(stable.output.sources, []);
});

test("quarantine cannot conceal duplicate keys, invalid relationships, unsafe URLs or unknown schema fields", async () => {
  const changes: Array<[string, (raw: ReaderFirstResearchOutput) => void]> = [
    ["source ID", (raw) => { raw.sources.push({ ...raw.sources[0], url: "https://example.org/other" }); }],
    ["source URL", (raw) => { raw.sources.push({ ...raw.sources[0], id: "s2" }); }],
    ["passage ID", (raw) => { raw.passages.push({ ...raw.passages[0] }); }],
    ["idea key", (raw) => { raw.ideas.push({ ...raw.ideas[0] }); }],
    ["idea passage ID", (raw) => { raw.ideas[0].passageIds.push("p1"); }],
    ["unknown source ID", (raw) => { raw.passages[0].sourceId = "unknown"; }],
    ["unknown passage ID", (raw) => { raw.ideas[0].passageIds = ["unknown"]; }],
    ["credentials", (raw) => { raw.sources[0].url = "https://secret@example.org/report"; }],
  ];
  for (const [name, change] of changes) {
    const raw = research(); change(raw); const before = structuredClone(raw);
    await assert.rejects(generateReaderFirstIdeas(context, options(raw)), invalidWithUsage, name);
    assert.deepEqual(raw, before, name);
  }
  await assert.rejects(generateReaderFirstIdeas(context, options({ ...research(), unexpected: true })), invalidWithUsage);
});

test("surviving discovery leads do not count as independently checked empirical support", async () => {
  const raw = research(); const result = await generateReaderFirstIdeas(context, options(raw, { researchProvenance: provenance(raw.sources[0].url) }));
  const provider: ReaderFirstStageOptions["provider"] = async (request) => ({ usage, output: {
    fingerprint: (request.input as { fingerprint: string }).fingerprint,
    ideas: [{ key: "sensor", verdict: "pass", premiseSupported: true, verificationRequired: true,
      verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "A test result needs independent support." }],
  } });
  const checked = await checkReaderFirstIdeas({ context, research: result.output, evidence: empty, batchId: "batch" }, { ...options(null), provider });
  assert.deepEqual(checked.ideas, []);
});

test("write, sole repair and Ask paths normalize only new hints while actual retained publication dates remain authoritative", async () => {
  const raw = rawArticle(); raw.research = { sources: research().sources, passages: research().passages };
  raw.article!.sourceKeys = ["s1"]; raw.article!.body[0] = { type: "paragraph", text: "The sensor detected three flashes in a test.", citations: [{ sourceKey: "s1" }] };
  const actualEvidence: OnDemandEvidence = { sources: [{ ...raw.research.sources[0], title: "Actual retained title", publishedDate: "2025-08-02", datePrecision: "day" }],
    passages: raw.research.passages.map((passage) => ({ ...passage, provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" })) };
  const input = { ...selection, evidence: actualEvidence }; const before = structuredClone({ raw, actualEvidence });
  const written = await writeReaderFirstArticle(input, options(raw));
  const compiled = compileReaderFirstArticle(input, written.output);
  const repaired = await repairReaderFirstArticle({ ...input, draft: compiled, deterministicFindings: [{ location: "body.0", reason: "Clarify the mechanism." }] }, options(raw));
  const question: ReaderFirstQuestion = { context, evidence: actualEvidence, draft: compiled, articleVersion: "article-1", question: "What did the test show?", previousMessages: [] };
  const rawAnswer = readerFirstAnswerProviderSchema.parse({ status: "answered", body: raw.article!.body, sourceKeys: ["s1"], research: raw.research, reason: null });
  const answerBefore = structuredClone(rawAnswer);
  const answered = await answerReaderFirstQuestion(question, options(rawAnswer));
  const compiledAnswer = compileReaderFirstAnswer(question, answered.output);
  const answerRepaired = await repairReaderFirstAnswer({ ...question, answer: compiledAnswer, deterministicFindings: [{ location: "body.0", reason: "Clarify the mechanism." }] }, options(rawAnswer));
  for (const result of [written, repaired, answered, answerRepaired]) {
    assert.equal(result.output.research.sources[0].publishedDate, null); assert.equal(result.output.research.sources[0].datePrecision, "unknown");
    assert.equal(result.usage, usage);
  }
  assert.equal(compiled.article!.sources[0].publishedAt, "2025-08-02T00:00:00.000Z");
  assert.equal(compiledAnswer.sources[0].publishedAt, "2025-08-02T00:00:00.000Z");
  assert.deepEqual({ raw, actualEvidence }, before); assert.deepEqual(rawAnswer, answerBefore);
});

test("new article and answer sources remain fail-closed for every authoring stage; ideas quarantine is not generalized", async () => {
  const baseline = (await writeReaderFirstArticle(selection, options(rawArticle()))).output;
  const question: ReaderFirstQuestion = { context, evidence: empty, draft: baseline, articleVersion: "article-1", question: "What did the test show?", previousMessages: [] };
  const raw = rawArticle(); raw.research = { sources: research().sources, passages: research().passages };
  raw.article!.sourceKeys = ["s1"]; raw.article!.body[0] = { type: "paragraph", text: "The sensor detected three flashes in a test.", citations: [{ sourceKey: "s1" }] };
  const rawAnswer = readerFirstAnswerProviderSchema.parse({ status: "answered", body: raw.article!.body, sourceKeys: ["s1"], research: raw.research, reason: null });
  const initialAnswer = (await answerReaderFirstQuestion(question, options({ ...rawAnswer, sourceKeys: [], body: [{ type: "paragraph", text: "A sensor produces an output.", citations: [] }], research: empty }))).output;
  const failure = { deterministicFindings: [{ location: "body.0", reason: "Consult the measured result." }] };
  const extra = { researchProvenance: provenance("https://example.org/report.pdf") };
  for (const call of [
    () => writeReaderFirstArticle(selection, options(raw, extra)),
    () => repairReaderFirstArticle({ ...selection, draft: baseline, ...failure }, options(raw, extra)),
    () => answerReaderFirstQuestion(question, options(rawAnswer, extra)),
    () => repairReaderFirstAnswer({ ...question, answer: initialAnswer, ...failure }, options(rawAnswer, extra)),
  ]) await assert.rejects(call(), invalidWithUsage);
});
