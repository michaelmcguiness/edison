import { json, publicApiHandler } from "../../../../src/http/api-handler";
import { requireCronAuthorization } from "../../../../src/http/cron-auth";
import { reconcileQueuedGenerationJobs } from "../../../../src/services/generation-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    requireCronAuthorization(request);
    const result = await reconcileQueuedGenerationJobs();
    return json({ ok: true, ...result });
  });
}
