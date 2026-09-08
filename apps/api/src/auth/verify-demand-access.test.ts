import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccessToken } from "./verify-access-token";
import { HttpError } from "../http/errors";
import { resolveDemandPrincipal } from "./verify-demand-principal";

test("anonymous tokens cannot create or resume an Edison principal under invite-only admission",async()=>{
  const previous=process.env.EDISON_ON_DEMAND_ENABLED;process.env.EDISON_ON_DEMAND_ENABLED="true";
  try {
    for(const create of [false,true])for(const token of [undefined,"a".repeat(64)]) {
      const request=new Request("https://constructed.example.test/v1/demand/session",{headers:token?{"x-edison-demand-token":token}:{}});
      await assert.rejects(resolveDemandPrincipal(request,create),e=>e instanceof HttpError&&e.code==="invitation_required");
    }
  } finally {if(previous===undefined)delete process.env.EDISON_ON_DEMAND_ENABLED;else process.env.EDISON_ON_DEMAND_ENABLED=previous;}
});

test("demand identity verification does not open legacy routes or accept self-asserted/unverified identities",async()=>{
  const settings={NODE_ENV:"test",SUPABASE_URL:"https://constructed-auth.example.test",SUPABASE_PUBLISHABLE_KEY:"constructed-public-key",
    SUPABASE_JWT_AUDIENCE:"authenticated",EDISON_ALLOWED_EMAILS:"admin@example.test"};
  const old=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));Object.assign(process.env,settings);
  const realFetch=globalThis.fetch;
  const {publicKey,privateKey}=await generateKeyPair("RS256");const jwk={...await exportJWK(publicKey),kid:"constructed-key",alg:"RS256",use:"sig"};
  const id="11111111-1111-4111-8111-111111111111",issuer=`${settings.SUPABASE_URL}/auth/v1`;
  let confirmation:unknown="2026-09-07T00:00:00Z",userId=id,userCalls=0;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url===`${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({keys:[jwk]}),{headers:{"content-type":"application/json"}});
    assert.equal(url,`${issuer}/user`,"any unexpected network request fails the local test");userCalls++;
    return new Response(JSON.stringify({id:userId,email:"reader@example.test",is_anonymous:false,email_confirmed_at:confirmation,
      user_metadata:{email_verified:true,email_confirmed_at:"2026-09-07T00:00:00Z"}}),{headers:{"content-type":"application/json"}});
  };
  const token=async(payload:Record<string,unknown>={},aud="authenticated",iss=issuer)=>`Bearer ${await new SignJWT({role:"authenticated",email:"reader@example.test",is_anonymous:false,...payload})
    .setProtectedHeader({alg:"RS256",kid:jwk.kid}).setSubject(id).setIssuer(iss).setAudience(aud).setExpirationTime("10m").sign(privateKey)}`;
  const code=(value:string)=>(error:unknown)=>error instanceof HttpError&&error.code===value;
  try {
    const valid=await token();assert.equal((await verifyAccessToken(valid,{demand:true})).sub,id);assert.equal(userCalls,1);
    await assert.rejects(verifyAccessToken(valid),code("alpha_access_required"));assert.equal(userCalls,1,"legacy route never enters public-demand exception");
    for(const bad of [await token({role:"anon"}),await token({is_anonymous:true}),await token({},"other-audience"),await token({},"https://wrong.example.test/auth/v1")]) await assert.rejects(verifyAccessToken(bad,{demand:true}),code("invalid_token"));
    assert.equal(userCalls,1,"invalid signed claims never reach user verification");
    confirmation=null;await assert.rejects(verifyAccessToken(valid,{demand:true}),code("verified_account_required"));
    confirmation="2026-09-07T00:00:00Z";userId="22222222-2222-4222-8222-222222222222";await assert.rejects(verifyAccessToken(valid,{demand:true}),code("verified_account_required"));
  } finally {globalThis.fetch=realFetch;for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
