import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { demandPrincipals, withDemandWorkerDb } from "@edison/db";
import { verifyAccessToken } from "./verify-access-token";
import { withActiveMember } from "../services/members";
import { HttpError } from "../http/errors";
import { demandLimits, requireDemandEnabled } from "../services/demand-configuration";

export type DemandPrincipal = typeof demandPrincipals.$inferSelect;
export const DEMAND_TOKEN_HEADER = "x-edison-demand-token";

export function hashDemandToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "guest_session_invalid", "This browser's reading session is not valid.");
  return createHash("sha256").update(token).digest("hex");
}

export function assertDemandPrincipalActive(principal: Pick<DemandPrincipal, "revokedAt" | "expiresAt">, now = new Date()) {
  if (principal.revokedAt || (principal.expiresAt && principal.expiresAt <= now)) {
    throw new HttpError(401, "reading_session_expired", "This reading session is no longer available.");
  }
}

/** Never accepts a caller-supplied principal ID or downgrades a rejected account. */
export async function resolveDemandPrincipal(request: Request, create = false): Promise<{
  principal: DemandPrincipal; newGuestToken?: string;
}> {
  requireDemandEnabled();
  const authorization = request.headers.get("authorization");
  let accountUserId: string | null = null;
  if (authorization) {
    const claims = await verifyAccessToken(authorization);
    await withActiveMember(claims, async () => undefined);
    accountUserId = claims.sub;
  }
  const token = accountUserId ? null : request.headers.get(DEMAND_TOKEN_HEADER);
  const tokenHash = token ? hashDemandToken(token) : null;
  if (!accountUserId && !tokenHash && !create) {
    throw new HttpError(401, "reading_session_required", "Start a reading session to continue.");
  }

  return withDemandWorkerDb(async (tx) => {
    if (create) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission', 0))`);
    if (accountUserId || tokenHash) {
      const [existing] = await tx.select().from(demandPrincipals).where(accountUserId
        ? eq(demandPrincipals.accountUserId, accountUserId)
        : eq(demandPrincipals.guestTokenHash, tokenHash!)).limit(1);
      if (existing) { assertDemandPrincipalActive(existing); return { principal: existing }; }
      // A missing supplied token must never silently create an unrelated new
      // session and hide the loss of the original guest's saved work.
      if (tokenHash) throw new HttpError(401, "guest_session_invalid", "This browser's reading session is not valid.");
    }
    if (!create) throw new HttpError(401, "reading_session_required", "Start a reading session to continue.");
    const [{ recent }] = await tx.select({ recent: count() }).from(demandPrincipals)
      .where(and(gte(demandPrincipals.createdAt, new Date(Date.now() - 86_400_000))));
    if (recent >= demandLimits().dailySessions) {
      throw new HttpError(429, "reading_session_limit", "New reading sessions are at capacity. Please try later.");
    }
    const newGuestToken = accountUserId ? undefined : randomBytes(32).toString("hex");
    const [principal] = await tx.insert(demandPrincipals).values({
      accountUserId, guestTokenHash: newGuestToken ? hashDemandToken(newGuestToken) : null,
      expiresAt: accountUserId ? null : new Date(Date.now() + 90 * 86_400_000),
    }).returning();
    if (!principal) throw new Error("demand_principal_not_created");
    return { principal, ...(newGuestToken ? { newGuestToken } : {}) };
  });
}
