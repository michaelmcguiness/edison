import { and, asc, eq, isNull } from "drizzle-orm";
import { articleSchema, uuidSchema } from "@edison/contracts";
import {
  articleShares,
  articleSources,
  articles,
  profiles,
  readingEvents,
  savedArticles,
} from "@edison/db";
import { sql } from "drizzle-orm";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import { withActiveMember } from "../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ articleId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);

    return withActiveMember(claims, async ({ transaction }) => {
      const [row] = await transaction
        .select({
          article: articles,
          displayName: profiles.displayName,
          email: profiles.email,
          shareId: articleShares.id,
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
        .from(articles)
        .innerJoin(profiles, eq(profiles.id, articles.ownerId))
        .leftJoin(
          articleShares,
          and(
            eq(articleShares.articleId, articles.id),
            isNull(articleShares.revokedAt),
          ),
        )
        .where(
          and(
            eq(articles.id, articleId),
            eq(articles.ownerId, claims.sub),
            eq(articles.status, "published"),
          ),
        )
        .limit(1);

      if (!row) {
        throw new HttpError(404, "article_not_found", "That article was not found.");
      }

      const sources = await transaction
        .select()
        .from(articleSources)
        .where(eq(articleSources.articleId, articleId))
        .orderBy(asc(articleSources.citationOrder));

      return json(
        articleSchema.parse({
          id: row.article.id,
          slug: row.article.slug,
          category: row.article.category,
          kicker: row.article.kicker,
          topic: row.article.topic,
          title: row.article.title,
          deck: row.article.deck,
          body: row.article.body,
          summary: row.article.summary,
          whyWritten: row.article.whyWritten,
          readingMinutes: row.article.readingMinutes,
          sourceCount: row.article.sourceCount,
          researchedAt: row.article.researchedAt.toISOString(),
          reason: row.article.whyWritten,
          saved: row.saved,
          completed: row.completed,
          writtenFor: row.displayName || row.email.split("@")[0] || "Reader",
          shareId: row.shareId,
          sources: sources.map((source) => ({
            id: source.id,
            title: source.title,
            publisher: source.publisher,
            url: source.url,
            publishedAt: source.publishedAt?.toISOString() ?? null,
            accessedAt: source.accessedAt.toISOString(),
          })),
        }),
      );
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
