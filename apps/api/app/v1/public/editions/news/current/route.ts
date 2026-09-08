import { publicStarterEditionSchema } from "@edison/contracts";
import {
  json,
  memberApiHandler,
} from "../../../../../../src/http/api-handler";
import { getCurrentPublicNewsEdition } from "../../../../../../src/services/public-starter-editions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return memberApiHandler(request, async () =>
    json(publicStarterEditionSchema.parse(await getCurrentPublicNewsEdition())),
  );
}

export async function OPTIONS(request: Request) {
  return memberApiHandler(request, async () =>
    new Response(null, { status: 204 }),
  );
}
