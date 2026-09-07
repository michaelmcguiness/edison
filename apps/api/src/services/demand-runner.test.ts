import assert from "node:assert/strict";
import test from "node:test";
import { ON_DEMAND_PROMPT_VERSION, READER_FIRST_PROMPT_VERSION } from "@edison/ai";
import {
  demandCheckpoint,
  demandFailureReplayCheckpoint,
  demandIdeaDisplay,
  demandProgressCompatibilityFailure,
  demandRunnerFailure,
  demandVisibleStage,
  initialDemandState,
} from "./demand-runner";
import { LoopPrincipleError } from "@edison/domain";
import type { ReaderFirstPipelineState } from "./reader-first-pipeline";

test("approved idea display trims the E11 trailing-space form without rewriting its exact brief or checkpoint", () => {
  // Constructed wording reproduces the shape of request
  // 93b448ca-95ae-49fb-8024-0f6435c4d6aa; no provider call or saved-row mutation.
  const brief = Object.freeze({ id: "batch:drug-manufacturing", key: "drug-manufacturing", loopId: "loop-1", loopRevision: 1,
    headline: " How cells make medicines ", deck: "A cell can make a useful molecule. ",
    readerQuestion: "How does a cell make a useful molecule?", payoff: "Understand the mechanism.",
    advanceBeyondPrevious: "A first explanation.", qualifications: [], passageIds: ["p1"] });
  Object.freeze(brief.passageIds);
  const state: ReaderFirstPipelineState = { version: 2, phase: "ideas_check", ideas: [brief],
    requestId: "request-1", requestFingerprint: "a".repeat(64), kind: "ideas", models: { article: "injected", utility: "injected" } };
  const before = JSON.stringify(state); const checkpoint = demandCheckpoint(state);
  assert.deepEqual(demandIdeaDisplay(brief), { title: "How cells make medicines", deck: "A cell can make a useful molecule." });
  assert.equal(JSON.stringify(state), before); assert.equal(demandCheckpoint(state), checkpoint);
  assert.equal(brief.deck.endsWith(" "), true, "approved text remains byte-for-byte preserved");
});

test("idea display rejects empty or over-bound text deterministically instead of relying on a database error or truncation", () => {
  assert.deepEqual(demandIdeaDisplay({ headline: ` ${"h".repeat(180)} `, deck: ` ${"d".repeat(500)} ` }),
    { title: "h".repeat(180), deck: "d".repeat(500) });
  for (const idea of [
    { headline: "   ", deck: "Valid deck" }, { headline: "Valid title", deck: "\t\n " },
    { headline: "h".repeat(181), deck: "Valid deck" }, { headline: "Valid title", deck: "d".repeat(501) },
  ]) {
    assert.throws(() => demandIdeaDisplay(idea), (error: unknown) =>
      error instanceof Error && error.message === "provider_invalid" && demandRunnerFailure(error) === "provider_invalid");
  }
});

test("idea display preserves internal whitespace, punctuation and factual wording", () => {
  const idea = { headline: "\tCan a cell  make medicine?\n", deck: "\nOne example—not every cell.\nA limitation remains.\t" };
  assert.deepEqual(demandIdeaDisplay(idea), { title: "Can a cell  make medicine?", deck: "One example—not every cell.\nA limitation remains." });
});

test("a durable checkpoint distinguishes repeated retrieval phases and preserves canonical replay", () => {
  const first = { version: 1 as const, phase: "retrieve", retrieval: { nextSourceIndex: 0, failures: [] } };
  const next = { ...first, retrieval: { nextSourceIndex: 4, failures: [] } };
  assert.match(demandCheckpoint(first), /^retrieve:[a-f0-9]{64}$/);
  assert.notEqual(demandCheckpoint(first), demandCheckpoint(next));
  assert.equal(demandCheckpoint(first), demandCheckpoint({
    retrieval: { failures: [], nextSourceIndex: 0 }, phase: "retrieve", version: 1 as const,
  }));
});

test("durable internal phases map to truthful reader-visible stages", () => {
  assert.equal(demandVisibleStage("research"), "researching");
  assert.equal(demandVisibleStage("retrieve"), "researching");
  assert.equal(demandVisibleStage("ideas_check"), "checking-ideas");
  assert.equal(demandVisibleStage("repair"), "repairing");
  assert.equal(demandVisibleStage("recheck"), "checking");
  assert.equal(demandVisibleStage("ready"), "ready");
  assert.equal(demandVisibleStage("ideas"), "queued");
  assert.equal(demandVisibleStage("answer_repair"), "repairing");
  assert.equal(demandVisibleStage("answer_recheck"), "checking");
});

test("reader-first requests pin their own version while historical requests retain the old pipeline", () => {
  const base = { id: "00000000-0000-4000-8000-000000000202", requestFingerprint: "b".repeat(64),
    snapshot: { version: 2, context: { loopId: "loop-2" } } };
  for (const [kind, phase] of [["ideas", "ideas"], ["article", "write"], ["question", "answer"]] as const) {
    const request = { ...base, kind };
    const state = initialDemandState(request);
    assert.equal(state.version, 2);
    assert.equal(state.snapshotVersion, 2);
    assert.equal(state.phase, phase);
    assert.equal(state.promptVersion, READER_FIRST_PROMPT_VERSION);
    assert.equal(demandProgressCompatibilityFailure(request, state), null);
    assert.equal(demandProgressCompatibilityFailure(request, { ...state, promptVersion: ON_DEMAND_PROMPT_VERSION }),
      "pipeline_version_unsupported");
    assert.equal(demandProgressCompatibilityFailure({ ...request, snapshot: { ...base.snapshot, version: 1 } }, state),
      "pipeline_version_unsupported");
    assert.equal(demandProgressCompatibilityFailure({ ...request, requestFingerprint: "c".repeat(64) }, state),
      "pipeline_state_invalid");
  }
  const feedback = { ...base, kind: "feedback" as const };
  assert.equal(demandProgressCompatibilityFailure(feedback, initialDemandState(feedback)), "pipeline_version_unsupported");
  const historicalFeedback = { ...feedback, snapshot: { ...base.snapshot, version: 1 } };
  assert.equal(demandProgressCompatibilityFailure(historicalFeedback, initialDemandState(historicalFeedback)), null);
});

test("reader-first repeated retrieval checkpoints bind exact progress and failure replay preserves the newer one", () => {
  const state = initialDemandState({ id: "00000000-0000-4000-8000-000000000203", kind: "article",
    requestFingerprint: "c".repeat(64), snapshot: { version: 2, context: { loopId: "loop-3" } } });
  const acquisition = { research: { sources: [], passages: [] }, after: "check" as const,
    failures: [], queries: [], qualifications: [], nextSourceIndex: 0 };
  const earlier = { ...state, phase: "retrieve", acquisition };
  const current = { ...state, phase: "retrieve", acquisition: { ...acquisition, nextSourceIndex: 4 } };
  assert.notEqual(demandCheckpoint(earlier), demandCheckpoint(current));
  assert.equal(demandFailureReplayCheckpoint("running", current, demandCheckpoint(earlier)), demandCheckpoint(current));
  assert.equal(demandFailureReplayCheckpoint("running", current, demandCheckpoint(current)), null);
});

test("principle limits and stale revisions are deterministic failures, not paid worker retries", () => {
  assert.equal(demandRunnerFailure(new LoopPrincipleError("limit_exceeded")), "loop_context_full");
  assert.equal(demandRunnerFailure(new LoopPrincipleError("stale_revision")), "loop_changed");
  assert.equal(demandRunnerFailure(new Error("private provider response")), "worker_interrupted");
});

test("initial progress pins request snapshot, pipeline, prompt and model identity", () => {
  const request = {
    id: "00000000-0000-4000-8000-000000000201",
    kind: "ideas" as const,
    requestFingerprint: "a".repeat(64),
    snapshot: { version: 1, context: { loopId: "loop-1" } },
  };
  const state = initialDemandState(request);
  assert.equal(state.version, 1);
  assert.equal(state.snapshotVersion, 1);
  assert.equal(state.promptVersion, ON_DEMAND_PROMPT_VERSION);
  assert.match(String(state.snapshotFingerprint), /^[a-f0-9]{64}$/);
  assert.equal(demandProgressCompatibilityFailure(request, state), null);

  assert.equal(demandProgressCompatibilityFailure(request, {
    ...state,
    promptVersion: "older-prompt",
  }), "pipeline_version_unsupported");
  assert.equal(demandProgressCompatibilityFailure({
    ...request,
    snapshot: { ...request.snapshot, context: { loopId: "changed" } },
  }, state), "pipeline_state_invalid");
  assert.equal(demandProgressCompatibilityFailure({
    ...request,
    snapshot: { ...request.snapshot, version: 2 },
  }, state), "pipeline_version_unsupported");
});

test("failure settlement replays a committed newer checkpoint instead of overwriting it", () => {
  const earlier = { version: 1 as const, phase: "research" };
  const current = { version: 1 as const, phase: "retrieve", retrieval: { nextSourceIndex: 0, failures: [] } };
  const currentCheckpoint = demandCheckpoint(current);

  assert.equal(
    demandFailureReplayCheckpoint("running", current, demandCheckpoint(earlier)),
    currentCheckpoint,
  );
  assert.equal(
    demandFailureReplayCheckpoint("running", current, undefined),
    currentCheckpoint,
  );
  assert.equal(
    demandFailureReplayCheckpoint("running", current, currentCheckpoint),
    null,
  );
  assert.equal(
    demandFailureReplayCheckpoint("queued", current, undefined),
    null,
  );
});
