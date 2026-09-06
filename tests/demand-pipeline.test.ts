import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceDemandPipeline, DEMAND_EVIDENCE_PACKET_BYTES, initialDemandPhase, type DemandPipelineState,
} from "../apps/api/src/services/demand-pipeline";
import type { DemandRequestRow } from "../apps/api/src/services/demand-reading";
import type { retrieveEvidencePage } from "../apps/api/src/services/evidence-retrieval";
import { DemandUsagePersistenceError } from "../apps/api/src/services/demand-provider-stages";
import {
  type OnDemandCheckOutput, type OnDemandContext,
  type OnDemandEvidence, type OnDemandIdea, type OnDemandProvider, type OnDemandProviderRequest,
  type OnDemandResearchOutput, type OnDemandWriterOutput,
} from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import { createEmptyLoopPrincipleState } from "../packages/domain/src/loop-principles";
import { providerFixtureOutput, surfaceCheckFixture, writerProviderFixture } from "./helpers/on-demand-provider-fixture";

// All passages/responses below are constructed. These are pipeline/state tests,
// not real provider research, editorial-quality, or daily-value acceptance.
const loopId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const context: OnDemandContext = {
  loopId, revision: 0, originalCuriosity: "How do engineered cells respond to their surroundings?",
  directions: [], declaredKnowledge: ["I know the basics of DNA"], readingPreferences: ["Use practical examples"],
  preferences: { length: "brief", depth: 70 }, previousArticles: [], currentDate: "2026-09-06",
};
const support = "The constructed experiment measured cellular responses under controlled laboratory conditions, but did not test clinical efficacy.";
function research(sourceCount = 2): OnDemandResearchOutput {
  const sources = Array.from({ length: sourceCount }, (_, index) => ({ id: `s${index}`, url: `https://example.org/study-${index}`, title: "Unverified model title", publisher: "Unverified model publisher", publishedDate: "2026-09-06", datePrecision: "day" as const }));
  return { sources,
    passages: sources.map((source, index) => ({ id: `lead-${index}`, sourceId: source.id, text: support, locator: "Model-reported location" })),
    ideas: [{ key: "circuit", headline: "What a laboratory cell response can tell us", deck: "A measured response is not clinical proof.", readerQuestion: "What does the experiment establish?", payoff: "Understand the boundary between laboratory and clinical evidence.", advanceBeyondPrevious: "Explain the study's evidence limits.", qualifications: ["No clinical efficacy was tested."], passageIds: ["lead-0"] }],
    insufficiencyReason: null,
  };
}
function evidence(): OnDemandEvidence {
  return { sources: research().sources.map((source) => ({ ...source, title: "Actual fetched page title", publisher: "example.org", publishedDate: null, datePrecision: "unknown" })),
    passages: research().passages.map((passage) => ({ ...passage, provenance: "retrieved", retrievedAt: "2026-09-06T12:00:00.000Z" })) };
}
function idea(): OnDemandIdea {
  return { ...research().ideas[0], id: "selected-idea", loopId, loopRevision: 0, passageIds: evidence().passages.map((passage) => passage.id) };
}
function draft(packet = evidence()): OnDemandWriterOutput {
  const article = { category: "tech-science" as const, kicker: "Biology", topic: "Engineered cells", title: idea().headline, deck: idea().deck,
    summary: ["Responses were measured in a laboratory.", "Clinical efficacy was not tested.", "Evidence scope matters."], whyWritten: "The article explains evidence limits.", readingMinutes: 3,
    body: Array.from({ length: 6 }, (_, index) => ({ type: "paragraph" as const, text: `Constructed explanation ${index}: laboratory behavior is not clinical evidence.`, citations: packet.sources.map((source) => ({ sourceKey: source.id, label: "example.org" })) })),
    sources: packet.sources.map((source) => ({ key: source.id, title: source.title, publisher: source.publisher, url: source.url, publishedAt: null })),
  };
  const locations = ["title", "deck", "summary.0", "summary.1", "summary.2", ...article.body.map((_, index) => `body.${index}`)];
  return { status: "written", article, reason: null, claims: locations.map((location, index) => ({ id: `c${index + 1}`, text: "The experiment did not establish clinical efficacy.", locations: [location], passageIds: packet.passages.map((passage) => passage.id) })) };
}
function check(value = draft(), verdict: OnDemandCheckOutput["verdict"] = "pass"): OnDemandCheckOutput {
  return { verdict, promiseFulfilled: verdict === "pass", readerFit: true, continuity: true, privacyPassed: true, sourceMetadataPassed: true,
    surfaceChecks: surfaceCheckFixture(value),
    claims: value.claims.map((claim) => ({ claimId: claim.id, verdict: "supported", passageIds: claim.passageIds, reason: "The constructed passage states the limitation." })),
    missedMaterialClaims: [], findings: verdict === "pass" ? [] : [{ location: "deck", severity: "material", reason: "The explanation does not fulfill the headline.", repair: "Explain the material evidence boundary." }],
  };
}
function questionCheck(value = draft(), verdict: OnDemandCheckOutput["verdict"] = "pass"): OnDemandCheckOutput {
  const result = check(value, verdict);
  delete result.surfaceChecks;
  return result;
}
function row(kind: DemandRequestRow["kind"], snapshot: Record<string, unknown> = {}): DemandRequestRow {
  const at = new Date("2026-09-06T12:00:00.000Z");
  return { id: requestId, principalId: "00000000-0000-4000-8000-000000000003", loopId, ideaId: null, kind,
    status: "running", stage: initialDemandPhase(kind), idempotencyKey: "logical-request", requestFingerprint: "a".repeat(64),
    snapshot: { version: 1, context, principleState: createEmptyLoopPrincipleState({ loopId, originalCuriosity: context.originalCuriosity }), ...snapshot },
    result: null, progress: null, failureCode: null, workflowRunId: "run-1", leaseExpiresAt: new Date(at.getTime() + 300000), nextAttemptAt: at, attempts: 1,
    reservedMicrousd: 1200000, createdAt: at, updatedAt: at };
}
function initial(request: DemandRequestRow): DemandPipelineState {
  return { version: 1, phase: initialDemandPhase(request.kind), requestId: request.id, requestFingerprint: request.requestFingerprint, kind: request.kind,
    models: { article: "gpt-5.6-terra", utility: "gpt-5.6-luna" } };
}
function fakeProvider(output: (request: OnDemandProviderRequest) => unknown, calls: OnDemandProviderRequest[] = []): OnDemandProvider {
  return async (request) => {
    calls.push(request);
    return { output: providerFixtureOutput(request, output(request)), usage: { providerResponseId: `response-${calls.length}`, model: request.model, inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }, researchedUrls: research(16).sources.map((source) => source.url) };
  };
}
const retrieve: typeof retrieveEvidencePage = async (url) => ({ url, title: "Actual fetched page title", text: `Document introduction. ${support} Interpretation and methodological limitations follow this evidence.`, retrievedAt: "2026-09-06T12:00:00.000Z" });
const articleRequest = () => row("article", { selection: { idea: idea(), evidence: evidence() } });

test("phase-only initialization freezes models without any provider or retrieval work", async () => {
  let calls = 0; const request = row("ideas");
  const result = await advanceDemandPipeline({ request, state: { phase: "research" } }, { provider: fakeProvider(() => { calls++; return {}; }), retrievePage: async (...args) => { calls++; return retrieve(...args); } });
  assert.equal(calls, 0);
  assert.equal(result.state.requestId, request.id);
  assert.equal(result.state.kind, "ideas");
  assert.ok(result.state.models?.article);
  assert.equal(result.state.phase, "research");
});

test("ideas flow performs research, separate retrieval, then checking without a body call", async () => {
  const request = row("ideas"); const calls: OnDemandProviderRequest[] = [];
  const provider = fakeProvider((call) => call.stage === "ideas" ? research() : { ideas: [{ key: "circuit", verdict: "pass", premiseSupported: true, fitsLoop: true, distinctContribution: true, passageIds: (call.input as { evidence: OnDemandEvidence }).evidence.passages.map((passage) => passage.id), reason: "The evidence supports a bounded explanation." }] }, calls);
  const first = await advanceDemandPipeline({ request, state: initial(request) }, { provider, retrievePage: retrieve });
  assert.equal(first.state.phase, "retrieve"); assert.equal(first.outcome, undefined);
  const second = await advanceDemandPipeline({ request, state: first.state }, { provider, retrievePage: retrieve });
  assert.equal(second.state.phase, "ideas_check"); assert.equal(calls.length, 1);
  const final = await advanceDemandPipeline({ request, state: second.state }, { provider, retrievePage: retrieve });
  assert.equal(final.outcome, "ideas"); assert.equal(final.state.phase, "ready");
  assert.deepEqual(calls.map((call) => call.stage), ["ideas", "ideas_check"]);
  assert.equal(final.state.draft, undefined);
  assert.equal(final.state.ideas![0].loopId, loopId);
  assert.equal(final.state.evidence!.sources[0].title, "Actual fetched page title");
  assert.equal(final.state.evidence!.sources[0].publisher, "example.org");
  assert.equal(final.state.evidence!.sources[0].datePrecision, "unknown");
  assert.equal(final.state.evidence!.sources[0].publishedDate, null);
  assert.notEqual(final.state.evidence!.passages[0].id, "lead-0");
});

test("retrieval checkpoints process at most four pages and resume at the saved offset", async () => {
  const request = row("ideas"); const urls: string[] = []; let modelCalls = 0;
  const dependencies = { provider: fakeProvider(() => { modelCalls++; return {}; }), retrievePage: async (url: string) => { urls.push(url); return retrieve(url); } };
  const state: DemandPipelineState = { ...initial(request), phase: "retrieve", research: research(6), evidence: { sources: [], passages: [] }, retrieval: { nextSourceIndex: 0, failures: [] } };
  const first = await advanceDemandPipeline({ request, state }, dependencies);
  assert.equal(first.state.retrieval!.nextSourceIndex, 4); assert.equal(urls.length, 4); assert.equal(first.state.phase, "retrieve");
  const second = await advanceDemandPipeline({ request, state: first.state }, dependencies);
  assert.equal(second.state.retrieval!.nextSourceIndex, 6); assert.equal(urls.length, 6); assert.equal(second.state.phase, "ideas_check");
  assert.equal(new Set(urls).size, 6); assert.equal(modelCalls, 0);
  assert.equal(state.retrieval!.nextSourceIndex, 0);
});

test("unmatched model quotations never become purportedly fetched text", async () => {
  const request = row("ideas"); const discovered = research();
  discovered.passages = discovered.passages.map((passage) => ({ ...passage, text: "An invented quote says this circuit cures every illness immediately and has already been proven in patients." }));
  const actualText = "The actual source describes a limited experiment and explicitly says that no clinical trials were performed. These are laboratory observations only.";
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "retrieve", research: discovered, evidence: { sources: [], passages: [] }, retrieval: { nextSourceIndex: 0, failures: [] } } }, { retrievePage: async (url) => ({ url, title: null, text: actualText, retrievedAt: "2026-09-06T12:00:00.000Z" }) });
  assert.equal(result.state.phase, "ideas_check");
  for (const passage of result.state.evidence!.passages) {
    assert.ok(actualText.includes(passage.text)); assert.equal(passage.provenance, "retrieved");
    assert.ok(!passage.text.includes("cures every illness"));
  }
});

test("fallback retrieval favors distinct relevant terms in body prose over an early navigation mention", async () => {
  const request = row("ideas"); const discovered = research();
  discovered.passages = discovered.passages.map((passage) => ({ ...passage,
    text: "Research on engineered genetic cellular sensors explains how laboratory circuits regulate transcription through modular feedback pathways." }));
  const actualText = "NAVIGATION marker: Research and laboratory information. " + "General site information. ".repeat(180) +
    "BODY EVIDENCE: Engineered cellular sensors use genetic circuits. Their modular feedback pathways regulate transcription in laboratory conditions. These observations do not establish clinical efficacy.";
  let fetches = 0;
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "retrieve", research: discovered,
    evidence: { sources: [], passages: [] }, retrieval: { nextSourceIndex: 0, failures: [] } } },
  { retrievePage: async (url) => { fetches++; return { url, title: null, text: actualText, retrievedAt: "2026-09-06T12:00:00.000Z" }; } });
  assert.equal(result.state.phase, "ideas_check"); assert.equal(fetches, 2);
  for (const passage of result.state.evidence!.passages) {
    assert.ok(actualText.includes(passage.text));
    assert.ok(passage.text.includes("BODY EVIDENCE"));
    assert.ok(!passage.text.includes("NAVIGATION marker"));
    assert.ok(passage.text.length <= 2200);
    assert.equal(passage.provenance, "retrieved");
  }
});

test("inaccessible sources fail honestly without inventing a prepared article", async () => {
  const request = row("ideas");
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "retrieve", research: research(), evidence: { sources: [], passages: [] }, retrieval: { nextSourceIndex: 0, failures: [] } } }, { retrievePage: async () => { throw new Error("Unavailable page"); } });
  assert.equal(result.failureCode, "evidence_unavailable"); assert.equal(result.outcome, undefined); assert.equal(result.state.draft, undefined);
  assert.equal(result.state.retrieval!.failures.length, 2);
});

test("redirect aliases are not counted as independent evidence sources", async () => {
  const request = row("ideas");
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "retrieve", research: research(), evidence: { sources: [], passages: [] }, retrieval: { nextSourceIndex: 0, failures: [] } } }, { retrievePage: async () => retrieve("https://example.org/canonical") });
  assert.equal(result.state.evidence!.sources.length, 1);
  assert.equal(result.state.retrieval!.failures[0].code, "duplicate_source_url");
});

test("a packet over 40KB fails before a writer call without trimming instructions", async () => {
  const packet = evidence(); packet.passages = Array.from({ length: 5 }, (_, index) => ({ ...packet.passages[0], id: `p${index}`, text: "x".repeat(9000) }));
  const request = row("article", { selection: { idea: idea(), evidence: packet } }); let calls = 0;
  const result = await advanceDemandPipeline({ request, state: initial(request) }, { provider: fakeProvider(() => { calls++; return draft(); }) });
  assert.ok(Buffer.byteLength(JSON.stringify(packet)) > DEMAND_EVIDENCE_PACKET_BYTES);
  assert.equal(result.failureCode, "evidence_limit"); assert.equal(calls, 0);
  assert.deepEqual((request.snapshot.context as OnDemandContext).readingPreferences, ["Use practical examples"]);
});

test("article is unavailable after writing and ready only after its separate successful check", async () => {
  const request = articleRequest(); const calls: OnDemandProviderRequest[] = [];
  const provider = fakeProvider((call) => call.stage === "write" ? draft() : check((call.input as { draft: OnDemandWriterOutput }).draft), calls);
  const written = await advanceDemandPipeline({ request, state: initial(request) }, { provider });
  assert.equal(written.state.phase, "check"); assert.equal(written.outcome, undefined);
  const checked = await advanceDemandPipeline({ request, state: written.state }, { provider });
  assert.equal(checked.state.phase, "ready"); assert.equal(checked.outcome, "article");
  assert.deepEqual(calls.map((call) => call.stage), ["write", "check"]);
  assert.equal(calls[0].model, "gpt-5.6-terra"); assert.equal(calls[1].model, "gpt-5.6-luna");
});

test("failed article check permits one repair and one full recheck, then withholds", async () => {
  const request = articleRequest(); const calls: OnDemandProviderRequest[] = [];
  const provider = fakeProvider((call) => call.stage === "write" || call.stage === "repair" ? draft() : check((call.input as { draft: OnDemandWriterOutput }).draft, "repair"), calls);
  let state = initial(request);
  const phases: string[] = [];
  for (let index = 0; index < 4; index++) {
    const result = await advanceDemandPipeline({ request, state }, { provider }); state = result.state; phases.push(state.phase);
    assert.equal(result.outcome, undefined);
  }
  assert.deepEqual(phases, ["check", "repair", "recheck", "failed"]);
  assert.deepEqual(calls.map((call) => call.stage), ["write", "check", "repair", "check"]);
  assert.equal(state.failureCode, "editorial_withheld");
  await advanceDemandPipeline({ request, state }, { provider }); assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map((call) => call.idempotencyKey)).size, 4);
});

function initialValidationFixture() {
  const packet = evidence(); packet.sources = packet.sources.slice(0, 1); packet.passages = packet.passages.slice(0, 1);
  const selectedIdea = { ...idea(), passageIds: packet.passages.map((passage) => passage.id) };
  const request = row("article", { selection: { idea: selectedIdea, evidence: packet } });
  const fixed = draft(packet);
  fixed.article!.body.push({ type: "heading", level: 2, text: "The limit" },
    { type: "paragraph", text: "The experiment does not establish clinical efficacy.", citations: [{ sourceKey: "s0", label: "example.org" }] },
    { type: "paragraph", text: "A separate clinical study would answer a different question.", citations: [{ sourceKey: "s0", label: "example.org" }] });
  for (const index of [7, 8]) fixed.claims.push({ id: `c${fixed.claims.length + 1}`, text: "Clinical efficacy remains untested.", locations: [`body.${index}`], passageIds: ["lead-0"] });
  const invalid = structuredClone(fixed);
  // The provider can no longer author source metadata or disconnected location
  // maps. A parseable wrong selected title still exercises deterministic repair.
  invalid.article!.title = "An unrelated title that does not preserve the selected idea";
  return { request, fixed, invalid };
}

test("a parseable initial selected-title failure gets one deterministic repair then full checking", async () => {
  const { request, fixed, invalid } = initialValidationFixture(); const calls: OnDemandProviderRequest[] = [];
  const provider = fakeProvider((call) => {
    if (call.stage === "write") return invalid;
    if (call.stage === "repair") {
      const input = call.input as { check?: unknown; validationFindings: Array<{ location: string; reason: string }> };
      assert.equal(input.check, undefined, "deterministic findings are not a fabricated checker verdict");
      assert.ok(input.validationFindings.some((finding) => finding.reason === "Selected headline changed"));
      return fixed;
    }
    const assembled = (call.input as { draft: OnDemandWriterOutput }).draft;
    assert.equal(assembled.article!.title, fixed.article!.title);
    assert.equal(assembled.article!.sources.length, 1);
    for (const location of ["body.7", "body.8"]) assert.ok(assembled.claims.some((claim) => claim.locations.includes(location)));
    return check(assembled);
  }, calls);
  const first = await advanceDemandPipeline({ request, state: initial(request) }, { provider });
  assert.equal(first.state.phase, "repair"); assert.equal(first.outcome, undefined);
  assert.equal(first.state.draft!.article!.title, invalid.article!.title); assert.equal(first.state.check, undefined);
  assert.equal(first.state.draft!.article!.sources.length, 1);
  const second = await advanceDemandPipeline({ request, state: first.state }, { provider });
  assert.equal(second.state.phase, "recheck"); assert.equal(second.outcome, undefined); assert.equal(second.state.repairAttempted, true);
  const final = await advanceDemandPipeline({ request, state: second.state }, { provider });
  assert.equal(final.outcome, "article"); assert.equal(final.state.phase, "ready");
  assert.deepEqual(calls.map((call) => call.stage), ["write", "repair", "check"]);
  assert.deepEqual(calls.map((call) => call.idempotencyKey), [`${requestId}:write`, `${requestId}:repair`, `${requestId}:recheck`]);
  assert.deepEqual(calls.map((call) => call.model), ["gpt-5.6-terra", "gpt-5.6-terra", "gpt-5.6-luna"]);
  assert.ok(calls.every((call) => call.promptVersion === "edison-demand-v1.5"));
});

test("initial structural repair is terminal if its draft remains invalid or its full recheck fails", async () => {
  for (const failure of ["repair", "recheck", "insufficient"] as const) {
    const { request, fixed, invalid } = initialValidationFixture(); const calls: OnDemandProviderRequest[] = [];
    const provider = fakeProvider((call) => call.stage === "write" ? invalid
      : call.stage === "repair" ? failure === "repair" ? invalid : failure === "insufficient" ? { status: "insufficient_evidence", article: null, claims: [], reason: "The evidence cannot sustain the promise." } : fixed
        : check((call.input as { draft: OnDemandWriterOutput }).draft, "repair"), calls);
    let state = initial(request);
    for (let index = 0; index < 4; index++) {
      const result = await advanceDemandPipeline({ request, state }, { provider }); state = result.state;
      assert.equal(result.outcome, undefined);
      if (state.phase === "failed") break;
    }
    assert.equal(state.phase, "failed");
    assert.equal(calls.filter((call) => call.stage === "repair").length, 1);
    assert.equal(calls.length, failure === "recheck" ? 3 : 2);
    await advanceDemandPipeline({ request, state }, { provider });
    assert.equal(calls.length, failure === "recheck" ? 3 : 2);
  }
});

test("resuming initial-validation and repair phases reuses retained stages without another writer or repair", async () => {
  const { request, fixed, invalid } = initialValidationFixture();
  const cache = new Map<string, Awaited<ReturnType<OnDemandProvider>>>(); let commissions = 0;
  const provider: OnDemandProvider = async (call) => {
    if (cache.has(call.idempotencyKey)) return cache.get(call.idempotencyKey)!;
    commissions++; const result = await fakeProvider(() => call.stage === "write" ? invalid : fixed)(call);
    cache.set(call.idempotencyKey, result); return result;
  };
  const first = await advanceDemandPipeline({ request, state: initial(request) }, { provider });
  const firstReplay = await advanceDemandPipeline({ request, state: initial(request) }, { provider });
  assert.deepEqual(firstReplay.state, first.state); assert.equal(commissions, 1);
  const repair = await advanceDemandPipeline({ request, state: first.state }, { provider });
  const repairReplay = await advanceDemandPipeline({ request, state: first.state }, { provider });
  assert.deepEqual(repairReplay.state, repair.state); assert.equal(commissions, 2);
  const repeated = await advanceDemandPipeline({ request, state: { ...repair.state, phase: "repair" } }, { provider });
  assert.equal(repeated.failureCode, "pipeline_state_invalid"); assert.equal(commissions, 2);
});

test("unparseable or uncertain initial responses never enter deterministic repair", async () => {
  const { request, fixed } = initialValidationFixture();
  const missingLocalClaims = structuredClone(writerProviderFixture(fixed)) as { article: { title: { claims?: unknown } } };
  delete missingLocalClaims.article.title.claims;
  for (const provider of [fakeProvider(() => ({ status: "written", article: {} })), fakeProvider(() => missingLocalClaims), async () => { throw new Error("provider_uncertain"); }]) {
    const result = await advanceDemandPipeline({ request, state: initial(request) }, { provider });
    assert.equal(result.state.phase, "failed"); assert.equal(result.state.draftValidationFindings, undefined);
    assert.equal(result.state.draft, undefined); assert.equal(result.outcome, undefined);
  }
});

test("insufficient evidence skips repair instead of spending another drafting call", async () => {
  const request = articleRequest(); const calls: OnDemandProviderRequest[] = [];
  const provider = fakeProvider(() => check(draft(), "insufficient_evidence"), calls);
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "check", draft: draft() } }, { provider });
  assert.equal(result.failureCode, "editorial_withheld"); assert.equal(calls.length, 1); assert.equal(calls[0].stage, "check");
});

test("resuming the same saved phase uses the same request identity and frozen model", async () => {
  const request = articleRequest(); const state = initial(request); const cache = new Map<string, Awaited<ReturnType<OnDemandProvider>>>(); let commissions = 0;
  const provider: OnDemandProvider = async (call) => {
    if (cache.has(call.idempotencyKey)) return cache.get(call.idempotencyKey)!;
    commissions++; const result = await fakeProvider(() => draft())(call); cache.set(call.idempotencyKey, result); return result;
  };
  const first = await advanceDemandPipeline({ request, state }, { provider });
  const retried = await advanceDemandPipeline({ request, state }, { provider });
  assert.deepEqual(first.state, retried.state); assert.equal(commissions, 1);
  assert.equal(state.phase, "write"); assert.equal(state.draft, undefined);
});

test("states cannot be reused across requests or loops", async () => {
  let calls = 0; const request = articleRequest();
  const crossRequest = await advanceDemandPipeline({ request, state: { ...initial(request), requestId: "other-request" } }, { provider: fakeProvider(() => { calls++; return draft(); }) });
  assert.equal(crossRequest.failureCode, "pipeline_state_invalid");
  const crossLoop = await advanceDemandPipeline({ request: { ...request, loopId: "different-loop" }, state: initial(request) }, { provider: fakeProvider(() => { calls++; return draft(); }) });
  assert.equal(crossLoop.failureCode, "pipeline_snapshot_invalid"); assert.equal(calls, 0);
});

test("feedback output is interpreted only, with no reducer or persistence mutation", async () => {
  const request = row("feedback", { feedback: { operation: "apply", text: "Make articles shorter", baseRevision: 0 } });
  const before = structuredClone(request.snapshot); const calls: OnDemandProviderRequest[] = [];
  const result = await advanceDemandPipeline({ request, state: initial(request) }, { provider: fakeProvider(() => ({ status: "changes", operations: [{ type: "set", targetPrincipleId: null, kind: "preference", instruction: "Make articles shorter" }], message: "Shorter reading requested." }), calls) });
  assert.equal(result.outcome, "feedback"); assert.equal(result.state.feedback!.operations.length, 1);
  assert.deepEqual(request.snapshot, before); assert.deepEqual(calls.map((call) => call.stage), ["feedback"]);
});

test("unclear feedback stays unchanged and has no successful outcome", async () => {
  const request = row("feedback", { feedback: { operation: "apply", text: "Please email my friend", baseRevision: 0 } });
  const result = await advanceDemandPipeline({ request, state: initial(request) }, { provider: fakeProvider(() => ({ status: "clarification", operations: [], message: "What should change about this loop's reading?" })) });
  assert.equal(result.failureCode, "feedback_unclear"); assert.equal(result.outcome, undefined);
});

test("contextual question uses its immutable article identity and is checked without changing preferences", async () => {
  const immutableArticleId = "00000000-0000-4000-8000-000000000004";
  const request = row("question", { question: { question: "Was clinical efficacy tested?", articleVersion: immutableArticleId, draft: draft(), evidence: evidence(), previousMessages: [{ role: "user", text: "What kind of experiment was this?" }, { role: "assistant", text: "A laboratory experiment." }] } });
  const answer = { status: "answered", answer: "No. The experiment did not test clinical efficacy.", claims: [{ id: "answer-claim", text: "Clinical efficacy was not tested.", locations: ["answer"], passageIds: ["lead-0"] }], missingEvidence: null };
  const calls: OnDemandProviderRequest[] = [];
  const provider = fakeProvider((call) => call.stage === "answer" ? answer : { ...questionCheck(), claims: [{ claimId: "answer-claim", verdict: "supported", passageIds: ["lead-0"], reason: "The source explicitly excludes clinical tests." }] }, calls);
  const first = await advanceDemandPipeline({ request, state: initial(request) }, { provider });
  assert.equal(first.state.phase, "answer_check"); assert.equal(first.outcome, undefined);
  const final = await advanceDemandPipeline({ request, state: first.state }, { provider });
  assert.equal(final.outcome, "question"); assert.equal(final.state.feedback, undefined);
  assert.equal((calls[0].input as { articleId: string }).articleId, immutableArticleId);
  assert.equal((calls[0].input as { conversation: unknown[] }).conversation.length, 2);
  assert.deepEqual((request.snapshot.context as OnDemandContext).readingPreferences, ["Use practical examples"]);
});

test("a failed question checker never exposes the unchecked answer as ready", async () => {
  const request = row("question", { question: { question: "Was clinical efficacy tested?", articleVersion: "immutable-article-1", draft: draft(), evidence: evidence(), previousMessages: [] } });
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "answer_check", answer: { status: "answered", answer: "It cured patients.", claims: [{ id: "answer-claim", text: "It cured patients.", locations: ["answer"], passageIds: ["lead-0"] }], missingEvidence: null } } }, { provider: fakeProvider(() => ({ ...questionCheck(draft(), "insufficient_evidence"), claims: [{ claimId: "answer-claim", verdict: "contradicted", passageIds: ["lead-0"], reason: "No patients were studied." }] })) });
  assert.equal(result.failureCode, "editorial_withheld"); assert.equal(result.outcome, undefined);
});

test("invalid provider output is an honest failed phase, and usage-persistence errors remain recoverable by the runner", async () => {
  const request = articleRequest();
  const invalid = await advanceDemandPipeline({ request, state: initial(request) }, { provider: fakeProvider(() => ({})) });
  assert.equal(invalid.failureCode, "provider_invalid"); assert.equal(invalid.outcome, undefined);
  const observed = { providerResponseId: "observed-response", model: "gpt-5.6-terra", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 };
  await assert.rejects(advanceDemandPipeline({ request, state: initial(request) }, { provider: async () => { throw new DemandUsagePersistenceError(observed); } }), (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage.providerResponseId === "observed-response");
});

test("a terminal ready article with a failed material check cannot be accepted on replay", async () => {
  const request = articleRequest(); let calls = 0;
  const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "ready", draft: draft(), check: check(draft(), "repair") } }, { provider: fakeProvider(() => { calls++; return {}; }) });
  assert.equal(result.state.phase, "failed"); assert.equal(result.outcome, undefined); assert.equal(calls, 0);
});

test("ready replay rejects empty or mismatched article claim checks without calling a provider", async () => {
  const request = articleRequest(); let calls = 0;
  for (const claims of [[], [{ claimId: "unrelated", verdict: "supported" as const, passageIds: ["lead-0"], reason: "Wrong claim" }]]) {
    const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "ready", draft: draft(), check: { ...check(), claims } } },
      { provider: fakeProvider(() => { calls++; return {}; }) });
    assert.equal(result.failureCode, "editorial_withheld"); assert.equal(result.outcome, undefined);
  }
  assert.equal(calls, 0);
});

test("ready article replay rejects a missing surface audit or changed actual prose without new provider work", async () => {
  const request = articleRequest(); let calls = 0;
  const original = draft();
  const audited = check(original);
  const missingAudit = structuredClone(audited);
  delete missingAudit.surfaceChecks;
  const changedProse = structuredClone(original);
  changedProse.article!.body[0].text += " The circuit has already cured patients.";
  const dependencies = { provider: fakeProvider(() => { calls++; return {}; }) };
  const valid = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "ready", draft: original, check: audited } }, dependencies);
  assert.equal(valid.outcome, "article", "the unchanged fully audited snapshot remains publishable");
  for (const snapshot of [{ draft: original, check: missingAudit }, { draft: changedProse, check: audited }]) {
    const result = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "ready", ...snapshot } }, dependencies);
    assert.equal(result.failureCode, "editorial_withheld");
    assert.equal(result.outcome, undefined);
  }
  assert.equal(calls, 0);
});

test("ready answer replay revalidates the exact saved answer and its evidence coverage", async () => {
  const request = row("question", { question: { question: "Was clinical efficacy tested?", articleVersion: "immutable-article-1", draft: draft(), evidence: evidence(), previousMessages: [] } });
  const answer = { status: "answered" as const, answer: "Clinical efficacy was not tested.", claims: [{ id: "answer-claim", text: "Clinical efficacy was not tested.", locations: ["answer"], passageIds: ["lead-0"] }], missingEvidence: null };
  const accepted = { ...questionCheck(), claims: [{ claimId: "answer-claim", verdict: "supported" as const, passageIds: ["lead-0"], reason: "Explicit source limitation" }] };
  let calls = 0;
  const deps = { provider: fakeProvider(() => { calls++; return {}; }) };
  const replay = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "ready", answer, check: accepted } }, deps);
  assert.equal(replay.outcome, "question");
  const missing = await advanceDemandPipeline({ request, state: { ...initial(request), phase: "ready", answer, check: { ...accepted, claims: [] } } }, deps);
  assert.equal(missing.failureCode, "editorial_withheld"); assert.equal(missing.outcome, undefined);
  assert.equal(calls, 0);
});
