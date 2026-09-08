import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { AuthApiError, type Session } from "@supabase/supabase-js";
import { createEmailCodeAuthController } from "../lib/email-code-auth";
import { createEmailCodeTransport, type EmailCodeTransport } from "../lib/supabase/email-code-client";

const config = { url: "https://fixture.supabase.example", publishableKey: "sb_publishable_synthetic_email_code_fixture" };
const contextUrl = "https://edison.example/auth/confirm?next=%2Fdemand&invitation=00000000-0000-4000-8000-000000000001";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function user(email: string) { return { id: email.startsWith("old") ? "old-user" : "new-user", email, email_confirmed_at: "2026-09-08T12:00:00Z", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-08T12:00:00Z" }; }
function session(email: string): Session {
  const payload = { sub: user(email).id, email, exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify(payload)).toString("base64url"), Buffer.from("synthetic-signature").toString("base64url")].join(".");
  return { access_token: token, refresh_token: `synthetic-refresh-${email}`, expires_in: 3600, token_type: "bearer", user: user(email) };
}
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" } }); }
function cookieJar() {
  const jar = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    get cookie() { return [...jar].map(([key, value]) => `${key}=${value}`).join("; "); },
    set cookie(value: string) {
      writes.push(value);
      const [pair] = value.split(";");
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals);
      if (/max-age=0(?:;|$)/i.test(value)) jar.delete(name);
      else jar.set(name, pair.slice(equals + 1));
    },
  };
}
function fixtureFetch(custom?: (path: string, body: Record<string, unknown>, headers: Headers) => Promise<Response> | Response) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ path, body });
    const headers = new Headers(init?.headers);
    if (custom) return custom(path, body, headers);
    if (path.endsWith("/verify")) return reply(session(String(body.email)));
    if (path.endsWith("/user")) {
      const payload = JSON.parse(Buffer.from(headers.get("authorization")!.split(".")[1], "base64url").toString()) as { email: string };
      return reply(user(payload.email));
    }
    return reply({});
  };
  return { fetcher, calls };
}
function mockedTransport(overrides: Partial<EmailCodeTransport> = {}): EmailCodeTransport {
  return { send: async () => null, resendConfirmation: async () => null, verify: async (email) => ({ session: session(email), error: null }), commit: async (value, current) => current() ? value : null, readSession: async () => null, dispose() {}, ...overrides };
}

test("actual SDK send uses closed signup, ordinary context and email-token verification without browser PKCE", async () => {
  const jar = cookieJar(); const http = fixtureFetch();
  const transport = createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar });
  const controller = createEmailCodeAuthController({ contextUrl, transport });
  assert.equal(await controller.send("new@example.test"), "code");
  assert.equal(jar.writes.length, 0, "sending must not alter browser sessions or PKCE cookies");
  assert.equal(await controller.verify("001234"), "signed_in");
  assert.equal(http.calls.filter(({ path }) => path.endsWith("/otp")).length, 1);
  assert.equal(http.calls[0].body.create_user, false);
  assert.equal(http.calls[0].body.code_challenge, null);
  assert.equal(http.calls.find(({ path }) => path.endsWith("/verify"))?.body.type, "email");
  assert.equal(http.calls.find(({ path }) => path.endsWith("/verify"))?.body.token, "001234");
  assert.ok(jar.cookie.includes("sb-fixture-auth-token"));
  assert.equal((await transport.readSession("new@example.test", () => true))?.user.email, "new@example.test");
  controller.dispose();
});

test("negative control: the installed persistent SDK really saves cookies before verifyOtp resolves", async () => {
  const jar = cookieJar(); const http = fixtureFetch(); const saved = deferred<void>(); const release = deferred<void>();
  const browser = createBrowserClient(config.url, config.publishableKey, {
    isSingleton: false, auth: { autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: http.fetcher },
    cookies: { getAll: () => parseCookieHeader(jar.cookie), setAll: (batch) => { for (const cookie of batch) jar.cookie = serializeCookieHeader(cookie.name, cookie.value, cookie.options); } },
  });
  await browser.auth.initialize();
  browser.auth.onAuthStateChange(async (event) => { if (event === "SIGNED_IN") { saved.resolve(); await release.promise; } });
  let returned = false;
  const pending = browser.auth.verifyOtp({ email: "old@example.test", token: "001234", type: "email" }).then(() => { returned = true; });
  await saved.promise;
  assert.equal(returned, false);
  assert.ok(jar.cookie.includes("sb-fixture-auth-token"), "a stale promise check alone would be too late");
  release.resolve(); await pending; await browser.auth.dispose();
});

test("actual SDK late old-email verification cannot write cookies or overwrite a newer identity", async () => {
  const jar = cookieJar(); const oldResponse = deferred<Response>(); const oldStarted = deferred<void>();
  const ordinary = fixtureFetch();
  const http = fixtureFetch((path, body, headers) => {
    if (path.endsWith("/verify") && body.email === "old@example.test") { oldStarted.resolve(); return oldResponse.promise; }
    return ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers });
  });
  const transport = createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar });
  const controller = createEmailCodeAuthController({ contextUrl, transport });
  controller.beginCode("old@example.test");
  const old = controller.verify("001234"); await oldStarted.promise;
  assert.equal(controller.changeEmail(), true);
  assert.equal(controller.beginCode("new@example.test"), true);
  assert.equal(await controller.verify("001235"), "signed_in");
  const currentCookies = jar.cookie; const writes = jar.writes.length;
  oldResponse.resolve(reply(session("old@example.test")));
  assert.equal(await old, "stale");
  assert.equal(jar.cookie, currentCookies);
  assert.equal(jar.writes.length, writes);
  assert.equal(controller.snapshot().email, "new@example.test");
  assert.equal((await transport.readSession("new@example.test", () => true))?.user.email, "new@example.test");
  controller.dispose();
});

test("actual SDK async setSession is guarded at cookie write; disposed old commit cannot clear newer cookies", async () => {
  const jar = cookieJar(); const oldUser = deferred<Response>(); const commitStarted = deferred<void>();
  const ordinary = fixtureFetch();
  const oldHttp = fixtureFetch((path, body, headers) => {
    if (path.endsWith("/user")) { commitStarted.resolve(); return oldUser.promise; }
    return ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers });
  });
  const oldTransport = createEmailCodeTransport({ config, fetch: oldHttp.fetcher, cookieDocument: jar });
  const oldController = createEmailCodeAuthController({ contextUrl, transport: oldTransport });
  oldController.beginCode("old@example.test");
  const pending = oldController.verify("001234"); await commitStarted.promise;
  assert.equal(oldController.snapshot().phase, "committing");
  assert.equal(oldController.changeEmail(), false, "identity changes are briefly serialized during commit");
  oldController.dispose();
  const newTransport = createEmailCodeTransport({ config, fetch: ordinary.fetcher, cookieDocument: jar });
  const next = createEmailCodeAuthController({ contextUrl, transport: newTransport });
  next.beginCode("new@example.test");
  assert.equal(await next.verify("001234"), "signed_in");
  const newCookies = jar.cookie; const writes = jar.writes.length;
  oldUser.resolve(reply(user("old@example.test")));
  assert.equal(await pending, "stale");
  assert.equal(jar.cookie, newCookies);
  assert.equal(jar.writes.length, writes, "no stale write or compensating signout is allowed");
  next.dispose();
});

test("actual SDK saved-session recovery is distinct from a response lost before any session exists", async () => {
  const jar = cookieJar(); const http = fixtureFetch();
  const firstTransport = createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar });
  const first = createEmailCodeAuthController({ contextUrl, transport: firstTransport });
  first.beginCode("new@example.test"); await first.verify("001234"); first.dispose();
  const transport = createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar });
  const recovery = createEmailCodeAuthController({ contextUrl, transport });
  recovery.beginCode("new@example.test");
  const before = http.calls.length; const writes = jar.writes.length;
  assert.equal(await recovery.checkSession(), "signed_in");
  assert.ok(http.calls.slice(before).every(({ path }) => path.endsWith("/user")));
  assert.equal(jar.writes.length, writes, "status recovery does not rewrite the saved session");
  recovery.changeEmail(); recovery.beginCode("old@example.test");
  assert.equal(await recovery.checkSession(), "unknown");
  assert.equal(jar.writes.length, writes, "a different saved identity is not erased or adopted");
  recovery.dispose();
  const emptyHttp = fixtureFetch(() => reply({ code: "unexpected_failure", msg: "Synthetic response lost" }, 503));
  const empty = cookieJar();
  const uncertain = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: emptyHttp.fetcher, cookieDocument: empty }) });
  uncertain.beginCode("new@example.test");
  assert.equal(await uncertain.verify("001234"), "unknown");
  assert.equal(await uncertain.checkSession(), "unknown");
  assert.equal(uncertain.snapshot().issue, "verification_unknown");
  assert.equal(empty.writes.length, 0);
  assert.equal(emptyHttp.calls.filter(({ path }) => path.endsWith("/verify")).length, 1);
  assert.equal(emptyHttp.calls.some(({ path }) => /\/(otp|resend)$/.test(path)), false);
  uncertain.dispose();
});

test("two mounted controllers: delayed old commit and its later recovery cannot overwrite a newer identity", async () => {
  const jar = cookieJar(); const oldUser = deferred<Response>(); const started = deferred<void>();
  const ordinary = fixtureFetch();
  const oldHttp = fixtureFetch((path, body, headers) => {
    if (path.endsWith("/user")) { started.resolve(); return oldUser.promise; }
    return ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers });
  });
  const old = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: oldHttp.fetcher, cookieDocument: jar }) });
  old.beginCode("old@example.test");
  const pending = old.verify("001234"); await started.promise;
  const newer = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: ordinary.fetcher, cookieDocument: jar }) });
  newer.beginCode("new@example.test");
  assert.equal(await newer.verify("001235"), "signed_in");
  const saved = jar.cookie; const writes = jar.writes.length;
  oldUser.resolve(reply(user("old@example.test")));
  assert.equal(await pending, "unknown", "the old controller remains mounted; disposal is not the guard");
  assert.equal(await old.checkSession(), "unknown", "Check status cannot rebase the old candidate onto newer cookies");
  assert.equal(jar.cookie, saved);
  assert.equal(jar.writes.length, writes);
  assert.equal(oldHttp.calls.filter(({ path }) => path.endsWith("/verify")).length, 1);
  assert.equal(oldHttp.calls.filter(({ path }) => path.endsWith("/user")).length, 1, "conflicting retry is rejected before another commit lookup");
  assert.equal(oldHttp.calls.some(({ path }) => /\/(otp|resend)$/.test(path)), false);
  old.dispose(); newer.dispose();
});

test("candidate cookie binding starts before verify, not after its delayed response", async () => {
  const jar = cookieJar(); const oldResponse = deferred<Response>(); const started = deferred<void>();
  const oldHttp = fixtureFetch(() => { started.resolve(); return oldResponse.promise; });
  const old = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: oldHttp.fetcher, cookieDocument: jar }) });
  old.beginCode("old@example.test"); const pending = old.verify("001234"); await started.promise;
  const ordinary = fixtureFetch();
  const newer = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: ordinary.fetcher, cookieDocument: jar }) });
  newer.beginCode("new@example.test"); await newer.verify("001235");
  const saved = jar.cookie; const writes = jar.writes.length;
  oldResponse.resolve(reply(session("old@example.test")));
  assert.equal(await pending, "unknown");
  assert.equal(oldHttp.calls.length, 1, "late verification never begins browser commit against a changed baseline");
  assert.equal(jar.cookie, saved); assert.equal(jar.writes.length, writes);
  old.dispose(); newer.dispose();
});

test("same-email newer saved session can be recovered read-only without replaying the old candidate", async () => {
  const jar = cookieJar(); const oldUser = deferred<Response>(); const started = deferred<void>();
  const ordinary = fixtureFetch(); let userReads = 0;
  const oldHttp = fixtureFetch((path, body, headers) => {
    if (path.endsWith("/user") && ++userReads === 1) { started.resolve(); return oldUser.promise; }
    return ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers });
  });
  const old = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: oldHttp.fetcher, cookieDocument: jar }) });
  old.beginCode("new@example.test"); const pending = old.verify("001234"); await started.promise;
  const newHttp = fixtureFetch((path, body, headers) => path.endsWith("/verify")
    ? reply({ ...session(String(body.email)), refresh_token: "synthetic-newer-same-email-refresh" })
    : ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers }));
  const newer = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: newHttp.fetcher, cookieDocument: jar }) });
  newer.beginCode("new@example.test"); await newer.verify("001235");
  const saved = jar.cookie; const writes = jar.writes.length;
  oldUser.resolve(reply(user("new@example.test")));
  assert.equal(await pending, "unknown");
  assert.equal(await old.checkSession(), "signed_in");
  assert.equal(jar.cookie, saved); assert.equal(jar.writes.length, writes);
  assert.equal(oldHttp.calls.filter(({ path }) => path.endsWith("/verify")).length, 1);
  old.dispose(); newer.dispose();
});

test("actual SDK cookie guard ignores unrelated cookies but binds every numeric Auth chunk", async () => {
  for (const changedCookie of ["theme=clay", "sb-fixture-auth-token.other=unrelated", "sb-fixture-auth-token.0=changed-auth-chunk", "sb-fixture-auth-token.12=changed-auth-chunk"]) {
    const jar = cookieJar(); const userResponse = deferred<Response>(); const started = deferred<void>();
    const ordinary = fixtureFetch();
    const http = fixtureFetch((path, body, headers) => {
      if (path.endsWith("/user")) { started.resolve(); return userResponse.promise; }
      return ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers });
    });
    const controller = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar }) });
    controller.beginCode("new@example.test"); const pending = controller.verify("001234"); await started.promise;
    jar.cookie = changedCookie;
    const before = jar.cookie; const writes = jar.writes.length;
    userResponse.resolve(reply(user("new@example.test")));
    const authChanged = /\.\d+=/.test(changedCookie);
    assert.equal(await pending, authChanged ? "unknown" : "signed_in", changedCookie);
    if (authChanged) { assert.equal(jar.cookie, before); assert.equal(jar.writes.length, writes); }
    else assert.ok(jar.cookie.includes(changedCookie), "unrelated cookie survives normal SDK commit");
    controller.dispose();
  }
});

test("candidate identity is canonical across Auth cookie order, without broadening its cookie namespace", async () => {
  const jar = cookieJar(); const userResponse = deferred<Response>(); const started = deferred<void>(); const ordinary = fixtureFetch();
  jar.cookie = "sb-fixture-auth-token.0=old-first"; jar.cookie = "sb-fixture-auth-token.1=old-second";
  const http = fixtureFetch((path, body, headers) => {
    if (path.endsWith("/user")) { started.resolve(); return userResponse.promise; }
    return ordinary.fetcher(`${config.url}${path}`, { method: "POST", body: JSON.stringify(body), headers });
  });
  const controller = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar }) });
  controller.beginCode("new@example.test"); const pending = controller.verify("001234"); await started.promise;
  jar.cookie = "sb-fixture-auth-token.0=; Max-Age=0"; jar.cookie = "sb-fixture-auth-token.0=old-first";
  userResponse.resolve(reply(user("new@example.test")));
  assert.equal(await pending, "signed_in", "enumeration order is not an identity change");
  controller.dispose();
});

test("a real SDK save with a lost outcome recovers read-only, retaining the candidate's own completed cookie baseline", async () => {
  const jar = cookieJar(); const http = fixtureFetch();
  const transport = createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar });
  let commits = 0;
  const controller = createEmailCodeAuthController({ contextUrl, transport: { ...transport, async commit(value, current) {
    const saved = await transport.commit(value, current);
    if (++commits === 1) throw new Error("Synthetic outcome lost after real SDK cookie save");
    return saved;
  } } });
  controller.beginCode("new@example.test");
  assert.equal(await controller.verify("001234"), "unknown");
  assert.ok(jar.cookie.includes("sb-fixture-auth-token"));
  const saved = jar.cookie; const writes = jar.writes.length;
  assert.equal(await controller.checkSession(), "signed_in");
  assert.equal(commits, 1, "matching saved session is recovered before candidate recommit");
  assert.equal(jar.cookie, saved); assert.equal(jar.writes.length, writes);
  assert.equal(http.calls.filter(({ path }) => path.endsWith("/verify")).length, 1);
  assert.equal(http.calls.some(({ path }) => /\/(otp|resend)$/.test(path)), false);
  controller.dispose();
});

test("an own completed cookie batch advances only that candidate for an explicit guarded commit retry", async () => {
  const jar = cookieJar(); const http = fixtureFetch();
  const transport = createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: jar });
  let commits = 0; let reads = 0;
  const controller = createEmailCodeAuthController({ contextUrl, transport: { ...transport,
    async readSession() { reads++; throw new Error("Synthetic read-only recovery unavailable"); },
    async commit(value, current) {
      const saved = await transport.commit(value, current);
      if (++commits === 1) throw new Error("Synthetic outcome lost after own complete cookie batch");
      return saved;
    },
  } });
  controller.beginCode("new@example.test");
  assert.equal(await controller.verify("001234"), "unknown");
  assert.equal(await controller.checkSession(), "signed_in");
  assert.equal(commits, 2); assert.equal(reads, 1);
  assert.equal(http.calls.filter(({ path }) => path.endsWith("/verify")).length, 1);
  assert.equal(http.calls.some(({ path }) => /\/(otp|resend)$/.test(path)), false);
  assert.equal((await transport.readSession("new@example.test", () => true))?.user.email, "new@example.test");
  controller.dispose();
});

test("read-only recovery rejects a cookie identity changed while authoritative user verification is pending", async () => {
  const jar = cookieJar(); const ordinary = fixtureFetch();
  const first = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: ordinary.fetcher, cookieDocument: jar }) });
  first.beginCode("old@example.test"); await first.verify("001234"); first.dispose();
  const userResponse = deferred<Response>(); const started = deferred<void>();
  const recoveryHttp = fixtureFetch(() => { started.resolve(); return userResponse.promise; });
  const recovery = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: recoveryHttp.fetcher, cookieDocument: jar }) });
  recovery.beginCode("old@example.test"); const pending = recovery.checkSession(); await started.promise;
  const newer = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: ordinary.fetcher, cookieDocument: jar }) });
  newer.beginCode("new@example.test"); await newer.verify("001235");
  const saved = jar.cookie; const writes = jar.writes.length;
  userResponse.resolve(reply(user("old@example.test")));
  assert.equal(await pending, "unknown");
  assert.equal(jar.cookie, saved); assert.equal(jar.writes.length, writes);
  recovery.dispose(); newer.dispose();
});

test("actual SDK confirmation renewal occurs only for invitation plus exact 422 signup_disabled", async () => {
  for (const [invitation, responseStatus, code, expected] of [[true, 422, "signup_disabled", 1], [false, 422, "signup_disabled", 0], [true, 400, "signup_disabled", 0], [true, 422, "other_error", 0], [true, 503, "signup_disabled", 0]] as const) {
    const http = fixtureFetch((path) => path.endsWith("/otp") ? reply({ code, msg: "Synthetic generic response" }, responseStatus) : reply({}));
    const controller = createEmailCodeAuthController({ contextUrl, invitationId: invitation ? "invitation-id" : undefined, transport: createEmailCodeTransport({ config, fetch: http.fetcher, cookieDocument: cookieJar() }) });
    const result = await controller.send("new@example.test");
    assert.equal(result, responseStatus === 503 ? "unknown" : "code");
    const resends = http.calls.filter(({ path }) => path.endsWith("/resend"));
    assert.equal(resends.length, expected);
    if (expected) { assert.equal(resends[0].body.type, "signup"); assert.equal(resends[0].body.email, "new@example.test"); }
    controller.dispose();
  }
});

test("stale send cannot fall back, show delivery, or replace a changed email challenge", async () => {
  const response = deferred<AuthApiError | null>(); let fallback = 0;
  const controller = createEmailCodeAuthController({ contextUrl, invitationId: "invitation", transport: mockedTransport({ send: () => response.promise, resendConfirmation: async () => { fallback++; return null; } }) });
  const pending = controller.send("old@example.test");
  controller.changeEmail(); controller.beginCode("new@example.test");
  response.resolve(new AuthApiError("Synthetic", 422, "signup_disabled"));
  assert.equal(await pending, "stale");
  assert.equal(fallback, 0);
  assert.equal(controller.snapshot().email, "new@example.test");
  assert.equal(controller.snapshot().issue, null);
});

test("duplicate sends and cooldown survive email changes and generic failed delivery", async () => {
  let now = 1000; let sends = 0; const attempted: number[] = []; const response = deferred<null>();
  const controller = createEmailCodeAuthController({ contextUrl, initialRetryAt: 2000, now: () => now, onAttempt: (at) => attempted.push(at), transport: mockedTransport({ send: () => { sends++; return response.promise; } }) });
  assert.equal(await controller.send("new@example.test"), "cooldown");
  now = 2000;
  const pending = controller.send("new@example.test");
  assert.equal(await controller.send("new@example.test"), "busy");
  controller.changeEmail();
  assert.equal(await controller.send("old@example.test"), "cooldown");
  assert.deepEqual(attempted, [62000]);
  assert.equal(sends, 1);
  response.resolve(null); assert.equal(await pending, "stale");
});

test("generic send errors do not disclose eligibility; throttling and unknown delivery never trigger fallback", async () => {
  for (const [error, expected, issue] of [[new AuthApiError("Member detail must not escape", 400, "user_not_found"), "code", null], [new AuthApiError("Throttle", 429, "over_email_send_rate_limit"), "rate_limited", "rate_limited"], [new Error("Network"), "unknown", "delivery_unknown"]] as const) {
    let fallback = 0;
    const controller = createEmailCodeAuthController({ contextUrl, invitationId: "invitation", transport: mockedTransport({ send: async () => { if (error instanceof AuthApiError) return error; throw error; }, resendConfirmation: async () => { fallback++; return null; } }) });
    assert.equal(await controller.send("new@example.test"), expected);
    assert.equal(controller.snapshot().issue, issue);
    assert.equal(fallback, 0);
  }
});

test("invalid and ambiguous-expiry codes are generic; no verification or resend happens automatically", async () => {
  let verifies = 0; let sends = 0;
  const controller = createEmailCodeAuthController({ contextUrl, transport: mockedTransport({ send: async () => { sends++; return null; }, verify: async () => { verifies++; return { session: null, error: new AuthApiError("Token expired or invalid", 403, "otp_expired") }; } }) });
  assert.equal(controller.beginCode("bad"), false);
  assert.equal(controller.snapshot().issue, "invalid_email");
  controller.beginCode("new@example.test");
  assert.equal(await controller.verify("a12345"), "invalid");
  assert.equal(verifies, 0);
  assert.equal(await controller.verify("001234"), "invalid");
  assert.equal(controller.snapshot().issue, "invalid");
  assert.equal(sends, 0);
});

test("only exactly six code digits dispatch; whitespace normalizes and leading zeros survive unchanged", async () => {
  const tokens: string[] = []; let commits = 0;
  const controller = createEmailCodeAuthController({ contextUrl, transport: mockedTransport({
    verify: async (email, token) => { tokens.push(token); return { session: session(email), error: null }; },
    commit: async (value) => { commits++; return value; },
  }) });
  controller.beginCode("new@example.test");
  for (const code of ["", "1234", "12345", "1234567", "12345678", "1234567890", "1".repeat(1000), "letters".repeat(100), "a12345", "123456a", "00 123", "00 12345"]) {
    assert.equal(await controller.verify(code), "invalid", `invalid length/content: ${code.length}`);
    assert.equal(controller.snapshot().phase, "code");
    assert.equal(controller.snapshot().issue, "invalid");
    assert.equal(tokens.length, 0);
    assert.equal(commits, 0);
  }
  assert.equal(await controller.verify(" \t00 12\n34\r "), "signed_in");
  assert.deepEqual(tokens, ["001234"]);
  assert.equal(commits, 1);
  controller.dispose();
});

test("a verified candidate with uncertain commit can be explicitly reconciled without verifying or resending the code", async () => {
  let commits = 0; let verifies = 0;
  const controller = createEmailCodeAuthController({ contextUrl, transport: mockedTransport({ verify: async (email) => { verifies++; return { session: session(email), error: null }; }, commit: async (value) => { if (++commits === 1) throw new Error("Synthetic lost commit outcome"); return value; } }) });
  controller.beginCode("new@example.test");
  assert.equal(await controller.verify("001234"), "unknown");
  assert.equal(await controller.checkSession(), "signed_in");
  assert.equal(commits, 2); assert.equal(verifies, 1);
});

test("408 is uncertain for both send and verification, never invalid or expired", async () => {
  const timeout = new AuthApiError("Synthetic timeout", 408, "request_timeout");
  const controller = createEmailCodeAuthController({ contextUrl, transport: mockedTransport({ send: async () => timeout, verify: async () => ({ session: null, error: timeout }) }) });
  assert.equal(await controller.send("new@example.test"), "unknown");
  assert.equal(controller.snapshot().issue, "delivery_unknown");
  assert.equal(await controller.verify("001234"), "unknown");
  assert.equal(controller.snapshot().issue, "verification_unknown");
});

test("actual SDK full-response timeout includes a hanging body and never retries delivery", async () => {
  let reads = 0; let cancelled = false;
  const fetcher: typeof fetch = async () => { reads++; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }); };
  const controller = createEmailCodeAuthController({ contextUrl, invitationId: "invitation", transport: createEmailCodeTransport({ config, fetch: fetcher, cookieDocument: cookieJar(), timeoutMs: 10 }) });
  assert.equal(await controller.send("new@example.test"), "unknown");
  assert.equal(controller.snapshot().issue, "delivery_unknown");
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
  controller.dispose();
});

test("actual provider Retry-After is preserved, capped defensively at24h, and blocks only rate-limited verification", async () => {
  for (const seconds of [120, 172800]) {
    let reads = 0;
    const attempted: number[] = [];
    const fetcher: typeof fetch = async () => { reads++; return new Response(JSON.stringify({ code: "over_request_rate_limit", msg: "Synthetic throttle" }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(seconds) } }); };
    const before = Date.now();
    const controller = createEmailCodeAuthController({ contextUrl, onAttempt: (at) => attempted.push(at), transport: createEmailCodeTransport({ config, fetch: fetcher, cookieDocument: cookieJar() }) });
    controller.beginCode("new@example.test");
    assert.equal(await controller.verify("001234"), "rate_limited");
    const wait = Math.min(seconds, 86400) * 1000;
    assert.ok(controller.snapshot().retryAt >= before + wait);
    assert.ok(controller.snapshot().retryAt <= Date.now() + wait);
    assert.equal(attempted[0], controller.snapshot().retryAt);
    assert.equal(await controller.verify("001234"), "cooldown");
    assert.equal(reads, 1);
    controller.dispose();
  }
});

test("anonymous or unconfirmed identities cannot be committed or reported signed in", async () => {
  for (const invalid of [{ ...session("new@example.test"), user: { ...user("new@example.test"), is_anonymous: true } }, { ...session("new@example.test"), user: { ...user("new@example.test"), email_confirmed_at: undefined } }]) {
    let commits = 0;
    const controller = createEmailCodeAuthController({ contextUrl, transport: mockedTransport({ verify: async () => ({ session: invalid, error: null }), readSession: async () => invalid, commit: async (value) => { commits++; return value; } }) });
    controller.beginCode("new@example.test");
    assert.equal(await controller.verify("001234"), "unknown");
    assert.equal(await controller.checkSession(), "unknown");
    assert.equal(commits, 0);
  }
});

test("actual SDK recovery rejects provider-confirmed anonymous identity without rewriting cookies", async () => {
  const jar = cookieJar(); const ordinary = fixtureFetch();
  const transport = createEmailCodeTransport({ config, fetch: ordinary.fetcher, cookieDocument: jar });
  const controller = createEmailCodeAuthController({ contextUrl, transport });
  controller.beginCode("new@example.test"); await controller.verify("001234"); controller.dispose();
  const originalCookies = jar.cookie; const writes = jar.writes.length;
  const anonymous = fixtureFetch(() => reply({ ...user("new@example.test"), is_anonymous: true }));
  const recovery = createEmailCodeAuthController({ contextUrl, transport: createEmailCodeTransport({ config, fetch: anonymous.fetcher, cookieDocument: jar }) });
  recovery.beginCode("new@example.test");
  assert.equal(await recovery.checkSession(), "unknown");
  assert.equal(jar.cookie, originalCookies);
  assert.equal(jar.writes.length, writes);
  recovery.dispose();
});
