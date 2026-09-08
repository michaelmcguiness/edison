import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAcceptedOnDemandArticleCheck,
  checkOnDemandArticle,
  generateSelectedArticle,
  onDemandCheckAccepted,
  repairOnDemandArticle,
  writeOnDemandArticle,
  type OnDemandCheckOutput,
  type OnDemandProviderRequest,
  type OnDemandStageOptions,
  type OnDemandWriterOutput,
  type SelectedOnDemandInput,
} from "../packages/ai/src/on-demand";
import { providerFixtureOutput, surfaceCheckFixture, writerProviderFixture } from "./helpers/on-demand-provider-fixture";
import { editorialCalibrationContrasts as contrasts } from "./fixtures/on-demand-editorial-calibration";

// Immutable real-failure reference: request 772dbf04-ed94-45ac-adc5-d3842b01fb48
// at c600d9393a6ae16ff78a61ce0a2efcf87e9addf1. No private prose or packet data is
// reproduced here. Everything below is constructed and uses injected verdicts;
// successful routing does not establish a model's editorial discrimination.
function fixture() {
  const input: SelectedOnDemandInput = {
    context: {
      loopId: "loop-editorial-contrast", revision: 0, originalCuriosity: "How is a sensor intended to work?",
      directions: [], declaredKnowledge: [], readingPreferences: [], previousArticles: [],
      preferences: { length: "brief", depth: 50 }, currentDate: "2026-09-06",
    },
    idea: {
      id: "batch-sensor:intent", key: "intent", loopId: "loop-editorial-contrast", loopRevision: 0,
      headline: "The sensor is designed to detect light", deck: "Design intent is distinct from measured accuracy.",
      readerQuestion: "How is the sensor meant to work?", payoff: "Explain the conversion step without inventing a measured outcome.",
      advanceBeyondPrevious: "Explain the sensor's intended mechanism.", qualifications: ["No measured accuracy is reported."], passageIds: ["p1", "p2"],
    },
    evidence: {
      sources: [
        { id: "s1", title: "Constructed design record", publisher: "Example Workshop", url: "https://example.org/design",
          publishedDate: null, datePrecision: "unknown" },
        { id: "s2", title: "Constructed mechanism record", publisher: "Example Laboratory", url: "https://example.net/mechanism",
          publishedDate: null, datePrecision: "unknown" },
      ],
      passages: [
        { id: "p1", sourceId: "s1", text: contrasts.designIntent.evidence,
          locator: "Constructed design note", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
        { id: "p2", sourceId: "s2", text: "The sensor converts incoming light into an electrical signal.",
          locator: "Constructed mechanism note", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
      ],
    },
  };
  const article: NonNullable<OnDemandWriterOutput["article"]> = {
    category: "tech-science", kicker: "A constructed sensor", topic: "Design and evidence", title: input.idea.headline,
    deck: input.idea.deck, whyWritten: "Explain the intended mechanism and distinguish it from demonstrated accuracy.", readingMinutes: 3,
    summary: [contrasts.designIntent.prose, "The mechanism converts light into an electrical signal.", "Measured accuracy is not reported."],
    body: ["The design record describes a sensor intended to register light.", "An intended function is not a measured accuracy result.",
      "The sensor converts incoming light into an electrical signal.", "The design note does not report measured accuracy.",
      "The record supports a description of intent, not a claim of perfect detection.",
      "The mechanism record describes conversion of incoming light into an electrical signal."].map((text, index) => ({
      type: "paragraph", text, citations: [{ sourceKey: index === 2 || index === 5 ? "s2" : "s1", label: index === 2 || index === 5 ? "example.net" : "example.org" }],
    })),
    sources: input.evidence.sources.map((source) => ({ key: source.id, title: source.title, publisher: source.publisher, url: source.url, publishedAt: null })),
  };
  const locations = ["title", "deck", "summary.0", "summary.1", "summary.2", ...article.body.map((_, index) => `body.${index}`)];
  const draft: OnDemandWriterOutput = {
    status: "written", article, reason: null,
    claims: locations.map((location, index) => ({ id: `c${index + 1}`,
      text: location === "summary.1" || location === "body.2" || location === "body.5"
        ? "The sensor converts incoming light into an electrical signal." : "The sensor was designed to register light; measured accuracy is not reported.",
      locations: [location], passageIds: [location === "summary.1" || location === "body.2" || location === "body.5" ? "p2" : "p1"] })),
  };
  return { input, draft };
}
function check(draft: OnDemandWriterOutput): OnDemandCheckOutput {
  return { verdict: "pass", promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true, sourceMetadataPassed: true,
    claims: draft.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds, reason: "Constructed supported assessment." })),
    missedMaterialClaims: [], findings: [], surfaceChecks: surfaceCheckFixture(draft) };
}
function row(check: OnDemandCheckOutput, location: string) {
  const found = check.surfaceChecks!.surfaces.find((surface) => surface.location === location);
  assert.ok(found);
  return found;
}
function claimAt(draft: OnDemandWriterOutput, location: string) {
  const found = draft.claims.find((claim) => claim.locations.includes(location));
  assert.ok(found);
  return found;
}
const usage = { providerResponseId: "constructed-editorial-response", model: "injected-model", inputTokens: 101,
  cachedInputTokens: 0, outputTokens: 51, webSearchCalls: 0 };
type Observation = { request: OnDemandProviderRequest; raw: unknown; retained: unknown };
function options(identity: string, output: unknown, observations: Observation[]): OnDemandStageOptions {
  return { model: usage.model, idempotencyKey: identity, safetyIdentifier: "constructed-reader",
    provider: async (request) => {
      const raw = providerFixtureOutput(request, output);
      observations.push({ request, raw, retained: structuredClone(raw) });
      return { output: raw, usage };
    } };
}
const stages = { write: writeOnDemandArticle, check: checkOnDemandArticle, repair: repairOnDemandArticle };
function generationOptions(outputs: { write: unknown; check: unknown; repair: unknown; recheck: unknown }, observations: Observation[]) {
  return { write: options("constructed:write", outputs.write, observations), check: options("constructed:check", outputs.check, observations),
    repair: options("constructed:repair", outputs.repair, observations), recheck: options("constructed:recheck", outputs.recheck, observations) };
}

test("missing support and actual opposing evidence keep distinct verdicts and both withhold after the sole repair", async () => {
  for (const example of [contrasts.missingAchievement, contrasts.opposedAchievement]) {
    const { input, draft } = fixture();
    const verdict = example.expectedVerdict;
    draft.article!.summary[0] = example.prose;
    claimAt(draft, "summary.0").text = example.prose;
    input.evidence.passages.push({ id: "p3", sourceId: "s1", text: example.evidence,
      locator: "Constructed contrast observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" });
    const failed = check(draft);
    failed.verdict = "repair";
    const passageIds = verdict === "missing" ? [] : ["p3"];
    const reason = example.reason;
    Object.assign(row(failed, "summary.0"), { verdict, passageIds, reason });
    Object.assign(failed.claims.find((claim) => claim.claimId === claimAt(draft, "summary.0").id)!, { verdict, passageIds, reason });
    const observations: Observation[] = [];
    const result = await generateSelectedArticle(input, stages,
      generationOptions({ write: draft, check: failed, repair: draft, recheck: failed }, observations));
    assert.equal(result.status, "withheld");
    assert.equal(result.article, null);
    assert.deepEqual(observations.map(({ request }) => request.stage), ["write", "check", "repair", "check"]);
    assert.deepEqual(observations.map(({ request }) => request.maxOutputTokens), [12000, 8000, 12000, 8000]);
    for (const index of [1, 3]) {
      const retainedCheck = result.trace[index].output as OnDemandCheckOutput;
      assert.equal(row(retainedCheck, "summary.0").verdict, verdict);
      assert.equal(row(retainedCheck, "summary.0").reason, reason);
      assert.deepEqual(row(retainedCheck, "summary.0").passageIds, passageIds);
    }
    for (const entry of result.trace) assert.deepEqual(entry.usage, usage);
    for (const observed of observations) {
      assert.deepEqual(observed.raw, observed.retained);
      assert.equal(observed.request.research, false);
    }
  }
});

test("supported design intent is not collapsed into an unsupported achieved-result assertion", async () => {
  const { input, draft } = fixture();
  const observations: Observation[] = [];
  const intent = await checkOnDemandArticle({ ...input, draft }, options("intent", check(draft), observations));
  assert.equal(intent.accepted, true);
  assert.equal(row(intent.output, "summary.0").verdict, contrasts.designIntent.expectedVerdict);
  const achieved = structuredClone(draft);
  achieved.article!.summary[0] = contrasts.missingAchievement.prose;
  claimAt(achieved, "summary.0").text = achieved.article!.summary[0];
  const failed = check(achieved);
  Object.assign(row(failed, "summary.0"), { verdict: contrasts.missingAchievement.expectedVerdict, passageIds: [], reason: contrasts.missingAchievement.reason });
  const checked = await checkOnDemandArticle({ ...input, draft: achieved }, options("achievement", failed, observations));
  assert.equal(checked.accepted, false);
  assert.equal(row(checked.output, "summary.0").verdict, "missing", "Absence of a measured outcome is not manufactured opposing evidence.");
  assert.throws(() => assertAcceptedOnDemandArticleCheck(input, achieved, checked.output));
});

test("useful explanation supported elsewhere in the retained packet survives one passage/source-mapping repair", async () => {
  const { input, draft } = fixture();
  const originalText = draft.article!.body.map((block) => block.text);
  const paragraph = draft.article!.body[2];
  assert.equal(paragraph.type, "paragraph");
  paragraph.citations = [{ sourceKey: "s1", label: "example.org" }];
  claimAt(draft, "body.2").passageIds = ["p1"];
  const failed = check(draft);
  row(failed, "body.2").passageIds = ["p2"];
  failed.claims.find((claim) => claim.claimId === claimAt(draft, "body.2").id)!.passageIds = ["p2"];
  failed.findings = [{ location: "body.2", severity: "material", reason: "The explanation is supported by retained p2, not its displayed source s1.",
    repair: "Keep the explanation and map its actual retained passage p2." }];
  const observations: Observation[] = [];
  const checked = await checkOnDemandArticle({ ...input, draft }, options("mapping:check", failed, observations));
  assert.equal(checked.accepted, false);
  const raw = writerProviderFixture(draft);
  const repairedBlock = raw.article!.body[2];
  assert.equal(repairedBlock.type, "paragraph");
  repairedBlock.claims[0].passageIds = ["p2"];
  const repaired = await repairOnDemandArticle({ ...input, draft, check: checked.output }, options("mapping:repair", raw, observations));
  assert.deepEqual(repaired.output.article!.body.map((block) => block.text), originalText);
  assert.equal(repaired.output.article!.title, input.idea.headline);
  assert.deepEqual(claimAt(repaired.output, "body.2").passageIds, ["p2"]);
  const displayed = repaired.output.article!.body[2];
  assert.equal(displayed.type, "paragraph");
  assert.deepEqual(displayed.citations, [{ sourceKey: "s2", label: "example.net" }]);
  const rechecked = await checkOnDemandArticle({ ...input, draft: repaired.output }, options("mapping:recheck", check(repaired.output), observations));
  assert.equal(rechecked.accepted, true);
  assert.deepEqual(observations.map(({ request }) => request.stage), ["check", "repair", "check"]);
  assert.deepEqual((observations[1].request.input as SelectedOnDemandInput).evidence, input.evidence);
  assert.deepEqual((observations[2].request.input as SelectedOnDemandInput).evidence, input.evidence);
  for (const observed of observations) assert.deepEqual(observed.raw, observed.retained);
});

test("reader fit and promised explanation independently block an article even when every factual verdict passes", async () => {
  const { input, draft } = fixture();
  for (const flag of ["readerFit", "promiseFulfilled"] as const) {
    const failed = check(draft);
    failed[flag] = false;
    // Every other gate remains positive, so the selected flag alone must veto.
    assert.deepEqual(failed.findings, []);
    assert.ok(failed.claims.every((claim) => claim.verdict === "supported"));
    assert.ok(failed.surfaceChecks!.surfaces.every((surface) => surface.verdict === "supported"));
    assert.equal(onDemandCheckAccepted(failed), false);
    const checked = await checkOnDemandArticle({ ...input, draft }, options(`independent:${flag}`, failed, []));
    assert.equal(checked.accepted, false);
    assert.equal(checked.output[flag], false);
    assert.throws(() => assertAcceptedOnDemandArticleCheck(input, draft, checked.output));
  }
});

test("an unavailable essential explanatory bridge ends honestly without another repair or provider round", async () => {
  const unavailable = { status: "insufficient_evidence", article: null, reason: "The retained packet does not establish the essential explanatory bridge." };
  for (const stopAt of ["write", "check", "repair"] as const) {
    const { input, draft } = fixture();
    input.evidence.passages[1].text = "The design record names an optical sensor but supplies no explanation of the conversion mechanism.";
    const failed = check(draft);
    failed.promiseFulfilled = false;
    failed.verdict = stopAt === "check" ? "insufficient_evidence" : "repair";
    failed.findings = [{ location: "body.2", severity: "material", reason: "The essential explanation is unavailable in the retained packet.",
      repair: "Return insufficient_evidence rather than inventing the missing mechanism." }];
    const observations: Observation[] = [];
    const result = await generateSelectedArticle(input, stages,
      generationOptions({ write: stopAt === "write" ? unavailable : draft, check: failed, repair: unavailable, recheck: check(draft) }, observations));
    assert.equal(result.status, "withheld");
    assert.equal(result.article, null);
    assert.deepEqual(observations.map(({ request }) => request.stage),
      stopAt === "write" ? ["write"] : stopAt === "check" ? ["write", "check"] : ["write", "check", "repair"]);
    for (const observed of observations) assert.deepEqual(observed.raw, observed.retained);
  }
});

test("an imprecise definition and transferred other-study result retain missing verdicts instead of invented contradiction", async () => {
  for (const example of [contrasts.impreciseDefinition, contrasts.transferredOutcome]) {
    const { input, draft } = fixture();
    draft.article!.summary[0] = example.prose;
    claimAt(draft, "summary.0").text = example.prose;
    input.evidence.passages.push({ id: "p3", sourceId: "s1", text: example.evidence,
      locator: "Constructed contrast record", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" });
    const failed = check(draft);
    const finding = { verdict: example.expectedVerdict, passageIds: [], reason: example.reason };
    Object.assign(row(failed, "summary.0"), finding);
    Object.assign(failed.claims.find((claim) => claim.claimId === claimAt(draft, "summary.0").id)!, finding);
    const checked = await checkOnDemandArticle({ ...input, draft }, options("contrast:check", failed, []));
    assert.equal(checked.accepted, false);
    assert.equal(row(checked.output, "summary.0").verdict, "missing");
    assert.equal(row(checked.output, "summary.0").reason, example.reason);
    assert.throws(() => assertAcceptedOnDemandArticleCheck(input, draft, checked.output));
  }
});
