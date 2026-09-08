begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_schema(
  'edison_public_api',
  'public share functions have a dedicated schema'
);

select ok(
  to_regprocedure('edison_public_api.read_article_share(text)') is not null,
  'the narrow public share reader exists'
);

select ok(
  has_schema_privilege('edison_public', 'edison_public_api', 'usage'),
  'the public application role can resolve the share reader'
);

select ok(
  has_function_privilege(
    'edison_public',
    'edison_public_api.read_article_share(text)',
    'execute'
  ),
  'the public application role can execute only the share reader'
);

select is(
  has_table_privilege('edison_public', 'public.article_shares', 'select'),
  false,
  'the public application role cannot read the shares table'
);

select is(
  has_table_privilege('edison_public', 'public.alpha_memberships', 'select'),
  false,
  'the public application role cannot enumerate memberships'
);

insert into auth.users (id, email)
values (
  '71000000-0000-4000-8000-000000000001',
  'public-share-owner@edison.test'
);
-- Admit only this synthetic positive-case owner; revocation cases below remain.
update public.alpha_memberships set status='active'
where user_id='71000000-0000-4000-8000-000000000001';

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
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'public-share-boundary-test',
  'published',
  'tech-science',
  'Test',
  'Public share boundary',
  'A deliberately narrow public share',
  'Only a sanitized snapshot may cross this boundary.',
  '[]'::jsonb,
  '["One", "Two", "Three"]'::jsonb,
  'Database authorization test',
  1,
  0,
  now(),
  now()
);

insert into public.article_shares (
  id,
  article_id,
  user_id,
  slug,
  snapshot
)
values (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '0123456789abcdef0123456789abcdef',
  '{"version": 1}'::jsonb
);

grant usage on schema extensions to edison_public;
set local role edison_public;

select extensions.results_eq(
  $$
    select slug
    from edison_public_api.read_article_share(
      '0123456789abcdef0123456789abcdef'
    )
  $$,
  $$ values ('0123456789abcdef0123456789abcdef'::text) $$,
  'an active member share is readable only through the narrow function'
);

select extensions.throws_ok(
  $$ select snapshot from public.article_shares $$,
  '42501',
  null,
  'the public application role cannot bypass the share function'
);

reset role;

update public.alpha_memberships
set status = 'revoked'
where user_id = '71000000-0000-4000-8000-000000000001';

set local role edison_public;

select extensions.is(
  (
    select count(*)::integer
    from edison_public_api.read_article_share(
      '0123456789abcdef0123456789abcdef'
    )
  ),
  0,
  'revoking alpha membership immediately hides the public share'
);

reset role;

update public.alpha_memberships
set status = 'active'
where user_id = '71000000-0000-4000-8000-000000000001';

update public.article_shares
set revoked_at = now()
where id = '73000000-0000-4000-8000-000000000001';

set local role edison_public;

select extensions.is(
  (
    select count(*)::integer
    from edison_public_api.read_article_share(
      '0123456789abcdef0123456789abcdef'
    )
  ),
  0,
  'revoking the share immediately hides it from the public function'
);

reset role;

select * from finish();
rollback;
