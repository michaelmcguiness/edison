import { and, eq } from "drizzle-orm";
import {
  feedCommandRequestSchema,
  feedCommandResponseSchema,
} from "@edison/contracts";
import { feedCommands } from "@edison/db";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import { dispatchFeedCommand } from "../../../../src/services/feed-commands";
import { withActiveMember } from "../../../../src/services/members";

export const dynamic = "force-dynamic";

type FeedCommandRow = typeof feedCommands.$inferSelect;

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
        const [created] = await transaction
          .insert(feedCommands)
          .values({
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
        if (raced.command !== input.command) {
          throw new HttpError(
            409,
            "idempotency_key_reused",
            "That idempotency key was already used for a different command.",
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
        error,
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
