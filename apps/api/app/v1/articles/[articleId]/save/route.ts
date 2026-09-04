import { and, eq } from "drizzle-orm";
import { uuidSchema } from "@edison/contracts";
import { articles, savedArticles, type UserTransaction } from "@edison/db";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { withActiveMember } from "../../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ articleId: string }> };

async function requireOwnedArticle(
  transaction: UserTransaction,
  userId: string,
  articleId: string,
) {
  const [article] = await transaction
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.ownerId, userId)))
    .limit(1);
  if (!article) {
    throw new HttpError(404, "article_not_found", "That article was not found.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);

    return withActiveMember(claims, async ({ transaction }) => {
      await requireOwnedArticle(transaction, claims.sub, articleId);
      await transaction
        .insert(savedArticles)
        .values({ userId: claims.sub, articleId })
        .onConflictDoNothing();
      return json({ saved: true });
    });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);

    return withActiveMember(claims, async ({ transaction }) => {
      await requireOwnedArticle(transaction, claims.sub, articleId);
      await transaction
        .delete(savedArticles)
        .where(
          and(
            eq(savedArticles.userId, claims.sub),
            eq(savedArticles.articleId, articleId),
          ),
        );
      return json({ saved: false });
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
