import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OPTIONS } from "../../app/v1/demand/[...path]/route";
import {
  demandRecoveryDecision,
  isStaleDemandClaim,
  isRetryableDemandFailure,
  matchDemandRoute,
  shouldExhaustDemandDispatch,
} from "./demand-dispatch";

const requestId = "00000000-0000-4000-8000-000000000101";

test("the demand API matches only the same bounded paths exposed by the web relay", () => {
  assert.deepEqual(matchDemandRoute("POST", ["session"]), { kind: "session" });
  assert.deepEqual(matchDemandRoute("GET", ["workspace"]), { kind: "workspace" });
  assert.deepEqual(matchDemandRoute("POST", ["loops"]), { kind: "create-loop" });
  assert.deepEqual(matchDemandRoute("POST", ["loops", requestId, "ideas"]), {
    kind: "ideas",
    loopId: requestId,
  });
  assert.deepEqual(matchDemandRoute("POST", ["loops", requestId, "feedback"]), {
    kind: "feedback",
    loopId: requestId,
  });
  assert.deepEqual(matchDemandRoute("POST", ["ideas", requestId, "article"]), {
    kind: "article",
    ideaId: requestId,
  });
  assert.deepEqual(matchDemandRoute("POST", ["ideas", requestId, "questions"]), {
    kind: "questions",
    ideaId: requestId,
  });
  assert.deepEqual(matchDemandRoute("PUT", ["ideas", requestId, "events"]), {
    kind: "events",
    ideaId: requestId,
  });
  assert.deepEqual(matchDemandRoute("GET", ["requests", requestId]), {
    kind: "result",
    requestId,
  });
  assert.deepEqual(matchDemandRoute("POST", ["requests", requestId, "retry"]), {
    kind: "retry",
    requestId,
  });

  for (const [method, path] of [
    ["GET", ["session"]],
    ["POST", ["workspace"]],
    ["DELETE", ["loops", requestId]],
    ["POST", ["loops", "not-a-uuid", "ideas"]],
    ["POST", ["requests", requestId, "../retry"]],
    ["GET", ["requests", requestId, "extra"]],
    ["POST", ["admin", "jobs"]],
  ] as const) {
    assert.equal(matchDemandRoute(method, path), null);
  }
});

test("preflight uses the public API security envelope without resolving a reader", async () => {
  const response = await OPTIONS(new Request("https://api.example.test/v1/demand/workspace", {
    method: "OPTIONS",
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("only failures known to precede or safely resume provider work are retryable", () => {
  assert.equal(isRetryableDemandFailure("workflow_dispatch_failed"), true);
  assert.equal(isRetryableDemandFailure("worker_interrupted"), true);
  for (const code of [null, "provider_uncertain", "provider_invalid", "editorial_withheld", "budget_exhausted"]) {
    assert.equal(isRetryableDemandFailure(code), false);
  }
});

test("attempt exhaustion never cancels a live dispatch lease", () => {
  const now = new Date("2026-09-06T18:00:00.000Z");
  const exhausted = {
    status: "queued",
    attempts: 3,
    nextAttemptAt: new Date("2026-09-06T17:59:00.000Z"),
    leaseExpiresAt: new Date("2026-09-06T17:59:59.000Z"),
  };
  assert.equal(shouldExhaustDemandDispatch(exhausted, now), true);
  assert.equal(shouldExhaustDemandDispatch({
    ...exhausted,
    leaseExpiresAt: new Date("2026-09-06T18:01:00.000Z"),
  }, now), false);
  assert.equal(shouldExhaustDemandDispatch({
    ...exhausted,
    nextAttemptAt: new Date("2026-09-06T18:01:00.000Z"),
  }, now), false);
});

test("stale workflow claims fail closed around provider-stage evidence", () => {
  const now = new Date("2026-09-06T18:00:00.000Z");
  assert.equal(demandRecoveryDecision(false, [], now), "reading_session_expired");
  assert.equal(demandRecoveryDecision(true, [], now), "worker_interrupted");
  assert.equal(demandRecoveryDecision(true, [{
    status: "succeeded",
    leaseExpiresAt: null,
  }], now), "worker_interrupted");
  assert.equal(demandRecoveryDecision(true, [{
    status: "reserved",
    leaseExpiresAt: new Date("2026-09-06T18:01:00.000Z"),
  }], now), "skip");
  for (const stage of [
    { status: "reserved" as const, leaseExpiresAt: null },
    {
      status: "reserved" as const,
      leaseExpiresAt: new Date("2026-09-06T17:59:00.000Z"),
    },
    { status: "uncertain" as const, leaseExpiresAt: null },
  ]) {
    assert.equal(demandRecoveryDecision(true, [stage], now), "provider_uncertain");
  }
  assert.equal(demandRecoveryDecision(true, [{
    status: "failed",
    leaseExpiresAt: null,
  }], now), "provider_invalid");
});

test("only expired exact workflow claims are stale", () => {
  const now = new Date("2026-09-06T18:00:00.000Z");
  const request = {
    id: requestId,
    principalId: "00000000-0000-4000-8000-000000000102",
    status: "queued" as const,
    workflowRunId: "run-1",
    leaseExpiresAt: new Date("2026-09-06T17:59:59.000Z"),
    updatedAt: new Date("2026-09-06T17:59:00.000Z"),
  };
  assert.equal(isStaleDemandClaim(request, now), true);
  assert.equal(isStaleDemandClaim({
    ...request,
    leaseExpiresAt: new Date("2026-09-06T18:00:01.000Z"),
  }, now), false);
  assert.equal(isStaleDemandClaim({
    ...request,
    leaseExpiresAt: null,
    updatedAt: new Date("2026-09-06T17:54:59.000Z"),
  }, now), true);
  assert.equal(isStaleDemandClaim({
    ...request,
    leaseExpiresAt: null,
    updatedAt: new Date("2026-09-06T17:55:01.000Z"),
  }, now), false);
  assert.equal(isStaleDemandClaim({
    ...request,
    workflowRunId: null,
  }, now), false);
  assert.equal(isStaleDemandClaim({
    ...request,
    status: "succeeded",
  }, now), false);
});

test("dispatch source preserves the durable ownership and no-provider-replay barriers", () => {
  const source = readFileSync(new URL("./demand-dispatch.ts", import.meta.url), "utf8");
  const claim = source.indexOf("private.demand_principal_is_active");
  const start = source.indexOf("start(onDemandReadingWorkflow");
  assert.ok(claim >= 0 && claim < start);
  assert.match(source, /attempts:\s*sql`\$\{demandRequests\.attempts\} \+ 1`/);
  assert.match(source, /lt\(demandRequests\.attempts, MAX_DISPATCH_ATTEMPTS\)/);
  assert.match(source, /eq\(demandRequests\.leaseExpiresAt, leaseExpiresAt\)/);
  assert.match(source, /inArray\(demandStages\.status, \["reserved", "failed", "uncertain"\]\)/);

  const saveStart = source.indexOf("const saved = await withDemandWorkerDb");
  const saveEnd = source.indexOf("if (saved?.workflowRunId)", saveStart);
  const save = source.slice(saveStart, saveEnd);
  assert.match(save, /workflowRunId:\s*runId/);
  assert.doesNotMatch(save, /leaseExpiresAt:\s*null/);

  const settleStart = source.indexOf("async function settleStaleDemandClaim");
  const reconcileStart = source.indexOf("export async function reconcileDemandRequests");
  const settle = source.slice(settleStart, reconcileStart);
  assert.match(settle, /eq\(demandRequests\.workflowRunId, current\.workflowRunId!\)/);
  assert.match(settle, /eq\(demandRequests\.leaseExpiresAt, current\.leaseExpiresAt\)/);
  assert.match(settle, /status:\s*"uncertain"/);

  const retryStart = source.indexOf("export async function retryDemandRequest");
  const retryEnd = source.indexOf("export async function reconcileDemandRequests");
  const retry = source.slice(retryStart, retryEnd);
  assert.doesNotMatch(retry, /snapshot:\s*(?:null|\{)/);
  assert.doesNotMatch(retry, /progress:\s*(?:null|\{)/);
  assert.doesNotMatch(retry, /result:\s*(?:null|\{)/);
});
