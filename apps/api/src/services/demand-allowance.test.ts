import assert from "node:assert/strict";
import test from "node:test";
import { demandAllowanceSchema, resetDemandAllowanceSchema } from "@edison/contracts";
import { demandAllowancePeriod, demandAvailableArticles, demandBatchSize, validDemandResetPassword, assertDemandAllowanceSettlement, assertDemandAllowanceRetry } from "./demand-allowance";
import { HttpError } from "../http/errors";

test("one weekly entitlement admits the usable final1–5 and stops at500 without a second body counter",()=>{
  for(const [used,count] of [[0,6],[494,6],[495,5],[496,4],[497,3],[498,2],[499,1]]) assert.equal(demandBatchSize(used,0),count);
  for(const used of [500,501]) {assert.equal(demandAvailableArticles(used,0),0);assert.throws(()=>demandBatchSize(used,0),(e:unknown)=>e instanceof HttpError&&e.code==="allowance_exhausted");}
  assert.equal(demandBatchSize(494,5),1);assert.equal(demandAvailableArticles(498,2),0);
  for(const bad of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>demandBatchSize(bad,0));
});
test("periods are Monday UTC, independent of DST/local midnight, and advance exactly at boundary",()=>{
  for(const now of ["2026-09-07T00:00:00Z","2026-09-13T23:59:59.999Z"]) {
    const p=demandAllowancePeriod(new Date(now));assert.equal(p.periodStart.toISOString(),"2026-09-07T00:00:00.000Z");assert.equal(p.resetsAt.toISOString(),"2026-09-14T00:00:00.000Z");
  }
  assert.equal(demandAllowancePeriod(new Date("2026-09-14T00:00:00Z")).periodStart.toISOString(),"2026-09-14T00:00:00.000Z");
  assert.equal(demandAllowancePeriod(new Date("2026-11-01T06:01:00Z")).periodStart.toISOString(),"2026-10-26T00:00:00.000Z");
});
test("wire balance preserves historical usage across manual revisions and reports reservations separately",()=>{
  const snapshot={limit:500,used:2,periodUsed:502,reserved:3,remaining:498,available:495,revision:1,
    periodStart:"2026-09-07T00:00:00.000Z",resetsAt:"2026-09-14T00:00:00.000Z",manualResetAt:"2026-09-07T01:00:00.000Z"};
  assert.equal(demandAllowanceSchema.parse(snapshot).periodUsed,502);
  for(const changed of [{remaining:495},{available:498},{periodUsed:0}]) assert.equal(demandAllowanceSchema.safeParse({...snapshot,...changed}).success,false);
  assert.equal(resetDemandAllowanceSchema.safeParse({idempotencyKey:"constructed-reset",password:"bulb",expectedRevision:0}).success,false,"revision0 alone cannot authorize a different week's reset");
});
test("temporary password is server configured, exact, and never a client allowance grant",()=>{
  const env={EDISON_DEMAND_ALLOWANCE_RESET_PASSWORD:"bulb"};
  assert.equal(validDemandResetPassword("bulb",env),true);
  for(const value of ["Bulb","bulb "," bulb","", "bULb"]) assert.equal(validDemandResetPassword(value,env),false);
  assert.throws(()=>validDemandResetPassword("bulb",{}),(e:unknown)=>e instanceof HttpError&&e.code==="allowance_reset_unavailable");
});
test("settlement permits only the actual0–reserved count, never a larger provider batch",async()=>{
  for(let units=1;units<=6;units++) {
    const tx={execute:async()=>[{units}]} as unknown as Parameters<typeof assertDemandAllowanceSettlement>[0];
    for(let accepted=0;accepted<=units;accepted++) await assert.doesNotReject(assertDemandAllowanceSettlement(tx,"constructed",accepted));
    await assert.rejects(assertDemandAllowanceSettlement(tx,"constructed",units+1),/provider_invalid/);
  }
});
test("retry readmits the exact original grant and its claim carryover, not a fresh reset revision",async()=>{
  const seen:unknown[]=[];let call=0;
  const tx={execute:async(query:unknown)=>{seen.push(query);return ++call===1?[{grant_id:"old",target_grant_id:"claimed-old",units:6}]:[{used:call===2?494:495,reserved:0}];}} as unknown as Parameters<typeof assertDemandAllowanceRetry>[0];
  await assert.rejects(assertDemandAllowanceRetry(tx,{id:"constructed",principalId:"guest",kind:"ideas",status:"failed"}),(e:unknown)=>e instanceof HttpError&&e.code==="allowance_exhausted");
  assert.equal(seen.length,3);
  await assert.doesNotReject(assertDemandAllowanceRetry({execute:()=>{throw new Error("must not query");}} as never,{id:"old-body",principalId:"guest",kind:"article",status:"failed"}));
});
