begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select has_table(
  'private',
  'ai_request_reservations',
  'AI requests have a private durable reservation table'
);
select has_column(
  'private',
  'ai_request_reservations',
  'request_snapshot',
  'AI retries retain an immutable provider input snapshot'
);
select has_column(
  'private',
  'usage_ledger',
  'ai_request_reservation_id',
  'usage rows can identify their logical AI reservation'
);
select has_column(
  'private',
  'usage_ledger',
  'provider_response_id',
  'usage rows preserve the billable provider response identity'
);
select has_column(
  'private',
  'usage_ledger',
  'pricing_status',
  'usage rows explicitly distinguish priced from unpriced responses'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'private.usage_ledger'::regclass
      and attribute.attname = 'cost_microusd'
      and not attribute.attnotnull
      and not attribute.attisdropped
  ),
  'unknown provider cost is represented by null rather than zero'
);
select has_index(
  'private',
  'ai_request_reservations',
  'ai_request_reservations_user_operation_key_unique',
  'one reader operation and idempotency key has one reservation'
);
select has_index(
  'private',
  'usage_ledger',
  'usage_ledger_provider_response_unique',
  'a provider response cannot be counted twice'
);
select has_trigger(
  'private',
  'ai_request_reservations',
  'ai_request_reservations_identity_immutable',
  'the durable provider request snapshot cannot be changed after reservation'
);

select ok(
  has_schema_privilege('edison_api', 'private', 'usage')
    and has_table_privilege(
      'edison_api',
      'private.ai_request_reservations',
      'select'
    )
    and has_table_privilege(
      'edison_api',
      'private.ai_request_reservations',
      'insert'
    )
    and not has_table_privilege(
      'edison_api',
      'private.ai_request_reservations',
      'update'
    ),
  'the API role can reserve but cannot claim or complete AI work'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'private'
      and table_name = 'ai_request_reservations'
  ),
  0,
  'browser database roles have no AI reservation privileges'
);

insert into auth.users (id, email)
values
  ('51000000-0000-4000-8000-000000000001', 'quota-one@edison.test'),
  ('51000000-0000-4000-8000-000000000002', 'quota-two@edison.test');

set local "request.jwt.claim.sub" = '51000000-0000-4000-8000-000000000001';
grant usage on schema extensions to edison_api;
set local role edison_api;

select extensions.lives_ok(
  $$
    insert into private.ai_request_reservations (
      id, user_id, operation, resource_id, idempotency_key,
      request_fingerprint, request_snapshot
    ) values (
      '52000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'article_qa',
      '53000000-0000-4000-8000-000000000001',
      'question-52000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      '{"version":1}'::jsonb
    )
  $$,
  'the API role can create an owned AI reservation'
);
select extensions.throws_ok(
  $$
    insert into private.ai_request_reservations (
      user_id, operation, resource_id, idempotency_key, request_fingerprint,
      request_snapshot
    ) values (
      '51000000-0000-4000-8000-000000000002',
      'article_qa',
      '53000000-0000-4000-8000-000000000002',
      'question-52000000-0000-4000-8000-000000000002',
      repeat('b', 64),
      '{"version":1}'::jsonb
    )
  $$,
  '42501',
  null,
  'RLS rejects a reservation for another reader'
);

reset role;

select extensions.throws_ok(
  $$
    update private.ai_request_reservations
    set request_snapshot = '{"version":2}'::jsonb
    where id = '52000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'even the server role cannot rewrite a reserved provider request'
);

select extensions.throws_ok(
  $$
    insert into private.ai_request_reservations (
      user_id, operation, resource_id, idempotency_key, request_fingerprint,
      request_snapshot
    ) values (
      '51000000-0000-4000-8000-000000000001',
      'article_qa',
      '53000000-0000-4000-8000-000000000003',
      'question-52000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      '{"version":1}'::jsonb
    )
  $$,
  '23505',
  null,
  'the database rejects a duplicate logical AI reservation'
);

select extensions.results_eq(
  $$
    update private.ai_request_reservations
    set status = 'in_progress',
        attempt_count = attempt_count + 1,
        lease_owner = 'owner-a',
        lease_expires_at = now() + interval '3 minutes'
    where id = '52000000-0000-4000-8000-000000000001'
      and status = 'reserved'
    returning lease_owner
  $$,
  $$ values ('owner-a'::text) $$,
  'the first worker claims the reservation atomically'
);
with competing_claim as (
  update private.ai_request_reservations
  set lease_owner = 'owner-b',
      lease_expires_at = now() + interval '3 minutes'
  where id = '52000000-0000-4000-8000-000000000001'
    and (
      status = 'reserved'
      or (status = 'in_progress' and lease_expires_at <= now())
    )
  returning id
)
select extensions.is(
  (select count(*) from competing_claim),
  0::bigint,
  'a parallel worker cannot steal an unexpired lease'
);

update private.ai_request_reservations
set lease_expires_at = now() - interval '1 second'
where id = '52000000-0000-4000-8000-000000000001';

select extensions.results_eq(
  $$
    update private.ai_request_reservations
    set attempt_count = attempt_count + 1,
        lease_owner = 'owner-b',
        lease_expires_at = now() + interval '3 minutes'
    where id = '52000000-0000-4000-8000-000000000001'
      and status = 'in_progress'
      and lease_expires_at <= now()
      and attempt_count < 3
    returning lease_owner, attempt_count
  $$,
  $$ values ('owner-b'::text, 2::smallint) $$,
  'an abandoned expired lease can be reclaimed within the attempt bound'
);

select extensions.lives_ok(
  $$
    insert into private.usage_ledger (
      user_id, ai_request_reservation_id, operation, provider,
      provider_response_id, model, input_tokens, output_tokens,
      pricing_status, cost_microusd
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'article_qa',
      'openai',
      'resp_quota_test_1',
      'test-model',
      10,
      5,
      'priced',
      100
    )
  $$,
  'observed model usage can be tied to its reservation'
);
select extensions.throws_ok(
  $$
    insert into private.usage_ledger (
      user_id, ai_request_reservation_id, operation, provider,
      provider_response_id, model, input_tokens, output_tokens,
      pricing_status, cost_microusd
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'article_qa',
      'openai',
      'resp_quota_test_1',
      'test-model',
      10,
      5,
      'priced',
      100
    )
  $$,
  '23505',
  null,
  'the same provider response cannot be charged twice'
);

select extensions.lives_ok(
  $$
    insert into private.usage_ledger (
      user_id, ai_request_reservation_id, operation, provider,
      provider_response_id, model, input_tokens, output_tokens,
      pricing_status, cost_microusd
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'article_qa',
      'openai',
      'resp_quota_unpriced_1',
      'future-model',
      10,
      5,
      'unpriced',
      null
    )
  $$,
  'unknown-model token usage is retained with an explicitly unknown cost'
);
select extensions.results_eq(
  $$
    select pricing_status, cost_microusd
    from private.usage_ledger
    where provider_response_id = 'resp_quota_unpriced_1'
  $$,
  $$ values ('unpriced'::text, null::bigint) $$,
  'an unpriced response never masquerades as a zero-cost response'
);
select extensions.throws_ok(
  $$
    insert into private.usage_ledger (
      user_id, ai_request_reservation_id, operation, provider,
      provider_response_id, model, input_tokens, output_tokens,
      pricing_status, cost_microusd
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'article_qa',
      'openai',
      'resp_quota_unpriced_invalid',
      'future-model',
      10,
      5,
      'unpriced',
      0
    )
  $$,
  '23514',
  null,
  'the database rejects zero as the cost of an unpriced response'
);

select ok(
  has_table_privilege(
    'service_role',
    'private.ai_request_reservations',
    'update'
  ),
  'the server-side service role can recover and complete AI reservations'
);

select is(
  (
    select attempt_count
    from private.ai_request_reservations
    where id = '52000000-0000-4000-8000-000000000001'
  ),
  2::smallint,
  'lease reclamation consumes one of the three bounded attempts'
);

select * from finish();
rollback;
