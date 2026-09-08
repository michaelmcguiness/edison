import {
  publicStarterEditionSchema,
  publishPublicStarterEditionRequestSchema,
} from "@edison/contracts";
import {
  apiHandler,
  json,
  readJsonBody,
} from "../../../../src/http/api-handler";
import { requireActiveAdmin } from "../../../../src/services/admin";
import { publishPublicNewsEdition } from "../../../../src/services/public-starter-editions";

export const dynamic = "force-dynamic";
const maxPublicStarterRequestBytes = 2 * 1024 * 1024;

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    await requireActiveAdmin(claims);
    const input = publishPublicStarterEditionRequestSchema.parse(
      await readJsonBody(request, maxPublicStarterRequestBytes),
    );
    const result = await publishPublicNewsEdition(input);
    return json(publicStarterEditionSchema.parse(result.edition), {
      status: result.replayed ? 200 : 201,
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
