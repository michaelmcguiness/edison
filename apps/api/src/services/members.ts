import { and, eq } from "drizzle-orm";
import {
  alphaMemberships,
  profiles,
  withUserDb,
  type UserTransaction,
  type VerifiedUserClaims,
} from "@edison/db";
import { HttpError } from "../http/errors";

export async function withActiveMember<T>(
  claims: VerifiedUserClaims,
  operation: (input: {
    transaction: UserTransaction;
    profile: typeof profiles.$inferSelect;
  }) => Promise<T>,
) {
  return withUserDb(claims, async (transaction) => {
    const [row] = await transaction
      .select({ profile: profiles, membership: alphaMemberships })
      .from(profiles)
      .innerJoin(
        alphaMemberships,
        and(
          eq(alphaMemberships.userId, profiles.id),
          eq(alphaMemberships.status, "active"),
        ),
      )
      .where(eq(profiles.id, claims.sub))
      .limit(1);

    if (!row) {
      throw new HttpError(
        403,
        "alpha_access_required",
        "This account is not part of the Edison private alpha.",
      );
    }

    return operation({ transaction, profile: row.profile });
  });
}
