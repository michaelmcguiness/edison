begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table(
  'public',
  'editorial_direction_states',
  'section revision and edition identities are durable'
);
select has_column(
  'public',
  'editorial_direction_states',
  'current_edition_date',
  'News direction state records the server-owned local edition date'
);
select has_column(
  'public',
  'feed_items',
  'edition_id',
  'feed rows bind to one exact News edition identity'
);
select has_table(
  'public',
  'editorial_instructions',
  'reader-authored directions are durable'
);
select has_table(
  'public',
  'editorial_direction_mutations',
  'direction history supports safe idempotency and undo'
);
select has_table(
  'public',
  'public_starter_editions',
  'starter editions have an explicit publication boundary'
);
select has_table(
  'public',
  'public_starter_edition_articles',
  'starter articles are stored as sanitized publication snapshots'
);

select has_index(
  'public',
  'editorial_direction_mutations',
  'editorial_direction_mutations_user_idempotency_unique',
  'one reader idempotency key can create only one direction mutation'
);
select has_index(
  'public',
  'editorial_direction_mutations',
  'editorial_direction_mutations_undo_once_unique',
  'one direction mutation can be undone only once'
);
select has_index(
  'public',
  'public_starter_editions',
  'public_starter_editions_idempotency_unique',
  'starter publication retries cannot duplicate an edition'
);

select ok(
  has_table_privilege('edison_api', 'public.editorial_direction_states', 'select')
    and has_table_privilege('edison_api', 'public.editorial_instructions', 'insert')
    and has_table_privilege('edison_api', 'public.editorial_direction_mutations', 'insert'),
  'the API role has narrowly scoped direction privileges'
);
select ok(
  has_table_privilege('edison_public', 'public.public_starter_editions', 'select')
    and has_table_privilege('edison_public', 'public.public_starter_edition_articles', 'select'),
  'the public reader role can select only starter publication tables'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'editorial_direction_states',
        'editorial_instructions',
        'editorial_direction_mutations',
        'public_starter_editions',
        'public_starter_edition_articles'
      )
  ),
  0,
  'browser database roles have no direct grants on the new tables'
);

insert into auth.users (id, email)
values
  ('41000000-0000-4000-8000-000000000001', 'direction-one@edison.test'),
  ('41000000-0000-4000-8000-000000000002', 'direction-two@edison.test');

select is(
  (
    select count(*)::integer
    from public.editorial_direction_states
    where user_id = '41000000-0000-4000-8000-000000000001'
  ),
  3,
  'a new reader receives one durable state row per publication section'
);
set local "request.jwt.claim.sub" = '41000000-0000-4000-8000-000000000001';
grant usage on schema extensions to edison_api;
set local role edison_api;

select extensions.is(
  (select count(*)::integer from public.editorial_direction_states),
  3,
  'RLS exposes only the claimed reader direction states'
);
select extensions.lives_ok(
  $$
    insert into public.editorial_instructions (
      user_id, section, scope, edition_id, text, revision
    )
    values (
      '41000000-0000-4000-8000-000000000001',
      'news',
      'persistent',
      null,
      'More economic history.',
      1
    )
  $$,
  'the API role can insert an owned section instruction'
);
select extensions.throws_ok(
  $$
    insert into public.editorial_instructions (
      user_id, section, scope, edition_id, text, revision
    )
    values (
      '41000000-0000-4000-8000-000000000002',
      'news',
      'persistent',
      null,
      'This must not cross ownership.',
      1
    )
  $$,
  '42501',
  null,
  'RLS rejects a direction write for another reader'
);

reset role;

insert into public.public_starter_editions (
  id,
  section,
  edition_date,
  label,
  status,
  published_at,
  idempotency_key,
  request_fingerprint
)
values (
  '42000000-0000-4000-8000-000000000001',
  'news',
  '2026-09-04',
  'A place to begin',
  'draft',
  null,
  'starter-42000000-0000-4000-8000-000000000001',
  repeat('a', 64)
);
insert into public.public_starter_edition_articles (
  id, edition_id, position, reason, snapshot
)
values (
  '43000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  1,
  'A varied place to begin.',
  '{"version":1}'::jsonb
);
update public.public_starter_editions
set status = 'published', published_at = '2020-09-04T12:00:00Z'
where id = '42000000-0000-4000-8000-000000000001';

insert into public.public_starter_editions (
  id,
  section,
  edition_date,
  label,
  status,
  published_at,
  idempotency_key,
  request_fingerprint
)
values (
  '42000000-0000-4000-8000-000000000002',
  'news',
  '2026-09-05',
  'A future draft',
  'draft',
  null,
  'starter-42000000-0000-4000-8000-000000000002',
  repeat('b', 64)
);
insert into public.public_starter_edition_articles (
  id, edition_id, position, reason, snapshot
)
values (
  '43000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000002',
  1,
  'A draft must remain private.',
  '{"version":1}'::jsonb
);

grant usage on schema extensions to edison_public;
set local role edison_public;

select extensions.is(
  (select count(*)::integer from public.public_starter_editions),
  1,
  'the public role sees the published starter edition but not drafts'
);
select extensions.is(
  (select count(*)::integer from public.public_starter_edition_articles),
  1,
  'the public role sees articles only through a published starter edition'
);
select extensions.throws_ok(
  $$
    insert into public.public_starter_editions (
      section, edition_date, label, status, idempotency_key, request_fingerprint
    ) values (
      'news', '2026-09-06', 'Forbidden', 'draft',
      'starter-42000000-0000-4000-8000-000000000003', repeat('c', 64)
    )
  $$,
  '42501',
  null,
  'the public reader role cannot publish content'
);

reset role;

select extensions.throws_ok(
  $$
    update public.public_starter_editions
    set label = 'Changed after publication'
    where id = '42000000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'published starter editions are immutable',
  'published edition metadata is immutable'
);
select extensions.throws_ok(
  $$
    delete from public.public_starter_edition_articles
    where id = '43000000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'articles in a published starter edition are immutable',
  'published starter article snapshots are immutable'
);
select extensions.lives_ok(
  $$
    update public.public_starter_editions
    set status = 'archived'
    where id = '42000000-0000-4000-8000-000000000001'
  $$,
  'a published starter edition can be archived without changing its snapshot'
);
set local role edison_public;
select extensions.is(
  (select count(*)::integer from public.public_starter_editions),
  1,
  'the public role keeps immutable archived editions readable for deep links'
);
select extensions.is(
  (select count(*)::integer from public.public_starter_edition_articles),
  1,
  'the public role keeps immutable archived article snapshots readable'
);
reset role;
select ok(
  has_table_privilege(
    'service_role',
    'public.public_starter_editions',
    'insert'
  ),
  'the server-side service role can run an explicit publication workflow'
);

select * from finish();
rollback;
