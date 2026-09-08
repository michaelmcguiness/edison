import assert from "node:assert/strict";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { demandArticleResultSchema, demandInvitationMutationSchema, demandInvitationsSchema, demandLoopsSchema, demandWorkspaceSchema } from "@edison/contracts";
import { createV10Fixture, selfTestV10Fixture, selfTestV11Fixture, selfTestV11MemberFixture,
  LOCAL_MEMBER_FIXTURE, LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN, localMemberConfirmationPath } from "../scripts/demand-v10-browser-fixture";

const id = (number: number) => `10000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const auth = { "x-edison-demand-token": "f".repeat(64) };

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
  const cookies = new Map<string, string>(); const paths: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    assert.equal(url.origin, LOCAL_MEMBER_FIXTURE.origin, "the SDK must never contact a real Auth service");
    paths.push(url.pathname);
    const raw = request.method === "GET" ? "" : await request.text();
    const response = await fixture.handle(request.method, url.href, raw ? JSON.parse(raw) : {}, Object.fromEntries(request.headers));
    return Response.json(response.body, { status: response.status });
  };
  const client = () => createServerClient(LOCAL_MEMBER_FIXTURE.origin, LOCAL_MEMBER_FIXTURE.publishableKey, {
    global: { fetch: transport }, auth: { autoRefreshToken: false, detectSessionInUrl: false },
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (next) => { for (const cookie of next) { if (cookie.options.maxAge === 0) cookies.delete(cookie.name); else cookies.set(cookie.name, cookie.value); } } },
  });
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
