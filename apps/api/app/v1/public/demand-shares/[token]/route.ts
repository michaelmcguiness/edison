import { demandShareTokenSchema, publicDemandArticleShareSchema } from "@edison/contracts";
import { json, publicApiHandler } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { getDemandArticleShare } from "../../../../../src/services/demand-sharing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return publicApiHandler(request, async () => {
    const { token } = await context.params;
    if (new URL(request.url).searchParams.size || !demandShareTokenSchema.safeParse(token).success) {
      throw new HttpError(404, "share_not_found", "That public article was not found.");
    }
    const share = await getDemandArticleShare(token);
    if (!share) throw new HttpError(404, "share_not_found", "That public article was not found.");
    return json(publicDemandArticleShareSchema.parse(share), { headers: { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
  });
}
