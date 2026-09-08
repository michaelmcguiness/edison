import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  READER_FIRST_CHECKER_CONTRACT_VERSION, READER_FIRST_DISCOVERY_CONTRACT_VERSION,
  type OnDemandContext, type OnDemandEvidence, type OnDemandProvider, type OnDemandProviderRequest,
  type OnDemandProviderResponse, type ReaderFirstCheckOutput, type ReaderFirstWriterOutput,
} from "@edison/ai";
import { initialDemandState } from "./demand-runner";
import { advanceReaderFirstPipeline, type ReaderFirstPipelineState } from "./reader-first-pipeline";
import type { DemandRequestRow } from "./demand-reading";
import type { retrieveEvidencePage } from "./evidence-retrieval";

// Constructed URL shape and authored prose only; no private incident packet or
// publisher content is retained. Real stages and passage selection execute,
// but provider transport and the secure fetcher's I/O boundary are injected.
// This does not establish actual network/SSRF behavior or factual model quality.
const prefix = "https://www.nobelprize.org/stories/women-who-changed-science/marie-curie";
const hintUrl = `${prefix}?trk=constructed-hint`;
const observedUrl = `${prefix}?trk=constructed-observed`;
const retrievedAt = "2026-09-08T18:00:00.000Z";
const fetchedTitle = "Constructed independently retrieved measurement example";
const support = "This constructed measurement example compares a sample reading with a reference reading. "
  + "A repeated measurement can distinguish a stable signal from an isolated fluctuation. "
  + "The example explains measurement and uncertainty; it does not establish a claim about Marie Curie's life.";
const lead = "A model-only discovery hint about measurement and uncertainty, absent from the fetched page.";
const loopId = "00000000-0000-4000-8000-000000000801";
const ideaId = "00000000-0000-4000-8000-000000000802";
const empty: OnDemandEvidence = { sources: [], passages: [] };
const context: OnDemandContext = { loopId, revision: 1,
  originalCuriosity: "How do repeated measurements distinguish a signal?", directions: [], declaredKnowledge: [],
  readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-08" };
const idea = { id: ideaId, key: "measurement", loopId, loopRevision: 1,
  headline: "How can repeated measurements reveal a signal?", deck: "Compare a sample with a reference.",
  readerQuestion: context.originalCuriosity, payoff: "Distinguish a repeatable signal from a fluctuation.",
  advanceBeyondPrevious: "A first constructed measurement explanation.", qualifications: [], passageIds: [] };

function rawArticle(sourced: boolean) {
  return { status: "written", reason: null,
    research: sourced ? {
      sources: [{ id: "nobel", url: hintUrl, title: "Model discovery title", publisher: "Model discovery publisher",
        publishedDate: null, datePrecision: "unknown" }],
      passages: [{ id: "model-lead", sourceId: "nobel", text: lead, locator: "Model discovery hint" }],
    } : structuredClone(empty),
    article: { category: "tech-science", kicker: "Measurement", topic: "Signals", title: idea.headline, deck: idea.deck,
      summary: ["Measure a sample.", "Compare a reference.", "Repeat the comparison."],
      whyWritten: "A constructed example explains the reader's measurement question.", readingMinutes: 1,
      body: [{ type: "paragraph", text: support, citations: sourced ? [{ sourceKey: "nobel" }] : [] }],
      sourceKeys: sourced ? ["nobel"] : [] } };
}
function request(discovery: boolean): DemandRequestRow {
  const now = new Date(retrievedAt);
  return { id: "00000000-0000-4000-8000-000000000803", principalId: "00000000-0000-4000-8000-000000000804",
    loopId, ideaId, kind: "article", status: "running", stage: "writing", idempotencyKey: "constructed-source-rebinding",
    requestFingerprint: "a".repeat(64), snapshot: { version: 2, context: structuredClone(context),
      selection: { idea: structuredClone(idea), evidence: structuredClone(empty) },
      checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION,
      ...(discovery ? { discoveryContractVersion: READER_FIRST_DISCOVERY_CONTRACT_VERSION } : {}) },
    result: null, progress: null, failureCode: null, workflowRunId: "constructed-discovery-run",
    leaseExpiresAt: new Date(now.getTime() + 300_000), nextAttemptAt: now, attempts: 1,
    reservedMicrousd: 1_200_000, createdAt: now, updatedAt: now };
}
function check(call: OnDemandProviderRequest, failed: boolean): ReaderFirstCheckOutput {
  return { fingerprint: (call.input as { fingerprint: string }).fingerprint, verdict: failed ? "repair" : "pass",
    accuracyPassed: true, verificationPassed: !failed, promiseFulfilled: true,
    readerFit: true, continuity: true, privacyPassed: true,
    findings: failed ? [{ location: "body.0", excerpt: support, severity: "material", kind: "verification_required",
      reason: "This constructed check requires independently fetched support.",
      repair: "Retrieve the exact source and preserve the scope of the measurement example.", passageIds: [] }] : [] };
}
function expectedEvidence(): OnDemandEvidence {
  const id = `p-${createHash("sha256").update(`nobel:${observedUrl}:0:${support.length}:${support}`).digest("hex").slice(0, 28)}`;
  return { sources: [{ id: "nobel", url: observedUrl, title: fetchedTitle, publisher: "www.nobelprize.org",
    publishedDate: null, datePrecision: "unknown" }], passages: [{ id, sourceId: "nobel", text: support,
    locator: `Retrieved normalized page text, characters 1–${support.length}`, provenance: "retrieved", retrievedAt }] };
}

async function run(options: { discovery: boolean; needsRepair?: boolean; retrievalFails?: boolean }) {
  const row = request(options.discovery), snapshotBefore = structuredClone(row.snapshot);
  const calls: OnDemandProviderRequest[] = [], fetched: string[] = [], events: string[] = [];
  const rawResponses: OnDemandProviderResponse[] = [], rawBefore: string[] = [];
  const writer = rawArticle(!options.needsRepair), repair = rawArticle(true);
  const provider: OnDemandProvider = async (call) => {
    calls.push(call); events.push(`provider:${call.stage}`);
    const firstCheck = calls.filter((entry) => entry.stage === "check").length === 1;
    assert.ok(["write", "repair", "check"].includes(call.stage), "no extra provider stage is introduced");
    const response: OnDemandProviderResponse = {
      output: call.stage === "write" ? writer : call.stage === "repair" ? repair
        : { check: check(call, Boolean(options.needsRepair && firstCheck)) },
      usage: { providerResponseId: `constructed-rebinding-${calls.length}`, model: call.model,
        inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, webSearchCalls: call.stage === "check" ? 0 : 1,
        webSearchToolCalls: call.stage === "check" ? 0 : 1, webSearchPricingStatus: "priced" },
      researchProvenance: { consultedUrls: [observedUrl], openedUrls: [observedUrl], citedUrls: [observedUrl] },
    };
    rawResponses.push(response); rawBefore.push(JSON.stringify(response));
    return response;
  };
  const retrievePage: typeof retrieveEvidencePage = async (url) => {
    fetched.push(url); events.push(`retrieve:${url}`);
    if (options.retrievalFails) throw new Error("Constructed failed secure acquisition");
    return { url, title: fetchedTitle, text: support, retrievedAt };
  };
  let state = initialDemandState(row) as ReaderFirstPipelineState;
  const phases: string[] = [], checkpoints: ReaderFirstPipelineState[] = [];
  for (let step = 0; step < 10; step++) {
    // Exercise durable JSON checkpoint reconstruction, not live object aliases.
    state = JSON.parse(JSON.stringify(state)) as ReaderFirstPipelineState;
    assert.equal(Object.hasOwn(state, "discoveryContractVersion"), options.discovery);
    assert.equal(state.discoveryContractVersion, options.discovery ? READER_FIRST_DISCOVERY_CONTRACT_VERSION : undefined);
    assert.equal(state.checkerContractVersion, READER_FIRST_CHECKER_CONTRACT_VERSION);
    phases.push(state.phase);
    const before = structuredClone(state);
    const result = await advanceReaderFirstPipeline({ request: row, state }, { provider, retrievePage });
    assert.deepEqual(state, before, "advancing never rewrites the supplied saved checkpoint");
    assert.deepEqual(row.snapshot, snapshotBefore, "the admitted request remains frozen");
    assert.deepEqual(rawResponses.map((response) => JSON.stringify(response)), rawBefore,
      "the original provider output, usage and provenance remain byte-identical");
    state = result.state; checkpoints.push(state);
    if (result.outcome || result.failureCode) return { ...result, row, calls, fetched, events, phases, checkpoints, writer, repair };
  }
  throw new Error("Constructed source-rebinding pipeline exceeded the existing bounded sequence");
}

function assertCheckedEvidence(call: OnDemandProviderRequest) {
  assert.equal(call.stage, "check");
  assert.equal(call.promptVersion, READER_FIRST_CHECKER_CONTRACT_VERSION);
  assert.equal(call.researchPolicy?.mode, "none");
  assert.equal(call.researchPolicy?.maxCalls, 0);
  const input = call.input as { evidence: OnDemandEvidence; draft: ReaderFirstWriterOutput };
  assert.deepEqual(input.evidence, expectedEvidence(), "checker receives exact independently fetched passage identity and metadata");
  assert.equal(input.evidence.passages.some((passage) => passage.id === "model-lead" || passage.text === lead), false);
  assert.equal(input.draft.article?.sources[0].url, observedUrl);
  assert.equal(input.draft.article?.sources[0].title, fetchedTitle);
  assert.deepEqual(input.draft.article?.body[0], { type: "paragraph", text: support,
    citations: [{ sourceKey: "nobel", label: "nobelprize.org" }] });
}

test("prospective writer discovery rebinds a clone to the exact observed Nobel URL before acquisition and the existing D50 check", async () => {
  const result = await run({ discovery: true });
  assert.equal(result.failureCode, undefined); assert.equal(result.outcome, "article");
  assert.deepEqual(result.phases, ["write", "retrieve", "check"]);
  assert.deepEqual(result.events, ["provider:write", `retrieve:${observedUrl}`, "provider:check"]);
  assert.deepEqual(result.fetched, [observedUrl]);
  const acquiring = result.checkpoints[0];
  assert.equal(acquiring.phase, "retrieve");
  assert.equal(acquiring.acquisition?.research.sources[0].url, observedUrl);
  assert.equal(acquiring.draft?.research.sources[0].url, observedUrl);
  assert.notEqual(acquiring.draft?.research, result.writer.research);
  assert.equal(result.writer.research.sources[0].url, hintUrl, "raw response retains the original model URL");
  assert.equal(result.writer.research.passages[0].text, lead);
  assert.deepEqual(result.checkpoints[1].evidence, expectedEvidence());
  assertCheckedEvidence(result.calls[1]);
  assert.deepEqual(result.state.evidence, expectedEvidence());
  assert.equal(result.state.repairAttempted, false);
});

test("legacy absence still rejects the same source mismatch before retrieval or checking", async () => {
  const result = await run({ discovery: false });
  assert.equal(result.failureCode, "provider_invalid"); assert.equal(result.outcome, undefined);
  assert.deepEqual(result.phases, ["write"]); assert.deepEqual(result.events, ["provider:write"]);
  assert.deepEqual(result.fetched, []); assert.equal(result.state.acquisition, undefined);
  assert.equal(result.state.check, undefined);
  assert.equal(result.writer.research.sources[0].url, hintUrl);
});

test("the sole researched article repair uses the same rebinding gate before fresh retrieval and exact recheck", async () => {
  const result = await run({ discovery: true, needsRepair: true });
  assert.equal(result.failureCode, undefined); assert.equal(result.outcome, "article");
  assert.deepEqual(result.phases, ["write", "check", "repair", "retrieve", "recheck"]);
  assert.deepEqual(result.events, ["provider:write", "provider:check", "provider:repair", `retrieve:${observedUrl}`, "provider:check"]);
  assert.deepEqual(result.fetched, [observedUrl]);
  assert.equal(result.calls[2].researchPolicy?.mode, "required");
  assert.equal(result.calls[2].researchPolicy?.maxCalls, 8);
  assert.equal(result.repair.research.sources[0].url, hintUrl);
  assert.equal(result.checkpoints[2].acquisition?.research.sources[0].url, observedUrl);
  assertCheckedEvidence(result.calls[3]);
  assert.equal(result.state.repairAttempted, true);
  let extraCalls = 0;
  const ready = await advanceReaderFirstPipeline({ request: result.row, state: JSON.parse(JSON.stringify(result.state)) }, {
    provider: async () => { extraCalls++; throw new Error("Ready replay cannot dispatch a provider"); },
    retrievePage: async () => { extraCalls++; throw new Error("Ready replay cannot acquire another source"); },
  });
  assert.equal(ready.outcome, "article"); assert.equal(extraCalls, 0);
  assert.deepEqual(ready.state.evidence, expectedEvidence());
});

test("rebinding confers no passage support when independent acquisition fails", async () => {
  const result = await run({ discovery: true, retrievalFails: true });
  assert.equal(result.failureCode, "editorial_withheld"); assert.equal(result.outcome, undefined);
  assert.deepEqual(result.calls.map((call) => call.stage), ["write", "repair"]);
  assert.deepEqual(result.fetched, [observedUrl, observedUrl], "only the existing sole repair may try fresh acquisition");
  assert.deepEqual(result.state.evidence, empty);
  assert.equal(result.state.check, undefined, "model-only discovery cannot enter the independent exact-evidence check");
  assert.equal(result.state.repairAttempted, true);
  assert.equal(result.writer.research.sources[0].url, hintUrl);
  assert.equal(result.repair.research.sources[0].url, hintUrl);
});
