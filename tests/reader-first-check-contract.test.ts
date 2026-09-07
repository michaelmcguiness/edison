import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  assertAcceptedReaderFirstArticleCheck, assertAcceptedReaderFirstAnswerCheck,
  checkReaderFirstArticle, checkReaderFirstAnswer, compileReaderFirstArticle, compileReaderFirstAnswer,
  readerFirstCheckOutputSchema, repairReaderFirstArticle, repairReaderFirstAnswer,
  type ReaderFirstSelection, type ReaderFirstWriterOutput, type ReaderFirstAnswerOutput,
  type ReaderFirstQuestion, type ReaderFirstCheckOutput, type ReaderFirstStageOptions,
} from "../packages/ai/src/reader-first";
import type { OnDemandEvidence, OnDemandProviderRequest } from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";

// Authored examples and injected judgments test contracts, not real model quality.
// No provider, retrieval, database or private production packet is accessed.
const requireFromAi = createRequire(new URL("../packages/ai/package.json", import.meta.url));
const { zodTextFormat } = requireFromAi("openai/helpers/zod") as {
  zodTextFormat(schema: unknown, name: string): { strict: boolean; schema: Record<string, unknown> };
};
const empty: OnDemandEvidence = { sources: [], passages: [] };
const prose = "A thermostat compares a reading with a target.";
const usage = { providerResponseId: "constructed-contract-response", model: "injected-model",
  inputTokens: 100, cachedInputTokens: 0, outputTokens: 80, webSearchCalls: 0 };
type Finding = ReaderFirstCheckOutput["findings"][number];
type Mode = "article" | "answer";

function packet(count: number): OnDemandEvidence {
  return count ? {
    sources: [{ id: "s1", url: "https://example.org/control", title: "Constructed control example",
      publisher: "example.org", publishedDate: null, datePrecision: "unknown" }],
    passages: Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, sourceId: "s1",
      text: prose, locator: `Constructed passage ${index + 1}`, provenance: "retrieved" as const,
      retrievedAt: "2026-09-07T12:00:00.000Z" })),
  } : structuredClone(empty);
}

function fixture(evidence = empty, text = prose, quote = false) {
  const context: ReaderFirstSelection["context"] = { loopId: "contract-loop", revision: 1,
    originalCuriosity: "How do thermostats work?", directions: [], declaredKnowledge: [], readingPreferences: [],
    preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-07" };
  const selection: ReaderFirstSelection = { context, evidence, idea: { id: "contract-idea", key: "control",
    loopId: context.loopId, loopRevision: 1, headline: "How does a thermostat control heat?",
    deck: "Follow an everyday feedback example.", readerQuestion: context.originalCuriosity,
    payoff: "Distinguish a reading from its target.", advanceBeyondPrevious: "A first feedback explanation.",
    qualifications: [], passageIds: [] } };
  const value: ReaderFirstWriterOutput = { status: "written", reason: null, research: structuredClone(empty), article: {
    category: "tech-science", kicker: "Feedback", topic: "Thermostats", title: selection.idea.headline,
    deck: selection.idea.deck, summary: ["Read a temperature.", "Compare it with a target.", "Adjust the heat."],
    whyWritten: "An everyday example explains the reader's feedback question.", readingMinutes: 1,
    body: [{ type: "paragraph", text, citations: [] }, ...(quote ? [{ type: "quote" as const, text: prose,
      attribution: "Constructed example", citations: [{ sourceKey: "s1", label: "example.org" }] }] : [])],
    sources: quote ? [{ key: "s1", url: evidence.sources[0].url, title: evidence.sources[0].title,
      publisher: "example.org", publishedAt: null }] : [],
  } };
  const draft = compileReaderFirstArticle(selection, value);
  const question: ReaderFirstQuestion = { context, evidence, draft, articleVersion: "contract-article-v1",
    question: "What does the measurement establish?", previousMessages: [] };
  const answer: ReaderFirstAnswerOutput = compileReaderFirstAnswer(question, { status: "answered", reason: null,
    research: structuredClone(empty), body: structuredClone(draft.article!.body), sources: structuredClone(draft.article!.sources) });
  return { selection, draft, question, answer };
}

function finding(excerpt = prose, overrides: Partial<Finding> = {}): Finding {
  return { location: "body.0", excerpt, severity: "material", kind: "verification_required",
    reason: "This constructed assertion needs verification.", repair: "Verify the exact claim and preserve its scope.",
    passageIds: [], ...overrides };
}
function passed(fingerprint: string): ReaderFirstCheckOutput {
  return { fingerprint, verdict: "pass", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    readerFit: true, continuity: true, privacyPassed: true, findings: [] };
}
function capture(overrides: Partial<ReaderFirstCheckOutput> = {}) {
  const calls: OnDemandProviderRequest[] = [];
  const raws: ReaderFirstCheckOutput[] = [];
  const before: string[] = [];
  const options: ReaderFirstStageOptions = { model: "injected-model", idempotencyKey: "contract-check", safetyIdentifier: "constructed-reader",
    provider: async (request) => {
      calls.push(request);
      const raw = { ...passed((request.input as { fingerprint: string }).fingerprint), ...structuredClone(overrides) };
      raws.push(raw); before.push(JSON.stringify(raw));
      return { output: raw, usage };
    } };
  return { options, calls, raws, unchanged() { assert.deepEqual(raws.map((raw) => JSON.stringify(raw)), before); } };
}
function check(mode: Mode, data: ReturnType<typeof fixture>, options: ReaderFirstStageOptions) {
  return mode === "article" ? checkReaderFirstArticle({ ...data.selection, draft: data.draft }, options)
    : checkReaderFirstAnswer({ ...data.question, answer: data.answer }, options);
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function resolve(value: unknown, root: Record<string, unknown>): Record<string, unknown> {
  const node = object(value);
  return typeof node.$ref === "string" ? resolve(node.$ref.slice(2).split("/").reduce<unknown>((part, key) => object(part)[key], root), root) : node;
}
function wireFindings(request: OnDemandProviderRequest) {
  const wire = zodTextFormat(request.schema, "reader_first_contract");
  assert.equal(wire.strict, true); assert.equal(wire.schema.type, "object");
  const findings = resolve(object(wire.schema.properties).findings, wire.schema);
  return { root: wire.schema, fields: object(resolve(findings.items, wire.schema).properties) };
}

test("actual article and answer checker schemas convert through the SDK with exact locations and 0, 1 or 48 evidence IDs", async () => {
  for (const count of [0, 1, 48]) for (const mode of ["article", "answer"] as const) {
    const data = fixture(packet(count), prose, count > 0); const seen = capture();
    assert.equal((await check(mode, data, seen.options)).accepted, true);
    const request = seen.calls[0]; const { root, fields } = wireFindings(request);
    const body = ["body.0", ...(count ? ["body.1", "body.1.attribution"] : [])];
    const locations = mode === "article" ? ["title", "deck", "whyWritten", "summary.0", "summary.1", "summary.2", ...body] : body;
    assert.deepEqual(resolve(fields.location, root).enum, locations);
    const ids = resolve(fields.passageIds, root); const item = resolve(ids.items, root);
    assert.equal(ids.type, "array"); assert.equal(ids.maxItems, count ? 12 : 0);
    assert.equal(item.type, "string");
    if (count) assert.deepEqual(item.enum, data.selection.evidence.passages.map((passage) => passage.id));
    else { assert.equal(item.enum, undefined); assert.equal(item.minLength, 1); assert.equal(item.maxLength, 40); }
    assert.equal("prefixItems" in ids, false); assert.equal("not" in item, false);
    const sample = { ...seen.raws[0], findings: [finding(prose, { passageIds: count ? ["p1"] : [] })] };
    assert.equal(request.schema.safeParse(sample).success, true);
    assert.equal(request.schema.safeParse({ ...sample, findings: [finding(prose, { passageIds: ["invented"] })] }).success, false);
    seen.unchanged();
  }
});

test("provider schemas reject unknown locations, source IDs and model-only passage IDs without narrowing the saved schema", async () => {
  const evidence = packet(1);
  evidence.passages.push({ ...evidence.passages[0], id: "model-only", provenance: "model_reported", retrievedAt: null },
    { ...evidence.passages[0], id: "model-with-time", provenance: "model_reported" });
  for (const mode of ["article", "answer"] as const) {
    const data = fixture(evidence); const seen = capture(); await check(mode, data, seen.options);
    const request = seen.calls[0]; const { root, fields } = wireFindings(request);
    assert.deepEqual(resolve(resolve(fields.passageIds, root).items, root).enum, ["p1"]);
    for (const invalid of [finding(prose, { location: "body.999" }), finding(prose, { location: "sources" }),
      finding(prose, { location: "BODY.0" }), finding(prose, { passageIds: ["s1"] }),
      finding(prose, { passageIds: ["model-only"] }), finding(prose, { passageIds: ["model-with-time"] })]) {
      const raw = { ...seen.raws[0], findings: [invalid] };
      assert.equal(readerFirstCheckOutputSchema.safeParse(raw).success, true, "historical storage schema remains generic");
      assert.equal(request.schema.safeParse(raw).success, false);
      const rejected = capture({ findings: [invalid] });
      await assert.rejects(check(mode, data, rejected.options), ProviderResponseValidationError); rejected.unchanged();
    }
  }
  const noTimestamp = packet(1); noTimestamp.passages[0].retrievedAt = null;
  const data = fixture(); data.selection.evidence = noTimestamp;
  const seen = capture(); await assert.rejects(check("article", data, seen.options), /retrieval time/);
  assert.equal(seen.calls.length, 0, "malformed retrieved evidence fails before any provider call");
});

test("empty evidence still supports injected stable passes while false flags and material current-claim findings withhold", async () => {
  const current = "The current report says this device never fails.";
  for (const mode of ["article", "answer"] as const) {
    assert.equal((await check(mode, fixture(), capture().options)).accepted, true);
    for (const flag of ["accuracyPassed", "verificationPassed", "promiseFulfilled", "readerFit", "continuity", "privacyPassed"] as const) {
      const seen = capture({ [flag]: false });
      const result = await check(mode, fixture(empty, current), seen.options);
      assert.equal(result.accepted, false); assert.equal(result.output[flag], false); seen.unchanged();
    }
    const seen = capture({ findings: [finding(current)] });
    const result = await check(mode, fixture(empty, current), seen.options);
    assert.equal(result.output.verdict, "pass"); assert.equal(result.accepted, false);
    assert.deepEqual(result.output.findings, seen.raws[0].findings); seen.unchanged();
  }
});

test("provider-only first ASCII letter correction preserves prefix, remainder, failure flags, findings and raw response", async () => {
  for (const [actual, excerpt] of [["“7 A thermostat compares a reading.”", "“7 a thermostat compares a reading.”"],
    ["(2) a thermostat compares a reading.", "(2) A thermostat compares a reading."]]) {
    for (const mode of ["article", "answer"] as const) {
      const data = fixture(empty, actual); const before = JSON.stringify(data);
      const seen = capture({ verdict: "repair", verificationPassed: false, findings: [finding(excerpt)] });
      const result = await check(mode, data, seen.options);
      assert.equal(result.accepted, false); assert.equal(result.output.verificationPassed, false);
      assert.deepEqual(result.output, { ...seen.raws[0], findings: [{ ...seen.raws[0].findings[0], excerpt: actual }] });
      assert.equal(JSON.stringify(data), before); seen.unchanged();
    }
  }
});

test("capitalization correction cannot case-fold, change whitespace or punctuation, cross locations, or choose ambiguous or absent text", async () => {
  const cases = [
    { text: prose, excerpt: prose.toUpperCase() },
    { text: prose, excerpt: prose.replace("thermostat", "Thermostat") },
    { text: prose, excerpt: prose.replace("A thermostat", "a  thermostat") },
    { text: prose, excerpt: prose.replace("A thermostat", "a thermostat").replace(".", "!") },
    { text: "Évaluation matters.", excerpt: "évaluation matters." },
    { text: "123 — 456.", excerpt: "123 - 456." },
    { text: prose, excerpt: "a thermostat measures a different property." },
    { text: `${prose} ${prose}`, excerpt: "a thermostat compares a reading with a target." },
    { text: "Mechanism", excerpt: "a thermostat compares a reading with a target.", other: prose },
    { text: "a thermostat compares a reading with a target.", excerpt: prose, other: prose },
  ];
  for (const mode of ["article", "answer"] as const) for (const item of cases) {
    const data = fixture(empty, item.text);
    if (item.other) { data.draft.article!.body.push({ type: "paragraph", text: item.other, citations: [] }); data.answer.body.push({ type: "paragraph", text: item.other, citations: [] }); }
    const seen = capture({ verdict: "repair", findings: [finding(item.excerpt)] });
    await assert.rejects(check(mode, data, seen.options), ProviderResponseValidationError); seen.unchanged();
  }
});

test("existing unique exact body reindex remains available and exact declared matches take precedence over duplicate text", async () => {
  for (const mode of ["article", "answer"] as const) {
    const data = fixture(); data.draft.article!.body.unshift({ type: "heading", level: 2, text: "Mechanism" });
    data.answer.body.unshift({ type: "heading", level: 2, text: "Mechanism" });
    const seen = capture({ findings: [finding()] }); const result = await check(mode, data, seen.options);
    assert.equal(result.output.findings[0].location, "body.1"); assert.equal(result.accepted, false); seen.unchanged();
    data.draft.article!.body.push({ type: "paragraph", text: prose, citations: [] }); data.answer.body.push({ type: "paragraph", text: prose, citations: [] });
    const exact = capture({ findings: [finding(prose, { location: "body.1" })] });
    const retained = await check(mode, data, exact.options);
    assert.equal(retained.output.findings[0].location, "body.1"); exact.unchanged();
  }
});

test("saved acceptance and repair remain strict and never apply provider-only capitalization correction", async () => {
  for (const mode of ["article", "answer"] as const) {
    const data = fixture(); const seen = capture({ findings: [finding("a thermostat compares a reading with a target.", { severity: "nonmaterial", kind: "clarity" })] });
    const normalized = await check(mode, data, seen.options);
    assert.equal(normalized.accepted, true, "only the exact normalized nonmaterial finding can pass");
    const raw = seen.raws[0];
    assert.throws(() => mode === "article" ? assertAcceptedReaderFirstArticleCheck(data.selection, data.draft, raw)
      : assertAcceptedReaderFirstAnswerCheck(data.question, data.answer, raw), /actual text location/);
    const failed = { ...raw, verdict: "repair" as const, verificationPassed: false };
    let calls = 0; const forbidden: ReaderFirstStageOptions = { ...seen.options, provider: async () => { calls++; throw new Error("Unexpected repair provider call"); } };
    await assert.rejects(async () => mode === "article"
      ? repairReaderFirstArticle({ ...data.selection, draft: data.draft, check: failed }, forbidden)
      : repairReaderFirstAnswer({ ...data.question, answer: data.answer, check: failed }, forbidden), /actual text location/);
    assert.equal(calls, 0); seen.unchanged();
  }
});
