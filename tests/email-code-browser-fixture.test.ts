import assert from "node:assert/strict";
import test from "node:test";
import { createEmailCodeTransport } from "../lib/supabase/email-code-client";
import { createV10Fixture, LOCAL_MEMBER_FIXTURE, LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN,
  selfTestV10Fixture, selfTestV11MemberFixture } from "../scripts/demand-v10-browser-fixture";

const sdk = { apikey: LOCAL_MEMBER_FIXTURE.publishableKey, authorization: `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}` };
const bearer = { authorization: `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}` };
const context = `http://127.0.0.1:4310/auth/confirm?invitation=${LOCAL_MEMBER_FIXTURE.invitationId}&next=%2Farticles%2F10000000-0000-4000-8000-000000002711`;

function setup() {
  const fixture = createV10Fixture({ member: true });
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  const issue = () => fixture.handle("POST", `/auth/v1/otp?${new URLSearchParams({ redirect_to: context })}`,
    { email: LOCAL_MEMBER_FIXTURE.email, create_user: false }, sdk);
  const verify = (token: unknown = fixture.state().latestAuthCode?.code, fields: Record<string, unknown> = {}) =>
    fixture.handle("POST", "/auth/v1/verify", { email: LOCAL_MEMBER_FIXTURE.email, token, type: "email", ...fields }, sdk);
  return { fixture, operator, issue, verify };
}

function browser(fixture: ReturnType<typeof createV10Fixture>) {
  const cookies = new Map<string, string>(); const writes: string[] = []; const paths: string[] = [];
  const cookieDocument = {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); },
    set cookie(value: string) {
      writes.push(value);
      const [pair] = value.split(";"); const index = pair.indexOf("=");
      if (/max-age=0(?:;|$)/i.test(value)) cookies.delete(pair.slice(0, index));
      else cookies.set(pair.slice(0, index), pair.slice(index + 1));
    },
  };
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    assert.equal(url.origin, LOCAL_MEMBER_FIXTURE.origin, "the installed SDK must not contact a real service");
    paths.push(url.pathname);
    const raw = request.method === "GET" ? "" : await request.text();
    const reply = await fixture.handle(request.method, url.href, raw ? JSON.parse(raw) : {}, Object.fromEntries(request.headers));
    if (reply.loseResponse) throw new TypeError("Constructed lost local response");
    return Response.json(reply.body, { status: reply.status, headers: reply.headers });
  };
  const client = createEmailCodeTransport({ config: { url: LOCAL_MEMBER_FIXTURE.origin, publishableKey: LOCAL_MEMBER_FIXTURE.publishableKey },
    fetch: transport, cookieDocument, timeoutMs: 2000 });
  return { client, cookies, writes, paths };
}

test("a code prepared before a fresh browser has a tokenless context and single-use leading-zero verification", async () => {
  const { fixture, issue, verify } = setup();
  assert.equal((await issue()).status, 200);
  assert.deepEqual(fixture.state().latestAuthCode, { email: LOCAL_MEMBER_FIXTURE.email, code: "000123", url: context, template: "magic_link", status: "valid" });
  assert.equal(fixture.state().syntheticMember?.sessionActive, false);
  assert.equal((await fixture.handle("GET", `/v1/demand/invitations/${LOCAL_MEMBER_FIXTURE.invitationId}/preview`)).status, 200);
  assert.equal(fixture.state().syntheticAuthRequests?.verify, 0, "reading a context/preview cannot consume a code");
  const fresh = browser(fixture);
  try {
    const result = await fresh.client.verify(LOCAL_MEMBER_FIXTURE.email, "000123");
    assert.equal(result.error, null); assert.ok(result.session);
    assert.equal(fresh.writes.length, 0, "isolated verification cannot write a browser session");
    assert.equal(fixture.state().latestAuthCode?.status, "consumed");
    assert.equal((await verify("000123")).status, 403, "code replay is rejected");
    assert.equal((await fresh.client.commit(result.session, () => true))?.user.email, LOCAL_MEMBER_FIXTURE.email);
    assert.ok(fresh.writes.some((value) => value.includes("auth-token=base64-")), "only the actual installed SDK commits cookies");
    assert.equal((await fresh.client.readSession(LOCAL_MEMBER_FIXTURE.email, () => true))?.user.id, LOCAL_MEMBER_FIXTURE.userId);
    assert.ok(fresh.paths.includes("/auth/v1/verify") && fresh.paths.includes("/auth/v1/user"));
    assert.equal(fixture.state().syntheticAuthRequests?.otp, 1, "fresh code entry never needs another send");
  } finally { fresh.client.dispose(); }
});

test("numeric-code validation rejects malformed, expired, wrong-recipient and wrong-type inputs without authenticating", async () => {
  const { fixture, operator, issue, verify } = setup();
  await issue();
  for (const input of [123, "123", "00012a", " 000123", "123000", "", null]) assert.equal((await verify(input)).status, 403);
  assert.equal((await verify("000123", { email: LOCAL_MEMBER_FIXTURE.absentEmail })).status, 403);
  assert.equal((await verify("000123", { type: "invite" })).status, 403);
  assert.equal((await verify("000123", { token_hash: LOCAL_MEMBER_FIXTURE.tokenHash })).status, 403);
  assert.equal(fixture.state().latestAuthCode?.status, "valid");
  assert.equal(fixture.state().syntheticMember?.sessionActive, false);
  await operator({ action: "auth-code", status: "expired" });
  assert.equal((await verify("000123")).status, 403);
  assert.equal(fixture.state().syntheticMember?.sessionActive, false);
  assert.equal((await operator({ action: "auth-code", status: "valid" })).status, 400, "the operator cannot revive a used/expired code");
});

test("resending issues a new code and invalidates the old challenge while retaining the exact invitation and destination", async () => {
  const { fixture, issue, verify } = setup();
  await issue(); await issue();
  assert.equal(fixture.state().latestAuthCode?.code, "000124");
  assert.equal(fixture.state().latestAuthCode?.url, context);
  assert.equal((await verify("000123")).status, 403);
  assert.equal((await verify("000124")).status, 200);
});

test("unconfirmed invitation renewal uses Confirmation email/token verification without granting membership or another invitation", async () => {
  const { fixture, operator } = setup(); const fresh = browser(fixture);
  await operator({ action: "member", status: "pending" }); await operator({ action: "auth-user", confirmed: false });
  try {
    const blocked = await fresh.client.send(LOCAL_MEMBER_FIXTURE.email, context);
    assert.equal(blocked?.code, "signup_disabled"); assert.equal(fixture.state().latestAuthCode, null);
    assert.equal(await fresh.client.resendConfirmation(LOCAL_MEMBER_FIXTURE.email, context), null);
    assert.equal(fixture.state().latestAuthCode?.template, "confirmation");
    assert.equal(fixture.state().latestAuthCode?.url, context);
    const verified = await fresh.client.verify(LOCAL_MEMBER_FIXTURE.email, "000123"); assert.ok(verified.session);
    await fresh.client.commit(verified.session, () => true);
    assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 403, "code proves identity, not admission");
    const before = fixture.state().invitations;
    const acceptPath = `/v1/demand/invitations/${LOCAL_MEMBER_FIXTURE.invitationId}/redeem`;
    assert.equal((await fixture.handle("POST", acceptPath, { idempotencyKey: "fixture-code-acceptance" }, bearer)).status, 200);
    assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 200);
    assert.deepEqual(fixture.state().invitations, before, "the same incoming invitation does not allocate another five slots");
    await operator({ action: "member", status: "revoked" });
    assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 403);
  } finally { fresh.client.dispose(); }
});

test("send throttling and uncertain outcomes do not fake delivery; an after-send uncertainty may leave a usable code", async () => {
  for (const mode of ["rate-limited", "unknown", "unknown-after"] as const) {
    const { fixture, operator } = setup(); const fresh = browser(fixture);
    try {
      await operator({ action: "auth-fault", path: "otp", mode });
      const result = await fresh.client.send(LOCAL_MEMBER_FIXTURE.email, context);
      assert.equal(result?.status, mode === "rate-limited" ? 429 : 500);
      assert.equal(fixture.state().syntheticAuthRequests?.otp, 1);
      assert.equal(fixture.state().syntheticAuthRequests?.resend, 0);
      assert.equal(fixture.state().latestAuthCode?.status ?? null, mode === "unknown-after" ? "valid" : null);
      assert.equal(fixture.state().syntheticMember?.sessionActive, false);
      assert.equal(fresh.writes.length, 0);
    } finally { fresh.client.dispose(); }
  }
});

test("uncertain verification before and after remote consumption never implies a saved browser session", async () => {
  for (const mode of ["rate-limited", "unknown", "unknown-after"] as const) {
    const { fixture, issue, operator } = setup(); const fresh = browser(fixture); await issue();
    try {
      await operator({ action: "auth-fault", path: "verify", mode });
      const result = await fresh.client.verify(LOCAL_MEMBER_FIXTURE.email, "000123");
      assert.equal(result.session, null); assert.equal(result.error?.status, mode === "rate-limited" ? 429 : 500);
      assert.equal(fixture.state().latestAuthCode?.status, mode === "unknown-after" ? "consumed" : "valid");
      assert.equal(fixture.state().syntheticMember?.sessionActive, mode === "unknown-after");
      assert.equal(await fresh.client.readSession(LOCAL_MEMBER_FIXTURE.email, () => true), null);
      assert.equal(fresh.writes.length, 0);
      assert.equal(fixture.state().syntheticAuthRequests?.verify, 1, "checking session cannot re-verify the code");
    } finally { fresh.client.dispose(); }
  }
});

test("a saved SDK session survives a failed identity check and can be reconciled without replaying its consumed code", async () => {
  const { fixture, issue, operator } = setup(); const fresh = browser(fixture); await issue();
  try {
    const verified = await fresh.client.verify(LOCAL_MEMBER_FIXTURE.email, "000123"); assert.ok(verified.session);
    await fresh.client.commit(verified.session, () => true); const saved = [...fresh.cookies]; const writes = fresh.writes.length;
    await operator({ action: "auth-fault", path: "user", mode: "unknown" });
    await assert.rejects(fresh.client.readSession(LOCAL_MEMBER_FIXTURE.email, () => true));
    assert.deepEqual([...fresh.cookies], saved);
    assert.equal((await fresh.client.readSession(LOCAL_MEMBER_FIXTURE.email, () => true))?.user.id, LOCAL_MEMBER_FIXTURE.userId);
    assert.equal(fresh.writes.length, writes, "reconciliation must be read-only");
    assert.equal(fixture.state().syntheticAuthRequests?.verify, 1);
  } finally { fresh.client.dispose(); }
});

test("a delayed verification can be fenced after Change email without committing old-identity cookies", async () => {
  const { fixture, issue, operator } = setup(); const fresh = browser(fixture); await issue();
  try {
    await operator({ action: "auth-fault", path: "verify", mode: "hold-response" });
    const pending = fresh.client.verify(LOCAL_MEMBER_FIXTURE.email, "000123");
    for (let index = 0; index < 30 && !fixture.state().heldResponses; index++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.state().heldResponses, 1);
    assert.equal(fresh.writes.length, 0);
    await operator({ action: "release-responses" });
    const late = await pending; assert.ok(late.session);
    await assert.rejects(fresh.client.commit(late.session, () => false), /stale_email_code_session/);
    assert.equal(fresh.writes.length, 0);
    assert.equal(await fresh.client.readSession(LOCAL_MEMBER_FIXTURE.email, () => true), null);
  } finally { fresh.client.dispose(); }
});

test("code controls remain operator-only, scoped to constructed member mode, and cannot affect real services", async () => {
  const { fixture, issue } = setup(); await issue();
  for (const headers of [{}, { "x-edison-fixture-operator": "local-only", origin: "http://127.0.0.1:4310" }]) {
    assert.equal((await fixture.handle("POST", "/__fixture/control", { action: "auth-code", status: "expired" }, headers)).status, 403);
  }
  assert.equal(fixture.state().latestAuthCode?.status, "valid");
  const other = createV10Fixture({ v11: true });
  assert.equal((await other.handle("POST", "/__fixture/control", { action: "auth-code", status: "expired" }, { "x-edison-fixture-operator": "local-only" })).status, 404);
  assert.equal((await fixture.handle("POST", "https://real.example/auth/v1/verify", { email: LOCAL_MEMBER_FIXTURE.email, token: "000123", type: "email" }, sdk)).status, 403);
  assert.deepEqual([fixture.state().authCalls, fixture.state().providerCalls, fixture.state().databaseCalls], [0, 0, 0]);
  assert.equal(fixture.state().authProof, false);
});

test("legacy hash-based link self-tests remain compatible beside the separate single-use code protocol", async () => {
  assert.equal((await selfTestV10Fixture()).passed, true);
  assert.equal((await selfTestV11MemberFixture()).passed, true);
});
