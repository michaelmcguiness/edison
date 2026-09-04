import { and, eq } from "drizzle-orm";
import { articleFeedbackRequestSchema, uuidSchema } from "@edison/contracts";
import { articleFeedback, articles } from "@edison/db";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { withActiveMember } from "../../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ articleId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);
    const input = articleFeedbackRequestSchema.parse(await request.json());

    return withActiveMember(claims, async ({ transaction }) => {
      const [article] = await transaction
        .select({ id: articles.id })
        .from(articles)
        .where(and(eq(articles.id, articleId), eq(articles.ownerId, claims.sub)))
        .limit(1);
      if (!article) {
        throw new HttpError(404, "article_not_found", "That article was not found.");
      }

      await transaction
        .insert(articleFeedback)
        .values({
          userId: claims.sub,
          articleId,
          worthYourTime: input.worthYourTime,
        })
        .onConflictDoUpdate({
          target: [articleFeedback.userId, articleFeedback.articleId],
          set: { worthYourTime: input.worthYourTime },
        });

      return json({ worthYourTime: input.worthYourTime });
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
