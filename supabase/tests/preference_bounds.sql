begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_trigger(
  'public',
  'user_interests',
  'user_interests_retained_explicit_limit',
  'all explicit-interest writes share a database-enforced retained cap'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.feed_preferences'::regclass
      and constraint_record.conname = 'feed_preferences_knowledge_state_bounded'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
  ),
  'knowledge-state shape and size have a validated database check'
);
select is(
  has_function_privilege(
    'authenticated',
    'private.enforce_retained_explicit_interest_limit()',
    'execute'
  ),
  false,
  'browser roles cannot invoke the privileged cap function directly'
);

insert into auth.users (id, email)
values (
  '61000000-0000-4000-8000-000000000001',
  'preference-bounds@edison.test'
);

select extensions.lives_ok(
  $$
    update public.feed_preferences
    set knowledge_state = (
      select jsonb_agg(
        jsonb_build_object(
          'topic', 'Topic ' || position,
          'level', 'intermediate',
          'note', 'Reader-provided context'
        )
        order by position
      )
      from generate_series(1, 80) as position
    )
    where user_id = '61000000-0000-4000-8000-000000000001'
  $$,
  'a knowledge state at the 80-item limit remains valid'
);
select extensions.throws_ok(
  $$
    update public.feed_preferences
    set knowledge_state = (
      select jsonb_agg(
        jsonb_build_object(
          'topic', 'Topic ' || position,
          'level', 'intermediate',
          'note', 'Reader-provided context'
        )
        order by position
      )
      from generate_series(1, 81) as position
    )
    where user_id = '61000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the database rejects an 81st knowledge-state item'
);
select extensions.throws_ok(
  $$
    update public.feed_preferences
    set knowledge_state = jsonb_build_array(
      jsonb_build_object(
        'topic', 'Databases',
        'level', 'intermediate',
        'note', null,
        'private_extra', 'must not enter provider context'
      )
    )
    where user_id = '61000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the database rejects knowledge-state fields outside the public shape'
);
select is(
  private.knowledge_state_is_bounded(
    jsonb_build_array(
      jsonb_build_object(
        'topic', 'Databases',
        'level', 'intermediate',
        'note', repeat('x', 300000)
      )
    )
  ),
  false,
  'the validator rejects serialized knowledge state above 256 KiB'
);

select extensions.lives_ok(
  $$
    insert into public.user_interests (user_id, topic, kind, status)
    select
      '61000000-0000-4000-8000-000000000001',
      'Explicit topic ' || position,
      'explicit',
      case when position % 2 = 0 then 'active' else 'muted' end
    from generate_series(1, 50) as position
  $$,
  'a reader can retain 50 active and muted explicit interests'
);
select is(
  (
    select count(*)::integer
    from public.user_interests
    where user_id = '61000000-0000-4000-8000-000000000001'
      and kind = 'explicit'
      and status <> 'deleted'
  ),
  50,
  'muted explicit interests count toward retained reader truth'
);
select extensions.throws_ok(
  $$
    insert into public.user_interests (user_id, topic, kind, status)
    values (
      '61000000-0000-4000-8000-000000000001',
      'Explicit topic 51',
      'explicit',
      'active'
    )
  $$,
  '23514',
  'a reader can retain at most 50 explicit interests',
  'a direct insert cannot bypass the retained-interest cap'
);
select extensions.lives_ok(
  $$
    update public.user_interests
    set status = 'muted'
    where user_id = '61000000-0000-4000-8000-000000000001'
      and topic = 'Explicit topic 2'
  $$,
  'muting an interest does not falsely free retained capacity'
);
select extensions.throws_ok(
  $$
    insert into public.user_interests (user_id, topic, kind, status)
    values (
      '61000000-0000-4000-8000-000000000001',
      'Still over capacity',
      'explicit',
      'active'
    )
  $$,
  '23514',
  'a reader can retain at most 50 explicit interests',
  'a muted row still prevents a 51st retained interest'
);
select extensions.lives_ok(
  $$
    update public.user_interests
    set status = 'deleted'
    where user_id = '61000000-0000-4000-8000-000000000001'
      and topic = 'Explicit topic 1'
  $$,
  'deleting an explicit interest intentionally frees capacity'
);
select extensions.lives_ok(
  $$
    insert into public.user_interests (user_id, topic, kind, status)
    values (
      '61000000-0000-4000-8000-000000000001',
      'Replacement topic',
      'explicit',
      'active'
    )
  $$,
  'one new explicit interest fits after a retained row is deleted'
);
select extensions.throws_ok(
  $$
    update public.user_interests
    set status = 'active'
    where user_id = '61000000-0000-4000-8000-000000000001'
      and topic = 'Explicit topic 1'
  $$,
  '23514',
  'a reader can retain at most 50 explicit interests',
  'restoring a deleted interest cannot create a 51st retained row'
);
select extensions.lives_ok(
  $$
    update public.user_interests
    set evidence = '{"source":"reader"}'::jsonb
    where user_id = '61000000-0000-4000-8000-000000000001'
      and topic = 'Explicit topic 2'
  $$,
  'updating an already-retained row does not count it twice'
);
select extensions.lives_ok(
  $$
    insert into public.user_interests (user_id, topic, kind, status)
    values (
      '61000000-0000-4000-8000-000000000001',
      'A non-explicit signal',
      'inferred',
      'active'
    )
  $$,
  'non-explicit signals do not consume the explicit-interest allowance'
);
select is(
  (
    select count(*)::integer
    from public.user_interests
    where user_id = '61000000-0000-4000-8000-000000000001'
      and kind = 'explicit'
      and status <> 'deleted'
  ),
  50,
  'failed over-cap writes leave the retained count unchanged'
);

select * from finish();
rollback;
