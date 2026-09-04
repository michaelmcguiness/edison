import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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

  const client = postgres(requireDatabaseUrl(), {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  database = drizzle(client, { schema });
  return database;
}

export type { EdisonDatabase };
