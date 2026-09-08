begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('private', 'demand_usage', 'observed_usage',
  'observed provider metadata belongs to the private append-only usage receipt');
select col_type_is('private', 'demand_usage', 'observed_usage', 'jsonb',
  'observed provider metadata uses JSONB');
select ok((select not attnotnull and not atthasdef and attmissingval is null
  from pg_catalog.pg_attribute
  where attrelid = 'private.demand_usage'::regclass and attname = 'observed_usage' and not attisdropped),
  'the additive column is nullable with no default or synthesized historical value');
select ok((select attacl is null from pg_catalog.pg_attribute
  where attrelid = 'private.demand_usage'::regclass and attname = 'observed_usage' and not attisdropped),
  'the additive column introduces no separate column grants');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid = 'private.demand_usage'::regclass),
  'provider usage still enables and forces RLS');
select results_eq(
  $$select polname::text collate "C" from pg_catalog.pg_policy where polrelid = 'private.demand_usage'::regclass order by 1$$,
  $$values ('demand_usage_worker_insert'::text collate "C"), ('demand_usage_worker_select'::text collate "C")$$,
  'only the original worker INSERT and SELECT usage policies exist');
select ok(has_column_privilege('edison_demand_worker', 'private.demand_usage', 'observed_usage', 'select')
  and has_column_privilege('edison_demand_worker', 'private.demand_usage', 'observed_usage', 'insert')
  and not has_column_privilege('edison_demand_worker', 'private.demand_usage', 'observed_usage', 'update')
  and not has_table_privilege('edison_demand_worker', 'private.demand_usage', 'delete'),
  'the worker can append and read metadata but cannot update or delete receipts');
select ok(not has_column_privilege(role_name, 'private.demand_usage', 'observed_usage', 'select')
  and not has_column_privilege(role_name, 'private.demand_usage', 'observed_usage', 'insert')
  and not has_column_privilege(role_name, 'private.demand_usage', 'observed_usage', 'update'),
  role_name || ' receives no access to observed provider metadata')
from (values ('anon'), ('authenticated'), ('service_role'), ('edison_api'), ('edison_public'), ('edison_demand_api')) roles(role_name);
select ok(not exists(select 1 from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(relation.relacl) privilege
  where relation.oid = 'private.demand_usage'::regclass and privilege.grantee = 0),
  'PUBLIC receives no usage-table privileges');

-- Historical guest identity is only an inert foreign-key fixture. No account,
-- membership, request dispatch or provider is created or invoked by this test.
insert into private.demand_principals(id, guest_token_hash, expires_at, created_at)
values ('8f100000-0000-4000-8000-000000000001', repeat('f', 64), '2021-01-01T00:00:00Z', '2020-01-01T00:00:00Z');
insert into private.demand_loops(id, principal_id, title, original_curiosity)
values ('8f200000-0000-4000-8000-000000000001', '8f100000-0000-4000-8000-000000000001',
  'Constructed usage proof', 'How is a late response accounted for?');
insert into private.demand_requests(id, principal_id, loop_id, kind, stage, idempotency_key, request_fingerprint, snapshot, reserved_microusd)
values ('8f300000-0000-4000-8000-000000000001', '8f100000-0000-4000-8000-000000000001',
  '8f200000-0000-4000-8000-000000000001', 'question', 'answering', 'observed-usage-fixture', repeat('a', 64), '{"version":2}', 250000);
insert into private.demand_stages(id, principal_id, request_id, stage_key, request_fingerprint, snapshot, status, lease_expires_at)
values ('8f400000-0000-4000-8000-000000000001', '8f100000-0000-4000-8000-000000000001',
  '8f300000-0000-4000-8000-000000000001', 'answer:observed-usage', repeat('b', 64), '{"version":1}',
  'uncertain', '2026-09-08T00:00:00Z');

-- Test-only access to pgTAP functions, rolled back with every fixture below.
grant usage on schema extensions to edison_demand_worker;
set local role edison_demand_worker;

select extensions.lives_ok($$
  insert into private.demand_usage(id, principal_id, request_id, stage_id, response_id, model,
    input_tokens, cached_input_tokens, output_tokens, search_calls, cost_microusd, pricing_status)
  values ('8f500000-0000-4000-8000-000000000001', '8f100000-0000-4000-8000-000000000001',
    '8f300000-0000-4000-8000-000000000001', '8f400000-0000-4000-8000-000000000001',
    'resp-observed-legacy', 'gpt-5.6-luna', 100, 10, 20, 1, 123, 'priced')
$$, 'an unchanged pre-column INSERT still records a bill after uncertainty');
select extensions.ok((select observed_usage is null and cost_microusd = 123 and input_tokens = 100
  from private.demand_usage where response_id = 'resp-observed-legacy'),
  'legacy receipt metadata remains SQL NULL without fabricating or rewriting accounting');

-- Optional tier states are retained as evidence, not inferred from the request.
-- SQL binds the required metering core; the runtime schema validates optional
-- search/tier types before INSERT. Unknown nonempty tiers must remain recordable.
with cases(label, extra, cost, pricing) as (values
  ('priority', '{"serviceTier":"priority","webSearchCalls":1,"webSearchToolCalls":2,"webSearchPricingStatus":"priced"}'::jsonb, 123, 'priced'),
  ('default', '{"serviceTier":"default"}'::jsonb, 123, 'priced'),
  ('null', '{"serviceTier":null}'::jsonb, null::integer, 'unpriced'),
  ('absent', '{}'::jsonb, 123, 'priced'),
  ('unknown', '{"serviceTier":"future-tier"}'::jsonb, null::integer, 'unpriced')
), payloads as (select label, cost, pricing, 'resp-observed-' || label as response_id,
  jsonb_build_object('providerResponseId', 'resp-observed-' || label, 'model', 'gpt-5.6-luna',
    'inputTokens', 100, 'cachedInputTokens', 10, 'outputTokens', 20) || extra as payload from cases)
select extensions.lives_ok(format($insert$
  insert into private.demand_usage(principal_id, request_id, stage_id, response_id, model,
    input_tokens, cached_input_tokens, output_tokens, search_calls, cost_microusd, pricing_status, observed_usage)
  values ('8f100000-0000-4000-8000-000000000001', '8f300000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000001', %L, 'gpt-5.6-luna', 100, 10, 20, 1, %L::integer, %L, %L::jsonb)
$insert$, response_id, cost, pricing, payload::text), 'worker appends actual ' || label || ' tier evidence without editing the terminal stage')
from payloads;

select extensions.is((select observed_usage from private.demand_usage where response_id = 'resp-observed-priority'),
  '{"providerResponseId":"resp-observed-priority","model":"gpt-5.6-luna","inputTokens":100,"cachedInputTokens":10,"outputTokens":20,"webSearchCalls":1,"webSearchToolCalls":2,"webSearchPricingStatus":"priced","serviceTier":"priority"}'::jsonb,
  'the worker reads the exact retained token, tool and actual-tier metadata');
select extensions.ok((select not observed_usage ? 'serviceTier' from private.demand_usage where response_id = 'resp-observed-absent')
  and (select observed_usage -> 'serviceTier' = 'null'::jsonb from private.demand_usage where response_id = 'resp-observed-null'),
  'historical tier absence remains distinct from explicitly unknown tier metadata');
select extensions.ok((select count(*) = 2 and bool_and(cost_microusd is null and pricing_status = 'unpriced')
  from private.demand_usage where response_id in ('resp-observed-null', 'resp-observed-unknown')),
  'missing and unknown actual tiers can retain an unpriced receipt without inventing a zero bill');

with core as (select '{"providerResponseId":"resp-observed-invalid","model":"gpt-5.6-luna","inputTokens":100,"cachedInputTokens":10,"outputTokens":20}'::jsonb as payload),
required_fields(key) as (values ('providerResponseId'), ('model'), ('inputTokens'), ('cachedInputTokens'), ('outputTokens')),
invalid(label, payload) as (
  select 'JSON null', 'null'::jsonb union all
  select 'array', '[]'::jsonb union all
  select 'scalar', '"not-an-object"'::jsonb union all
  select 'missing metering core', '{}'::jsonb union all
  select 'missing ' || key, payload - key from core cross join required_fields union all
  select 'null ' || key, payload || jsonb_build_object(key, null) from core cross join required_fields union all
  select 'mismatched response identity', payload || '{"providerResponseId":"different-response"}' from core union all
  select 'mismatched model', payload || '{"model":"different-model"}' from core union all
  select 'mismatched input count', payload || '{"inputTokens":101}' from core union all
  select 'mismatched cached count', payload || '{"cachedInputTokens":11}' from core union all
  select 'mismatched output count', payload || '{"outputTokens":21}' from core union all
  select 'string instead of ' || key, payload || jsonb_build_object(key, payload ->> key)
    from core cross join required_fields where key in ('inputTokens', 'cachedInputTokens', 'outputTokens') union all
  select 'unapproved content key', payload || '{"output":{"text":"must not be stored here"}}' from core union all
  select 'unapproved null key', payload || '{"output":null}' from core union all
  select 'oversized object', payload || jsonb_build_object('serviceTier', repeat('x', 5000)) from core
)
select extensions.throws_ok(format($insert$
  insert into private.demand_usage(principal_id, request_id, stage_id, response_id, model,
    input_tokens, cached_input_tokens, output_tokens, search_calls, cost_microusd, pricing_status, observed_usage)
  values ('8f100000-0000-4000-8000-000000000001', '8f300000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000001', 'resp-observed-invalid', 'gpt-5.6-luna', 100, 10, 20, 1, 123, 'priced', %L::jsonb)
$insert$, payload::text), '23514', null, 'the database rejects ' || label || ' metadata')
from invalid;

select extensions.throws_ok($$
  update private.demand_usage set observed_usage = null where response_id = 'resp-observed-priority'
$$, '42501', null, 'the worker cannot erase appended observed metadata');
select extensions.throws_ok($$
  update private.demand_usage set cost_microusd = 0 where response_id = 'resp-observed-priority'
$$, '42501', null, 'the worker cannot rewrite the bill when metadata is present');
select extensions.throws_ok($$
  update private.demand_usage set observed_usage = '{}' where response_id = 'resp-observed-legacy'
$$, '42501', null, 'the worker cannot backfill historical immutable receipts');
select extensions.throws_ok($$
  delete from private.demand_usage where response_id = 'resp-observed-priority'
$$, '42501', null, 'the worker cannot delete observed usage receipts');
select extensions.throws_ok($$
  insert into private.demand_usage(principal_id, request_id, stage_id, response_id, model, cost_microusd, pricing_status)
  values ('8f100000-0000-4000-8000-000000000001', '8f300000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000001', 'resp-observed-priority', 'gpt-5.6-luna', 123, 'priced')
$$, '23505', null, 'an observed response still cannot create a duplicate bill');

select extensions.throws_ok($$
  update private.demand_stages set usage = '{"serviceTier":"priority"}'
  where id = '8f400000-0000-4000-8000-000000000001'
$$, '23514', 'terminal demand stage cannot be changed', 'late metadata cannot mutate an uncertain stage');
select extensions.throws_ok($$
  update private.demand_stages set status = 'reserved'
  where id = '8f400000-0000-4000-8000-000000000001'
$$, '23514', 'terminal demand stage cannot be changed', 'uncertainty cannot reopen another paid operation');
select extensions.ok((select status = 'uncertain' and provider_response_id is null and usage is null and output is null
  and cost_microusd is null and pricing_status is null and lease_expires_at = '2026-09-08T00:00:00Z'::timestamptz
  from private.demand_stages where id = '8f400000-0000-4000-8000-000000000001'),
  'terminal status, lease, output and original stage metadata remain untouched');
select extensions.is((select count(*)::integer from private.demand_usage
  where request_id = '8f300000-0000-4000-8000-000000000001'), 6,
  'only the legacy receipt and five valid metadata receipts exist');

reset role;
select * from finish();
rollback;
