begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select has_table('private', 'demand_public_shares', 'publications are stored privately');
select has_table('private', 'demand_share_operations', 'sharing operation identities are private');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname in ('demand_public_shares','demand_share_operations')
  and c.relrowsecurity and c.relforcerowsecurity), 2, 'both publication tables force RLS');
select ok(has_function_privilege('edison_public','edison_public_api.read_demand_article_share(text)','execute'),
  'only the public server role receives the narrow reader');
select ok(not has_function_privilege('anon','edison_public_api.read_demand_article_share(text)','execute')
  and not has_function_privilege('authenticated','edison_public_api.read_demand_article_share(text)','execute'),
  'browser database roles cannot invoke the public server boundary');
select is((select count(*)::integer from information_schema.role_table_grants
  where table_schema = 'private' and table_name in ('demand_public_shares','demand_share_operations')
  and grantee in ('anon','authenticated','service_role','edison_api','edison_public','edison_demand_api')), 0,
  'public, browser, legacy and scoped API roles have no publication table grants');
select ok(has_table_privilege('edison_demand_worker','private.demand_public_shares','select')
  and has_table_privilege('edison_demand_worker','private.demand_public_shares','insert')
  and not has_table_privilege('edison_demand_worker','private.demand_public_shares','update')
  and not has_table_privilege('edison_demand_worker','private.demand_public_shares','delete'),
  'normal sharing is append-only, with no worker revocation or rewrite privilege');

-- Synthetic fixtures only. Rollback removes them without deleting published data.
insert into private.demand_principals(id, guest_token_hash, created_at, expires_at) values
 ('d3400000-0000-4000-8000-000000000101', repeat('c',64), '2020-01-01', '2099-01-01'),
 ('d3400000-0000-4000-8000-000000000102', repeat('d',64), '2020-01-01', '2099-01-01');
insert into private.demand_loops(id, principal_id, title, original_curiosity) values
 ('d3400000-0000-4000-8000-000000000201', 'd3400000-0000-4000-8000-000000000101', 'Synthetic loop', 'PRIVATE CURIOSITY');
insert into private.demand_requests(id, principal_id, loop_id, kind, status, stage, idempotency_key, request_fingerprint, snapshot, reserved_microusd) values
 ('d3400000-0000-4000-8000-000000000301', 'd3400000-0000-4000-8000-000000000101', 'd3400000-0000-4000-8000-000000000201',
  'ideas', 'succeeded', 'ready', 'share-fixture-batch', repeat('a',64), '{}', 0);
insert into private.demand_ideas(id, principal_id, loop_id, batch_request_id, batch_revision, rank, title, deck, brief, evidence) values
 ('d3400000-0000-4000-8000-000000000401', 'd3400000-0000-4000-8000-000000000101', 'd3400000-0000-4000-8000-000000000201',
  'd3400000-0000-4000-8000-000000000301', 0, 1, 'Synthetic uncited article', 'A complete constructed example.', '{}', '{}'),
 ('d3400000-0000-4000-8000-000000000402', 'd3400000-0000-4000-8000-000000000101', 'd3400000-0000-4000-8000-000000000201',
  'd3400000-0000-4000-8000-000000000301', 0, 2, 'Synthetic cited article', 'A second complete constructed example.', '{}', '{}');
insert into private.demand_requests(id, principal_id, loop_id, idea_id, kind, status, stage, idempotency_key, request_fingerprint, snapshot, result, reserved_microusd) values
 ('d3400000-0000-4000-8000-000000000302', 'd3400000-0000-4000-8000-000000000101', 'd3400000-0000-4000-8000-000000000201',
  'd3400000-0000-4000-8000-000000000401', 'article', 'succeeded', 'ready', 'share-fixture-article-one', repeat('b',64), '{}', '{"private":"NOT PUBLIC"}', 0),
 ('d3400000-0000-4000-8000-000000000303', 'd3400000-0000-4000-8000-000000000101', 'd3400000-0000-4000-8000-000000000201',
  'd3400000-0000-4000-8000-000000000402', 'article', 'succeeded', 'ready', 'share-fixture-article-two', repeat('c',64), '{}', '{"private":"NOT PUBLIC"}', 0);
insert into private.demand_public_shares(id,principal_id,article_request_id,token,snapshot,snapshot_fingerprint) values
 ('d3400000-0000-4000-8000-000000000501','d3400000-0000-4000-8000-000000000101','d3400000-0000-4000-8000-000000000302',repeat('1',64),
  '{"version":1,"title":"Synthetic uncited article","deck":"A complete constructed example.","body":[{"type":"paragraph","text":"A controller compares a reading with a target.","citations":[]}],"sources":[],"sourceCount":0,"basis":"general_knowledge","researchedAt":null,"readingMinutes":1,"publishedAt":"2026-09-07T14:00:00Z","correction":null}',repeat('e',64)),
 ('d3400000-0000-4000-8000-000000000502','d3400000-0000-4000-8000-000000000101','d3400000-0000-4000-8000-000000000303',repeat('2',64),
  '{"version":1,"title":"Synthetic cited article","deck":"A second complete constructed example.","body":[{"type":"paragraph","text":"This is a constructed source example.","citations":[{"sourceId":"d3400000-0000-4000-8000-000000000601","label":"1","private":"PRIVATE CITATION"}],"private":"PRIVATE BLOCK"}],"sources":[{"id":"d3400000-0000-4000-8000-000000000601","title":"Example","publisher":"Example","url":"https://example.org/control","publishedAt":null,"accessedAt":"2026-09-07T14:00:00Z","private":"PRIVATE SOURCE"}],"sourceCount":1,"basis":"mixed","researchedAt":"2026-09-07T14:00:00Z","readingMinutes":1,"publishedAt":"2026-09-07T14:00:00Z","correction":null}',repeat('f',64));
insert into private.demand_share_operations(principal_id,article_request_id,share_id,idempotency_key) values
 ('d3400000-0000-4000-8000-000000000101','d3400000-0000-4000-8000-000000000302','d3400000-0000-4000-8000-000000000501','same-share-operation');

select throws_ok($$insert into private.demand_public_shares(principal_id,article_request_id,token,snapshot,snapshot_fingerprint)
  select principal_id,article_request_id,repeat('3',64),snapshot,snapshot_fingerprint from private.demand_public_shares
  where id='d3400000-0000-4000-8000-000000000501'$$, '23505', null,
  'concurrent/different keys cannot create two copies of one owner article');
select throws_ok($$insert into private.demand_share_operations(principal_id,article_request_id,share_id,idempotency_key)
  values('d3400000-0000-4000-8000-000000000101','d3400000-0000-4000-8000-000000000303','d3400000-0000-4000-8000-000000000502','same-share-operation')$$,
  '23505', null, 'one operation key cannot be rebound to a second article');
select throws_ok($$insert into private.demand_share_operations(principal_id,article_request_id,share_id,idempotency_key)
  values('d3400000-0000-4000-8000-000000000102','d3400000-0000-4000-8000-000000000302','d3400000-0000-4000-8000-000000000501','foreign-operation')$$,
  '23503', null, 'cross-owner operation links are rejected');
select throws_ok($$update private.demand_public_shares set snapshot=jsonb_set(snapshot,'{title}','"Changed"')
  where id='d3400000-0000-4000-8000-000000000501'$$, '23514', null, 'even privileged updates cannot rewrite a public version');
select throws_ok($$delete from private.demand_public_shares where id='d3400000-0000-4000-8000-000000000501'$$,
  '23514', null, 'public snapshots cannot be hard deleted');
select throws_ok($$delete from private.demand_share_operations where idempotency_key='same-share-operation'$$,
  '23514', null, 'lost-response operation history cannot be removed');
select throws_ok($$delete from private.demand_principals where id='d3400000-0000-4000-8000-000000000101'$$,
  '23503', null, 'principal cleanup cannot cascade-delete deliberately public reading');

grant usage on schema extensions to edison_public;
set local role edison_public;
select is((select snapshot->>'basis' from edison_public_api.read_demand_article_share(repeat('1',64))),
  'general_knowledge', 'anonymous reading preserves an uncited article without invented research');
select is((select snapshot->'sources' from edison_public_api.read_demand_article_share(repeat('1',64))),
  '[]'::jsonb, 'source-free reading has no invented bibliography');
select is((select snapshot#>>'{body,0,citations,0,sourceId}' from edison_public_api.read_demand_article_share(repeat('2',64))),
  'd3400000-0000-4000-8000-000000000601', 'sourced reading preserves exact citation identity');
select is((select snapshot::text like '%PRIVATE%' from edison_public_api.read_demand_article_share(repeat('2',64))),
  false, 'nested arbitrary block/source/citation fields never leave the database function');
select throws_ok('select snapshot from private.demand_public_shares', '42501', null, 'public role cannot bypass projection');
select is((select count(*)::integer from edison_public_api.read_demand_article_share(repeat('1',63))),
  0, 'invalid-length tokens disclose nothing');
select is((select count(*)::integer from edison_public_api.read_demand_article_share(repeat('a',64))),
  0, 'unknown tokens disclose nothing');
reset role;
update private.demand_loops set title='Renamed synthetic loop' where id='d3400000-0000-4000-8000-000000000201';
update private.demand_principals set expires_at='2021-01-01' where id='d3400000-0000-4000-8000-000000000101';
set local role edison_public;
select is((select count(*)::integer from edison_public_api.read_demand_article_share(repeat('1',64))),
  1, 'loop rename and guest expiry do not undo deliberate publication');
reset role;
update private.demand_public_shares set revoked_at=now() where id='d3400000-0000-4000-8000-000000000501';
set local role edison_public;
select is((select count(*)::integer from edison_public_api.read_demand_article_share(repeat('1',64))),
  0, 'explicit operator revocation hides a snapshot without deleting it');
reset role;
select throws_ok($$update private.demand_public_shares set revoked_at=null where id='d3400000-0000-4000-8000-000000000501'$$,
  '23514', null, 'revoked snapshot tokens cannot be silently resurrected');
select * from finish();
rollback;
