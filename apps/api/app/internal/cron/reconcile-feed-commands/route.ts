import { json, publicApiHandler } from "../../../../src/http/api-handler";
import { requireCronAuthorization } from "../../../../src/http/cron-auth";
import { reconcileQueuedFeedCommands } from "../../../../src/services/feed-commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    requireCronAuthorization(request);
    const result = await reconcileQueuedFeedCommands();
    return json({ ok: true, ...result });
  });
}
