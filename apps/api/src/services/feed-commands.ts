import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { feedCommands, getDb } from "@edison/db";
import { start } from "workflow/api";
import { applyFeedCommandWorkflow } from "../../workflows/apply-feed-command";

const DISPATCH_LEASE_MS = 5 * 60 * 1000;
const DISPATCH_RETRY_MS = 60 * 1000;
const DEFAULT_RECONCILE_LIMIT = 25;

export type FeedCommandDispatchResult =
  | { outcome: "dispatched"; runId: string }
  | { outcome: "already-dispatched"; runId: string }
  | { outcome: "skipped" };

/**
 * Claims and dispatches a queued command. The lease closes the gap between the
 * committed command row and Workflow start while allowing a scheduled
 * reconciler to recover an interrupted request. The workflow performs a second
 * run-ID ownership claim before it calls OpenAI.
 */
export async function dispatchFeedCommand(
  commandId: string,
): Promise<FeedCommandDispatchResult> {
  const database = getDb();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS);

  const [claimed] = await database
    .update(feedCommands)
    .set({ leaseExpiresAt })
    .where(
      and(
        eq(feedCommands.id, commandId),
        eq(feedCommands.status, "queued"),
        isNull(feedCommands.workflowRunId),
        lte(feedCommands.nextAttemptAt, now),
        or(
          isNull(feedCommands.leaseExpiresAt),
          lte(feedCommands.leaseExpiresAt, now),
        ),
      ),
    )
    .returning({ id: feedCommands.id });

  if (!claimed) {
    const [current] = await database
      .select({ workflowRunId: feedCommands.workflowRunId })
      .from(feedCommands)
      .where(eq(feedCommands.id, commandId))
      .limit(1);

    return current?.workflowRunId
      ? { outcome: "already-dispatched", runId: current.workflowRunId }
      : { outcome: "skipped" };
  }

  let runId: string;
  try {
    const run = await start(applyFeedCommandWorkflow, [commandId]);
    runId = run.runId;
  } catch (error) {
    try {
      await database
        .update(feedCommands)
        .set({
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + DISPATCH_RETRY_MS),
          error: "Workflow dispatch failed; a retry has been scheduled.",
        })
        .where(
          and(
            eq(feedCommands.id, commandId),
            eq(feedCommands.status, "queued"),
            isNull(feedCommands.workflowRunId),
            eq(feedCommands.leaseExpiresAt, leaseExpiresAt),
          ),
        );
    } catch (releaseError) {
      console.error("Failed to release feed-command dispatch lease", {
        commandId,
        error: releaseError,
      });
    }
    throw error;
  }

  const [saved] = await database
    .update(feedCommands)
    .set({
      workflowRunId: runId,
      leaseExpiresAt: null,
      error: null,
    })
    .where(
      and(
        eq(feedCommands.id, commandId),
        eq(feedCommands.status, "queued"),
        isNull(feedCommands.workflowRunId),
        eq(feedCommands.leaseExpiresAt, leaseExpiresAt),
      ),
    )
    .returning({ workflowRunId: feedCommands.workflowRunId });

  if (saved?.workflowRunId) {
    return { outcome: "dispatched", runId: saved.workflowRunId };
  }

  // A fast workflow may persist its own run ID before this dispatcher resumes.
  // Only the matching ID counts as success; a different owner must not result
  // in a second model call.
  const [current] = await database
    .select({ workflowRunId: feedCommands.workflowRunId })
    .from(feedCommands)
    .where(eq(feedCommands.id, commandId))
    .limit(1);

  if (current?.workflowRunId === runId) {
    return { outcome: "already-dispatched", runId };
  }

  throw new Error(
    "The feed-command workflow started but its run ID could not be persisted.",
  );
}

export async function reconcileQueuedFeedCommands(
  limit = DEFAULT_RECONCILE_LIMIT,
) {
  const database = getDb();
  const now = new Date();
  const candidates = await database
    .select({ id: feedCommands.id })
    .from(feedCommands)
    .where(
      and(
        eq(feedCommands.status, "queued"),
        isNull(feedCommands.workflowRunId),
        lte(feedCommands.nextAttemptAt, now),
        or(
          isNull(feedCommands.leaseExpiresAt),
          lte(feedCommands.leaseExpiresAt, now),
        ),
      ),
    )
    .orderBy(asc(feedCommands.nextAttemptAt), asc(feedCommands.createdAt))
    .limit(limit);

  let dispatched = 0;
  let alreadyDispatched = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await dispatchFeedCommand(candidate.id);
      if (result.outcome === "dispatched") dispatched += 1;
      if (result.outcome === "already-dispatched") alreadyDispatched += 1;
      if (result.outcome === "skipped") skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("Feed-command reconciliation dispatch failed", {
        commandId: candidate.id,
        error,
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
