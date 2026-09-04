import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import {
  articleCategories,
  articleCardSchema,
  feedQuerySchema,
  feedResponseSchema,
} from "@edison/contracts";
import {
  articles,
  feedPreferences,
  feedItems,
  readingEvents,
  savedArticles,
} from "@edison/db";
import { decodeFeedCursor, encodeFeedCursor } from "@edison/domain";
import { apiHandler, json } from "../../../src/http/api-handler";
import { HttpError } from "../../../src/http/errors";
import { withActiveMember } from "../../../src/services/members";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const url = new URL(request.url);
    const query = feedQuerySchema.parse({
      category: url.searchParams.get("category") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    let cursor: ReturnType<typeof decodeFeedCursor> | undefined;
    if (query.cursor) {
      try {
        cursor = decodeFeedCursor(query.cursor);
      } catch {
        throw new HttpError(400, "invalid_cursor", "The feed cursor is not valid.");
      }
    }

    return withActiveMember(claims, async ({ transaction }) => {
      const filters = [
        eq(feedItems.userId, claims.sub),
        eq(articles.status, "published"),
      ];

      if (query.category === "for-you") {
        const [preferences] = await transaction
          .select({ categoryVisibility: feedPreferences.categoryVisibility })
          .from(feedPreferences)
          .where(eq(feedPreferences.userId, claims.sub))
          .limit(1);
        if (!preferences) {
          throw new HttpError(
            500,
            "profile_incomplete",
            "The reader profile is missing its feed preferences.",
          );
        }

        const visibleCategories = articleCategories.filter(
          (category) => preferences.categoryVisibility[category] !== false,
        );
        if (!visibleCategories.length) {
          return json(
            feedResponseSchema.parse({
              items: [],
              nextCursor: null,
              activeCategory: query.category,
              generatedThrough: null,
            }),
          );
        }
        filters.push(inArray(articles.category, [...visibleCategories]));
      } else {
        filters.push(eq(feedItems.category, query.category));
      }

      if (cursor) {
        filters.push(
          or(
            lt(feedItems.editionDate, cursor.editionDate),
            and(
              eq(feedItems.editionDate, cursor.editionDate),
              gt(feedItems.rank, cursor.rank),
            ),
            and(
              eq(feedItems.editionDate, cursor.editionDate),
              eq(feedItems.rank, cursor.rank),
              gt(feedItems.id, cursor.id),
            ),
          )!,
        );
      }

      const rows = await transaction
        .select({
          feedItemId: feedItems.id,
          editionDate: feedItems.editionDate,
          rank: feedItems.rank,
          reason: feedItems.reason,
          id: articles.id,
          slug: articles.slug,
          category: articles.category,
          kicker: articles.kicker,
          title: articles.title,
          deck: articles.deck,
          readingMinutes: articles.readingMinutes,
          sourceCount: articles.sourceCount,
          researchedAt: articles.researchedAt,
          summary: articles.summary,
          saved: sql<boolean>`exists (
            select 1 from ${savedArticles}
            where ${savedArticles.userId} = ${claims.sub}
              and ${savedArticles.articleId} = ${articles.id}
          )`,
          completed: sql<boolean>`exists (
            select 1 from ${readingEvents}
            where ${readingEvents.userId} = ${claims.sub}
              and ${readingEvents.articleId} = ${articles.id}
              and ${readingEvents.eventType} = 'completed'
          )`,
        })
        .from(feedItems)
        .innerJoin(articles, eq(articles.id, feedItems.articleId))
        .where(and(...filters))
        .orderBy(
          desc(feedItems.editionDate),
          asc(feedItems.rank),
          asc(feedItems.id),
        )
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const hasMore = rows.length > query.limit;
      const items = page.map((row) =>
        articleCardSchema.parse({
          id: row.id,
          slug: row.slug,
          category: row.category,
          kicker: row.kicker,
          title: row.title,
          deck: row.deck,
          readingMinutes: row.readingMinutes,
          sourceCount: row.sourceCount,
          researchedAt: row.researchedAt.toISOString(),
          reason: row.reason,
          summary: row.summary,
          saved: row.saved,
          completed: row.completed,
        }),
      );

      return json(
        feedResponseSchema.parse({
          items,
          nextCursor:
            hasMore && last
              ? encodeFeedCursor({
                  editionDate: last.editionDate,
                  rank: last.rank,
                  id: last.feedItemId,
                })
              : null,
          activeCategory: query.category,
          generatedThrough: items.length
            ? new Date(
                Math.max(...page.map((row) => row.researchedAt.getTime())),
              ).toISOString()
            : null,
        }),
      );
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
