import { sql } from "drizzle-orm";
import { getDb, type EdisonDatabase } from "./client";

export type DemandTransaction = Parameters<
  Parameters<EdisonDatabase["transaction"]>[0]
>[0];

/**
 * Runs one reader-scoped operation as the narrow demand API role. The caller
 * must resolve `principalId` from a verified account or opaque guest token; a
 * browser-supplied principal ID is never authorization.
 */
export async function withDemandDb<T>(
  principalId: string,
  operation: (transaction: DemandTransaction) => Promise<T>,
) {
  const database = getDb();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select set_config(
        'request.edison.demand_principal_id',
        ${principalId},
        true
      )
    `);
    await transaction.execute(sql`set local role edison_demand_api`);

    return operation(transaction);
  });
}

/**
 * Runs trusted session resolution, atomic quota admission, or workflow work as
 * the isolated demand worker. This role can access only the new demand tables;
 * it is not a substitute for account membership verification.
 */
export async function withDemandWorkerDb<T>(
  operation: (transaction: DemandTransaction) => Promise<T>,
) {
  const database = getDb();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`set local role edison_demand_worker`);
    return operation(transaction);
  });
}
