import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  demandPrincipals,
  demandRequests,
  demandStages,
  withDemandWorkerDb,
} from "@edison/db";
import { uuidSchema } from "@edison/contracts";
import { start } from "workflow/api";
import { onDemandReadingWorkflow } from "../../workflows/on-demand-reading";
import { HttpError } from "../http/errors";
import { safeCaughtErrorMetadata } from "../observability/safe-error";
import { assertDemandAdmissionCapacity, lockDemandAdmission } from "./demand-admission";
import { loadDemandCheckRecovery } from "./demand-check-recovery";
import type { DemandRequestRow } from "./demand-reading";

const DISPATCH_LEASE_MS = 5 * 60 * 1000;
const DISPATCH_RETRY_MS = 60 * 1000;
const MAX_DISPATCH_ATTEMPTS = 3;
const DEFAULT_RECONCILE_LIMIT = 25;
const MAX_RECONCILE_LIMIT = 100;

const retryableFailureCodes = new Set([
  "workflow_dispatch_failed",
  "worker_interrupted",
]);

export type DemandDispatchResult =
  | { outcome: "dispatched"; runId: string }
  | { outcome: "already-dispatched"; runId: string }
  | { outcome: "retry-scheduled" }
  | { outcome: "exhausted" }
  | { outcome: "skipped" };

export type DemandRoute =
  | { kind: "session" }
  | { kind: "workspace" }
  | { kind: "history" }
  | { kind: "idea-result"; ideaId: string }
  | { kind: "article-result"; articleId: string }
  | { kind: "conversation"; articleId: string }
  | { kind: "share"; articleId: string }
  | { kind: "edit-loop"; loopId: string }
  | { kind: "archive-loop"; loopId: string }
  | { kind: "create-loop" }
  | { kind: "ideas"; loopId: string }
  | { kind: "feedback"; loopId: string }
  | { kind: "article"; ideaId: string }
  | { kind: "questions"; ideaId: string }
  | { kind: "events"; ideaId: string }
  | { kind: "result"; requestId: string }
  | { kind: "retry"; requestId: string };

function parsedUuid(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Exact mirror of the web relay's deliberately small route surface. */
export function matchDemandRoute(
  method: string,
  path: readonly string[],
): DemandRoute | null {
  if (method === "POST" && path.length === 1 && path[0] === "session") {
    return { kind: "session" };
  }
  if (method === "GET" && path.length === 1 && path[0] === "workspace") {
    return { kind: "workspace" };
  }
  if (method === "GET" && path.length === 1 && path[0] === "history") {
    return { kind: "history" };
  }
  if (method === "GET" && path.length === 2 && path[0] === "ideas") {
    const ideaId = parsedUuid(path[1]);
    return ideaId ? { kind: "idea-result", ideaId } : null;
  }
  if (method === "POST" && path.length === 1 && path[0] === "loops") {
    return { kind: "create-loop" };
  }
  if (path.length === 2 && path[0] === "articles" && method === "GET") {
    const articleId = parsedUuid(path[1]);
    return articleId ? { kind: "article-result", articleId } : null;
  }
  if (path.length === 3 && path[0] === "articles") {
    const articleId = parsedUuid(path[1]);
    if (!articleId) return null;
    if (method === "GET" && path[2] === "conversation") return { kind: "conversation", articleId };
    if (method === "POST" && path[2] === "share") return { kind: "share", articleId };
    return null;
  }
  if (path.length === 3 && path[0] === "loops" && method === "POST") {
    const loopId = parsedUuid(path[1]);
    if (!loopId) return null;
    if (path[2] === "edit") return { kind: "edit-loop", loopId };
    if (path[2] === "archive") return { kind: "archive-loop", loopId };
  }
  if (method === "GET" && path.length === 2 && path[0] === "requests") {
    const requestId = parsedUuid(path[1]);
    return requestId ? { kind: "result", requestId } : null;
  }
  if (path.length !== 3) return null;

  const id = parsedUuid(path[1]);
  if (!id) return null;
  if (method === "POST" && path[0] === "loops" && path[2] === "ideas") {
    return { kind: "ideas", loopId: id };
  }
  if (method === "POST" && path[0] === "loops" && path[2] === "feedback") {
    return { kind: "feedback", loopId: id };
  }
  if (method === "POST" && path[0] === "ideas" && path[2] === "article") {
    return { kind: "article", ideaId: id };
  }
  if (method === "POST" && path[0] === "ideas" && path[2] === "questions") {
    return { kind: "questions", ideaId: id };
  }
  if (method === "PUT" && path[0] === "ideas" && path[2] === "events") {
    return { kind: "events", ideaId: id };
  }
  if (method === "POST" && path[0] === "requests" && path[2] === "retry") {
    return { kind: "retry", requestId: id };
  }
  return null;
}

export function isRetryableDemandFailure(code: string | null) {
  return code !== null && retryableFailureCodes.has(code);
}

export function shouldExhaustDemandDispatch(
  request: {
    status: string;
    attempts: number;
    leaseExpiresAt: Date | null;
    nextAttemptAt: Date;
  },
  now: Date,
) {
  return request.status === "queued" &&
    request.attempts >= MAX_DISPATCH_ATTEMPTS &&
    request.nextAttemptAt <= now &&
    (!request.leaseExpiresAt || request.leaseExpiresAt <= now);
}

type DemandRecoveryStage = Pick<
  typeof demandStages.$inferSelect,
  "status" | "leaseExpiresAt"
>;

export type DemandRecoveryDecision =
  | "reading_session_expired"
  | "provider_uncertain"
  | "provider_invalid"
  | "worker_interrupted"
  | "skip";

/**
 * A request lease expiring does not prove that an already-reserved provider
 * call stopped. Only checkpoints whose provider stages are all durable and
 * terminal-successful (or which never reached a provider) are safe to resume.
 */
export function demandRecoveryDecision(
  principalActive: boolean,
  stages: readonly DemandRecoveryStage[],
  now: Date,
): DemandRecoveryDecision {
  if (!principalActive) return "reading_session_expired";
  if (
    stages.some(
      (stage) =>
        stage.status === "reserved" &&
        stage.leaseExpiresAt !== null &&
        stage.leaseExpiresAt > now,
    )
  ) {
    return "skip";
  }
  if (
    stages.some(
      (stage) =>
        stage.status === "reserved" || stage.status === "uncertain",
    )
  ) {
    return "provider_uncertain";
  }
  if (stages.some((stage) => stage.status === "failed")) {
    return "provider_invalid";
  }
  return "worker_interrupted";
}

type StaleDemandClaim = Pick<
  typeof demandRequests.$inferSelect,
  | "id"
  | "principalId"
  | "status"
  | "workflowRunId"
  | "leaseExpiresAt"
  | "updatedAt"
>;

export function isStaleDemandClaim(
  request: StaleDemandClaim,
  now: Date,
) {
  if (
    request.workflowRunId === null ||
    (request.status !== "queued" && request.status !== "running")
  ) {
    return false;
  }
  if (request.leaseExpiresAt !== null) {
    return request.leaseExpiresAt <= now;
  }
  // Compatibility for requests dispatched by the pre-lease implementation.
  // Fresh null-lease rows get the same five-minute grace as current claims.
  return request.updatedAt.getTime() + DISPATCH_LEASE_MS <= now.getTime();
}

function activePrincipalSql(principalId: typeof demandRequests.principalId) {
  return sql<boolean>`private.demand_principal_is_active(${principalId})`;
}

/**
 * Claims one durable request before asking Workflow to start. A second
 * ownership claim inside the workflow is the final barrier: if start returns
 * ambiguously and reconciliation starts another run, only one run ID can own
 * the request and reach a provider stage.
 */
export async function dispatchDemandRequest(
  requestId: string,
  expectedPrincipalId?: string,
): Promise<DemandDispatchResult> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS);

  const claimed = await withDemandWorkerDb(async (tx) => {
    const [row] = await tx
      .update(demandRequests)
      .set({
        leaseExpiresAt,
        attempts: sql`${demandRequests.attempts} + 1`,
        failureCode: null,
      })
      .where(
        and(
          eq(demandRequests.id, requestId),
          expectedPrincipalId
            ? eq(demandRequests.principalId, expectedPrincipalId)
            : undefined,
          eq(demandRequests.status, "queued"),
          isNull(demandRequests.workflowRunId),
          lt(demandRequests.attempts, MAX_DISPATCH_ATTEMPTS),
          lte(demandRequests.nextAttemptAt, now),
          or(
            isNull(demandRequests.leaseExpiresAt),
            lte(demandRequests.leaseExpiresAt, now),
          ),
          activePrincipalSql(demandRequests.principalId),
        ),
      )
      .returning({
        id: demandRequests.id,
        principalId: demandRequests.principalId,
        attempts: demandRequests.attempts,
      });
    return row;
  });

  if (!claimed) {
    return withDemandWorkerDb(async (tx) => {
      const [current] = await tx
        .select({
          principalId: demandRequests.principalId,
          status: demandRequests.status,
          workflowRunId: demandRequests.workflowRunId,
          attempts: demandRequests.attempts,
          leaseExpiresAt: demandRequests.leaseExpiresAt,
          nextAttemptAt: demandRequests.nextAttemptAt,
        })
        .from(demandRequests)
        .where(
          and(
            eq(demandRequests.id, requestId),
            expectedPrincipalId
              ? eq(demandRequests.principalId, expectedPrincipalId)
              : undefined,
          ),
        )
        .limit(1);

      if (current?.workflowRunId) {
        return {
          outcome: "already-dispatched" as const,
          runId: current.workflowRunId,
        };
      }

      if (current && shouldExhaustDemandDispatch(current, now)) {
        await tx
          .update(demandRequests)
          .set({
            status: "failed",
            stage: "failed",
            failureCode: "workflow_dispatch_failed",
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(demandRequests.id, requestId),
              eq(demandRequests.principalId, current.principalId),
              eq(demandRequests.status, "queued"),
              isNull(demandRequests.workflowRunId),
              sql`${demandRequests.attempts} >= ${MAX_DISPATCH_ATTEMPTS}`,
              lte(demandRequests.nextAttemptAt, now),
              or(
                isNull(demandRequests.leaseExpiresAt),
                lte(demandRequests.leaseExpiresAt, now),
              ),
            ),
          );
        return { outcome: "exhausted" as const };
      }

      return { outcome: "skipped" as const };
    });
  }

  let runId: string;
  try {
    const run = await start(onDemandReadingWorkflow, [requestId]);
    runId = run.runId;
  } catch (error) {
    try {
      await withDemandWorkerDb(async (tx) => {
        const exhausted = claimed.attempts >= MAX_DISPATCH_ATTEMPTS;
        await tx
          .update(demandRequests)
          .set({
            status: exhausted ? "failed" : "queued",
            stage: exhausted ? "failed" : "queued",
            failureCode: "workflow_dispatch_failed",
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + DISPATCH_RETRY_MS),
          })
          .where(
            and(
              eq(demandRequests.id, requestId),
              eq(demandRequests.principalId, claimed.principalId),
              eq(demandRequests.status, "queued"),
              isNull(demandRequests.workflowRunId),
              eq(demandRequests.leaseExpiresAt, leaseExpiresAt),
            ),
          );
      });
    } catch (releaseError) {
      console.error("Failed to release demand-request dispatch lease", {
        requestId,
        ...safeCaughtErrorMetadata(releaseError),
      });
    }
    console.error("Demand-request workflow dispatch failed", {
      requestId,
      ...safeCaughtErrorMetadata(error),
    });
    return claimed.attempts >= MAX_DISPATCH_ATTEMPTS
      ? { outcome: "exhausted" }
      : { outcome: "retry-scheduled" };
  }

  const saved = await withDemandWorkerDb(async (tx) => {
    const [row] = await tx
      .update(demandRequests)
      .set({
        workflowRunId: runId,
        failureCode: null,
      })
      .where(
        and(
          eq(demandRequests.id, requestId),
          eq(demandRequests.principalId, claimed.principalId),
          eq(demandRequests.status, "queued"),
          isNull(demandRequests.workflowRunId),
          eq(demandRequests.leaseExpiresAt, leaseExpiresAt),
        ),
      )
      .returning({ workflowRunId: demandRequests.workflowRunId });
    return row;
  });

  if (saved?.workflowRunId) {
    return { outcome: "dispatched", runId: saved.workflowRunId };
  }

  const current = await withDemandWorkerDb(async (tx) => {
    const [row] = await tx
      .select({ workflowRunId: demandRequests.workflowRunId })
      .from(demandRequests)
      .where(
        and(
          eq(demandRequests.id, requestId),
          eq(demandRequests.principalId, claimed.principalId),
        ),
      )
      .limit(1);
    return row;
  });

  if (current?.workflowRunId) {
    return {
      outcome: "already-dispatched",
      runId: current.workflowRunId,
    };
  }

  throw new Error(
    "The demand workflow started but its run ID could not be persisted.",
  );
}

/**
 * Requeues owned safe interruptions or a proved check-binding failure. Failed
 * or uncertain provider stages are never recommissioned; qualified
 * postvalidation recovery replays only the two succeeded cached responses.
 */
export async function prepareDemandRetry(
  principalId: string,
  requestId: string,
): Promise<{ outcome: "current" | "requeued"; request: DemandRequestRow } | { outcome: "provider-uncertain" }> {
  const now = new Date();
  return withDemandWorkerDb(async (tx) => {
    await lockDemandAdmission(tx, principalId);
    const [current] = await tx
      .select()
      .from(demandRequests)
      .where(
        and(
          eq(demandRequests.id, requestId),
          eq(demandRequests.principalId, principalId),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) {
      throw new HttpError(
        404,
        "request_not_found",
        "That reading request was not found.",
      );
    }

    const [access] = await tx.execute<{ active: boolean }>(
      sql`select private.demand_principal_is_active(${principalId}::uuid) as active`,
    );
    if (access?.active !== true) {
      throw new HttpError(
        401,
        "reading_session_expired",
        "This reading session is no longer available.",
      );
    }

    if (current.status !== "failed") {
      return { outcome: "current" as const, request: current };
    }
    if (current.attempts >= MAX_DISPATCH_ATTEMPTS) {
      throw new HttpError(
        409,
        "request_retry_exhausted",
        "That request has used its safe retry attempts.",
      );
    }

    const recovery = current.failureCode === "provider_invalid"
      ? await loadDemandCheckRecovery(tx, principalId, current, true) : null;
    if (!recovery && !isRetryableDemandFailure(current.failureCode)) {
      throw new HttpError(409, "request_not_retryable", "That request cannot be safely retried.");
    }

    const stages = await tx
      .select({
        id: demandStages.id,
        status: demandStages.status,
        leaseExpiresAt: demandStages.leaseExpiresAt,
      })
      .from(demandStages)
      .where(
        and(
          eq(demandStages.principalId, principalId),
          eq(demandStages.requestId, requestId),
          inArray(demandStages.status, ["reserved", "failed", "uncertain"]),
        ),
      )
      .for("update");

    const reserved = stages.find(({ status }) => status === "reserved");
    if (reserved) {
      if (reserved.leaseExpiresAt && reserved.leaseExpiresAt > now) {
        throw new HttpError(
          409,
          "request_still_running",
          "That request may still be running. Wait for its current attempt.",
        );
      }
      await tx
        .update(demandStages)
        .set({ status: "uncertain", updatedAt: now })
        .where(
          and(
            eq(demandStages.principalId, principalId),
            eq(demandStages.requestId, requestId),
            eq(demandStages.status, "reserved"),
            or(
              isNull(demandStages.leaseExpiresAt),
              lte(demandStages.leaseExpiresAt, now),
            ),
          ),
        );
      return { outcome: "provider-uncertain" as const };
    }

    if (stages.length > 0) {
      throw new HttpError(
        409,
        "provider_uncertain",
        "That request cannot be commissioned again because a provider attempt may already exist.",
      );
    }

    // Ordinary interrupted work already holds its unused reservation. Only a
    // proved terminal postvalidation failure must reacquire released capacity.
    await assertDemandAdmissionCapacity(tx, { principalId, additionalMicrousd: recovery?.releasedHoldMicrousd ?? 0 });

    const [requeued] = await tx
      .update(demandRequests)
      .set({
        status: "queued",
        stage: "queued",
        workflowRunId: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
        failureCode: null,
        ...(recovery ? { progress: recovery.checkpoint } : {}),
      })
      .where(
        and(
          eq(demandRequests.id, requestId),
          eq(demandRequests.principalId, principalId),
          eq(demandRequests.status, "failed"),
          isNull(demandRequests.result),
          activePrincipalSql(demandRequests.principalId),
        ),
      )
      .returning();
    if (!requeued) {
      throw new HttpError(
        409,
        "request_retry_conflict",
        "That request changed before it could be retried.",
      );
    }
    return { outcome: "requeued" as const, request: requeued };
  });
}

/** Dispatch is injectable for disposable-database verification. Preparation
 * itself never starts a Workflow or calls a provider. */
export async function retryDemandRequest(
  principalId: string,
  requestId: string,
  dispatch: typeof dispatchDemandRequest = dispatchDemandRequest,
): Promise<DemandDispatchResult> {
  const preparation = await prepareDemandRetry(principalId, requestId);

  if (preparation.outcome === "provider-uncertain") {
    throw new HttpError(
      409,
      "provider_uncertain",
      "That request cannot be commissioned again because a provider attempt may already exist.",
    );
  }

  const request = preparation.request;
  if (request.status === "succeeded" || request.status === "running") {
    return request.workflowRunId
      ? { outcome: "already-dispatched", runId: request.workflowRunId }
      : { outcome: "skipped" };
  }
  return dispatch(requestId, principalId);
}

type StaleDemandRecoveryOutcome =
  | "interrupted"
  | "provider-uncertain"
  | "provider-invalid"
  | "expired"
  | "skipped";

async function settleStaleDemandClaim(
  candidate: StaleDemandClaim,
  now: Date,
): Promise<StaleDemandRecoveryOutcome> {
  return withDemandWorkerDb(async (tx) => {
    // Provider-stage reservation and completion use this same parent-first
    // order, so recovery cannot deadlock them or observe a half-written ledger.
    const [principal] = await tx
      .select({ id: demandPrincipals.id })
      .from(demandPrincipals)
      .where(eq(demandPrincipals.id, candidate.principalId))
      .for("update")
      .limit(1);
    if (!principal) return "skipped";

    const [current] = await tx
      .select({
        id: demandRequests.id,
        principalId: demandRequests.principalId,
        status: demandRequests.status,
        workflowRunId: demandRequests.workflowRunId,
        leaseExpiresAt: demandRequests.leaseExpiresAt,
        updatedAt: demandRequests.updatedAt,
      })
      .from(demandRequests)
      .where(
        and(
          eq(demandRequests.id, candidate.id),
          eq(demandRequests.principalId, candidate.principalId),
        ),
      )
      .for("update")
      .limit(1);
    if (!current || !isStaleDemandClaim(current, now)) return "skipped";

    const [access] = await tx.execute<{ active: boolean }>(
      sql`select private.demand_principal_is_active(${current.principalId}::uuid) as active`,
    );
    const stages = await tx
      .select({
        id: demandStages.id,
        status: demandStages.status,
        leaseExpiresAt: demandStages.leaseExpiresAt,
      })
      .from(demandStages)
      .where(
        and(
          eq(demandStages.principalId, current.principalId),
          eq(demandStages.requestId, current.id),
        ),
      )
      .for("update");

    const decision = demandRecoveryDecision(access?.active === true, stages, now);
    if (decision === "skip") return "skipped";

    if (decision === "provider_uncertain") {
      for (const stage of stages) {
        if (
          stage.status !== "reserved" ||
          (stage.leaseExpiresAt !== null && stage.leaseExpiresAt > now)
        ) {
          continue;
        }
        await tx
          .update(demandStages)
          .set({ status: "uncertain", updatedAt: now })
          .where(
            and(
              eq(demandStages.id, stage.id),
              eq(demandStages.principalId, current.principalId),
              eq(demandStages.requestId, current.id),
              eq(demandStages.status, "reserved"),
              stage.leaseExpiresAt === null
                ? isNull(demandStages.leaseExpiresAt)
                : eq(demandStages.leaseExpiresAt, stage.leaseExpiresAt),
            ),
          );
      }
    }

    const leaseMatches = current.leaseExpiresAt === null
      ? and(
          isNull(demandRequests.leaseExpiresAt),
          eq(demandRequests.updatedAt, current.updatedAt),
        )
      : eq(demandRequests.leaseExpiresAt, current.leaseExpiresAt);
    const [settled] = await tx
      .update(demandRequests)
      .set({
        status: "failed",
        stage: "failed",
        failureCode: decision,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(demandRequests.id, current.id),
          eq(demandRequests.principalId, current.principalId),
          eq(demandRequests.status, current.status),
          eq(demandRequests.workflowRunId, current.workflowRunId!),
          leaseMatches,
        ),
      )
      .returning({ id: demandRequests.id });
    if (!settled) return "skipped";

    if (decision === "reading_session_expired") return "expired";
    if (decision === "provider_uncertain") return "provider-uncertain";
    if (decision === "provider_invalid") return "provider-invalid";
    return "interrupted";
  });
}

export async function reconcileDemandRequests(
  limit = DEFAULT_RECONCILE_LIMIT,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECONCILE_LIMIT) {
    throw new TypeError("limit must be an integer between 1 and 100");
  }

  const now = new Date();
  const staleNullLeaseBefore = new Date(now.getTime() - DISPATCH_LEASE_MS);
  const candidates = await withDemandWorkerDb((tx) =>
    tx
      .select({
        id: demandRequests.id,
        principalId: demandRequests.principalId,
        status: demandRequests.status,
        workflowRunId: demandRequests.workflowRunId,
        leaseExpiresAt: demandRequests.leaseExpiresAt,
        updatedAt: demandRequests.updatedAt,
      })
      .from(demandRequests)
      .where(
        or(
          and(
            eq(demandRequests.status, "queued"),
            isNull(demandRequests.workflowRunId),
            lte(demandRequests.nextAttemptAt, now),
            or(
              isNull(demandRequests.leaseExpiresAt),
              lte(demandRequests.leaseExpiresAt, now),
            ),
            activePrincipalSql(demandRequests.principalId),
          ),
          and(
            inArray(demandRequests.status, ["queued", "running"]),
            isNotNull(demandRequests.workflowRunId),
            or(
              lte(demandRequests.leaseExpiresAt, now),
              and(
                isNull(demandRequests.leaseExpiresAt),
                lte(demandRequests.updatedAt, staleNullLeaseBefore),
              ),
            ),
          ),
        ),
      )
      .orderBy(
        asc(demandRequests.nextAttemptAt),
        asc(demandRequests.createdAt),
      )
      .limit(limit),
  );

  const counts = {
    examined: candidates.length,
    dispatched: 0,
    alreadyDispatched: 0,
    retryScheduled: 0,
    exhausted: 0,
    skipped: 0,
    failed: 0,
    interrupted: 0,
    providerUncertain: 0,
    providerInvalid: 0,
    expired: 0,
  };

  for (const candidate of candidates) {
    try {
      if (candidate.workflowRunId !== null) {
        const result = await settleStaleDemandClaim(candidate, now);
        if (result === "interrupted") counts.interrupted += 1;
        if (result === "provider-uncertain") counts.providerUncertain += 1;
        if (result === "provider-invalid") counts.providerInvalid += 1;
        if (result === "expired") counts.expired += 1;
        if (result === "skipped") counts.skipped += 1;
        continue;
      }
      const result = await dispatchDemandRequest(candidate.id);
      if (result.outcome === "dispatched") counts.dispatched += 1;
      if (result.outcome === "already-dispatched") {
        counts.alreadyDispatched += 1;
      }
      if (result.outcome === "retry-scheduled") counts.retryScheduled += 1;
      if (result.outcome === "exhausted") counts.exhausted += 1;
      if (result.outcome === "skipped") counts.skipped += 1;
    } catch (error) {
      counts.failed += 1;
      console.error("Demand-request reconciliation failed", {
        requestId: candidate.id,
        ...safeCaughtErrorMetadata(error),
      });
    }
  }

  return counts;
}
