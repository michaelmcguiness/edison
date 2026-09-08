import { publicStarterArticleSchema, uuidSchema } from "@edison/contracts";
import { json, memberApiHandler } from "../../../../../src/http/api-handler";
import { getPublicStarterArticle } from "../../../../../src/services/public-starter-editions";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ articleId: string }> },
) {
  return memberApiHandler(request, async () => {
    const { articleId } = await context.params;
    const id = uuidSchema.parse(articleId);
    return json(
      publicStarterArticleSchema.parse(await getPublicStarterArticle(id)),
    );
  });
}

export async function OPTIONS(request: Request) {
  return memberApiHandler(request, async () =>
    new Response(null, { status: 204 }),
  );
}
