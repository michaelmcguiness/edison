import {
  editorialDirectionMutationResponseSchema,
  undoEditorialDirectionRequestSchema,
  uuidSchema,
} from "@edison/contracts";
import { apiHandler, json } from "../../../../../../src/http/api-handler";
import { undoEditorialDirectionMutation } from "../../../../../../src/services/editorial-directions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ mutationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { mutationId: rawMutationId } = await context.params;
    const mutationId = uuidSchema.parse(rawMutationId);
    const input = undoEditorialDirectionRequestSchema.parse(
      await request.json(),
    );
    return json(
      editorialDirectionMutationResponseSchema.parse(
        await undoEditorialDirectionMutation(claims, mutationId, input),
      ),
    );
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
