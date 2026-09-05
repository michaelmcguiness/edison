import {
  createLearningLoopRequestSchema,
  learningLoopResponseSchema,
  learningLoopsResponseSchema,
} from "@edison/contracts";
import {
  apiHandler,
  json,
  readJsonBody,
} from "../../../src/http/api-handler";
import {
  createLearningLoop,
  listLearningLoops,
} from "../../../src/services/learning-loops";

export const dynamic = "force-dynamic";

const MAX_CREATE_LOOP_BODY_BYTES = 4_096;

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) =>
    json(learningLoopsResponseSchema.parse(await listLearningLoops(claims))),
  );
}

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = createLearningLoopRequestSchema.parse(
      await readJsonBody(request, MAX_CREATE_LOOP_BODY_BYTES),
    );
    const result = learningLoopResponseSchema.parse(
      await createLearningLoop(claims, input),
    );
    return json(result, { status: result.replayed ? 200 : 201 });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
