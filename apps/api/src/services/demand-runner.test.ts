import assert from "node:assert/strict";
import test from "node:test";
import { ON_DEMAND_PROMPT_VERSION } from "@edison/ai";
import {
  demandCheckpoint,
  demandFailureReplayCheckpoint,
  demandProgressCompatibilityFailure,
  demandRunnerFailure,
  demandVisibleStage,
  initialDemandState,
} from "./demand-runner";
import { LoopPrincipleError } from "@edison/domain";

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
