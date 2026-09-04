import { randomBytes } from "node:crypto";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  articleBlockSchema,
  articleSourceSchema,
  shareArticleResponseSchema,
  sharedArticleSnapshotSchema,
  uuidSchema,
} from "@edison/contracts";
import {
  articleShares,
  articleSources,
  articles,
  type UserTransaction,
} from "@edison/db";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { withActiveMember } from "../../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ articleId: string }> };

function createShareSlug() {
  return randomBytes(16).toString("hex");
}

function requireWebAppUrl() {
  const configured = process.env.WEB_APP_URL;
  if (!configured) {
    throw new HttpError(
      503,
      "web_app_not_configured",
      "Article sharing is unavailable until the web application URL is configured.",
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new HttpError(
      503,
      "web_app_not_configured",
      "Article sharing is unavailable because the web application URL is invalid.",
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new HttpError(
      503,
      "web_app_not_configured",
      "Article sharing requires an HTTP or HTTPS web application URL.",
    );
  }
  return url;
}

function publicShareUrl(webAppUrl: URL, slug: string) {
  const url = new URL(webAppUrl);
  url.pathname = `/share/${slug}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function findShare(
  transaction: UserTransaction,
  userId: string,
  articleId: string,
) {
  const [share] = await transaction
    .select()
    .from(articleShares)
    .where(
      and(
        eq(articleShares.userId, userId),
        eq(articleShares.articleId, articleId),
      ),
    )
    .limit(1);
  return share;
}

export async function POST(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);
    const webAppUrl = requireWebAppUrl();

    return withActiveMember(
      claims,
      async ({ transaction }) => {
        const [article] = await transaction
          .select()
          .from(articles)
          .where(
            and(
              eq(articles.id, articleId),
              eq(articles.ownerId, claims.sub),
              eq(articles.status, "published"),
            ),
          )
          .limit(1);

        if (!article) {
          throw new HttpError(
            404,
            "article_not_found",
            "That article was not found.",
          );
        }

        const sources = await transaction
          .select()
          .from(articleSources)
          .where(eq(articleSources.articleId, articleId))
          .orderBy(asc(articleSources.citationOrder));

        // Build the snapshot field-by-field. Parsing this strict schema before
        // persistence makes accidentally adding personalization data a failure,
        // rather than a public-data leak.
        const snapshot = sharedArticleSnapshotSchema.parse({
          version: 1,
          category: article.category,
          kicker: article.kicker,
          topic: article.topic,
          title: article.title,
          deck: article.deck,
          body: articleBlockSchema.array().parse(article.body),
          summary: article.summary,
          readingMinutes: article.readingMinutes,
          sourceCount: article.sourceCount,
          researchedAt: article.researchedAt.toISOString(),
          publishedAt: article.publishedAt?.toISOString() ?? null,
          sources: sources.map((source) =>
            articleSourceSchema.parse({
              id: source.id,
              title: source.title,
              publisher: source.publisher,
              url: source.url,
              publishedAt: source.publishedAt?.toISOString() ?? null,
              accessedAt: source.accessedAt.toISOString(),
            }),
          ),
        });

        const existing = await findShare(transaction, claims.sub, articleId);
        if (existing) {
          if (existing.revokedAt) {
            const [reactivated] = await transaction
              .update(articleShares)
              .set({
                slug: createShareSlug(),
                snapshot,
                revokedAt: null,
                createdAt: new Date(),
              })
              .where(
                and(
                  eq(articleShares.id, existing.id),
                  eq(articleShares.userId, claims.sub),
                  isNotNull(articleShares.revokedAt),
                ),
              )
              .returning();

            if (reactivated) {
              return json(
                shareArticleResponseSchema.parse({
                  shareId: reactivated.id,
                  url: publicShareUrl(webAppUrl, reactivated.slug),
                  created: true,
                }),
              );
            }

            const raced = await findShare(
              transaction,
              claims.sub,
              articleId,
            );
            if (raced && !raced.revokedAt) {
              return json(
                shareArticleResponseSchema.parse({
                  shareId: raced.id,
                  url: publicShareUrl(webAppUrl, raced.slug),
                  created: false,
                }),
              );
            }
            throw new HttpError(
              409,
              "share_state_changed",
              "The article's share state changed. Please try again.",
            );
          }

          return json(
            shareArticleResponseSchema.parse({
              shareId: existing.id,
              url: publicShareUrl(webAppUrl, existing.slug),
              created: false,
            }),
          );
        }

        // A slug collision is fantastically unlikely, but a bounded retry also
        // cleanly handles a simultaneous request creating the per-article share.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const [created] = await transaction
            .insert(articleShares)
            .values({
              articleId,
              userId: claims.sub,
              slug: createShareSlug(),
              snapshot,
            })
            .onConflictDoNothing()
            .returning();

          if (created) {
            return json(
              shareArticleResponseSchema.parse({
                shareId: created.id,
                url: publicShareUrl(webAppUrl, created.slug),
                created: true,
              }),
              { status: 201 },
            );
          }

          const raced = await findShare(transaction, claims.sub, articleId);
          if (raced && !raced.revokedAt) {
            return json(
              shareArticleResponseSchema.parse({
                shareId: raced.id,
                url: publicShareUrl(webAppUrl, raced.slug),
                created: false,
              }),
            );
          }
          if (raced?.revokedAt) {
            throw new HttpError(
              409,
              "share_revoked",
              "This article's share has been revoked.",
            );
          }
        }

        throw new HttpError(
          500,
          "share_creation_failed",
          "Edison could not create the article share.",
        );
      },
    );
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);
    await withActiveMember(claims, async ({ transaction }) => {
      await transaction
        .update(articleShares)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(articleShares.userId, claims.sub),
            eq(articleShares.articleId, articleId),
            isNull(articleShares.revokedAt),
          ),
        );
    });

    return new Response(null, { status: 204 });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
