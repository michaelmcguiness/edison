import { sql } from "drizzle-orm";
import { getDb } from "@edison/db";
import { publicApiHandler, json } from "../../../src/http/api-handler";
import { safeCaughtErrorMetadata } from "../../../src/observability/safe-error";
import { productionRuntimeConfigurationIssues } from "../../../src/services/runtime-configuration";

export const dynamic = "force-dynamic";

async function databaseIsReady() {
  if (!process.env.DATABASE_URL) return false;
  try {
    const result = await getDb().execute(sql<{ ready: boolean }>`
      select
        to_regclass('public.profiles') is not null
        and to_regclass('public.feed_preferences') is not null
        and to_regclass('public.articles') is not null
        and to_regclass('public.article_shares') is not null
        and to_regclass('public.editorial_direction_states') is not null
        and to_regclass('public.editorial_instructions') is not null
        and to_regclass('public.editorial_direction_mutations') is not null
        and to_regclass('public.public_starter_editions') is not null
        and to_regclass('public.public_starter_edition_articles') is not null
        and exists (
          select 1
          from pg_catalog.pg_constraint constraint_record
          where constraint_record.conrelid = 'public.feed_preferences'::regclass
            and constraint_record.conname = 'feed_preferences_knowledge_state_bounded'
            and constraint_record.contype = 'c'
            and constraint_record.convalidated
        )
        and exists (
          select 1
          from pg_catalog.pg_trigger trigger_record
          where trigger_record.tgrelid = 'public.user_interests'::regclass
            and trigger_record.tgname = 'user_interests_retained_explicit_limit'
            and not trigger_record.tgisinternal
        )
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.editorial_direction_states'::regclass
            and attribute.attname = 'current_edition_date'
            and not attribute.attisdropped
        )
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'private.usage_ledger'::regclass
            and attribute.attname = 'pricing_status'
            and attribute.attnotnull
            and not attribute.attisdropped
        )
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'private.usage_ledger'::regclass
            and attribute.attname = 'cost_microusd'
            and not attribute.attnotnull
            and not attribute.attisdropped
        )
        and exists (
          select 1
          from pg_catalog.pg_constraint constraint_record
          where constraint_record.conrelid = 'private.usage_ledger'::regclass
            and constraint_record.conname = 'usage_ledger_pricing_consistent'
        )
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.feed_items'::regclass
            and attribute.attname = 'edition_id'
            and not attribute.attisdropped
        )
        and to_regclass(
          'public.feed_items_user_edition_category_rank_idx'
        ) is not null
        and to_regclass('private.ai_request_reservations') is not null
        and to_regclass('private.generation_jobs') is not null
        and to_regclass('private.usage_ledger') is not null
        and (
          select count(*)
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'private.usage_ledger'::regclass
            and attribute.attname in (
              'ai_request_reservation_id',
              'provider_response_id'
            )
            and not attribute.attisdropped
        ) = 2
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'private.ai_request_reservations'::regclass
            and attribute.attname = 'request_snapshot'
            and not attribute.attisdropped
        )
        and exists (
          select 1
          from pg_catalog.pg_trigger trigger_record
          where trigger_record.tgrelid = 'private.ai_request_reservations'::regclass
            and trigger_record.tgname = 'ai_request_reservations_identity_immutable'
            and not trigger_record.tgisinternal
        )
        and to_regclass(
          'private.usage_ledger_provider_response_unique'
        ) is not null
        and exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.feed_items'::regclass
            and attribute.attname = 'rank'
            and format_type(attribute.atttypid, attribute.atttypmod) = 'numeric(20,6)'
        )
        and exists (
          select 1
          from pg_catalog.pg_roles public_role
          where public_role.rolname = 'edison_public'
            and has_table_privilege(
              public_role.oid,
              'public.public_starter_editions',
              'SELECT'
            )
            and has_table_privilege(
              public_role.oid,
              'public.public_starter_edition_articles',
              'SELECT'
            )
        )
        and exists (
          select 1
          from pg_catalog.pg_roles public_role
          join pg_catalog.pg_namespace public_api_schema
            on public_api_schema.nspname = 'edison_public_api'
          join pg_catalog.pg_proc share_reader
            on share_reader.oid = to_regprocedure(
              'edison_public_api.read_article_share(text)'
            )
          where public_role.rolname = 'edison_public'
            and has_schema_privilege(
              public_role.oid,
              public_api_schema.oid,
              'USAGE'
            )
            and has_function_privilege(
              public_role.oid,
              share_reader.oid,
              'EXECUTE'
            )
            and not has_table_privilege(
              public_role.oid,
              'public.article_shares',
              'SELECT'
            )
            and not has_table_privilege(
              public_role.oid,
              'public.alpha_memberships',
              'SELECT'
            )
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
          join pg_catalog.pg_namespace private_schema
            on private_schema.nspname = 'private'
          where api_role.rolname = 'edison_api'
            and has_schema_privilege(
              api_role.oid,
              private_schema.oid,
              'USAGE'
            )
            and has_table_privilege(
              api_role.oid,
              'private.ai_request_reservations',
              'SELECT'
            )
            and has_table_privilege(
              api_role.oid,
              'private.ai_request_reservations',
              'INSERT'
            )
            and not has_table_privilege(
              api_role.oid,
              'private.ai_request_reservations',
              'UPDATE'
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
    console.error(
      "Edison readiness database check failed",
      safeCaughtErrorMetadata(error),
    );
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
    console.error(
      "Edison readiness Auth check failed",
      safeCaughtErrorMetadata(error),
    );
    return false;
  }
}

export async function GET(request: Request) {
  return publicApiHandler(request, async () => {
    const configurationIssues = productionRuntimeConfigurationIssues();
    const [database, auth] = await Promise.all([
      databaseIsReady(),
      authIsReady(),
    ]);
    const ready = !configurationIssues.length && database && auth;

    return json(
      {
        status: ready ? "ok" : "not_ready",
        apiVersion: "v1",
        checks: {
          configuration: configurationIssues.length ? "failed" : "ok",
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
