import assert from "node:assert/strict";
import test from "node:test";
import { createInvitationSender, invitationConfirmationUrl, invitationDeliveryConfiguration } from "./invitation-delivery";

const invitationId = "10000000-0000-4000-8000-000000000001";
const environment = { NODE_ENV: "test", SUPABASE_URL: "https://constructed.supabase.co", WEB_APP_URL: "https://edison.example.test",
  EDISON_MEMBER_INVITATIONS_ENABLED: "true", EDISON_ON_DEMAND_ENABLED: "true",
  SUPABASE_SECRET_KEY: "sb_secret_constructed_not_live", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_constructed_not_live" };
const input = { invitationId, email: " Reader@Example.Test " };

test("invitation delivery uses only configured Auth invite SMTP with bounded identity-bearing redirect", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const sender = createInvitationSender(environment, async (url, init) => {
    calls.push({ url: new URL(String(url)), init: init! }); return new Response("{}", { status: 200 });
  });
  assert.deepEqual(await sender(input), { outcome: "sent" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, environment.SUPABASE_URL);
  assert.equal(calls[0].url.pathname, "/auth/v1/invite");
  const redirect = new URL(calls[0].url.searchParams.get("redirect_to")!);
  assert.equal(redirect.origin, environment.WEB_APP_URL); assert.equal(redirect.pathname, "/auth/confirm");
  assert.equal(redirect.searchParams.get("invitation"), invitationId);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { email: "reader@example.test" });
  assert.equal(new Headers(calls[0].init.headers).get("apikey"), environment.SUPABASE_SECRET_KEY);
  assert.equal(calls[0].init.redirect, "error"); assert.equal(calls[0].init.cache, "no-store");
  assert.ok(calls[0].init.signal);
});

test("only a definite confirmed-existing-user response permits one no-signup magic-link fallback", async () => {
  const calls: Array<{ path: string; body: unknown; key: string | null }> = [];
  const sender = createInvitationSender(environment, async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("apikey") });
    return calls.length === 1 ? Response.json({ code: "email_exists" }, { status: 422 }) : Response.json({});
  });
  assert.deepEqual(await sender(input), { outcome: "sent" });
  assert.deepEqual(calls.map((call) => call.path), ["/auth/v1/invite", "/auth/v1/otp"]);
  assert.deepEqual(calls[1].body, { email: "reader@example.test", create_user: false });
  assert.equal(calls[1].key, environment.SUPABASE_PUBLISHABLE_KEY);
});

test("ambiguous send does not retry and exposes no provider body, recipient or credential", async () => {
  for (const mode of ["network", "server", "redirect", "oversized"] as const) {
    let calls = 0;
    const sender = createInvitationSender(environment, async () => {
      calls++;
      if (mode === "network" || mode === "redirect") throw new Error(`${input.email} ${environment.SUPABASE_SECRET_KEY}`);
      return new Response(mode === "oversized" ? "x".repeat(20_000) : "private provider failure", { status: 500 });
    });
    assert.deepEqual(await sender(input), { outcome: "unknown", code: "delivery_unknown" });
    assert.equal(calls, 1);
  }
});

test("definitive rejection releases safely, while ordinary 422 messages cannot trigger a second email", async () => {
  for (const [status, code] of [[429, "over_email_send_rate_limit"], [422, "unexpected_validation"], [401, "bad_jwt"]] as const) {
    let calls = 0;
    const result = await createInvitationSender(environment, async () => { calls++; return Response.json({ code, message: "private data" }, { status }); })(input);
    assert.deepEqual(result, { outcome: "failed", code: status === 429 ? "delivery_rate_limited" : "delivery_rejected" });
    assert.equal(calls, 1);
  }
});

test("missing or unsafe server configuration cannot contact Auth; invitation ID cannot inject a redirect", async () => {
  for (const changed of [{ EDISON_MEMBER_INVITATIONS_ENABLED: undefined }, { EDISON_MEMBER_INVITATIONS_ENABLED: "false" },
    { EDISON_ON_DEMAND_ENABLED: "false" }, { SUPABASE_SECRET_KEY: "" }, { SUPABASE_SECRET_KEY: "eyJlegacy-service-role" },
    { SUPABASE_URL: "https://user:password@constructed.supabase.co" }, { WEB_APP_URL: "https://edison.example.test/other" },
    { WEB_APP_URL: "https://edison.example.test?redirect=evil" }, { NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:54321" }]) {
    let calls = 0;
    assert.deepEqual(await createInvitationSender({ ...environment, ...changed }, async () => { calls++; throw new Error("must not send"); })(input),
      { outcome: "failed", code: "delivery_not_configured" });
    assert.equal(calls, 0);
  }
  assert.throws(() => invitationConfirmationUrl(environment.WEB_APP_URL, "../?next=https://evil.test"));
  assert.equal(invitationDeliveryConfiguration(environment).webOrigin, environment.WEB_APP_URL);
});
