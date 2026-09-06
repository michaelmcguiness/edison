import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleOnDemandWriterOutput,
  assertOnDemandDraft,
  checkOnDemandArticle,
  onDemandWriterProviderOutputSchema,
  type OnDemandCheckOutput,
  type OnDemandProviderRequest,
  type OnDemandStageOptions,
  type OnDemandWriterOutput,
  type OnDemandWriterProviderOutput,
  type SelectedOnDemandInput,
} from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";

// Constructed observations only. These tests exercise structural contracts with
// injected checker responses, not provider quality or factual acceptance.
function selection(): SelectedOnDemandInput {
  return {
    context: {
      loopId: "loop-surface-test", revision: 0, originalCuriosity: "What did this constructed test establish?",
      directions: [], declaredKnowledge: [], readingPreferences: [], previousArticles: [],
      preferences: { length: "brief", depth: 50 }, currentDate: "2026-09-06",
    },
    idea: {
      id: "batch-surface:test", key: "test", loopId: "loop-surface-test", loopRevision: 0,
      headline: "The lamp lit during one test", deck: "The observation leaves future performance untested.",
      readerQuestion: "What did the observation establish?", payoff: "Understand a bounded test.",
      advanceBeyondPrevious: "Explain the initial observation.", qualifications: ["Future performance was not tested."],
      passageIds: ["p1"],
    },
    evidence: {
      sources: [
        { id: "s1", title: "Constructed lamp record", publisher: "www.example.org", url: "https://www.example.org/lamp",
          datePrecision: "unknown", publishedDate: null },
        { id: "s2", title: "Constructed dated record", publisher: "www.example.net", url: "https://www.example.net/lamp",
          datePrecision: "day", publishedDate: "2026-09-01" },
      ],
      passages: [
        { id: "p1", sourceId: "s1", text: "The lamp lit during the test. Future performance was not tested.",
          locator: "Constructed observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
        { id: "p2", sourceId: "s2", text: "The dated record also reports a lamp lighting during the test.",
          locator: "Constructed observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
      ],
    },
  };
}

function localClaim(text: string, passageIds = ["p1"]) { return { text, passageIds }; }
function surface(text: string) { return { text, claims: [localClaim(text)] }; }

function rawDraft(): OnDemandWriterProviderOutput {
  const input = selection();
  return {
    status: "written", reason: null,
    article: {
      category: "tech-science", kicker: "A constructed test", topic: "A bounded observation",
      whyWritten: "Explain what the observation establishes.", readingMinutes: 3,
      title: surface(input.idea.headline), deck: surface(input.idea.deck),
      summary: [surface("The lamp lit."), surface("The observation concerns one test."), surface("Future performance was not tested.")],
      body: [
        { type: "heading", level: 2, text: "The observation", evidence: { kind: "neutral", claims: [] } },
        { type: "paragraph", ...surface("The lamp lit during the constructed test.") },
        { type: "quote", text: "Future performance was not tested.", attribution: null,
          claims: [localClaim("The record does not establish future performance.")] },
        { type: "heading", level: 2, text: "Future performance remains untested", evidence: {
          kind: "material", claims: [localClaim("Future performance remains untested.")],
        } },
        { type: "paragraph", ...surface("One observation does not establish future performance.") },
        { type: "paragraph", ...surface("The constructed record concerns the observed test.") },
        { type: "heading", level: 2, text: "The limit", evidence: { kind: "neutral", claims: [] } },
        { type: "paragraph", ...surface("The final explanation preserves the test's limit.") },
        { type: "paragraph", ...surface("The ending makes no forecast about another test.") },
      ],
    },
  };
}

const usage = { providerResponseId: "constructed-check-response", model: "injected-model", inputTokens: 101,
  cachedInputTokens: 0, outputTokens: 51, webSearchCalls: 0 };
function options(output: unknown, calls: OnDemandProviderRequest[] = []): OnDemandStageOptions {
  return { model: usage.model, idempotencyKey: "constructed-check", safetyIdentifier: "constructed-reader",
    provider: async (request) => { calls.push(request); return { output, usage }; } };
}
function checker(value: OnDemandWriterOutput): Omit<OnDemandCheckOutput, "sourceMetadataPassed"> {
  return {
    verdict: "pass", promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true,
    claims: value.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds,
      reason: "The constructed evidence supports this bounded observation." })),
    missedMaterialClaims: [], findings: [],
  };
}

test("nested surfaces assemble exact locations through headings and the final paragraph without mutating raw output", () => {
  const input = selection();
  const raw = rawDraft();
  const retained = structuredClone(raw);
  const assembled = assembleOnDemandWriterOutput(input, raw);
  const expected = ["title", "deck", "summary.0", "summary.1", "summary.2", "body.1", "body.2", "body.3",
    "body.4", "body.5", "body.7", "body.8"];
  assert.deepEqual(assembled.claims.map((claim) => claim.locations), expected.map((location) => [location]));
  assert.deepEqual(assembled.claims.map((claim) => claim.id), expected.map((_, index) => `c${index + 1}`));
  assert.deepEqual(assembled.article!.body.map((block) => block.text), raw.article!.body.map((block) => block.text));
  assert.deepEqual(raw, retained);
  assert.deepEqual(assembleOnDemandWriterOutput(input, raw), assembled, "Assembly must be deterministic.");
  assert.doesNotThrow(() => assertOnDemandDraft(input, assembled));
});

test("neutral headings cannot hide supplied claims and material headings require their own claim", () => {
  assert.equal(onDemandWriterProviderOutputSchema.safeParse(rawDraft()).success, true);
  for (const evidence of [{ kind: "neutral", claims: [localClaim("A factual assertion.")] }, { kind: "material", claims: [] }]) {
    const raw = rawDraft();
    const changed = { ...raw, article: { ...raw.article!, body: raw.article!.body.map((block, index) => index === 0
      ? { type: "heading", level: 2, text: "A heading", evidence } : block) } };
    assert.equal(onDemandWriterProviderOutputSchema.safeParse(changed).success, false);
  }
  const raw = rawDraft();
  const body = raw.article!.body[1];
  assert.equal(body.type, "paragraph");
  body.claims = [];
  assert.equal(onDemandWriterProviderOutputSchema.safeParse(raw).success, false, "A paragraph always needs attached evidence.");
});

test("assembly copies canonical source metadata, emits complete hostname labels and preserves unknown dates", () => {
  const input = selection();
  const raw = rawDraft();
  const body = raw.article!.body[7];
  assert.equal(body.type, "paragraph");
  body.claims[0].passageIds = ["p2"];
  const assembled = assembleOnDemandWriterOutput(input, raw);
  for (const source of assembled.article!.sources) {
    const original = input.evidence.sources.find((entry) => entry.id === source.key)!;
    assert.deepEqual({ title: source.title, publisher: source.publisher, url: source.url },
      { title: original.title, publisher: original.publisher, url: original.url });
  }
  assert.equal(assembled.article!.sources.find((source) => source.key === "s1")!.publishedAt, null);
  assert.equal(assembled.article!.sources.find((source) => source.key === "s2")!.publishedAt?.slice(0, 10), "2026-09-01");
  const first = assembled.article!.body[1];
  const last = assembled.article!.body[7];
  assert.equal(first.type, "paragraph");
  assert.equal(last.type, "paragraph");
  assert.deepEqual(first.citations, [{ sourceKey: "s1", label: "example.org" }]);
  assert.deepEqual(last.citations, [{ sourceKey: "s2", label: "example.net" }]);
  for (const precision of ["year", "month"] as const) {
    const coarse = selection();
    coarse.evidence.sources[0].datePrecision = precision;
    coarse.evidence.sources[0].publishedDate = precision === "year" ? "2026" : "2026-09";
    assert.equal(assembleOnDemandWriterOutput(coarse, rawDraft()).article!.sources[0].publishedAt, null);
  }
});

test("a 24-character hostname is complete and longer hosts use their stable evidence index", () => {
  for (const [hostname, expected] of [[`${"a".repeat(20)}.org`, `${"a".repeat(20)}.org`],
    [`${"a".repeat(21)}.org`, "Source 2"]]) {
    const input = selection();
    input.evidence.sources[1].url = `https://www.${hostname}/record`;
    const raw = rawDraft();
    const body = raw.article!.body[1];
    assert.equal(body.type, "paragraph");
    body.claims[0].passageIds = ["p2"];
    const assembled = assembleOnDemandWriterOutput(input, raw);
    const result = assembled.article!.body[1];
    assert.equal(result.type, "paragraph");
    assert.equal(result.citations[0].label, expected);
    assert.ok(result.citations[0].label.length <= 24);
  }
});

test("unknown and model-reported passage references fail rather than acquire retrieved provenance", () => {
  const unknown = rawDraft();
  unknown.article!.title.claims[0].passageIds = ["unknown-passage"];
  assert.throws(() => assembleOnDemandWriterOutput(selection(), unknown));
  const unverified = selection();
  unverified.evidence.passages[0].provenance = "model_reported";
  unverified.evidence.passages[0].retrievedAt = null;
  assert.throws(() => assembleOnDemandWriterOutput(unverified, rawDraft()));
  const missingTimestamp = selection();
  missingTimestamp.evidence.passages[0].retrievedAt = null;
  assert.throws(() => assembleOnDemandWriterOutput(missingTimestamp, rawDraft()));
});

test("more than 100 attached claims fail explicitly without truncating the final map", () => {
  const raw = rawDraft();
  raw.article!.body = Array.from({ length: 40 }, (_, index) => ({ type: "paragraph", text: `Constructed paragraph ${index}.`,
    claims: Array.from({ length: 3 }, (_, claim) => localClaim(`Constructed claim ${index}.${claim}.`)) }));
  const retained = structuredClone(raw);
  assert.equal(onDemandWriterProviderOutputSchema.safeParse(raw).success, true, "The fixture must reach the aggregate guard.");
  assert.throws(() => assembleOnDemandWriterOutput(selection(), raw), /100|claim|limit/i);
  assert.deepEqual(raw, retained);
});

test("repeated local claims retain deterministic individual identities and each surface location", () => {
  const raw = rawDraft();
  raw.article!.deck.claims = structuredClone(raw.article!.title.claims);
  const assembled = assembleOnDemandWriterOutput(selection(), raw);
  assert.deepEqual(assembled.claims.slice(0, 2).map(({ id, locations }) => ({ id, locations })),
    [{ id: "c1", locations: ["title"] }, { id: "c2", locations: ["deck"] }]);
});

test("v1.4 wire schema rejects the old canonical envelope and model-supplied presentation fields", () => {
  const canonical = assembleOnDemandWriterOutput(selection(), rawDraft());
  assert.equal(onDemandWriterProviderOutputSchema.safeParse(canonical).success, false);
  const raw = rawDraft();
  assert.equal(onDemandWriterProviderOutputSchema.safeParse({ ...raw, claims: canonical.claims }).success, false);
  assert.equal(onDemandWriterProviderOutputSchema.safeParse({ ...raw, article: { ...raw.article!, sources: canonical.article!.sources } }).success, false);
  assert.equal(onDemandWriterProviderOutputSchema.safeParse({ ...raw, article: { ...raw.article!, body: raw.article!.body.map((block, index) => index === 1
    ? { ...block, citations: [{ sourceKey: "s1", label: "Model label" }] } : block) } }).success, false);
});

test("tampered canonical source metadata and labels still fail the final draft validator", () => {
  for (const change of ["publisher", "date", "label"] as const) {
    const input = selection();
    const assembled = assembleOnDemandWriterOutput(input, rawDraft());
    if (change === "publisher") assembled.article!.sources[0].publisher = "Unretained publisher";
    if (change === "date") assembled.article!.sources[0].publishedAt = "2026-09-01T00:00:00.000Z";
    if (change === "label") {
      const body = assembled.article!.body[1];
      assert.equal(body.type, "paragraph");
      body.citations[0].label = "Invented label";
    }
    assert.throws(() => assertOnDemandDraft(input, assembled), `${change} must not bypass canonical validation.`);
  }
});

test("checker preserves an unknown source date and derives metadata acceptance after deterministic validation", async () => {
  const input = selection();
  const assembled = assembleOnDemandWriterOutput(input, rawDraft());
  const calls: OnDemandProviderRequest[] = [];
  const result = await checkOnDemandArticle({ ...input, draft: assembled }, options(checker(assembled), calls));
  assert.equal(result.accepted, true);
  assert.equal(result.output.sourceMetadataPassed, true);
  assert.equal(assembled.article!.sources[0].publishedAt, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, "check");
});

test("deterministic metadata acceptance cannot override factual failure or omitted heading claims", async () => {
  const input = selection();
  const assembled = assembleOnDemandWriterOutput(input, rawDraft());
  const unsupported = checker(assembled);
  unsupported.verdict = "repair";
  unsupported.claims[0].verdict = "contradicted";
  unsupported.findings = [{ location: "title", severity: "material", reason: "The constructed claim is not supported.", repair: "Keep the title within the evidence." }];
  const failed = await checkOnDemandArticle({ ...input, draft: assembled }, options(unsupported));
  assert.equal(failed.output.sourceMetadataPassed, true);
  assert.equal(failed.accepted, false);

  const headingOmitted = checker(assembled);
  headingOmitted.verdict = "repair";
  headingOmitted.missedMaterialClaims = [{ location: "body.0", text: "A supposedly neutral heading makes an omitted factual assertion." }];
  const omitted = await checkOnDemandArticle({ ...input, draft: assembled }, options(headingOmitted));
  assert.equal(omitted.accepted, false, "A neutral heading tag cannot overrule the independent checker.");
});

test("raw checker cannot supply metadata verdicts or target source metadata as a prose repair", async () => {
  const input = selection();
  const assembled = assembleOnDemandWriterOutput(input, rawDraft());
  for (const response of [{ ...checker(assembled), sourceMetadataPassed: true }, { ...checker(assembled), verdict: "repair",
    findings: [{ location: "sources.0.publishedAt", severity: "material", reason: "Change a frozen date.", repair: "Invent day precision." }] }]) {
    await assert.rejects(checkOnDemandArticle({ ...input, draft: assembled }, options(response)), ProviderResponseValidationError);
  }
});
