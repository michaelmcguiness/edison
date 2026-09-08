import { json, publicApiHandler } from "../../../../src/http/api-handler";
import { requireCronAuthorization } from "../../../../src/http/cron-auth";
import { HttpError } from "../../../../src/http/errors";
import { scheduleDailyEditions } from "../../../../src/services/daily-editions";
import { demandEnabled } from "../../../../src/services/demand-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    requireCronAuthorization(request);
    if (demandEnabled()) return json({ ok: true, skipped: "on-demand-reading" });
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(
        503,
        "ai_not_configured",
        "Daily editions are unavailable until OpenAI is configured.",
      );
    }
    const result = await scheduleDailyEditions();
    return json({ ok: true, ...result });
  });
}
