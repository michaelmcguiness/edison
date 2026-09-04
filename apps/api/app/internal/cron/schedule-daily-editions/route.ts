import { json, publicApiHandler } from "../../../../src/http/api-handler";
import { requireCronAuthorization } from "../../../../src/http/cron-auth";
import { HttpError } from "../../../../src/http/errors";
import { scheduleDailyEditions } from "../../../../src/services/daily-editions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    requireCronAuthorization(request);
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
