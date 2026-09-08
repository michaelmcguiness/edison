import {
  deleteEditorialInstructionRequestSchema,
  editorialDirectionMutationResponseSchema,
  updateEditorialInstructionRequestSchema,
  uuidSchema,
} from "@edison/contracts";
import { apiHandler, json } from "../../../../src/http/api-handler";
import {
  deleteEditorialInstruction,
  updateEditorialInstruction,
} from "../../../../src/services/editorial-directions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ instructionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { instructionId: rawInstructionId } = await context.params;
    const instructionId = uuidSchema.parse(rawInstructionId);
    const input = updateEditorialInstructionRequestSchema.parse(
      await request.json(),
    );
    return json(
      editorialDirectionMutationResponseSchema.parse(
        await updateEditorialInstruction(claims, instructionId, input),
      ),
    );
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { instructionId: rawInstructionId } = await context.params;
    const instructionId = uuidSchema.parse(rawInstructionId);
    const input = deleteEditorialInstructionRequestSchema.parse(
      await request.json(),
    );
    return json(
      editorialDirectionMutationResponseSchema.parse(
        await deleteEditorialInstruction(claims, instructionId, input),
      ),
    );
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
