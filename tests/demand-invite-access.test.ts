import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server";
import * as contracts from "@edison/contracts";
import * as acceptance from "../lib/invitation-acceptance";
import * as continuation from "../lib/demand-auth-continuation";
import { z } from "zod";
import { HttpError, toHttpError } from "../apps/api/src/http/errors";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64);
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  new Script(ts.transpileModule(source(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)
    .runInNewContext({ exports, URL, URLSearchParams, Headers, Request, Response, Buffer, crypto, Date, process: { env: { NODE_ENV: "production" } },
      require(name: string) { if (!(name in imports)) throw new Error(`Missing test dependency: ${name}`); return imports[name]; }, ...globals });
  return exports;
}
function context() { return { nonce: id(2), tokenHash: hash, type: "invite" as const, invitationId: id(1), returnPath: `/articles/${id(3)}`, createdAt: Date.now() }; }
function route(options: { stored?: acceptance.InvitationAcceptance; current?: boolean; verifyError?: { status?: number; code?: string }; authThrows?: boolean; memberStatus?: number; redeemStatus?: number } = {}) {
  const calls: string[] = [];
  const verifiedHashes: string[] = [];
  const compiled = compile("app/auth/confirm/route.ts", {
    "next/server": { NextResponse }, "next/headers": { cookies: async () => ({ get: () => options.stored ? { value: Buffer.from(JSON.stringify(options.stored)).toString("base64url") } : undefined }) },
    "@edison/contracts": contracts, "@/lib/demand-auth-continuation": continuation, "@/lib/invitation-acceptance": acceptance,
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getUser: async () => { if (options.authThrows) throw new Error("synthetic transport failure"); return { data: { user: options.current ? { id: id(4) } : null } }; },
      getSession: async () => ({ data: { session: { access_token: "current-account-token" } } }),
      verifyOtp: async (input: { token_hash: string }) => { calls.push("verify"); verifiedHashes.push(input.token_hash); return { error: options.verifyError ?? null, data: { session: { access_token: "confirmed-recipient-token" } } }; },
    } }) },
    "@/lib/member-access": { memberApiFetch: async (path: string, token: string) => {
      calls.push(`${path}:${token}`); return Response.json({ member: true }, { status: path.endsWith("redeem") ? options.redeemStatus ?? 200 : options.memberStatus ?? 200 });
    } },
  });
  return { calls, verifiedHashes, GET: compiled.GET as (r: Request) => Promise<Response>, POST: compiled.POST as (r: Request) => Promise<Response> };
}

test("scanner GET stages HttpOnly acceptance without verifying identity or consuming an invitation", async () => {
  const app = route();
  const url = new URL("https://edisonreader.com/auth/confirm");
  url.search = new URLSearchParams({ invitation: id(1), token_hash: hash, type: "invite", next: `/articles/${id(3)}` }).toString();
  for (let count = 0; count < 2; count++) {
    const response = await app.GET(new Request(url));
    assert.equal(response.status, 303); assert.equal(response.headers.get("location"), "https://edisonreader.com/auth/accept");
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /__Host-edison_acceptance=.*Path=\/.*Secure.*HttpOnly.*SameSite=lax/i);
    const stored = acceptance.decodeInvitationAcceptance(cookie.match(/^[^=]+=([^;]+)/)![1]);
    assert.equal(stored?.invitationId, id(1)); assert.equal(stored?.returnPath, `/articles/${id(3)}`);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
  assert.equal(app.calls.length, 0);
});

test("PKCE magic-link hashes survive scanner-safe staging and exact explicit verification", async () => {
  const tokenHash = `pkce_${hash}`;
  const app = route({ stored: { ...context(), invitationId: null, type: "email", tokenHash } });
  const staged = await app.GET(new Request(`https://edisonreader.com/auth/confirm?token_hash=${tokenHash}&type=email&next=%2F`));
  assert.equal(staged.headers.get("location"), "https://edisonreader.com/auth/accept");
  assert.equal(app.calls.length, 0);
  await app.POST(post());
  assert.deepEqual(app.verifiedHashes, [tokenHash]);
  assert.deepEqual(app.calls, ["verify", "demand/access:confirmed-recipient-token"]);
});

test("acceptance rejects recovery/email-change/duplicate parameters and hostile destinations", async () => {
  const app = route();
  for (const query of [`token_hash=${hash}&type=recovery`, `token_hash=${hash}&type=email_change`, `token_hash=${hash}&type=invite&type=email`, `token_hash=${hash}&type=invite&invitation=invalid`]) {
    const response = await app.GET(new Request(`https://edisonreader.com/auth/confirm?${query}`));
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login"); assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(app.calls.length, 0);
  for (const path of [`/articles/${id(1)}`, `/s/demand/${hash}`, `/share/${"b".repeat(32)}`, `/?idea=${id(2)}`, "/demand"]) {
    assert.equal(continuation.safeDemandAuthReturnPath(path), path);
    assert.equal(new URL(`https://edisonreader.com${continuation.demandLoginPath(path)}`).searchParams.get("next"), path);
  }
  for (const path of [`/articles/${id(1)}?redirect=https://evil.test`, `/s/demand/${hash}/extra`, "/share/%2F%2Fevil", "/auth/accept", "//evil.test"]) assert.equal(continuation.safeDemandAuthReturnPath(path), "/");
});

function post(nonce = id(2), origin = "https://edisonreader.com") {
  return new Request("https://edisonreader.com/auth/confirm", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ nonce, next: `/articles/${id(3)}` }) });
}
test("only same-origin exact-context POST verifies then redeems and returns to the original article", async () => {
  const app = route({ stored: context() });
  assert.equal((await app.POST(post(id(2), "https://evil.test"))).status, 403);
  await app.POST(post(id(9))); assert.equal(app.calls.length, 0);
  const response = await app.POST(post());
  assert.deepEqual(app.calls, ["verify", `demand/invitations/${id(1)}/redeem:confirmed-recipient-token`, "demand/access:confirmed-recipient-token"]);
  assert.equal(response.headers.get("location"), `https://edisonreader.com/articles/${id(3)}`);
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
});

test("expired verification cannot activate and ambiguous redemption preserves retry context", async () => {
  const expired = route({ stored: context(), verifyError: { status: 403, code: "otp_expired" } });
  const failure = await expired.POST(post()); assert.match(failure.headers.get("location")!, /error=expired/); assert.deepEqual(expired.calls, ["verify"]);
  const unknown = route({ stored: context(), redeemStatus: 503 });
  const pending = await unknown.POST(post()); assert.match(pending.headers.get("location")!, /error=unconfirmed/); assert.equal(pending.headers.get("set-cookie"), null);
  assert.equal(unknown.calls.some((x) => x.startsWith("demand/access")), false);
});

test("verification throttling and transport uncertainty keep the same acceptance context without claiming expiry", async () => {
  for (const status of [undefined, 408, 429, 500, 503]) {
    const app = route({ stored: context(), verifyError: { status, code: status === 429 ? "over_request_rate_limit" : undefined } });
    const result = await app.POST(post());
    assert.match(result.headers.get("location")!, /error=unconfirmed/);
    assert.equal(result.headers.get("set-cookie"), null);
    assert.deepEqual(app.calls, ["verify"]);
  }
});

test("existing wrong account is never silently exchanged for the invitation recipient", async () => {
  const app = route({ stored: context(), current: true, redeemStatus: 403 });
  const response = await app.POST(post());
  assert.equal(app.calls.includes("verify"), false);
  assert.deepEqual(app.calls, [`demand/invitations/${id(1)}/redeem:current-account-token`]);
  assert.match(response.headers.get("location")!, /wrong_account/);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("acceptance cookie lifetime, exact shape and safe-return validation fail closed", () => {
  const input = context(), encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.equal(acceptance.decodeInvitationAcceptance(encode(input), input.createdAt - 1), null);
  assert.equal(acceptance.decodeInvitationAcceptance(encode(input), input.createdAt + 3_600_001), null);
  assert.equal(acceptance.decodeInvitationAcceptance(encode({ ...input, role: "admin" })), null);
  assert.equal(acceptance.decodeInvitationAcceptance(encode({ ...input, returnPath: "https://evil.test" }))?.returnPath, "/");
  assert.equal(acceptance.decodeInvitationAcceptance("x".repeat(4097)), null);
});

test("acceptance caps streamed form bytes and rejects duplicate or unknown fields before identity lookup", async () => {
  const app = route({ stored: context() });
  const request = (body: string) => new Request("https://edisonreader.com/auth/confirm", {
    method: "POST", headers: { origin: "https://edisonreader.com", "content-type": "application/x-www-form-urlencoded" }, body,
  });
  assert.equal((await app.POST(request(`nonce=${id(2)}&next=${"x".repeat(9000)}`))).status, 413);
  for (const suffix of ["&admin=true", "&next=/&next=/demand", `&nonce=${id(2)}`]) {
    const result = await app.POST(request(`nonce=${id(2)}${suffix}`));
    assert.match(result.headers.get("location")!, /error=interrupted/);
  }
  assert.equal(app.calls.length, 0);
});

test("Auth network errors retain recovery and ordinary sign-in cannot redeem pending invitations", async () => {
  const app = route({ stored: context(), authThrows: true });
  const failure = await app.POST(post());
  assert.match(failure.headers.get("location")!, /error=unconfirmed/);
  assert.equal(failure.headers.get("set-cookie"), null);
  const signin = route({ stored: { ...context(), type: "email", invitationId: null }, memberStatus: 403 });
  const denied = await signin.POST(post());
  assert.match(denied.headers.get("location")!, /error=invite_required/);
  assert.deepEqual(signin.calls, ["verify", "demand/access:confirmed-recipient-token"]);
});

function memberModule(options: {
  env?: Record<string, string>; sessionToken?: string; oidcToken?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
} = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const value = compile("lib/member-access.ts", {
    "server-only": {}, react: { cache: (fn: unknown) => fn }, zod: { z },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "@vercel/oidc": { getContext: () => ({ headers: { "x-vercel-oidc-token": options.oidcToken } }) },
    "@/lib/demand-auth-continuation": continuation,
    "@/lib/supabase/env": { isSupabaseConfigured: () => true },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getSession: async () => ({ data: { session: options.sessionToken ? { access_token: options.sessionToken } : null }, error: null }) } }) },
  }, {
    AbortSignal, process: { env: { NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://api.edison.test/v1", ...options.env } },
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init }); return options.fetch ? options.fetch(url, init) : Response.json({ member: true });
    },
  }) as unknown as typeof import("../lib/member-access");
  return { ...value, calls };
}

test("server member transport restricts destination, verb, credential propagation and redirects", async () => {
  const app = memberModule();
  await app.memberApiFetch("demand/access", "synthetic-reader");
  const call = app.calls[0];
  assert.equal(call.url, "https://api.edison.test/v1/demand/access");
  assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer synthetic-reader");
  assert.equal(new Headers(call.init.headers).get("cookie"), null);
  assert.equal(call.init.credentials, "omit"); assert.equal(call.init.redirect, "error"); assert.equal(call.init.cache, "no-store");
  for (const path of ["https://evil.test/v1", "demand/access?x=y", "demand/../access", "demand/invitations/invalid/preview"]) {
    await assert.rejects(app.memberApiFetch(path, "synthetic-reader"));
  }
  await assert.rejects(app.memberApiFetch("demand/access", null));
  await assert.rejects(app.memberApiFetch("demand/access", "synthetic-reader", { method: "POST" }));
  await assert.rejects(app.memberApiFetch(`demand/invitations/${id(1)}/redeem`, "synthetic-reader"));
  for (const target of ["http://api.edison.test/v1", "https://user:pass@api.edison.test/v1", "https://api.edison.test/v1?key=x", "https://api.edison.test/v2", "http://localhost:4311/v1"]) {
    const invalid = memberModule({ env: { NEXT_PUBLIC_API_URL: target } });
    await assert.rejects(invalid.memberApiFetch("demand/access", "synthetic-reader")); assert.equal(invalid.calls.length, 0);
  }
});

test("trusted server transport never falls back to environment OIDC or mismatched hosts", async () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const token = `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.c2ln`;
  const env = { EDISON_DEMAND_TRUSTED_SOURCE_ENABLED: "true", VERCEL: "1", NEXT_PUBLIC_API_URL: "https://edison-api.vercel.app/v1", EDISON_DEMAND_PROTECTED_API_URL: "https://edison-api.vercel.app/v1", VERCEL_OIDC_TOKEN: token };
  const missing = memberModule({ env });
  await assert.rejects(missing.memberApiFetch("demand/access", "synthetic-reader")); assert.equal(missing.calls.length, 0);
  const valid = memberModule({ env, oidcToken: token });
  await valid.memberApiFetch("demand/access", "synthetic-reader");
  assert.equal(new Headers(valid.calls[0].init.headers).get("x-vercel-trusted-oidc-idp-token"), token);
  const wrong = memberModule({ env: { ...env, EDISON_DEMAND_PROTECTED_API_URL: "https://other.vercel.app/v1" }, oidcToken: token });
  await assert.rejects(wrong.memberApiFetch("demand/access", "synthetic-reader")); assert.equal(wrong.calls.length, 0);
});

test("membership and acceptance use validated API outcomes, not browser claims", async () => {
  for (const [status, expected] of [[401, "signed_out"], [403, "invite_required"], [503, "unavailable"], [200, "member"]] as const) {
    const app = memberModule({ sessionToken: "untrusted-cookie-token", fetch: async () => Response.json({ member: true }, { status }) });
    assert.equal((await app.readMemberSession()).status, expected);
  }
  const forged = memberModule({ sessionToken: "untrusted-cookie-token", fetch: async () => Response.json({ member: "true" }) });
  assert.equal((await forged.readMemberSession()).status, "unavailable");
  let count = 0;
  const expired = memberModule({ sessionToken: "expired-cookie-token", fetch: async () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json({ state: "available", maskedEmail: "m***@example.test" }) });
  assert.equal((await expired.readInvitationAcceptance(id(1))).state, "available");
  assert.equal(new Headers(expired.calls[1].init.headers).get("authorization"), null);
  const accepted = memberModule({ sessionToken: "confirmed-recipient", fetch: async () => Response.json({ state: "accepted" }) });
  assert.equal((await accepted.readInvitationAcceptance(id(1))).state, "accepted");
  const leaked = memberModule({ fetch: async () => Response.json({ state: "available", email: "private@example.test" }) });
  assert.equal((await leaked.readInvitationAcceptance(id(1))).state, "unconfirmed");
});

test("single-connection content handler releases verified membership before invoking its own database read", async () => {
  for (const allowed of ["anonymous", "uninvited", "member"]) {
    const calls: string[] = [];
    const connectionEvents: string[] = [];
    let membershipConnectionHeld = false;
    const compiled = compile("apps/api/src/http/api-handler.ts", {
      "./errors": { HttpError, toHttpError }, "../observability/safe-error": { safeCaughtErrorMetadata: () => ({}) },
      "../auth/verify-access-token": { verifyAccessToken: async (_value: unknown, options: { demand?: boolean }) => {
        calls.push("verify"); assert.equal(options.demand, true); if (allowed === "anonymous") throw new HttpError(401, "missing_token", "Sign in"); return { sub: id(1) };
      } }, "../services/members": { withActiveMember: async (_claims: unknown, callback: () => Promise<unknown>) => {
        calls.push("membership"); if (allowed === "uninvited") throw new HttpError(403, "alpha_access_required", "Invite required");
        membershipConnectionHeld = true; connectionEvents.push("membership:begin");
        try { return await callback(); }
        finally { membershipConnectionHeld = false; connectionEvents.push("membership:release"); }
      } },
    });
    const handle = compiled.memberApiHandler as (request: Request, handler: () => Promise<Response>) => Promise<Response>;
    const response = await handle(new Request("https://api.edison.test/v1/public/demand-shares/constructed"), async () => {
      // Fail deterministically instead of queueing indefinitely behind the
      // membership transaction in the production max:1 connection pool.
      assert.equal(membershipConnectionHeld, false, "content cannot acquire the sole connection while membership owns it");
      connectionEvents.push("content:begin"); calls.push("content"); return Response.json({ body: "member-only" });
    });
    assert.equal(response.status, allowed === "member" ? 200 : allowed === "anonymous" ? 401 : 403);
    assert.equal(calls.includes("content"), allowed === "member");
    assert.deepEqual(connectionEvents, allowed === "member" ? ["membership:begin", "membership:release", "content:begin"] : []);
    const callsBeforeOptions = [...calls];
    assert.equal((await handle(new Request("https://api.edison.test/v1/public", { method: "OPTIONS" }), async () => { throw new Error("must not run"); })).status, 204);
    assert.deepEqual(calls, callsBeforeOptions, "OPTIONS does not verify identity, check membership, or invoke content");
  }
});

test("transaction-consuming membership callbacks retain the original transaction and denied members never enter them", async () => {
  for (const active of [true, false]) {
    let connectionHeld = false, entered = false;
    const profile = { id: id(1) };
    const transaction = {
      select: () => transaction, from: () => transaction, innerJoin: () => transaction, where: () => transaction,
      limit: async () => active ? [{ profile, membership: { status: "active" } }] : [],
    };
    const members = compile("apps/api/src/services/members.ts", {
      "drizzle-orm": { and: (...values: unknown[]) => values, eq: (...values: unknown[]) => values },
      "@edison/db": { profiles: { id: "profile-id" }, alphaMemberships: { userId: "member-id", status: "status" },
        withUserDb: async (claims: { sub: string }, callback: (tx: typeof transaction) => Promise<unknown>) => {
          assert.equal(claims.sub, id(1)); connectionHeld = true;
          try { return await callback(transaction); }
          finally { connectionHeld = false; }
        } },
      "../http/errors": { HttpError },
    });
    const withMember = members.withActiveMember as (claims: { sub: string }, callback: (input: { transaction: typeof transaction; profile: typeof profile }) => Promise<number>) => Promise<number>;
    const result = withMember({ sub: id(1) }, async (input) => {
      entered = true; assert.equal(connectionHeld, true); assert.equal(input.transaction, transaction); assert.equal(input.profile, profile);
      return 42;
    });
    if (active) assert.equal(await result, 42);
    else await assert.rejects(result, (error: unknown) => error instanceof HttpError && error.status === 403);
    assert.equal(entered, active); assert.equal(connectionHeld, false);
  }
});

test("all reading pages gate before content and anonymous metadata never fetches shared articles", () => {
  for (const path of ["app/page.tsx", "app/demand/page.tsx", "app/articles/[articleId]/page.tsx", "app/share/[slug]/page.tsx", "app/s/demand/[token]/page.tsx"]) assert.match(source(path), /await requireMemberSession\(/);
  const shared = source("app/s/demand/[token]/page.tsx");
  assert.doesNotMatch(shared, /generateMetadata|demandPublicShareMetadata|cache\(/);
  assert.match(shared, /title: "Shared reading — Edison"/);
  for (const path of ["apps/api/app/v1/public/demand-shares/[token]/route.ts", "apps/api/app/v1/public/articles/[articleId]/route.ts", "apps/api/app/v1/public/editions/news/current/route.ts", "apps/api/app/v1/shares/[slug]/route.ts"]) assert.match(source(path), /return memberApiHandler\(/);
});

test("clean auth pages preserve same-origin form headers without exposing external referrers", () => {
  for (const path of ["app/login/page.tsx", "app/auth/accept/page.tsx"]) assert.match(source(path), /referrer: "same-origin"/);
  // Null-origin submissions remain rejected; the token-bearing redirect itself
  // retains no-referrer. A strict form check must never be weakened for this.
  assert.match(source("app/auth/confirm/route.ts"), /request.headers.get\("origin"\) !== url.origin/);
  assert.match(source("app/auth/confirm/route.ts"), /"Referrer-Policy", "no-referrer"/);
});
