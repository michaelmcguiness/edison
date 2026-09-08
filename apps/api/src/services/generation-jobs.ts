import {
  and,
  asc,
  eq,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { generationJobs, getDb } from "@edison/db";
import { start } from "workflow/api";
import { generateArticleWorkflow } from "../../workflows/generate-article";
import { safeCaughtErrorMetadata } from "../observability/safe-error";

const DISPATCH_LEASE_MS = 5 * 60 * 1000;
const DISPATCH_RETRY_MS = 60 * 1000;
const DEFAULT_RECONCILE_LIMIT = 25;

export type GenerationJobDispatchResult =
  | { outcome: "dispatched"; runId: string }
  | { outcome: "already-dispatched"; runId: string }
  | { outcome: "skipped" };

/**
 * Claims and dispatches a queued job. The lease makes the API request and the
 * scheduled reconciler safe to run concurrently; the workflow performs a
 * second run-ID claim before doing any generation work.
 */
export async function dispatchGenerationJob(
  jobId: string,
): Promise<GenerationJobDispatchResult> {
  const database = getDb();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS);

  const [claimed] = await database
    .update(generationJobs)
    .set({ leaseExpiresAt })
    .where(
      and(
        eq(generationJobs.id, jobId),
        eq(generationJobs.status, "queued"),
        isNull(generationJobs.workflowRunId),
        lte(generationJobs.nextAttemptAt, now),
        or(
          isNull(generationJobs.leaseExpiresAt),
          lte(generationJobs.leaseExpiresAt, now),
        ),
      ),
    )
    .returning({ id: generationJobs.id });

  if (!claimed) {
    const [current] = await database
      .select({ workflowRunId: generationJobs.workflowRunId })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1);

    return current?.workflowRunId
      ? { outcome: "already-dispatched", runId: current.workflowRunId }
      : { outcome: "skipped" };
  }

  let runId: string;
  try {
    const run = await start(generateArticleWorkflow, [jobId]);
    runId = run.runId;
  } catch (error) {
    try {
      await database
        .update(generationJobs)
        .set({
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + DISPATCH_RETRY_MS),
          failureCode: "workflow_dispatch_failed",
          error: "Workflow dispatch failed; a retry has been scheduled.",
        })
        .where(
          and(
            eq(generationJobs.id, jobId),
            eq(generationJobs.status, "queued"),
            isNull(generationJobs.workflowRunId),
            eq(generationJobs.leaseExpiresAt, leaseExpiresAt),
          ),
        );
    } catch (releaseError) {
      console.error("Failed to release generation-job dispatch lease", {
        jobId,
        ...safeCaughtErrorMetadata(releaseError),
      });
    }
    throw error;
  }

  const [saved] = await database
    .update(generationJobs)
    .set({
      workflowRunId: runId,
      leaseExpiresAt: null,
      failureCode: null,
      error: null,
    })
    .where(
      and(
        eq(generationJobs.id, jobId),
        isNull(generationJobs.workflowRunId),
        eq(generationJobs.leaseExpiresAt, leaseExpiresAt),
      ),
    )
    .returning({ workflowRunId: generationJobs.workflowRunId });

  if (saved?.workflowRunId) {
    return { outcome: "dispatched", runId: saved.workflowRunId };
  }

  // The workflow can start quickly enough to persist its run ID before this
  // request resumes. Treat that as success only when it is the same run.
  const [current] = await database
    .select({ workflowRunId: generationJobs.workflowRunId })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);

  if (current?.workflowRunId === runId) {
    return { outcome: "already-dispatched", runId };
  }

  throw new Error("The workflow started but its run ID could not be persisted.");
}

export async function reconcileQueuedGenerationJobs(
  limit = DEFAULT_RECONCILE_LIMIT,
) {
  const database = getDb();
  const now = new Date();
  const candidates = await database
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.status, "queued"),
        isNull(generationJobs.workflowRunId),
        lte(generationJobs.nextAttemptAt, now),
        or(
          isNull(generationJobs.leaseExpiresAt),
          lte(generationJobs.leaseExpiresAt, now),
        ),
      ),
    )
    .orderBy(asc(generationJobs.nextAttemptAt), asc(generationJobs.createdAt))
    .limit(limit);

  let dispatched = 0;
  let alreadyDispatched = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await dispatchGenerationJob(candidate.id);
      if (result.outcome === "dispatched") dispatched += 1;
      if (result.outcome === "already-dispatched") alreadyDispatched += 1;
      if (result.outcome === "skipped") skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("Generation-job reconciliation dispatch failed", {
        jobId: candidate.id,
        ...safeCaughtErrorMetadata(error),
      });
    }
  }

  return {
    examined: candidates.length,
    dispatched,
    alreadyDispatched,
    skipped,
    failed,
  };
}
