import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DemandTransaction, withDemandWorkerDb } from "@edison/db";
import { createDemandInvitation, listDemandInvitations, previewDemandInvitation, redeemDemandInvitation,
  resendDemandInvitation, revokeDemandInvitation, DEMAND_INVITATION_LEASE_MS, DEMAND_INVITATION_LIFETIME_MS } from "./demand-invitations";
import type { InvitationDeliveryResult, InvitationSender } from "./invitation-delivery";

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const owner = id(1), recipient = id(2), foreign = id(3);
type Row = { id: string; inviter_user_id: string; recipient_email: string; status: string; created_at: string; updated_at: string;
  expires_at: string; sent_at: string | null; redeemed_at: string | null; redeemed_by: string | null;
  delivery_attempts: number; delivery_lease_expires_at: string | null; last_error_code: string | null };
type Op = { id: string; actor: string; key: string; invitation_id: string; request_fingerprint: string; operation: string; receipt: { delivery: boolean }; createdAt: number };
const open = (row: Row, now: number) => ["pending", "sending", "sent"].includes(row.status) && Date.parse(row.expires_at) > now;
function fakeDatabase() {
  let clock = Date.parse("2026-09-07T18:00:00.000Z"), serial = 100;
  let state = { rows: new Map<string, Row>(), operations: new Map<string, Op>(), results: new Map<string, string>(), grants: new Set<string>(),
    members: new Map([[owner, { email: "member@example.test", status: "active", confirmed: true }],
      [recipient, { email: "reader@example.test", status: "pending", confirmed: true }],
      [foreign, { email: "other@example.test", status: "active", confirmed: true }]]) };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let queue = Promise.resolve();
  const transaction: typeof withDemandWorkerDb = async (callback) => {
    const operation = queue.then(async () => {
      const before = structuredClone(state);
      let admissionLocked = false;
      try { return await callback({ execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement); queries.push(query);
        const q = query.sql.replace(/\s+/g, " ").trim(), p = query.params as string[];
        if (q.startsWith("select pg_advisory_xact_lock")) {
          assert.match(q, /'edison-invitation-admission'/); admissionLocked = true; return [];
        }
        if (/^(insert into|update) private\.demand_invitation|^insert into private\.demand_invite_grants|^select count\(\*\)|^select private\.redeem_demand_invitation/.test(q)) {
          assert.equal(admissionLocked, true, "Every admission/capacity check and invitation mutation follows the shared transaction lock");
        }
        if (q.includes("private.demand_invite_grants")) assert.doesNotMatch(q, /for (?:no key update|update|key share|share)\b/i,
          "Immutable grants cannot require UPDATE privilege for row locking");
        if (q.startsWith("select * from private.demand_invitation_member")) return state.members.has(p[0]) ? [state.members.get(p[0])] : [];
        if (q.startsWith("insert into private.demand_invite_grants")) { state.grants.add(p[0]); return []; }
        if (q.startsWith("select o.invitation_id,o.request_fingerprint")) {
          const value = state.operations.get(`${p[0]}:${p[1]}`);
          return value ? [{ ...value, delivery: state.results.get(value.id) ?? (value.receipt.delivery ? "unknown" : "not_attempted") }] : [];
        }
        if (q.startsWith("insert into private.demand_invitation_operations")) {
          assert.ok(!state.operations.has(`${p[0]}:${p[1]}`));
          const operationId = id(serial++);
          state.operations.set(`${p[0]}:${p[1]}`, { id: operationId, actor: p[0], key: p[1], request_fingerprint: p[2], invitation_id: p[3], operation: p[4], receipt: JSON.parse(p[5]), createdAt: clock });
          return [{ id: operationId }];
        }
        if (q.startsWith("insert into private.demand_invitation_delivery_results")) {
          assert.ok([...state.operations.values()].some((op) => op.id === p[0]));
          assert.ok(["sent", "failed", "unknown", "not_attempted"].includes(p[1]));
          if (!state.results.has(p[0])) state.results.set(p[0], p[1]); return [];
        }
        if (q.startsWith("select count(*)::integer as operations")) {
          const rows = [...state.operations.values()].filter((op) => op.actor === p[0] && op.createdAt > clock - 86_400_000);
          return [{ operations: rows.length, deliveries: rows.filter((op) => op.receipt.delivery).length }];
        }
        if (q.startsWith("select count(*) filter(where status='redeemed')")) {
          const rows = [...state.rows.values()].filter((row) => row.inviter_user_id === p[1]);
          return [{ redeemed: rows.filter((row) => row.status === "redeemed").length, reserved: rows.filter((row) => open(row, Date.parse(p[0]))).length }];
        }
        if (q.startsWith("select * from private.demand_invitations where id=")) {
          const row = state.rows.get(p[0]); return row?.inviter_user_id === p[1] ? [structuredClone(row)] : [];
        }
        if (q.startsWith("select i.* from private.demand_invitations")) {
          const row = state.rows.get(p[0]); return row && ((q.includes("i.status='redeemed'")&&row.status==="redeemed")||state.members.get(row.inviter_user_id)?.status === "active") ? [structuredClone(row)] : [];
        }
        if (q.startsWith("select * from private.demand_invitations where inviter_user_id=")) {
          return [...state.rows.values()].filter((row) => row.inviter_user_id === p[0] &&
            (!q.includes("recipient_email=") || row.recipient_email === p[1] && ["pending", "sending", "sent"].includes(row.status)))
            .sort((a, b) => {
              const priority = (row: Row) => q.includes("order by case") && (row.status === "redeemed" || open(row, Date.parse(p[1]))) ? 0 : 1;
              return priority(a) - priority(b) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
            }).slice(0, 100).map((row) => structuredClone(row));
        }
        if (q.startsWith("insert into private.demand_invitations(")) {
          const row: Row = { id: p[0], inviter_user_id: p[1], recipient_email: p[2], status: "sending", expires_at: p[3], delivery_attempts: 1,
            delivery_lease_expires_at: p[4], created_at: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString(), sent_at: null,
            redeemed_at: null, redeemed_by: null, last_error_code: null };
          state.rows.set(row.id, row); return [structuredClone(row)];
        }
        if (q.startsWith("update private.demand_invitations set status='expired'")) {
          for (const row of state.rows.values()) if (row.inviter_user_id === p[1] && ["pending", "sending", "sent"].includes(row.status) && Date.parse(row.expires_at) <= Date.parse(p[2])) {
            Object.assign(row, { status: "expired", delivery_lease_expires_at: null, updated_at: p[0] });
          } return [];
        }
        if (q.startsWith("update private.demand_invitations set status='sending'")) {
          const row = state.rows.get(p[3])!; assert.equal(row.inviter_user_id, p[4]);
          Object.assign(row, { status: "sending", delivery_attempts: row.delivery_attempts + 1, delivery_lease_expires_at: p[0], expires_at: p[1], last_error_code: null, updated_at: p[2] });
          return [structuredClone(row)];
        }
        if (q.startsWith("update private.demand_invitations set status='revoked'")) {
          const row = state.rows.get(p[1])!; assert.equal(row.inviter_user_id, p[2]);
          Object.assign(row, { status: "revoked", delivery_lease_expires_at: null, updated_at: p[0] }); return [structuredClone(row)];
        }
        if (q.startsWith("update private.demand_invitations set status=$")) {
          const row = state.rows.get(p[5])!; assert.equal(row.inviter_user_id, p[6]);
          Object.assign(row, { status: p[0], sent_at: p[1], delivery_lease_expires_at: p[2], last_error_code: p[3], updated_at: p[4] }); return [structuredClone(row)];
        }
        if (q.startsWith("select private.redeem_demand_invitation")) {
          const row = state.rows.get(p[0]), member = state.members.get(p[1]);
          if (!row || !member?.confirmed || member.status === "revoked") return [{ admitted: false }];
          if (row.status === "redeemed") return [{ admitted: row.redeemed_by === p[1] && member.status === "active" }];
          if (!open(row, clock) || member.email !== row.recipient_email || state.members.get(row.inviter_user_id)?.status !== "active") return [{ admitted: false }];
          Object.assign(row, { status: "redeemed", redeemed_at: new Date(clock).toISOString(), redeemed_by: p[1], delivery_lease_expires_at: null });
          member.status = "active"; state.grants.add(p[1]); return [{ admitted: true }];
        }
        throw new Error(`Unhandled constructed database operation: ${q}`);
      } } as unknown as DemandTransaction); } catch (error) { state = before; throw error; }
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  };
  return { transaction, queries, now: () => new Date(clock), id: () => id(serial++), advance: (milliseconds: number) => { clock += milliseconds; },
    get rows() { return state.rows; }, get operations() { return state.operations; }, get results() { return state.results; },
    get grants() { return state.grants; }, get members() { return state.members; } };
}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const input = (email = "reader@example.test", key = "invitation-create") => ({ email, idempotencyKey: key });
const action = (key: string) => ({ idempotencyKey: key });

test("five slots are reserved before delivery across concurrent callers; the sixth cannot send", async () => {
  const db = fakeDatabase(); let calls = 0;
  const sender: InvitationSender = async () => { calls++; return { outcome: "sent" }; };
  const result = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => createDemandInvitation(owner, input(`reader${index}@example.test`, `create-${index}`), { ...db, sender })));
  assert.equal(result.filter((value) => value.status === "fulfilled").length, 5); assert.equal(calls, 5);
  assert.ok(result.some((value) => value.status === "rejected" && code("invitation_allowance_exhausted")(value.reason)));
  const list = await listDemandInvitations(owner, db); assert.deepEqual([list.limit, list.reserved, list.redeemed, list.remaining], [5, 5, 0, 0]);
  assert.equal(db.grants.size, 1);
  assert.match(db.queries[0].sql, /edison-invitation-admission/);
  assert.ok(db.queries.some((query) => /insert into private\.demand_invite_grants/.test(query.sql)));
  assert.equal(db.queries.some((query) => /demand_invite_grants[\s\S]*for (?:no key update|update|key share|share)\b/i.test(query.sql)), false);
});

test("same-key and same-email create recovery never sends a second email or reserves another slot", async () => {
  const db = fakeDatabase(); let calls = 0;
  const sender: InvitationSender = async () => { calls++; return { outcome: "unknown", code: "delivery_unknown" }; };
  const first = await createDemandInvitation(owner, input(), { ...db, sender });
  assert.equal(first.invitation.status, "sending"); assert.equal(first.delivery, "unknown");
  const replay = await createDemandInvitation(owner, input(), { ...db, sender });
  assert.equal(replay.replayed, true); assert.equal(replay.delivery, "unknown"); assert.equal(replay.invitation.id, first.invitation.id);
  const existing = await createDemandInvitation(owner, input("READER@example.test", "distinct-create"), { ...db, sender });
  assert.equal(existing.invitation.id, first.invitation.id); assert.equal(existing.delivery, "not_attempted");
  assert.equal((await createDemandInvitation(owner, input("reader@example.test", "distinct-create"), { ...db, sender })).delivery, "not_attempted");
  assert.equal(calls, 1); assert.equal((await listDemandInvitations(owner, db)).reserved, 1);
  await assert.rejects(createDemandInvitation(owner, input("other@example.test"), { ...db, sender }), code("idempotency_key_reused"));
  db.advance(DEMAND_INVITATION_LEASE_MS + 1);
  assert.equal((await listDemandInvitations(owner, db)).invitations[0].status, "pending");
  assert.equal(calls, 1, "GET cannot resume sending after a lease expires");
});

test("a lost post-send database result replays as unknown without sending again", async () => {
  const db = fakeDatabase(); let calls = 0, transactions = 0;
  const sender: InvitationSender = async () => { calls++; return { outcome: "sent" }; };
  const transaction: typeof withDemandWorkerDb = (callback) => {
    if (++transactions === 2) return Promise.reject(new Error("constructed result storage loss"));
    return db.transaction(callback);
  };
  await assert.rejects(createDemandInvitation(owner, input(), { ...db, transaction, sender }), /constructed result storage loss/);
  assert.equal(db.operations.size, 1); assert.equal(db.results.size, 0);
  const replay = await createDemandInvitation(owner, input(), { ...db, sender });
  assert.equal(replay.replayed, true); assert.equal(replay.delivery, "unknown"); assert.equal(calls, 1);
  assert.equal((await listDemandInvitations(owner, db)).reserved, 1);
});

test("definite initial failure releases a slot, but definite resend failure preserves an already valid invitation", async () => {
  const db = fakeDatabase(); let outcome: InvitationDeliveryResult = { outcome: "failed", code: "delivery_rejected" }, calls = 0;
  const sender: InvitationSender = async () => { calls++; return outcome; };
  const failed = await createDemandInvitation(owner, input(), { ...db, sender });
  assert.equal(failed.invitation.status, "failed"); assert.equal(failed.delivery, "failed"); assert.equal((await listDemandInvitations(owner, db)).remaining, 5);
  db.advance(60_001); outcome = { outcome: "sent" };
  await assert.rejects(resendDemandInvitation(owner, failed.invitation.id, action("failed-initial-resend"), { ...db, sender }), code("invitation_unavailable"));
  const sent = await createDemandInvitation(owner, input("reader@example.test", "new-after-failure"), { ...db, sender });
  assert.notEqual(sent.invitation.id, failed.invitation.id); assert.equal(sent.invitation.status, "sent"); assert.equal(sent.delivery, "sent");
  await assert.rejects(resendDemandInvitation(owner, sent.invitation.id, action("too-fast-resend"), { ...db, sender }), code("invitation_delivery_pending"));
  db.advance(60_001); outcome = { outcome: "failed", code: "delivery_rate_limited" };
  const preserved = await resendDemandInvitation(owner, sent.invitation.id, action("failed-resend"), { ...db, sender });
  assert.equal(preserved.invitation.status, "sent"); assert.equal(preserved.invitation.sentAt, sent.invitation.sentAt); assert.equal(preserved.delivery, "failed");
  assert.equal((await listDemandInvitations(owner, db)).reserved, 1);
  const replay = await resendDemandInvitation(owner, sent.invitation.id, action("failed-resend"), { ...db, sender });
  assert.equal(replay.replayed, true); assert.equal(replay.delivery, "failed");
  assert.equal(calls, 3);
  db.advance(60_001); outcome = { outcome: "sent" };
  await resendDemandInvitation(owner, sent.invitation.id, action("later-success"), { ...db, sender });
  assert.equal((await resendDemandInvitation(owner, sent.invitation.id, action("failed-resend"), { ...db, sender })).delivery, "failed",
    "a later success never rewrites the failed operation's receipt");
  assert.equal((await createDemandInvitation(owner, input(), { ...db, sender })).delivery, "failed");
  assert.equal(calls, 4);
});

test("uncertain sends retain the slot and only an explicit post-lease resend can send again", async () => {
  const db = fakeDatabase(); let calls = 0;
  const sender: InvitationSender = async () => { calls++; throw new Error("PRIVATE TRANSPORT DETAIL"); };
  const first = await createDemandInvitation(owner, input(), { ...db, sender });
  assert.equal((await listDemandInvitations(owner, db)).remaining, 4);
  db.advance(60_001);
  await assert.rejects(resendDemandInvitation(owner, first.invitation.id, action("busy-lease"), { ...db, sender }), code("invitation_delivery_pending"));
  db.advance(60_001);
  const next = await resendDemandInvitation(owner, first.invitation.id, action("resume-unknown"), { ...db, sender });
  assert.equal(next.invitation.id, first.invitation.id); assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(next), /PRIVATE|lease|last_error|attempts/);
});

test("revocation wins over a late delivery result and expired unaccepted invitations release capacity without GET writes", async () => {
  const db = fakeDatabase(); let release!: (result: InvitationDeliveryResult) => void;
  const sent = createDemandInvitation(owner, input(), { ...db, sender: () => new Promise((resolve) => { release = resolve; }) });
  for (let tries = 0; tries < 30 && !release; tries++) await new Promise((resolve) => setImmediate(resolve));
  const invitationId = [...db.rows.keys()][0]; assert.ok(invitationId && release);
  await revokeDemandInvitation(owner, invitationId, action("revoke-pending"), db);
  release({ outcome: "sent" }); const completed = await sent;
  assert.equal(completed.invitation.status, "revoked"); assert.equal(completed.delivery, "sent");
  await assert.rejects(resendDemandInvitation(owner, invitationId, action("revoked-resend"), db), code("invitation_unavailable"));
  const later = await createDemandInvitation(owner, input("second@example.test", "later-invite"), { ...db, sender: async () => ({ outcome: "sent" }) });
  db.advance(DEMAND_INVITATION_LIFETIME_MS + 1); const start = db.queries.length;
  const list = await listDemandInvitations(owner, db); assert.equal(list.remaining, 5);
  assert.equal(list.invitations.find((entry) => entry.id === later.invitation.id)?.status, "expired");
  assert.ok(db.queries.slice(start).every((query) => !/insert|update private|delete/i.test(query.sql)));
  await assert.rejects(resendDemandInvitation(owner, later.invitation.id, action("expired-resend"), db), code("invitation_unavailable"));
  const renewed = await createDemandInvitation(owner, input("second@example.test", "new-after-expiry"), { ...db, sender: async () => ({ outcome: "sent" }) });
  assert.notEqual(renewed.invitation.id, later.invitation.id);
  assert.equal(db.rows.get(later.invitation.id)?.status, "expired");
});

test("only verified matching recipients redeem once; revoked membership cannot replay or regain grants", async () => {
  const db = fakeDatabase(); const sent = await createDemandInvitation(owner, input(), { ...db, sender: async () => ({ outcome: "sent" }) });
  await assert.rejects(redeemDemandInvitation(foreign, sent.invitation.id, action("foreign-redeem"), db), code("invitation_unavailable"));
  db.members.get(recipient)!.confirmed = false;
  await assert.rejects(redeemDemandInvitation(recipient, sent.invitation.id, action("unconfirmed"), db), code("invitation_unavailable"));
  db.members.get(recipient)!.confirmed = true;
  const accepted = await redeemDemandInvitation(recipient, sent.invitation.id, action("accept-invite"), db);
  assert.equal(accepted.admitted, true); assert.equal(db.grants.has(recipient), true);
  assert.equal((await redeemDemandInvitation(recipient, sent.invitation.id, action("accept-invite"), db)).replayed, true);
  assert.equal((await listDemandInvitations(owner, db)).redeemed, 1);
  const tooLate = await revokeDemandInvitation(owner, sent.invitation.id, action("revoke-redeemed"), db);
  assert.equal(tooLate.invitation.status, "redeemed"); assert.equal(tooLate.delivery, "not_attempted");
  assert.equal((await listDemandInvitations(owner, db)).redeemed, 1);
  db.members.get(recipient)!.status = "revoked";
  await assert.rejects(redeemDemandInvitation(recipient, sent.invitation.id, action("accept-invite"), db), code("invitation_unavailable"));
  assert.equal(db.members.get(recipient)?.status, "revoked");
});

test("existing-member recipient follows the same delivery/redemption lifecycle without another initial grant", async () => {
  const db = fakeDatabase(); db.members.get(recipient)!.status = "active"; db.grants.add(recipient);
  const sent = await createDemandInvitation(owner, input(), { ...db, sender: async () => ({ outcome: "sent" }) });
  const before = db.grants.size;
  await redeemDemandInvitation(recipient, sent.invitation.id, action("member-accept"), db);
  assert.equal(db.grants.size, before); assert.equal((await listDemandInvitations(owner, db)).redeemed, 1);
  assert.equal((await listDemandInvitations(owner, db)).remaining, 4);
});

test("the bounded list keeps every reserved and redeemed invitation ahead of newer closed history", async () => {
  const db = fakeDatabase(); const sender: InvitationSender = async () => ({ outcome: "sent" });
  const accepted = await createDemandInvitation(owner, input(), { ...db, sender });
  await redeemDemandInvitation(recipient, accepted.invitation.id, action("history-accept"), db);
  const pending = await createDemandInvitation(owner, input("pending@example.test", "history-pending"), { ...db, sender });
  const template = db.rows.get(pending.invitation.id)!;
  for (let index = 0; index < 120; index++) db.rows.set(id(1_000 + index), { ...template, id: id(1_000 + index),
    recipient_email: `failed${index}@example.test`, status: "failed", created_at: new Date(db.now().getTime() + index + 1).toISOString() });
  const list = await listDemandInvitations(owner, db);
  assert.equal(list.invitations.length, 100);
  assert.deepEqual(new Set(list.invitations.slice(0, 2).map((invitation) => invitation.id)), new Set([accepted.invitation.id, pending.invitation.id]));
  assert.deepEqual([list.reserved, list.redeemed, list.remaining], [1, 1, 3]);
});

test("preview exposes only a masked recipient and deadline, never sends or changes membership", async () => {
  const db = fakeDatabase(); const sent = await createDemandInvitation(owner, input(), { ...db, sender: async () => ({ outcome: "sent" }) });
  const start = db.queries.length;
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id, db), { state: "available", maskedEmail: "r***@example.test", expiresAt: sent.invitation.expiresAt });
  assert.deepEqual(await previewDemandInvitation(id(999), db), { state: "unavailable" });
  assert.ok(db.queries.slice(start).every((query) => query.sql.trim().startsWith("select i.*")));
  assert.equal(db.members.get(recipient)?.status, "pending");
  db.advance(DEMAND_INVITATION_LIFETIME_MS + 1); assert.deepEqual(await previewDemandInvitation(sent.invitation.id, db), { state: "expired" });
  db.rows.get(sent.invitation.id)!.status = "revoked"; assert.deepEqual(await previewDemandInvitation(sent.invitation.id, db), { state: "unavailable" });
});

test("verified acceptance recovery and wrong-account preview are read-only and never expose another recipient",async()=>{
  const db=fakeDatabase();let sends=0;
  const sent=await createDemandInvitation(owner,input(),{...db,sender:async()=>{sends++;return {outcome:"sent"};}});
  const pendingState=structuredClone({rows:db.rows,operations:db.operations,grants:db.grants,members:db.members,results:db.results});
  assert.equal((await previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:recipient})).state,"available");
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:foreign}),{state:"wrong_account"});
  assert.deepEqual({rows:db.rows,operations:db.operations,grants:db.grants,members:db.members,results:db.results},pendingState);
  await redeemDemandInvitation(recipient,sent.invitation.id,action("preview-accept"),db);
  const start=db.queries.length,acceptedState=structuredClone({rows:db.rows,operations:db.operations,grants:db.grants,members:db.members,results:db.results});
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:recipient}),{state:"accepted"});
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:foreign}),{state:"unavailable"});
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id,db),{state:"unavailable"});
  assert.deepEqual({rows:db.rows,operations:db.operations,grants:db.grants,members:db.members,results:db.results},acceptedState);
  assert.ok(db.queries.slice(start).every(query=>query.sql.trim().startsWith("select")));assert.equal(sends,1);
  db.members.get(owner)!.status="revoked";
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:recipient}),{state:"accepted"},"later inviter revocation does not revoke a separately active admitted recipient");
  db.members.get(recipient)!.status="revoked";
  assert.deepEqual(await previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:recipient}),{state:"unavailable"});
  await assert.rejects(previewDemandInvitation(sent.invitation.id,{...db,verifiedUserId:"not-a-uuid"}));
});

test("invalid input, foreign owner and inactive inviter fail before any email; operations and sends are bounded", async () => {
  const db = fakeDatabase(); let calls = 0; const sender: InvitationSender = async () => { calls++; return { outcome: "sent" }; };
  for (const raw of [{ ...input(), status: "redeemed" }, input("javascript:bad"), { ...input(), idempotencyKey: "short" }]) {
    await assert.rejects(createDemandInvitation(owner, raw as ReturnType<typeof input>, { ...db, sender }));
  }
  assert.equal(db.queries.length, 0);
  const first = await createDemandInvitation(owner, input(), { ...db, sender });
  await assert.rejects(resendDemandInvitation(foreign, first.invitation.id, action("foreign-resend"), { ...db, sender }), code("invitation_unavailable"));
  db.members.get(owner)!.status = "revoked";
  await assert.rejects(createDemandInvitation(owner, input("other@example.test", "inactive-create"), { ...db, sender }), code("invitation_membership_required"));
  assert.equal(calls, 1);
  db.members.get(owner)!.status = "active";
  for (let index = 0; index < 20; index++) db.operations.set(`seed-${index}`, { id: id(900 + index), actor: owner, key: `seed-${index}`, invitation_id: first.invitation.id,
    request_fingerprint: "a".repeat(64), operation: "resend", receipt: { delivery: true }, createdAt: db.now().getTime() });
  await assert.rejects(createDemandInvitation(owner, input("new@example.test", "rate-limited"), { ...db, sender }), code("invitation_rate_limited"));
  assert.equal(calls, 1);
});
