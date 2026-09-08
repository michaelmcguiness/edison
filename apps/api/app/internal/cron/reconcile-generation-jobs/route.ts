import { json, publicApiHandler } from "../../../../src/http/api-handler";
import { requireCronAuthorization } from "../../../../src/http/cron-auth";
import { reconcileQueuedGenerationJobs } from "../../../../src/services/generation-jobs";
import { demandEnabled } from "../../../../src/services/demand-configuration";
import { reconcileDemandRequests } from "../../../../src/services/demand-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    requireCronAuthorization(request);
    const result = await reconcileQueuedGenerationJobs();
    const onDemand = demandEnabled() ? await reconcileDemandRequests() : null;
    return json({ ok: true, ...result, ...(onDemand ? { onDemand } : {}) });
  });
}
