import assert from "node:assert/strict";
import test from "node:test";
import {
  compileReaderFirstAnswer, compileReaderFirstArticle, readerFirstAnswerFingerprint, readerFirstArticleFingerprint,
  READER_FIRST_PROMPT_VERSION, type OnDemandEvidence, type ReaderFirstAnswerOutput,
  type ReaderFirstCheckOutput, type ReaderFirstQuestion, type ReaderFirstSelection, type ReaderFirstWriterOutput,
} from "@edison/ai";
import { demandFingerprint } from "./demand-reading";
import { demandCheckpoint, demandProgressCompatibilityFailure, initialDemandState } from "./demand-runner";
import { publishReaderFirstAnswer, publishReaderFirstArticle } from "./reader-first-publication";

// Constructed inputs and judgments exercise the persisted compatibility and
// final publication boundaries. No provider, database or private packet is used.
const CHECKER = "edison-reader-first-v2.5-check-v1";
const ABSENT = Symbol("frozen legacy checker");
const articleId = "00000000-0000-4000-8000-000000000951";
const answerId = "00000000-0000-4000-8000-000000000952";
const prose = "A thermostat compares a temperature reading with a target.";
const empty: OnDemandEvidence = { sources: [], passages: [] };
type Identity = Parameters<typeof initialDemandState>[0];
type State = ReturnType<typeof initialDemandState>;
type Mode = "article" | "answer";
const phases = {
  article: ["write", "retrieve", "check", "repair", "recheck", "ready", "failed"],
  question: ["answer", "retrieve", "answer_check", "answer_repair", "answer_recheck", "ready", "failed"],
};

function identity(kind: Identity["kind"], marker: unknown = ABSENT, version = 2): Identity {
  return { id: articleId, kind, requestFingerprint: "a".repeat(64), snapshot: {
    version, context: { loopId: "constructed-checker-loop", literal: "Preserve this admitted context. " },
    ...(marker === ABSENT ? {} : { checkerContractVersion: marker }),
  } };
}

for (const kind of ["article", "question"] as const) {
  test(`${kind}: frozen legacy and admission-pinned current checker remain compatible in every retained phase`, () => {
    for (const marker of [ABSENT, CHECKER]) {
      const request = identity(kind, marker); const before = structuredClone(request);
      const initial = initialDemandState(request);
      assert.equal(initial.promptVersion, READER_FIRST_PROMPT_VERSION);
      assert.equal(initial.promptVersion, "edison-reader-first-v2.5", "checker correction does not relabel the global prompt");
      assert.equal(initial.snapshotFingerprint, demandFingerprint(request.snapshot));
      if (marker === ABSENT) assert.equal(Object.hasOwn(initial, "checkerContractVersion"), false);
      else assert.equal(initial.checkerContractVersion, CHECKER);
      for (const phase of phases[kind]) {
        const saved = { ...initial, phase, repairAttempted: phase.includes("recheck") };
        const original = structuredClone(saved); const checkpoint = demandCheckpoint(saved);
        assert.equal(demandProgressCompatibilityFailure(request, saved), null, `${String(marker)} ${phase}`);
        assert.deepEqual(saved, original); assert.equal(demandCheckpoint(saved), checkpoint);
      }
      assert.deepEqual(request, before, "admission snapshots are never upgraded in place");
    }
  });

  test(`${kind}: checker marker addition, removal and replacement cannot silently change saved replay`, () => {
    for (const marker of [ABSENT, CHECKER]) for (const phase of phases[kind]) {
      const request = identity(kind, marker);
      const state = { ...initialDemandState(request), phase };
      const mutations: Array<(input: Identity, progress: State) => void> = [
        (_input, progress) => { progress.checkerContractVersion = marker === ABSENT ? CHECKER : "unknown-checker"; },
        (_input, progress) => { progress.checkerContractVersion = null; },
        (input, progress) => {
          if (marker === ABSENT) input.snapshot.checkerContractVersion = CHECKER;
          else delete input.snapshot.checkerContractVersion;
          progress.snapshotFingerprint = demandFingerprint(input.snapshot);
        },
      ];
      if (marker !== ABSENT) mutations.push((_input, progress) => { delete progress.checkerContractVersion; });
      for (const mutate of mutations) {
        const input = structuredClone(request); const progress = structuredClone(state); mutate(input, progress);
        const before = structuredClone({ input, progress });
        assert.notEqual(demandProgressCompatibilityFailure(input, progress), null, `${String(marker)} ${phase}`);
        assert.deepEqual({ input, progress }, before, "rejection preserves the original saved bytes");
      }
    }
  });
}

test("null, unknown and unsupported-kind/version checker markers fail even when snapshot and progress agree", () => {
  for (const marker of [null, "", "edison-reader-first-v2.5-check-v999", 1, {}, []]) {
    for (const kind of ["article", "question"] as const) {
      const request = identity(kind, marker); const state = initialDemandState(request);
      const before = structuredClone({ request, state });
      assert.notEqual(demandProgressCompatibilityFailure(request, state), null);
      assert.deepEqual({ request, state }, before);
    }
  }
  for (const [kind, version] of [["ideas", 2], ["feedback", 2], ["article", 1], ["question", 1], ["article", 3]] as const) {
    const request = identity(kind, CHECKER, version); const state = initialDemandState(request);
    assert.notEqual(demandProgressCompatibilityFailure(request, state), null, `${kind} v${version}`);
  }
  for (const kind of ["ideas", "feedback", "article", "question"] as const) {
    const request = identity(kind, ABSENT, 1);
    assert.equal(demandProgressCompatibilityFailure(request, initialDemandState(request)), null, `unchanged v1 ${kind}`);
  }
});

function fixture(evidence: OnDemandEvidence = empty) {
  const selection: ReaderFirstSelection = {
    context: { loopId: "checker-loop", revision: 1, originalCuriosity: "How do thermostats work?", directions: [],
      declaredKnowledge: [], readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-08" },
    idea: { id: "checker-idea", key: "control", loopId: "checker-loop", loopRevision: 1,
      headline: "How does a thermostat control heat?", deck: "Follow an everyday feedback example.",
      readerQuestion: "What is compared?", payoff: "Distinguish a reading from its target.",
      advanceBeyondPrevious: "A first feedback explanation.", qualifications: [], passageIds: [] },
    evidence: structuredClone(evidence),
  };
  const raw: ReaderFirstWriterOutput = { status: "written", reason: null, research: structuredClone(empty), article: {
    category: "tech-science", kicker: "Feedback", topic: "Thermostats", title: selection.idea.headline, deck: selection.idea.deck,
    summary: ["Read a temperature.", "Compare it with a target.", "Adjust the heat."], whyWritten: "An everyday example explains feedback.",
    readingMinutes: 1, body: [{ type: "paragraph", text: prose, citations: evidence.sources.map((source) => ({ sourceKey: source.id, label: "Constructed source" })) }],
    sources: evidence.sources.map((source) => ({ key: source.id, title: source.title, url: source.url, publisher: source.publisher, publishedAt: null })),
  } };
  const draft = compileReaderFirstArticle(selection, raw);
  const question: ReaderFirstQuestion = { context: selection.context, evidence: selection.evidence, draft,
    articleVersion: articleId, question: "What does the reading tell us?", previousMessages: [] };
  const answer: ReaderFirstAnswerOutput = compileReaderFirstAnswer(question, { status: "answered", reason: null,
    research: structuredClone(empty), body: structuredClone(draft.article!.body), sources: structuredClone(draft.article!.sources) });
  return { selection, draft, question, answer };
}

function passed(fingerprint: string): ReaderFirstCheckOutput {
  return { fingerprint, verdict: "pass", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    readerFit: true, continuity: true, privacyPassed: true, findings: [] };
}
function nonmaterial(): ReaderFirstCheckOutput["findings"][number] {
  return { location: "body.0", excerpt: prose, severity: "nonmaterial", kind: "clarity",
    reason: "A shorter sentence might read more smoothly.", repair: "Consider a shorter sentence.", passageIds: [] };
}
function checkFor(mode: Mode, data: ReturnType<typeof fixture>) {
  return passed(mode === "article" ? readerFirstArticleFingerprint(data.selection, data.draft) : readerFirstAnswerFingerprint(data.question, data.answer));
}
function publish(mode: Mode, data: ReturnType<typeof fixture>, check: ReaderFirstCheckOutput, marker: unknown = ABSENT) {
  // Deliberately include invalid runtime markers in the negative cases.
  const checker = marker === ABSENT ? {} : { checkerContractVersion: marker as typeof CHECKER };
  return mode === "article" ? publishReaderFirstArticle({ requestId: articleId, selection: data.selection, draft: data.draft, check, ...checker })
    : publishReaderFirstAnswer({ requestId: answerId, question: data.question, answer: data.answer, check, ...checker });
}

for (const mode of ["article", "answer"] as const) {
  test(`${mode}: current clean-pass publication is repeatable, while legitimate frozen legacy refinements remain valid`, () => {
    const data = fixture(); const check = checkFor(mode, data); const before = structuredClone({ data, check });
    const legacy = publish(mode, data, check); const current = publish(mode, data, check, CHECKER);
    assert.deepEqual(current, legacy, "checker format does not alter reader content or identity");
    assert.deepEqual(publish(mode, data, check, CHECKER), current);
    assert.deepEqual({ data, check }, before);
    const note = { ...check, findings: [nonmaterial()] }; const noteBefore = structuredClone(note);
    assert.doesNotThrow(() => publish(mode, data, note));
    assert.throws(() => publish(mode, data, note, CHECKER), /editorial_withheld/);
    assert.deepEqual(note, noteBefore, "a new pass never becomes clean by dropping returned findings");
    for (const marker of [null, "unknown-checker"]) assert.throws(() => publish(mode, data, check, marker), /editorial_withheld/);
  });

  test(`${mode}: both versions withhold material concerns, failed assessments, invalid text anchors and invented evidence`, () => {
    const data = fixture(); const check = checkFor(mode, data);
    const invalid: ReaderFirstCheckOutput[] = [
      { ...check, findings: [{ ...nonmaterial(), severity: "material" }] },
      { ...check, findings: [{ ...nonmaterial(), kind: "verification_required", severity: "material" }] },
      { ...check, findings: [{ ...nonmaterial(), excerpt: "This text appears nowhere in the checked artifact." }] },
      { ...check, findings: [{ ...nonmaterial(), location: mode === "article" ? "deck" : "body.99" }] },
      { ...check, findings: [{ ...nonmaterial(), passageIds: ["invented-passage"] }] },
      { ...check, fingerprint: "0".repeat(64) },
      ...(["accuracyPassed", "verificationPassed", "promiseFulfilled", "readerFit", "continuity", "privacyPassed"] as const)
        .map((flag) => ({ ...check, [flag]: false })),
    ];
    for (const marker of [ABSENT, CHECKER]) for (const output of invalid) {
      const before = structuredClone({ data, output });
      assert.throws(() => publish(mode, data, output, marker), /editorial_withheld/);
      assert.deepEqual({ data, output }, before);
    }
  });

  test(`${mode}: the current final publication gate still binds the exact text, evidence and reading context`, () => {
    const original = fixture(); const check = checkFor(mode, original);
    const changes: Array<(data: ReturnType<typeof fixture>) => void> = mode === "article" ? [
      (data) => { data.draft.article!.body[0].text += " An unchecked assertion."; },
      (data) => { data.selection.context.readingPreferences.push("Different instruction"); },
      (data) => { data.selection.idea.payoff = "A different promise."; },
    ] : [
      (data) => { data.answer.body[0].text += " An unchecked assertion."; },
      (data) => { data.question.question = "A different question?"; },
      (data) => { data.question.articleVersion = "another-version"; },
      (data) => { data.question.previousMessages.push({ role: "user", text: "A different conversation." }); },
      (data) => { data.question.draft.article!.body[0].text += " Changed source article."; },
    ];
    for (const change of changes) {
      const data = structuredClone(original); change(data); const before = structuredClone(data);
      assert.throws(() => publish(mode, data, check, CHECKER), /editorial_withheld/); assert.deepEqual(data, before);
    }
  });

  test(`${mode}: a fresh fingerprint cannot turn model-reported evidence into independently retrieved support`, () => {
    const evidence: OnDemandEvidence = {
      sources: [{ id: "s1", title: "Constructed feedback reference", url: "https://reference.example.org/feedback",
        publisher: "reference.example.org", publishedDate: null, datePrecision: "unknown" }],
      passages: [{ id: "p1", sourceId: "s1", text: prose, locator: "Constructed example", provenance: "retrieved", retrievedAt: "2026-09-08T12:00:00.000Z" }],
    };
    const data = fixture(evidence);
    assert.doesNotThrow(() => publish(mode, data, checkFor(mode, data), CHECKER));
    data.selection.evidence.passages[0].provenance = "model_reported";
    data.selection.evidence.passages[0].retrievedAt = null;
    const before = structuredClone(data);
    for (const marker of [ABSENT, CHECKER]) assert.throws(() => publish(mode, data, checkFor(mode, data), marker), /editorial_withheld/);
    assert.deepEqual(data, before);
  });
}
