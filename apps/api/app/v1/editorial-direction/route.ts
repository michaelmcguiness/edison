import {
  createEditorialInstructionRequestSchema,
  editorialDirectionMutationResponseSchema,
  editorialDirectionResponseSchema,
} from "@edison/contracts";
import { apiHandler, json } from "../../../src/http/api-handler";
import {
  createEditorialInstruction,
  listEditorialDirections,
} from "../../../src/services/editorial-directions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) =>
    json(editorialDirectionResponseSchema.parse(await listEditorialDirections(claims))),
  );
}

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = createEditorialInstructionRequestSchema.parse(
      await request.json(),
    );
    const result = editorialDirectionMutationResponseSchema.parse(
      await createEditorialInstruction(claims, input),
    );
    return json(result, { status: result.replayed ? 200 : 201 });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
