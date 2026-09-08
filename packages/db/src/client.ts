import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveDatabaseConnectionPolicy } from "./database-connection-policy.mjs";
import * as schema from "./schema";

type EdisonDatabase = PostgresJsDatabase<typeof schema>;

let database: EdisonDatabase | undefined;

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  return url;
}

export function getDb(): EdisonDatabase {
  if (database) return database;

  const connection = resolveDatabaseConnectionPolicy(requireDatabaseUrl(), {
    production: process.env.NODE_ENV === "production",
  });
  const client = postgres(connection.connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ...(connection.ssl === undefined ? {} : { ssl: connection.ssl }),
  });

  database = drizzle(client, { schema });
  return database;
}

export type { EdisonDatabase };
