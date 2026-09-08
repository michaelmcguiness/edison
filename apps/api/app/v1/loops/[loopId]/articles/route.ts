import {
  learningLoopArticlesQuerySchema,
  learningLoopArticlesResponseSchema,
  uuidSchema,
} from "@edison/contracts";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { listLearningLoopArticles } from "../../../../../src/services/learning-loops";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ loopId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { loopId: rawLoopId } = await context.params;
    const loopId = uuidSchema.parse(rawLoopId);
    const url = new URL(request.url);
    const query = learningLoopArticlesQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return json(
      learningLoopArticlesResponseSchema.parse(
        await listLearningLoopArticles(claims, loopId, query.limit),
      ),
    );
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
