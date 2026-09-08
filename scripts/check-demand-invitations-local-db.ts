import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

// No configurable URL and no provider credentials: only the named disposable
// Supabase database, with synthetic recipients and an injected no-email sender.
const LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const workerInput=z.object({run:z.string().uuid(),actor:z.string().uuid(),kind:z.enum(["create","redeem","revoke"]),
  key:z.string().min(8).max(128),email:z.string().email().optional(),invitationId:z.string().uuid().optional()}).strict();
type Input=z.infer<typeof workerInput>;
type Outcome={ok:boolean;id?:string;status?:string;code?:string;pid:number;sends:number};
function guard(env:Readonly<Record<string,string|undefined>>) {
  if(Object.keys(env).some(key=>/^(?:PG|POSTGRES|SUPABASE_|OPENAI_|EDISON_|DOCKER_|DATABASE_URL$|DIRECT_URL$)/.test(key))||
    env.NODE_ENV==="production"||Object.hasOwn(env,"VERCEL")) throw new Error("Only an unconfigured disposable local environment is allowed");
}
function localContainer() {
  const config=readFileSync(new URL("../supabase/config.toml",import.meta.url),"utf8");
  assert.match(config,/^project_id\s*=\s*"edison-reader"\s*$/m);
  assert.match(config.split(/^\[db\]\s*$/m)[1]?.split(/^\[/m)[0]??"",/^port\s*=\s*54322\s*$/m);
  const metadata=JSON.parse(execFileSync("docker",["--host","unix:///var/run/docker.sock","container","inspect","supabase_db_edison-reader","--format",'{"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}'],
    {encoding:"utf8",timeout:10000,maxBuffer:65536,stdio:["ignore","pipe","pipe"]})) as {running:boolean;ports:Record<string,Array<{HostPort:string;HostIp:string}>>};
  assert.equal(metadata.running,true);assert.ok(metadata.ports["5432/tcp"].some(p=>p.HostPort==="54322"&&["127.0.0.1","0.0.0.0","::"].includes(p.HostIp)));
}
function safety() {
  guard({NODE_ENV:"test",CI:"true"});
  for(const name of ["DATABASE_URL","DIRECT_URL","PGHOST","PGPASSWORD","SUPABASE_SECRET_KEY","SUPABASE_ACCESS_TOKEN","OPENAI_API_KEY","EDISON_MEMBER_INVITATIONS_ENABLED","DOCKER_HOST","VERCEL"])
    assert.throws(()=>guard({[name]:"constructed"}));
  assert.throws(()=>guard({NODE_ENV:"production"}));assert.throws(()=>guard({DATABASE_URL:LOCAL_URL}));
  assert.equal(new URL(LOCAL_URL).hostname,"127.0.0.1");assert.equal(new URL(LOCAL_URL).port,"54322");
  console.log("Invitation safety checks passed; no DB/auth/provider imported or contacted.");
}
async function runtime() {
  guard(process.env);localContainer();
  Object.assign(process.env,{DATABASE_URL:LOCAL_URL,NODE_ENV:"test",EDISON_MEMBER_INVITATIONS_ENABLED:"true",EDISON_ON_DEMAND_ENABLED:"true",EDISON_DEMAND_ALLOWANCE_RESET_PASSWORD:"bulb"});
  globalThis.fetch=async()=>{throw new Error("No HTTP requests are allowed in invitation integration fixtures");};
  const db=await import("../packages/db/src/index"),database=db.getDb();
  const [server]=await database.execute<{pid:number;version:string}>(sql`select pg_backend_pid() as pid,current_setting('server_version_num') as version`);
  assert.equal(Math.floor(Number(server.version)/10000),17);
  const service=await import("../apps/api/src/services/demand-invitations");
  return {...db,...service,database,pid:server.pid};
}
type Runtime=Awaited<ReturnType<typeof runtime>>;
async function worker(value:unknown) {
  if(!process.send)throw new Error("Child requires parent IPC");
  const input=workerInput.parse(value),r=await runtime();let sends=0;
  const [actor]=await r.database.execute<{email:string}>(sql`select email from auth.users where id=${input.actor}::uuid`);
  assert.ok(actor?.email.startsWith(`${input.run}-`),"Worker actor belongs to this exact synthetic run");
  if(input.kind==="create")assert.ok(input.email?.startsWith(`${input.run}-`)&&input.email.endsWith("@example.test"));
  else {
    const [target]=await r.database.execute<{email:string}>(sql`select recipient_email as email from private.demand_invitations where id=${input.invitationId!}::uuid`);
    assert.ok(target?.email.startsWith(`${input.run}-`)&&target.email.endsWith("@example.test"),"Worker target belongs to this synthetic run");
  }
  const dependencies={sender:async()=>{sends++;return {outcome:"sent" as const};}};
  process.send({ready:true,pid:r.pid});await new Promise<void>(resolve=>process.once("message",msg=>{assert.equal(msg,"go");resolve();}));
  let result:Outcome;
  try {
    if(input.kind==="create") {const value=await r.createDemandInvitation(input.actor,{email:input.email!,idempotencyKey:input.key},dependencies);result={ok:true,id:value.invitation.id,status:value.invitation.status,pid:r.pid,sends};}
    else if(input.kind==="revoke") {const value=await r.revokeDemandInvitation(input.actor,input.invitationId!,{idempotencyKey:input.key},dependencies);result={ok:true,id:value.invitation.id,status:value.invitation.status,pid:r.pid,sends};}
    else {const value=await r.redeemDemandInvitation(input.actor,input.invitationId!,{idempotencyKey:input.key},dependencies);result={ok:true,id:value.invitationId,status:"redeemed",pid:r.pid,sends};}
  } catch(e) {result={ok:false,code:typeof(e as {code?:unknown}).code==="string"?(e as {code:string}).code:"unexpected_error",pid:r.pid,sends};}
  await new Promise<void>((resolve,reject)=>process.send!(result,e=>e?reject(e):resolve()));process.exit(0);
}
async function race(r:Runtime,inputs:Input[]) {
  const children=inputs.map(input=>{
    const child=fork(fileURLToPath(import.meta.url),["--worker",JSON.stringify(input)],{execArgv:["--import","tsx"],cwd:fileURLToPath(new URL("..",import.meta.url)),env:{PATH:process.env.PATH,NODE_ENV:"test"},silent:true});
    let readyResolve!:(pid:number)=>void,resultResolve!:(value:Outcome)=>void,reject!:(error:Error)=>void;
    const ready=new Promise<number>(resolve=>{readyResolve=resolve;}),result=new Promise<Outcome>((resolve,fail)=>{resultResolve=resolve;reject=fail;});
    let done=false,output="";const timeout=setTimeout(()=>{child.kill();reject(new Error("Invitation race timeout"));},30000);
    for(const stream of [child.stdout,child.stderr])stream?.on("data",chunk=>{output=(output+String(chunk)).slice(-10000);});
    child.on("message",(value:unknown)=>{if(value&&typeof value==="object"&&"ready" in value&&"pid" in value)readyResolve(Number(value.pid));else{done=true;clearTimeout(timeout);resultResolve(value as Outcome);}});
    child.on("error",reject);child.on("exit",code=>{clearTimeout(timeout);if(!done)reject(new Error(`Child exited ${code}: ${output}`));});
    return {child,ready,result};
  });
  try {
    const pids=await Promise.race([Promise.all(children.map(c=>c.ready)),Promise.all(children.map(c=>c.result)).then(()=>{throw new Error("Child failed before barrier");})]);
    assert.equal(new Set(pids).size,inputs.length);
    await r.database.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-invitation-admission',0))`);
      children.forEach(c=>c.child.send("go"));let blocked=false;
      for(let attempt=0;attempt<100;attempt++) {
        const [row]=await tx.execute<{waiting:number}>(sql`select count(*)::integer as waiting from pg_stat_activity
          where pid in(${sql.join(pids.map(pid=>sql`${pid}`),sql`,`)}) and wait_event_type='Lock'`);
        if(row.waiting===inputs.length){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,30));
      }
      assert.ok(blocked,"Separate PostgreSQL backends all contended on the invitation lock");
    });
    return await Promise.all(children.map(c=>c.result));
  } finally {children.forEach(c=>{if(c.child.exitCode===null)c.child.kill();});}
}
async function integration() {
  const r=await runtime(),run=randomUUID(),users:string[]=[],principals:string[]=[];let sends=0,clock=new Date();
  const key=(label:string)=>`invite:${run}:${label}`,email=(label:string)=>`${run}-${label}@example.test`;
  const dependencies={now:()=>clock,sender:async()=>{sends++;return {outcome:"sent" as const};}};
  const code=(expected:string)=>(e:unknown)=>(e as {code?:string}).code===expected;
  async function user(label:string,status:"active"|"pending"|"revoked"="pending",confirmed=true) {
    const id=randomUUID();users.push(id);
    await r.database.execute(sql`insert into auth.users(id,email,email_confirmed_at) values(${id}::uuid,${email(label)},${confirmed?new Date():null}::timestamptz)`);
    const [membership]=await r.database.execute<{status:string}>(sql`select status from public.alpha_memberships where user_id=${id}::uuid`);assert.equal(membership.status,"pending");
    if(status!=="pending")await r.database.execute(sql`update public.alpha_memberships set status=${status} where user_id=${id}::uuid`);
    return {id,email:email(label)};
  }
  async function create(actor:string,label:string) {return r.createDemandInvitation(actor,{email:email(label),idempotencyKey:key(label)},dependencies);}
  async function membership(id:string) {const [value]=await r.database.execute<{status:string}>(sql`select status from public.alpha_memberships where user_id=${id}::uuid`);return value.status;}
  async function invitation(id:string) {const [value]=await r.database.execute<{status:string;redeemed_by:string|null;recipient_email:string}>(sql`select status,redeemed_by,recipient_email from private.demand_invitations where id=${id}::uuid`);return value;}
  try {
    const inviter=await user("sender","active"),other=await user("other","active"),recipient=await user("recipient"),existing=await user("existing","active"),unverified=await user("unverified","pending",false),revoked=await user("revoked","revoked");
    assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).remaining,5);
    await assert.rejects(create(recipient.id,"not-admitted"),code("invitation_membership_required"));
    const first=await create(inviter.id,"recipient");assert.equal(first.delivery,"sent");assert.equal(first.invitation.status,"sent");
    assert.equal(await membership(recipient.id),"pending","Sending or viewing does not admit");
    const peek=await r.previewDemandInvitation(first.invitation.id);assert.equal(peek.state,"available");assert.notEqual(peek.maskedEmail,recipient.email);
    await r.database.execute(sql`update public.profiles set email=${email("stale-profile")} where id=${recipient.id}::uuid`);
    assert.equal((await r.previewDemandInvitation(first.invitation.id,{verifiedUserId:recipient.id})).state,"available","authoritative Auth email wins over stale profile");
    assert.deepEqual(await r.previewDemandInvitation(first.invitation.id,{verifiedUserId:other.id}),{state:"wrong_account"});
    const sentBefore=sends;
    const replay=await create(inviter.id,"recipient");assert.equal(replay.replayed,true);assert.equal(replay.delivery,"sent");assert.equal(replay.invitation.id,first.invitation.id);assert.equal(sends,sentBefore);
    const duplicate=await r.createDemandInvitation(inviter.id,{email:`  ${recipient.email.toUpperCase()}  `,idempotencyKey:key("same-email")},dependencies);
    assert.equal(duplicate.invitation.id,first.invitation.id);assert.equal(duplicate.delivery,"not_attempted");assert.equal(sends,sentBefore);
    await assert.rejects(r.createDemandInvitation(inviter.id,{email:other.email,idempotencyKey:key("recipient")},dependencies),code("idempotency_key_reused"));
    await assert.rejects(r.revokeDemandInvitation(other.id,first.invitation.id,{idempotencyKey:key("foreign")},dependencies),code("invitation_unavailable"));
    await assert.rejects(r.redeemDemandInvitation(other.id,first.invitation.id,{idempotencyKey:key("wrong-email")},dependencies),code("invitation_unavailable"));
    await r.redeemDemandInvitation(recipient.id,first.invitation.id,{idempotencyKey:key("accept")},dependencies);
    assert.equal(await membership(recipient.id),"active");assert.equal((await r.listDemandInvitations(recipient.id,dependencies)).remaining,5);
    const acceptedReplay=await r.redeemDemandInvitation(recipient.id,first.invitation.id,{idempotencyKey:key("accept")},dependencies);assert.equal(acceptedReplay.replayed,true);
    assert.deepEqual(await r.previewDemandInvitation(first.invitation.id,{verifiedUserId:recipient.id}),{state:"accepted"});
    assert.deepEqual(await r.previewDemandInvitation(first.invitation.id,{verifiedUserId:other.id}),{state:"unavailable"});
    assert.deepEqual(await r.previewDemandInvitation(first.invitation.id),{state:"unavailable"});
    const acceptedRevoke=await r.revokeDemandInvitation(inviter.id,first.invitation.id,{idempotencyKey:key("accepted-revoke")},dependencies);assert.equal(acceptedRevoke.invitation.status,"redeemed");assert.equal(acceptedRevoke.delivery,"not_attempted");
    const second=await create(inviter.id,"existing");await r.redeemDemandInvitation(existing.id,second.invitation.id,{idempotencyKey:key("existing-accept")},dependencies);
    assert.deepEqual(await r.previewDemandInvitation(second.invitation.id,{verifiedUserId:existing.id}),{state:"accepted"});
    assert.equal((await r.listDemandInvitations(existing.id,dependencies)).remaining,5);assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).redeemed,2);
    const unknown=await r.createDemandInvitation(inviter.id,{email:email("unknown"),idempotencyKey:key("unknown")},{...dependencies,sender:async()=>({outcome:"unknown",code:"delivery_unknown"})});
    assert.equal(unknown.delivery,"unknown");assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).reserved,1);
    const unknownReplay=await r.createDemandInvitation(inviter.id,{email:email("unknown"),idempotencyKey:key("unknown")},dependencies);assert.equal(unknownReplay.delivery,"unknown");assert.equal(sends,sentBefore+1);
    const failed=await r.createDemandInvitation(inviter.id,{email:email("failed"),idempotencyKey:key("failed")},{...dependencies,sender:async()=>({outcome:"failed",code:"delivery_rejected"})});
    assert.equal(failed.delivery,"failed");assert.equal(failed.invitation.status,"failed");assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).remaining,2);
    const retryable=await create(inviter.id,"still-valid");clock=new Date(clock.getTime()+61_000);
    const failedResend=await r.resendDemandInvitation(inviter.id,retryable.invitation.id,{idempotencyKey:key("resend-failed")},{...dependencies,sender:async()=>({outcome:"failed",code:"delivery_rejected"})});
    assert.equal(failedResend.invitation.status,"sent");assert.equal(failedResend.delivery,"failed");
    const failedResendReplay=await r.resendDemandInvitation(inviter.id,retryable.invitation.id,{idempotencyKey:key("resend-failed")},dependencies);assert.equal(failedResendReplay.delivery,"failed");assert.equal(failedResendReplay.replayed,true);
    const last=await create(inviter.id,"last-slot");assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).remaining,0);
    await assert.rejects(create(inviter.id,"sixth"),code("invitation_allowance_exhausted"));
    await r.revokeDemandInvitation(inviter.id,last.invitation.id,{idempotencyKey:key("revoke-last")},dependencies);assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).remaining,1);
    clock=new Date(clock.getTime()+8*86_400_000);
    assert.equal((await r.listDemandInvitations(inviter.id,dependencies)).remaining,3,"Expired unaccepted slots release but redeemed remain consumed");
    await assert.rejects(r.resendDemandInvitation(inviter.id,retryable.invitation.id,{idempotencyKey:key("expired-resend")},dependencies),code("invitation_unavailable"));
    const renewed=await r.createDemandInvitation(inviter.id,{email:retryable.invitation.email,idempotencyKey:key("explicit-new")},dependencies);assert.notEqual(renewed.invitation.id,retryable.invitation.id);
    clock=new Date();
    const lostSender=await user("lost-result-sender","active");let transactions=0;
    const lostInput={email:email("lost-result-recipient"),idempotencyKey:key("lost-result")},beforeLost=sends;
    await assert.rejects(r.createDemandInvitation(lostSender.id,lostInput,{...dependencies,transaction:async callback=>{
      if(++transactions===2)throw new Error("Constructed loss after sender returned, before result transaction");
      return r.withDemandWorkerDb(callback);
    }}),/Constructed loss/);
    assert.equal(sends,beforeLost+1);
    const lostReplay=await r.createDemandInvitation(lostSender.id,lostInput,dependencies);
    assert.equal(lostReplay.delivery,"unknown");assert.equal(lostReplay.replayed,true);assert.equal(sends,beforeLost+1);
    assert.equal((await r.listDemandInvitations(lostSender.id,dependencies)).reserved,1);
    for(const target of [unverified,revoked]) {const invitation=await r.createDemandInvitation(other.id,{email:target.email,idempotencyKey:key(target.id)},dependencies);
      await assert.rejects(r.redeemDemandInvitation(target.id,invitation.invitation.id,{idempotencyKey:key(`deny-${target.id}`)},dependencies),code("invitation_unavailable"));}
    await r.database.execute(sql`update public.alpha_memberships set status='revoked' where user_id=${recipient.id}::uuid`);
    assert.deepEqual(await r.previewDemandInvitation(first.invitation.id,{verifiedUserId:recipient.id}),{state:"unavailable"});
    await assert.rejects(r.redeemDemandInvitation(recipient.id,first.invitation.id,{idempotencyKey:key("accept")},dependencies),code("invitation_unavailable"));

    // Actual separate-connection contention, not Promise.all on a max=1 pool.
    const racer=await user("racer","active");for(let i=0;i<4;i++)await create(racer.id,`reserved-${i}`);
    const lastSlot=await race(r,[0,1].map(i=>({run,actor:racer.id,kind:"create",email:email(`race-${i}`),key:key(`race-${i}`)})));
    assert.equal(lastSlot.filter(v=>v.ok).length,1);assert.equal(lastSlot.find(v=>!v.ok)?.code,"invitation_allowance_exhausted");assert.equal(lastSlot.reduce((n,v)=>n+v.sends,0),1);
    const sameSender=await user("same-sender","active"),sameEmail=email("same-recipient");
    const same=await race(r,[0,1].map(i=>({run,actor:sameSender.id,kind:"create",email:sameEmail,key:key(`same-race-${i}`)})));
    assert.ok(same.every(v=>v.ok));assert.equal(new Set(same.map(v=>v.id)).size,1);assert.equal(same.reduce((n,v)=>n+v.sends,0),1);
    assert.equal((await r.listDemandInvitations(sameSender.id,dependencies)).reserved,1);
    const raceRecipient=await user("race-recipient"),raceInvite=await create(sameSender.id,"race-recipient");
    const accepted=await race(r,[0,1].map(i=>({run,actor:raceRecipient.id,kind:"redeem",invitationId:raceInvite.invitation.id,key:key(`accept-race-${i}`)})));
    assert.ok(accepted.every(v=>v.ok));assert.equal((await r.listDemandInvitations(raceRecipient.id,dependencies)).limit,5);
    const [grants]=await r.database.execute<{count:number}>(sql`select count(*)::integer as count from private.demand_invite_grants where user_id=${raceRecipient.id}::uuid`);assert.equal(grants.count,1);
    const contestedUser=await user("contested"),contested=await create(sameSender.id,"contested");
    const revokeAccept=await race(r,[{run,actor:sameSender.id,kind:"revoke",invitationId:contested.invitation.id,key:key("race-revoke")},
      {run,actor:contestedUser.id,kind:"redeem",invitationId:contested.invitation.id,key:key("race-accept")}]);
    const terminal=await invitation(contested.invitation.id);assert.ok(["revoked","redeemed"].includes(terminal.status));
    assert.equal(await membership(contestedUser.id),terminal.status==="redeemed"?"active":"pending");
    assert.equal(revokeAccept[0].ok,true);assert.equal(revokeAccept[1].ok,terminal.status==="redeemed");

    // Article reset is orthogonal to memberships and five lifetime invitations.
    const [principal]=await r.database.insert(r.demandPrincipals).values({accountUserId:inviter.id}).returning();principals.push(principal.id);
    const {demandAllowance,resetDemandAllowance}=await import("../apps/api/src/services/demand-allowance");
    const before=await r.listDemandInvitations(inviter.id,dependencies),allowance=await demandAllowance(principal);
    await r.database.insert(r.usageLedger).values({userId:inviter.id,operation:"constructed_invitation_sentinel",model:"gpt-5.6-luna",providerResponseId:`local-invite-${run}`,pricingStatus:"priced",costMicrousd:987,inputTokens:100,outputTokens:10});
    const ledgerBefore=await r.database.select().from(r.usageLedger).where(eq(r.usageLedger.userId,inviter.id));assert.ok(ledgerBefore.length);
    await resetDemandAllowance(principal,{idempotencyKey:key("bulb"),password:"bulb",expectedRevision:allowance.revision,expectedPeriodStart:allowance.periodStart});
    assert.deepEqual(await r.listDemandInvitations(inviter.id,dependencies),before);assert.equal(await membership(inviter.id),"active");
    assert.deepEqual(await r.database.select().from(r.usageLedger).where(eq(r.usageLedger.userId,inviter.id)),ledgerBefore);
    console.log("Invitation real-service DB checks passed: five lifetime slots; explicit verified email-bound acceptance; pending/failed/unknown/replay/expiry; delivery receipts; separate-backend create/accept/revoke races; bulb and nonzero spend preservation. All recipients synthetic; zero HTTP/email/provider calls.");
  } finally {
    // Exact owned synthetic IDs only. Privileged teardown is confined to this
    // guarded disposable database; immutable triggers are restored atomically.
    await r.database.transaction(async tx=>{
      const tables=["demand_invitation_delivery_results","demand_invitation_operations","demand_invitations","demand_invite_grants",
        "demand_allowance_reset_attempts","demand_allowance_resets","demand_allowance_grants"];
      for(const table of tables)await tx.execute(sql.raw(`alter table private.${table} disable trigger ${table}_immutable`));
      if(users.length){const ids=sql.join(users.map(id=>sql`${id}::uuid`),sql`,`);
        await tx.execute(sql`delete from private.demand_invitation_delivery_results where operation_id in(select id from private.demand_invitation_operations where actor_user_id in(${ids}))`);
        await tx.execute(sql`delete from private.demand_invitation_operations where actor_user_id in(${ids})`);
        await tx.execute(sql`delete from private.demand_invitations where inviter_user_id in(${ids})`);
        await tx.execute(sql`delete from private.demand_invite_grants where user_id in(${ids})`);
      }
      for(const id of principals){await tx.execute(sql`delete from private.demand_allowance_reset_attempts where principal_id=${id}::uuid`);
        await tx.execute(sql`delete from private.demand_allowance_resets where principal_id=${id}::uuid`);await tx.execute(sql`delete from private.demand_allowance_grants where principal_id=${id}::uuid`);
        await tx.delete(r.demandPrincipals).where(eq(r.demandPrincipals.id,id));}
      for(const id of users)await tx.execute(sql`delete from auth.users where id=${id}::uuid`);
      for(const table of tables)await tx.execute(sql.raw(`alter table private.${table} enable trigger ${table}_immutable`));
    });
  }
}
if(process.argv.includes("--safety-only"))safety();
else if(process.argv[2]==="--worker")await worker(JSON.parse(process.argv[3]));
else {try{await integration();process.exit(0);}catch(e){console.error(e);process.exit(1);}}
