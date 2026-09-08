import assert from "node:assert/strict";
import test from "node:test";
import {
  type OnDemandEvidence, type OnDemandProvider, type OnDemandProviderRequest, type OnDemandProviderResponse,
  type ReaderFirstCheckOutput, type ReaderFirstWriterOutput,
} from "../packages/ai/src/index";
import { demandFingerprint, type DemandRequestRow } from "../apps/api/src/services/demand-reading";
import { initialDemandState } from "../apps/api/src/services/demand-runner";
import { advanceReaderFirstPipeline, readerFirstSelection, type ReaderFirstPipelineState } from "../apps/api/src/services/reader-first-pipeline";
import { publishReaderFirstArticle } from "../apps/api/src/services/reader-first-publication";
import { readerFirstRepairContrasts, sensorExplanation } from "./fixtures/reader-first-repair-calibration";

// No actual model evaluation, retrieval, usage accounting, or database work.
// The corpus's authored verdicts are injected into the real bounded pipeline;
// passing tests establish that these judgments are enforced, not produced.
type CaseName = keyof typeof readerFirstRepairContrasts;
const loopId = "00000000-0000-4000-8000-000000000901";
const ideaId = "00000000-0000-4000-8000-000000000902";
const empty: OnDemandEvidence = { sources: [], passages: [] };
const citationEvidence: OnDemandEvidence = {
  sources: [
    { id: "packaging", title: "Constructed packaging record", publisher: "example.org", url: "https://example.org/packaging", publishedDate: null, datePrecision: "unknown" },
    { id: "comparison", title: "Constructed comparison explanation", publisher: "example.org", url: "https://example.org/comparison", publishedDate: null, datePrecision: "unknown" },
  ],
  passages: [
    { id: "packaging-p1", sourceId: "packaging", text: "The demonstration sensor is packed in a cardboard box. The packaging record reports no sensor comparison, calibration result, or performance assessment.", locator: "Constructed packaging paragraph", provenance: "retrieved", retrievedAt: "2026-09-07T00:00:00.000Z" },
    { id: "comparison-p1", sourceId: "comparison", text: sensorExplanation, locator: "Constructed comparison paragraph", provenance: "retrieved", retrievedAt: "2026-09-07T00:00:00.000Z" },
  ],
};
function request(cited: boolean): DemandRequestRow {
  const now = new Date("2026-09-07T00:00:00.000Z");
  const context = { loopId, revision: 1, originalCuriosity: "What does checking a sensor actually tell you?",
    directions: [], declaredKnowledge: [], readingPreferences: ["Use a concise, concrete comparison and explain its limits"],
    preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-07" };
  const idea = { id: ideaId, loopId, loopRevision: 1, key: "sensor-comparison", headline: context.originalCuriosity,
    deck: "Understand the comparison, the useful result, and what one check cannot establish.",
    readerQuestion: context.originalCuriosity, payoff: "Explain how comparison reveals disagreement and what that does and does not establish.",
    advanceBeyondPrevious: "A first concrete measurement example.", qualifications: [], passageIds: [] };
  return { id: "00000000-0000-4000-8000-000000000903", principalId: "00000000-0000-4000-8000-000000000904",
    kind: "article", loopId, ideaId, idempotencyKey: "constructed-repair-calibration", requestFingerprint: "a".repeat(64),
    snapshot: { version: 2, context, selection: { idea, evidence: structuredClone(cited ? citationEvidence : empty) } },
    progress: null, result: null, status: "running", stage: "writing", failureCode: null, workflowRunId: "constructed-run",
    attempts: 1, reservedMicrousd: 1_200_000, leaseExpiresAt: new Date(now.getTime() + 300000), nextAttemptAt: now, createdAt: now, updatedAt: now };
}
function authoredArticle(row: DemandRequestRow, text: string, sourceKey?: string) {
  const selection = readerFirstSelection(row);
  return { status: "written", reason: null, research: { sources: [], passages: [] }, article: {
    category: "tech-science", kicker: "Making sense of a measurement", topic: "Sensors", title: selection.idea.headline, deck: selection.idea.deck,
    summary: ["Compare a reading with a reference.", "Interpret agreement or disagreement under the conditions checked.", "Keep the limits of one comparison visible."],
    whyWritten: "A concrete comparison explains what a sensor check can and cannot establish.", readingMinutes: 1,
    body: [{ type: "heading", level: 2, text: "Reading the result" },
      { type: "paragraph", text, citations: sourceKey ? [{ sourceKey }] : [] }], sourceKeys: sourceKey ? [sourceKey] : [] } };
}
function checkOutput(call: OnDemandProviderRequest, name: CaseName, final: boolean): ReaderFirstCheckOutput {
  const specimen = readerFirstRepairContrasts[name];
  const input = call.input as { fingerprint: string; draft: ReaderFirstWriterOutput; evidence: OnDemandEvidence };
  const text = input.draft.article!.body[1].text;
  const cited = name === "wrongDisplayedSource" || name === "repairedDisplayedSource";
  const expected = final ? specimen.expected : "withhold";
  const kind = final ? specimen.kind : cited ? "citation" : name === "unsupportedCurrentUse" ? "verification_required" : "contradicted";
  return { fingerprint: input.fingerprint, verdict: expected === "accept" ? "pass" : "repair",
    accuracyPassed: final ? specimen.accuracyPassed : cited || name === "unsupportedCurrentUse",
    verificationPassed: final ? specimen.verificationPassed : name !== "unsupportedCurrentUse",
    promiseFulfilled: final ? specimen.promiseFulfilled : true,
    readerFit: true, continuity: true, privacyPassed: true,
    findings: kind ? [{ location: "body.1", excerpt: text, severity: "material", kind,
      reason: final ? specimen.reason : cited ? "The displayed source discusses packaging, not the comparison; the retained comparison source supports it."
        : name === "unsupportedCurrentUse" ? "No applicable current approval record supports this assertion."
          : "One comparison under particular conditions does not prove accuracy in every setting.",
      repair: final ? specimen.remedy! : cited ? "Use the retained comparison source without deleting the explanation."
        : "Correct the unsupported scope while preserving how the comparison works and what its result establishes.",
      passageIds: cited ? ["comparison-p1"] : [] }] : [] };
}

async function runCase(name: CaseName) {
  const specimen = readerFirstRepairContrasts[name];
  const cited = name === "wrongDisplayedSource" || name === "repairedDisplayedSource";
  const row = request(cited);
  const originalRequest = structuredClone(row);
  const calls: OnDemandProviderRequest[] = [];
  const responses: OnDemandProviderResponse[] = [];
  const frozenResponses: string[] = [];
  const checkpoints: ReaderFirstPipelineState[] = [];
  const checkpointCopies: ReaderFirstPipelineState[] = [];
  const provider: OnDemandProvider = async (call) => {
    assert.ok(calls.length < 4, "No fifth provider stage is permitted");
    const index = calls.length;
    assert.equal(call.stage, ["write", "check", "repair", "check"][index]);
    calls.push(call);
    const output = call.stage === "write" ? authoredArticle(row, specimen.original, cited ? "packaging" : undefined)
      : call.stage === "repair" ? authoredArticle(row, specimen.repaired, name === "repairedDisplayedSource" ? "comparison" : cited ? "packaging" : undefined)
        : checkOutput(call, name, index === 3);
    // A modeled unsuccessful research episode supplies no usable new source.
    // This is injected routing metadata, not a real search or accounting test.
    const searched = name === "unsupportedCurrentUse" && call.stage === "repair";
    const response: OnDemandProviderResponse = { output, usage: { providerResponseId: `constructed-response-${index}`, model: call.model,
      inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, webSearchCalls: searched ? 1 : 0,
      webSearchToolCalls: searched ? 1 : 0, webSearchPricingStatus: "priced" },
      researchProvenance: { consultedUrls: [], openedUrls: [], citedUrls: [] } };
    responses.push(response); frozenResponses.push(JSON.stringify(response));
    return response;
  };
  const retrievePage = async (): Promise<never> => { throw new Error("Constructed retained packet must not trigger network retrieval"); };
  let state = initialDemandState(row) as ReaderFirstPipelineState;
  let terminal: Awaited<ReturnType<typeof advanceReaderFirstPipeline>> | undefined;
  for (let step = 0; step < 4; step++) {
    checkpoints.push(state); checkpointCopies.push(structuredClone(state));
    const result = await advanceReaderFirstPipeline({ request: row, state }, { provider, retrievePage });
    state = result.state;
    if (result.outcome || result.failureCode) { terminal = result; break; }
  }
  assert.ok(terminal, "The original plus sole repair must reach a terminal result within four stages");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.idempotencyKey), ["write", "check", "repair", "recheck"].map((phase) => `${row.id}:${phase}`));
  assert.equal(state.repairAttempted, true);
  assert.deepEqual(checkpoints, checkpointCopies, "Original draft/check checkpoints are not rewritten");
  assert.deepEqual(responses.map((response) => JSON.stringify(response)), frozenResponses, "Raw provider envelopes remain unchanged");
  assert.deepEqual(row, originalRequest, "Request identity, assignment, reservation and history remain unchanged");
  const repeated = await advanceReaderFirstPipeline({ request: row, state }, { provider, retrievePage });
  assert.deepEqual(repeated, terminal, "Exact terminal replay cannot recommission another stage");
  assert.equal(calls.length, 4);
  const firstInput = calls[1].input as { draft: ReaderFirstWriterOutput; fingerprint: string };
  const finalInput = calls[3].input as { draft: ReaderFirstWriterOutput; fingerprint: string };
  assert.equal(firstInput.draft.article!.body[1].text, specimen.original);
  assert.equal(finalInput.draft.article!.body[1].text, specimen.repaired);
  assert.deepEqual((calls[2].input as { check: unknown }).check, responses[1].output, "Repair receives every original finding unchanged");
  return { row, terminal, calls, responses, firstInput, finalInput };
}

for (const name of ["missingHow", "missingResultMeaning"] as const) {
  test(`${name}: factual and verification passes cannot publish an explanation whose payoff is still missing`, async () => {
    const result = await runCase(name);
    assert.equal(result.terminal.failureCode, "editorial_withheld");
    assert.equal(result.terminal.outcome, undefined);
    assert.equal(result.terminal.state.check?.accuracyPassed, true);
    assert.equal(result.terminal.state.check?.verificationPassed, true);
    assert.equal(result.terminal.state.check?.promiseFulfilled, false);
    assert.equal(result.terminal.state.check?.findings[0].kind, "payoff");
    assert.throws(() => publishReaderFirstArticle({ requestId: result.row.id, selection: readerFirstSelection(result.row),
      draft: result.terminal.state.draft!, check: result.terminal.state.check! }), /editorial_withheld/);
  });
}

test("a scoped correction can preserve the causal explanation and pass only the fresh full-artifact check", async () => {
  const result = await runCase("scopedExplanation");
  assert.equal(result.terminal.outcome, "article");
  assert.notEqual(result.firstInput.fingerprint, result.finalInput.fingerprint);
  assert.throws(() => publishReaderFirstArticle({ requestId: result.row.id, selection: readerFirstSelection(result.row),
    draft: result.terminal.state.draft!, check: { ...(result.responses[1].output as ReaderFirstCheckOutput), verdict: "pass", accuracyPassed: true, findings: [] } }), /editorial_withheld/);
  const article = publishReaderFirstArticle({ requestId: result.row.id, selection: readerFirstSelection(result.row),
    draft: result.terminal.state.draft!, check: result.terminal.state.check! });
  assert.equal(article.body[1].text, sensorExplanation);
  assert.equal(article.basis, "general_knowledge");
  assert.equal(article.researchedAt, null);
  assert.deepEqual(article.sources, []);
});

test("preserving a stable mechanism does not exempt an unsupported current high-stakes claim", async () => {
  const result = await runCase("unsupportedCurrentUse");
  assert.equal(result.calls[2].researchPolicy?.mode, "required");
  assert.equal(result.terminal.failureCode, "editorial_withheld");
  assert.equal(result.terminal.state.check?.promiseFulfilled, true);
  assert.equal(result.terminal.state.check?.verificationPassed, false);
  assert.equal(result.terminal.state.check?.findings[0].kind, "verification_required");
});

test("useful explanation and another supporting source cannot excuse the wrong displayed citation", async () => {
  const result = await runCase("wrongDisplayedSource");
  assert.equal(result.terminal.failureCode, "editorial_withheld");
  assert.equal(result.terminal.state.check?.verificationPassed, true);
  assert.equal(result.terminal.state.check?.findings[0].kind, "citation");
  const final = result.calls[3].input as { evidence: OnDemandEvidence; draft: ReaderFirstWriterOutput };
  assert.equal(final.evidence.passages.find((passage) => passage.id === "comparison-p1")?.text, sensorExplanation);
  assert.equal(final.draft.article!.sources[0].key, "packaging");
});

test("correcting the citation can retain the exact explanation while the old citation audit remains unusable", async () => {
  const result = await runCase("repairedDisplayedSource");
  assert.equal(result.terminal.outcome, "article");
  assert.equal(result.firstInput.draft.article!.body[1].text, result.finalInput.draft.article!.body[1].text);
  assert.notEqual(result.firstInput.fingerprint, result.finalInput.fingerprint);
  assert.notEqual(demandFingerprint(result.firstInput.draft), demandFingerprint(result.finalInput.draft));
  assert.throws(() => publishReaderFirstArticle({ requestId: result.row.id, selection: readerFirstSelection(result.row),
    draft: result.terminal.state.draft!, check: { ...(result.responses[1].output as ReaderFirstCheckOutput), verdict: "pass", findings: [] } }), /editorial_withheld/);
  const article = publishReaderFirstArticle({ requestId: result.row.id, selection: readerFirstSelection(result.row),
    draft: result.terminal.state.draft!, check: result.terminal.state.check! });
  assert.equal(article.sources[0].url, "https://example.org/comparison");
  assert.equal(article.body[1].text, sensorExplanation);
});
