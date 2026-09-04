import { and, eq } from "drizzle-orm";
import { readingEventRequestSchema, uuidSchema } from "@edison/contracts";
import { articles, profiles, readingEvents } from "@edison/db";
import { dateKeyInTimeZone, nextReadingStreak } from "@edison/domain";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { withActiveMember } from "../../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ articleId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);
    const input = readingEventRequestSchema.parse(await request.json());

    return withActiveMember(claims, async ({ transaction, profile }) => {
      const [article] = await transaction
        .select({ id: articles.id })
        .from(articles)
        .where(and(eq(articles.id, articleId), eq(articles.ownerId, claims.sub)))
        .limit(1);
      if (!article) {
        throw new HttpError(404, "article_not_found", "That article was not found.");
      }

      const [inserted] = await transaction
        .insert(readingEvents)
        .values({
          userId: claims.sub,
          articleId,
          eventType: input.eventType,
          idempotencyKey: input.idempotencyKey,
          value:
            input.progressPercent === undefined
              ? {}
              : { progressPercent: input.progressPercent },
        })
        .onConflictDoNothing()
        .returning({ id: readingEvents.id });

      let currentStreak = profile.currentStreak;
      if (inserted && input.eventType === "completed") {
        const readDate = dateKeyInTimeZone(new Date(), profile.timezone);
        const streak = nextReadingStreak({
          currentStreak: profile.currentStreak,
          lastReadDate: profile.lastReadDate,
          readDate,
        });
        currentStreak = streak.currentStreak;
        await transaction
          .update(profiles)
          .set(streak)
          .where(eq(profiles.id, claims.sub));
      }

      return json({ recorded: Boolean(inserted), currentStreak });
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
