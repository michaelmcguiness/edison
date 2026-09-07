begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_column('private', 'demand_loops', 'editor_instructions', 'editable instructions are separate from the original request');
select has_column('private', 'demand_loops', 'archived_at', 'deletion is a retained archive timestamp');
select has_table('private', 'demand_loop_edits', 'loop edit receipts are private');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.demand_loop_edits'::regclass), 'edit receipts force RLS');
select ok(has_table_privilege('edison_demand_worker','private.demand_loop_edits','select')
  and has_table_privilege('edison_demand_worker','private.demand_loop_edits','insert')
  and not has_table_privilege('edison_demand_worker','private.demand_loop_edits','update')
  and not has_table_privilege('edison_demand_worker','private.demand_loop_edits','delete'), 'receipts are append-only to the worker');
select is((select count(*)::integer from information_schema.role_table_grants
  where table_schema='private' and table_name='demand_loop_edits'
    and grantee in ('anon','authenticated','service_role','edison_api','edison_public','edison_demand_api')), 0, 'receipts expose no reader, legacy or public grants');
select ok(not has_table_privilege('edison_demand_worker','private.demand_loops','delete'), 'worker cannot hard-delete a retained loop');

insert into private.demand_principals (id,guest_token_hash,expires_at) values
  ('70000000-0000-4000-8000-000000000001',repeat('d',64),'2099-01-01'),
  ('70000000-0000-4000-8000-000000000002',repeat('e',64),'2099-01-01');
insert into private.demand_loops (id,principal_id,title,original_curiosity,revision,principles) values
  ('70000000-0000-4000-8000-000000000011','70000000-0000-4000-8000-000000000001','Sensors','Explain sensor mechanisms.',3,'{}'),
  ('70000000-0000-4000-8000-000000000012','70000000-0000-4000-8000-000000000002','Other loop','Keep the other reader separate.',0,'{}');
insert into private.demand_requests (id,principal_id,loop_id,kind,status,stage,idempotency_key,request_fingerprint,snapshot,reserved_microusd) values
  ('70000000-0000-4000-8000-000000000021','70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000011',
   'ideas','running','researching','synthetic-pending',repeat('a',64),'{"context":{"revision":3,"originalCuriosity":"Explain sensor mechanisms."}}',600000);

select lives_ok($$update private.demand_loops set editor_instructions='' where id='70000000-0000-4000-8000-000000000011'$$, 'empty override records deliberate instruction removal');
select throws_ok($$update private.demand_loops set editor_instructions=repeat('x',501) where id='70000000-0000-4000-8000-000000000011'$$,
  '23514',null,'instructions cannot exceed the existing context limit');
select throws_ok($$update private.demand_loops set original_curiosity='Silently replaced' where id='70000000-0000-4000-8000-000000000011'$$,
  '23514',null,'the original learning request is immutable');
select throws_ok($$update private.demand_loops set principal_id='70000000-0000-4000-8000-000000000002' where id='70000000-0000-4000-8000-000000000011'$$,
  '23514',null,'loop ownership cannot be reassigned');
select lives_ok($$update private.demand_loops set archived_at=now() where id='70000000-0000-4000-8000-000000000011'$$, 'archive leaves the retained loop in place');
select is((select revision from private.demand_loops where id='70000000-0000-4000-8000-000000000011'),3, 'archive does not invalidate in-flight generation revision');
select is((select status from private.demand_requests where id='70000000-0000-4000-8000-000000000021'),'running', 'archive does not cancel pending generation');
select is((select snapshot->'context'->>'originalCuriosity' from private.demand_requests where id='70000000-0000-4000-8000-000000000021'),
  'Explain sensor mechanisms.', 'previous request snapshot survives instruction removal and archive');
select throws_ok($$update private.demand_loops set archived_at=null where id='70000000-0000-4000-8000-000000000011'$$,
  '23514',null,'archive cannot be silently undone');

set local role edison_demand_worker;
select lives_ok($$insert into private.demand_loop_edits (principal_id,loop_id,idempotency_key,request_fingerprint,operation,receipt)
  values ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000011','synthetic-edit-1',repeat('a',64),'archive','{"originalCuriosity":"Explain sensor mechanisms."}')$$,
  'worker can append a correctly owned audit receipt');
select throws_ok($$insert into private.demand_loop_edits (principal_id,loop_id,idempotency_key,request_fingerprint,operation,receipt)
  values ('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000011','synthetic-edit-2',repeat('b',64),'edit','{}')$$,
  '23503',null,'receipt cannot bind another reader to the loop');
select throws_ok($$insert into private.demand_loop_edits (principal_id,loop_id,idempotency_key,request_fingerprint,operation,receipt)
  values ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000011','synthetic-edit-1',repeat('b',64),'edit','{}')$$,
  '23505',null,'one reader operation identity cannot append twice');
select throws_ok($$update private.demand_loop_edits set receipt='{}' where idempotency_key='synthetic-edit-1'$$,
  '42501',null,'the worker cannot rewrite a historical receipt');
select throws_ok($$delete from private.demand_loops where id='70000000-0000-4000-8000-000000000011'$$,
  '42501',null,'the supported worker cannot cascade-delete prior reading');
reset role;

select * from finish();
rollback;
