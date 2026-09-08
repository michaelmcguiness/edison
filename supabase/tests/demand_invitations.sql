begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_schema_privilege('anon','edison_public_api','usage')
 and not has_schema_privilege('authenticated','edison_public_api','usage')
 and not pg_has_role('anon','edison_public','member') and not pg_has_role('authenticated','edison_public','member'),
 'PostgREST roles cannot acquire the server-only recipient projection role');
select ok(not has_function_privilege('anon','edison_public_api.read_article_share(text)','execute')
 and not has_function_privilege('authenticated','edison_public_api.read_article_share(text)','execute')
 and not has_function_privilege('anon','edison_public_api.read_demand_article_share(text)','execute')
 and not has_function_privilege('authenticated','edison_public_api.read_demand_article_share(text)','execute'),
 'both share projections require the member-gated server boundary');
insert into auth.users(id,email,email_confirmed_at) values
 ('82000000-0000-4000-8000-000000000001','inviter@example.test',now()),
 ('82000000-0000-4000-8000-000000000002','recipient@example.test',now()),
 ('82000000-0000-4000-8000-000000000003','foreign@example.test',now()),
 ('82000000-0000-4000-8000-000000000004','unverified@example.test',null),
 ('82000000-0000-4000-8000-000000000005','revoked@example.test',now()),
 ('82000000-0000-4000-8000-000000000006','existing@example.test',now());
select is((select status from public.alpha_memberships where user_id='82000000-0000-4000-8000-000000000002'),'pending','new verified signup is not automatically admitted');
update public.profiles set email='stale-profile@example.test' where id='82000000-0000-4000-8000-000000000002';
select is((select email from private.demand_invitation_member('82000000-0000-4000-8000-000000000002')),'recipient@example.test',
 'invitation identity uses authoritative Auth email, not mutable profile email');
update public.alpha_memberships set status='active' where user_id in('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000006');
update public.alpha_memberships set status='revoked' where user_id='82000000-0000-4000-8000-000000000005';
insert into private.demand_invite_grants(user_id) values('82000000-0000-4000-8000-000000000001'),('82000000-0000-4000-8000-000000000006');
select ok((select count(*)=4 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
 ('private.demand_invite_grants'::regclass,'private.demand_invitations'::regclass,'private.demand_invitation_operations'::regclass,'private.demand_invitation_delivery_results'::regclass)),'all invitation state forces RLS');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name in('demand_invite_grants','demand_invitations','demand_invitation_operations','demand_invitation_delivery_results')
 and grantee in('PUBLIC','anon','authenticated','service_role','edison_api','edison_public','edison_demand_api')),'no browser, public or legacy raw invitation grants');
select ok(has_table_privilege('edison_demand_worker','private.demand_invitations','update')
 and not has_table_privilege('edison_demand_worker','private.demand_invitations','delete')
 and not has_table_privilege('edison_demand_worker','private.demand_invite_grants','update')
 and not has_table_privilege('edison_demand_worker','private.demand_invitation_operations','update')
 and not has_table_privilege('edison_demand_worker','private.demand_invitation_delivery_results','update')
 and not has_table_privilege('edison_demand_worker','private.demand_invitation_delivery_results','delete'),'only invitation delivery/state is mutable by worker');
select ok((select prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='private.redeem_demand_invitation(uuid,uuid)'::regprocedure),'redemption has fixed privileged search path');
select ok(not has_function_privilege('authenticated','private.redeem_demand_invitation(uuid,uuid)','execute')
 and not has_function_privilege('anon','private.redeem_demand_invitation(uuid,uuid)','execute')
 and has_function_privilege('edison_demand_worker','private.redeem_demand_invitation(uuid,uuid)','execute'),'only verified API worker can invoke redemption');
insert into private.demand_invitations(id,inviter_user_id,recipient_email,status) values
 ('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000001','recipient@example.test','sent'),
 ('82000000-0000-4000-8000-000000000012','82000000-0000-4000-8000-000000000001','unverified@example.test','sent'),
 ('82000000-0000-4000-8000-000000000013','82000000-0000-4000-8000-000000000001','revoked@example.test','sent'),
 ('82000000-0000-4000-8000-000000000014','82000000-0000-4000-8000-000000000001','existing@example.test','sent');
select ok(not private.redeem_demand_invitation('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000003'),'verified wrong email cannot redeem');
select ok(not private.redeem_demand_invitation('82000000-0000-4000-8000-000000000012','82000000-0000-4000-8000-000000000004'),'unverified recipient cannot redeem');
select ok(not private.redeem_demand_invitation('82000000-0000-4000-8000-000000000013','82000000-0000-4000-8000-000000000005'),'operator-revoked recipient cannot self-reactivate');
select ok(private.redeem_demand_invitation('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000002'),'verified exact pending recipient is admitted');
select is((select status from public.alpha_memberships where user_id='82000000-0000-4000-8000-000000000002'),'active','successful acceptance activates membership');
select is((select allowance from private.demand_invite_grants where user_id='82000000-0000-4000-8000-000000000002'),5,'new member gets exactly five once');
select ok(private.redeem_demand_invitation('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000002'),'repeat acceptance is idempotent');
select is((select count(*)::integer from private.demand_invite_grants where user_id='82000000-0000-4000-8000-000000000002'),1,'callback retry does not add another grant');
select ok(private.redeem_demand_invitation('82000000-0000-4000-8000-000000000014','82000000-0000-4000-8000-000000000006'),'existing member explicitly accepts through same consumed-slot lifecycle');
select is((select allowance from private.demand_invite_grants where user_id='82000000-0000-4000-8000-000000000006'),5,'existing member grant is not increased');
select throws_ok($$update private.demand_invitations set status='revoked',redeemed_by=null,redeemed_at=null where id='82000000-0000-4000-8000-000000000011'$$,'23514',null,'accepted slot cannot be returned or reassigned');
select throws_ok($$update private.demand_invite_grants set allowance=10 where user_id='82000000-0000-4000-8000-000000000002'$$,'23514',null,'allowance password cannot rewrite invitation grant');
select throws_ok($$update private.demand_invitations set recipient_email='other@example.test' where id='82000000-0000-4000-8000-000000000012'$$,'23514',null,'invitation recipient identity is immutable');
insert into private.demand_invitation_operations(id,actor_user_id,idempotency_key,request_fingerprint,invitation_id,operation,receipt)
 values('82000000-0000-4000-8000-000000000021','82000000-0000-4000-8000-000000000001','constructed-delivery',repeat('a',64),'82000000-0000-4000-8000-000000000012','create','{"delivery":true}');
insert into private.demand_invitation_delivery_results(operation_id,outcome) values('82000000-0000-4000-8000-000000000021','failed');
select throws_ok($$update private.demand_invitation_delivery_results set outcome='sent' where operation_id='82000000-0000-4000-8000-000000000021'$$,'23514',null,'failed operation delivery outcome cannot be rewritten by a later resend');
update public.alpha_memberships set status='revoked' where user_id='82000000-0000-4000-8000-000000000002';
select ok(not private.redeem_demand_invitation('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000002'),'historical accepted link cannot restore revoked access');
select * from finish();
rollback;
