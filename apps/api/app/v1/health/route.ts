import { sql } from "drizzle-orm";
import { getDb } from "@edison/db";
import { publicApiHandler, json } from "../../../src/http/api-handler";

export const dynamic = "force-dynamic";

const requiredConfiguration = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "OPENAI_WEB_SEARCH_COST_MICROUSD",
  "WEB_APP_URL",
  "CRON_SECRET",
  "CORS_ALLOWED_ORIGINS",
] as const;

async function databaseIsReady() {
  if (!process.env.DATABASE_URL) return false;
  try {
    const result = await getDb().execute(sql<{ ready: boolean }>`
      select
        to_regclass('public.profiles') is not null
        and to_regclass('public.feed_preferences') is not null
        and to_regclass('public.articles') is not null
        and to_regclass('public.article_shares') is not null
        and to_regclass('private.generation_jobs') is not null
        and to_regclass('private.usage_ledger') is not null
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.feed_items'::regclass
            and attribute.attname = 'rank'
            and format_type(attribute.atttypid, attribute.atttypmod) = 'numeric(20,6)'
        )
        and exists (
          select 1
          from pg_catalog.pg_enum enum_value
          join pg_catalog.pg_type enum_type
            on enum_type.oid = enum_value.enumtypid
          where enum_type.typname = 'command_status'
            and enum_value.enumlabel = 'no-op'
        )
        and (
          select count(*)
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.feed_commands'::regclass
            and attribute.attname in (
              'workflow_run_id',
              'lease_expires_at',
              'next_attempt_at'
            )
            and not attribute.attisdropped
        ) = 3
        and to_regclass(
          'public.feed_commands_status_next_attempt_idx'
        ) is not null
        and exists (
          select 1
          from pg_catalog.pg_roles api_role
          join pg_catalog.pg_namespace auth_schema
            on auth_schema.nspname = 'auth'
          where api_role.rolname = 'edison_api'
            and has_schema_privilege(
              api_role.oid,
              auth_schema.oid,
              'USAGE'
            )
        )
        and exists (
          select 1
          from pg_catalog.pg_roles api_role
          join pg_catalog.pg_namespace auth_schema
            on auth_schema.nspname = 'auth'
          join pg_catalog.pg_proc auth_function
            on auth_function.pronamespace = auth_schema.oid
            and auth_function.proname = 'uid'
            and auth_function.pronargs = 0
          where api_role.rolname = 'edison_api'
            and has_function_privilege(
              api_role.oid,
              auth_function.oid,
              'EXECUTE'
            )
        ) as ready
    `);
    return result[0]?.ready === true;
  } catch (error) {
    console.error("Edison readiness database check failed", { error });
    return false;
  }
}

async function authIsReady() {
  const baseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) return false;

  try {
    const healthUrl = new URL("/auth/v1/health", baseUrl);
    const response = await fetch(healthUrl, {
      headers: { apikey: publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch (error) {
    console.error("Edison readiness Auth check failed", { error });
    return false;
  }
}

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    const missingConfiguration = requiredConfiguration.filter(
      (name) => !process.env[name]?.trim(),
    );
    const [database, auth] = await Promise.all([
      databaseIsReady(),
      authIsReady(),
    ]);
    const ready = !missingConfiguration.length && database && auth;

    return json(
      {
        status: ready ? "ok" : "not_ready",
        apiVersion: "v1",
        checks: {
          configuration: missingConfiguration.length ? "failed" : "ok",
          database: database ? "ok" : "failed",
          auth: auth ? "ok" : "failed",
        },
      },
      { status: ready ? 200 : 503 },
    );
  });
}

export async function OPTIONS(request: Request) {
  return publicApiHandler(request, () => new Response(null, { status: 204 }));
}
