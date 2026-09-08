import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleOnDemandWriterOutput,
  assertAcceptedOnDemandArticleCheck,
  assertOnDemandDraft,
  checkOnDemandArticle,
  onDemandArticleSurfaceManifest,
  onDemandCheckAccepted,
  OnDemandDraftValidationError,
  repairOnDemandArticle,
  type OnDemandCheckOutput,
  type OnDemandProviderRequest,
  type OnDemandStageOptions,
  type OnDemandWriterOutput,
  type OnDemandWriterProviderOutput,
  type SelectedOnDemandInput,
} from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import { providerFixtureOutput, surfaceCheckFixture, writerProviderFixture } from "./helpers/on-demand-provider-fixture";

// Entirely constructed observations and injected verdicts. These tests establish
// contract enforcement, not that a model independently recognizes this error.
function selection(): SelectedOnDemandInput {
  return {
    context: {
      loopId: "loop-surface-audit", revision: 0, originalCuriosity: "What did the constructed switch test show?",
      directions: [], declaredKnowledge: [], readingPreferences: [], previousArticles: [],
      preferences: { length: "brief", depth: 50 }, currentDate: "2026-09-06",
    },
    idea: {
      id: "batch-switch:conditions", key: "conditions", loopId: "loop-surface-audit", loopRevision: 0,
      headline: "The lamp lit when both switches were closed",
      deck: "The constructed observation does not test either switch on its own.",
      readerQuestion: "Which conditions were observed?", payoff: "Keep both tested conditions in the explanation.",
      advanceBeyondPrevious: "Explain the first observation.", qualifications: ["Other arrangements were not tested."],
      passageIds: ["p1"],
    },
    evidence: {
      sources: [
        { id: "s1", title: "Constructed switch record", publisher: "Example Laboratory", url: "https://example.org/switches",
          publishedDate: null, datePrecision: "unknown" },
        { id: "s2", title: "Constructed second record", publisher: "Example Archive", url: "https://example.net/switches",
          publishedDate: null, datePrecision: "unknown" },
      ],
      passages: [
        { id: "p1", sourceId: "s1", text: "In the constructed test, the lamp lit when switch A and switch B were both closed. No other switch arrangement was tested.",
          locator: "Constructed observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
        { id: "p2", sourceId: "s2", text: "The constructed second record states that both switches were closed when the lamp lit.",
          locator: "Constructed second observation", provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" },
      ],
    },
  };
}

function draft(): OnDemandWriterOutput {
  const input = selection();
  const local = (text: string, passageIds = ["p1"]) => ({ text, passageIds });
  const surface = (text: string, passageIds = ["p1"]) => ({ text, claims: [local(text, passageIds)] });
  const raw: OnDemandWriterProviderOutput = {
    status: "written", reason: null,
    article: {
      category: "tech-science", kicker: "A constructed test", topic: "Observed conditions",
      whyWritten: "Explain the conditions recorded in this constructed test.", readingMinutes: 3,
      title: { text: input.idea.headline, evidence: { kind: "material", claims: [local(input.idea.headline)] } }, deck: surface(input.idea.deck),
      summary: [surface("The lamp lit in the constructed test."), surface("Both switches were closed."), surface("Other switch arrangements were not tested.")],
      body: [
        { type: "heading", level: 2, text: "The observation", evidence: { kind: "neutral", claims: [] } },
        { type: "paragraph", ...surface("Both switches were closed when the lamp lit.") },
        { type: "quote", text: "No other switch arrangement was tested.", attribution: "Example Laboratory",
          claims: [local("Other switch arrangements were not tested.")] },
        { type: "heading", level: 2, text: "Both switches were closed", evidence: {
          kind: "material", claims: [local("Both switches were closed.")],
        } },
        { type: "paragraph", ...surface("The observation records the two switches together.") },
        { type: "paragraph", ...surface("The second record also describes both switches as closed.", ["p2"]) },
        { type: "heading", level: 2, text: "The limit", evidence: { kind: "neutral", claims: [] } },
        { type: "paragraph", ...surface("The test does not establish what happens with either switch alone.") },
      ],
    },
  };
  return assembleOnDemandWriterOutput(input, raw);
}

function check(value: OnDemandWriterOutput): OnDemandCheckOutput {
  return {
    verdict: "pass", promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true, sourceMetadataPassed: true,
    claims: value.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds,
      reason: "The constructed evidence supports the authored claim." })),
    missedMaterialClaims: [], findings: [], surfaceChecks: surfaceCheckFixture(value),
  };
}

const usage = { providerResponseId: "constructed-surface-audit", model: "injected-model", inputTokens: 101,
  cachedInputTokens: 0, outputTokens: 51, webSearchCalls: 0 };
function options(output: unknown, requests: OnDemandProviderRequest[] = []): OnDemandStageOptions {
  return { model: usage.model, idempotencyKey: "constructed-surface-audit", safetyIdentifier: "constructed-reader",
    provider: async (request) => { requests.push(request); return { output: providerFixtureOutput(request, output), usage }; } };
}
function row(value: OnDemandCheckOutput, location: string) {
  const found = value.surfaceChecks!.surfaces.find((surface) => surface.location === location);
  assert.ok(found, `The fixture must include ${location}.`);
  return found;
}

test("the manifest binds exact text, attribution, citations and claims through every heading and final block", () => {
  const value = draft();
  const original = structuredClone(value);
  const manifest = onDemandArticleSurfaceManifest(value);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(onDemandArticleSurfaceManifest(value), manifest);
  assert.equal(manifest.whyWritten, value.article!.whyWritten);
  assert.deepEqual(manifest.surfaces.map((surface) => surface.location),
    ["title", "deck", "summary.0", "summary.1", "summary.2", ...value.article!.body.map((_, index) => `body.${index}`)]);
  for (const [index, block] of value.article!.body.entries()) {
    const surface = manifest.surfaces.find((entry) => entry.location === `body.${index}`)!;
    assert.equal(surface.kind, block.type);
    assert.equal(surface.text, block.text);
    assert.equal(surface.attribution, block.type === "quote" ? block.attribution : null);
    assert.deepEqual(surface.citations, block.type === "heading" ? [] : block.citations);
    assert.deepEqual(surface.claims, value.claims.filter((claim) => claim.locations.includes(surface.location))
      .map(({ id, text, passageIds }) => ({ id, text, passageIds })));
  }
  assert.deepEqual(value, original);
});

test("the checker request carries the exact manifest and normalizes only after the raw response", async () => {
  const value = draft();
  const expected = check(value);
  let raw: unknown;
  let retainedRaw: unknown;
  const requests: OnDemandProviderRequest[] = [];
  const stageOptions = options(expected, requests);
  stageOptions.provider = async (request) => {
    requests.push(request);
    const input = request.input as { surfaceManifest: ReturnType<typeof onDemandArticleSurfaceManifest> };
    assert.deepEqual(input.surfaceManifest, onDemandArticleSurfaceManifest(value));
    assert.equal(input.surfaceManifest.surfaces.find((surface) => surface.location === "summary.1")!.text,
      value.article!.summary[1]);
    raw = providerFixtureOutput(request, expected);
    retainedRaw = structuredClone(raw);
    assert.equal(request.schema.safeParse(raw).success, true);
    assert.equal(Array.isArray((raw as { surfaceChecks: { surfaces: unknown } }).surfaceChecks.surfaces), false);
    return { output: raw, usage };
  };
  const result = await checkOnDemandArticle({ ...selection(), draft: value }, stageOptions);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.output.surfaceChecks, expected.surfaceChecks);
  assert.deepEqual(result.usage, usage);
  assert.deepEqual(raw, retainedRaw, "Normalization must not rewrite the raw provider response.");
  assert.equal(Object.hasOwn(raw as object, "sourceMetadataPassed"), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxOutputTokens, 8000);
  assert.equal(requests[0].research, false);
});

test("a weaker supported paraphrase cannot hide the wrong conditional on the actual summary surface", async () => {
  const value = draft();
  value.article!.summary[1] = "If switch A is closed, the lamp will light.";
  value.claims.find((claim) => claim.locations.includes("summary.1"))!.text = "The lamp lit in the constructed test.";
  assert.doesNotThrow(() => assertOnDemandDraft(selection(), value));
  const failed = check(value);
  Object.assign(row(failed, "summary.1"), { verdict: "missing", passageIds: [],
    reason: "The actual conditional omits switch B and claims an untested outcome." });
  assert.equal(failed.verdict, "pass");
  assert.ok(failed.claims.every((claim) => claim.verdict === "supported"));
  assert.equal(onDemandCheckAccepted(failed), false);
  const result = await checkOnDemandArticle({ ...selection(), draft: value }, options(failed));
  assert.equal(result.accepted, false);
  assert.equal(result.output.verdict, "pass", "The failed surface must veto, not rewrite, the model's global verdict.");
  assert.deepEqual(result.output.surfaceChecks, failed.surfaceChecks);
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, result.output));
});

test("a supported bounded future-goal paraphrase does not excuse an unsupported global negative", async () => {
  const input = selection();
  input.evidence.passages[0].text += " The team describes continuous operation as a goal for future work.";
  const bounded = draft();
  bounded.article!.body[1].text = "The record presents continuous operation as a future goal.";
  bounded.claims.find((claim) => claim.locations.includes("body.1"))!.text = bounded.article!.body[1].text;
  const accepted = await checkOnDemandArticle({ ...input, draft: bounded }, options(check(bounded)));
  assert.equal(accepted.accepted, true);
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(input, bounded, accepted.output));

  const overbroad = structuredClone(bounded);
  overbroad.article!.body[1].text = "No experiment has ever demonstrated continuous operation.";
  // Keep the weaker author claim supported: the exact surface, not its
  // paraphrase, must veto this deliberately injected universal-negative defect.
  const failed = check(overbroad);
  Object.assign(row(failed, "body.1"), { verdict: "missing", passageIds: [],
    reason: "A future goal for this team does not establish a negative claim about every experiment." });
  failed.missedMaterialClaims = [{ location: "body.1", text: overbroad.article!.body[1].text }];
  const retained = structuredClone(failed);
  const calls: OnDemandProviderRequest[] = [];
  const withheld = await checkOnDemandArticle({ ...input, draft: overbroad }, options(failed, calls));
  assert.equal(withheld.accepted, false);
  assert.deepEqual(withheld.output, retained, "All substantive findings and raw verdicts remain intact.");
  assert.deepEqual(withheld.usage, usage);
  assert.equal(calls.length, 1);
  assert.throws(() => assertAcceptedOnDemandArticleCheck(input, overbroad, withheld.output));
});

test("a corrected surface cannot reuse the prior fingerprint even when claim IDs and all verdicts pass", () => {
  const value = draft();
  const prior = check(value);
  value.article!.summary[1] = "Switch A and switch B were both closed in the observed test.";
  assert.doesNotThrow(() => assertOnDemandDraft(selection(), value));
  assert.equal(onDemandCheckAccepted(prior), true);
  assert.notEqual(onDemandArticleSurfaceManifest(value).fingerprint, prior.surfaceChecks!.fingerprint);
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, prior));
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selection(), value, check(value)));
});

test("neutral and material headings are mandatory keyed wire fields and canonical coverage rejects omissions, duplicates and unknown locations", async () => {
  const value = draft();
  const requests: OnDemandProviderRequest[] = [];
  await checkOnDemandArticle({ ...selection(), draft: value }, options(check(value), requests));
  const request = requests[0];
  for (const location of ["body.0", "body.3", "body.6", "body.7"]) {
    const raw = providerFixtureOutput(request, check(value)) as { surfaceChecks: { surfaces: Record<string, unknown> } };
    delete raw.surfaceChecks.surfaces[location];
    assert.equal(request.schema.safeParse(raw).success, false, `${location} must be a required wire field.`);
  }
  const claimsOnlyRaw = providerFixtureOutput(request, check(value)) as Record<string, unknown>;
  delete claimsOnlyRaw.surfaceChecks;
  assert.equal(request.schema.safeParse(claimsOnlyRaw).success, false, "The actual wire contract cannot accept a claims-only checker.");
  const staleRaw = providerFixtureOutput(request, check(value)) as { surfaceChecks: { fingerprint: string } };
  staleRaw.surfaceChecks.fingerprint = "0".repeat(64);
  assert.equal(request.schema.safeParse(staleRaw).success, false, "The wire fingerprint must echo the supplied literal.");
  for (const defect of ["missing", "duplicate", "unknown"] as const) {
    const invalid = check(value);
    if (defect === "missing") invalid.surfaceChecks!.surfaces = invalid.surfaceChecks!.surfaces.filter((surface) => surface.location !== "body.0");
    if (defect === "duplicate") invalid.surfaceChecks!.surfaces.push(structuredClone(row(invalid, "body.0")));
    if (defect === "unknown") row(invalid, "body.0").location = "body.99";
    assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, invalid), defect);
  }
});

test("surface support must be retrieved and bound to the sources actually cited in that body block", () => {
  const value = draft();
  for (const passageIds of [["unknown-passage"], ["p2"]]) {
    const invalid = check(value);
    row(invalid, "body.1").passageIds = passageIds;
    assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, invalid));
  }
  const input = selection();
  input.evidence.passages.push({ id: "p3", sourceId: "s1", text: "An unverified model report.", locator: "Unverified",
    provenance: "model_reported", retrievedAt: null });
  const invalid = check(value);
  row(invalid, "body.1").passageIds = ["p3"];
  assert.doesNotThrow(() => assertOnDemandDraft(input, value), "The unused unverified passage is not the draft defect.");
  assert.throws(() => assertAcceptedOnDemandArticleCheck(input, value, invalid));
  const alternative = selection();
  alternative.evidence.passages.push({ ...alternative.evidence.passages[0], id: "p3" });
  const valid = check(value);
  row(valid, "body.1").passageIds = ["p3"];
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(alternative, value, valid),
    "Alternative retrieved passages from the same displayed source remain usable.");
});

test("mixed cited and uncited surface support blocks publication and remains reachable through the sole repair", async () => {
  const value = draft();
  const failed = check(value);
  row(failed, "body.1").passageIds = ["p1", "p2"];
  const requests: OnDemandProviderRequest[] = [];
  const checked = await checkOnDemandArticle({ ...selection(), draft: value }, options(failed, requests));
  assert.equal(checked.accepted, false);
  assert.equal(checked.output.verdict, "pass");
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, checked.output));
  const raw = writerProviderFixture(value);
  const paragraph = raw.article!.body[1];
  assert.equal(paragraph.type, "paragraph");
  paragraph.claims.push({ text: "The second record describes both switches as closed when the lamp lit.", passageIds: ["p2"] });
  const repaired = await repairOnDemandArticle({ ...selection(), draft: value, check: checked.output }, options(raw, requests));
  const corrected = repaired.output.article!.body[1];
  assert.equal(corrected.type, "paragraph");
  assert.deepEqual(corrected.citations.map((citation) => citation.sourceKey), ["s1", "s2"]);
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  const rechecked = await checkOnDemandArticle({ ...selection(), draft: repaired.output }, options(check(repaired.output), requests));
  assert.equal(rechecked.accepted, true);
  assert.deepEqual(requests.map((request) => request.stage), ["check", "repair", "check"]);
});

test("a supported factual heading left unmapped by the writer needs repair rather than a terminal provider error", async () => {
  const value = draft();
  value.article!.body[0].text = "Only the two-switch arrangement was tested";
  assert.equal(value.claims.some((claim) => claim.locations.includes("body.0")), false);
  const failed = check(value);
  Object.assign(row(failed, "body.0"), { verdict: "supported", passageIds: ["p1"],
    reason: "This is a factual heading supported by the passage but missing its authored evidence mapping." });
  const requests: OnDemandProviderRequest[] = [];
  const checked = await checkOnDemandArticle({ ...selection(), draft: value }, options(failed, requests));
  assert.equal(checked.accepted, false);
  assert.equal(checked.output.verdict, "pass");
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, checked.output));
  const raw = writerProviderFixture(value);
  const heading = raw.article!.body[0];
  assert.equal(heading.type, "heading");
  heading.evidence = { kind: "material", claims: [{ text: "No other switch arrangement was tested.", passageIds: ["p1"] }] };
  const repaired = await repairOnDemandArticle({ ...selection(), draft: value, check: checked.output }, options(raw, requests));
  assert.equal(repaired.output.article!.body[0].text, value.article!.body[0].text);
  assert.ok(repaired.output.claims.some((claim) => claim.locations.includes("body.0")));
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  const rechecked = await checkOnDemandArticle({ ...selection(), draft: repaired.output }, options(check(repaired.output), requests));
  assert.equal(rechecked.accepted, true);
  assert.deepEqual(requests.map((request) => request.stage), ["check", "repair", "check"]);
});

test("generic global pass cannot bypass an absent audit or nonfactual verdict on a mapped material surface", () => {
  const value = draft();
  const claimsOnly = check(value);
  delete claimsOnly.surfaceChecks;
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, claimsOnly));
  for (const location of ["summary.1", "body.1", "body.3"]) {
    const invalid = check(value);
    Object.assign(row(invalid, location), { verdict: "nonfactual", passageIds: [] });
    assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, invalid), location);
  }
  const valid = check(value);
  assert.equal(row(valid, "body.0").verdict, "nonfactual");
  assert.doesNotThrow(() => assertAcceptedOnDemandArticleCheck(selection(), value, valid));
});

test("changing quote attribution or whyWritten breaks the retained exact-text binding", () => {
  for (const field of ["attribution", "whyWritten"] as const) {
    const value = draft();
    const prior = check(value);
    if (field === "whyWritten") value.article!.whyWritten = "Explain the limits of the two-switch observation.";
    else {
      const quote = value.article!.body[2];
      assert.equal(quote.type, "quote");
      quote.attribution = "Example Archive";
    }
    assert.doesNotThrow(() => assertOnDemandDraft(selection(), value));
    assert.notEqual(onDemandArticleSurfaceManifest(value).fingerprint, prior.surfaceChecks!.fingerprint);
    assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, prior), field);
  }
});

test("repair cannot demote an unchanged material heading, including after moving it", async () => {
  for (const { move, priorVerdict } of [
    { move: false, priorVerdict: "missing" }, { move: true, priorVerdict: "missing" },
    { move: false, priorVerdict: "contradicted" }, { move: false, priorVerdict: "supported" },
    { move: true, priorVerdict: null },
  ] as const) {
    const value = draft();
    const failed = check(value);
    failed.verdict = "repair";
    Object.assign(row(failed, "body.3"), { verdict: priorVerdict ?? "missing", passageIds: priorVerdict === "supported" ? ["p1"] : [],
      reason: "The material heading must keep its evidence through repair." });
    const raw = writerProviderFixture(value);
    const heading = raw.article!.body[3];
    assert.equal(heading.type, "heading");
    heading.evidence = { kind: "neutral", claims: [] };
    if (move) raw.article!.body.push(raw.article!.body.splice(3, 1)[0]);
    const retained = structuredClone(raw);
    const requests: OnDemandProviderRequest[] = [];
    const repairInput = priorVerdict === null
      ? { ...selection(), draft: value, validationFindings: [{ location: "body.7", reason: "Constructed deterministic prose repair." }] }
      : { ...selection(), draft: value, check: failed };
    await assert.rejects(repairOnDemandArticle(repairInput, options(raw, requests)), (error: unknown) => {
      assert.ok(error instanceof ProviderResponseValidationError);
      assert.equal(error instanceof OnDemandDraftValidationError, false, "A failed repair cannot acquire another repair allowance.");
      assert.deepEqual(error.observedUsage, usage);
      return true;
    });
    assert.deepEqual(raw, retained, "The material heading must not be silently reattached or rewritten.");
    assert.deepEqual(requests.map((request) => request.stage), ["repair"]);
  }
});

test("moving a material heading with its claims remains repairable but still requires an independent fresh check", async () => {
  const value = draft();
  const failed = check(value);
  failed.verdict = "repair";
  failed.findings = [{ location: "body.3", severity: "nonmaterial", reason: "Move the heading to clarify the structure.", repair: "Keep its text and attached evidence." }];
  const raw = writerProviderFixture(value);
  raw.article!.body.push(raw.article!.body.splice(3, 1)[0]);
  const requests: OnDemandProviderRequest[] = [];
  const repaired = await repairOnDemandArticle({ ...selection(), draft: value, check: failed }, options(raw, requests));
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  assert.ok(repaired.output.claims.some((claim) => claim.locations.includes("body.7")));
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), repaired.output, check(value)));
  const checked = await checkOnDemandArticle({ ...selection(), draft: repaired.output }, options(check(repaired.output), requests));
  assert.equal(checked.accepted, true);
  assert.deepEqual(requests.map((request) => request.stage), ["repair", "check"]);
});

test("an independent nonfactual verdict on a mapped rhetorical heading permits one repair to remove the map", async () => {
  const value = draft();
  value.article!.body[3].text = "What the test leaves open";
  const failed = check(value);
  Object.assign(row(failed, "body.3"), { verdict: "nonfactual", passageIds: [],
    reason: "This rhetorical section label makes no factual assertion; its authored mapping should be removed." });
  const requests: OnDemandProviderRequest[] = [];
  const checked = await checkOnDemandArticle({ ...selection(), draft: value }, options(failed, requests));
  assert.equal(checked.accepted, false, "Reclassification needs repair, not a provider-invalid terminal failure or publication.");
  assert.equal(checked.output.verdict, "pass", "The server must not rewrite the raw overall verdict.");
  assert.throws(() => assertAcceptedOnDemandArticleCheck(selection(), value, checked.output));
  const raw = writerProviderFixture(value);
  const heading = raw.article!.body[3];
  assert.equal(heading.type, "heading");
  heading.evidence = { kind: "neutral", claims: [] };
  const repaired = await repairOnDemandArticle({ ...selection(), draft: value, check: checked.output }, options(raw, requests));
  assert.equal(repaired.output.article!.body[3].text, value.article!.body[3].text);
  assert.equal(repaired.output.claims.some((claim) => claim.locations.includes("body.3")), false);
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  const rechecked = await checkOnDemandArticle({ ...selection(), draft: repaired.output }, options(check(repaired.output), requests));
  assert.equal(rechecked.accepted, true);
  assert.deepEqual(requests.map((request) => request.stage), ["check", "repair", "check"]);
});

test("a whyWritten privacy finding reaches the sole repair and full recheck without inventing an evidence surface", async () => {
  const value = draft();
  value.article!.whyWritten = "You privately reported failing your workplace switch-safety assessment.";
  const failed = check(value);
  failed.privacyPassed = false;
  failed.readerFit = false;
  failed.findings = [{ location: "whyWritten", severity: "material",
    reason: "The constructed explanation discloses private reader-specific context.",
    repair: "Explain the reading's purpose without revealing the private disclosure." }];
  assert.equal(onDemandArticleSurfaceManifest(value).surfaces.some((surface) => surface.location === "whyWritten"), false);
  const requests: OnDemandProviderRequest[] = [];
  const checked = await checkOnDemandArticle({ ...selection(), draft: value }, options(failed, requests));
  assert.equal(checked.accepted, false, "A valid privacy finding must reach repair, not a provider-format failure.");
  assert.equal(checked.output.findings[0].location, "whyWritten");
  const request = requests[0];
  const rawCheck = providerFixtureOutput(request, failed) as {
    surfaceChecks: { surfaces: Record<string, unknown> }; missedMaterialClaims: Array<{ location: string; text: string }>;
  };
  assert.equal(request.schema.safeParse(rawCheck).success, true);
  assert.equal(Object.hasOwn(rawCheck.surfaceChecks.surfaces, "whyWritten"), false);
  assert.equal(request.schema.safeParse({ ...rawCheck,
    missedMaterialClaims: [{ location: "whyWritten", text: "Reader intent is not an external-evidence claim." }] }).success, false);
  assert.equal(request.schema.safeParse({ ...rawCheck, surfaceChecks: { ...rawCheck.surfaceChecks,
    surfaces: { ...rawCheck.surfaceChecks.surfaces, whyWritten: { verdict: "supported", passageIds: ["p1"], reason: "Invented intent evidence." } } } }).success, false);
  const rawRepair = writerProviderFixture(value);
  rawRepair.article!.whyWritten = "Explain the conditions recorded in this constructed test.";
  const repaired = await repairOnDemandArticle({ ...selection(), draft: value, check: checked.output }, options(rawRepair, requests));
  assert.equal(repaired.output.article!.whyWritten, rawRepair.article!.whyWritten);
  assert.notEqual(onDemandArticleSurfaceManifest(repaired.output).fingerprint, failed.surfaceChecks!.fingerprint);
  assert.equal(Object.hasOwn(repaired, "accepted"), false);
  const rechecked = await checkOnDemandArticle({ ...selection(), draft: repaired.output }, options(check(repaired.output), requests));
  assert.equal(rechecked.accepted, true);
  assert.equal(rechecked.output.surfaceChecks!.surfaces.some((surface) => surface.location === "whyWritten"), false);
  assert.deepEqual(requests.map((entry) => entry.stage), ["check", "repair", "check"]);
});
