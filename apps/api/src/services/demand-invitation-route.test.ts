import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as contracts from "@edison/contracts";
import { HttpError,toHttpError } from "../http/errors";

// Run the actual catchall and shared HTTP/body boundary, replacing only Auth,
// membership and application services. No provider or database is imported.
const prefix="../../../../src/";
const actor="11111111-1111-4111-8111-111111111111";
const invitationId="22222222-2222-4222-8222-222222222222";
const foreign="33333333-3333-4333-8333-333333333333";
const token="Bearer constructed-verified-token";
type Context={params:Promise<{path:string[]}>};
type Handler=(request:Request,context:Context)=>Promise<Response>;
type Call={name:string;args:unknown[]};
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));

function compiled(file:URL,imports:Record<string,unknown>) {
  const exports:Record<string,unknown>={};
  new Script(ts.transpileModule(readFileSync(file,"utf8"),{fileName:file.pathname,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)
    .runInNewContext({exports,URL,URLSearchParams,Headers,Request,Response,TextDecoder,Buffer,crypto,Date,JSON,
      Error,SyntaxError,TypeError,process:{env:{NODE_ENV:"test",CORS_ALLOWED_ORIGINS:"https://edison.example.test"}},
      console:{error:()=>undefined},require(name:string){if(!(name in imports))throw new Error(`Missing isolated route dependency: ${name}`);return imports[name];}});
  return exports;
}
function route(options:{active?:boolean;invalidToken?:boolean;previewState?:string}={}) {
  const calls:Call[]=[];
  const verifyAccessToken=async(authorization:unknown,input:unknown)=>{
    calls.push({name:"verify",args:[authorization,input]});
    assert.deepEqual(plain(input),{demand:true});
    if(authorization!==token||options.invalidToken)throw new HttpError(401,"invalid_token","Sign in with a verified account.");
    return {sub:actor,email:"member@example.test",role:"authenticated"};
  };
  const withActiveMember=async(claims:{sub:string},callback:()=>Promise<Response>)=>{
    calls.push({name:"membership",args:[claims]});assert.equal(claims.sub,actor);
    if(options.active===false)throw new HttpError(403,"alpha_access_required","An invitation is required.");
    return callback();
  };
  const http=compiled(new URL("../http/api-handler.ts",import.meta.url),{
    "./errors":{HttpError,toHttpError},"../auth/verify-access-token":{verifyAccessToken},"../services/members":{withActiveMember},
    "../observability/safe-error":{safeCaughtErrorMetadata:()=>({})},
  });
  const snapshot={id:invitationId,email:"recipient@example.test",status:"sent",createdAt:"2026-09-07T00:00:00.000Z",
    expiresAt:"2026-09-14T00:00:00.000Z",sentAt:"2026-09-07T00:00:00.000Z",redeemedAt:null};
  const services={
    previewDemandInvitation:async(...args:unknown[])=>{calls.push({name:"preview",args});return {state:options.previewState??"available",maskedEmail:"r***@example.test"};},
    redeemDemandInvitation:async(...args:unknown[])=>{calls.push({name:"redeem",args});return {invitationId,admitted:true,replayed:false};},
    listDemandInvitations:async(...args:unknown[])=>{calls.push({name:"list",args});return {limit:5,redeemed:0,reserved:1,remaining:4,invitations:[snapshot]};},
    ...Object.fromEntries(["create","resend","revoke"].map(name=>[`${name}DemandInvitation`,async(...args:unknown[])=>{
      calls.push({name,args});return {invitation:snapshot,replayed:false,delivery:name==="revoke"?"not_attempted":"sent"};
    }])),
  };
  const forbidden=new Proxy({}, {get:(_target,name)=>()=>{throw new Error(`Unrelated service must not run: ${String(name)}`);}});
  const app=compiled(new URL("../../app/v1/demand/[...path]/route.ts",import.meta.url),{
    "@edison/contracts":contracts,[`${prefix}http/api-handler`]:http,[`${prefix}http/errors`]:{HttpError},
    [`${prefix}auth/verify-access-token`]:{verifyAccessToken},[`${prefix}services/members`]:{withActiveMember},
    [`${prefix}auth/verify-demand-principal`]:forbidden,[`${prefix}services/demand-reading`]:forbidden,
    [`${prefix}services/demand-history`]:forbidden,[`${prefix}services/demand-conversation`]:forbidden,
    [`${prefix}services/demand-loop-management`]:forbidden,[`${prefix}services/demand-sharing`]:forbidden,
    [`${prefix}services/demand-allowance`]:forbidden,[`${prefix}services/demand-loop-list`]:forbidden,
    [`${prefix}services/demand-dispatch`]:{matchDemandRoute:()=>null},[`${prefix}services/demand-invitations`]:services,
  });
  assert.equal(app.dynamic,"force-dynamic");assert.equal(app.runtime,"nodejs");
  assert.deepEqual(Object.keys(app).sort(),["GET","OPTIONS","POST","PUT","dynamic","runtime"].sort());
  async function request(path:string[],input:{method?:string;auth?:string|null;query?:string;body?:unknown;rawBody?:string;origin?:string}={}) {
    const method=input.method??"GET",headers=new Headers();
    if(input.auth!==null)headers.set("Authorization",input.auth??token);
    if(input.origin)headers.set("Origin",input.origin);
    if(input.body!==undefined||input.rawBody!==undefined)headers.set("Content-Type","application/json");
    const req=new Request(`https://api.example.test/v1/demand/${path.join("/")}${input.query??""}`,{method,headers,
      ...(input.rawBody!==undefined?{body:input.rawBody}:input.body!==undefined?{body:JSON.stringify(input.body)}:{})});
    const handler=(method==="OPTIONS"?app.OPTIONS:method==="POST"?app.POST:method==="PUT"?app.PUT:app.GET) as Handler;
    return handler(req,{params:Promise.resolve({path})});
  }
  return {calls,request};
}
const action={idempotencyKey:"constructed-operation"};
const names=(calls:Call[])=>calls.map(call=>call.name);

test("invitation routes reject non-exact paths, methods and every query before identity or service work",async()=>{
  const cases:Array<{path:string[];method?:string;query?:string}>=[
    {path:["invitations","extra"]},{path:["invitations",invitationId]},
    {path:["invitations",invitationId,"preview","extra"]},{path:["invitations","not-a-uuid","preview"]},
    {path:["invitations",invitationId,"PREVIEW"]},{path:["invitations",invitationId,"preview"],method:"POST"},
    {path:["invitations",invitationId,"redeem"]},{path:["invitations",invitationId,"resend"]},{path:["invitations",invitationId,"revoke"]},
    {path:["invitations"],method:"PUT"},{path:["invitations",invitationId,"redeem"],method:"PUT"},
    {path:["invitations"],query:"?cursor=x"},{path:["invitations"],method:"POST",query:"?owner=x"},
    ...["preview","redeem","resend","revoke"].map(verb=>({path:["invitations",invitationId,verb],method:verb==="preview"?"GET":"POST",query:"?x=1&x=2"})),
  ];
  for(const entry of cases){const app=route();const response=await app.request(entry.path,entry);
    assert.equal(response.status,404,JSON.stringify(entry));assert.equal((await response.json()).error.code,"not_found");assert.deepEqual(app.calls,[]);}
});

test("OPTIONS is credential-free while the real HTTP boundary still enforces CORS and no-store",async()=>{
  const app=route({active:false,invalidToken:true});
  const response=await app.request(["invitations"],{method:"OPTIONS",auth:null,origin:"https://edison.example.test"});
  assert.equal(response.status,204);assert.equal(await response.text(),"");assert.deepEqual(app.calls,[]);
  assert.equal(response.headers.get("access-control-allow-origin"),"https://edison.example.test");assert.equal(response.headers.get("cache-control"),"no-store");
  const denied=await app.request(["invitations"],{method:"OPTIONS",auth:null,origin:"https://hostile.example.test"});
  assert.equal(denied.status,403);assert.deepEqual(app.calls,[]);
});

test("public preview carries no actor; authenticated preview verifies demand identity before passing only its subject",async()=>{
  const anonymous=route({active:false});const publicResponse=await anonymous.request(["invitations",invitationId,"preview"],{auth:null});
  assert.equal(publicResponse.status,200);assert.deepEqual(names(anonymous.calls),["preview"]);
  assert.equal(anonymous.calls[0].args[0],invitationId);assert.equal((anonymous.calls[0].args[1] as {verifiedUserId?:string}).verifiedUserId,undefined);
  assert.equal(publicResponse.headers.get("referrer-policy"),"no-referrer");assert.equal(publicResponse.headers.get("x-robots-tag"),"noindex, nofollow");
  const signedIn=route({active:false,previewState:"wrong_account"});
  assert.equal((await signedIn.request(["invitations",invitationId,"preview"])).status,200);
  assert.deepEqual(names(signedIn.calls),["verify","preview"]);assert.deepEqual(plain(signedIn.calls[1].args),[invitationId,{verifiedUserId:actor}]);
  const bad=route({invalidToken:true});assert.equal((await bad.request(["invitations",invitationId,"preview"])).status,401);
  assert.deepEqual(names(bad.calls),["verify"],"an invalid supplied credential cannot fall back to anonymous preview");
});

test("redemption uses verified subject before active membership, allowing only this narrow pending-member action",async()=>{
  const app=route({active:false});const response=await app.request(["invitations",invitationId,"redeem"],{method:"POST",body:action});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{invitationId,admitted:true,replayed:false});
  assert.deepEqual(names(app.calls),["verify","redeem"]);assert.deepEqual(plain(app.calls[1].args),[actor,invitationId,action]);
  const anonymous=route({active:false});assert.equal((await anonymous.request(["invitations",invitationId,"redeem"],{method:"POST",auth:null,body:action})).status,401);
  assert.deepEqual(names(anonymous.calls),["verify"]);
});

test("list/create/resend/revoke require both verified identity and active membership before the service",async()=>{
  for(const operation of ["list","create","resend","revoke"] as const){
    const path=operation==="list"||operation==="create"?["invitations"]:["invitations",invitationId,operation];
    const input={method:operation==="list"?"GET":"POST",...(operation==="list"?{}:{body:operation==="create"?{...action,email:"  RECIPIENT@example.test  "}:action})};
    const inactive=route({active:false});assert.equal((await inactive.request(path,input)).status,403);assert.deepEqual(names(inactive.calls),["verify","membership"]);
    const anonymous=route();assert.equal((await anonymous.request(path,{...input,auth:null})).status,401);assert.deepEqual(names(anonymous.calls),["verify"]);
    const active=route();const response=await active.request(path,input);assert.equal(response.status,200);assert.deepEqual(names(active.calls),["verify","membership",operation]);
    const args=active.calls[2].args;assert.equal(args[0],actor);
    if(operation==="create")assert.deepEqual(plain(args[1]),{...action,email:"recipient@example.test"});
    else if(operation!=="list")assert.deepEqual(plain(args.slice(1)),[invitationId,action]);
    assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(response.headers.get("referrer-policy"),"no-referrer");
  }
});

test("body identities and unknown fields are rejected rather than overriding the verified actor",async()=>{
  for(const operation of ["create","redeem","resend","revoke"] as const)for(const field of ["actorUserId","verifiedUserId","principalId","inviterUserId","role"]){
    const app=route(),path=operation==="create"?["invitations"]:["invitations",invitationId,operation];
    const body={...action,...(operation==="create"?{email:"recipient@example.test"}:{}),[field]:foreign};
    const response=await app.request(path,{method:"POST",body});assert.equal(response.status,400);
    assert.equal((await response.json()).error.code,"invalid_request");assert.deepEqual(names(app.calls),operation==="redeem"?["verify"]:["verify","membership"]);
  }
});

test("invitation mutation bodies retain the real byte ceiling and JSON validation before any mutation",async()=>{
  for(const operation of ["create","redeem","resend","revoke"]){
    const path=operation==="create"?["invitations"]:["invitations",invitationId,operation];
    for(const [rawBody,status] of [["{",400],[JSON.stringify({...action,password:"x".repeat(8192)}),413]] as const){
      const app=route();const response=await app.request(path,{method:"POST",rawBody});assert.equal(response.status,status);
      assert.deepEqual(names(app.calls),operation==="redeem"?["verify"]:["verify","membership"]);
    }
  }
});

test("the access check verifies demand identity and membership, never creates a principal or accepts query overrides",async()=>{
  const active=route();assert.deepEqual(await (await active.request(["access"])).json(),{member:true});assert.deepEqual(names(active.calls),["verify","membership"]);
  const pending=route({active:false});assert.equal((await pending.request(["access"])).status,403);assert.deepEqual(names(pending.calls),["verify","membership"]);
  const query=route();assert.equal((await query.request(["access"],{query:"?userId=forged"})).status,400);assert.deepEqual(query.calls,[]);
});
