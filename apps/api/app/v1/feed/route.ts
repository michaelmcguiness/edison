import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  articleCategories,
  articleCardSchema,
  feedQuerySchema,
  feedResponseSchema,
} from "@edison/contracts";
import {
  articles,
  editorialDirectionStates,
  feedPreferences,
  feedItems,
  readingEvents,
  savedArticles,
} from "@edison/db";
import { apiHandler, json } from "../../../src/http/api-handler";
import { HttpError } from "../../../src/http/errors";
import { withActiveMember } from "../../../src/services/members";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const url = new URL(request.url);
    if (url.searchParams.has("cursor")) {
      throw new HttpError(
        400,
        "finite_edition_has_no_cursor",
        "Today's News edition is finite and does not use pagination cursors.",
      );
    }
    const query = feedQuerySchema.parse({
      category: url.searchParams.get("category") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    return withActiveMember(claims, async ({ transaction }) => {
      // Hold a short shared lock through the item query so a concurrent daily
      // rotation cannot pair a new edition identity with the prior day's rows.
      const [edition] = await transaction
        .select({
          currentEditionId: editorialDirectionStates.currentEditionId,
          currentEditionDate: editorialDirectionStates.currentEditionDate,
        })
        .from(editorialDirectionStates)
        .where(
          and(
            eq(editorialDirectionStates.userId, claims.sub),
            eq(editorialDirectionStates.section, "news"),
          ),
        )
        .for("share")
        .limit(1);
      if (!edition) {
        throw new HttpError(
          500,
          "news_edition_state_missing",
          "The reader's News edition state is incomplete.",
        );
      }
      if (!edition.currentEditionDate) {
        return json(
          feedResponseSchema.parse({
            editionId: null,
            editionDate: null,
            items: [],
            itemCount: 0,
            nextCursor: null,
            activeCategory: query.category,
            generatedThrough: null,
          }),
        );
      }

      const filters = [
        eq(feedItems.userId, claims.sub),
        eq(feedItems.editionId, edition.currentEditionId),
        eq(feedItems.editionDate, edition.currentEditionDate),
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
              editionId: edition.currentEditionId,
              editionDate: edition.currentEditionDate,
              items: [],
              itemCount: 0,
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

      const rows = await transaction
        .select({
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
        .orderBy(asc(feedItems.rank), asc(feedItems.id))
        .limit(query.limit);

      const items = rows.map((row) =>
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
          editionId: edition.currentEditionId,
          editionDate: edition.currentEditionDate,
          items,
          itemCount: items.length,
          nextCursor: null,
          activeCategory: query.category,
          generatedThrough: items.length
            ? new Date(
                Math.max(...rows.map((row) => row.researchedAt.getTime())),
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
