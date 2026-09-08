import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  assertAcceptedReaderFirstArticleCheck, assertAcceptedReaderFirstAnswerCheck,
  checkReaderFirstArticle, checkReaderFirstAnswer, compileReaderFirstArticle, compileReaderFirstAnswer,
  readerFirstCheckOutputSchema, repairReaderFirstArticle, repairReaderFirstAnswer,
  readerFirstCheckAccepted, readerFirstFingerprint, READER_FIRST_PROMPTS, READER_FIRST_PROMPT_VERSION,
  READER_FIRST_CHECKER_CONTRACT_VERSION, READER_FIRST_CHECKER_PROMPT, writeReaderFirstArticle, answerReaderFirstQuestion,
  type ReaderFirstSelection, type ReaderFirstWriterOutput, type ReaderFirstAnswerOutput,
  type ReaderFirstQuestion, type ReaderFirstCheckOutput, type ReaderFirstStageOptions, type ReaderFirstCheckerOptions,
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
function capture(overrides: Partial<ReaderFirstCheckOutput> = {}, checkerOptions: ReaderFirstCheckerOptions = {}) {
  const calls: OnDemandProviderRequest[] = [];
  const raws: ReaderFirstCheckOutput[] = [];
  const outputs: unknown[] = [];
  const before: string[] = [];
  const options: ReaderFirstStageOptions = { ...checkerOptions, model: "injected-model", idempotencyKey: "contract-check", safetyIdentifier: "constructed-reader",
    provider: async (request) => {
      calls.push(request);
      const raw = { ...passed((request.input as { fingerprint: string }).fingerprint), ...structuredClone(overrides) };
      const output = checkerOptions.checkerContractVersion ? { check: raw } : raw;
      raws.push(raw); outputs.push(output); before.push(JSON.stringify(output));
      return { output, usage };
    } };
  return { options, calls, raws, outputs, unchanged() { assert.deepEqual(outputs.map((output) => JSON.stringify(output)), before); } };
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

const cleanChecker: ReaderFirstCheckerOptions = { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION };
const assessments = ["accuracyPassed", "verificationPassed", "promiseFulfilled", "readerFit", "continuity", "privacyPassed"] as const;
function frozenRequest(call: OnDemandProviderRequest) {
  const { schema, ...rest } = call;
  return { ...rest, wireFormat: zodTextFormat(schema, `edison_demand_${call.stage}`) };
}
function accepted(mode: Mode, data: ReturnType<typeof fixture>, value: ReaderFirstCheckOutput, options?: ReaderFirstCheckerOptions) {
  return mode === "article" ? assertAcceptedReaderFirstArticleCheck(data.selection, data.draft, value, options)
    : assertAcceptedReaderFirstAnswerCheck(data.question, data.answer, value, options);
}

test("literal pre-change v2.5 prompt, saved-schema and complete checker request hashes remain identical", async () => {
  // Captured before this change at 9b1f08f, not computed from a second copy of
  // the candidate implementation. Includes provider input and SDK wire schema.
  assert.equal(READER_FIRST_PROMPT_VERSION, "edison-reader-first-v2.5");
  assert.deepEqual(Object.fromEntries(Object.entries(READER_FIRST_PROMPTS).map(([name, prompt]) => [name, readerFirstFingerprint(prompt)])), {
    ideas: "8739efea2b6d0a22a8a2fcb9e895c8278248ac2a6cb6b7bea7700877609e451f",
    ideas_check: "6afd342df2a0ec8940c18dca32ef7f7a9719ec1798e088f0addfaa51d56d567b",
    write: "0bc9c447dfad2d9c654173796612d4bfaf157e9e9c460c7728995eb37a607b4e",
    check: "3a8ace8214ac7236919af35926aa81e597e3debfa0f783a3bee58cd3704f2a12",
    repair: "3de337063b7202aaf10551f6a4ed68d1be94fbf4acc51fe80d80e34cd8c93d7d",
    answer: "f761f869a07f08b63b45a8f12aaf1fd8aac9921707d638297f0399f44babd786",
    answer_repair: "0e09b442f90586d2c4b5950ceae16f09e303cc9427c9b0689561b5916663fdf1",
  });
  assert.equal(readerFirstFingerprint(zodTextFormat(readerFirstCheckOutputSchema, "legacy_saved_check").schema), "2e065974943bb4b1dfebe2eeb7c1a9e0792c67258cf4d4ee6accf789e8ac390c");
  const expected = { article: "f67cc386d85b45c8f4cf4d1ae8ebb5400c514d0d333edcf6e14a26cf645bdecb", answer: "1777de528466f5de576732093ff58607215a3175dd8ee146a5f17501298a8c0d" };
  for (const mode of ["article", "answer"] as const) {
    const data = fixture(), seen = capture(); await check(mode, data, seen.options);
    assert.equal(readerFirstFingerprint(frozenRequest(seen.calls[0])), expected[mode]);
    const explicitMissing = capture({}, { checkerContractVersion: undefined }); await check(mode, data, explicitMissing.options);
    assert.equal(readerFirstFingerprint(frozenRequest(explicitMissing.calls[0])), expected[mode]);
  }
});

test("new article and Ask wire contracts use a strict object with nested branches and enforce clean passes in the actual SDK schema", async () => {
  for (const mode of ["article", "answer"] as const) for (const count of [0, 1, 48]) {
    const data = fixture(packet(count)), seen = capture({}, cleanChecker);
    const result = await check(mode, data, seen.options);
    assert.equal(result.accepted, true); assert.equal(seen.calls.length, 1);
    assert.equal(result.promptVersion, READER_FIRST_CHECKER_CONTRACT_VERSION);
    assert.equal(seen.calls[0].instructions, READER_FIRST_CHECKER_PROMPT);
    const wire = zodTextFormat(seen.calls[0].schema, "new_contract"), root = wire.schema;
    assert.equal(wire.strict, true); assert.equal(root.type, "object"); assert.equal(root.anyOf, undefined);
    assert.equal(root.additionalProperties, false); assert.deepEqual(root.required, ["check"]);
    const branches = object(object(root.properties).check).anyOf as unknown[];
    assert.equal(branches.length, 3);
    for (const [index, verdict] of ["pass", "repair", "insufficient_evidence"].entries()) {
      const branch = resolve(branches[index], root), fields = object(branch.properties);
      assert.equal(branch.additionalProperties, false); assert.deepEqual(new Set(branch.required as string[]), new Set(Object.keys(fields)));
      assert.equal(resolve(fields.verdict, root).const, verdict);
      const findings = resolve(fields.findings, root), findingFields = object(resolve(findings.items, root).properties);
      assert.equal(findings.maxItems, index === 0 ? 0 : 24); assert.equal(findings.minItems, undefined, "non-pass finding minimum is unchanged");
      for (const name of assessments) {
        const field = resolve(fields[name], root); assert.equal(field.type, "boolean"); assert.equal(field.const, index === 0 ? true : undefined);
      }
      assert.ok((resolve(findingFields.location, root).enum as string[]).includes("body.0"));
      const ids = resolve(findingFields.passageIds, root);
      assert.equal(ids.maxItems, count ? 12 : 0);
      if (count) assert.deepEqual(resolve(ids.items, root).enum, data.selection.evidence.passages.map((passage) => passage.id));
    }
    const legacy = capture(); await check(mode, data, legacy.options);
    assert.deepEqual(seen.calls[0].input, legacy.calls[0].input, "selector is not injected into artifact identity or repair context");
    assert.deepEqual(result.output, seen.raws[0]); accepted(mode, data, result.output, cleanChecker); seen.unchanged();
  }
});

test("new pass responses with false assessments or any findings fail without discarding raw output or observed usage", async () => {
  for (const mode of ["article", "answer"] as const) {
    const contradictions: Partial<ReaderFirstCheckOutput>[] = assessments.map((name) => ({ [name]: false }));
    contradictions.push({ findings: [finding()] }, { findings: [finding(prose, { severity: "nonmaterial", kind: "clarity" })] });
    for (const value of contradictions) {
      const seen = capture(value, cleanChecker);
      await assert.rejects(check(mode, fixture(), seen.options), (error: unknown) => {
        assert.ok(error instanceof ProviderResponseValidationError); assert.deepEqual(error.observedUsage, usage); return true;
      });
      assert.equal(seen.calls.length, 1); assert.equal(seen.calls[0].schema.safeParse(seen.outputs[0]).success, false); seen.unchanged();
    }
  }
});

test("new non-pass branches preserve failed flags and every exact-bound finding, including empty historical-style failures", async () => {
  for (const mode of ["article", "answer"] as const) for (const verdict of ["repair", "insufficient_evidence"] as const) {
    const evidence = packet(1), data = fixture(evidence);
    const findings: Finding[] = [finding(prose, { passageIds: ["p1"] }), finding(prose, { kind: "missing" }),
      finding(prose, { severity: "nonmaterial", kind: "clarity" })];
    for (const retained of [findings, []]) {
      const seen = capture({ verdict, ...Object.fromEntries(assessments.map((name) => [name, false])), findings: retained }, cleanChecker);
      const result = await check(mode, data, seen.options);
      assert.equal(result.accepted, false); assert.deepEqual(result.output, seen.raws[0]);
      assert.deepEqual(result.output.findings, retained); assert.equal(readerFirstCheckAccepted(result.output, cleanChecker), false); seen.unchanged();
    }
  }
});

test("new failing checks still reject invented anchors, passages and fingerprints and retain only the existing unambiguous normalization", async () => {
  for (const mode of ["article", "answer"] as const) {
    for (const value of [
      { fingerprint: "0".repeat(64) }, { findings: [finding("Invented excerpt.")] },
      { findings: [finding(prose, { location: "body.99" })] }, { findings: [finding(prose, { passageIds: ["invented"] })] },
      { findings: [finding(prose.toUpperCase())] },
    ]) {
      const seen = capture({ verdict: "repair", verificationPassed: false, ...value }, cleanChecker);
      await assert.rejects(check(mode, fixture(packet(1)), seen.options), ProviderResponseValidationError); seen.unchanged();
    }
    const data = fixture(); data.draft.article!.body.unshift({ type: "heading", level: 2, text: "Mechanism" });
    data.answer.body.unshift({ type: "heading", level: 2, text: "Mechanism" });
    const moved = capture({ verdict: "repair", verificationPassed: false, findings: [finding()] }, cleanChecker);
    const result = await check(mode, data, moved.options);
    assert.equal(result.accepted, false); assert.equal(result.output.findings[0].location, "body.1");
    assert.deepEqual(result.output, { ...moved.raws[0], findings: [{ ...moved.raws[0].findings[0], location: "body.1" }] }); moved.unchanged();
    const cased = capture({ verdict: "repair", findings: [finding("a thermostat compares a reading with a target.")] }, cleanChecker);
    const corrected = await check(mode, fixture(), cased.options);
    assert.equal(corrected.output.findings[0].excerpt, prose); assert.equal(corrected.accepted, false); cased.unchanged();
  }
});

test("final new-contract assertions reject nonempty stored passes while valid legacy minor findings and invalid legacy rejection remain unchanged", async () => {
  for (const mode of ["article", "answer"] as const) {
    const data = fixture(), seen = capture({ findings: [finding(prose, { severity: "nonmaterial", kind: "clarity" })] });
    const result = await check(mode, data, seen.options);
    assert.equal(result.accepted, true); assert.equal(readerFirstCheckAccepted(result.output), true); accepted(mode, data, result.output);
    assert.equal(readerFirstCheckAccepted(result.output, cleanChecker), false);
    assert.throws(() => accepted(mode, data, result.output, cleanChecker), /editorial_withheld/);
    const invalid = { ...result.output, findings: [finding("Invented minor excerpt.", { severity: "nonmaterial", kind: "clarity" })] };
    for (const options of [undefined, cleanChecker]) assert.throws(() => accepted(mode, data, invalid, options), /actual text location/);
    for (const name of assessments) assert.throws(() => accepted(mode, data, { ...result.output, findings: [], [name]: false }, cleanChecker), /editorial_withheld/);
  }
});

test("unknown or null checker selectors fail before any provider and cannot enter legacy final acceptance", async () => {
  for (const mode of ["article", "answer"] as const) for (const marker of [null, "edison-reader-first-v2.5", "next", 1, {}, []]) {
    const data = fixture(), seen = capture(), options = { ...seen.options, checkerContractVersion: marker } as unknown as ReaderFirstStageOptions;
    await assert.rejects(check(mode, data, options), /Unsupported reader-first checker contract/); assert.equal(seen.calls.length, 0);
    const clean = capture(); const result = await check(mode, data, clean.options);
    assert.throws(() => accepted(mode, data, result.output, options), /Unsupported reader-first checker contract/);
    assert.throws(() => readerFirstCheckAccepted(result.output, options), /Unsupported reader-first checker contract/);
  }
  for (const mode of ["article", "answer"] as const) {
    const data = fixture();
    await assert.rejects(check(mode, data, null as unknown as ReaderFirstStageOptions), /Unsupported reader-first checker contract/);
    const seen = capture(); const result = await check(mode, data, seen.options);
    assert.throws(() => accepted(mode, data, result.output, null as unknown as ReaderFirstCheckerOptions), /Unsupported reader-first checker contract/);
  }
});

test("a selected checker version leaves write, answer and sole-repair requests byte-identical and preserves failure input", async () => {
  for (const mode of ["article", "answer"] as const) for (const repairing of [false, true]) {
    const data = fixture(), checked = capture({ verdict: "repair", verificationPassed: false, findings: [finding()] }, cleanChecker);
    const failed = await check(mode, data, checked.options), calls: OnDemandProviderRequest[] = [];
    for (const selector of [{}, cleanChecker]) {
      const options: ReaderFirstStageOptions = { ...checked.options, checkerContractVersion: undefined, ...selector, provider: async (call) => {
        calls.push(call);
        return { output: mode === "article"
          ? { status: "insufficient_evidence", article: null, research: empty, reason: "Constructed unavailable response." }
          : { status: "insufficient_evidence", body: [], sourceKeys: [], research: empty, reason: "Constructed unavailable response." }, usage };
      } };
      const result = mode === "article"
        ? await (repairing ? repairReaderFirstArticle({ ...data.selection, draft: data.draft, check: failed.output }, options) : writeReaderFirstArticle(data.selection, options))
        : await (repairing ? repairReaderFirstAnswer({ ...data.question, answer: data.answer, check: failed.output }, options) : answerReaderFirstQuestion(data.question, options));
      assert.equal(result.promptVersion, READER_FIRST_PROMPT_VERSION);
    }
    assert.equal(calls.length, 2); assert.deepEqual(frozenRequest(calls[0]), frozenRequest(calls[1]));
    if (repairing) assert.deepEqual((calls[1].input as { check: ReaderFirstCheckOutput }).check, failed.output);
    assert.equal(calls[1].instructions, repairing ? mode === "article" ? READER_FIRST_PROMPTS.repair : READER_FIRST_PROMPTS.answer_repair
      : mode === "article" ? READER_FIRST_PROMPTS.write : READER_FIRST_PROMPTS.answer);
  }
});

test("same-contract cached response replay reconstructs identical checker input/schema without mutating the retained envelope", async () => {
  for (const mode of ["article", "answer"] as const) for (const selector of [{}, cleanChecker]) {
    const data = fixture(), first = capture({}, selector), initial = await check(mode, data, first.options);
    const retained = structuredClone(first.outputs[0]), before = JSON.stringify(retained);
    let reads = 0;
    const replay = await check(mode, data, { ...first.options, provider: async (call) => {
      reads++; assert.deepEqual(frozenRequest(call), frozenRequest(first.calls[0])); return { output: retained, usage };
    } });
    assert.equal(reads, 1); assert.deepEqual(replay, initial); assert.equal(JSON.stringify(retained), before);
  }
});
