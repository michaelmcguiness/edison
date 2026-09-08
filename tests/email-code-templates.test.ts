import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { signInCallbackUrl } from "../components/auth/invitation-entry-state";
import { createInvitationSender } from "../apps/api/src/services/invitation-delivery";

const template = (name: string) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), "utf8");
const templates = ["magic-link", "confirmation"] as const;
const authOrigin = "https://email-code.example.test";
const email = "reader@example.test";
const invitation = "00000000-0000-4000-8000-000000000001";
const next = "/articles/00000000-0000-4000-8000-000000000002";
const callback = signInCallbackUrl(next, "http://localhost:4310", undefined, invitation);
const code = "001204"; // Deliberately starts with zeros; this is not a hosted length/expiry assertion.

type CapturedRequest = { url: URL; body: Record<string, unknown> };
function capture(input: Parameters<typeof fetch>[0], init?: RequestInit): CapturedRequest {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, authOrigin, "every request must stay in the injected offline Auth transport");
  assert.equal(init?.method, "POST");
  return { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
}
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
function codeClient(transport: typeof fetch) {
  return createClient(authOrigin, "sb_publishable_offline_fixture", {
    auth: { flowType: "pkce", persistSession: true, storage: storage(), autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
}
function contextLink(name: typeof templates[number], redirect: string) {
  const html = template(name);
  // This is a placeholder contract, not a substitute implementation of Go's HTML template renderer.
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)];
  assert.deepEqual(links.map((match) => match[1]), ["{{ .RedirectTo }}"]);
  return new URL(links[0][1].replace("{{ .RedirectTo }}", redirect));
}

for (const name of templates) {
  test(`${name} displays one selectable code and only an ordinary context link`, () => {
    const html = template(name);
    assert.equal([...html.matchAll(/{{\s*\.Token\s*}}/g)].length, 1);
    assert.match(html, /<p\b[^>]*user-select:all[^>]*>{{ \.Token }}<\/p>/);
    assert.doesNotMatch(html, /<[^>]+{{\s*\.Token\s*}}/);
    assert.doesNotMatch(html, /TokenHash|ConfirmationURL|token_hash|auth\/v1\/verify|type=email|type=invite/);
    assert.doesNotMatch(html, /\b(?:six|6)[ -]digit|\b(?:60 minutes|one hour|1 hour)|mailto:/i);
    assert.match(html, />Your sign-in code<\/h1>/);
    assert.match(html, />Open Edison<\/a>/);
    assert.deepEqual([...html.matchAll(/{{\s*\.([A-Za-z]+)\s*}}/g)].map((match) => match[1]).sort(), ["RedirectTo", "SiteURL", "Token"]);
    assert.match(html.replace("{{ .Token }}", code), new RegExp(`>${code}</p>`));
    const link = contextLink(name, callback);
    assert.equal(link.href, callback);
    assert.equal(link.pathname, "/auth/confirm");
    assert.equal(link.searchParams.get("next"), next);
    assert.equal(link.searchParams.get("invitation"), invitation);
    assert.deepEqual([...link.searchParams.keys()].sort(), ["invitation", "next"]);
    assert.equal(link.hash, "");
  });
}

test("initial invitation remains byte-identical and keeps its separately approved explicit acceptance link", () => {
  const html = template("invite");
  assert.equal(createHash("sha256").update(html).digest("hex"), "5a9eb056f5337098195c0fc18318c3332317627f85aee2dc59759a5ed3d457e9");
  assert.match(html, /{{ \.RedirectTo }}&amp;token_hash={{ \.TokenHash }}&amp;type=invite/);
});

test("the actual confirmed-recipient invitation fallback uses the code template's exact invitation context", async () => {
  const requests: CapturedRequest[] = [];
  const sender = createInvitationSender({ NODE_ENV: "test", SUPABASE_URL: authOrigin,
    WEB_APP_URL: "http://localhost:4310", SUPABASE_SECRET_KEY: "sb_secret_offline_fixture",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_offline_fixture", EDISON_ON_DEMAND_ENABLED: "true",
    EDISON_MEMBER_INVITATIONS_ENABLED: "true" }, async (input, init) => {
    const request = capture(input, init); requests.push(request);
    if (request.url.pathname === "/auth/v1/invite") return Response.json({ code: "email_exists" }, { status: 422 });
    assert.equal(request.url.pathname, "/auth/v1/otp");
    return Response.json({});
  });
  assert.deepEqual(await sender({ invitationId: invitation, email }), { outcome: "sent" });
  assert.deepEqual(requests.map((request) => request.url.pathname), ["/auth/v1/invite", "/auth/v1/otp"]);
  assert.deepEqual(requests[1].body, { email, create_user: false });
  const redirect = requests[1].url.searchParams.get("redirect_to")!;
  assert.equal(redirect, requests[0].url.searchParams.get("redirect_to"));
  const link = contextLink("magic-link", redirect);
  assert.equal(link.origin, "http://localhost:4310");
  assert.equal(link.pathname, "/auth/confirm");
  assert.equal(link.searchParams.get("invitation"), invitation);
  assert.deepEqual([...link.searchParams.keys()], ["invitation"], "the API must not invent a reading destination it does not know");
});

test("installed SDK sign-in sends the closed-signup OTP request and keeps the reading destination without an invitation", async () => {
  const requests: CapturedRequest[] = [];
  const client = codeClient(async (input, init) => {
    const request = capture(input, init); requests.push(request);
    assert.equal(request.url.pathname, "/auth/v1/otp");
    return Response.json({});
  });
  const redirect = signInCallbackUrl(next, "http://localhost:4310");
  const result = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirect } });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { user: null, session: null }, "a send response is not authenticated identity");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.create_user, false);
  assert.equal(requests[0].body.email, email);
  assert.equal(requests[0].url.searchParams.get("redirect_to"), redirect);
  const link = contextLink("magic-link", redirect);
  assert.equal(link.searchParams.get("next"), next);
  assert.equal(link.searchParams.has("invitation"), false);
});

test("installed SDK OTP and signup-resend transports retain the exact caller context and closed signup", async () => {
  const requests: CapturedRequest[] = [];
  const client = codeClient(async (input, init) => {
    const request = capture(input, init); requests.push(request);
    assert.ok(["/auth/v1/otp", "/auth/v1/resend"].includes(request.url.pathname));
    if (request.url.pathname === "/auth/v1/otp") return Response.json({ code: "signup_disabled", msg: "Fixture: signup disabled" }, {
      status: 422, headers: { "X-Supabase-Api-Version": "2024-01-01" },
    });
    return Response.json({});
  });
  const sent = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callback } });
  assert.equal(sent.error?.code, "signup_disabled");
  assert.equal(sent.error?.status, 422);
  assert.equal(requests.length, 1, "the SDK must not silently send again after the definitive failure");
  // The application's narrowly guarded renewal chooses this call; this test exercises the real SDK wire contract.
  assert.equal((await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: callback } })).error, null);
  assert.deepEqual(requests.map((request) => request.url.pathname), ["/auth/v1/otp", "/auth/v1/resend"]);
  assert.equal(requests[0].body.create_user, false);
  assert.equal(requests[1].body.type, "signup");
  for (const [index, name] of templates.entries()) {
    assert.equal(requests[index].body.email, email);
    assert.equal(requests[index].url.searchParams.get("redirect_to"), callback);
    assert.equal(contextLink(name, requests[index].url.searchParams.get("redirect_to")!).href, callback);
  }
});

test("a fresh installed SSR SDK verifies the displayed email code without a hash or PKCE state and writes session cookies", async () => {
  const requests: CapturedRequest[] = [];
  const cookies = new Map<string, string>();
  const client = createServerClient(authOrigin, "sb_publishable_offline_fixture", {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => { for (const { name, value } of values) cookies.set(name, value); } },
    global: { fetch: async (input, init) => {
      const request = capture(input, init); requests.push(request);
      assert.equal(request.url.pathname, "/auth/v1/verify");
      assert.equal(request.url.search, "");
      assert.deepEqual(request.body, { email, token: code, type: "email", gotrue_meta_security: {} });
      return Response.json({ access_token: "offline-access-token", refresh_token: "offline-refresh-token", token_type: "bearer", expires_in: 3600,
        user: { id: invitation, email, email_confirmed_at: "2026-09-08T00:00:00Z", aud: "authenticated", role: "authenticated", created_at: "2026-09-08T00:00:00Z", app_metadata: {}, user_metadata: {} } });
    } },
  });
  assert.equal(cookies.size, 0, "the fresh recipient browser has no PKCE verifier or session");
  const result = await client.auth.verifyOtp({ email, token: code, type: "email" });
  assert.equal(result.error, null);
  assert.equal(result.data.user?.email, email);
  assert.equal(result.data.session?.access_token, "offline-access-token");
  assert.equal(requests.length, 1, "verification cannot request another email");
  assert.ok(cookies.size > 0, "the actual SSR SDK persists the returned session for server membership checks");
  assert.ok([...cookies.keys()].every((name) => !name.includes("code-verifier")));
});
