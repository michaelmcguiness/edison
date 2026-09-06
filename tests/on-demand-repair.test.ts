import assert from "node:assert/strict";
import test from "node:test";
import {
  answerOnDemandQuestion,
  checkOnDemandArticle,
  OnDemandDraftValidationError,
  repairOnDemandArticle,
  writeOnDemandArticle,
  type OnDemandCheckOutput,
  type OnDemandProviderRequest,
  type OnDemandStageOptions,
  type OnDemandWriterOutput,
  type SelectedOnDemandInput,
} from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import {
  generatedArticleFormatSchema,
  generatedArticleSchema,
  onDemandArticleFormatSchema,
  onDemandArticleSchema,
} from "../packages/ai/src/schemas";

// Entirely constructed text and injected responses: no captured reader prose,
// remote evidence retrieval, provider calls, or semantic-quality claims.
const selection: SelectedOnDemandInput = {
  context: {
    loopId: "loop-constructed-lamp", revision: 0,
    originalCuriosity: "What did the constructed lamp experiment establish?",
    directions: [], declaredKnowledge: [], readingPreferences: [],
    preferences: { length: "brief", depth: 50 }, previousArticles: [],
    currentDate: "2026-09-06",
  },
  idea: {
    id: "batch-lamp:lamp", key: "lamp", loopId: "loop-constructed-lamp", loopRevision: 0,
    headline: "The lamp lit only during the test",
    deck: "A bounded observation leaves future performance untested.",
    readerQuestion: "What did this test show?", payoff: "Distinguish an observation from a forecast.",
    advanceBeyondPrevious: "Explain the scope of the first test.",
    qualifications: ["Future performance was not tested."], passageIds: ["p1"],
  },
  evidence: {
    sources: [{ id: "s1", url: "https://example.org/constructed-lamp", title: "Constructed lamp record",
      publisher: "Example Laboratory", publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: "p1", sourceId: "s1", text: "The lamp lit during the test. Future performance was not tested.",
      locator: "Constructed observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" }],
  },
};

function draft(): OnDemandWriterOutput {
  const source = selection.evidence.sources[0];
  const article = {
    category: "tech-science" as const, kicker: "Observation", topic: "A constructed experiment",
    title: selection.idea.headline, deck: selection.idea.deck,
    summary: ["The lamp lit.", "The observation concerned one test.", "Future performance remains untested."],
    whyWritten: "Explain what the bounded observation establishes.", readingMinutes: 3,
    body: Array.from({ length: 9 }, (_, index) => index === 0 || index === 3 || index === 6
      ? { type: "heading" as const, level: 2 as const, text: `Observation ${index + 1}` }
      : { type: "paragraph" as const, text: `Explanation ${index + 1}: the test did not establish future performance.`,
        citations: [{ sourceKey: source.id, label: "Constructed record" }] }),
    sources: [{ key: source.id, title: source.title, publisher: source.publisher, url: source.url, publishedAt: null }],
  };
  const locations = ["title", "deck", "summary.0", "summary.1", "summary.2",
    ...article.body.flatMap((block, index) => block.type === "heading" ? [] : [`body.${index}`])];
  return { status: "written", article, reason: null, claims: locations.map((location, index) => ({
    id: `c${index}`, text: "The observation does not establish future performance.", locations: [location], passageIds: ["p1"],
  })) };
}

function damagedDraft(): OnDemandWriterOutput {
  const value = draft();
  value.article!.sources.push(structuredClone(value.article!.sources[0]));
  value.claims = value.claims.filter((claim) => !claim.locations.some((location) => ["body.7", "body.8"].includes(location)));
  return value;
}

const usage = { providerResponseId: "constructed-response", model: "injected-model",
  inputTokens: 101, cachedInputTokens: 0, outputTokens: 51, webSearchCalls: 0 };
function options(output: unknown, requests: OnDemandProviderRequest[] = []): OnDemandStageOptions {
  return {
    model: usage.model, idempotencyKey: "constructed-request", safetyIdentifier: "constructed-reader",
    provider: async (request) => { requests.push(request); return { output, usage }; },
  };
}

function check(value: OnDemandWriterOutput, accepted = true): OnDemandCheckOutput {
  return {
    verdict: accepted ? "pass" : "repair", promiseFulfilled: accepted, readerFit: true,
    continuity: true, privacyPassed: true, sourceMetadataPassed: true,
    claims: value.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds,
      reason: "The constructed passage supports the stated limit." })),
    missedMaterialClaims: [], findings: accepted ? [] : [{ location: "deck", severity: "material",
      reason: "The intended payoff is not yet met.", repair: "Clarify the limit using the retained observation." }],
  };
}

async function captureRepairable(value = damagedDraft()) {
  try {
    await writeOnDemandArticle(selection, options(value));
    assert.fail("The invalid initial draft must not pass writer validation.");
  } catch (error) {
    assert.ok(error instanceof OnDemandDraftValidationError);
    return error;
  }
}

test("one-source on-demand schemas and writer preserve the legacy two-source minimum", async () => {
  const value = draft();
  assert.equal(onDemandArticleFormatSchema.safeParse(value.article).success, true);
  assert.equal(onDemandArticleSchema.safeParse(value.article).success, true);
  assert.equal(generatedArticleFormatSchema.safeParse(value.article).success, false);
  assert.equal(generatedArticleSchema.safeParse(value.article).success, false);
  const requests: OnDemandProviderRequest[] = [];
  const written = await writeOnDemandArticle(selection, options(value, requests));
  assert.deepEqual(written.output, value);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, "write");
  assert.equal(requests[0].research, false);
  const checked = await checkOnDemandArticle({ ...selection, draft: written.output }, options(check(value)));
  assert.equal(checked.accepted, true);
});

test("a one-source on-demand article remains valid input to its scoped answer", async () => {
  const value = draft();
  const requests: OnDemandProviderRequest[] = [];
  const answered = await answerOnDemandQuestion({ articleId: "constructed-article", articleVersion: 1,
    article: value.article!, evidence: selection.evidence, question: "Was future performance tested?", conversation: [],
  }, options({ status: "answered", answer: "Future performance was not tested.", missingEvidence: null,
    claims: [{ id: "answer-limit", text: "Future performance was not tested.", locations: ["answer"], passageIds: ["p1"] }],
  }, requests));
  assert.equal(answered.output.status, "answered");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, "answer");
  assert.equal(requests[0].research, false);
});

test("duplicate sources and uncovered ending paragraphs retain the initial draft, findings and observed usage", async () => {
  const value = damagedDraft();
  const original = structuredClone(value);
  const error = await captureRepairable(value);
  assert.ok(error instanceof ProviderResponseValidationError);
  assert.deepEqual(error.observedUsage, usage);
  assert.deepEqual(error.draft, original);
  assert.deepEqual(value, original, "Validation must not silently rewrite the response.");
  assert.ok(error.findings.length > 0 && error.findings.length <= 24);
  for (const location of ["body.7", "body.8"]) {
    assert.ok(error.findings.some((finding) => finding.location.includes(location)), `Missing finding for ${location}`);
  }
  assert.ok(error.findings.some((finding) => /source/i.test(`${finding.location} ${finding.reason}`)));
  for (const finding of error.findings) {
    assert.equal(typeof finding.location, "string");
    assert.equal(typeof finding.reason, "string");
    assert.ok(finding.location.length > 0 && finding.reason.length > 0);
  }
});

test("repair findings remain bounded when many prose surfaces lack claim coverage", async () => {
  const value = draft();
  value.article!.body = Array.from({ length: 40 }, () => ({ type: "paragraph", text: "The lamp lit during the test.",
    citations: [{ sourceKey: "s1", label: "Constructed record" }] }));
  value.claims = [];
  const error = await captureRepairable(value);
  assert.ok(error.findings.length > 0 && error.findings.length <= 24);
});

test("a corrected deterministic repair still requires a separate editorial check", async () => {
  const invalid = await captureRepairable();
  const corrected = draft();
  const requests: OnDemandProviderRequest[] = [];
  const repaired = await repairOnDemandArticle({ ...selection, draft: invalid.draft, validationFindings: invalid.findings },
    options(corrected, requests));
  assert.deepEqual(repaired.output, corrected);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, "repair");
  assert.equal(requests[0].research, false);
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  const checked = await checkOnDemandArticle({ ...selection, draft: repaired.output }, options(check(corrected, false), requests));
  assert.equal(checked.accepted, false, "A structurally valid repair is not an editorial pass.");
  assert.deepEqual(requests.map((request) => request.stage), ["repair", "check"]);
});

test("repair accepts a failed check or validation findings, never both or neither", async () => {
  const invalid = await captureRepairable();
  const value = draft();
  const requests: OnDemandProviderRequest[] = [];
  const checkedRepair = await repairOnDemandArticle({ ...selection, draft: value, check: check(value, false) }, options(value, requests));
  assert.equal(checkedRepair.output.status, "written");
  const invalidInputs = [
    { ...selection, draft: value },
    { ...selection, draft: value, check: check(value, false), validationFindings: invalid.findings },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(async () => repairOnDemandArticle(input as unknown as Parameters<typeof repairOnDemandArticle>[0], options(value, requests)));
  }
  assert.equal(requests.length, 1, "Ambiguous repair inputs must fail before the provider boundary.");
});

test("an unparseable initial response is terminal and does not enter deterministic repair", async () => {
  await assert.rejects(writeOnDemandArticle(selection, options({ status: "written" })), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseValidationError);
    assert.equal(error instanceof OnDemandDraftValidationError, false);
    assert.deepEqual(error.observedUsage, usage);
    return true;
  });
});

test("an invalid repaired response remains terminal instead of receiving another repair", async () => {
  const invalid = await captureRepairable();
  const requests: OnDemandProviderRequest[] = [];
  await assert.rejects(repairOnDemandArticle({ ...selection, draft: invalid.draft, validationFindings: invalid.findings },
    options(damagedDraft(), requests)), (error: unknown) => {
    assert.ok(error instanceof ProviderResponseValidationError);
    assert.equal(error instanceof OnDemandDraftValidationError, false);
    assert.deepEqual(error.observedUsage, usage);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stage, "repair");
});

test("complete and unfinished copies of actual citation labels in prose enter the initial repair path", async () => {
  for (const fragment of [" [Constructed record]", " [Constructed record", " [Constructed record (p"]) {
    const value = draft();
    const block = value.article!.body[1];
    assert.equal(block.type, "paragraph");
    block.text += fragment;
    const error = await captureRepairable(value);
    assert.deepEqual(error.observedUsage, usage);
    assert.ok(error.findings.some((finding) => finding.location === "body.1" && /inline|reference|citation/i.test(finding.reason)));
  }
});

test("unfinished citation-label parentheses fail while mathematical notation and balanced labels remain valid", async () => {
  for (const label of ["Example Lab (", "Example Lab (test"]) {
    const value = draft();
    const block = value.article!.body[1];
    assert.equal(block.type, "paragraph");
    block.citations[0].label = label;
    const error = await captureRepairable(value);
    assert.ok(error.findings.some((finding) => finding.location === "body.1" && /label|unfinished/i.test(finding.reason)));
  }
  const value = draft();
  const block = value.article!.body[1];
  assert.equal(block.type, "paragraph");
  block.text = "The notation [0, 1] and (x + y) does not extend the constructed test's evidence.";
  block.citations[0].label = "Example Lab (test)";
  const written = await writeOnDemandArticle(selection, options(value));
  assert.deepEqual(written.output.article!.body[1], block);
});

test("one-source eligibility retains source-key and source-URL uniqueness and rejects dangling citations", async () => {
  const duplicateUrl = draft();
  duplicateUrl.article!.sources.push({ ...duplicateUrl.article!.sources[0], key: "s2" });
  const duplicateKey = draft();
  duplicateKey.article!.sources.push({ ...duplicateKey.article!.sources[0], url: "https://example.org/another-record" });
  const danglingCitation = draft();
  const block = danglingCitation.article!.body[1];
  assert.equal(block.type, "paragraph");
  block.citations[0].sourceKey = "absent-source";
  for (const value of [duplicateUrl, duplicateKey, danglingCitation]) {
    assert.equal(onDemandArticleSchema.safeParse(value.article).success, false);
    const error = await captureRepairable(value);
    assert.deepEqual(error.observedUsage, usage);
    assert.ok(error.findings.some((finding) => /source|citation/i.test(`${finding.location} ${finding.reason}`)));
  }
});
