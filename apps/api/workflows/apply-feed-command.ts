import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { FatalError, getWorkflowMetadata } from "workflow";
import { parsePreferenceCommand } from "@edison/ai";
import type { PreferenceChange } from "@edison/contracts";
import {
  feedCommands,
  feedPreferences,
  getDb,
  usageLedger,
  userInterests,
} from "@edison/db";
import {
  estimatedArticleCostMicrousd,
  normalizeInterestTopic,
  partitionInterestSignals,
  resolveActiveInterestRemoval,
} from "@edison/domain";

export async function applyFeedCommandWorkflow(commandId: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const claimed = await claimFeedCommand(commandId, workflowRunId);
  if (claimed.status === "complete") return { changes: claimed.changes };

  try {
    return await applyFeedCommand(commandId, workflowRunId);
  } catch (error) {
    await markFeedCommandFailed(commandId, workflowRunId);
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

  const interestRows = await database
    .select({ topic: userInterests.topic, status: userInterests.status })
    .from(userInterests)
    .where(
      and(
        eq(userInterests.userId, record.command.userId),
        inArray(userInterests.status, ["active", "muted"]),
      ),
    )
    .limit(80);

  const parsed = await parsePreferenceCommand({
    userId: record.command.userId,
    command: record.command.command,
    currentPreferences: record.preferences,
    currentInterests: partitionInterestSignals(interestRows),
  });

  return database.transaction(async (transaction) => {
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
        const topics = Array.isArray(change.value) ? change.value : [change.value];
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
            if (inserted) interests.push(inserted);
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
        const topics = Array.isArray(change.value) ? change.value : [change.value];
        let changed = false;
        for (const topic of topics) {
          const withoutTopic = knowledgeState.filter(
            (item) => item.topic.toLowerCase() !== topic.toLowerCase(),
          );
          if (change.operation === "remove") {
            if (withoutTopic.length !== knowledgeState.length) changed = true;
            knowledgeState = withoutTopic;
          } else {
            const existing = knowledgeState.find(
              (item) => item.topic.toLowerCase() === topic.toLowerCase(),
            );
            const next = {
              topic,
              level: "intermediate",
              note: change.explanation,
            };
            if (
              !existing ||
              existing.level !== next.level ||
              existing.note !== next.note
            ) {
              changed = true;
            }
            knowledgeState = [...withoutTopic, next];
          }
        }
        if (changed) {
          appliedChanges.push(change);
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

    await transaction.insert(usageLedger).values({
      userId: currentCommand.userId,
      operation: "preference_command",
      provider: "openai",
      model: parsed.model,
      inputTokens: parsed.inputTokens,
      cachedInputTokens: parsed.cachedInputTokens,
      outputTokens: parsed.outputTokens,
      webSearchCalls: 0,
      costMicrousd: estimatedArticleCostMicrousd({
        model: parsed.model,
        inputTokens: parsed.inputTokens,
        cachedInputTokens: parsed.cachedInputTokens,
        outputTokens: parsed.outputTokens,
        webSearchCalls: 0,
      }),
    });

    return { changes: appliedChanges };
  });
}

applyFeedCommand.maxRetries = 3;

async function markFeedCommandFailed(
  commandId: string,
  workflowRunId: string,
) {
  "use step";

  await getDb()
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
}

markFeedCommandFailed.maxRetries = 5;

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
