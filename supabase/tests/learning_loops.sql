begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

select has_column(
  'public',
  'learning_threads',
  'original_curiosity',
  'learning loops preserve the reader original curiosity'
);
select has_column(
  'public',
  'learning_threads',
  'revision',
  'learning loops keep an explicit direction revision'
);
select has_table(
  'public',
  'learning_loop_direction_mutations',
  'loop direction history is durable'
);
select has_table(
  'public',
  'learning_loop_public_articles',
  'explicit public starter membership is durable'
);
select has_index(
  'public',
  'learning_threads',
  'learning_threads_user_normalized_title_unique',
  'normalized loop titles are unique for one reader'
);
select has_index(
  'public',
  'learning_loop_direction_mutations',
  'learning_loop_direction_mutations_user_key_unique',
  'loop direction retries have a durable idempotency boundary'
);
select has_index(
  'public',
  'learning_loop_direction_mutations',
  'learning_loop_direction_mutations_undo_once_unique',
  'one direction mutation can be undone at most once'
);
select has_index(
  'public',
  'learning_loop_direction_mutations',
  'learning_loop_direction_mutations_loop_revision_unique',
  'one loop revision can have only one durable mutation'
);
select has_trigger(
  'public',
  'learning_threads',
  'learning_threads_enforce_retained_limit',
  'the retained loop cap is enforced in the database'
);
select has_trigger(
  'public',
  'articles',
  'articles_enforce_learning_loop_owner',
  'article loop membership is owner checked'
);
select ok(
  has_table_privilege(
    'edison_api',
    'public.learning_loop_direction_mutations',
    'select'
  )
    and has_table_privilege(
      'edison_api',
      'public.learning_loop_direction_mutations',
      'insert'
    )
    and has_table_privilege(
      'edison_api',
      'public.learning_loop_public_articles',
      'select'
    )
    and has_table_privilege(
      'edison_api',
      'public.learning_loop_public_articles',
      'insert'
    ),
  'the API role has the narrow loop read and append privileges it needs'
);
select ok(
  not has_table_privilege(
    'edison_api',
    'public.learning_loop_public_articles',
    'update'
  )
    and not has_table_privilege(
      'edison_api',
      'public.learning_loop_public_articles',
      'delete'
    )
    and not has_table_privilege(
      'edison_api',
      'public.learning_loop_direction_mutations',
      'delete'
    )
    and has_column_privilege(
      'edison_api',
      'public.learning_threads',
      'direction',
      'update'
    )
    and not has_column_privilege(
      'edison_api',
      'public.learning_threads',
      'title',
      'update'
    ),
  'the API role can curate state but cannot rewrite identity, membership, or history'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'learning_loop_direction_mutations',
        'learning_loop_public_articles'
      )
  ),
  0,
  'browser database roles receive no direct loop-table grants'
);

insert into auth.users (id, email)
values
  ('51000000-0000-4000-8000-000000000001', 'loop-one@edison.test'),
  ('51000000-0000-4000-8000-000000000002', 'loop-two@edison.test');

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
values
  (
    '52000000-0000-4000-8000-000000000001',
    'news',
    '2026-09-04',
    'Published starter',
    'draft',
    null,
    'starter-loop-published',
    repeat('a', 64)
  ),
  (
    '52000000-0000-4000-8000-000000000002',
    'news',
    '2026-09-05',
    'Draft starter',
    'draft',
    null,
    'starter-loop-draft',
    repeat('b', 64)
  );

insert into public.public_starter_edition_articles (
  id, edition_id, position, reason, snapshot
)
values
  (
    '53000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    1,
    'A published beginning.',
    '{"version":1}'::jsonb
  ),
  (
    '53000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000002',
    1,
    'A draft must remain unavailable.',
    '{"version":1}'::jsonb
  );

update public.public_starter_editions
set status = 'published', published_at = '2026-09-04T12:00:00Z'
where id = '52000000-0000-4000-8000-000000000001';

insert into public.learning_threads (
  id,
  user_id,
  title,
  normalized_title,
  original_curiosity,
  direction,
  revision,
  creation_idempotency_key,
  creation_request_fingerprint,
  slug,
  summary,
  status,
  current_level
)
values (
  '54000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000002',
  'Another reader loop',
  'another reader loop',
  'Private to another reader',
  '',
  0,
  'loop-other-reader',
  repeat('c', 64),
  'another-reader-loop',
  'Private to another reader',
  'active',
  'unspecified'
);

set local "request.jwt.claim.sub" = '51000000-0000-4000-8000-000000000001';
grant usage on schema extensions to edison_api;
set local role edison_api;

select extensions.lives_ok(
  $$
    insert into public.learning_threads (
      id,
      user_id,
      title,
      normalized_title,
      original_curiosity,
      direction,
      revision,
      creation_idempotency_key,
      creation_request_fingerprint,
      slug,
      summary,
      status,
      current_level
    ) values (
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'AI',
      'ai',
      'AI',
      '',
      0,
      'loop-create-one',
      repeat('d', 64),
      'ai-loop',
      'AI',
      'active',
      'unspecified'
    )
  $$,
  'a reader can create a loop from a two-letter curiosity'
);
select extensions.is(
  (select count(*)::integer from public.learning_threads),
  1,
  'RLS exposes only the claimed reader loop'
);
select extensions.throws_ok(
  $$
    insert into public.learning_threads (
      user_id, title, normalized_title, original_curiosity,
      creation_idempotency_key, creation_request_fingerprint, slug, summary
    ) values (
      '51000000-0000-4000-8000-000000000002',
      'Cross owner',
      'cross owner',
      'Must fail',
      'loop-cross-owner',
      repeat('e', 64),
      'cross-owner',
      'Must fail'
    )
  $$,
  '42501',
  null,
  'RLS rejects creating a loop for another reader'
);
select extensions.throws_ok(
  $$
    insert into public.learning_threads (
      user_id, title, normalized_title, original_curiosity,
      creation_idempotency_key, creation_request_fingerprint, slug, summary
    ) values (
      '51000000-0000-4000-8000-000000000001',
      ' AI ',
      'ai',
      'A different request',
      'loop-create-two',
      repeat('f', 64),
      'ai-loop-duplicate',
      'A different request'
    )
  $$,
  '23505',
  null,
  'normalized title uniqueness prevents duplicate loops'
);
select extensions.throws_ok(
  $$
    insert into public.learning_threads (
      user_id, title, normalized_title, original_curiosity,
      creation_idempotency_key, creation_request_fingerprint, slug, summary
    ) values (
      '51000000-0000-4000-8000-000000000001',
      'Different title',
      'different title',
      'A different request',
      'loop-create-one',
      repeat('0', 64),
      'different-title',
      'A different request'
    )
  $$,
  '23505',
  null,
  'creation idempotency keys cannot create two loops'
);
select extensions.lives_ok(
  $$
    insert into public.learning_loop_public_articles (
      loop_id, user_id, public_article_id, position
    ) values (
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      1
    )
  $$,
  'a loop can explicitly retain a published starter article'
);
select extensions.throws_ok(
  $$
    insert into public.learning_loop_public_articles (
      loop_id, user_id, public_article_id, position
    ) values (
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000002',
      2
    )
  $$,
  '23514',
  null,
  'a draft starter article cannot become loop history'
);
select extensions.throws_ok(
  $$
    insert into public.learning_loop_public_articles (
      loop_id, user_id, public_article_id, position
    ) values (
      '54000000-0000-4000-8000-000000000002',
      '51000000-0000-4000-8000-000000000002',
      '53000000-0000-4000-8000-000000000001',
      1
    )
  $$,
  '42501',
  null,
  'RLS rejects public membership writes for another reader loop'
);
select extensions.throws_ok(
  $$
    update public.learning_threads
    set direction = 'Start with practical mechanisms.', revision = 1
    where id = '54000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'a direction cannot change without append-only mutation history'
);
select extensions.lives_ok(
  $$
    insert into public.learning_loop_direction_mutations (
      id, loop_id, user_id, operation, base_revision, resulting_revision,
      before_direction, after_direction, idempotency_key,
      request_fingerprint
    ) values (
      '55000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'set', 0, 1, '', 'Start with practical mechanisms.',
      'loop-direction-one', repeat('1', 64)
    )
  $$,
  'a direction mutation can be appended for an owned loop'
);
select extensions.lives_ok(
  $$
    update public.learning_threads
    set direction = 'Start with practical mechanisms.', revision = 1
    where id = '54000000-0000-4000-8000-000000000001'
  $$,
  'the matching mutation permits exactly the recorded revision change'
);
select extensions.is(
  (
    select revision::text || ':' || direction
    from public.learning_threads
    where id = '54000000-0000-4000-8000-000000000001'
  ),
  '1:Start with practical mechanisms.',
  'the first direction revision is exact and inspectable'
);
select extensions.throws_ok(
  $$
    insert into public.learning_loop_direction_mutations (
      loop_id, user_id, operation, base_revision, resulting_revision,
      before_direction, after_direction, idempotency_key,
      request_fingerprint
    ) values (
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'set', 1, 2, 'Start with practical mechanisms.', 'Duplicate retry',
      'loop-direction-one', repeat('2', 64)
    )
  $$,
  '23505',
  null,
  'a direction idempotency key cannot append a second mutation'
);
select extensions.lives_ok(
  $$
    insert into public.learning_loop_direction_mutations (
      id, loop_id, user_id, operation, base_revision, resulting_revision,
      before_direction, after_direction, idempotency_key,
      request_fingerprint, undo_of_mutation_id
    ) values (
      '55000000-0000-4000-8000-000000000002',
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'undo', 1, 2, 'Start with practical mechanisms.', '',
      'loop-direction-undo', repeat('3', 64),
      '55000000-0000-4000-8000-000000000001'
    )
  $$,
  'an undo is itself durable append-only history'
);
select extensions.lives_ok(
  $$
    update public.learning_loop_direction_mutations
    set
      reverted_by_mutation_id = '55000000-0000-4000-8000-000000000002',
      updated_at = now()
    where id = '55000000-0000-4000-8000-000000000001'
  $$,
  'the exact undo can mark its source as reverted'
);
select extensions.lives_ok(
  $$
    update public.learning_threads
    set direction = '', revision = 2
    where id = '54000000-0000-4000-8000-000000000001'
  $$,
  'undo restores the exact prior direction with a new revision'
);
select extensions.is(
  (
    select revision::text || ':' || direction
    from public.learning_threads
    where id = '54000000-0000-4000-8000-000000000001'
  ),
  '2:',
  'undo preserves reloadable current direction truth'
);
select extensions.throws_ok(
  $$
    insert into public.learning_loop_direction_mutations (
      loop_id, user_id, operation, base_revision, resulting_revision,
      before_direction, after_direction, idempotency_key,
      request_fingerprint, undo_of_mutation_id
    ) values (
      '54000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      'undo', 2, 3, '', '', 'loop-direction-undo-two', repeat('4', 64),
      '55000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'the same direction mutation cannot be undone twice'
);

select extensions.lives_ok(
  $$
    insert into public.learning_threads (
      user_id, title, normalized_title, original_curiosity,
      creation_idempotency_key, creation_request_fingerprint, slug, summary
    )
    select
      '51000000-0000-4000-8000-000000000001',
      'Loop ' || number,
      'loop ' || number,
      'Curiosity ' || number,
      'loop-cap-' || number,
      repeat('5', 64),
      'loop-' || number,
      'Curiosity ' || number
    from generate_series(2, 30) as number
  $$,
  'a reader can retain exactly thirty loops'
);
select extensions.is(
  (select count(*)::integer from public.learning_threads),
  30,
  'the retained cap is visible through the reader RLS boundary'
);
select extensions.throws_ok(
  $$
    insert into public.learning_threads (
      user_id, title, normalized_title, original_curiosity,
      creation_idempotency_key, creation_request_fingerprint, slug, summary
    ) values (
      '51000000-0000-4000-8000-000000000001',
      'Loop 31', 'loop 31', 'Curiosity 31', 'loop-cap-31', repeat('6', 64),
      'loop-31', 'Curiosity 31'
    )
  $$,
  '23514',
  null,
  'the database rejects a thirty-first retained loop'
);
select extensions.lives_ok(
  $$
    update public.learning_threads
    set status = 'archived'
    where normalized_title = 'loop 2'
  $$,
  'archiving a loop releases one retained slot'
);
select extensions.lives_ok(
  $$
    insert into public.learning_threads (
      user_id, title, normalized_title, original_curiosity,
      creation_idempotency_key, creation_request_fingerprint, slug, summary
    ) values (
      '51000000-0000-4000-8000-000000000001',
      'Loop 31', 'loop 31', 'Curiosity 31', 'loop-cap-31', repeat('6', 64),
      'loop-31', 'Curiosity 31'
    )
  $$,
  'a new loop can reuse capacity released by an archive'
);
select extensions.lives_ok(
  $$
    update public.learning_threads
    set status = 'paused'
    where id = '54000000-0000-4000-8000-000000000001'
  $$,
  'a loop can be paused without losing its history'
);
select extensions.is(
  (
    select status
    from public.learning_threads
    where id = '54000000-0000-4000-8000-000000000001'
  ),
  'paused',
  'the owner can still read a paused loop'
);

reset role;

select extensions.throws_ok(
  $$
    insert into public.articles (
      owner_id, learning_thread_id, slug, status, category, kicker, topic,
      title, deck, body, summary, why_written, reading_minutes, source_count,
      researched_at
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000002',
      'cross-owner-loop-article', 'published', 'tech-science', 'Test', 'Test',
      'Cross owner', 'Must fail', '[]'::jsonb,
      '["One","Two","Three"]'::jsonb, 'Test', 3, 0, now()
    )
  $$,
  '23503',
  null,
  'an article cannot claim another reader learning loop'
);
select extensions.throws_ok(
  $$
    update public.learning_loop_direction_mutations
    set before_direction = 'Rewritten history'
    where id = '55000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'even a privileged write cannot rewrite direction history'
);

set local "request.jwt.claim.sub" = '51000000-0000-4000-8000-000000000002';
set local role edison_api;
select extensions.is(
  (select count(*)::integer from public.learning_threads),
  1,
  'a different reader sees only their own active loop'
);
reset role;

select * from finish();
rollback;
