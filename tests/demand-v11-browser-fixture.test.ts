import assert from "node:assert/strict";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { demandArticleResultSchema, demandInvitationMutationSchema, demandInvitationsSchema, demandLoopsSchema, demandWorkspaceSchema } from "@edison/contracts";
import { createV10Fixture, selfTestV10Fixture, selfTestV11Fixture, selfTestV11MemberFixture,
  LOCAL_MEMBER_FIXTURE, LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN, localMemberConfirmationPath } from "../scripts/demand-v10-browser-fixture";

const id = (number: number) => `10000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const auth = { "x-edison-demand-token": "f".repeat(64) };

function localSdk(fixture: ReturnType<typeof createV10Fixture>) {
  const cookies = new Map<string, string>(); const paths: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    assert.equal(url.origin, LOCAL_MEMBER_FIXTURE.origin, "the SDK must never contact a real Auth service");
    paths.push(url.pathname);
    const raw = request.method === "GET" ? "" : await request.text();
    const response = await fixture.handle(request.method, url.href, raw ? JSON.parse(raw) : {}, Object.fromEntries(request.headers));
    return Response.json(response.body, { status: response.status, headers: response.headers });
  };
  const client = () => createServerClient(LOCAL_MEMBER_FIXTURE.origin, LOCAL_MEMBER_FIXTURE.publishableKey, {
    global: { fetch: transport }, auth: { autoRefreshToken: false, detectSessionInUrl: false },
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (next) => { for (const cookie of next) { if (cookie.options.maxAge === 0) cookies.delete(cookie.name); else cookies.set(cookie.name, cookie.value); } } },
  });
  return { client, cookies, paths };
}

test("default v10 fixture keeps its existing offline self-test behavior", async () => {
  assert.equal((await selfTestV10Fixture()).passed, true);
});

test("opt-in v11 fixture exercises allowance, art, retention and reset recovery without real services", async () => {
  const result = await selfTestV11Fixture();
  assert.equal(result.passed, true);
  assert.equal(result.authProof, false);
  assert.deepEqual([result.authCalls, result.databaseCalls, result.providerCalls], [0, 0, 0]);
});

test("each final one-through-five batch reserves and settles only its accepted count", async () => {
  for (let count = 1; count <= 5; count++) {
    const fixture = createV10Fixture({ v11: true });
    const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
    const workspace = async () => demandWorkspaceSchema.parse(((await fixture.handle("GET", "/v1/demand/workspace", {}, auth)).body as { workspace: unknown }).workspace);
    await operator({ action: "reader", kind: "account" });
    await operator({ action: "allowance", remaining: count });
    const reply = await fixture.handle("POST", `/v1/demand/loops/${id(11)}/ideas`, { baseRevision: 0, idempotencyKey: `fixture-final-${count}` }, auth);
    assert.equal(reply.status, 202);
    assert.equal((await workspace()).allowance?.reserved, count);
    const requestId = (reply.body as { requestId: string }).requestId;
    await operator({ action: "complete", requestId });
    const completed = await workspace();
    assert.equal(completed.allowance?.remaining, 0);
    assert.equal(completed.ideas.filter((idea) => idea.batchRequestId === requestId).length, count);
    assert.equal(completed.loops.find((loop) => loop.id === id(11))?.currentBatchRequestId, requestId);
  }
});

test("constructed illustrated reading keeps its own topic rather than inheriting the ready sensor body", async () => {
  const fixture = createV10Fixture({ v11: true });
  const call = (method: string, path: string, body: unknown = {}) => fixture.handle(method, path, body, auth);
  const workspace = demandWorkspaceSchema.parse(((await call("GET", "/v1/demand/workspace")).body as { workspace: unknown }).workspace);
  const idea = workspace.ideas.find((candidate) => candidate.loopId === id(12))!;
  const reply = await call("POST", `/v1/demand/ideas/${idea.id}/article`, { idempotencyKey: "fixture-art-article" });
  const requestId = (reply.body as { requestId: string }).requestId;
  const completed = await fixture.handle("POST", "/__fixture/control", { action: "complete", requestId }, { "x-edison-fixture-operator": "local-only" });
  assert.equal(completed.status, 200);
  const reading = demandArticleResultSchema.parse((await call("GET", `/v1/demand/articles/${requestId}`)).body);
  assert.equal(reading.article.title, idea.title);
  assert.equal(reading.article.topic, "Synthetic Biology");
  assert.match(JSON.stringify(reading.article.body), /genetic instruction/);
  assert.doesNotMatch(JSON.stringify(reading.article.body), /light-sensitive|analog-to-digital/);
  assert.equal(reading.idea.art?.composition, "living-system");
  assert.equal(fixture.state().providerCalls, 0);
});

test("v11 loop-list and exact recovery expose the current replacement batch and retain archived loop context", async () => {
  const fixture = createV10Fixture({ v11: true });
  const call = (method: string, path: string, body: unknown = {}) => fixture.handle(method, path, body, auth);
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  const initial = demandLoopsSchema.parse((await call("GET", "/v1/demand/loops")).body);
  assert.equal(initial.loops.length, 8);
  assert.equal(initial.ideas.length, 48);
  await operator({ action: "reader", kind: "account" });
  const requested = await call("POST", `/v1/demand/loops/${id(11)}/ideas`, { baseRevision: 0, idempotencyKey: "fixture-loop-page" });
  const requestId = (requested.body as { requestId: string }).requestId;
  await operator({ action: "complete", requestId, count: 2 });
  const exact = demandLoopsSchema.parse((await call("GET", `/v1/demand/loops/${id(11)}`)).body);
  assert.equal(exact.ideas.length, 2);
  assert.ok(exact.ideas.every((idea) => idea.batchRequestId === requestId));
  assert.equal(exact.loops[0].currentBatchRequestId, requestId);
  await call("POST", `/v1/demand/loops/${id(11)}/archive`, { confirmed: true, baseRevision: 0, idempotencyKey: "fixture-loop-archive" });
  const active = demandLoopsSchema.parse((await call("GET", "/v1/demand/loops")).body);
  assert.equal(active.loops.some((loop) => loop.id === id(11)), false);
  assert.ok(demandLoopsSchema.parse((await call("GET", `/v1/demand/loops/${id(11)}`)).body).loops[0].archivedAt);
  assert.equal((await call("GET", "/v1/demand/loops?cursor=not-valid")).status, 400);
  assert.equal((await call("GET", "/v1/demand/loops?limit=500")).status, 400);
  assert.equal((await createV10Fixture().handle("GET", "/v1/demand/loops", {}, auth)).status, 404);
});

test("member mode is explicit, rejects external credentials, and never opens guest content", async () => {
  assert.equal((await selfTestV11MemberFixture()).passed, true);
  const fixture = createV10Fixture({ member: true });
  const sdk = { apikey: LOCAL_MEMBER_FIXTURE.publishableKey, authorization: `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}` };
  assert.equal((await fixture.handle("POST", "/auth/v1/verify", { token_hash: "a".repeat(64), type: "invite" }, sdk)).status, 403);
  assert.equal((await fixture.handle("POST", "/auth/v1/verify", { token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: "invite" }, { ...sdk, apikey: "sb_publishable_external" })).status, 401);
  assert.equal((await fixture.handle("POST", "/auth/v1/otp?redirect_to=https%3A%2F%2Fexternal.example%2Fauth%2Fconfirm", { email: LOCAL_MEMBER_FIXTURE.email, create_user: false }, sdk)).status, 401);
  assert.equal((await fixture.handle("GET", "https://external.example/v1/demand/access")).status, 403);
  assert.equal((await createV10Fixture({ v11: true }).handle("POST", "/auth/v1/verify", {}, sdk)).status, 404);
  assert.throws(() => localMemberConfirmationPath(false, "//external.example"));
  assert.throws(() => localMemberConfirmationPath(false, "/\\external.example"));
});

test("the installed Auth SDK writes and reads normal cookies through only the in-process synthetic protocol", async () => {
  const fixture = createV10Fixture({ member: true });
  const { client, cookies, paths } = localSdk(fixture);
  const first = client();
  const requested = await first.auth.signInWithOtp({ email: LOCAL_MEMBER_FIXTURE.email,
    options: { shouldCreateUser: false, emailRedirectTo: `http://127.0.0.1:3000/auth/confirm?next=%2Fdemand` } });
  assert.equal(requested.error, null);
  assert.equal((await first.auth.getSession()).data.session, null);
  const verified = await first.auth.verifyOtp({ token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: "email" });
  assert.equal(verified.error, null); assert.equal(verified.data.user?.email_confirmed_at, "2026-09-07T13:00:00.000Z");
  assert.ok([...cookies].some(([name, value]) => name.includes("auth-token") && value.startsWith("base64-")), "the SDK, not the fixture or browser test, writes the cookie");
  const reloaded = client();
  const session = (await reloaded.auth.getSession()).data.session;
  assert.equal(session?.access_token, LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN);
  assert.equal((await reloaded.auth.getUser()).data.user?.id, LOCAL_MEMBER_FIXTURE.userId);
  assert.equal((await reloaded.auth.getClaims()).data?.claims.sub, LOCAL_MEMBER_FIXTURE.userId);
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, { authorization: `Bearer ${session!.access_token}` })).status, 200);
  assert.ok(paths.includes("/auth/v1/otp") && paths.includes("/auth/v1/verify") && paths.includes("/auth/v1/user"));
  assert.equal((await reloaded.auth.signOut()).error, null);
  assert.equal((await client().auth.getSession()).data.session, null);
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, { authorization: `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}` })).status, 401);
  assert.equal(fixture.state().authProof, false); assert.equal(fixture.state().authCalls, 0);
});

async function memberFixture() {
  const fixture = createV10Fixture({ member: true });
  const bearer = { authorization: `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}` };
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  const call = (method: string, path: string, body: unknown = {}) => fixture.handle(method, path, body, bearer);
  await fixture.handle("POST", "/auth/v1/verify", { token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: "invite" },
    { apikey: LOCAL_MEMBER_FIXTURE.publishableKey, authorization: `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}` });
  return { fixture, call, operator, list: async () => demandInvitationsSchema.parse((await call("GET", "/v1/demand/invitations")).body) };
}

test("constructed invitation receipts retain sent/failure/unknown truth and exact replay without fake emails", async () => {
  const { fixture, call, operator, list } = await memberFixture(); const path = "/v1/demand/invitations";
  const input = { email: "friend@example.test", idempotencyKey: "constructed-create" };
  assert.equal((await list()).remaining, 5);
  await operator({ action: "fault", mode: "lose-response", path });
  const lost = await call("POST", path, input); assert.equal(lost.loseResponse, true);
  const sent = demandInvitationMutationSchema.parse((await call("POST", path, input)).body);
  assert.equal(sent.delivery, "sent"); assert.equal(sent.replayed, true); assert.equal((await list()).remaining, 4);
  const same = demandInvitationMutationSchema.parse((await call("POST", path, { ...input, idempotencyKey: "constructed-same-email" })).body);
  assert.equal(same.delivery, "not_attempted"); assert.equal(same.invitation.id, sent.invitation.id);
  const resend = `${path}/${sent.invitation.id}/resend`;
  assert.equal((await call("POST", resend, { idempotencyKey: "constructed-too-early" })).status, 409);
  await operator({ action: "invitation-advance", seconds: 61 });
  await operator({ action: "invitation-delivery", outcome: "failed" });
  const failed = demandInvitationMutationSchema.parse((await call("POST", resend, { idempotencyKey: "constructed-resend-failed" })).body);
  assert.equal(failed.delivery, "failed"); assert.equal(failed.invitation.status, "sent"); assert.equal((await list()).remaining, 4);
  await operator({ action: "invitation-advance", seconds: 61 });
  await operator({ action: "invitation-delivery", outcome: "unknown" });
  const unknown = demandInvitationMutationSchema.parse((await call("POST", resend, { idempotencyKey: "constructed-resend-unknown" })).body);
  assert.equal(unknown.delivery, "unknown"); assert.equal(unknown.invitation.status, "sending");
  await operator({ action: "invitation-advance", seconds: 121 });
  assert.equal((await list()).invitations[0].status, "pending");
  assert.equal(demandInvitationMutationSchema.parse((await call("POST", resend, { idempotencyKey: "constructed-resend-failed" })).body).delivery, "failed");
  await operator({ action: "invitation-delivery", outcome: "failed" });
  const initialFailure = demandInvitationMutationSchema.parse((await call("POST", path, { email: "another@example.test", idempotencyKey: "constructed-initial-failed" })).body);
  assert.equal(initialFailure.invitation.status, "failed"); assert.equal((await list()).remaining, 4);
  assert.deepEqual([fixture.state().providerCalls, fixture.state().databaseCalls, fixture.state().authCalls], [0, 0, 0]);
});

test("synthetic acceptance gates pending membership, preserves existing five, and exposes only masked preview", async () => {
  const { fixture, call, operator, list } = await memberFixture();
  const invitationPath = `/v1/demand/invitations/${LOCAL_MEMBER_FIXTURE.invitationId}`;
  const before = fixture.state().syntheticAuthRequests?.verify;
  assert.deepEqual((await fixture.handle("GET", `${invitationPath}/preview`)).body,
    { state: "available", maskedEmail: "m***@example.test", expiresAt: "2026-09-14T13:00:00.000Z" });
  assert.equal(fixture.state().syntheticAuthRequests?.verify, before);
  await operator({ action: "member", status: "pending" });
  assert.equal((await call("GET", "/v1/demand/access")).status, 403);
  assert.equal((await call("POST", "/v1/demand/session")).status, 403);
  const input = { idempotencyKey: "constructed-accept" };
  assert.equal((await call("POST", `${invitationPath}/redeem`, input)).status, 200);
  assert.equal((await call("GET", "/v1/demand/access")).status, 200); assert.equal((await list()).remaining, 5);
  assert.equal(((await call("POST", `${invitationPath}/redeem`, input)).body as { replayed: boolean }).replayed, true);
  await operator({ action: "invitation-seed", count: 5, status: "sent" });
  assert.equal((await list()).remaining, 0);
  const own = (await list()).invitations[0];
  await operator({ action: "invitation-state", id: own.id, status: "redeemed" });
  const revoke = demandInvitationMutationSchema.parse((await call("POST", `/v1/demand/invitations/${own.id}/revoke`, { idempotencyKey: "constructed-revoke-accepted" })).body);
  assert.equal(revoke.invitation.status, "redeemed"); assert.equal((await list()).remaining, 0);
  await operator({ action: "invitation-state", id: LOCAL_MEMBER_FIXTURE.invitationId, status: "expired" });
  assert.deepEqual((await fixture.handle("GET", `${invitationPath}/preview`)).body, { state: "expired" });
  await operator({ action: "invitation-state", id: LOCAL_MEMBER_FIXTURE.invitationId, status: "revoked" });
  assert.deepEqual((await fixture.handle("GET", `${invitationPath}/preview`)).body, { state: "unavailable" });
  await operator({ action: "member", status: "revoked" });
  assert.equal((await call("POST", `${invitationPath}/redeem`, input)).status, 403);
});

test("invitation previews reveal accepted or wrong-account state only to the exact verified synthetic viewer", async () => {
  const { fixture, call, operator } = await memberFixture();
  const incoming = `/v1/demand/invitations/${LOCAL_MEMBER_FIXTURE.invitationId}`;
  const created = demandInvitationMutationSchema.parse((await call("POST", "/v1/demand/invitations",
    { email: "friend@example.test", idempotencyKey: "preview-other-recipient" })).body);
  const outgoing = `/v1/demand/invitations/${created.invitation.id}`;
  const before = fixture.state();
  assert.deepEqual((await call("GET", `${outgoing}/preview`)).body, { state: "wrong_account" });
  assert.deepEqual((await fixture.handle("GET", `${outgoing}/preview`)).body,
    { state: "available", maskedEmail: "f***@example.test", expiresAt: created.invitation.expiresAt });
  assert.deepEqual((await fixture.handle("GET", `${incoming}/preview`, { verifiedUserId: LOCAL_MEMBER_FIXTURE.userId })).body,
    { state: "available", maskedEmail: "m***@example.test", expiresAt: "2026-09-14T13:00:00.000Z" });
  for (const token of ["external-real-looking-jwt", LOCAL_MEMBER_FIXTURE.publishableKey]) {
    assert.equal((await fixture.handle("GET", `${incoming}/preview`, {}, { authorization: `Bearer ${token}` })).status, 401);
  }
  assert.deepEqual(fixture.state().syntheticAuthRequests, before.syntheticAuthRequests);
  assert.deepEqual(fixture.state().invitations, before.invitations);
  assert.equal(fixture.state().syntheticMember?.status, before.syntheticMember?.status);
  await call("POST", `${incoming}/redeem`, { idempotencyKey: "preview-accept" });
  assert.deepEqual((await call("GET", `${incoming}/preview`)).body, { state: "accepted" });
  assert.deepEqual((await fixture.handle("GET", `${incoming}/preview`)).body, { state: "unavailable" });
  await operator({ action: "invitation-state", id: created.invitation.id, status: "redeemed" });
  assert.deepEqual((await call("GET", `${outgoing}/preview`)).body, { state: "unavailable" });
  for (const status of ["pending", "revoked"]) {
    await operator({ action: "member", status });
    assert.deepEqual((await call("GET", `${incoming}/preview`)).body, { state: "unavailable" });
  }
  await operator({ action: "member", status: "active" });
  await operator({ action: "invitation-state", id: created.invitation.id, status: "expired" });
  assert.deepEqual((await call("GET", `${outgoing}/preview`)).body, { state: "expired" });
  await fixture.handle("POST", "/auth/v1/logout", {}, { apikey: LOCAL_MEMBER_FIXTURE.publishableKey,
    authorization: `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}` });
  assert.equal((await call("GET", `${incoming}/preview`)).status, 401);
  assert.deepEqual((await fixture.handle("GET", `${incoming}/preview`)).body, { state: "unavailable" });
});

test("verified member handoff tolerates only the exact old synthetic guest cookie and returns no new guest token", async () => {
  const { fixture } = await memberFixture();
  const bearer = { authorization: `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}` };
  const reply = await fixture.handle("POST", "/v1/demand/session", {}, { ...bearer, ...auth });
  assert.equal(reply.status, 200);
  assert.equal((reply.body as { newGuestToken?: string }).newGuestToken, undefined);
  assert.equal(demandWorkspaceSchema.parse((reply.body as { workspace: unknown }).workspace).readerKind, "account");
  assert.equal((await fixture.handle("GET", "/v1/demand/workspace", {}, { ...bearer, ...auth })).status, 200);
  assert.equal((await fixture.handle("POST", "/v1/demand/session", {}, auth)).status, 401);
  assert.equal((await fixture.handle("POST", "/v1/demand/session", {}, { ...bearer, "x-edison-demand-token": "external-token" })).status, 401);
});

test("expired Auth links renew unconfirmed users through SDK signup resend without changing the Edison invitation or its slot", async () => {
  const fixture = createV10Fixture({ member: true });
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  await operator({ action: "member", status: "pending" });
  await operator({ action: "auth-user", confirmed: false });
  await operator({ action: "auth-link", status: "expired" });
  const { client, cookies, paths } = localSdk(fixture); const sdk = client();
  const incoming = `/v1/demand/invitations/${LOCAL_MEMBER_FIXTURE.invitationId}`;
  const before = fixture.state();
  const preview = (await fixture.handle("GET", `${incoming}/preview`)).body;
  assert.equal((await sdk.auth.verifyOtp({ token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: "invite" })).error?.code, "otp_expired");
  assert.deepEqual((await fixture.handle("GET", `${incoming}/preview`)).body, preview);
  const callback = new URL("http://127.0.0.1:3000/auth/confirm");
  callback.searchParams.set("next", `/demand/articles/${id(21)}?from=invitation`);
  callback.searchParams.set("invitation", LOCAL_MEMBER_FIXTURE.invitationId);
  const requested = await sdk.auth.signInWithOtp({ email: LOCAL_MEMBER_FIXTURE.email,
    options: { shouldCreateUser: false, emailRedirectTo: callback.href } });
  assert.equal(requested.error?.code, "signup_disabled"); assert.equal(requested.error?.status, 422);
  assert.equal(fixture.state().latestAuthLink, null);
  assert.equal((await sdk.auth.getSession()).data.session, null);
  const renewed = await sdk.auth.resend({ type: "signup", email: LOCAL_MEMBER_FIXTURE.email,
    options: { emailRedirectTo: callback.href } });
  assert.equal(renewed.error, null);
  const issued = fixture.state().latestAuthLink!; const link = new URL(issued.url);
  assert.equal(issued.template, "confirmation");
  assert.equal(issued.tokenHash, `pkce_${LOCAL_MEMBER_FIXTURE.renewedTokenHash}`);
  assert.equal(link.searchParams.get("token_hash"), issued.tokenHash); assert.equal(link.searchParams.get("type"), "email");
  assert.equal(link.searchParams.get("invitation"), LOCAL_MEMBER_FIXTURE.invitationId);
  assert.equal(link.searchParams.get("next"), callback.searchParams.get("next"));
  assert.deepEqual(fixture.state().invitations, before.invitations);
  assert.deepEqual(fixture.state().allowance, before.allowance);
  assert.deepEqual((await fixture.handle("GET", `${incoming}/preview`)).body, preview);
  assert.equal(fixture.state().syntheticMember?.emailConfirmed, false);
  assert.equal(fixture.state().syntheticMember?.status, "pending");
  assert.equal((await client().auth.getSession()).data.session, null);
  const verified = await sdk.auth.verifyOtp({ token_hash: issued.tokenHash, type: "email" });
  assert.equal(verified.error, null);
  assert.ok([...cookies.keys()].some((name) => name.includes("auth-token")));
  const reloaded = client();
  assert.equal((await reloaded.auth.getUser()).data.user?.email, LOCAL_MEMBER_FIXTURE.email);
  const session = (await reloaded.auth.getSession()).data.session;
  const bearer = { authorization: `Bearer ${session!.access_token}` };
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 403, "Auth confirmation alone does not redeem Edison membership");
  assert.equal((await fixture.handle("POST", `${incoming}/redeem`, { idempotencyKey: "renew-same-invitation" }, bearer)).status, 200);
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 200);
  assert.deepEqual((await fixture.handle("GET", `${incoming}/preview`, {}, bearer)).body, { state: "accepted" });
  assert.equal(fixture.state().invitations?.remaining, 5);
  assert.deepEqual(fixture.state().allowance, before.allowance);
  assert.deepEqual([fixture.state().syntheticAuthRequests?.otp, fixture.state().syntheticAuthRequests?.resend], [1, 1]);
  assert.ok(paths.includes("/auth/v1/resend"));
  assert.equal((await sdk.auth.verifyOtp({ token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: "invite" })).error?.code, "otp_expired");
  assert.deepEqual([fixture.state().authProof, fixture.state().authCalls, fixture.state().databaseCalls, fixture.state().providerCalls], [false, 0, 0, 0]);
});

test("synthetic renewal failures and absent or confirmed signup resends never invent successful delivery", async () => {
  const fixture = createV10Fixture({ member: true });
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  const { client } = localSdk(fixture); const sdk = client();
  const options = { emailRedirectTo: `http://127.0.0.1:3000/auth/confirm?invitation=${LOCAL_MEMBER_FIXTURE.invitationId}&next=%2Fdemand` };
  assert.equal((await sdk.auth.resend({ type: "signup", email: LOCAL_MEMBER_FIXTURE.email, options })).error, null);
  assert.equal((await sdk.auth.resend({ type: "signup", email: LOCAL_MEMBER_FIXTURE.absentEmail, options })).error, null);
  assert.equal((await sdk.auth.signInWithOtp({ email: LOCAL_MEMBER_FIXTURE.absentEmail, options: { ...options, shouldCreateUser: false } })).error?.code, "otp_disabled");
  assert.equal(fixture.state().latestAuthLink, null);
  await operator({ action: "auth-user", confirmed: false });
  for (const path of ["otp", "resend"]) {
    for (const mode of ["rate-limited", "unknown"]) {
      await operator({ action: "auth-fault", path, mode });
      const result = path === "otp" ? await sdk.auth.signInWithOtp({ email: LOCAL_MEMBER_FIXTURE.email, options: { ...options, shouldCreateUser: false } })
        : await sdk.auth.resend({ type: "signup", email: LOCAL_MEMBER_FIXTURE.email, options });
      assert.equal(result.error?.status, mode === "rate-limited" ? 429 : 500);
      assert.equal(result.error?.code, mode === "rate-limited" ? "over_email_send_rate_limit" : undefined);
      if (mode === "unknown") assert.equal(result.error?.name, "AuthRetryableFetchError");
      assert.equal(fixture.state().latestAuthLink, null);
      assert.equal(fixture.state().authFault, null);
      assert.equal(fixture.state().syntheticMember?.sessionActive, false);
    }
  }
  const headers = { apikey: LOCAL_MEMBER_FIXTURE.publishableKey, authorization: `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}` };
  assert.equal((await fixture.handle("POST", "/auth/v1/resend", { email: "real-person@example.com", type: "signup" }, headers)).status, 400);
  assert.equal((await fixture.handle("POST", "/auth/v1/resend", { email: LOCAL_MEMBER_FIXTURE.email, type: "invite" }, headers)).status, 400);
  for (const callback of ["https://external.example/auth/confirm", "http://127.0.0.1:3000/auth/confirm?next=%2F%2Fexternal.example",
    "http://127.0.0.1:3000/auth/confirm?invitation=not-a-uuid", "http://127.0.0.1:3000/auth/confirm?next=%2Fdemand&next=%2Fother"]) {
    assert.equal((await fixture.handle("POST", `/auth/v1/resend?redirect_to=${encodeURIComponent(callback)}`,
      { email: LOCAL_MEMBER_FIXTURE.email, type: "signup" }, headers)).status, 401);
  }
  assert.equal(fixture.state().latestAuthLink, null);
  assert.deepEqual([fixture.state().authCalls, fixture.state().databaseCalls, fixture.state().providerCalls], [0, 0, 0]);
});
