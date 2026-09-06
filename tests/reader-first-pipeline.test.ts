import assert from "node:assert/strict";
import test from "node:test";
import {
  type OnDemandContext, type OnDemandProvider, type OnDemandProviderRequest,
  type ReaderFirstWriterOutput,
} from "../packages/ai/src/index";
import { initialDemandState } from "../apps/api/src/services/demand-runner";
import { advanceReaderFirstPipeline, type ReaderFirstPipelineState } from "../apps/api/src/services/reader-first-pipeline";
import type { DemandRequestRow } from "../apps/api/src/services/demand-reading";
import type { retrieveEvidencePage } from "../apps/api/src/services/evidence-retrieval";

// Authored fixtures and injected verdicts exercise orchestration, not the
// factual or explanatory quality of a real model response.
const loopId = "00000000-0000-4000-8000-000000000701";
const ideaId = "00000000-0000-4000-8000-000000000702";
const context: OnDemandContext = { loopId, revision: 1, originalCuriosity: "How do thermostats work?",
  directions: [], declaredKnowledge: [], readingPreferences: ["Use an everyday example"],
  preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-07" };
const candidate = { key: "thermostat", headline: "How does a thermostat know when to stop?",
  deck: "An everyday example of feedback.", readerQuestion: "How does feedback control heating?",
  payoff: "Understand the difference between sensing and control.", advanceBeyondPrevious: "A worked feedback example.",
  qualifications: [], passageIds: [] };
const idea = { ...candidate, id: ideaId, loopId, loopRevision: 1 };
const empty = { sources: [], passages: [] };
const source = { id: "s1", url: "https://example.org/control", title: "Untrusted discovery title", publisher: "Untrusted publisher",
  publishedDate: "2026-09-07", datePrecision: "day" as const };
const support = "In this constructed source, a controller compares a measured temperature with a target temperature. Its output changes when the measured temperature crosses a threshold. The example is an illustration of feedback, not a report of clinical or commercial performance.";
const research = { sources: [source], passages: [{ id: "lead1", sourceId: source.id, text: support, locator: "A model discovery lead" }] };
function rawArticle(sourced = false) {
  return { status: "written", reason: null, research: sourced ? research : empty,
    article: { category: "tech-science", kicker: "Control", topic: "Thermostats", title: idea.headline, deck: idea.deck,
      summary: ["Measure the room.", "Compare with the target.", "Adjust the heating."],
      whyWritten: "This explains the feedback question through a familiar example.", readingMinutes: 1,
      body: [{ type: "paragraph", text: support, citations: sourced ? [{ sourceKey: "s1" }] : [] }],
      sourceKeys: sourced ? ["s1"] : [] } };
}
function savedArticle(): ReaderFirstWriterOutput {
  const { article, ...rest } = rawArticle();
  const { sourceKeys, ...prose } = article;
  assert.deepEqual(sourceKeys, []);
  return { ...rest, status: "written", article: { ...prose, category: "tech-science", sources: [],
    body: [{ type: "paragraph", text: support, citations: [] }] } };
}
function rawAnswer(sourced = false) {
  return { status: "answered", reason: null, research: sourced ? research : empty,
    body: [{ type: "paragraph", text: support, citations: sourced ? [{ sourceKey: "s1" }] : [] }], sourceKeys: sourced ? ["s1"] : [] };
}
function row(kind: DemandRequestRow["kind"], extra: Record<string, unknown> = {}): DemandRequestRow {
  const now = new Date("2026-09-07T20:00:00.000Z");
  return { id: "00000000-0000-4000-8000-000000000703", principalId: "00000000-0000-4000-8000-000000000704",
    loopId, ideaId: kind === "ideas" ? null : ideaId, kind, status: "running", stage: "queued",
    idempotencyKey: "reader-first-request", requestFingerprint: "a".repeat(64),
    snapshot: { version: 2, context,
      ...(kind === "article" ? { selection: { idea, evidence: empty } } : {}),
      ...(kind === "question" ? { question: { articleVersion: ideaId, question: "What is the threshold in your example?",
        draft: savedArticle(), evidence: empty, previousMessages: [] } } : {}), ...extra },
    result: null, progress: null, failureCode: null, workflowRunId: "run-v2", leaseExpiresAt: new Date(now.getTime() + 300000),
    nextAttemptAt: now, attempts: 1, reservedMicrousd: kind === "question" ? 250000 : 1200000, createdAt: now, updatedAt: now };
}
function checked(call: OnDemandProviderRequest, failed = false) {
  return { fingerprint: (call.input as { fingerprint: string }).fingerprint, verdict: failed ? "repair" : "pass",
    accuracyPassed: true, verificationPassed: !failed, promiseFulfilled: true, readerFit: true, continuity: true, privacyPassed: true,
    findings: failed ? [{ location: "body.0", excerpt: support, severity: "material", kind: "verification_required",
      reason: "This constructed test requires new evidence.", repair: "Research the particular claim before publishing.", passageIds: [] }] : [] };
}
function fake(output: (call: OnDemandProviderRequest) => unknown, calls: OnDemandProviderRequest[] = [], provenance = true): OnDemandProvider {
  return async (call) => {
    calls.push(call);
    return { output: output(call), usage: { providerResponseId: `v2-response-${calls.length}`, model: call.model,
      inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, webSearchCalls: 0, webSearchToolCalls: 0, webSearchPricingStatus: "priced" },
      ...(provenance ? { researchProvenance: { consultedUrls: [source.url], openedUrls: [], citedUrls: [] } } : {}) };
  };
}
const retrieve: typeof retrieveEvidencePage = async (url) => ({ url, title: "Actually fetched page title", text: support,
  retrievedAt: "2026-09-07T20:00:00.000Z" });
async function run(request: DemandRequestRow, provider: OnDemandProvider, retrievePage = retrieve) {
  let state = initialDemandState(request) as ReaderFirstPipelineState;
  const phases: string[] = [];
  for (let steps = 0; steps < 16; steps++) {
    phases.push(state.phase);
    const result = await advanceReaderFirstPipeline({ request, state }, { provider, retrievePage });
    state = result.state;
    if (result.outcome || result.failureCode) return { ...result, phases };
  }
  throw new Error("Pipeline exceeded the existing workflow step cap");
}

test("a stable concept skips retrieval and publishes only after exact-draft checking", async () => {
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(row("article"), fake((call) => call.stage === "write" ? rawArticle() : checked(call), calls),
    async () => { throw new Error("Unexpected retrieval"); });
  assert.equal(result.outcome, "article");
  assert.deepEqual(result.phases, ["write", "check"]);
  assert.deepEqual(calls.map((call) => call.stage), ["write", "check"]);
  assert.equal(calls[1].researchPolicy?.mode, "none");
  assert.deepEqual(result.state.evidence, empty);
  assert.equal("claims" in result.state.draft!, false);
});

test("stable ideas have no required search or excerpt IDs but receive independent premise checks", async () => {
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(row("ideas"), fake((call) => call.stage === "ideas"
    ? { ...empty, ideas: [candidate], insufficiencyReason: null }
    : { fingerprint: (call.input as { fingerprint: string }).fingerprint, ideas: [{ key: idea.key, verdict: "pass", premiseSupported: true,
      verificationRequired: false, verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "A stable conceptual question." }] }, calls));
  assert.equal(result.outcome, "ideas");
  assert.deepEqual(result.phases, ["ideas", "ideas_check"]);
  assert.deepEqual(result.state.ideas?.[0].passageIds, []);
});

test("a current premise without required evidence is withheld even when the author offers it", async () => {
  const result = await run(row("ideas"), fake((call) => call.stage === "ideas"
    ? { ...empty, ideas: [candidate], insufficiencyReason: null }
    : { fingerprint: (call.input as { fingerprint: string }).fingerprint, ideas: [{ key: idea.key, verdict: "pass", premiseSupported: true,
      verificationRequired: true, verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "Missing actual required support." }] }));
  assert.equal(result.failureCode, "evidence_unavailable");
});

test("researched prose is compiled from actual retrieval, including safe canonical redirects", async () => {
  const result = await run(row("article"), fake((call) => call.stage === "write" ? rawArticle(true) : checked(call)),
    async (url) => ({ ...await retrieve(url), url: "https://example.org/canonical-control" }));
  assert.equal(result.outcome, "article");
  assert.deepEqual(result.phases, ["write", "retrieve", "check"]);
  assert.equal(result.state.draft?.article?.sources[0].title, "Actually fetched page title");
  assert.equal(result.state.draft?.article?.sources[0].url, "https://example.org/canonical-control");
  assert.equal(result.state.draft?.article?.sources[0].publishedAt, null);
  assert.equal(result.state.evidence?.passages[0].provenance, "retrieved");
});

test("an invented discovery URL cannot trigger retrieval or become a citation", async () => {
  let fetched = 0;
  const result = await run(row("article"), fake(() => rawArticle(true), [], false), async (url) => { fetched++; return retrieve(url); });
  assert.equal(result.failureCode, "provider_invalid");
  assert.equal(fetched, 0);
});

test("unused non-fetchable search results cannot poison a genuine HTTPS citation", async () => {
  const base = fake((call) => call.stage === "write" ? rawArticle(true) : checked(call));
  const provider: OnDemandProvider = async (call) => ({ ...await base(call), researchProvenance: {
    consultedUrls: ["http://example.org/unrelated", "https://127.0.0.1/private", source.url], openedUrls: [], citedUrls: [],
  } });
  const result = await run(row("article"), provider);
  assert.equal(result.outcome, "article");
  assert.deepEqual(result.state.evidence?.sources.map((entry) => entry.url), [source.url]);
});

test("independent verification failure permits exactly one researched repair and fresh check", async () => {
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(row("article"), fake((call) => call.stage === "write" ? rawArticle()
    : call.stage === "repair" ? rawArticle(true) : checked(call, calls.filter((entry) => entry.stage === "check").length === 1), calls));
  assert.equal(result.outcome, "article");
  assert.deepEqual(calls.map((call) => call.stage), ["write", "check", "repair", "check"]);
  assert.equal(calls[2].researchPolicy?.mode, "required");
  assert.deepEqual(result.phases, ["write", "check", "repair", "retrieve", "recheck"]);
  assert.equal(result.state.repairAttempted, true);
});

test("a failing repaired explanation is terminal and never gains another model call", async () => {
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(row("article"), fake((call) => call.stage === "write" || call.stage === "repair" ? rawArticle() : checked(call, true), calls));
  assert.equal(result.failureCode, "editorial_withheld");
  assert.equal(calls.length, 4);
});

test("Ask can acquire answer-owned evidence without changing the saved article", async () => {
  const request = row("question"); const before = structuredClone(request.snapshot);
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(request, fake((call) => call.stage === "answer" ? rawAnswer(true) : checked(call), calls));
  assert.equal(result.outcome, "question");
  assert.deepEqual(result.phases, ["answer", "retrieve", "answer_check"]);
  assert.equal(result.state.answer?.sources[0].key, "s1");
  assert.deepEqual(request.snapshot, before);
  assert.equal((request.snapshot.question as { draft: ReaderFirstWriterOutput }).draft.article?.sources.length, 0);
});

test("Ask uses the same sole repair allowance when new grounding is required", async () => {
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(row("question"), fake((call) => call.stage === "answer" ? rawAnswer()
    : call.stage === "repair" ? rawAnswer(true) : checked(call, calls.filter((entry) => entry.stage === "check").length === 1), calls));
  assert.equal(result.outcome, "question");
  assert.deepEqual(calls.map((call) => call.stage), ["answer", "check", "repair", "check"]);
  assert.equal(calls[2].researchPolicy?.mode, "required");
});

test("a source consulted again is refreshed rather than silently reusing old article evidence", async () => {
  const old = { sources: [{ ...source, title: "Old title", publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: "old", sourceId: "s1", text: "Outdated constructed evidence.", locator: "Old page",
      provenance: "retrieved", retrievedAt: "2025-01-01T00:00:00.000Z" }] };
  const request = row("question", { question: { articleVersion: ideaId, question: "What does the current source say?",
    draft: savedArticle(), evidence: old, previousMessages: [] } });
  let fetches = 0;
  const result = await run(request, fake((call) => call.stage === "answer" ? rawAnswer(true) : checked(call)), async (url) => { fetches++; return retrieve(url); });
  assert.equal(result.outcome, "question"); assert.equal(fetches, 1);
  assert.ok(result.state.evidence?.passages.every((passage) => passage.id !== "old"));
  assert.ok(result.state.evidence?.passages.every((passage) => passage.retrievedAt === "2026-09-07T20:00:00.000Z"));
});

test("v1 snapshots and cross-loop selections cannot enter the new pipeline", async () => {
  const request = row("article");
  let calls = 0; const provider = fake(() => { calls++; return rawArticle(); });
  const initial = initialDemandState(request) as ReaderFirstPipelineState;
  assert.equal((await advanceReaderFirstPipeline({ request: { ...request, snapshot: { ...request.snapshot, version: 1 } }, state: initial }, { provider })).failureCode, "pipeline_state_invalid");
  const wrong = row("article", { selection: { idea: { ...idea, loopId: "other-loop" }, evidence: empty } });
  assert.equal((await advanceReaderFirstPipeline({ request: wrong, state: initial }, { provider })).failureCode, "pipeline_snapshot_invalid");
  assert.equal(calls, 0);
});

test("a failed source refresh cannot resurrect stale article evidence during repair", async () => {
  const old = { sources: [{ ...source, title: "Old title", publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: "old", sourceId: "s1", text: "Outdated constructed evidence.", locator: "Old page",
      provenance: "retrieved", retrievedAt: "2025-01-01T00:00:00.000Z" }] };
  const request = row("question", { question: { articleVersion: ideaId, question: "What does the current source say?",
    draft: savedArticle(), evidence: old, previousMessages: [] } });
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(request, fake((call) => call.stage === "answer" || call.stage === "repair"
    ? rawAnswer(true) : checked(call), calls), async () => { throw new Error("Constructed refresh failure"); });
  assert.equal(result.failureCode, "editorial_withheld");
  assert.deepEqual(calls.map((call) => call.stage), ["answer", "repair"]);
  assert.deepEqual(result.state.evidence, empty);
  assert.deepEqual(request.snapshot.question, { articleVersion: ideaId, question: "What does the current source say?",
    draft: savedArticle(), evidence: old, previousMessages: [] });
});

test("refreshing a chained Ask source preserves its historical reference but never rebinds old prose to new passages", async () => {
  const oldTime = "2025-01-01T00:00:00.000Z";
  const old = { sources: [{ ...source, title: "Old title", publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: "old", sourceId: "s1", text: "An older constructed description.", locator: "Old page",
      provenance: "retrieved", retrievedAt: oldTime }] };
  const reference = { label: "1", sourceId: "00000000-0000-4000-8000-000000000705", title: "Old title",
    url: source.url, accessedAt: oldTime, evidenceSourceKey: "s1", passageIds: ["old"] };
  const request = row("question", { question: { articleVersion: ideaId, question: "What does source 1 say now?",
    draft: savedArticle(), evidence: old, previousMessages: [
      { role: "user", text: "What did the earlier source say?" },
      { role: "assistant", text: "The saved older explanation.", references: [reference] },
    ] } });
  const before = structuredClone(request.snapshot);
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(request, fake((call) => call.stage === "answer" ? rawAnswer(true) : checked(call), calls));
  assert.equal(result.outcome, "question");
  const generation = calls[0].input as { previousMessages: Array<{ references?: unknown[] }> };
  const check = calls[1].input as typeof generation;
  assert.deepEqual(generation.previousMessages[1].references, [reference]);
  assert.deepEqual(check.previousMessages[1].references, [{ ...reference, evidenceSourceKey: null, passageIds: [] }]);
  assert.deepEqual(request.snapshot, before);
});
