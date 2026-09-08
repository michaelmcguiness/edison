import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { OnDemandProviderRequest, OnDemandProviderResponse } from "../packages/ai/src/on-demand";

const LOCAL_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SENTINEL_ENVIRONMENT={OPENAI_ARTICLE_MODEL:"gpt-5.6-terra",OPENAI_UTILITY_MODEL:"gpt-5.6-luna",OPENAI_WEB_SEARCH_COST_MICROUSD:"10000"};
function sentinelFixture(principalId:string,loopId:string,requestId:string,prefix:string) {
  // One source for the frozen parent and stage context. The real durable store
  // compares these exactly before reserving or replaying any provider stage.
  const context={loopId,revision:0};
  const stage:OnDemandProviderRequest={stage:"answer",promptVersion:"constructed-local-allowance-sentinel",instructions:"Constructed local fixture only.",
    input:{context},schema:z.object({text:z.string()}),model:SENTINEL_ENVIRONMENT.OPENAI_UTILITY_MODEL,
    idempotencyKey:`${prefix}sentinel-stage`,safetyIdentifier:principalId,timeoutMs:10000,maxOutputTokens:1000,
    research:false,researchPolicy:{mode:"none",reason:"No research in local fixtures",maxCalls:0}};
  const response:OnDemandProviderResponse={output:{text:"Constructed local ledger sentinel."},
    usage:{providerResponseId:`local-sentinel-${requestId}`,model:stage.model,inputTokens:100,cachedInputTokens:10,outputTokens:100,
      webSearchCalls:0,webSearchToolCalls:0,webSearchPricingStatus:"priced"}};
  return {snapshot:{version:2,context},stage,response,reservedMicrousd:250000};
}
const workerInput=z.object({run:z.string().uuid(),principalId:z.string().uuid(),loopId:z.string().uuid(),key:z.string().min(8).max(128),
  kind:z.enum(["refresh","reset","settle"]),requestId:z.string().uuid().optional(),accepted:z.number().int().min(0).max(6).optional(),
  revision:z.number().int().nonnegative().optional(),period:z.string().datetime().optional()}).strict();
type Input=z.infer<typeof workerInput>;
type Outcome={ok:boolean;id?:string;revision?:number;code?:string;pid:number};
function guard(env:Readonly<Record<string,string|undefined>>) {
  if(Object.keys(env).some(key=>/^(?:PG|POSTGRES|SUPABASE_|OPENAI_|EDISON_|DOCKER_|DATABASE_URL$|DIRECT_URL$)/.test(key)) ||
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
  for(const name of ["DATABASE_URL","DIRECT_URL","PGHOST","PGPASSWORD","SUPABASE_ACCESS_TOKEN","OPENAI_API_KEY","EDISON_ON_DEMAND_ENABLED","DOCKER_HOST","VERCEL"]) assert.throws(()=>guard({[name]:"constructed"}));
  assert.throws(()=>guard({NODE_ENV:"production"}));assert.throws(()=>guard({DATABASE_URL:LOCAL_URL}));
  assert.equal(new URL(LOCAL_URL).hostname,"127.0.0.1");assert.equal(new URL(LOCAL_URL).port,"54322");
  console.log("Allowance safety checks passed; no DB/auth/provider imported or contacted.");
}
async function fixtureChecks() {
  guard(process.env);
  globalThis.fetch=async()=>{throw new Error("No HTTP requests are allowed in allowance fixture checks");};
  const {prepareDemandStage,bindDemandResearchBudget,demandStagePricing,demandUsageWithinProviderLimits}=await import("../apps/api/src/services/demand-provider-stages");
  const principalId=randomUUID(),loopId=randomUUID(),requestId=randomUUID(),item=sentinelFixture(principalId,loopId,requestId,`allowance:${randomUUID()}:`);
  const prepared=prepareDemandStage(requestId,principalId,item.stage,SENTINEL_ENVIRONMENT);
  assert.equal(item.snapshot.context.loopId,loopId);
  assert.deepEqual((prepared.identity.snapshot.input as {context:unknown}).context,item.snapshot.context);
  const bound=bindDemandResearchBudget(prepared.identity,0);
  assert.equal(bound.snapshot.researchCallsBefore,0);assert.equal(bound.snapshot.requestedResearchMaxCalls,0);
  assert.ok(bound.snapshot.estimatedCeilingMicrousd>0&&bound.snapshot.estimatedCeilingMicrousd<item.reservedMicrousd);
  assert.deepEqual(demandStagePricing(item.response.usage,bound.snapshot.searchPriceMicrousd),{pricingStatus:"priced",costMicrousd:138});
  assert.equal(demandUsageWithinProviderLimits(bound.snapshot,item.response.usage,0),true);
  assert.deepEqual(prepareDemandStage(requestId,principalId,item.stage,SENTINEL_ENVIRONMENT),prepared,"Exact replay reconstructs the stage identity");
  assert.throws(()=>prepareDemandStage(requestId,principalId,{...item.stage,model:"unapproved-fixture-model"},SENTINEL_ENVIRONMENT),
    (e:unknown)=>(e as {code?:string}).code==="provider_model_not_allowed");
  console.log("Allowance sentinel fixture checks passed: matching frozen context, approved model, stage identity, pricing138, bounded output and zero tools; no database/HTTP/provider call.");
}
async function runtime() {
  guard(process.env);localContainer();
  Object.assign(process.env,{DATABASE_URL:LOCAL_URL,NODE_ENV:"test",EDISON_ON_DEMAND_ENABLED:"true",EDISON_DEMAND_ALLOWANCE_RESET_PASSWORD:"bulb",
    EDISON_DEMAND_DAILY_MICROUSD:"10000000",EDISON_DEMAND_MONTHLY_MICROUSD:"40000000"});
  globalThis.fetch=async()=>{throw new Error("No HTTP requests are allowed in allowance integration fixtures");};
  const db=await import("../packages/db/src/index");const database=db.getDb();
  const [server]=await database.execute<{pid:number;version:string}>(sql`select pg_backend_pid() as pid,current_setting('server_version_num') as version`);
  assert.equal(Math.floor(Number(server.version)/10000),17);
  const allowance=await import("../apps/api/src/services/demand-allowance");
  const reading=await import("../apps/api/src/services/demand-reading");
  const auth=await import("../apps/api/src/auth/verify-demand-principal");
  const admission=await import("../apps/api/src/services/demand-admission");
  return {...db,...allowance,...reading,...auth,...admission,database,pid:server.pid};
}
type Runtime=Awaited<ReturnType<typeof runtime>>;
async function settle(r:Runtime,requestId:string,accepted:number) {
  return r.withDemandWorkerDb(async tx=>{
    const [original]=await tx.select().from(r.demandRequests).where(eq(r.demandRequests.id,requestId));assert.ok(original);
    await r.lockDemandAdmission(tx,original.principalId,false);
    const [request]=await tx.select().from(r.demandRequests).where(eq(r.demandRequests.id,requestId)).for("update");
    if(!["queued","running"].includes(request.status)) return request;
    await r.assertDemandAllowanceSettlement(tx,requestId,accepted);
    if(accepted) await tx.insert(r.demandIdeas).values(Array.from({length:accepted},(_,index)=>({principalId:request.principalId,loopId:request.loopId,
      batchRequestId:request.id,batchRevision:0,rank:index+1,title:`Constructed article ${index+1}`,deck:"A bounded constructed description.",brief:{},evidence:{sources:[],passages:[]}})));
    const [finished]=await tx.update(r.demandRequests).set({status:accepted?"succeeded":"failed",stage:accepted?"ready":"failed",
      failureCode:accepted?null:"evidence_unavailable",result:accepted?{}:null}).where(eq(r.demandRequests.id,requestId)).returning();
    return finished;
  });
}
async function worker(value:unknown) {
  if(!process.send) throw new Error("Child requires parent IPC");
  const input=workerInput.parse(value),r=await runtime();
  const [principal]=await r.database.select().from(r.demandPrincipals).where(eq(r.demandPrincipals.id,input.principalId));
  const [loop]=await r.database.select().from(r.demandLoops).where(and(eq(r.demandLoops.id,input.loopId),eq(r.demandLoops.principalId,input.principalId)));
  assert.ok(principal&&loop?.originalCuriosity.startsWith(`allowance:${input.run}:`),"Worker only touches this run's fixture");
  process.send({ready:true,pid:r.pid});await new Promise<void>(resolve=>process.once("message",msg=>{assert.equal(msg,"go");resolve();}));
  let result:Outcome;
  try {
    if(input.kind==="refresh") {const request=await r.requestDemandIdeas(principal,loop.id,{baseRevision:0,idempotencyKey:input.key});result={ok:true,id:request.id,pid:r.pid};}
    else if(input.kind==="reset") {const receipt=await r.resetDemandAllowance(principal,{idempotencyKey:input.key,password:"bulb",expectedRevision:input.revision!,expectedPeriodStart:input.period!});result={ok:true,id:receipt.operationId,revision:receipt.revision,pid:r.pid};}
    else {
      const [target]=await r.database.select().from(r.demandRequests).where(and(eq(r.demandRequests.id,input.requestId!),eq(r.demandRequests.principalId,input.principalId),eq(r.demandRequests.loopId,input.loopId)));
      assert.ok(target?.idempotencyKey.startsWith(`allowance:${input.run}:`),"Settlement target must belong to this exact run, owner and loop");
      const finished=await settle(r,input.requestId!,input.accepted!);result={ok:true,id:finished.id,pid:r.pid};
    }
  } catch(e) {result={ok:false,code:typeof(e as {code?:unknown}).code==="string"?(e as {code:string}).code:"unexpected_error",pid:r.pid};}
  await new Promise<void>((resolve,reject)=>process.send!(result,e=>e?reject(e):resolve()));process.exit(0);
}
async function race(r:Runtime,inputs:Input[]) {
  const children=inputs.map(input=>{
    const child=fork(fileURLToPath(import.meta.url),["--worker",JSON.stringify(input)],{execArgv:["--import","tsx"],cwd:fileURLToPath(new URL("..",import.meta.url)),env:{PATH:process.env.PATH,NODE_ENV:"test"},silent:true});
    let readyResolve!:(pid:number)=>void,resultResolve!:(value:Outcome)=>void,reject!:(error:Error)=>void;
    const ready=new Promise<number>(resolve=>{readyResolve=resolve;}),result=new Promise<Outcome>((resolve,fail)=>{resultResolve=resolve;reject=fail;});
    let done=false,output="";const timeout=setTimeout(()=>{child.kill();reject(new Error("Allowance race timeout"));},30000);
    for(const stream of [child.stdout,child.stderr]) stream?.on("data",chunk=>{output=(output+String(chunk)).slice(-10000);});
    child.on("message",(value:unknown)=>{if(value&&typeof value==="object"&&"ready" in value&&"pid" in value)readyResolve(Number(value.pid));else{done=true;clearTimeout(timeout);resultResolve(value as Outcome);}});
    child.on("error",reject);child.on("exit",code=>{clearTimeout(timeout);if(!done)reject(new Error(`Child exited ${code}: ${output}`));});
    return {child,ready,result};
  });
  try {
    const pids=await Promise.race([Promise.all(children.map(c=>c.ready)),Promise.all(children.map(c=>c.result)).then(()=>{throw new Error("Child failed before barrier");})]);
    assert.equal(new Set(pids).size,inputs.length);
    await r.database.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission',0))`);
      children.forEach(c=>c.child.send("go"));let blocked=false;
      for(let attempt=0;attempt<100;attempt++) {
        const [row]=await tx.execute<{waiting:number}>(sql`select count(*)::integer as waiting from pg_stat_activity
          where pid in (${sql.join(pids.map(pid=>sql`${pid}`),sql`,`)}) and wait_event_type='Lock'`);
        if(row.waiting===inputs.length){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,30));
      }
      assert.ok(blocked,"Every separate backend contended on the shared database lock");
    });
    return await Promise.all(children.map(c=>c.result));
  } finally {children.forEach(c=>{if(c.child.exitCode===null)c.child.kill();});}
}
async function integration() {
  const r=await runtime(),run=randomUUID(),prefix=`allowance:${run}:`,owners:string[]=[],users:string[]=[];
  const {createEmptyLoopPrincipleState}=await import("../packages/domain/src/index");
  const {demandHistory}=await import("../apps/api/src/services/demand-history");
  const {demandLoopPage}=await import("../apps/api/src/services/demand-loop-list");
  const {prepareDemandRetry}=await import("../apps/api/src/services/demand-dispatch");
  const code=(expected:string)=>(e:unknown)=>(e as {code?:string}).code===expected;
  async function owner(account=true) {
    const id=randomUUID(),accountUserId=account?randomUUID():null,token=createHash("sha256").update(id).digest("hex");
    if(accountUserId){users.push(accountUserId);await r.database.execute(sql`insert into auth.users(id,email,email_confirmed_at) values(${accountUserId}::uuid,${`${run}-${accountUserId}@example.test`},now())`);
      await r.database.execute(sql`update public.alpha_memberships set status='active' where user_id=${accountUserId}::uuid`);}
    const [principal]=await r.database.insert(r.demandPrincipals).values({id,accountUserId,guestTokenHash:account?null:r.hashDemandToken(token),expiresAt:account?null:new Date(Date.now()+3600000)}).returning();owners.push(id);
    return {...principal,token};
  }
  async function loop(principalId:string) {
    const id=randomUUID(),curiosity=`${prefix}${id}`;
    const [created]=await r.database.insert(r.demandLoops).values({id,principalId,title:"Constructed allowance loop",originalCuriosity:curiosity,principles:{...createEmptyLoopPrincipleState({loopId:id,originalCuriosity:curiosity})}}).returning();return created;
  }
  async function historic(principalId:string,loopId:string,accepted:number,date=new Date()) {
    for(let offered=0;offered<accepted;) {
      const count=Math.min(6,accepted-offered),id=randomUUID();
      await r.database.insert(r.demandRequests).values({id,principalId,loopId,kind:"ideas",status:"succeeded",stage:"ready",idempotencyKey:`${prefix}${id}`,requestFingerprint:"a".repeat(64),snapshot:{version:2,requestedCount:6},reservedMicrousd:0,createdAt:date});
      await r.database.insert(r.demandIdeas).values(Array.from({length:count},(_,index)=>({principalId,loopId,batchRequestId:id,batchRevision:0,rank:index+1,title:`Historical constructed ${offered+index}`,deck:"A constructed article for entitlement verification.",brief:{},evidence:{sources:[],passages:[]}})));
      offered+=count;
    }
  }
  async function ledger() {
    const [row]=await r.database.execute<{demand:string;legacy:string;stages:string}>(sql`select
      (select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]')::text from private.demand_usage u) as demand,
      (select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]')::text from private.usage_ledger u) as legacy,
      (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text from private.demand_stages s) as stages`);return row;
  }
  try {
    // Nonzero sentinels prove preservation of actual ledger rows and cached
    // stage identity, not merely equality between two empty collections.
    const sentinel=await owner(),sentinelLoop=await loop(sentinel.id),sentinelId=randomUUID();
    const item=sentinelFixture(sentinel.id,sentinelLoop.id,sentinelId,prefix);
    await r.database.insert(r.demandRequests).values({id:sentinelId,principalId:sentinel.id,loopId:sentinelLoop.id,kind:"question",status:"running",stage:"answering",
      idempotencyKey:`${prefix}spend-sentinel`,requestFingerprint:"d".repeat(64),snapshot:item.snapshot,reservedMicrousd:item.reservedMicrousd,leaseExpiresAt:new Date(Date.now()+300000)});
    const {durableDemandProvider}=await import("../apps/api/src/services/demand-provider-stages");let stubCalls=0;
    const provider=durableDemandProvider(sentinelId,sentinel.id,{environment:SENTINEL_ENVIRONMENT,provider:async request=>{
      assert.deepEqual(request.input,{context:item.snapshot.context});assert.equal(request.researchPolicy?.maxCalls,0);
      stubCalls++;return item.response;
    }});
    await assert.rejects(provider({...item.stage,input:{context:{...item.snapshot.context,revision:1}}}),code("provider_snapshot_mismatch"));
    assert.equal(stubCalls,0,"A mismatched fixture context is still denied before any provider work");
    assert.deepEqual(await provider(item.stage),item.response);
    const sentinelStages=await r.database.select().from(r.demandStages).where(eq(r.demandStages.requestId,sentinelId));
    assert.equal(sentinelStages.length,1);const sentinelStage=sentinelStages[0];
    const sentinelUsage=await r.database.select().from(r.demandUsage).where(eq(r.demandUsage.requestId,sentinelId));
    assert.equal(sentinelStage.status,"succeeded");assert.deepEqual(sentinelStage.output,item.response);
    assert.equal(sentinelUsage.length,1);assert.equal(sentinelUsage[0].stageId,sentinelStage.id);
    assert.equal(sentinelUsage[0].responseId,item.response.usage.providerResponseId);assert.equal(sentinelUsage[0].costMicrousd,138);
    assert.equal(sentinelUsage[0].pricingStatus,"priced");assert.equal(sentinelUsage[0].searchCalls,0);
    await r.database.update(r.demandRequests).set({status:"succeeded",stage:"ready",leaseExpiresAt:null,result:{}}).where(eq(r.demandRequests.id,sentinelId));
    const [sentinelBefore]=await r.database.select().from(r.demandRequests).where(eq(r.demandRequests.id,sentinelId));
    await r.database.insert(r.usageLedger).values({userId:sentinel.accountUserId!,operation:"constructed_allowance_sentinel",model:"gpt-5.6-luna",
      providerResponseId:`local-legacy-${sentinelId}`,pricingStatus:"priced",costMicrousd:987,inputTokens:100,outputTokens:10});
    const moneyBefore=await ledger();
    assert.notEqual(moneyBefore.demand,"[]");assert.notEqual(moneyBefore.legacy,"[]");assert.notEqual(moneyBefore.stages,"[]");
    const malformedOwner=await owner(),malformedLoop=await loop(malformedOwner.id);
    for(const requestedCount of ["not-a-number",null,{},0,7,2.5]) {
      const id=randomUUID();
      await r.database.insert(r.demandRequests).values({id,principalId:malformedOwner.id,loopId:malformedLoop.id,kind:"ideas",status:"failed",stage:"failed",
        idempotencyKey:`${prefix}malformed-${id}`,requestFingerprint:"c".repeat(64),snapshot:{version:2,requestedCount},reservedMicrousd:0});
    }
    assert.equal((await r.demandAllowance(malformedOwner)).available,500,"Malformed old count hints cannot break entitlement reads or create settled usage");
    const malformedAllocations=await r.database.execute<{units:number}>(sql`select a.units from private.demand_allowance_allocations a
      join private.demand_requests q on q.id=a.request_id where q.principal_id=${malformedOwner.id}::uuid`);
    assert.equal(malformedAllocations.length,6);assert.ok(malformedAllocations.every(value=>value.units===4));
    for(const used of [494,495,496,497,498,499,500,501]) {
      const p=await owner(),l=await loop(p.id);await historic(p.id,l.id,used);
      const balance=await r.demandAllowance(p);assert.equal(balance.used,used);assert.equal(balance.periodUsed,used);
      if(used>=500) await assert.rejects(r.requestDemandIdeas(p,l.id,{baseRevision:0,idempotencyKey:`${prefix}blocked${used}`}),code("allowance_exhausted"));
      else {
        const request=await r.requestDemandIdeas(p,l.id,{baseRevision:0,idempotencyKey:`${prefix}partial${used}`});assert.equal(request.snapshot.requestedCount,500-used);
        const pending=await r.demandAllowance(p);assert.equal(pending.remaining,500-used);assert.equal(pending.available,0);
        await settle(r,request.id,500-used);await settle(r,request.id,500-used);
        assert.equal((await r.demandAllowance(p)).used,500);
        assert.equal((await r.requestDemandIdeas(p,l.id,{baseRevision:0,idempotencyKey:request.idempotencyKey})).id,request.id,"replay works at zero without another allocation");
        if(used===494) {
          const [offered]=await r.database.select().from(r.demandIdeas).where(eq(r.demandIdeas.batchRequestId,request.id));
          const body=await r.requestDemandArticle(p,offered.id,{idempotencyKey:`${prefix}body-at-zero`});
          assert.equal(body.kind,"article");assert.equal((await r.demandAllowance(p)).used,500);
          assert.equal((await r.requestDemandArticle(p,offered.id,{idempotencyKey:`${prefix}same-body`})).id,body.id,"already offered body is reused without a new article unit");
        }
      }
    }
    for(let accepted=0;accepted<=6;accepted++) {
      const p=await owner(),l=await loop(p.id);const request=await r.requestDemandIdeas(p,l.id,{baseRevision:0,idempotencyKey:`${prefix}accept${accepted}`});
      await settle(r,request.id,accepted);assert.equal((await r.demandAllowance(p)).used,accepted);assert.equal((await r.demandAllowance(p)).reserved,0);
    }
    const p=await owner(),l=await loop(p.id);await historic(p.id,l.id,498);
    const pending=await r.requestDemandIdeas(p,l.id,{baseRevision:0,idempotencyKey:`${prefix}pending-old`});const before=await r.demandAllowance(p);
    const resetInput={idempotencyKey:`${prefix}reset`,password:"bulb",expectedRevision:before.revision,expectedPeriodStart:before.periodStart};
    const reset=await r.resetDemandAllowance(p,resetInput);assert.equal(reset.revision,1);
    assert.equal((await r.demandAllowance(p)).available,500);
    await settle(r,pending.id,2);const after=await r.demandAllowance(p);assert.equal(after.used,0);assert.equal(after.periodUsed,500);assert.equal(after.available,500);
    assert.deepEqual(await r.resetDemandAllowance(p,resetInput),{...reset,replayed:true});
    await assert.rejects(r.resetDemandAllowance(p,{...resetInput,expectedPeriodStart:new Date(Date.parse(before.periodStart)-7*86400000).toISOString()}),code("idempotency_key_reused"));
    await assert.rejects(r.resetDemandAllowance(p,{...resetInput,idempotencyKey:`${prefix}stale-week`,expectedRevision:1,
      expectedPeriodStart:new Date(Date.parse(before.periodStart)-7*86400000).toISOString()}),code("allowance_changed"));
    for(let attempt=0;attempt<5;attempt++) await assert.rejects(r.resetDemandAllowance(p,{...resetInput,password:"wrong",idempotencyKey:`${prefix}wrong${attempt}`}),code("allowance_reset_password_invalid"));
    await assert.rejects(r.resetDemandAllowance(p,{...resetInput,password:"wrong"}),code("allowance_reset_rate_limited"));
    assert.equal((await r.resetDemandAllowance(p,resetInput)).replayed,true,"successful lost-response replay survives unrelated wrong attempts");
    assert.equal((await r.demandAllowance(p)).available,500);

    const raceOwner=await owner(),loop1=await loop(raceOwner.id),loop2=await loop(raceOwner.id);await historic(raceOwner.id,loop1.id,499);await r.demandAllowance(raceOwner);
    const inputs=[loop1,loop2].map((l,index):Input=>({run,principalId:raceOwner.id,loopId:l.id,key:`${prefix}race${index}`,kind:"refresh"}));
    const outcomes=await race(r,inputs);assert.equal(outcomes.filter(o=>o.ok).length,1);assert.equal(outcomes.find(o=>!o.ok)?.code,"allowance_exhausted");
    assert.equal((await r.demandAllowance(raceOwner)).reserved,1);
    await settle(r,outcomes.find(o=>o.ok)!.id!,0);
    const retryReq=await r.requestDemandIdeas(raceOwner,loop1.id,{baseRevision:0,idempotencyKey:`${prefix}retry-held`});
    await r.database.update(r.demandRequests).set({status:"failed",stage:"failed",failureCode:"worker_interrupted"}).where(eq(r.demandRequests.id,retryReq.id));
    const consumes=await r.requestDemandIdeas(raceOwner,loop2.id,{baseRevision:0,idempotencyKey:`${prefix}consume-freed`});await settle(r,consumes.id,1);
    await assert.rejects(prepareDemandRetry(raceOwner.id,retryReq.id),code("allowance_exhausted"));

    const resetOwner=await owner(),resetLoop=await loop(resetOwner.id),resetBalance=await r.demandAllowance(resetOwner);
    const resetRace=await race(r,[0,1].map(():Input=>({run,principalId:resetOwner.id,loopId:resetLoop.id,key:`${prefix}concurrent-reset`,kind:"reset",revision:0,period:resetBalance.periodStart})));
    assert.ok(resetRace.every(o=>o.ok));assert.equal(resetRace[0].id,resetRace[1].id);assert.equal((await r.demandAllowance(resetOwner)).revision,1);
    const old=await r.requestDemandIdeas(resetOwner,resetLoop.id,{baseRevision:0,idempotencyKey:`${prefix}reset-settle`});
    const rs=await race(r,[{run,principalId:resetOwner.id,loopId:resetLoop.id,key:`${prefix}reset-settle-new`,kind:"reset",revision:1,period:resetBalance.periodStart},
      {run,principalId:resetOwner.id,loopId:resetLoop.id,key:`${prefix}settle-old`,kind:"settle",requestId:old.id,accepted:3}]);
    assert.ok(rs.every(o=>o.ok));const rsBalance=await r.demandAllowance(resetOwner);assert.equal(rsBalance.used,0);assert.equal(rsBalance.periodUsed,3);assert.equal(rsBalance.available,500);
    const cas=await race(r,[0,1].map((index):Input=>({run,principalId:resetOwner.id,loopId:resetLoop.id,key:`${prefix}distinct-reset${index}`,kind:"reset",revision:2,period:resetBalance.periodStart})));
    assert.equal(cas.filter(o=>o.ok).length,1);assert.equal(cas.find(o=>!o.ok)?.code,"allowance_changed");assert.equal((await r.demandAllowance(resetOwner)).revision,3);
    const oldRetry=await r.requestDemandIdeas(resetOwner,resetLoop.id,{baseRevision:0,idempotencyKey:`${prefix}old-revision-retry`});
    await r.database.update(r.demandRequests).set({status:"failed",stage:"failed",failureCode:"worker_interrupted"}).where(eq(r.demandRequests.id,oldRetry.id));
    await r.resetDemandAllowance(resetOwner,{password:"bulb",idempotencyKey:`${prefix}reset-before-retry`,expectedRevision:3,expectedPeriodStart:resetBalance.periodStart});
    assert.equal((await prepareDemandRetry(resetOwner.id,oldRetry.id)).outcome,"requeued");
    await settle(r,oldRetry.id,2);const retriedBalance=await r.demandAllowance(resetOwner);
    assert.equal(retriedBalance.used,0);assert.equal(retriedBalance.periodUsed,5);assert.equal(retriedBalance.available,500);

    // Retained pre-D44 guest work is a continuity fixture, never a new guest
    // admission. Only an already-admitted verified account can claim it.
    const guest=await owner(false),guestLoop=await loop(guest.id),firstId=randomUUID();
    const legacyInput={curiosity:guestLoop.originalCuriosity,idempotencyKey:`${prefix}guest-create`};
    const [first]=await r.database.insert(r.demandRequests).values({id:firstId,principalId:guest.id,loopId:guestLoop.id,kind:"ideas",status:"queued",stage:"queued",
      idempotencyKey:legacyInput.idempotencyKey,requestFingerprint:r.demandFingerprint({intent:"create-loop",...legacyInput}),
      snapshot:{version:2,requestedCount:6},reservedMicrousd:600000}).returning();
    await assert.rejects(r.createDemandLoop(guest,{curiosity:`${prefix}guest-second`,idempotencyKey:`${prefix}guest-second`}),code("reading_session_required"));
    await assert.rejects(r.requestDemandIdeas(guest,first.loopId,{baseRevision:0,idempotencyKey:`${prefix}guest-refresh`}),code("reading_session_required"));
    const account=await owner(),accountLoop=await loop(account.id);await historic(account.id,accountLoop.id,4);
    const claim=await r.withDemandWorkerDb(async tx=>{await r.lockDemandAdmission(tx,account.id);return r.claimDemandGuest(tx,account.accountUserId!,r.hashDemandToken(guest.token));});
    assert.equal(claim.id,account.id);assert.ok(r.demandOwnerIds(claim).includes(guest.id));
    assert.equal((await r.demandAllowance(claim)).reserved,6);assert.equal((await r.demandAllowance(claim)).used,4);
    assert.equal((await r.createDemandLoop(claim,legacyInput)).id,first.id,"guest lost-response create replays after existing-account merge");
    await settle(r,first.id,5);assert.equal((await r.demandAllowance(claim)).used,9);
    const allHistory=await demandHistory(claim,{scope:"all"});assert.equal(allHistory.workspaceId,account.id);assert.equal(allHistory.ideas.length,9);
    const page=await demandLoopPage(claim,{});assert.equal(page.loops.length,2);assert.equal(page.ideas.length,9);
    const resource=await r.resolveDemandResourcePrincipal(claim,{requestId:first.id});assert.equal(resource.id,guest.id);assert.equal(resource.workspaceId,account.id);
    assert.equal((await r.demandRequestResult(resource,first.id)).request.id,first.id);
    const foreign=await owner();await assert.rejects(r.resolveDemandResourcePrincipal(foreign,{requestId:first.id}),code("reading_not_found"));
    await assert.rejects(r.withDemandWorkerDb(async tx=>{await r.lockDemandAdmission(tx,foreign.id);return r.claimDemandGuest(tx,foreign.accountUserId!,r.hashDemandToken(guest.token));}),code("guest_already_claimed"));
    await assert.rejects(r.resolveDemandPrincipal(new Request("https://example.test/session",{headers:{"x-edison-demand-token":guest.token}})),code("invitation_required"));
    const [identity]=await r.database.select().from(r.demandRequests).where(eq(r.demandRequests.id,first.id));assert.equal(identity.principalId,guest.id);assert.deepEqual(identity.snapshot,first.snapshot);

    const freshGuest=await owner(false),newUser=randomUUID();users.push(newUser);await r.database.execute(sql`insert into auth.users(id,email,email_confirmed_at) values(${newUser}::uuid,${`${newUser}@example.test`},now())`);
    await r.database.execute(sql`update public.alpha_memberships set status='active' where user_id=${newUser}::uuid`);
    const freshGuestLoop=await loop(freshGuest.id);await historic(freshGuest.id,freshGuestLoop.id,6);
    const inPlace=await r.withDemandWorkerDb(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission',0))`);return r.claimDemandGuest(tx,newUser,r.hashDemandToken(freshGuest.token));});
    assert.equal(inPlace.id,freshGuest.id);assert.equal((await r.demandAllowance(inPlace)).used,6);
    const again=await r.withDemandWorkerDb(async tx=>{await r.lockDemandAdmission(tx,inPlace.id);return r.claimDemandGuest(tx,newUser,r.hashDemandToken(freshGuest.token));});assert.equal(again.id,inPlace.id);

    const weekOwner=await owner(),weekLoop=await loop(weekOwner.id),period=r.demandAllowancePeriod();
    await historic(weekOwner.id,weekLoop.id,6,new Date(period.periodStart.getTime()-1));assert.equal((await r.demandAllowance(weekOwner)).used,0);
    await r.withDemandWorkerDb(async tx=>{await r.lockDemandAdmission(tx,weekOwner.id);const next=await r.demandAllowanceInTransaction(tx,weekOwner.id,period.resetsAt);assert.equal(next.revision,0);assert.equal(next.available,500);});
    await r.database.execute(sql`update public.alpha_memberships set status='revoked' where user_id=${account.accountUserId}::uuid`);
    await assert.rejects(r.resolveDemandResourcePrincipal(claim,{requestId:first.id}),code("reading_session_expired"));
    assert.deepEqual(await provider(item.stage),item.response,"A terminal parent's exact succeeded stage replays without provider work");
    const [sentinelAfter]=await r.database.select().from(r.demandRequests).where(eq(r.demandRequests.id,sentinelId));
    assert.deepEqual(sentinelAfter,sentinelBefore,"Allowance operations and cached replay preserve the request identity, result and reservation");
    assert.deepEqual(await ledger(),moneyBefore,"entitlement/reset/claim never changes provider stages or either spend ledger");
    assert.equal(stubCalls,1);
    console.log("Disposable allowance integration passed: final1–6,500/501,partial0–6,replay,reserve/reset/settlement contention,old-revision retry,week rollover,guest/account merge,isolation,history and unchanged nonzero spend. Synthetic settlement and one local stub stage; no external provider/workflow calls.");
  } finally {
    if(owners.length) await r.database.transaction(async tx=>{
      const ids=sql.join(owners.map(id=>sql`${id}::uuid`),sql`,`);
      const tables=["demand_principal_claims","demand_allowance_grants","demand_allowance_allocations","demand_allowance_carryovers","demand_allowance_resets","demand_allowance_reset_attempts"];
      for(const table of tables) await tx.execute(sql.raw(`alter table private.${table} disable trigger ${table}_immutable`));
      await tx.execute(sql`delete from private.demand_allowance_resets where principal_id in(${ids})`);
      await tx.execute(sql`delete from private.demand_allowance_reset_attempts where principal_id in(${ids})`);
      await tx.execute(sql`delete from private.demand_allowance_carryovers where source_grant_id in(select id from private.demand_allowance_grants where principal_id in(${ids})) or target_grant_id in(select id from private.demand_allowance_grants where principal_id in(${ids}))`);
      await tx.execute(sql`delete from private.demand_allowance_allocations where request_id in(select id from private.demand_requests where principal_id in(${ids}))`);
      await tx.execute(sql`delete from private.demand_allowance_grants where principal_id in(${ids})`);
      await tx.execute(sql`delete from private.demand_principal_claims where principal_id in(${ids}) or account_principal_id in(${ids})`);
      await tx.delete(r.demandPrincipals).where(inArray(r.demandPrincipals.id,owners));
      for(const user of users) await tx.execute(sql`delete from auth.users where id=${user}::uuid`);
      for(const table of tables) await tx.execute(sql.raw(`alter table private.${table} enable trigger ${table}_immutable`));
    });
  }
}
if(process.argv.includes("--safety-only")) safety();
else if(process.argv.includes("--fixture-only")) await fixtureChecks();
else if(process.argv[2]==="--worker") await worker(JSON.parse(process.argv[3]));
else {try{await integration();process.exit(0);}catch(e){console.error(e);process.exit(1);}}
