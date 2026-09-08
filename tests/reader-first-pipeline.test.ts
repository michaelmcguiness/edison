import assert from "node:assert/strict";
import test from "node:test";
import {
  READER_FIRST_CHECKER_CONTRACT_VERSION,
  type OnDemandContext, type OnDemandEvidence, type OnDemandProvider, type OnDemandProviderRequest,
  type ReaderFirstWriterOutput,
} from "../packages/ai/src/index";
import { initialDemandState } from "../apps/api/src/services/demand-runner";
import { advanceReaderFirstPipeline, readerFirstQuestion, type ReaderFirstPipelineState } from "../apps/api/src/services/reader-first-pipeline";
import type { DemandRequestRow } from "../apps/api/src/services/demand-reading";
import type { retrieveEvidencePage } from "../apps/api/src/services/evidence-retrieval";
import { prepareDemandStage } from "../apps/api/src/services/demand-provider-stages";

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

test("article and Ask checkpoint replay retain their pinned checker and sole repair with unchanged author stages", async () => {
  for (const kind of ["article", "question"] as const) {
    for (const firstVerdict of ["pass", "repair", "insufficient_evidence"] as const) {
      const identities: ReturnType<typeof prepareDemandStage>["identity"][][] = [];
      for (const current of [false, true]) {
        const request = row(kind, current ? { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION } : {});
        const snapshotBefore = structuredClone(request.snapshot);
        let state = initialDemandState(request) as ReaderFirstPipelineState;
        const calls: OnDemandProviderRequest[] = [];
        const provider = fake((call) => {
          if (call.stage !== "check") return kind === "article" ? rawArticle() : rawAnswer();
          const first = calls.filter((entry) => entry.stage === "check").length === 1;
          const check = { ...checked(call), verdict: first ? firstVerdict : "pass",
            verificationPassed: !first || firstVerdict === "pass", findings: [] };
          return current ? { check } : check;
        }, calls, false);
        const phases: string[] = [];
        let outcome: string | undefined;
        for (let steps = 0; steps < 6; steps++) {
          state = JSON.parse(JSON.stringify(state)) as ReaderFirstPipelineState;
          assert.equal(Object.hasOwn(state, "checkerContractVersion"), current);
          assert.equal(state.checkerContractVersion, current ? READER_FIRST_CHECKER_CONTRACT_VERSION : undefined);
          phases.push(state.phase);
          const result = await advanceReaderFirstPipeline({ request, state }, { provider,
            retrievePage: async () => { throw new Error("Unexpected retrieval for this constructed stable fixture"); } });
          assert.equal(result.failureCode, undefined);
          state = result.state;
          if (result.outcome) { outcome = result.outcome; break; }
        }
        assert.equal(outcome, kind);
        assert.deepEqual(phases, kind === "article"
          ? firstVerdict === "pass" ? ["write", "check"] : ["write", "check", "repair", "recheck"]
          : firstVerdict === "pass" ? ["answer", "answer_check"] : ["answer", "answer_check", "answer_repair", "answer_recheck"]);
        assert.equal(state.repairAttempted, firstVerdict !== "pass");
        if (firstVerdict !== "pass") {
          assert.equal(calls[2].researchPolicy?.mode, "required");
          assert.deepEqual((calls[2].input as { check: { findings: unknown[] } }).check.findings, [],
            "Non-pass outputs do not acquire an artificial minimum finding count");
        }
        assert.deepEqual(request.snapshot, snapshotBefore);
        const ready = await advanceReaderFirstPipeline({ request, state: JSON.parse(JSON.stringify(state)) }, {
          provider: fake(() => { throw new Error("Ready replay must not dispatch another provider call"); }),
        });
        assert.equal(ready.outcome, kind);
        identities.push(calls.map((call) => prepareDemandStage(request.id, request.principalId, call, {
          OPENAI_ARTICLE_MODEL: state.models.article, OPENAI_UTILITY_MODEL: state.models.utility,
          OPENAI_WEB_SEARCH_COST_MICROUSD: "10000",
        }).identity));
      }
      assert.equal(identities[0].length, identities[1].length);
      for (let index = 0; index < identities[0].length; index++) {
        const old = identities[0][index], current = identities[1][index];
        assert.deepEqual(current.snapshot.input, old.snapshot.input);
        assert.equal(current.stageKey, old.stageKey);
        if (old.snapshot.stage === "check") assert.notEqual(current.requestFingerprint, old.requestFingerprint);
        else assert.deepEqual(current, old, "The selector cannot change writer or repair snapshots");
      }
    }
  }
});

test("invalid retained checker markers stop before retrieval, provider dispatch, or ready publication", async () => {
  for (const kind of ["article", "question"] as const) {
    for (const phase of ["retrieve", "ready", kind === "article" ? "check" : "answer_check"]) {
      for (const alteration of ["missing-progress", "unknown-progress", "missing-snapshot", "null-snapshot"]) {
        const request = row(kind, { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION });
        const state = { ...initialDemandState(request), phase } as ReaderFirstPipelineState;
        if (alteration === "missing-progress") delete state.checkerContractVersion;
        if (alteration === "unknown-progress") state.checkerContractVersion = "unknown";
        if (alteration === "missing-snapshot") delete request.snapshot.checkerContractVersion;
        if (alteration === "null-snapshot") request.snapshot.checkerContractVersion = null;
        const before = structuredClone({ request, state });
        let dispatched = 0;
        const result = await advanceReaderFirstPipeline({ request, state }, {
          provider: fake(() => { dispatched++; return {}; }),
          retrievePage: async () => { dispatched++; throw new Error("Unexpected retrieval"); },
        });
        assert.ok(["pipeline_state_invalid", "pipeline_version_unsupported"].includes(result.failureCode ?? ""));
        assert.equal(result.outcome, undefined);
        assert.equal(dispatched, 0);
        assert.deepEqual({ request, state }, before);
      }
    }
  }
});

test("a persisted ready verdict is revalidated without dropping findings or rerunning any stage", async () => {
  for (const kind of ["article", "question"] as const) {
    for (const current of [false, true]) {
      const request = row(kind, current ? { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION } : {});
      const result = await run(request, fake((call) => {
        if (call.stage !== "check") return kind === "article" ? rawArticle() : rawAnswer();
        return current ? { check: checked(call) } : checked(call);
      }, [], false));
      assert.equal(result.outcome, kind);
      const retained = structuredClone(result.state);
      retained.check!.findings.push({ location: "body.0", excerpt: support, severity: "nonmaterial", kind: "clarity",
        reason: "A constructed optional refinement.", repair: "No material repair is needed.", passageIds: [] });
      const before = structuredClone(retained);
      let dispatched = 0;
      const replayed = await advanceReaderFirstPipeline({ request, state: retained }, {
        provider: fake(() => { dispatched++; return {}; }),
      });
      assert.equal(dispatched, 0);
      assert.equal(replayed.outcome, current ? undefined : kind);
      assert.equal(Boolean(replayed.failureCode), current);
      assert.deepEqual(replayed.state.check, before.check);
      assert.deepEqual(retained, before);
    }
  }
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

test("first and subsequent loop batches request six briefs and publish only the accepted subset without writing bodies", async () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    ...candidate, key: `control-${index + 1}`, headline: `Constructed feedback question ${index + 1}?`,
  }));
  for (const revision of [1, 2]) {
    const request = row("ideas", { context: { ...context, revision }, requestedCount: 6 });
    const calls: OnDemandProviderRequest[] = [];
    const result = await run(request, fake((call) => {
      if (call.stage === "ideas") {
        assert.equal((call.input as { requestedCount: number }).requestedCount, 6);
        return { ...empty, ideas: candidates, insufficiencyReason: null };
      }
      assert.equal(call.stage, "ideas_check");
      const input = call.input as { fingerprint: string; research: { ideas: typeof candidates } };
      assert.equal(input.research.ideas.length, 6);
      return { fingerprint: input.fingerprint, ideas: candidates.map((entry, index) => ({
        key: entry.key, verdict: "pass", premiseSupported: true, verificationRequired: false,
        verificationPassed: true, fitsLoop: index !== 1, distinctContribution: index !== 4,
        passageIds: [], reason: "Constructed acceptance flags, not a real quality judgment.",
      })) };
    }, calls, false), async () => { throw new Error("Unexpected retrieval for constructed stable briefs"); });
    assert.equal(result.outcome, "ideas");
    assert.deepEqual(calls.map((call) => call.stage), ["ideas", "ideas_check"]);
    assert.deepEqual(result.state.ideas?.map((entry) => entry.key), ["control-1", "control-3", "control-4", "control-6"]);
    assert.equal(result.state.research?.ideas.length, 6, "Retain the original proposed batch");
    assert.equal(result.state.draft, undefined, "No full articles are commissioned for an ideas batch");
    assert.ok(result.state.ideas?.every((entry) => entry.loopRevision === revision));
  }
});

test("old snapshots keep their four-title request while invalid explicit counts stop before provider dispatch", async () => {
  const calls: OnDemandProviderRequest[] = [];
  const result = await run(row("ideas"), fake((call) => {
    if (call.stage === "ideas") {
      assert.equal((call.input as { requestedCount: number }).requestedCount, 4);
      return { ...empty, ideas: [candidate], insufficiencyReason: null };
    }
    return { fingerprint: (call.input as { fingerprint: string }).fingerprint, ideas: [{
      key: candidate.key, verdict: "pass", premiseSupported: true, verificationRequired: false,
      verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [],
      reason: "A constructed historical brief remains usable without a new count.",
    }] };
  }, calls, false));
  assert.equal(result.outcome, "ideas");
  assert.equal(result.state.ideas?.length, 1);
  for (const requestedCount of [null, "6", 0, 7, 1.5, NaN, Infinity]) {
    const invalidCalls: OnDemandProviderRequest[] = [];
    const rejected = await run(row("ideas", { requestedCount }), fake(() => ({}), invalidCalls, false));
    assert.ok(rejected.failureCode);
    assert.equal(rejected.outcome, undefined);
    assert.equal(invalidCalls.length, 0, "An explicit malformed count is not coerced into an old or new batch");
  }
});

test("a current premise without required evidence is withheld even when the author offers it", async () => {
  const result = await run(row("ideas"), fake((call) => call.stage === "ideas"
    ? { ...empty, ideas: [candidate], insufficiencyReason: null }
    : { fingerprint: (call.input as { fingerprint: string }).fingerprint, ideas: [{ key: idea.key, verdict: "pass", premiseSupported: true,
      verificationRequired: true, verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "Missing actual required support." }] }));
  assert.equal(result.failureCode, "evidence_unavailable");
});

test("mixed discovery metadata preserves only consulted ideas through retrieval and independent checking", async () => {
  const unconsulted = { ...source, id: "s2", url: "https://example.org/new-study" };
  const output = { sources: [{ ...source, datePrecision: "year", publishedDate: "2026-09-07" }, unconsulted],
    passages: [...research.passages, { id: "lead2", sourceId: "s2", text: support, locator: "Unverified model lead" }],
    ideas: [{ ...candidate, passageIds: ["lead1"] }, { ...candidate, key: "unsupported", passageIds: ["lead1", "lead2"] }],
    insufficiencyReason: null };
  const before = structuredClone(output);
  const calls: OnDemandProviderRequest[] = [];
  const base = fake((call) => {
    if (call.stage === "ideas") return output;
    assert.equal(call.stage, "ideas_check");
    const input = call.input as { fingerprint: string; research: { ideas: typeof output.ideas }; evidence: OnDemandEvidence };
    assert.deepEqual(input.research.ideas.map((entry) => entry.key), [candidate.key]);
    assert.ok(input.evidence.passages.length > 0);
    assert.ok(input.evidence.passages.every((entry) => entry.provenance === "retrieved" && entry.sourceId === "s1"));
    return { fingerprint: input.fingerprint, ideas: [{ key: candidate.key, verdict: "pass", premiseSupported: true,
      verificationRequired: true, verificationPassed: true, fitsLoop: true, distinctContribution: true,
      passageIds: input.evidence.passages.map((entry) => entry.id), reason: "Injected verdict over actually retrieved fixture text." }] };
  }, calls);
  const provider: OnDemandProvider = async (call) => ({ ...await base(call), researchProvenance: {
    consultedUrls: [source.url, `${unconsulted.url}.pdf`], openedUrls: [], citedUrls: [],
  } });
  const fetched: string[] = [];
  const result = await run(row("ideas"), provider, async (url) => { fetched.push(url); return retrieve(url); });
  assert.equal(result.outcome, "ideas");
  assert.deepEqual(result.phases, ["ideas", "retrieve", "ideas_check"]);
  assert.deepEqual(fetched, [source.url]);
  assert.deepEqual(result.state.ideas?.map((entry) => entry.key), [candidate.key]);
  assert.equal(result.state.evidence?.sources[0].publishedDate, null);
  assert.equal(result.state.evidence?.sources[0].datePrecision, "unknown");
  assert.deepEqual(output, before);
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

test("persisted JSON field order does not erase unchanged chained Ask support", () => {
  const oldTime = "2025-01-01T00:00:00.000Z";
  const old: OnDemandEvidence = { sources: [{ ...source, title: "Old title", publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: "old", sourceId: "s1", text: "An older constructed description.", locator: "Old page",
      provenance: "retrieved", retrievedAt: oldTime }] };
  const reference = { label: "1", sourceId: "00000000-0000-4000-8000-000000000705", title: "Old title",
    url: source.url, accessedAt: oldTime, evidenceSourceKey: "s1", passageIds: ["old"] };
  const request = row("question", { question: { articleVersion: ideaId, question: "What does source 1 mean?",
    draft: savedArticle(), evidence: old, previousMessages: [
      { role: "assistant", text: "The saved older explanation.", references: [reference] },
    ] } });
  const before = structuredClone(request.snapshot);
  function reordered<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).reverse()) as T;
  }
  const persisted = { passages: old.passages.map(reordered), sources: old.sources.map(reordered) };
  assert.notEqual(JSON.stringify(old.passages[0]), JSON.stringify(persisted.passages[0]));
  assert.deepEqual(readerFirstQuestion(request, persisted), readerFirstQuestion(request, old));
  const prior = readerFirstQuestion(request, persisted).previousMessages[0];
  assert.equal(prior.role, "assistant");
  assert.deepEqual(prior.role === "assistant" ? prior.references : null, [reference]);
  assert.deepEqual(request.snapshot, before);
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
