import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  feedCommandRequestSchema,
  feedCommandResponseSchema,
  maxRetainedExplicitInterests,
} from "@edison/contracts";
import { feedCommands, feedPreferences, userInterests } from "@edison/db";
import { partitionInterestSignals } from "@edison/domain";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import { safeCaughtErrorMetadata } from "../../../../src/observability/safe-error";
import {
  reserveAiRequest,
} from "../../../../src/services/ai-request-reservations";
import { snapshotPreferenceCommand } from "../../../../src/services/ai-request-snapshots";
import { dispatchFeedCommand } from "../../../../src/services/feed-commands";
import { withActiveMember } from "../../../../src/services/members";
import { fingerprintRequest } from "../../../../src/services/request-fingerprint";

export const dynamic = "force-dynamic";

type FeedCommandRow = typeof feedCommands.$inferSelect;

function assertIdempotentCommandMatches(
  command: FeedCommandRow,
  requestedCommand: string,
) {
  if (command.command !== requestedCommand) {
    throw new HttpError(
      409,
      "idempotency_key_reused",
      "That idempotency key was already used for a different command.",
    );
  }
}

function presentCommand(command: FeedCommandRow, status = 200) {
  return json(
    feedCommandResponseSchema.parse({
      id: command.id,
      status: command.status,
      changes: command.structuredUpdate ?? [],
      message:
        command.status === "applied"
          ? "Your edition preferences have been updated."
          : command.status === "no-op"
            ? "That request did not change your current edition preferences."
            : command.status === "failed"
              ? "Edison could not apply that preference update. Please try again."
              : "Edison is translating that into your edition preferences.",
    }),
    { status },
  );
}

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = feedCommandRequestSchema.parse(await request.json());
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(
        503,
        "ai_not_configured",
        "Feed commands are unavailable until OpenAI is configured.",
      );
    }

    const command = await withActiveMember(
      claims,
      async ({ transaction }) => {
        let [existing] = await transaction
          .select()
          .from(feedCommands)
          .where(
            and(
              eq(feedCommands.userId, claims.sub),
              eq(feedCommands.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing && existing.status !== "queued") {
          assertIdempotentCommandMatches(existing, input.command);
          return existing;
        }

        const [[preferences], interestRows] = await Promise.all([
          transaction
            .select()
            .from(feedPreferences)
            .where(eq(feedPreferences.userId, claims.sub))
            .limit(1),
          transaction
            .select({
              topic: userInterests.topic,
              status: userInterests.status,
            })
            .from(userInterests)
            .where(
              and(
                eq(userInterests.userId, claims.sub),
                eq(userInterests.kind, "explicit"),
                inArray(userInterests.status, ["active", "muted"]),
              ),
            )
            .orderBy(asc(userInterests.createdAt), asc(userInterests.id))
            .limit(maxRetainedExplicitInterests),
        ]);
        if (!preferences) {
          throw new HttpError(
            500,
            "feed_preferences_not_found",
            "This reader's feed preferences could not be loaded.",
          );
        }
        const requestSnapshot = snapshotPreferenceCommand({
          command: input.command,
          currentPreferences: {
            articleLength: preferences.articleLength,
            editorialBrief: preferences.editorialBrief,
            depth: preferences.depth,
            novelty: preferences.novelty,
            categoryVisibility: preferences.categoryVisibility,
            categoryOrder: preferences.categoryOrder,
            inferredPreferences: preferences.inferredPreferences,
            knowledgeState: preferences.knowledgeState,
          },
          currentInterests: partitionInterestSignals(interestRows),
        });

        const proposedCommandId = existing?.id ?? randomUUID();
        const { reservation } = await reserveAiRequest(transaction, {
          userId: claims.sub,
          operation: "preference_command",
          resourceId: proposedCommandId,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprintRequest([
            "preference_command",
            input.command,
          ]),
          requestSnapshot,
        });

        // A concurrent request can have observed no command before waiting on
        // the per-reader quota lock. Re-read after reservation so it reuses the
        // first request's durable command instead of creating a second one.
        if (!existing) {
          [existing] = await transaction
            .select()
            .from(feedCommands)
            .where(
              and(
                eq(feedCommands.userId, claims.sub),
                eq(feedCommands.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
        }
        if (existing) {
          assertIdempotentCommandMatches(existing, input.command);
          if (reservation.resourceId !== existing.id) {
            throw new HttpError(
              500,
              "feed_command_reservation_invalid",
              "The stored feed-command reservation is inconsistent.",
            );
          }
          return existing;
        }

        const [created] = await transaction
          .insert(feedCommands)
          .values({
            id: reservation.resourceId,
            userId: claims.sub,
            command: input.command,
            idempotencyKey: input.idempotencyKey,
            status: "queued",
          })
          .onConflictDoNothing()
          .returning();
        if (created) return created;

        const [raced] = await transaction
          .select()
          .from(feedCommands)
          .where(
            and(
              eq(feedCommands.userId, claims.sub),
              eq(feedCommands.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!raced) {
          throw new HttpError(
            500,
            "feed_command_creation_failed",
            "Edison could not save that preference command.",
          );
        }
        assertIdempotentCommandMatches(raced, input.command);
        if (reservation.resourceId !== raced.id) {
          throw new HttpError(
            500,
            "feed_command_reservation_invalid",
            "The stored feed-command reservation is inconsistent.",
          );
        }
        return raced;
      },
    );

    if (command.status !== "queued") {
      return presentCommand(command);
    }

    try {
      await dispatchFeedCommand(command.id);
    } catch (error) {
      // The committed queued row is the durable source of truth. A caller
      // retry or the scheduled reconciler can safely replay this dispatch.
      console.error("Feed-command workflow dispatch deferred", {
        commandId: command.id,
        ...safeCaughtErrorMetadata(error),
      });
    }

    const [latest] = await withActiveMember(
      claims,
      async ({ transaction }) =>
        transaction
          .select()
          .from(feedCommands)
          .where(eq(feedCommands.id, command.id))
          .limit(1),
    );

    return presentCommand(latest ?? command, 202);
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
