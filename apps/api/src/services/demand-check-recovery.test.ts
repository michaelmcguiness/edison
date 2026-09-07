import assert from "node:assert/strict";
import test from "node:test";
import { READER_FIRST_PROMPT_VERSION, type OnDemandProvider, type OnDemandProviderRequest,
  type OnDemandProviderResponse, type ReaderFirstCheckOutput } from "@edison/ai";
import { demandFingerprint, type DemandRequestRow } from "./demand-reading";
import { advanceReaderFirstPipeline, type ReaderFirstPipelineState } from "./reader-first-pipeline";
import { bindDemandResearchBudget, demandStagePricing, prepareDemandStage } from "./demand-provider-stages";
import { qualifyDemandCheckRecovery, type DemandCheckRecoveryInput } from "./demand-check-recovery";

const environment = { OPENAI_ARTICLE_MODEL: "gpt-5.6-terra", OPENAI_UTILITY_MODEL: "gpt-5.6-luna", OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
const principalId = "00000000-0000-4000-8000-000000000801";
const loopId = "00000000-0000-4000-8000-000000000802";
const ideaId = "00000000-0000-4000-8000-000000000803";
const requestId = "00000000-0000-4000-8000-000000000804";
const prose = "A thermostat compares the measured room temperature with a target before changing its heating output.";

async function fixture(options: { check?: (check: ReaderFirstCheckOutput) => void; duplicate?: boolean } = {}): Promise<DemandCheckRecoveryInput> {
  const createdAt = new Date("2026-09-07T01:00:00Z");
  const context = { loopId, revision: 1, originalCuriosity: "How do thermostats work?", directions: [], declaredKnowledge: [],
    readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-07" };
  const idea = { id: ideaId, loopId, loopRevision: 1, key: "thermostat", headline: "How does a thermostat know when to stop?",
    deck: "A familiar example of feedback.", readerQuestion: "How does feedback work?", payoff: "Understand sensing and control.",
    advanceBeyondPrevious: "An everyday worked example.", qualifications: [], passageIds: [] };
  const request: DemandRequestRow = { id: requestId, principalId, loopId, ideaId, kind: "article", status: "running", stage: "writing",
    idempotencyKey: "constructed-check-recovery", requestFingerprint: "", snapshot: { version: 2, context, selection: { idea, evidence: { sources: [], passages: [] } } },
    progress: null, result: null, failureCode: null, workflowRunId: "constructed-run", leaseExpiresAt: null,
    attempts: 1, reservedMicrousd: 1200000, nextAttemptAt: createdAt, createdAt, updatedAt: new Date("2026-09-07T01:01:00Z") };
  request.requestFingerprint = demandFingerprint({ intent: "article", ideaId, idempotencyKey: request.idempotencyKey });
  const stages: DemandCheckRecoveryInput["stages"][number][] = [];
  const usage: DemandCheckRecoveryInput["usage"][number][] = [];
  const provider: OnDemandProvider = async (call) => {
    let output: unknown;
    if (call.stage === "write") output = { status: "written", reason: null, research: { sources: [], passages: [] }, article: {
      category: "tech-science", kicker: "Control", topic: "Thermostats", title: idea.headline, deck: idea.deck,
      summary: ["Measure the room.", "Compare the target.", "Adjust the heating."], whyWritten: "A familiar feedback example.", readingMinutes: 1,
      body: [{ type: "heading", level: 2, text: "Sensing and control" }, { type: "paragraph", text: prose, citations: [] },
        ...(options.duplicate ? [{ type: "paragraph", text: prose, citations: [] }] : [])], sourceKeys: [] } };
    else {
      const check: ReaderFirstCheckOutput = { fingerprint: (call.input as { fingerprint: string }).fingerprint, verdict: "repair",
        accuracyPassed: true, verificationPassed: true, promiseFulfilled: false, readerFit: true, privacyPassed: true, continuity: true,
        findings: [{ location: "body.0", excerpt: prose, severity: "material", kind: "payoff",
          reason: "The constructed example needs a clear distinction.", repair: "Explain the comparison more clearly.", passageIds: [] }] };
      options.check?.(check);
      output = check;
    }
    const response: OnDemandProviderResponse = { output, usage: { providerResponseId: `constructed-response-${call.stage}`, model: call.model,
      inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, webSearchCalls: 0, webSearchToolCalls: 0, webSearchPricingStatus: "priced" } };
    const identity = bindDemandResearchBudget(prepareDemandStage(request.id, principalId, call, environment).identity, 0);
    const priced = demandStagePricing(response.usage, 10000);
    const id = `00000000-0000-4000-8000-00000000080${stages.length + 5}`;
    const time = new Date(createdAt.getTime() + (stages.length + 1) * 1000);
    stages.push({ id, requestId, principalId, stageKey: identity.stageKey, requestFingerprint: identity.requestFingerprint,
      snapshot: identity.snapshot, status: "succeeded", providerResponseId: response.usage.providerResponseId, output: { ...response },
      usage: { ...response.usage }, ...priced, leaseExpiresAt: new Date(time.getTime() + 300000), createdAt: time, updatedAt: time });
    usage.push({ id, principalId, requestId, stageId: id, responseId: response.usage.providerResponseId, model: call.model,
      inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, searchCalls: 0, ...priced, createdAt: time });
    return response;
  };
  const state: ReaderFirstPipelineState = { version: 2, snapshotVersion: 2, promptVersion: READER_FIRST_PROMPT_VERSION,
    snapshotFingerprint: demandFingerprint(request.snapshot), phase: "write", requestId, requestFingerprint: request.requestFingerprint,
    kind: "article", models: { article: environment.OPENAI_ARTICLE_MODEL, utility: environment.OPENAI_UTILITY_MODEL } };
  const writing = await advanceReaderFirstPipeline({ request, state }, { provider });
  assert.equal(writing.state.phase, "check");
  await advanceReaderFirstPipeline({ request, state: writing.state }, { provider });
  request.status = "failed"; request.stage = "failed"; request.failureCode = "provider_invalid";
  request.progress = { ...writing.state, phase: "failed", failureCode: "provider_invalid" };
  return { principalId, principalActive: true, request, loop: { id: loopId, principalId },
    idea: { id: ideaId, loopId, principalId, articleRequestId: requestId, brief: idea }, stages, usage,
    now: new Date("2026-09-07T01:02:00Z") };
}

test("exact saved two-stage proof resumes only the existing check and preserves original failure and charges", async () => {
  const input = await fixture();
  const before = structuredClone(input);
  const proof = await qualifyDemandCheckRecovery(input, environment);
  assert.ok(proof);
  assert.equal(proof.checkpoint.phase, "check");
  assert.equal(proof.checkpoint.check, undefined);
  assert.equal(proof.checkpoint.repairAttempted, false);
  assert.deepEqual(proof.checkpoint.draft, input.request.progress!.draft);
  assert.deepEqual(proof.checkpoint.evidence, input.request.progress!.evidence);
  assert.equal(proof.releasedHoldMicrousd, input.request.reservedMicrousd - input.usage.reduce((sum, row) => sum + row.costMicrousd!, 0));
  assert.equal(proof.receipt.originalFailure.updatedAt, input.request.updatedAt.toISOString());
  assert.equal(proof.receipt.originalFailure.progressFingerprint, demandFingerprint(input.request.progress));
  assert.deepEqual(proof.receipt.stages.map((stage) => stage.providerResponseId), input.stages.map((stage) => stage.providerResponseId));
  assert.deepEqual(proof.checkpoint.checkRecoveries, [proof.receipt]);
  assert.deepEqual(input, before);
  const calls: OnDemandProviderRequest[] = [];
  const replay = await advanceReaderFirstPipeline({ request: input.request, state: proof.checkpoint }, { provider: async (call) => {
    calls.push(call); return structuredClone(input.stages[1].output) as unknown as OnDemandProviderResponse;
  } });
  assert.equal(replay.state.phase, "repair");
  assert.equal(replay.outcome, undefined);
  assert.deepEqual(replay.state.checkRecoveries, [proof.receipt]);
  assert.deepEqual(calls.map((call) => call.stage), ["check"]);
  assert.equal(replay.state.check?.findings[0].location, "body.1");
});

test("foreign, inactive, exhausted, repaired, stale and altered selected artifacts never qualify", async () => {
  const mutations: Array<(input: DemandCheckRecoveryInput) => void> = [
    (input) => { input.principalActive = false; },
    (input) => { input.principalId = loopId; },
    (input) => { input.idea.articleRequestId = ideaId; },
    (input) => { input.loop.principalId = loopId; },
    (input) => { input.request.attempts = 3; },
    (input) => { input.request.progress!.repairAttempted = true; },
    (input) => { input.request.progress!.promptVersion = "old-version"; },
    (input) => { input.request.snapshot.context = { changed: true }; },
    (input) => { input.request.requestFingerprint = "a".repeat(64); },
    (input) => { input.request.progress!.draft = {}; },
    (input) => { input.request.result = { article: {} }; },
    (input) => { input.request.leaseExpiresAt = new Date(); },
    (input) => { input.request.progress!.checkRecoveries = [{ reason: "previous" }]; },
    (input) => { input.request.reservedMicrousd = 1; },
  ];
  const original = await fixture();
  for (const [index, mutate] of mutations.entries()) {
    const input = structuredClone(original); mutate(input);
    assert.equal(await qualifyDemandCheckRecovery(input, environment), null, `mutation ${index}`);
  }
  assert.equal(await qualifyDemandCheckRecovery(original, { ...environment, OPENAI_UTILITY_MODEL: "gpt-5.6-terra" }), null);
});

test("extra, incomplete, unpriced, mismatched or fabricated provider and ledger rows reject recovery", async () => {
  const original = await fixture();
  const mutations: Array<(input: DemandCheckRecoveryInput) => void> = [
    (input) => { input.stages = [...input.stages, { ...input.stages[0], id: "extra" }]; },
    (input) => { input.stages[0].status = "uncertain"; },
    (input) => { input.stages[1].status = "reserved"; },
    (input) => { input.stages[1].status = "failed"; },
    (input) => { input.stages[1].pricingStatus = "unpriced"; },
    (input) => { input.usage[1].costMicrousd = 0; },
    (input) => { input.usage[1].responseId = "other-response"; },
    (input) => { input.usage[1].principalId = ideaId; },
    (input) => { input.usage = input.usage.slice(0, 1); },
    (input) => { input.stages[1].requestFingerprint = "0".repeat(64); },
    (input) => { input.stages[1].snapshot.input = {}; },
    (input) => { input.stages[0].snapshot.researchCallsBefore = 1; },
    (input) => { input.stages[1].usage!.outputTokens = 101; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = structuredClone(original); mutate(input);
    assert.equal(await qualifyDemandCheckRecovery(input, environment), null, `mutation ${index}`);
  }
});

test("ambiguity, fabricated excerpts, unknown passage IDs, invalid locations and stale audit remain terminal", async () => {
  const cases: Array<(check: ReaderFirstCheckOutput) => void> = [
    (check) => { check.findings[0].excerpt = "A fabricated statement."; },
    (check) => { check.findings[0].location = "body.99"; },
    (check) => { check.findings[0].passageIds = ["not-retained"]; },
    (check) => { check.fingerprint = "0".repeat(64); },
    (check) => { check.findings[0].location = "body.1"; }, // No binding correction: unrelated failure cannot qualify.
  ];
  for (const check of cases) assert.equal(await qualifyDemandCheckRecovery(await fixture({ check }), environment), null);
  assert.equal(await qualifyDemandCheckRecovery(await fixture({ duplicate: true }), environment), null);
});

test("a saved passing check cannot be used as automatic publication recovery", async () => {
  const input = await fixture({ check: (check) => { check.verdict = "pass"; check.promiseFulfilled = true; check.findings = []; } });
  assert.equal(await qualifyDemandCheckRecovery(input, environment), null);
});

test("only a saved explicit repair verdict qualifies even when material findings contradict pass flags", async () => {
  const input = await fixture({ check: (check) => {
    check.verdict = "pass"; check.promiseFulfilled = true;
    check.findings.push({ ...check.findings[0], reason: "A second independent material finding.", severity: "nonmaterial" });
  } });
  assert.equal(await qualifyDemandCheckRecovery(input, environment), null);
  const repair = await fixture({ check: (check) => {
    check.findings.push({ ...check.findings[0], reason: "A second independent material finding.", severity: "nonmaterial" });
  } });
  assert.ok(await qualifyDemandCheckRecovery(repair, environment));
});
