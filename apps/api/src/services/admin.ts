import type { EdisonClaims } from "../auth/verify-access-token";
import { HttpError } from "../http/errors";
import { withActiveMember } from "./members";

function configuredAdminEmails() {
  return new Set(
    (process.env.EDISON_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Admin access is deliberately fail-closed: a valid reader token is not enough
 * unless its email is explicitly present in EDISON_ADMIN_EMAILS.
 */
export function requireAdmin(claims: EdisonClaims) {
  const email = claims.email?.trim().toLowerCase();
  if (!email || !configuredAdminEmails().has(email)) {
    throw new HttpError(
      403,
      "admin_access_required",
      "Administrator access is required.",
    );
  }
}

/**
 * Elevated routes require both the fail-closed operator allowlist and a live
 * membership row. Revoking the membership therefore disables admin access
 * without waiting for an already-issued access token to expire.
 */
export async function requireActiveAdmin(claims: EdisonClaims) {
  requireAdmin(claims);
  await withActiveMember(claims, async () => undefined);
}
