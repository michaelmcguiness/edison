begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select count(*)=6 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
 'private.demand_principal_claims'::regclass,'private.demand_allowance_grants'::regclass,'private.demand_allowance_allocations'::regclass,
 'private.demand_allowance_carryovers'::regclass,'private.demand_allowance_resets'::regclass,'private.demand_allowance_reset_attempts'::regclass)),
 'all entitlement and claim records force RLS');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name in
 ('demand_principal_claims','demand_allowance_grants','demand_allowance_allocations','demand_allowance_carryovers','demand_allowance_resets','demand_allowance_reset_attempts')
 and grantee in ('PUBLIC','anon','authenticated','service_role','edison_api','edison_public','edison_demand_api')), 'no browser/core/public table grants');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name in
 ('demand_principal_claims','demand_allowance_grants','demand_allowance_allocations','demand_allowance_carryovers','demand_allowance_resets','demand_allowance_reset_attempts')
 and grantee='edison_demand_worker' and privilege_type not in ('SELECT','INSERT')), 'worker can only append entitlement records');
select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in
 ('demand_principal_claims_immutable','demand_allowance_grants_immutable','demand_allowance_allocations_immutable','demand_allowance_carryovers_immutable','demand_allowance_resets_immutable','demand_allowance_reset_attempts_immutable') and tgenabled='O'),6,'all records have update/delete guards');
insert into auth.users(id,email) values('81000000-0000-4000-8000-000000000001','weekly-account@example.test');
-- Synthetic member of the retained active cohort, not public signup admission.
update public.alpha_memberships set status='active' where user_id='81000000-0000-4000-8000-000000000001';
insert into private.demand_principals(id,account_user_id) values('81000000-0000-4000-8000-000000000011','81000000-0000-4000-8000-000000000001');
insert into private.demand_principals(id,guest_token_hash,expires_at) values
 ('81000000-0000-4000-8000-000000000012',repeat('1',64),'2099-01-01'),
 ('81000000-0000-4000-8000-000000000013',repeat('2',64),'2099-01-01');
insert into private.demand_principal_claims(principal_id,account_principal_id,guest_token_hash) values
 ('81000000-0000-4000-8000-000000000012','81000000-0000-4000-8000-000000000011',repeat('1',64));
select is(private.demand_reader_id('81000000-0000-4000-8000-000000000012'),'81000000-0000-4000-8000-000000000011'::uuid,'claim has one canonical account');
select ok(private.demand_principal_is_active('81000000-0000-4000-8000-000000000012'),'claimed guest remains active under active membership');
select ok(not private.demand_principal_is_active('81000000-0000-4000-8000-000000000013'),'unclaimed anonymous sessions cannot authorize work or reading');
insert into private.demand_loops(id,principal_id,title,original_curiosity) values
 ('81000000-0000-4000-8000-000000000021','81000000-0000-4000-8000-000000000012','Claimed reading','Constructed reading'),
 ('81000000-0000-4000-8000-000000000022','81000000-0000-4000-8000-000000000013','Foreign reading','Other constructed reading');
select set_config('request.edison.demand_principal_id','81000000-0000-4000-8000-000000000011',true);
grant usage on schema extensions to edison_demand_api;
set local role edison_demand_api;
select is((select count(*)::integer from private.demand_loops),1,'account-scoped RLS sees its claimed history, never foreign reader');
select throws_ok($$select * from private.demand_allowance_grants$$,'42501',null,'reader cannot inspect raw allowance tables');
reset role;
select throws_ok($$update private.demand_principal_claims set account_principal_id='81000000-0000-4000-8000-000000000013'$$,'23514',null,'claim cannot be reassigned');
insert into private.demand_allowance_grants(id,principal_id,period_start,revision) values
 ('81000000-0000-4000-8000-000000000031','81000000-0000-4000-8000-000000000011','2026-09-07T00:00:00Z',0);
select throws_ok($$update private.demand_allowance_grants set revision=1$$,'23514',null,'reset cannot rewrite old revision');
select throws_ok($$delete from private.demand_allowance_grants$$,'23514',null,'usage grants cannot be erased');
select throws_ok($$insert into private.demand_allowance_grants(principal_id,period_start,revision) values
 ('81000000-0000-4000-8000-000000000011','2026-09-08T00:00:00Z',0)$$,'23514',null,'periods start Monday UTC');
update public.alpha_memberships set status='revoked' where user_id='81000000-0000-4000-8000-000000000001';
select ok(not private.demand_principal_is_active('81000000-0000-4000-8000-000000000012'),'account revocation also denies claimed guest work');
select set_config('request.edison.demand_principal_id','81000000-0000-4000-8000-000000000011',true);
set local role edison_demand_api;
select is((select count(*)::integer from private.demand_loops),0,'revoked account cannot read claim aliases');
reset role;
select * from finish();
rollback;
