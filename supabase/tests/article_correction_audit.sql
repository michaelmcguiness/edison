begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_table(
  'private',
  'article_correction_audits',
  'private correction audit history is durable'
);

select ok(
  to_regprocedure(
    'private.read_article_correction_disclosure(uuid)'
  ) is not null,
  'the narrow correction disclosure reader exists'
);

select ok(
  has_function_privilege(
    'edison_api',
    'private.read_article_correction_disclosure(uuid)',
    'execute'
  ),
  'the API role can execute the narrow disclosure reader'
);

select ok(
  has_schema_privilege('edison_api', 'private', 'usage'),
  'the API role can resolve the narrow private-schema reader'
);

select is(
  has_function_privilege(
    'anon',
    'private.read_article_correction_disclosure(uuid)',
    'execute'
  ),
  false,
  'anonymous clients cannot execute the disclosure reader'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.read_article_correction_disclosure(uuid)',
    'execute'
  ),
  false,
  'browser JWT roles cannot execute the disclosure reader directly'
);

select is(
  has_function_privilege(
    'service_role',
    'private.read_article_correction_disclosure(uuid)',
    'execute'
  ),
  false,
  'the broad service role cannot execute the disclosure reader'
);

select is(
  has_table_privilege(
    'edison_api',
    'private.article_correction_audits',
    'select'
  ),
  false,
  'the API role cannot read private correction snapshots'
);

select is(
  has_table_privilege(
    'edison_public',
    'private.article_correction_audits',
    'select'
  ),
  false,
  'the public role cannot read private correction snapshots'
);

insert into auth.users (id, email)
values (
  '81000000-0000-4000-8000-000000000001',
  'correction-owner@edison.test'
);

insert into public.articles (
  id,
  owner_id,
  slug,
  status,
  category,
  kicker,
  topic,
  title,
  deck,
  body,
  summary,
  why_written,
  reading_minutes,
  source_count,
  researched_at,
  published_at
)
values (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'generic-correction-audit-test',
  'published',
  'tech-science',
  'Test',
  'Generic correction audit',
  'Corrected generic article',
  'Generic test deck.',
  '[{"type":"paragraph","text":"Generic text.","citations":[]}]'::jsonb,
  '["One","Two","Three"]'::jsonb,
  'Database authorization test',
  1,
  0,
  '2026-09-05T12:00:00Z',
  '2026-09-05T12:00:00Z'
);

select extensions.lives_ok(
  $$
    insert into private.article_correction_audits (
      id,
      article_id,
      owner_id,
      idempotency_key,
      request_fingerprint,
      original_artifact_sha256,
      corrected_artifact_sha256,
      expected_original_fingerprint,
      corrected_fingerprint,
      before_snapshot,
      after_snapshot,
      corrected_by,
      correction_note,
      corrected_at
    )
    values (
      '83000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001',
      'article-correction.generic.v1',
      repeat('a', 64),
      repeat('b', 64),
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      '{"version":1,"state":"before"}'::jsonb,
      '{"version":1,"state":"after"}'::jsonb,
      'reviewed-editor',
      'A concise public correction note.',
      '2026-09-05T13:00:00Z'
    )
  $$,
  'the database owner can append a reviewed correction audit'
);

select extensions.throws_ok(
  $$
    update private.article_correction_audits
    set correction_note = 'Rewritten note.'
    where id = '83000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'article correction audit history is immutable',
  'existing audit rows cannot be updated'
);

select extensions.throws_ok(
  $$
    delete from private.article_correction_audits
    where id = '83000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'article correction audit history is immutable',
  'existing audit rows cannot be deleted directly'
);

set local "request.jwt.claim.sub" =
  '81000000-0000-4000-8000-000000000001';
set local role edison_api;

select extensions.results_eq(
  $$
    select correction_note
    from private.read_article_correction_disclosure(
      '82000000-0000-4000-8000-000000000001'
    )
  $$,
  $$ values ('A concise public correction note.'::text) $$,
  'an active owner can read only the correction disclosure'
);

select extensions.throws_ok(
  $$ select before_snapshot from private.article_correction_audits $$,
  '42501',
  null,
  'the API role cannot bypass the narrow disclosure function'
);

reset role;
set local "request.jwt.claim.sub" =
  '81000000-0000-4000-8000-000000000002';
set local role edison_api;

select extensions.is(
  (
    select count(*)::integer
    from private.read_article_correction_disclosure(
      '82000000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'another authenticated reader cannot see the disclosure'
);

reset role;
update public.alpha_memberships
set status = 'revoked'
where user_id = '81000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.sub" =
  '81000000-0000-4000-8000-000000000001';
set local role edison_api;

select extensions.is(
  (
    select count(*)::integer
    from private.read_article_correction_disclosure(
      '82000000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'revoked membership hides the disclosure'
);

reset role;
update public.alpha_memberships
set status = 'active'
where user_id = '81000000-0000-4000-8000-000000000001';
update public.articles
set status = 'draft'
where id = '82000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.sub" =
  '81000000-0000-4000-8000-000000000001';
set local role edison_api;

select extensions.is(
  (
    select count(*)::integer
    from private.read_article_correction_disclosure(
      '82000000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'an unpublished article does not expose correction metadata'
);

reset role;

select * from finish();
rollback;
