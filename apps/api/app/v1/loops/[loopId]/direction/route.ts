import {
  learningLoopDirectionRequestSchema,
  learningLoopMutationResponseSchema,
  uuidSchema,
} from "@edison/contracts";
import {
  apiHandler,
  json,
  readJsonBody,
} from "../../../../../src/http/api-handler";
import { mutateLearningLoopDirection } from "../../../../../src/services/learning-loops";

export const dynamic = "force-dynamic";

const MAX_DIRECTION_BODY_BYTES = 2_048;

type RouteContext = { params: Promise<{ loopId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { loopId: rawLoopId } = await context.params;
    const loopId = uuidSchema.parse(rawLoopId);
    const input = learningLoopDirectionRequestSchema.parse(
      await readJsonBody(request, MAX_DIRECTION_BODY_BYTES),
    );
    return json(
      learningLoopMutationResponseSchema.parse(
        await mutateLearningLoopDirection(claims, loopId, input),
      ),
    );
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
