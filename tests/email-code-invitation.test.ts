import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import * as contracts from "@edison/contracts";
import * as acceptance from "../lib/invitation-acceptance";
import * as continuation from "../lib/demand-auth-continuation";
import * as entry from "../components/auth/invitation-entry-state";
import { AcceptanceForm } from "../components/auth/acceptance-form";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const next = `/s/demand/${"b".repeat(64)}`;
const origin = "https://edisonreader.com";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sessionContext = (): acceptance.InvitationAcceptance => ({ nonce: id(2), type: "session", invitationId: id(1), returnPath: next, createdAt: Date.now() });
function compile(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  new Script(ts.transpileModule(source(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)
    .runInNewContext({ exports, URL, URLSearchParams, Headers, Request, Response, Buffer, crypto, Date, process: { env: { NODE_ENV: "production" } }, require(name: string) {
      if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
      return imports[name];
    } });
  return exports;
}
function route(options: { signedIn?: boolean; stored?: acceptance.InvitationAcceptance; authError?: boolean; accessStatus?: number; member?: unknown; redeemStatus?: number } = {}) {
  const calls: Array<{ path: string; token?: string; method?: string; body?: string }> = [];
  const result = compile("app/auth/confirm/route.ts", {
    "next/server": { NextResponse }, "next/headers": { cookies: async () => ({ get: () => options.stored ? { value: Buffer.from(JSON.stringify(options.stored)).toString("base64url") } : undefined }) },
    "@edison/contracts": contracts, "@/lib/demand-auth-continuation": continuation, "@/lib/invitation-acceptance": acceptance,
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getUser: async () => { calls.push({ path: "getUser" }); if (options.authError) throw new Error("Private transport failure"); return { data: { user: options.signedIn ? { id: id(3), email: "reader@example.test", email_confirmed_at: "2026-09-08T12:00:00Z" } : null }, error: null }; },
      getSession: async () => { calls.push({ path: "getSession" }); return { data: { session: options.signedIn ? { access_token: "constructed-verified-session" } : null }, error: null }; },
      verifyOtp: async (input: { token_hash: string }) => { calls.push({ path: "verifyOtp", token: input.token_hash }); return { data: { session: { access_token: "constructed-token-session" } }, error: null }; },
    } }) },
    "@/lib/member-access": { memberApiFetch: async (path: string, token: string, init?: { method?: string; body?: string }) => {
      calls.push({ path, token, ...init });
      return Response.json({ member: options.member ?? true }, { status: path.endsWith("redeem") ? options.redeemStatus ?? 200 : options.accessStatus ?? 200 });
    } },
  });
  return { calls, GET: result.GET as (r: Request) => Promise<Response>, POST: result.POST as (r: Request) => Promise<Response> };
}
const get = (query = new URLSearchParams({ next, invitation: id(1) }).toString()) => new Request(`${origin}/auth/confirm?${query}`);
const post = () => new Request(`${origin}/auth/confirm`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ nonce: id(2), next }) });

test("plain code-email context in a fresh browser preserves invitation and destination without consuming or sending", async () => {
  const app = route();
  for (let scanner = 0; scanner < 2; scanner++) {
    const response = await app.GET(get());
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.pathname, "/login");
    assert.equal(target.searchParams.get("next"), next);
    assert.equal(target.searchParams.get("invitation"), id(1));
    assert.equal(target.searchParams.get("code"), "1", "the reader already has a code; entry must not require a new send");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
  assert.deepEqual(app.calls, [{ path: "getUser" }, { path: "getUser" }]);
});

test("verified code session stages a genuine tokenless context and still requires explicit acceptance", async () => {
  const app = route({ signedIn: true });
  const response = await app.GET(get());
  assert.equal(response.headers.get("location"), `${origin}/auth/accept`);
  const cookie = response.headers.get("set-cookie")!;
  const stored = acceptance.decodeInvitationAcceptance(cookie.match(/^[^=]+=([^;]+)/)![1]);
  assert.equal(stored?.type, "session");
  assert.equal(stored?.invitationId, id(1));
  assert.equal(stored?.returnPath, next);
  assert.equal("tokenHash" in stored!, false);
  assert.match(cookie, /Secure.*HttpOnly.*SameSite=lax/);
  assert.deepEqual(app.calls.map(({ path }) => path), ["getUser", "getSession"]);
});

test("tokenless member return checks real API membership and fails closed on unavailable or forged responses", async () => {
  for (const [accessStatus, member, destination] of [[200, true, next], [403, true, "/login"], [503, true, "/login"], [200, "true", "/login"]] as const) {
    const app = route({ signedIn: true, accessStatus, member });
    const response = await app.GET(get(new URLSearchParams({ next }).toString()));
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.pathname, destination);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(app.calls.map(({ path }) => path), ["getUser", "getSession", "demand/access"]);
    if (destination === "/login") assert.equal(target.searchParams.get("next"), next);
  }
});

test("context and provider failures preserve a validated invitation without exposing provider text", async () => {
  const query = new URLSearchParams({ next, invitation: id(1), error: "access_denied", error_description: "Private provider text" });
  const app = route();
  const failed = new URL((await app.GET(get(query.toString()))).headers.get("location")!);
  assert.equal(failed.searchParams.get("invitation"), id(1));
  assert.equal(failed.searchParams.get("next"), next);
  assert.doesNotMatch(failed.href, /Private|provider|description/);
  assert.equal(app.calls.length, 0);
  const uncertain = route({ authError: true });
  const target = new URL((await uncertain.GET(get())).headers.get("location")!);
  assert.equal(target.searchParams.get("error"), "unavailable");
  assert.equal(target.searchParams.get("code"), "1");
  assert.equal(target.searchParams.get("invitation"), id(1));
});

test("session acceptance POST verifies the current recipient without verifying an invented token", async () => {
  const app = route({ signedIn: true, stored: sessionContext() });
  const response = await app.POST(post());
  assert.equal(response.headers.get("location"), `${origin}${next}`);
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
  assert.deepEqual(app.calls.map(({ path }) => path), ["getUser", "getSession", `demand/invitations/${id(1)}/redeem`, "demand/access"]);
  const redeem = app.calls[2];
  assert.equal(redeem.token, "constructed-verified-session");
  assert.deepEqual(JSON.parse(redeem.body!), { idempotencyKey: `invitation-accept:${id(1)}` });
});

test("signed-out, wrong, unavailable and uncertain session acceptance never grants or loses context", async () => {
  const signedOut = route({ stored: sessionContext() });
  const target = new URL((await signedOut.POST(post())).headers.get("location")!);
  assert.equal(target.pathname, "/login");
  assert.equal(target.searchParams.get("code"), "1");
  assert.equal(target.searchParams.get("invitation"), id(1));
  assert.equal(target.searchParams.get("next"), next);
  assert.deepEqual(signedOut.calls, [{ path: "getUser" }]);
  for (const [redeemStatus, expected] of [[403, "wrong_account"], [404, "unavailable"], [408, "unconfirmed"], [429, "unconfirmed"], [503, "unconfirmed"]] as const) {
    const app = route({ signedIn: true, stored: sessionContext(), redeemStatus });
    const response = await app.POST(post());
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), expected);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(app.calls.some(({ path }) => path === "verifyOtp" || path === "demand/access"), false);
  }
});

test("acceptance retains recovery context on uncertain access or a malformed successful member response", async () => {
  for (const [accessStatus, member] of [[408, true], [429, true], [503, true], [200, false], [200, "true"]] as const) {
    const app = route({ signedIn: true, stored: sessionContext(), accessStatus, member });
    const response = await app.POST(post());
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), "unconfirmed");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(app.calls.some(({ path }) => path === "verifyOtp"), false);
  }
});

test("old token and PKCE links remain compatible and scanner-safe; session contexts reject dummy tokens", async () => {
  for (const tokenHash of ["a".repeat(64), `pkce_${"a".repeat(64)}`]) {
    const stored = { ...sessionContext(), type: "email" as const, tokenHash };
    const app = route({ stored });
    const response = await app.GET(get(new URLSearchParams({ next, invitation: id(1), token_hash: tokenHash, type: "email" }).toString()));
    assert.equal(response.headers.get("location"), `${origin}/auth/accept`);
    assert.equal(app.calls.length, 0);
    await app.POST(post());
    assert.equal(app.calls.find(({ path }) => path === "verifyOtp")?.token, tokenHash);
  }
  assert.equal(acceptance.invitationAcceptanceSchema.safeParse({ ...sessionContext(), tokenHash: "a".repeat(64) }).success, false);
  assert.equal(acceptance.invitationAcceptanceSchema.safeParse({ ...sessionContext(), invitationId: null }).success, false);
});

async function page(preview: entry.AcceptancePreview, signedInEmail: string | null = "reader@example.test") {
  const context = sessionContext();
  const result = compile("app/auth/accept/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "next/headers": { cookies: async () => ({ get: () => ({ value: Buffer.from(JSON.stringify(context)).toString("base64url") }) }) },
    "@/components/edison/brand": { EdisonLogo: () => null },
    "@/components/auth/acceptance-form": { AcceptanceForm },
    "@/lib/invitation-acceptance": acceptance, "@/lib/demand-auth-continuation": continuation,
    "@/lib/member-access": { readInvitationAcceptance: async () => preview, readSignedInEmail: async () => signedInEmail },
    "@/components/auth/invitation-entry-state": entry, "../../demand.css": {},
  });
  return renderToStaticMarkup(await (result.default as (props: { searchParams: Promise<object> }) => Promise<ReactNode>)({ searchParams: Promise.resolve({}) }));
}

test("tokenless acceptance presentation uses real expiry and read-only accepted/wrong-recipient states", async () => {
  const available = await page({ state: "available", maskedEmail: "r***@example.test", expiresAt: "2026-09-15T12:00:00Z" });
  assert.match(available, /Accept invitation/);
  assert.match(available, /September 15, 2026.*12:00.*UTC/);
  assert.doesNotMatch(available, /token_hash|tokenHash/);
  const accepted = await page({ state: "accepted" });
  assert.match(accepted, /Continue to reading/);
  assert.doesNotMatch(accepted, /method="post"/);
  const wrong = await page({ state: "wrong_account" }, "other@example.test");
  assert.match(wrong, /other@example.test/);
  assert.match(wrong, /Change email/);
  assert.doesNotMatch(wrong, /r\*\*\*|Accept invitation/);
  for (const state of ["expired", "unavailable"] as const) assert.doesNotMatch(await page({ state }), /Accept invitation|action="\/auth\/confirm"/);
  assert.match(await page({ state: "unconfirmed" }), /Check status/);
  await assert.rejects(page({ state: "available" }, null), /redirect:\/login\?.*invitation=.*code=1/);
});
