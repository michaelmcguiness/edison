import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  generateReaderFirstIdeas, checkReaderFirstIdeas, writeReaderFirstArticle, compileReaderFirstArticle,
  checkReaderFirstArticle, repairReaderFirstArticle, assertAcceptedReaderFirstArticleCheck,
  answerReaderFirstQuestion, compileReaderFirstAnswer, checkReaderFirstAnswer, repairReaderFirstAnswer,
  assertAcceptedReaderFirstAnswerCheck, readerFirstAnswerText, readerFirstArticleFingerprint,
  ReaderFirstDraftValidationError, READER_FIRST_PROMPT_VERSION, readerFirstWriterProviderSchema,
  readerFirstAnswerProviderSchema, readerFirstResearchOutputSchema, readerFirstCheckOutputSchema,
  readerFirstIdeaCandidateSchema,
  type ReaderFirstSelection, type ReaderFirstWriterOutput, type ReaderFirstCheckOutput,
  type ReaderFirstQuestion, type ReaderFirstStageOptions,
} from "../packages/ai/src/reader-first";
import { onDemandArticleSchema } from "../packages/ai/src/schemas";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import type { OnDemandEvidence, OnDemandProviderRequest, OnDemandProviderResponse } from "../packages/ai/src/on-demand";

// Constructed examples and injected verdicts test contract/routing safeguards.
// They do NOT establish provider semantic accuracy or reader-first improvement.
const empty = { sources: [], passages: [] };
const context: ReaderFirstSelection["context"] = {
  loopId: "loop-1", revision: 1, originalCuriosity: "How do you program a cell?", directions: [], declaredKnowledge: [],
  readingPreferences: ["Use a concise concrete example"], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-06",
};
const selection: ReaderFirstSelection = { context, evidence: empty, idea: {
  id: "batch-1:cell", key: "cell", loopId: context.loopId, loopRevision: 0, headline: "How do you program a cell?",
  deck: "Control when a cell makes a protein.", readerQuestion: context.originalCuriosity,
  payoff: "Understand an input, a control region and an output.", advanceBeyondPrevious: "A first useful mechanism.", qualifications: [], passageIds: [],
} };
const evidence: OnDemandEvidence = {
  sources: [{ id: "s1", url: "https://example.org/results", title: "Actual fetched title", publisher: "example.org", publishedDate: null, datePrecision: "unknown" }],
  passages: [{ id: "p1", sourceId: "s1", text: "The sensor was designed to detect light. In the test it missed two flashes.", locator: "Results", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" }],
};
const usage = { providerResponseId: "constructed-response", model: "injected-model", inputTokens: 100, cachedInputTokens: 0, outputTokens: 80, webSearchCalls: 0 };
function options(output: unknown | ((request: OnDemandProviderRequest) => unknown), calls: OnDemandProviderRequest[] = [], extra: Partial<OnDemandProviderResponse> = {}): ReaderFirstStageOptions {
  return { model: "injected-model", idempotencyKey: `request:${calls.length}`, safetyIdentifier: "reader-1", provider: async (request) => {
    calls.push(request);
    return { output: typeof output === "function" ? output(request) : structuredClone(output), usage, ...extra };
  } };
}
function rawArticle() {
  return { status: "written", article: {
    category: "tech-science", kicker: "An explanation", topic: "Biology", title: selection.idea.headline, deck: selection.idea.deck,
    summary: ["A gene can encode a protein.", "A control region affects when it is made.", "A chosen input can change the output."],
    whyWritten: "An example connects an input to a cellular output.", readingMinutes: 1,
    body: [{ type: "paragraph", text: "A gene circuit connects an input to an output. Think of a control region as a switch that changes when the cell makes a protein.", citations: [] as Array<{ sourceKey: string }> }], sourceKeys: [] as string[],
  }, research: structuredClone(empty) as { sources: OnDemandEvidence["sources"]; passages: Array<{ id: string; sourceId: string; text: string; locator: string }> }, reason: null };
}
function passed(fingerprint: string): ReaderFirstCheckOutput {
  return { fingerprint, verdict: "pass", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    readerFit: true, continuity: true, privacyPassed: true, findings: [] };
}
function checkOptions(calls: OnDemandProviderRequest[] = [], overrides: Partial<ReaderFirstCheckOutput> = {}) {
  return options((request: OnDemandProviderRequest) => ({ ...passed((request.input as { fingerprint: string }).fingerprint), ...overrides }), calls);
}
async function draft() { return compileReaderFirstArticle(selection, (await writeReaderFirstArticle(selection, options(rawArticle()))).output); }
function question(value: ReaderFirstWriterOutput): ReaderFirstQuestion {
  return { context, articleVersion: "article-version-1", draft: value, evidence: empty, question: "What would count as a working sensor?", previousMessages: [] };
}
const finding = (excerpt: string, kind: ReaderFirstCheckOutput["findings"][number]["kind"] = "verification_required") => ({
  location: "body.0", excerpt, severity: "material" as const, kind, reason: "This exact claimed result needs actual support.", repair: "Consult the result and preserve its scope.", passageIds: [] as string[],
});

test("stable concept ideas use no invented sources and are independently offered without an article body", async () => {
  const idea = readerFirstIdeaCandidateSchema.strip().parse(selection.idea);
  const calls: OnDemandProviderRequest[] = [];
  const researched = await generateReaderFirstIdeas(context, options({ ...empty, ideas: [idea], insufficiencyReason: null }, calls));
  const checked = await checkReaderFirstIdeas({ context, research: researched.output, evidence: empty, batchId: "batch-new" }, options((request: OnDemandProviderRequest) => ({
    fingerprint: (request.input as { fingerprint: string }).fingerprint,
    ideas: [{ key: idea.key, verdict: "pass", premiseSupported: true, verificationRequired: false, verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "A familiar mechanism, not a claim of a new result." }],
  }), calls));
  assert.equal(checked.ideas[0].id, "batch-new:cell"); assert.deepEqual(checked.ideas[0].passageIds, []);
  assert.equal("article" in researched.output, false);
  assert.deepEqual(calls.map((call) => call.researchPolicy?.mode), ["auto", "none"]);
  assert.equal(calls.every((call) => call.promptVersion === READER_FIRST_PROMPT_VERSION), true);
});

test("a checker-identified empirical idea cannot pass without independently retrieved support", async () => {
  const idea = readerFirstIdeaCandidateSchema.strip().parse(selection.idea);
  const research = { ...empty, ideas: [idea], insufficiencyReason: null };
  const result = await checkReaderFirstIdeas({ context, research, evidence: empty, batchId: "batch" }, options((request: OnDemandProviderRequest) => ({
    fingerprint: (request.input as { fingerprint: string }).fingerprint,
    ideas: [{ key: idea.key, verdict: "pass", premiseSupported: true, verificationRequired: true, verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "A claimed new result needs support." }],
  })));
  assert.deepEqual(result.ideas, []);
});

test("discovery requires actual v2 tool provenance, not legacy URL membership; invalid responses retain usage", async () => {
  const raw = rawArticle(); raw.research.sources = structuredClone(evidence.sources);
  raw.article.sourceKeys = ["s1"]; raw.article.body[0].citations = [{ sourceKey: "s1" }];
  await assert.rejects(writeReaderFirstArticle(selection, options(raw, [], { researchedUrls: [evidence.sources[0].url] })), (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage.providerResponseId === usage.providerResponseId);
  const provenance = { consultedUrls: [evidence.sources[0].url], openedUrls: [], citedUrls: [] };
  const result = await writeReaderFirstArticle(selection, options(raw, [], { researchProvenance: provenance }));
  assert.deepEqual(result.researchProvenance, provenance);
  assert.throws(() => compileReaderFirstArticle(selection, result.output), ReaderFirstDraftValidationError);
});

test("a one-paragraph stable explanation can pass full exact-artifact QA without mandatory browsing or legacy floors", async () => {
  const written = await draft(); const calls: OnDemandProviderRequest[] = [];
  const checked = await checkReaderFirstArticle({ ...selection, draft: written }, checkOptions(calls));
  assert.equal(checked.accepted, true); assert.equal(written.article!.readingMinutes, 1); assert.equal(written.article!.body.length, 1);
  assert.deepEqual(written.article!.sources, []); assert.equal("claims" in written, false);
  assert.doesNotThrow(() => assertAcceptedReaderFirstArticleCheck(selection, written, checked.output));
  assert.equal(onDemandArticleSchema.safeParse(written.article).success, false, "historical contract remains separate");
  assert.deepEqual(calls[0].researchPolicy, { mode: "none", reason: "Independent checking uses the final retained evidence", maxCalls: 0 });
});

test("actual prose, headings, reader instructions, selection and evidence all invalidate a stale passing audit", async () => {
  const written = await draft(); const check = (await checkReaderFirstArticle({ ...selection, draft: written }, checkOptions())).output;
  for (const mutate of [
    (copy: ReaderFirstWriterOutput) => { copy.article!.body[0].text += " Provided that a second mechanism also works."; },
    (copy: ReaderFirstWriterOutput) => { copy.article!.body.push({ type: "heading", level: 2, text: "It always works" }); },
    (copy: ReaderFirstWriterOutput) => { copy.article!.whyWritten += " Private context."; },
  ]) {
    const changed = structuredClone(written); mutate(changed);
    assert.throws(() => assertAcceptedReaderFirstArticleCheck(selection, changed, check), /Stale|mismatched/);
  }
  assert.throws(() => assertAcceptedReaderFirstArticleCheck({ ...selection, context: { ...context, readingPreferences: ["Different instruction"] } }, written, check), /Stale|mismatched/);
  assert.throws(() => assertAcceptedReaderFirstArticleCheck({ ...selection, evidence }, written, check), /Stale|mismatched/);
  assert.equal(readerFirstArticleFingerprint(selection, written), readerFirstArticleFingerprint({ evidence: selection.evidence, idea: selection.idea, context: selection.context }, written), "JSONB property order cannot invalidate an identical artifact");
});

test("retrieved source metadata and complete labels are server-derived; forged final display cannot pass", async () => {
  const raw = rawArticle(); raw.article.sourceKeys = ["s1"]; raw.article.body[0].citations = [{ sourceKey: "s1" }];
  const input = { ...selection, evidence };
  const written = compileReaderFirstArticle(input, (await writeReaderFirstArticle(input, options(raw))).output);
  assert.equal(written.article!.sources[0].publishedAt, null); assert.equal(written.article!.sources[0].title, "Actual fetched title");
  assert.equal(written.article!.body[0].type === "paragraph" && written.article!.body[0].citations[0].label, "example.org");
  const check = (await checkReaderFirstArticle({ ...input, draft: written }, checkOptions())).output;
  const changed = structuredClone(written); changed.article!.sources[0].publishedAt = "2026-05-22T00:00:00.000Z";
  assert.throws(() => assertAcceptedReaderFirstArticleCheck(input, changed, check), /canonical/);
});

test("unknown citations are invalid and fabricated structured quotes cannot compile", async () => {
  const raw = rawArticle(); raw.article.body[0].citations = [{ sourceKey: "unknown" }];
  await assert.rejects(writeReaderFirstArticle(selection, options(raw)), ProviderResponseValidationError);
  const input = { ...selection, evidence }; const written = await draft();
  written.article!.sources = [{ key: "s1", title: evidence.sources[0].title, publisher: "example.org", url: evidence.sources[0].url, publishedAt: null }];
  written.article!.body.push({ type: "quote", text: "It detected every flash.", attribution: "The report", citations: [{ sourceKey: "s1", label: "example.org" }] });
  assert.throws(() => compileReaderFirstArticle(input, written), ReaderFirstDraftValidationError);
  written.article!.body[1].text = "In the test it missed two flashes.";
  assert.doesNotThrow(() => compileReaderFirstArticle(input, written));
});

test("a securely retrieved redirect supplies canonical source identity without granting authority to the author's URL", async () => {
  const raw = rawArticle(); raw.article.sourceKeys = ["s1"]; raw.article.body[0].citations = [{ sourceKey: "s1" }];
  raw.research.sources = structuredClone(evidence.sources);
  const written = (await writeReaderFirstArticle(selection, options(raw, [], { researchProvenance: { consultedUrls: [evidence.sources[0].url], openedUrls: [], citedUrls: [] } }))).output;
  const redirected = structuredClone(evidence); redirected.sources[0].url = "https://reference.example.net/final";
  redirected.sources[0].title = "Fetched final document"; redirected.sources[0].publisher = "reference.example.net";
  const input = { ...selection, evidence: redirected };
  const compiled = compileReaderFirstArticle(input, written);
  assert.equal(compiled.article!.sources[0].url, redirected.sources[0].url);
  assert.equal(written.article!.sources[0].url, evidence.sources[0].url, "original normalized stage output remains unchanged");
  const checked = await checkReaderFirstArticle({ ...input, draft: compiled }, checkOptions());
  assert.equal(checked.accepted, true);
  assert.throws(() => assertAcceptedReaderFirstArticleCheck(input, written, checked.output), /canonical/);
});

test("required verification can use the sole repair research and fresh complete check, preserving the actual failure", async () => {
  const calls: OnDemandProviderRequest[] = []; const raw = rawArticle(); raw.article.body[0].text = "The sensor detected every flash.";
  let input = selection;
  const written = compileReaderFirstArticle(input, (await writeReaderFirstArticle(input, options(raw, calls))).output);
  const checked = await checkReaderFirstArticle({ ...input, draft: written }, checkOptions(calls, { verdict: "insufficient_evidence", verificationPassed: false, findings: [finding(raw.article.body[0].text)] }));
  assert.equal(checked.accepted, false);
  const repairedRaw = rawArticle(); repairedRaw.article.body[0].text = "The sensor was designed to detect light, but it missed two flashes in this test.";
  repairedRaw.article.sourceKeys = ["s1"]; repairedRaw.article.body[0].citations = [{ sourceKey: "s1" }]; repairedRaw.research.sources = evidence.sources;
  const repaired = await repairReaderFirstArticle({ ...input, draft: written, check: checked.output }, options(repairedRaw, calls, { researchProvenance: { consultedUrls: [evidence.sources[0].url], openedUrls: [], citedUrls: [] } }));
  input = { ...selection, evidence }; const compiled = compileReaderFirstArticle(input, repaired.output);
  const rechecked = await checkReaderFirstArticle({ ...input, draft: compiled }, checkOptions(calls));
  assert.equal(rechecked.accepted, true); assert.deepEqual(calls.map((call) => call.stage), ["write", "check", "repair", "check"]);
  assert.equal(checked.output.verificationPassed, false); assert.equal(written.article!.body[0].text, "The sensor detected every flash.");
  assert.throws(() => repairReaderFirstArticle({ ...input, draft: compiled, check: rechecked.output }, options(repairedRaw)), /repairable failed/);
});

test("a structurally parseable wrong title exposes deterministic findings without fabricating a checker verdict", async () => {
  const raw = rawArticle(); raw.article.title = "A different selected question";
  const written = (await writeReaderFirstArticle(selection, options(raw))).output;
  let findings: Array<{ location: string; reason: string }> = [];
  assert.throws(() => compileReaderFirstArticle(selection, written), (error: unknown) => {
    if (!(error instanceof ReaderFirstDraftValidationError)) return false;
    findings = error.deterministicFindings; return true;
  });
  const repaired = await repairReaderFirstArticle({ ...selection, draft: written, deterministicFindings: findings }, options(rawArticle()));
  const compiled = compileReaderFirstArticle(selection, repaired.output);
  assert.equal((await checkReaderFirstArticle({ ...selection, draft: compiled }, checkOptions())).accepted, true);
});

test("QA cannot bind an invented excerpt, unknown location or model-reported supporting passage", async () => {
  const written = await draft();
  for (const changed of [
    finding("A weaker paraphrase that the reader never saw", "missing"),
    { ...finding(written.article!.body[0].text), location: "body.999" },
    { ...finding(written.article!.body[0].text), passageIds: ["invented"] },
  ]) await assert.rejects(checkReaderFirstArticle({ ...selection, draft: written }, checkOptions([], { verdict: "repair", findings: [changed] })), ProviderResponseValidationError);
});

test("payoff, fit, privacy, factual accuracy and incomplete verification independently withhold a nominal pass", async () => {
  const written = await draft();
  for (const flag of ["accuracyPassed", "verificationPassed", "promiseFulfilled", "readerFit", "continuity", "privacyPassed"] as const) {
    const checked = await checkReaderFirstArticle({ ...selection, draft: written }, checkOptions([], { [flag]: false }));
    assert.equal(checked.accepted, false, flag); assert.throws(() => assertAcceptedReaderFirstArticleCheck(selection, written, checked.output), /editorial_withheld/);
  }
  const checked = await checkReaderFirstArticle({ ...selection, draft: written }, checkOptions([], { findings: [finding(written.article!.body[0].text, "payoff")] }));
  assert.equal(checked.accepted, false, "a material finding cannot be overridden by positive booleans");
});

test("Ask owns newly retrieved source citations while the article and old references remain immutable", async () => {
  const original = await draft(); const before = structuredClone(original); const input = question(original);
  const raw = { status: "answered", body: [{ type: "paragraph", text: "A working sensor needs measured performance, not just design intent. This test missed two flashes.", citations: [{ sourceKey: "s1" }] }], sourceKeys: ["s1"], research: { sources: evidence.sources, passages: [] }, reason: null };
  const result = await answerReaderFirstQuestion(input, options(raw, [], { researchProvenance: { consultedUrls: [evidence.sources[0].url], openedUrls: [], citedUrls: [] } }));
  const finalInput = { ...input, evidence };
  const compiled = compileReaderFirstAnswer(finalInput, result.output); const checked = await checkReaderFirstAnswer({ ...finalInput, answer: compiled }, checkOptions());
  assert.equal(checked.accepted, true); assert.equal(compiled.sources[0].key, "s1");
  assert.deepEqual(original, before); assert.deepEqual(original.article!.sources, []);
  assert.match(readerFirstAnswerText(compiled), /measured performance/);
  assert.throws(() => assertAcceptedReaderFirstAnswerCheck({ ...finalInput, question: "Another question" }, compiled, checked.output), /Stale/);
});

test("Ask repair uses exactly the original answer fingerprint, with full fresh checking and no duplicated answer text", async () => {
  const input = question(await draft()); const calls: OnDemandProviderRequest[] = [];
  const raw = { status: "answered", body: [{ type: "paragraph", text: "It always works.", citations: [] }], sourceKeys: [], research: empty, reason: null };
  const answer = compileReaderFirstAnswer(input, (await answerReaderFirstQuestion(input, options(raw, calls))).output);
  const checked = await checkReaderFirstAnswer({ ...input, answer }, checkOptions(calls, { verdict: "repair", accuracyPassed: false, findings: [finding("It always works.", "missing")] }));
  const repairedRaw = { ...raw, body: [{ type: "paragraph", text: "A design describes intended behavior; a test measures what actually happens.", citations: [] }] };
  const repaired = compileReaderFirstAnswer(input, (await repairReaderFirstAnswer({ ...input, answer, check: checked.output }, options(repairedRaw, calls))).output);
  assert.equal((await checkReaderFirstAnswer({ ...input, answer: repaired }, checkOptions(calls))).accepted, true);
  assert.deepEqual(calls.map((call) => call.stage), ["answer", "check", "repair", "check"]); assert.equal("answer" in repaired, false);
});

test("a historically valid long saved paragraph is usable Ask context without weakening new answer authoring limits", async () => {
  const saved = await draft();
  saved.article!.body = Array.from({ length: 6 }, (_, index) => ({ type: "paragraph" as const, text: index === 0 ? "x".repeat(6001) : "Historical explanation.", citations: [{ sourceKey: "s1", label: "example.org" }] }));
  saved.article!.readingMinutes = 3;
  saved.article!.sources = [{ key: "s1", title: evidence.sources[0].title, publisher: "example.org", url: evidence.sources[0].url, publishedAt: null }];
  assert.equal(onDemandArticleSchema.safeParse(saved.article).success, true);
  const input = { ...question(saved), evidence };
  const raw = { status: "answered", body: [{ type: "paragraph", text: "A test distinguishes intended behavior from measured performance.", citations: [] }], sourceKeys: [], research: empty, reason: null };
  const answer = compileReaderFirstAnswer(input, (await answerReaderFirstQuestion(input, options(raw))).output);
  assert.equal((await checkReaderFirstAnswer({ ...input, answer }, checkOptions())).accepted, true);
  assert.equal(input.draft.article!.body[0].text.length, 6001);
  await assert.rejects(answerReaderFirstQuestion(input, options({ ...raw, body: [{ ...raw.body[0], text: "x".repeat(6001) }] })), ProviderResponseValidationError);
});

test("provider wire schemas remain structured-output compatible and reject the old author paraphrase ledger", async () => {
  const requireFromAi = createRequire(new URL("../packages/ai/package.json", import.meta.url));
  const { zodTextFormat } = requireFromAi("openai/helpers/zod") as { zodTextFormat(schema: unknown, name: string): { strict: boolean; schema: Record<string, unknown> } };
  for (const schema of [readerFirstWriterProviderSchema, readerFirstAnswerProviderSchema, readerFirstResearchOutputSchema, readerFirstCheckOutputSchema]) {
    const wire = zodTextFormat(schema, "reader_first_test"); assert.equal(wire.strict, true); assert.equal(wire.schema.type, "object");
  }
  await assert.rejects(writeReaderFirstArticle(selection, options({ ...rawArticle(), claims: [{ text: "A weaker author paraphrase" }] })), ProviderResponseValidationError);
});
