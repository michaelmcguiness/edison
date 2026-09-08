import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReaderFirstIdeas, generateReaderFirstIdeas, ProviderResponseValidationError,
  READER_FIRST_PROMPTS, READER_FIRST_PROMPT_VERSION, readerFirstWriterProviderSchema,
  type OnDemandContext, type OnDemandProvider, type OnDemandProviderRequest, type OnDemandProviderResponse,
  type ReaderFirstCheckOutput, type ReaderFirstWriterOutput,
} from "../packages/ai/src/index";
import { initialDemandState } from "../apps/api/src/services/demand-runner";
import { advanceReaderFirstPipeline, type ReaderFirstPipelineState } from "../apps/api/src/services/reader-first-pipeline";
import type { DemandRequestRow } from "../apps/api/src/services/demand-reading";

// Realistic authored specimens and injected judgments, not provider-quality
// measurements. The unfinished preview is deliberately authored at exactly 500
// characters; neither this harness nor the production path clips it to fit.
const incomplete = "A thermostat does not know whether a room feels comfortable: it compares a temperature reading with a target and changes the heater output when the two differ. Follow an everyday example to see how that feedback can hold a room near the target, why little overshoot can still happen, and why the number on the dial is not a promise that every corner of the room will have the same temperature. The useful distinction is between measuring one place and controlling a whole space, which matters because";
const complete = "A thermostat compares a temperature reading with your target and adjusts the heat. A worked example explains that feedback, including why one sensor cannot guarantee the same temperature in every corner.";
const repairedIncomplete = "A thermostat compares the measured temperature with a target and adjusts the heat, but a single reading cannot establish whether";
const body = "A thermostat measures temperature at its sensor and compares that reading with a target. In a simple heating example, a reading below the target triggers heat. The measurement is local: furniture, airflow and distance from the heater can leave other parts of the room at different temperatures.";
const context: OnDemandContext = { loopId: "00000000-0000-4000-8000-000000000951", revision: 0,
  originalCuriosity: "How does a thermostat control room temperature?", directions: [], declaredKnowledge: [],
  readingPreferences: ["A concise everyday example, with its limits"], preferences: { length: "brief", depth: 50 },
  previousArticles: [], currentDate: "2026-09-07" };
const candidate = { key: "thermostat", headline: "How does a thermostat know when to stop?", deck: complete,
  readerQuestion: context.originalCuriosity, payoff: "Understand measurement, comparison and feedback, with the limits of a single sensor.",
  advanceBeyondPrevious: "A first worked example.", qualifications: ["A local sensor does not guarantee uniform room temperature."], passageIds: [] };
const empty = { sources: [], passages: [] };
const options = { model: "injected-model", idempotencyKey: "constructed-preview", safetyIdentifier: "constructed-reader" };
function envelope(output: unknown, call: OnDemandProviderRequest, index = 0): OnDemandProviderResponse {
  return { output, usage: { providerResponseId: `constructed-preview-${index}`, model: call.model,
    inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, webSearchCalls: 0, webSearchToolCalls: 0, webSearchPricingStatus: "priced" } };
}

test("v2.5 retains complete previews below the unchanged hard bound only where a deck is authored", () => {
  assert.equal(READER_FIRST_PROMPT_VERSION, "edison-reader-first-v2.5");
  for (const stage of ["ideas", "write", "repair"] as const) {
    assert.match(READER_FIRST_PROMPTS[stage], /one or two short complete sentences/);
    assert.match(READER_FIRST_PROMPTS[stage], /120–300 characters/);
    assert.match(READER_FIRST_PROMPTS[stage], /unchanged 500-character maximum/);
    assert.match(READER_FIRST_PROMPTS[stage], /core question or payoff and any essential qualification/);
    assert.match(READER_FIRST_PROMPTS[stage], /Move elaboration to the other brief fields or article body/);
    assert.match(READER_FIRST_PROMPTS[stage], /rewrite the whole preview; never chop a sentence or word or remove a necessary qualifier/);
  }
  for (const stage of ["answer", "answer_repair"] as const) {
    assert.doesNotMatch(READER_FIRST_PROMPTS[stage], /120–300|500-character|rewrite the whole preview/);
  }
  assert.match(READER_FIRST_PROMPTS.ideas_check, /cut-off or unreadable deck fails fitsLoop/);
  assert.match(READER_FIRST_PROMPTS.repair, /No second repair is available/);
  assert.match(READER_FIRST_PROMPTS.check, /verificationPassed=false/);
});

async function ideas(deck: string, accepted: boolean) {
  const raw = { ...empty, ideas: [{ ...candidate, deck }], insufficiencyReason: null };
  const original = structuredClone(raw);
  const calls: OnDemandProviderRequest[] = [];
  const provider: OnDemandProvider = async (call) => {
    calls.push(call);
    if (call.stage === "ideas") return envelope(raw, call);
    assert.equal(call.stage, "ideas_check");
    const input = call.input as { fingerprint: string; research: typeof raw };
    assert.equal(input.research.ideas[0].deck, deck, "Independent QA receives the exact preview, not a shortened version");
    return envelope({ fingerprint: input.fingerprint, ideas: [{ key: candidate.key,
      verdict: accepted ? "pass" : "insufficient_evidence", premiseSupported: true, verificationRequired: false,
      verificationPassed: true, fitsLoop: accepted, distinctContribution: true, passageIds: [],
      reason: accepted ? "Injected: the complete preview gives the mechanism and its essential local-sensor qualification."
        : "Injected: the preview stops mid-thought and does not supply a complete, readable promise." }] }, call, 1);
  };
  const generated = await generateReaderFirstIdeas(context, { ...options, provider });
  const checked = await checkReaderFirstIdeas({ context, research: generated.output, evidence: empty, batchId: "constructed-preview-batch" }, { ...options, provider });
  assert.deepEqual(raw, original);
  return { generated, checked, calls };
}

test("a realistic incomplete 500-character idea preview reaches QA unchanged and is withheld", async () => {
  assert.equal(incomplete.length, 500);
  const result = await ideas(incomplete, false);
  assert.equal(result.generated.output.ideas[0].deck, incomplete);
  assert.deepEqual(result.checked.ideas, []);
  assert.deepEqual(result.calls.map((call) => call.stage), ["ideas", "ideas_check"]);
});

test("a 501-character provider preview is rejected without clipping or proceeding to idea QA", async () => {
  const raw = { ...empty, ideas: [{ ...candidate, deck: `${incomplete}.` }], insufficiencyReason: null };
  const before = structuredClone(raw); const calls: string[] = [];
  await assert.rejects(generateReaderFirstIdeas(context, { ...options, provider: async (call) => {
    calls.push(call.stage); return envelope(raw, call);
  } }), ProviderResponseValidationError);
  assert.deepEqual(calls, ["ideas"]);
  assert.deepEqual(raw, before);
  assert.equal(raw.ideas[0].deck.length, 501);
  const writer = rawArticle(`${incomplete}.`);
  assert.equal(readerFirstWriterProviderSchema.safeParse(writer).success, false);
  assert.equal(writer.article.deck.length, 501);
});

function rawArticle(deck: string) {
  return { status: "written", reason: null, research: empty, article: { category: "tech-science", kicker: "Feedback",
    topic: "Thermostats", title: candidate.headline, deck,
    summary: ["Measure temperature at the sensor.", "Compare that reading with a target.", "A local reading cannot guarantee uniform temperature."],
    whyWritten: "An everyday example makes the feedback mechanism and its limits concrete.", readingMinutes: 1,
    body: [{ type: "paragraph", text: body, citations: [] }], sourceKeys: [] } };
}
async function article(initialDeck: string, repairDeck?: string) {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const request: DemandRequestRow = { id: "00000000-0000-4000-8000-000000000952", principalId: "00000000-0000-4000-8000-000000000953",
    loopId: context.loopId, ideaId: "00000000-0000-4000-8000-000000000954", kind: "article", status: "running", stage: "writing",
    idempotencyKey: "constructed-preview-article", requestFingerprint: "a".repeat(64),
    snapshot: { version: 2, context, selection: { idea: { ...candidate, id: "00000000-0000-4000-8000-000000000954", loopId: context.loopId, loopRevision: 0 }, evidence: empty } },
    result: null, progress: null, failureCode: null, workflowRunId: "constructed-run", attempts: 1, reservedMicrousd: 1200000,
    leaseExpiresAt: new Date(now.getTime() + 300000), nextAttemptAt: now, createdAt: now, updatedAt: now };
  const calls: OnDemandProviderRequest[] = []; const raw: unknown[] = []; const before: string[] = [];
  const provider: OnDemandProvider = async (call) => {
    assert.ok(calls.length < (repairDeck ? 4 : 2), "No extra provider stage is allowed");
    calls.push(call);
    let output: unknown;
    if (call.stage === "write" || call.stage === "repair") output = rawArticle(call.stage === "write" ? initialDeck : repairDeck!);
    else {
      const input = call.input as { fingerprint: string; draft: ReaderFirstWriterOutput };
      const expectedDeck = calls.length === 2 ? initialDeck : repairDeck;
      assert.equal(input.draft.article!.deck, expectedDeck);
      const check: ReaderFirstCheckOutput = { fingerprint: input.fingerprint, verdict: repairDeck ? "repair" : "pass",
        accuracyPassed: true, verificationPassed: true, promiseFulfilled: true, readerFit: !repairDeck, continuity: true, privacyPassed: true,
        findings: repairDeck ? [{ location: "deck", excerpt: expectedDeck!, kind: "clarity", severity: "material",
          reason: "Injected: the exact preview is unfinished even though the body explains the mechanism.",
          repair: "Rewrite the entire preview as complete sentences while retaining the local-sensor qualification.", passageIds: [] }] : [] };
      output = check;
    }
    raw.push(output); before.push(JSON.stringify(output)); return envelope(output, call, calls.length);
  };
  const retrievePage = async (): Promise<never> => { throw new Error("No network retrieval is permitted in this constructed test"); };
  let state = initialDemandState(request) as ReaderFirstPipelineState;
  for (let step = 0; step < 4; step++) {
    const result = await advanceReaderFirstPipeline({ request, state }, { provider, retrievePage });
    state = result.state;
    if (result.outcome || result.failureCode) {
      assert.deepEqual(raw.map((output) => JSON.stringify(output)), before);
      assert.deepEqual(await advanceReaderFirstPipeline({ request, state }, { provider, retrievePage }), result);
      return { result, calls };
    }
  }
  throw new Error("The bounded article did not reach a terminal result");
}

test("a short complete qualified preview can pass injected idea and fresh article judgments", async () => {
  assert.ok(complete.length >= 120 && complete.length <= 300);
  const proposed = await ideas(complete, true);
  assert.equal(proposed.checked.ideas[0].deck, complete);
  const written = await article(complete);
  assert.equal(written.result.outcome, "article");
  assert.equal(written.result.state.draft?.article?.deck, complete);
  assert.deepEqual(written.calls.map((call) => call.stage), ["write", "check"]);
});

test("a repaired preview that still ends mid-sentence is withheld after the sole fresh recheck", async () => {
  const written = await article(incomplete, repairedIncomplete);
  assert.equal(written.result.failureCode, "editorial_withheld");
  assert.equal(written.result.outcome, undefined);
  assert.equal(written.result.state.repairAttempted, true);
  assert.equal(written.result.state.draft?.article?.deck, repairedIncomplete);
  assert.equal(written.result.state.check?.findings[0].location, "deck");
  assert.deepEqual(written.calls.map((call) => call.stage), ["write", "check", "repair", "check"]);
});
