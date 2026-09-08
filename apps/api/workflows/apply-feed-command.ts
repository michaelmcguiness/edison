import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { FatalError, RetryableError, getWorkflowMetadata } from "workflow";
import {
  ProviderResponseValidationError,
  parsePreferenceCommand,
} from "@edison/ai";
import type { PreferenceChange } from "@edison/contracts";
import {
  aiRequestReservations,
  feedCommands,
  feedPreferences,
  getDb,
  userInterests,
} from "@edison/db";
import {
  UnpricedOpenAiModelError,
  normalizeInterestTopic,
  resolveActiveInterestRemoval,
} from "@edison/domain";
import {
  AI_REQUEST_PROVIDER_TIMEOUT_MS,
  AiUsagePersistenceError,
  claimAiRequest,
  finalizeAiRequest,
  findAiRequestReservation,
  invalidProviderResponseFailure,
  markAiRequestAttemptFailed,
  recordAiRequestSpend,
} from "../src/services/ai-request-reservations";
import { preferenceCommandRequestSnapshotSchema } from "../src/services/ai-request-snapshots";
import {
  applyKnowledgeStateChange,
  canRetainExplicitInterest,
} from "../src/services/preference-bounds";
import { safeCaughtErrorMetadata } from "../src/observability/safe-error";

export async function applyFeedCommandWorkflow(commandId: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const claimed = await claimFeedCommand(commandId, workflowRunId);
  if (claimed.status === "complete") return { changes: claimed.changes };

  try {
    return await applyFeedCommand(commandId, workflowRunId);
  } catch (error) {
    await settleFeedCommandFailure(commandId, workflowRunId);
    throw error;
  }
}

async function claimFeedCommand(commandId: string, workflowRunId: string) {
  "use step";

  const database = getDb();
  const [claimed] = await database
    .update(feedCommands)
    .set({
      workflowRunId,
      leaseExpiresAt: null,
      error: null,
    })
    .where(
      and(
        eq(feedCommands.id, commandId),
        eq(feedCommands.status, "queued"),
        or(
          isNull(feedCommands.workflowRunId),
          eq(feedCommands.workflowRunId, workflowRunId),
        ),
      ),
    )
    .returning({ id: feedCommands.id });

  if (claimed) return { status: "claimed" as const };

  const [command] = await database
    .select({
      status: feedCommands.status,
      workflowRunId: feedCommands.workflowRunId,
      structuredUpdate: feedCommands.structuredUpdate,
    })
    .from(feedCommands)
    .where(eq(feedCommands.id, commandId))
    .limit(1);

  if (!command) throw new FatalError("Feed command does not exist");
  if (command.status === "applied" || command.status === "no-op") {
    return {
      status: "complete" as const,
      changes: command.structuredUpdate ?? [],
    };
  }
  if (command.status === "failed") {
    throw new FatalError("Feed command was marked as failed");
  }
  if (
    command.workflowRunId &&
    command.workflowRunId !== workflowRunId
  ) {
    throw new FatalError("Feed command belongs to another workflow run");
  }
  throw new Error("Feed command could not be claimed");
}

claimFeedCommand.maxRetries = 3;

async function applyFeedCommand(commandId: string, workflowRunId: string) {
  "use step";

  const database = getDb();
  const [record] = await database
    .select({ command: feedCommands, preferences: feedPreferences })
    .from(feedCommands)
    .innerJoin(
      feedPreferences,
      eq(feedPreferences.userId, feedCommands.userId),
    )
    .where(eq(feedCommands.id, commandId))
    .limit(1);

  if (!record) throw new FatalError("Feed command does not exist");
  if (
    record.command.status === "applied" ||
    record.command.status === "no-op"
  ) {
    return { changes: record.command.structuredUpdate ?? [] };
  }
  if (record.command.status === "failed") {
    throw new FatalError("Feed command was marked as failed");
  }
  if (
    record.command.status !== "queued" ||
    record.command.workflowRunId !== workflowRunId
  ) {
    throw new FatalError("Feed command is not owned by this workflow run");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new FatalError("OPENAI_API_KEY is not configured");
  }

  const reservation = await findAiRequestReservation({
    userId: record.command.userId,
    operation: "preference_command",
    idempotencyKey: record.command.idempotencyKey,
  });
  if (!reservation || reservation.resourceId !== record.command.id) {
    throw new FatalError("Feed command has no valid AI request reservation");
  }

  const claim = await claimAiRequest({
    reservationId: reservation.id,
    userId: record.command.userId,
    operation: "preference_command",
  });
  if (claim.outcome === "busy") {
    throw new RetryableError(
      "Feed-command AI request is leased by another worker",
      { retryAfter: claim.retryAt },
    );
  }
  if (claim.outcome === "failed") {
    throw new FatalError("Feed-command AI request exhausted its safe retries");
  }
  if (claim.outcome === "succeeded") {
    throw new FatalError(
      "Feed-command AI request completed without a terminal command state",
    );
  }

  try {
    const snapshotResult = preferenceCommandRequestSnapshotSchema.safeParse(
      reservation.requestSnapshot,
    );
    if (
      !snapshotResult.success ||
      snapshotResult.data.command !== record.command.command
    ) {
      throw new FatalError("Feed-command AI snapshot is invalid");
    }
    const providerInput = snapshotResult.data;

    const parsed = await parsePreferenceCommand({
      userId: record.command.userId,
      command: providerInput.command,
      currentPreferences: providerInput.currentPreferences,
      currentInterests: providerInput.currentInterests,
      providerIdempotencyKey: claim.providerIdempotencyKey,
      providerTimeoutMs: AI_REQUEST_PROVIDER_TIMEOUT_MS,
    });

    try {
      await recordAiRequestSpend({
        reservationId: reservation.id,
        userId: record.command.userId,
        operation: "preference_command",
        usage: {
          providerResponseId: parsed.providerResponseId,
          model: parsed.model,
          inputTokens: parsed.inputTokens,
          cachedInputTokens: parsed.cachedInputTokens,
          outputTokens: parsed.outputTokens,
        },
      });
    } catch (accountingError) {
      if (accountingError instanceof UnpricedOpenAiModelError) {
        throw accountingError;
      }
      console.error("Failed to record feed-command usage", {
        reservationId: reservation.id,
        ...safeCaughtErrorMetadata(accountingError),
      });
      throw new AiUsagePersistenceError();
    }

    return await database.transaction(async (transaction) => {
      const [currentCommand] = await transaction
        .select()
        .from(feedCommands)
        .where(eq(feedCommands.id, commandId))
        .for("update")
        .limit(1);
      if (!currentCommand) throw new FatalError("Feed command does not exist");
      if (
        currentCommand.status === "applied" ||
        currentCommand.status === "no-op"
      ) {
        await finalizeAiRequest(transaction, {
          reservationId: reservation.id,
          userId: currentCommand.userId,
          operation: "preference_command",
          leaseOwner: claim.leaseOwner,
          providerResponseId: parsed.providerResponseId,
        });
        return { changes: currentCommand.structuredUpdate ?? [] };
      }
      if (currentCommand.status === "failed") {
        throw new FatalError("Feed command was marked as failed");
      }
      if (currentCommand.workflowRunId !== workflowRunId) {
        throw new FatalError("Feed command is not owned by this workflow run");
      }

      // Serialize preference writes for a reader and apply every change to the
      // latest committed state. Separate concurrent commands therefore cannot
      // overwrite one another with the stale snapshot used for model context.
      const [preferences] = await transaction
        .select()
        .from(feedPreferences)
        .where(eq(feedPreferences.userId, currentCommand.userId))
        .for("update")
        .limit(1);
      if (!preferences) throw new FatalError("Feed preferences do not exist");

      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`edison-interests:${currentCommand.userId}`}, 0)
        )
      `);

      let depth = preferences.depth;
      let novelty = preferences.novelty;
      let articleLength = preferences.articleLength;
      let knowledgeState = [...preferences.knowledgeState];
      const interests = await transaction
        .select()
        .from(userInterests)
        .where(eq(userInterests.userId, currentCommand.userId))
        .for("update");
      const appliedChanges: PreferenceChange[] = [];

      for (const change of parsed.changes) {
        if (change.path === "depth") {
          const nextDepth = applyNumberChange(
            depth,
            change.operation,
            change.value,
          );
          if (nextDepth !== depth) {
            depth = nextDepth;
            appliedChanges.push(change);
          }
        }
        if (change.path === "novelty") {
          const nextNovelty = applyNumberChange(
            novelty,
            change.operation,
            change.value,
          );
          if (nextNovelty !== novelty) {
            novelty = nextNovelty;
            appliedChanges.push(change);
          }
        }
        if (change.path === "articleLength") {
          if (articleLength !== change.value) {
            articleLength = change.value;
            appliedChanges.push(change);
          }
        }
        if (change.path === "interests") {
          const topics = Array.isArray(change.value)
            ? change.value
            : [change.value];
          if (change.operation === "remove") {
            const removal = resolveActiveInterestRemoval(topics, interests);
            if (removal.ids.length) {
              await transaction
                .update(userInterests)
                .set({ status: "muted" })
                .where(inArray(userInterests.id, removal.ids));
              const removedIds = new Set(removal.ids);
              for (const interest of interests) {
                if (removedIds.has(interest.id)) interest.status = "muted";
              }
              appliedChanges.push({
                ...change,
                value:
                  removal.topics.length === 1
                    ? removal.topics[0]
                    : removal.topics,
              });
            }
            continue;
          }

          const addedTopics: string[] = [];
          for (const requestedTopic of topics) {
            const topic = requestedTopic.trim();
            const key = normalizeInterestTopic(topic);
            if (!key) continue;
            const explicit = interests.find(
              (interest) =>
                interest.kind === "explicit" &&
                normalizeInterestTopic(interest.topic) === key,
            );
            if (explicit?.status === "active") continue;
            if (!canRetainExplicitInterest(interests, explicit)) continue;

            if (explicit) {
              await transaction
                .update(userInterests)
                .set({ status: "active" })
                .where(eq(userInterests.id, explicit.id));
              explicit.status = "active";
              addedTopics.push(explicit.topic);
            } else {
              const [inserted] = await transaction
                .insert(userInterests)
                .values({
                  userId: currentCommand.userId,
                  topic,
                  kind: "explicit",
                  status: "active",
                })
                .returning();
              if (!inserted) {
                throw new FatalError("Explicit interest could not be retained");
              }
              interests.push(inserted);
              addedTopics.push(topic);
            }
          }
          if (addedTopics.length) {
            appliedChanges.push({
              ...change,
              value: addedTopics.length === 1 ? addedTopics[0] : addedTopics,
            });
          }
        }
        if (change.path === "knowledgeState") {
          const result = applyKnowledgeStateChange(knowledgeState, change);
          knowledgeState = result.knowledgeState;
          if (result.appliedTopics.length) {
            appliedChanges.push({
              ...change,
              value:
                result.appliedTopics.length === 1
                  ? result.appliedTopics[0]
                  : result.appliedTopics,
            });
          }
        }
      }

      await transaction
        .update(feedPreferences)
        .set({ depth, novelty, articleLength, knowledgeState })
        .where(eq(feedPreferences.userId, currentCommand.userId));

      await transaction
        .update(feedCommands)
        .set({
          status: appliedChanges.length ? "applied" : "no-op",
          structuredUpdate: appliedChanges,
          error: null,
        })
        .where(
          and(
            eq(feedCommands.id, commandId),
            eq(feedCommands.status, "queued"),
            eq(feedCommands.workflowRunId, workflowRunId),
          ),
        );

      await finalizeAiRequest(transaction, {
        reservationId: reservation.id,
        userId: currentCommand.userId,
        operation: "preference_command",
        leaseOwner: claim.leaseOwner,
        providerResponseId: parsed.providerResponseId,
      });

      return { changes: appliedChanges };
    });
  } catch (error) {
    let invalidResponseFailure:
      | ReturnType<typeof invalidProviderResponseFailure>
      | null = null;
    if (error instanceof ProviderResponseValidationError) {
      try {
        await recordAiRequestSpend({
          reservationId: reservation.id,
          userId: record.command.userId,
          operation: "preference_command",
          usage: error.observedUsage,
        });
        invalidResponseFailure = invalidProviderResponseFailure("persisted");
      } catch (accountingError) {
        if (accountingError instanceof UnpricedOpenAiModelError) {
          invalidResponseFailure = invalidProviderResponseFailure(
            "persisted_unpriced",
          );
        } else {
          invalidResponseFailure = invalidProviderResponseFailure("failed");
          console.error("Failed to record rejected feed-command usage", {
            reservationId: reservation.id,
            ...safeCaughtErrorMetadata(accountingError),
          });
        }
      }
    }
    let retryAt =
      claim.reservation.leaseExpiresAt ?? new Date(Date.now() + 3_000);
    try {
      const released = await markAiRequestAttemptFailed({
        reservationId: reservation.id,
        userId: record.command.userId,
        operation: "preference_command",
        leaseOwner: claim.leaseOwner,
        failureCode:
          invalidResponseFailure?.failureCode ??
          (error instanceof AiUsagePersistenceError
            ? "ai_usage_persistence_failed"
            : "preference_command_attempt_failed"),
        terminal:
          (invalidResponseFailure?.terminal ?? false) ||
          error instanceof UnpricedOpenAiModelError ||
          error instanceof FatalError,
        preserveRetryCapacity:
          (invalidResponseFailure?.preserveRetryCapacity ?? false) ||
          error instanceof AiUsagePersistenceError,
        retryNotBefore: claim.reservation.leaseExpiresAt,
      });
      if (released) retryAt = released.nextAttemptAt;
    } catch (releaseError) {
      console.error("Failed to release feed-command AI lease", {
        reservationId: reservation.id,
        ...safeCaughtErrorMetadata(releaseError),
      });
    }
    if (error instanceof FatalError) throw error;
    if (error instanceof ProviderResponseValidationError) {
      if (!invalidResponseFailure?.terminal) {
        throw new RetryableError(
          "Feed-command usage accounting was not durably recorded",
          { retryAfter: retryAt },
        );
      }
      throw new FatalError("OpenAI returned an invalid feed-command result");
    }
    if (error instanceof UnpricedOpenAiModelError) {
      throw new FatalError("OpenAI returned an unpriced model identity");
    }
    if (error instanceof AiUsagePersistenceError) {
      throw new RetryableError(
        "Feed-command usage accounting was not durably recorded",
        { retryAfter: retryAt },
      );
    }
    throw new RetryableError("Feed-command AI attempt failed", {
      retryAfter: retryAt,
    });
  }
}

applyFeedCommand.maxRetries = 3;

async function settleFeedCommandFailure(
  commandId: string,
  workflowRunId: string,
) {
  "use step";

  await getDb().transaction(async (transaction) => {
    const [command] = await transaction
      .select({
        id: feedCommands.id,
        userId: feedCommands.userId,
        idempotencyKey: feedCommands.idempotencyKey,
      })
      .from(feedCommands)
      .where(
        and(
          eq(feedCommands.id, commandId),
          eq(feedCommands.status, "queued"),
          eq(feedCommands.workflowRunId, workflowRunId),
        ),
      )
      .for("update")
      .limit(1);
    if (!command) return;

    const [reservation] = await transaction
      .select({
        status: aiRequestReservations.status,
        nextAttemptAt: aiRequestReservations.nextAttemptAt,
        leaseExpiresAt: aiRequestReservations.leaseExpiresAt,
      })
      .from(aiRequestReservations)
      .where(
        and(
          eq(aiRequestReservations.userId, command.userId),
          eq(aiRequestReservations.operation, "preference_command"),
          eq(aiRequestReservations.resourceId, command.id),
          eq(
            aiRequestReservations.idempotencyKey,
            command.idempotencyKey,
          ),
        ),
      )
      .limit(1);

    if (
      reservation?.status === "reserved" ||
      reservation?.status === "in_progress"
    ) {
      const nextAttemptAt =
        reservation.leaseExpiresAt &&
        reservation.leaseExpiresAt > reservation.nextAttemptAt
          ? reservation.leaseExpiresAt
          : reservation.nextAttemptAt;
      await transaction
        .update(feedCommands)
        .set({
          workflowRunId: null,
          leaseExpiresAt: null,
          nextAttemptAt,
          error: "AI usage accounting was deferred; a retry is scheduled.",
        })
        .where(
          and(
            eq(feedCommands.id, commandId),
            eq(feedCommands.status, "queued"),
            eq(feedCommands.workflowRunId, workflowRunId),
          ),
        );
      return;
    }

    await transaction
      .update(feedCommands)
      .set({
        status: "failed",
        error: "The preference command failed before it could be applied.",
      })
      .where(
        and(
          eq(feedCommands.id, commandId),
          eq(feedCommands.status, "queued"),
          eq(feedCommands.workflowRunId, workflowRunId),
        ),
      );
  });
}

settleFeedCommandFailure.maxRetries = 5;

function applyNumberChange(
  current: number,
  operation: string,
  value: number,
) {
  const next =
    operation === "increase"
      ? current + value
      : operation === "decrease"
        ? current - value
        : value;
  return Math.max(0, Math.min(100, Math.round(next)));
}
