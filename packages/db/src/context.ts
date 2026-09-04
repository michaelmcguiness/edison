import { sql } from "drizzle-orm";
import { getDb, type EdisonDatabase } from "./client";

export type VerifiedUserClaims = {
  sub: string;
  email?: string;
  role: "authenticated";
  aud?: string | string[];
  exp?: number;
  [key: string]: unknown;
};

export type UserTransaction = Parameters<
  Parameters<EdisonDatabase["transaction"]>[0]
>[0];

export async function withUserDb<T>(
  claims: VerifiedUserClaims,
  operation: (transaction: UserTransaction) => Promise<T>,
) {
  const database = getDb();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select set_config(
        'request.jwt.claims',
        ${JSON.stringify(claims)},
        true
      )
    `);
    await transaction.execute(sql`
      select set_config('request.jwt.claim.sub', ${claims.sub}, true)
    `);
    // Browser/mobile JWTs use Supabase's `authenticated` role for Auth only.
    // The non-login API role has narrowly granted core-table access and remains
    // subject to the same auth.uid()-based RLS policies.
    await transaction.execute(sql`set local role edison_api`);

    return operation(transaction);
  });
}

export async function withPublicDb<T>(
  operation: (transaction: UserTransaction) => Promise<T>,
) {
  const database = getDb();

  return database.transaction(async (transaction) => {
    // Public reads run as a deliberately narrow non-login role. Keeping this
    // separate from the connection owner makes a route bug fail closed instead
    // of exposing reader-owned rows.
    await transaction.execute(sql`set local role edison_public`);
    return operation(transaction);
  });
}
