import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAcceptedOnDemandArticleCheck,
  assertOnDemandDraft,
  checkOnDemandArticle,
  onDemandArticleSurfaceManifest,
  onDemandCheckAccepted,
  onDemandWriterProviderOutputSchema,
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
import { providerFixtureOutput, surfaceCheckFixture, writerProviderFixture } from "./helpers/on-demand-provider-fixture";

// Constructed prose, evidence and injected verdicts only. These tests verify the
// title contract and routing; they do not measure a model's semantic judgment.
function fixture(title = "What makes a test informative?", material = false) {
  const input: SelectedOnDemandInput = {
    context: {
      loopId: "loop-title-audit", revision: 0, originalCuriosity: "How should I interpret a bounded test?",
      directions: [], declaredKnowledge: [], readingPreferences: [], previousArticles: [],
      preferences: { length: "brief", depth: 50 }, currentDate: "2026-09-06",
    },
    idea: {
      id: "batch-title:test", key: "test", loopId: "loop-title-audit", loopRevision: 0, headline: title,
      deck: "A constructed observation separates what was tested from what was not.",
      readerQuestion: "What can the observation establish?", payoff: "Distinguish the tested arrangement from untested arrangements.",
      advanceBeyondPrevious: "Explain the first observation.", qualifications: ["Either switch alone was not tested."], passageIds: ["p1"],
    },
    evidence: {
      sources: [{ id: "s1", title: "Constructed switch observation", publisher: "Example Laboratory",
        url: "https://example.org/title-test", publishedDate: null, datePrecision: "unknown" }],
      passages: [{ id: "p1", sourceId: "s1", text: "The lamp lit in the constructed test when both switches were closed. The test did not examine either switch alone.",
        locator: "Constructed observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" }],
    },
  };
  const article: NonNullable<OnDemandWriterOutput["article"]> = {
    category: "tech-science", kicker: "A constructed test", topic: "Interpreting an observation", title, deck: input.idea.deck,
    whyWritten: "Explain the difference between a tested arrangement and an untested one.", readingMinutes: 3,
    summary: ["The lamp lit during the test.", "Both switches were closed.", "Neither switch was tested alone."],
    body: [
      { type: "heading", level: 2, text: "The observation" },
      ...["Both switches were closed when the lamp lit.", "The observation concerns the constructed test.",
        "The test did not examine either switch alone.", "The observation records the switches together.",
        "The record does not establish what either switch does alone."].map((text) => ({
        type: "paragraph" as const, text, citations: [{ sourceKey: "s1", label: "example.org" }],
      })),
    ],
    sources: [{ key: "s1", title: input.evidence.sources[0].title, publisher: input.evidence.sources[0].publisher,
      url: input.evidence.sources[0].url, publishedAt: null }],
  };
  const locations = [...(material ? ["title"] : []), "deck", "summary.0", "summary.1", "summary.2",
    "body.1", "body.2", "body.3", "body.4", "body.5"];
  const draft: OnDemandWriterOutput = {
    status: "written", article, reason: null,
    claims: locations.map((location, index) => ({ id: `c${index + 1}`,
      text: "The constructed test used both switches together and did not examine either alone.",
      locations: [location], passageIds: ["p1"] })),
  };
  return { input, draft };
}

function check(draft: OnDemandWriterOutput): OnDemandCheckOutput {
  return { verdict: "pass", promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true, sourceMetadataPassed: true,
    claims: draft.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds,
      reason: "The constructed passage supports the authored claim." })),
    missedMaterialClaims: [], findings: [], surfaceChecks: surfaceCheckFixture(draft) };
}
function titleCheck(check: OnDemandCheckOutput) {
  const title = check.surfaceChecks!.surfaces.find((surface) => surface.location === "title");
  assert.ok(title);
  return title;
}
const usage = { providerResponseId: "constructed-title-response", model: "injected-model", inputTokens: 101,
  cachedInputTokens: 0, outputTokens: 51, webSearchCalls: 0 };
type Observation = { request: OnDemandProviderRequest; raw: unknown; retained: unknown };
function options(output: unknown, observations: Observation[] = []): OnDemandStageOptions {
  return { model: usage.model, idempotencyKey: "constructed-title-request", safetyIdentifier: "constructed-reader",
    provider: async (request) => {
      const raw = providerFixtureOutput(request, output);
      observations.push({ request, raw, retained: structuredClone(raw) });
      return { output: raw, usage };
    } };
}

test("neutral question and label titles retain exact text, full audit and observed raw responses", async () => {
  for (const title of ["What makes a test informative?", "Reading a test"]) {
    const { input, draft } = fixture(title);
    const original = structuredClone(draft);
    const observations: Observation[] = [];
    const written = await writeOnDemandArticle(input, options(draft, observations));
    assert.deepEqual(written.output, original);
    assert.deepEqual(written.usage, usage);
    assert.deepEqual(writerProviderFixture(draft).article!.title, { text: title, evidence: { kind: "neutral", claims: [] } });
    assert.equal(written.output.claims.some((claim) => claim.locations.includes("title")), false);
    const checked = await checkOnDemandArticle({ ...input, draft: written.output }, options(check(written.output), observations));
    assert.equal(checked.accepted, true);
    assert.equal(titleCheck(checked.output).verdict, "nonfactual");
    assert.deepEqual(titleCheck(checked.output).passageIds, []);
    const manifest = onDemandArticleSurfaceManifest(written.output);
    assert.equal(manifest.surfaces.filter((surface) => surface.location === "title").length, 1);
    assert.equal(manifest.surfaces[0].text, title);
    assert.deepEqual(manifest.surfaces[0].claims, []);
    assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(input, written.output, checked.output));
    assert.deepEqual(observations.map(({ request }) => request.stage), ["write", "check"]);
    assert.deepEqual(observations.map(({ request }) => request.maxOutputTokens), [12000, 8000]);
    for (const observed of observations) {
      assert.deepEqual(observed.raw, observed.retained);
      assert.equal(observed.request.research, false);
      assert.equal(observed.request.schema.safeParse(observed.raw).success, true);
    }
    assert.deepEqual(draft, original);
  }
});

test("a nonfactual title never waives the selected promise or independent article QA", async () => {
  const { input, draft } = fixture();
  for (const flag of ["promiseFulfilled", "readerFit", "privacyPassed"] as const) {
    const failed = check(draft);
    failed[flag] = false;
    assert.equal(titleCheck(failed).verdict, "nonfactual");
    assert.equal(onDemandCheckAccepted(failed), false);
    const checked = await checkOnDemandArticle({ ...input, draft }, options(failed));
    assert.equal(checked.accepted, false);
    assert.equal(checked.output[flag], false);
    assert.throws(() => assertAcceptedOnDemandArticleCheck(input, draft, checked.output));
  }
});

test("title evidence is an exclusive neutral/material union while empty deck, summary and body claims remain invalid", () => {
  const { draft } = fixture();
  const raw = writerProviderFixture(draft);
  assert.equal(onDemandWriterProviderOutputSchema.safeParse(raw).success, true);
  const local = { text: "Both switches were closed.", passageIds: ["p1"] };
  for (const evidence of [{ kind: "neutral", claims: [local] }, { kind: "material", claims: [] }]) {
    assert.equal(onDemandWriterProviderOutputSchema.safeParse({ ...raw,
      article: { ...raw.article!, title: { text: draft.article!.title, evidence } } }).success, false);
  }
  assert.equal(onDemandWriterProviderOutputSchema.safeParse({ ...raw,
    article: { ...raw.article!, title: { text: draft.article!.title, claims: [] } } }).success, false,
  "The old flat title wire shape must not silently bypass the classification contract.");
  for (const target of ["deck", "summary", "body"] as const) {
    const invalid = writerProviderFixture(draft);
    if (target === "deck") invalid.article!.deck.claims = [];
    if (target === "summary") invalid.article!.summary[0].claims = [];
    if (target === "body") {
      const paragraph = invalid.article!.body[1];
      assert.equal(paragraph.type, "paragraph");
      paragraph.claims = [];
    }
    assert.equal(onDemandWriterProviderOutputSchema.safeParse(invalid).success, false, target);
  }
});

test("a mapped rhetorical title can remove its mapping only through check, sole repair and a fresh full check", async () => {
  const { input, draft } = fixture("What makes a test informative?", true);
  const failed = check(draft);
  Object.assign(titleCheck(failed), { verdict: "nonfactual", passageIds: [], reason: "The open question asserts no fact; remove its unrelated authored mapping." });
  const observations: Observation[] = [];
  const checked = await checkOnDemandArticle({ ...input, draft }, options(failed, observations));
  assert.equal(checked.accepted, false);
  assert.equal(checked.output.verdict, "pass", "Classification repair must not rewrite the raw global verdict.");
  const raw = writerProviderFixture(draft);
  raw.article!.title.evidence = { kind: "neutral", claims: [] };
  const repaired = await repairOnDemandArticle({ ...input, draft, check: checked.output }, options(raw, observations));
  assert.equal(repaired.output.article!.title, input.idea.headline);
  assert.equal(repaired.output.claims.some((claim) => claim.locations.includes("title")), false);
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  assert.notEqual(onDemandArticleSurfaceManifest(repaired.output).fingerprint, failed.surfaceChecks!.fingerprint);
  assert.throws(() => assertAcceptedOnDemandArticleCheck(input, repaired.output, checked.output));
  const rechecked = await checkOnDemandArticle({ ...input, draft: repaired.output }, options(check(repaired.output), observations));
  assert.equal(rechecked.accepted, true);
  assert.deepEqual(observations.map(({ request }) => request.stage), ["check", "repair", "check"]);
  assert.deepEqual(repaired.usage, usage);
  for (const observed of observations) assert.deepEqual(observed.raw, observed.retained);
});

test("a question's supported or missing factual presupposition without a map is repairable, never automatically nonfactual", async () => {
  for (const verdict of ["supported", "missing"] as const) {
    const { input, draft } = fixture(verdict === "supported"
      ? "Why did the lamp light when both switches were closed?" : "Why did switch A alone light the lamp?");
    const failed = check(draft);
    Object.assign(titleCheck(failed), { verdict, passageIds: verdict === "supported" ? ["p1"] : [],
      reason: "Assess the actual question's factual presupposition, not its question mark." });
    const observations: Observation[] = [];
    const checked = await checkOnDemandArticle({ ...input, draft }, options(failed, observations));
    assert.equal(checked.accepted, false);
    assert.equal(titleCheck(checked.output).verdict, verdict);
    assert.throws(() => assertAcceptedOnDemandArticleCheck(input, draft, checked.output));
    if (verdict === "supported") {
      const raw = writerProviderFixture(draft);
      raw.article!.title.evidence = { kind: "material", claims: [{ text: "The lamp lit when both switches were closed.", passageIds: ["p1"] }] };
      const repaired = await repairOnDemandArticle({ ...input, draft, check: checked.output }, options(raw, observations));
      assert.equal(repaired.output.article!.title, input.idea.headline);
      assert.ok(repaired.output.claims.some((claim) => claim.locations.includes("title")));
      const rechecked = await checkOnDemandArticle({ ...input, draft: repaired.output }, options(check(repaired.output), observations));
      assert.equal(rechecked.accepted, true);
      assert.deepEqual(observations.map(({ request }) => request.stage), ["check", "repair", "check"]);
    } else {
      const repaired = await repairOnDemandArticle({ ...input, draft, check: checked.output }, options({
        status: "insufficient_evidence", article: null, reason: "The record does not establish that switch A alone lit the lamp.",
      }, observations));
      assert.equal(repaired.output.status, "insufficient_evidence");
      assert.equal(repaired.output.article, null);
      assert.equal(Object.hasOwn(repaired, "accepted"), false);
      assert.deepEqual(observations.map(({ request }) => request.stage), ["check", "repair"]);
    }
  }
});

test("an unchanged material title cannot demote after independent factual checking or without a prior check", async () => {
  for (const verdict of ["supported", "missing", "contradicted", null] as const) {
    const { input, draft } = fixture("The lamp lit in a two-switch test", true);
    const failed = check(draft);
    failed.verdict = "repair";
    Object.assign(titleCheck(failed), { verdict: verdict ?? "supported", passageIds: verdict === "supported" ? ["p1"] : [],
      reason: "The title's material assertion must retain its evidence mapping." });
    const raw = writerProviderFixture(draft);
    raw.article!.title.evidence = { kind: "neutral", claims: [] };
    const observations: Observation[] = [];
    const repairInput = verdict === null
      ? { ...input, draft, validationFindings: [{ location: "body.5", reason: "Constructed deterministic repair report." }] }
      : { ...input, draft, check: failed };
    await assert.rejects(repairOnDemandArticle(repairInput, options(raw, observations)), (error: unknown) => {
      assert.ok(error instanceof ProviderResponseValidationError);
      assert.equal(error instanceof OnDemandDraftValidationError, false);
      assert.deepEqual(error.observedUsage, usage);
      return true;
    });
    assert.deepEqual(observations.map(({ request }) => request.stage), ["repair"]);
    assert.deepEqual(observations[0].raw, observations[0].retained);
  }
});

test("changing title text or its mapping invalidates retained audits and the exact selected headline remains mandatory", () => {
  const { input, draft } = fixture("The lamp lit in a two-switch test", true);
  const prior = check(draft);
  const unmapped = structuredClone(draft);
  unmapped.claims = unmapped.claims.filter((claim) => !claim.locations.includes("title"));
  assert.doesNotThrow(() => assertOnDemandDraft(input, unmapped));
  assert.notEqual(onDemandArticleSurfaceManifest(unmapped).fingerprint, prior.surfaceChecks!.fingerprint);
  assert.throws(() => assertAcceptedOnDemandArticleCheck(input, unmapped, prior));
  const changed = structuredClone(draft);
  changed.article!.title = "An unselected headline";
  assert.throws(() => assertOnDemandDraft(input, changed), /headline/i);
  const otherSelection = structuredClone(input);
  otherSelection.idea.headline = changed.article!.title;
  assert.doesNotThrow(() => assertOnDemandDraft(otherSelection, changed));
  assert.throws(() => assertAcceptedOnDemandArticleCheck(otherSelection, changed, prior));
});

test("an unrelated deterministic repair never fabricates a missing-claim finding for a neutral title", async () => {
  const { input, draft } = fixture();
  draft.article!.body[5].text += " [source 1]";
  const observations: Observation[] = [];
  let invalid: OnDemandDraftValidationError | undefined;
  try { await writeOnDemandArticle(input, options(draft, observations)); }
  catch (error) {
    assert.ok(error instanceof OnDemandDraftValidationError);
    invalid = error;
  }
  assert.ok(invalid, "The body citation debris must enter the sole deterministic repair route.");
  assert.ok(invalid.findings.some((finding) => finding.location === "body.5"));
  assert.equal(invalid.findings.some((finding) => finding.location === "title"), false);
  assert.deepEqual(invalid.observedUsage, usage);
  const corrected = fixture().draft;
  const repaired = await repairOnDemandArticle({ ...input, draft: invalid.draft, validationFindings: invalid.findings }, options(corrected, observations));
  assert.equal(repaired.output.claims.some((claim) => claim.locations.includes("title")), false);
  const checked = await checkOnDemandArticle({ ...input, draft: repaired.output }, options(check(repaired.output), observations));
  assert.equal(checked.accepted, true);
  assert.deepEqual(observations.map(({ request }) => request.stage), ["write", "repair", "check"]);
});

test("initial repair may replace an unselected factual title with the exact selected neutral question", async () => {
  const { input, draft } = fixture("The lamp lit in a two-switch test", true);
  input.idea.headline = "What makes a test informative?";
  const observations: Observation[] = [];
  let invalid: OnDemandDraftValidationError | undefined;
  try { await writeOnDemandArticle(input, options(draft, observations)); }
  catch (error) {
    assert.ok(error instanceof OnDemandDraftValidationError);
    invalid = error;
  }
  assert.ok(invalid);
  assert.ok(invalid.findings.some((finding) => finding.reason === "Selected headline changed"));
  const corrected = fixture(input.idea.headline).draft;
  const repaired = await repairOnDemandArticle({ ...input, draft: invalid.draft, validationFindings: invalid.findings }, options(corrected, observations));
  assert.equal(repaired.output.article!.title, input.idea.headline);
  assert.equal(repaired.output.claims.some((claim) => claim.locations.includes("title")), false,
    "The replaced, unselected assertion must not force a factual map onto the selected open question.");
  const checked = await checkOnDemandArticle({ ...input, draft: repaired.output }, options(check(repaired.output), observations));
  assert.equal(checked.accepted, true);
  assert.deepEqual(observations.map(({ request }) => request.stage), ["write", "repair", "check"]);
});
