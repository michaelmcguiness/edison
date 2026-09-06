begin;

create extension if not exists pgtap with schema extensions;

select plan(69);

select has_table('private', 'demand_principals', 'demand principals are private');
select has_table('private', 'demand_loops', 'demand loops are private');
select has_table('private', 'demand_requests', 'demand requests are private');
select has_table('private', 'demand_ideas', 'demand ideas are private');
select has_table('private', 'demand_stages', 'provider stages are private');
select has_table('private', 'demand_mutations', 'loop mutations are private');
select has_table('private', 'demand_events', 'reader events are private');
select has_table('private', 'demand_usage', 'provider usage is private');

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class relation
    inner join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'demand_principals',
        'demand_loops',
        'demand_requests',
        'demand_ideas',
        'demand_stages',
        'demand_mutations',
        'demand_events',
        'demand_usage'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  8,
  'every demand table has enabled and forced RLS'
);

select is(
  (
    select not rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
    from pg_catalog.pg_roles
    where rolname = 'edison_demand_api'
  ),
  true,
  'the demand API role is non-login, non-inheriting, and cannot bypass RLS'
);

select is(
  (
    select not rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
    from pg_catalog.pg_roles
    where rolname = 'edison_demand_worker'
  ),
  true,
  'the demand worker role is non-login, non-inheriting, and cannot bypass RLS'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_auth_members membership
    inner join pg_catalog.pg_roles member_role
      on member_role.oid = membership.member
    where member_role.rolname in ('edison_demand_api', 'edison_demand_worker')
  ),
  0,
  'demand roles do not inherit any other role'
);

select ok(
  to_regprocedure('private.current_active_demand_principal_id()') is not null,
  'the scoped active-principal helper exists'
);
select ok(
  to_regprocedure('private.demand_principal_is_active(uuid)') is not null,
  'the worker active-principal helper exists'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure
    inner join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'current_active_demand_principal_id',
        'demand_principal_is_active'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=pg_catalog']::text[]
  ),
  2,
  'principal helpers are security definer functions with fixed search paths'
);

select is(
  has_table_privilege(
    'edison_demand_api',
    'private.demand_principals',
    'select'
  ),
  false,
  'the scoped API cannot read account bindings or guest token hashes'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in (
      'anon',
      'authenticated',
      'service_role',
      'edison_api',
      'edison_public'
    )
      and table_schema = 'private'
      and table_name like 'demand\_%' escape '\'
  ),
  0,
  'legacy browser, service, account API, and public roles have no demand grants'
);

select ok(
  not has_table_privilege(
    'edison_demand_api',
    'public.profiles',
    'select'
  )
    and not has_table_privilege(
      'edison_demand_worker',
      'public.profiles',
      'select'
    ),
  'demand roles cannot read existing account profiles'
);

select ok(
  has_table_privilege(
    'edison_demand_api',
    'private.demand_requests',
    'select'
  )
    and not has_table_privilege(
      'edison_demand_api',
      'private.demand_requests',
      'insert'
    )
    and not has_table_privilege(
      'edison_demand_api',
      'private.demand_requests',
      'update'
    ),
  'paid demand requests must enter through worker quota admission'
);

select ok(
  has_column_privilege(
    'edison_demand_api',
    'private.demand_ideas',
    'saved',
    'update'
  )
    and not has_column_privilege(
      'edison_demand_api',
      'private.demand_ideas',
      'title',
      'update'
    ),
  'the scoped API can save an idea but cannot rewrite generated content'
);

select ok(
  has_table_privilege(
    'edison_demand_worker',
    'private.demand_usage',
    'select'
  )
    and has_table_privilege(
      'edison_demand_worker',
      'private.demand_usage',
      'insert'
    )
    and not has_table_privilege(
      'edison_demand_worker',
      'private.demand_usage',
      'update'
    )
    and not has_table_privilege(
      'edison_demand_worker',
      'private.demand_usage',
      'delete'
    ),
  'provider usage is append-only to the demand worker'
);

select has_index(
  'private',
  'demand_stages',
  'demand_stages_provider_response_unique',
  'one provider response can complete only one stage'
);
select has_trigger(
  'private',
  'demand_requests',
  'demand_requests_identity_immutable',
  'request ownership, idempotency, budget and snapshot are immutable'
);
select has_trigger(
  'private',
  'demand_stages',
  'demand_stages_identity_immutable',
  'stage identity and observed provider output are immutable'
);

select extensions.throws_ok(
  $$
    insert into private.demand_principals (
      account_user_id, guest_token_hash, expires_at
    ) values (
      '90000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      '2099-01-01T00:00:00Z'
    )
  $$,
  '23514',
  null,
  'a principal cannot combine account and guest credentials'
);

select extensions.throws_ok(
  $$
    insert into private.demand_principals (guest_token_hash, expires_at)
    values ('raw-browser-token', '2099-01-01T00:00:00Z')
  $$,
  '23514',
  null,
  'a raw or malformed guest token cannot be retained'
);

insert into private.demand_principals (
  id, guest_token_hash, expires_at, created_at
)
values
  (
    '91000000-0000-4000-8000-000000000001',
    repeat('1', 64),
    '2099-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    repeat('2', 64),
    '2099-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    repeat('3', 64),
    '2021-01-01T00:00:00Z',
    '2020-01-01T00:00:00Z'
  ),
  (
    '91000000-0000-4000-8000-000000000004',
    repeat('4', 64),
    '2099-01-01T00:00:00Z',
    '2020-01-01T00:00:00Z'
  );

update private.demand_principals
set revoked_at = '2021-01-01T00:00:00Z'
where id = '91000000-0000-4000-8000-000000000004';

insert into auth.users (id, email)
values (
  '93000000-0000-4000-8000-000000000001',
  'demand-account@edison.test'
);

insert into private.demand_principals (id, account_user_id)
values (
  '91000000-0000-4000-8000-000000000005',
  '93000000-0000-4000-8000-000000000001'
);

insert into private.demand_loops (
  id, principal_id, title, original_curiosity
)
values
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'Second guest',
    'What belongs only to the second guest?'
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000003',
    'Expired guest',
    'What should no longer be visible?'
  ),
  (
    '92000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000004',
    'Revoked guest',
    'What was explicitly revoked?'
  ),
  (
    '92000000-0000-4000-8000-000000000005',
    '91000000-0000-4000-8000-000000000005',
    'Account loop',
    'What remains behind membership?'
  );

grant usage on schema extensions to edison_demand_api, edison_demand_worker;
set local role edison_demand_api;

set local "request.edison.demand_principal_id" = 'not-a-uuid';
select extensions.is(
  (select private.current_active_demand_principal_id()),
  null::uuid,
  'a malformed principal context safely resolves to null'
);
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  0,
  'a malformed principal context exposes no demand rows'
);

set local "request.edison.demand_principal_id" =
  '91000000-0000-4000-8000-000000000001';
select extensions.lives_ok(
  $$
    insert into private.demand_loops (
      id, principal_id, title, original_curiosity
    ) values (
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'Synthetic biology',
      'How can cells be programmed safely?'
    )
  $$,
  'an active guest can create an owned loop'
);
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  1,
  'an active guest sees only its own loop'
);
select extensions.throws_ok(
  $$
    insert into private.demand_loops (
      principal_id, title, original_curiosity
    ) values (
      '91000000-0000-4000-8000-000000000002',
      'Cross-owner loop',
      'This must not be accepted.'
    )
  $$,
  '42501',
  null,
  'RLS rejects writes for another guest principal'
);

set local "request.edison.demand_principal_id" =
  '91000000-0000-4000-8000-000000000003';
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  0,
  'an expired guest cannot read retained demand rows'
);

set local "request.edison.demand_principal_id" =
  '91000000-0000-4000-8000-000000000004';
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  0,
  'a revoked guest cannot read retained demand rows'
);

reset role;
update private.demand_principals
set revoked_at = now()
where id = '91000000-0000-4000-8000-000000000001';
set local role edison_demand_api;
set local "request.edison.demand_principal_id" =
  '91000000-0000-4000-8000-000000000001';
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  0,
  'revocation takes effect on the next statement even with an existing context'
);

set local "request.edison.demand_principal_id" =
  '91000000-0000-4000-8000-000000000005';
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  1,
  'an account principal with active membership can read its demand loop'
);

reset role;
update public.alpha_memberships
set status = 'revoked', revoked_at = now()
where user_id = '93000000-0000-4000-8000-000000000001';
set local role edison_demand_api;
set local "request.edison.demand_principal_id" =
  '91000000-0000-4000-8000-000000000005';
select extensions.is(
  (select count(*)::integer from private.demand_loops),
  0,
  'revoking alpha membership closes the account demand principal'
);

reset role;
set local role edison_demand_worker;
select extensions.is(
  private.demand_principal_is_active(
    '91000000-0000-4000-8000-000000000005'
  ),
  false,
  'workers see revoked account membership before starting paid work'
);
reset role;

select extensions.lives_ok(
  $$
    insert into private.demand_requests (
      id, principal_id, loop_id, kind, stage, idempotency_key,
      request_fingerprint, snapshot, reserved_microusd
    ) values
      (
        '94000000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        '92000000-0000-4000-8000-000000000001',
        'ideas',
        'researching',
        'shared-demand-key',
        repeat('a', 64),
        '{"version":1}'::jsonb,
        1000
      ),
      (
        '94000000-0000-4000-8000-000000000002',
        '91000000-0000-4000-8000-000000000002',
        '92000000-0000-4000-8000-000000000002',
        'ideas',
        'researching',
        'shared-demand-key',
        repeat('b', 64),
        '{"version":1}'::jsonb,
        1000
      )
  $$,
  'the same idempotency key is allowed for separate principals'
);

select extensions.throws_ok(
  $$
    insert into private.demand_requests (
      principal_id, loop_id, kind, stage, idempotency_key,
      request_fingerprint, snapshot, reserved_microusd
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001',
      'ideas',
      'researching',
      'shared-demand-key',
      repeat('c', 64),
      '{"version":2}'::jsonb,
      1000
    )
  $$,
  '23505',
  null,
  'one principal cannot commission the same logical request twice'
);

select extensions.throws_ok(
  $$
    insert into private.demand_requests (
      principal_id, loop_id, kind, stage, idempotency_key,
      request_fingerprint, snapshot, reserved_microusd
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000002',
      'ideas',
      'researching',
      'cross-owner-loop',
      repeat('d', 64),
      '{"version":1}'::jsonb,
      1000
    )
  $$,
  '23503',
  null,
  'a demand request cannot claim another principal loop'
);

select extensions.lives_ok(
  $$
    insert into private.demand_ideas (
      id, principal_id, loop_id, batch_request_id, batch_revision,
      title, deck, brief, evidence
    ) values (
      '95000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      0,
      'A supported synthetic-biology idea',
      'A compact, evidence-backed payoff.',
      '{"question":"What changed?"}'::jsonb,
      '{"sources":[]}'::jsonb
    )
  $$,
  'a checked idea can reference its owned batch request'
);

select extensions.lives_ok(
  $$
    insert into private.demand_requests (
      id, principal_id, loop_id, idea_id, kind, stage, idempotency_key,
      request_fingerprint, snapshot, reserved_microusd
    ) values (
      '94000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      'article',
      'researching',
      'article-demand-key',
      repeat('e', 64),
      '{"version":1}'::jsonb,
      5000
    )
  $$,
  'an article request can reference its owned idea'
);

select extensions.lives_ok(
  $$
    update private.demand_ideas
    set article_request_id = '94000000-0000-4000-8000-000000000003'
    where id = '95000000-0000-4000-8000-000000000001'
  $$,
  'an idea can retain the matching commissioned article request'
);

select extensions.throws_ok(
  $$
    insert into private.demand_requests (
      principal_id, loop_id, idea_id, kind, stage, idempotency_key,
      request_fingerprint, snapshot, reserved_microusd
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      'article',
      'researching',
      'second-article-key',
      repeat('f', 64),
      '{"version":1}'::jsonb,
      5000
    )
  $$,
  '23505',
  null,
  'an idea can commission only one article request'
);

select extensions.lives_ok(
  $$
    insert into private.demand_stages (
      id, principal_id, request_id, stage_key, request_fingerprint,
      snapshot, status, provider_response_id, output, usage,
      cost_microusd, pricing_status
    ) values (
      '96000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      'research',
      repeat('1', 64),
      '{"version":1}'::jsonb,
      'succeeded',
      'resp-demand-1',
      '{"ideas":[]}'::jsonb,
      '{"input_tokens":10}'::jsonb,
      50,
      'priced'
    )
  $$,
  'a completed provider stage retains its response and accounting snapshot'
);

select extensions.throws_ok(
  $$
    insert into private.demand_stages (
      principal_id, request_id, stage_key, request_fingerprint,
      snapshot, status, provider_response_id, output,
      cost_microusd, pricing_status
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000003',
      'writer',
      repeat('2', 64),
      '{"version":1}'::jsonb,
      'succeeded',
      'resp-demand-1',
      '{"article":{}}'::jsonb,
      75,
      'priced'
    )
  $$,
  '23505',
  null,
  'one provider response cannot be attached to multiple stages'
);

select extensions.throws_ok(
  $$
    update private.demand_stages
    set provider_response_id = 'resp-demand-replacement'
    where id = '96000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'terminal demand stage cannot be changed',
  'an observed provider response cannot be overwritten'
);

select extensions.lives_ok(
  $$
    insert into private.demand_usage (
      id, principal_id, request_id, stage_id, response_id, model,
      input_tokens, cached_input_tokens, output_tokens, search_calls,
      cost_microusd, pricing_status
    ) values (
      '97000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001',
      'resp-demand-1',
      'test-model',
      10,
      0,
      5,
      1,
      50,
      'priced'
    )
  $$,
  'an observed provider response is recorded once in the usage ledger'
);

select extensions.throws_ok(
  $$
    insert into private.demand_usage (
      principal_id, request_id, stage_id, response_id, model,
      cost_microusd, pricing_status
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001',
      'resp-demand-1',
      'test-model',
      50,
      'priced'
    )
  $$,
  '23505',
  null,
  'a provider response cannot be counted twice'
);

set local role edison_demand_worker;
select extensions.throws_ok(
  $$
    update private.demand_usage
    set input_tokens = 11
    where id = '97000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'the demand worker cannot rewrite provider accounting'
);
reset role;

select ok(has_function_privilege('edison_demand_worker', 'private.demand_legacy_budget()', 'execute')
  and has_function_privilege('edison_demand_worker', 'private.demand_legacy_daily_counts(uuid)', 'execute'),
  'only aggregate legacy budget and quota helpers are available to the worker');
select ok(not has_function_privilege('edison_demand_api', 'private.demand_legacy_budget()', 'execute')
  and not has_function_privilege('anon', 'private.demand_legacy_daily_counts(uuid)', 'execute'),
  'browser and scoped roles cannot inspect global spending or account quotas');
select ok(not has_table_privilege('edison_demand_worker', 'private.usage_ledger', 'select'),
  'budget helpers do not grant raw legacy usage access');

select extensions.lives_ok($$
  update private.demand_requests set progress='{"phase":"write"}'
  where id='94000000-0000-4000-8000-000000000003'
$$, 'a request can save private pipeline progress');
select extensions.lives_ok($$
  update private.demand_requests set progress='{"phase":"check"}'
  where id='94000000-0000-4000-8000-000000000003'
$$, 'private progress can advance without replacing the immutable final result');
select extensions.throws_ok($$
  update private.demand_requests set progress='[]'
  where id='94000000-0000-4000-8000-000000000003'
$$, '23514', null, 'pipeline progress must remain an object');

select extensions.lives_ok($$
  update private.demand_requests set status='running', workflow_run_id='test-run-1'
  where id='94000000-0000-4000-8000-000000000003'
$$, 'the first durable worker can claim a queued request');
select extensions.throws_ok($$
  update private.demand_requests set workflow_run_id='test-run-2'
  where id='94000000-0000-4000-8000-000000000003'
$$, '23514', null, 'a competing worker cannot replace the active run identity');
select extensions.lives_ok($$
  update private.demand_requests set status='failed', failure_code='worker_interrupted'
  where id='94000000-0000-4000-8000-000000000003';
  update private.demand_requests set status='queued', workflow_run_id=null
  where id='94000000-0000-4000-8000-000000000003'
$$, 'a failed unpublished request can clear its old worker identity for a bounded retry');
select extensions.lives_ok($$
  update private.demand_requests set status='running', workflow_run_id='test-run-2'
  where id='94000000-0000-4000-8000-000000000003';
  update private.demand_requests set status='succeeded', result='{"test":"accepted"}'
  where id='94000000-0000-4000-8000-000000000003'
$$, 'the replacement worker can publish exactly one final result');
select extensions.throws_ok($$
  update private.demand_requests set result='{"test":"replacement"}'
  where id='94000000-0000-4000-8000-000000000003'
$$, '23514', null, 'a final reading result cannot be overwritten');
select extensions.throws_ok($$
  update private.demand_requests set snapshot='{"version":2}'
  where id='94000000-0000-4000-8000-000000000003'
$$, '23514', null, 'retry cannot change frozen reader context');
select extensions.throws_ok($$
  update private.demand_requests set reserved_microusd=6000
  where id='94000000-0000-4000-8000-000000000003'
$$, '23514', null, 'retry cannot raise its original spending reservation');
select extensions.throws_ok($$
  update private.demand_ideas set rank=0
  where id='95000000-0000-4000-8000-000000000001'
$$, '23514', null, 'idea order must be a valid bounded batch rank');

select ok(has_function_privilege('edison_demand_worker', 'private.demand_reader_preferences(uuid)', 'execute')
  and not has_function_privilege('edison_demand_api', 'private.demand_reader_preferences(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.demand_reader_preferences(uuid)', 'execute'),
  'only the trusted worker can read account length/depth through the narrow helper');
select ok(not has_table_privilege('edison_demand_worker', 'public.feed_preferences', 'select'),
  'account-default preservation does not grant raw profile preference access');
insert into public.feed_preferences (user_id, article_length, depth)
values ('93000000-0000-4000-8000-000000000001', 'brief', 85)
on conflict (user_id) do update set article_length='brief', depth=85;
update public.alpha_memberships set status='active', revoked_at=null
where user_id='93000000-0000-4000-8000-000000000001';
set local role edison_demand_worker;
select extensions.is(
  (select article_length || ':' || depth::text from private.demand_reader_preferences('91000000-0000-4000-8000-000000000005')),
  'brief:85', 'active account preferences retain their saved length and depth');
select extensions.is(
  (select count(*)::integer from private.demand_reader_preferences('91000000-0000-4000-8000-000000000002')),
  0, 'a guest does not inherit account reading defaults');
reset role;
update public.alpha_memberships set status='revoked', revoked_at=now()
where user_id='93000000-0000-4000-8000-000000000001';
set local role edison_demand_worker;
select extensions.is(
  (select count(*)::integer from private.demand_reader_preferences('91000000-0000-4000-8000-000000000005')),
  0, 'revoked account preferences cannot enter new reading context');
reset role;

select * from finish();
rollback;
