import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server";
import * as continuation from "../lib/demand-auth-continuation";
import * as entryState from "../components/auth/invitation-entry-state";
import { createEmailCodeAuthController } from "../lib/email-code-auth";
import { createEmailCodeTransport } from "../lib/supabase/email-code-client";
import { proxyDemandRequest } from "../lib/demand-proxy";
import { readDemandAccountContinuation } from "../lib/demand-client";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}

test("account continuation preserves a private new-loop draft across same-browser tabs without putting it in a URL", () => {
  const store = storage();
  const intent = { kind: "create_loop" as const, curiosity: "A private curiosity, verbatim.\nMore detail." };
  const path = continuation.saveDemandAccountContinuation({ intent, id: id(1), storage: store, now: 1000 });
  assert.equal(path, `/?continue=${id(1)}`);
  assert.doesNotMatch(continuation.demandLoginPath(path), /private|curiosity|detail/);
  assert.deepEqual(continuation.takeDemandAccountContinuation({ returnPath: path, storage: store, now: 1001 }), intent);
  assert.equal(continuation.takeDemandAccountContinuation({ returnPath: path, storage: store, now: 1002 }), null);
});

test("a return consumes only its own intent and never performs refresh/create", () => {
  const store = storage();
  const first = continuation.saveDemandAccountContinuation({ intent: { kind: "refresh", loopId: id(2) }, id: id(1), storage: store, now: 1000 });
  const second = continuation.saveDemandAccountContinuation({ intent: { kind: "create_loop", curiosity: "Another draft" }, id: id(3), storage: store, now: 1000 });
  assert.deepEqual(continuation.takeDemandAccountContinuation({ returnPath: first, storage: store, now: 1001 }), { kind: "refresh", loopId: id(2) });
  assert.equal(store.data.size, 1);
  assert.deepEqual(continuation.takeDemandAccountContinuation({ returnPath: second, storage: store, now: 1001 }), { kind: "create_loop", curiosity: "Another draft" });
});

test("browser history cleanup failure cannot discard an already recovered account draft", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const store = storage();
  const intent = { kind: "create_loop" as const, curiosity: "Keep this actual draft" };
  const path = continuation.saveDemandAccountContinuation({ intent, id: id(1), storage: store });
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      location: { pathname: "/", search: path.slice(1) }, localStorage: store,
      history: { state: {}, replaceState() { throw new Error("history blocked"); } },
    } });
    assert.deepEqual(readDemandAccountContinuation(), intent);
    assert.equal(store.data.size, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("auth return paths reject open redirects, encoded tricks, arbitrary views and malformed identities", () => {
  for (const value of [null, undefined, ["/"], "https://evil.example/", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/?next=https://evil.example", "/?view=profile", `/?continue=${id(1)}&next=bad`, `/?continue=${id(1)}#bad`, `/?continue=${id(1)}%0a`, "/?continue=nope"]) {
    assert.equal(continuation.safeDemandAuthReturnPath(value), "/");
    assert.equal(continuation.demandLoginPath(value, "invalid_link"), "/login?error=invalid_link");
  }
});

test("expired, future, invalid, oversized and unavailable continuation storage never creates trusted state", () => {
  for (const now of [999, 1_801_001]) {
    const store = storage();
    const path = continuation.saveDemandAccountContinuation({ intent: { kind: "refresh", loopId: id(2) }, id: id(1), storage: store, now: 1000 });
    assert.equal(continuation.takeDemandAccountContinuation({ returnPath: path, storage: store, now }), null);
  }
  const store = storage();
  assert.throws(() => continuation.saveDemandAccountContinuation({ intent: { kind: "create_loop", curiosity: "x".repeat(501) }, id: id(1), storage: store }));
  assert.throws(() => continuation.saveDemandAccountContinuation({ intent: { kind: "refresh", loopId: "not-a-loop" }, id: id(1), storage: store }));
  store.setItem(`edison:account-continuation:${id(1)}`, JSON.stringify({ createdAt: 1000, intent: { kind: "refresh", loopId: id(2), verified: true } }));
  assert.equal(continuation.takeDemandAccountContinuation({ returnPath: `/?continue=${id(1)}`, storage: store, now: 1001 }), null);
  assert.equal(continuation.takeDemandAccountContinuation({ returnPath: `/?continue=${id(1)}`, storage: { ...store, getItem() { throw new Error("blocked"); } } }), null);
});

async function authRoute(name: "callback", input: { query: string; error?: boolean; demo?: boolean }) {
  const source = readFileSync(new URL(`../app/auth/${name}/route.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const calls: unknown[] = [];
  new Script(compiled).runInNewContext({ exports, URL, require(name: string) {
    if (name === "next/server") return { NextResponse };
    if (name === "@/lib/app-mode") return { isDemoMode: () => input.demo ?? false };
    if (name === "@/lib/demand-auth-continuation") return continuation;
    if (name === "@/lib/supabase/server") return { createClient: async () => ({ auth: {
      exchangeCodeForSession: async (code: string) => { calls.push(code); return { error: input.error ? {} : null }; },
      verifyOtp: async (value: unknown) => { calls.push(value); return { error: input.error ? {} : null }; },
    } }) };
    throw new Error(name);
  } });
  assert.ok(exports.GET);
  const response = await exports.GET(new Request(`https://edisonreader.com/auth/${name}?${input.query}`));
  return { destination: new URL(response.headers.get("Location")!), calls };
}

test("actual PKCE callback exchanges once and preserves only validated continuation, including link recovery", async () => {
  const next = `/?continue=${id(1)}`;
  const query = new URLSearchParams({ code: "one-time-code", next });
  const accepted = await authRoute("callback", { query: query.toString() });
  assert.equal(accepted.destination.href, `https://edisonreader.com${next}`);
  assert.deepEqual(accepted.calls, ["one-time-code"]);
  const failed = await authRoute("callback", { query: query.toString(), error: true });
  assert.equal(failed.destination.pathname, "/login");
  assert.equal(failed.destination.searchParams.get("next"), next);
  assert.equal(failed.destination.searchParams.has("code"), false);
  const missing = await authRoute("callback", { query: new URLSearchParams({ next }).toString() });
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.destination.searchParams.get("next"), next);
  const unsafe = await authRoute("callback", { query: "code=x&next=https://evil.example" });
  assert.equal(unsafe.destination.href, "https://edisonreader.com/");
  const demo = await authRoute("callback", { query: query.toString(), demo: true });
  assert.equal(demo.calls.length, 0);
});

test("login's actual controller prevents synchronous duplicate emails and cannot enable open signup", async () => {
  // The real form/controller binding is covered in email-code-form.test.ts.
  // Keep this original safety guarantee at its actual SDK transport boundary.
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const calls: { url: URL; body: Record<string, unknown> }[] = [];
  const transport = createEmailCodeTransport({
    config: { url: "https://continuation.example.test", publishableKey: "sb_publishable_offline_fixture" },
    cookieDocument: { cookie: "" },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://continuation.example.test");
      assert.equal(url.pathname, "/auth/v1/otp");
      assert.equal(init?.method, "POST");
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return pending;
    },
  });
  const next = `/?continue=${id(1)}`;
  const controller = createEmailCodeAuthController({ transport,
    contextUrl: entryState.signInCallbackUrl(next, "https://edisonreader.com") });
  try {
    const first = controller.send(" reader@example.test ");
    assert.equal(await controller.send("reader@example.test"), "busy");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.email, "reader@example.test");
    assert.equal(calls[0].body.create_user, false);
    const destination = new URL(calls[0].url.searchParams.get("redirect_to")!);
    assert.equal(destination.origin, "https://edisonreader.com");
    assert.equal(destination.pathname, "/auth/confirm");
    assert.equal(destination.searchParams.get("next"), next);
    resolve(Response.json({}));
    assert.equal(await first, "code");
    assert.equal(controller.snapshot().phase, "code");
    assert.equal(controller.snapshot().issue, null);
  } finally { resolve(Response.json({})); controller.dispose(); }
});

test("relay retires a guest cookie only after confirmed account session, never on failed continuity", async () => {
  const workspace = { workspaceId: id(1), readerKind: "account", loops: [], ideas: [], requests: [] };
  const token = "a".repeat(64);
  const request = () => new Request("https://edisonreader.com/api/demand/session", { method: "POST", headers: {
    Origin: "https://edisonreader.com", Cookie: `__Host-edison_demand=${token}`, Authorization: "Bearer verified-by-api",
  } });
  const options = { apiUrl: "https://api.example/v1", enabled: true, production: true };
  const accepted = await proxyDemandRequest(request(), "session", { ...options, fetcher: (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("x-edison-demand-token"), token);
    return Response.json({ workspace });
  }) as typeof fetch });
  assert.match(accepted.headers.get("set-cookie")!, /__Host-edison_demand=;.*HttpOnly.*Max-Age=0.*Secure/);
  assert.equal((await accepted.json()).workspace.readerKind, "account");
  const denied = await proxyDemandRequest(request(), "session", { ...options, fetcher: (async () => Response.json({ error: { code: "claim_failed" } }, { status: 409 })) as typeof fetch });
  assert.equal(denied.headers.get("set-cookie"), null);
  const malformed = await proxyDemandRequest(request(), "session", { ...options, fetcher: (async () => Response.json({ workspace, newGuestToken: token })) as typeof fetch });
  assert.equal(malformed.status, 502);
  assert.equal(malformed.headers.get("set-cookie"), null);
});
