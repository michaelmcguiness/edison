import { timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors";

export function requireCronAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new HttpError(
      503,
      "cron_not_configured",
      "Scheduled jobs are not configured.",
    );
  }

  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new HttpError(
      401,
      "invalid_cron_secret",
      "Valid cron authorization is required.",
    );
  }
}
