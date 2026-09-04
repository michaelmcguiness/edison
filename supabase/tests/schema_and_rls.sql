begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select has_schema('private', 'private workflow schema exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'articles', 'articles table exists');
select has_table('private', 'generation_jobs', 'generation jobs are private');
select col_type_is(
  'public',
  'feed_items',
  'rank',
  'numeric(20,6)',
  'feed rank can store millisecond ordering values'
);

select has_column(
  'public',
  'feed_commands',
  'workflow_run_id',
  'feed commands persist their owning workflow run'
);
select has_column(
  'public',
  'feed_commands',
  'lease_expires_at',
  'feed command dispatches use a recoverable lease'
);
select has_column(
  'public',
  'feed_commands',
  'next_attempt_at',
  'feed command dispatch retries are scheduled durably'
);
select has_index(
  'public',
  'feed_commands',
  'feed_commands_status_next_attempt_idx',
  'queued feed command reconciliation has a supporting index'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'command_status'
      and e.enumlabel = 'no-op'
  ),
  'feed commands can record an explicit no-op outcome'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles', 'alpha_memberships', 'feed_preferences', 'user_interests',
        'learning_threads', 'articles', 'article_sources', 'feed_items',
        'reading_events', 'saved_articles', 'article_feedback', 'feed_commands',
        'article_conversations', 'conversation_messages', 'article_shares'
      )
      and c.relrowsecurity
  ),
  15,
  'row-level security is enabled on every user-facing table'
);

select ok(
  (
    select count(*) >= 31
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'alpha_memberships', 'feed_preferences', 'user_interests',
        'learning_threads', 'articles', 'article_sources', 'feed_items',
        'reading_events', 'saved_articles', 'article_feedback', 'feed_commands',
        'article_conversations', 'conversation_messages', 'article_shares'
      )
  ),
  'ownership policies are installed'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema in ('public', 'private')
      and table_name in (
        'profiles', 'alpha_memberships', 'feed_preferences', 'user_interests',
        'learning_threads', 'articles', 'article_sources', 'feed_items',
        'reading_events', 'saved_articles', 'article_feedback', 'feed_commands',
        'article_conversations', 'conversation_messages', 'article_shares',
        'generation_jobs', 'usage_ledger', 'webhook_events'
      )
  ),
  0,
  'anonymous clients have no direct table privileges'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in (
        'profiles', 'alpha_memberships', 'feed_preferences', 'user_interests',
        'learning_threads', 'articles', 'article_sources', 'feed_items',
        'reading_events', 'saved_articles', 'article_feedback', 'feed_commands',
        'article_conversations', 'conversation_messages', 'article_shares'
      )
  ),
  0,
  'authenticated clients cannot bypass the Edison API through PostgREST'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'article_assets_%'
  ),
  0,
  'the reserved article-assets bucket has no direct client policies'
);

select ok(
  has_table_privilege('edison_api', 'public.profiles', 'select'),
  'the non-login Edison API role has its narrow server-side grants'
);

select ok(
  has_schema_privilege('edison_api', 'auth', 'usage'),
  'the Edison API role can resolve Auth helpers used by RLS policies'
);

select ok(
  has_function_privilege('edison_api', 'auth.uid()', 'execute'),
  'the Edison API role can execute the Auth identity helper'
);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'rls-one@edison.test'),
  ('10000000-0000-4000-8000-000000000002', 'rls-two@edison.test');

set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
grant usage on schema extensions to edison_api;
set local role edison_api;

select extensions.results_eq(
  $$
    update public.profiles
    set current_streak = 1,
        last_read_date = '2026-09-02'
    where id = '10000000-0000-4000-8000-000000000001'
    returning current_streak, last_read_date::text
  $$,
  $$ values (1, '2026-09-02'::text) $$,
  'the Edison API role can persist a completion streak update'
);

select extensions.is(
  (
    select count(*)::integer
    from public.profiles
  ),
  1,
  'the Edison API role can evaluate auth.uid() and sees only its claimed profile'
);

reset role;

insert into public.feed_commands (
  id,
  user_id,
  command,
  idempotency_key
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'More history, please.',
  'command-00000000-0000-4000-8000-000000000001'
);

select extensions.results_eq(
  $$
    update public.feed_commands
    set workflow_run_id = 'run-a'
    where id = '20000000-0000-4000-8000-000000000001'
      and status = 'queued'
      and (workflow_run_id is null or workflow_run_id = 'run-a')
    returning workflow_run_id
  $$,
  $$ values ('run-a'::text) $$,
  'the first feed-command workflow run can claim model work'
);

with competing_claim as (
  update public.feed_commands
  set workflow_run_id = 'run-b'
  where id = '20000000-0000-4000-8000-000000000001'
    and status = 'queued'
    and (workflow_run_id is null or workflow_run_id = 'run-b')
  returning id
)
select extensions.is(
  (select count(*) from competing_claim),
  0::bigint,
  'a competing workflow run cannot claim the same feed command'
);

select is(
  has_schema_privilege('authenticated', 'private', 'usage'),
  false,
  'authenticated clients cannot access the private schema'
);

select * from finish();
rollback;
