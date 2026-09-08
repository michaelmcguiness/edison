import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withDemandWorkerDb, type DemandTransaction } from "@edison/db";
import { uuidSchema } from "@edison/contracts";
import {
  createDemandInvitationSchema, demandInvitationActionSchema, demandInvitationMutationSchema,
  demandInvitationRedemptionSchema, demandInvitationsSchema, demandInvitationSchema,
  type CreateDemandInvitation, type DemandInvitationAction, type DemandInvitation, type DemandInvitationMutation,
} from "../../../../packages/contracts/src/demand-invitations";
import { HttpError } from "../http/errors";
import { deliverDemandInvitation, type InvitationDeliveryResult, type InvitationSender } from "./invitation-delivery";

export const DEMAND_INVITATION_COOLDOWN_MS = 60_000;
export const DEMAND_INVITATION_LEASE_MS = 120_000;
export const DEMAND_INVITATION_LIFETIME_MS = 7 * 86_400_000;
export const DEMAND_INVITATION_SENDS_PER_DAY = 20;
export const DEMAND_INVITATION_OPERATIONS_PER_DAY = 100;
type Dependencies = { transaction?: typeof withDemandWorkerDb; sender?: InvitationSender; now?: () => Date; id?: () => string };
type Row = { id: string; inviter_user_id: string; recipient_email: string; status: DemandInvitation["status"];
  created_at: Date | string; updated_at: Date | string; expires_at: Date | string; sent_at: Date | string | null;
  redeemed_at: Date | string | null; redeemed_by: string | null; delivery_attempts: number;
  delivery_lease_expires_at: Date | string | null; last_error_code: string | null };
type Operation = "create" | "resend" | "revoke" | "redeem";
type DeliveryOutcome = "sent" | "failed" | "unknown" | "not_attempted";
type Prepared = { row: Row; replayed: boolean; delivery: DeliveryOutcome;
  send?: { operationId: string; attempt: number; lease: string; restore: "pending" | "sent" | null } };
const open = (status: Row["status"]) => ["pending", "sending", "sent"].includes(status);
const iso = (value: Date | string) => new Date(value).toISOString();
const time = (value: Date | string) => new Date(value).getTime();
const unavailable = () => new HttpError(404, "invitation_unavailable", "That invitation is no longer available.");
function effectiveStatus(row: Row, now: Date): Row["status"] {
  if (open(row.status) && time(row.expires_at) <= now.getTime()) return "expired";
  // An expired sending lease is an uncertain pending invitation, not proof of
  // failure. It still reserves its slot and requires an explicit resend.
  if (row.status === "sending" && row.delivery_lease_expires_at && time(row.delivery_lease_expires_at) <= now.getTime()) return "pending";
  return row.status;
}
function dto(row: Row, now: Date): DemandInvitation {
  return demandInvitationSchema.parse({ id: row.id, email: row.recipient_email, status: effectiveStatus(row, now),
    createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), sentAt: row.sent_at ? iso(row.sent_at) : null,
    redeemedAt: row.redeemed_at ? iso(row.redeemed_at) : null });
}
function mutation(row: Row, replayed: boolean, delivery: DeliveryOutcome, now: Date) {
  return demandInvitationMutationSchema.parse({ invitation: dto(row, now), replayed, delivery });
}
function fingerprint(operation: Operation, value: unknown) { return createHash("sha256").update(JSON.stringify([operation, value])).digest("hex"); }
async function globalLock(tx: DemandTransaction) { await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-invitation-admission',0))`); }
async function actorLock(tx: DemandTransaction, actor: string, createGrant = false, requireActive = true) {
  await globalLock(tx);
  if (requireActive) {
    const [member] = await tx.execute<{ status: string }>(sql`select * from private.demand_invitation_member(${actor}::uuid)`);
    if (member?.status !== "active") throw new HttpError(403, "invitation_membership_required", "An active Edison membership is required.");
  }
  if (createGrant) await tx.execute(sql`insert into private.demand_invite_grants(user_id) values(${actor}::uuid) on conflict(user_id) do nothing`);
  // The shared transaction advisory lock already serializes grant creation and
  // every capacity mutation, including SQL redemption. Immutable grants have
  // SELECT/INSERT permission only; row locking would require UPDATE permission.
}
async function owned(tx: DemandTransaction, actor: string, id: string) {
  const [row] = await tx.execute<Row>(sql`select * from private.demand_invitations where id=${id}::uuid and inviter_user_id=${actor}::uuid for update`);
  if (!row) throw unavailable(); return row;
}
async function replay(tx: DemandTransaction, actor: string, key: string, hash: string) {
  const [operation] = await tx.execute<{ invitation_id: string; request_fingerprint: string; delivery: DeliveryOutcome }>(sql`
    select o.invitation_id,o.request_fingerprint,
      coalesce(r.outcome,case when o.receipt->>'delivery'='true' then 'unknown' else 'not_attempted' end) as delivery
    from private.demand_invitation_operations o left join private.demand_invitation_delivery_results r on r.operation_id=o.id
    where o.actor_user_id=${actor}::uuid and o.idempotency_key=${key}`);
  if (operation && operation.request_fingerprint !== hash) throw new HttpError(409, "idempotency_key_reused", "That invitation request identity was already used for different input.");
  return operation;
}
async function record(tx: DemandTransaction, actor: string, key: string, hash: string, invitationId: string, operation: Operation, delivery: boolean) {
  const receipt = JSON.stringify({ invitationId, delivery });
  const [created] = await tx.execute<{ id: string }>(sql`insert into private.demand_invitation_operations(actor_user_id,idempotency_key,request_fingerprint,invitation_id,operation,receipt)
    values(${actor}::uuid,${key},${hash},${invitationId}::uuid,${operation},${receipt}::jsonb) returning id`);
  if (!created) throw new Error("invitation_operation_not_recorded");
  if (!delivery) await recordDelivery(tx, created.id, "not_attempted");
  return created.id;
}
async function recordDelivery(tx: DemandTransaction, operationId: string, outcome: DeliveryOutcome) {
  // Separate append-only result: the immutable admission receipt is never
  // rewritten, and a later resend cannot change an earlier operation's result.
  await tx.execute(sql`insert into private.demand_invitation_delivery_results(operation_id,outcome)
    values(${operationId}::uuid,${outcome}) on conflict(operation_id) do nothing`);
}
async function rates(tx: DemandTransaction, actor: string, sending: boolean) {
  const [counts] = await tx.execute<{ operations: number; deliveries: number }>(sql`
    select count(*)::integer as operations,count(*) filter(where receipt->>'delivery'='true')::integer as deliveries
    from private.demand_invitation_operations where actor_user_id=${actor}::uuid and created_at>statement_timestamp()-interval '24 hours'`);
  if (!counts || counts.operations >= DEMAND_INVITATION_OPERATIONS_PER_DAY || (sending && counts.deliveries >= DEMAND_INVITATION_SENDS_PER_DAY)) {
    throw new HttpError(429, "invitation_rate_limited", "Please wait before sending another invitation.");
  }
}
async function capacity(tx: DemandTransaction, actor: string, now: Date) {
  const [counts] = await tx.execute<{ redeemed: number; reserved: number }>(sql`
    select count(*) filter(where status='redeemed')::integer as redeemed,
      count(*) filter(where status in('pending','sending','sent') and expires_at>${now.toISOString()}::timestamptz)::integer as reserved
    from private.demand_invitations where inviter_user_id=${actor}::uuid`);
  if (!counts || !Number.isSafeInteger(counts.redeemed) || !Number.isSafeInteger(counts.reserved) || counts.redeemed < 0 || counts.reserved < 0) throw new Error("invitation_counts_invalid");
  return counts;
}
async function availableSlot(tx: DemandTransaction, actor: string, now: Date) {
  const counts = await capacity(tx, actor, now);
  if (counts.redeemed + counts.reserved >= 5) throw new HttpError(429, "invitation_allowance_exhausted", "Your five invitations are already used or awaiting acceptance.");
}

/** Read-only listing: deadlines affect the projection/count, not a background
 * email job. Initial grants are inserted only by create or invitation redeem. */
export async function listDemandInvitations(actorUserId: string, dependencies: Dependencies = {}) {
  const actor = uuidSchema.parse(actorUserId); const now = (dependencies.now ?? (() => new Date()))();
  return (dependencies.transaction ?? withDemandWorkerDb)(async (tx) => {
    await actorLock(tx, actor);
    const counts = await capacity(tx, actor, now);
    const rows = await tx.execute<Row>(sql`select * from private.demand_invitations where inviter_user_id=${actor}::uuid
      order by case when status='redeemed' or (status in('pending','sending','sent') and expires_at>${now.toISOString()}::timestamptz)
        then 0 else 1 end,created_at desc,id desc limit 100`);
    return demandInvitationsSchema.parse({ limit: 5, ...counts, remaining: 5 - counts.redeemed - counts.reserved, invitations: rows.map((row) => dto(row, now)) });
  });
}

/** Opaque possession lookup only. No token verification, membership admission,
 * grant, send, or mutation. The recipient email is never returned in full. */
export async function previewDemandInvitation(invitationId: string, dependencies: Pick<Dependencies, "transaction" | "now"> & {verifiedUserId?:string} = {}): Promise<{
  state: "available" | "expired" | "unavailable" | "accepted" | "wrong_account"; maskedEmail?: string; expiresAt?: string;
}> {
  const id = uuidSchema.parse(invitationId); const now = (dependencies.now ?? (() => new Date()))();
  // This subject must come from verified server auth, never URL/body input.
  const viewer=dependencies.verifiedUserId===undefined?null:uuidSchema.parse(dependencies.verifiedUserId);
  return (dependencies.transaction ?? withDemandWorkerDb)(async (tx) => {
    const [row] = await tx.execute<Row>(sql`select i.* from private.demand_invitations i
      where i.id=${id}::uuid and (i.status='redeemed' or exists(select 1 from private.demand_invitation_member(i.inviter_user_id) m where m.status='active'))`);
    if (!row || ["failed", "revoked"].includes(row.status)) return { state: "unavailable" };
    if(row.status==="redeemed") {
      if(!viewer||row.redeemed_by!==viewer)return {state:"unavailable"};
      const [member]=await tx.execute<{email:string;status:string}>(sql`select * from private.demand_invitation_member(${viewer}::uuid)`);
      return {state:member?.status==="active"?"accepted":"unavailable"};
    }
    if (effectiveStatus(row, now) === "expired") return { state: "expired" };
    if(viewer) {
      const [member]=await tx.execute<{email:string;status:string}>(sql`select * from private.demand_invitation_member(${viewer}::uuid)`);
      if(member?.email&&member.email.toLowerCase()!==row.recipient_email)return {state:"wrong_account"};
    }
    const [local, domain] = row.recipient_email.split("@");
    if (!local || !domain) return { state: "unavailable" };
    return { state: "available", maskedEmail: `${local[0]}***@${domain}`, expiresAt: iso(row.expires_at) };
  });
}

async function finishDelivery(actor: string, prepared: Prepared, dependencies: Dependencies): Promise<DemandInvitationMutation> {
  if (!prepared.send) return mutation(prepared.row, prepared.replayed, prepared.delivery, (dependencies.now ?? (() => new Date()))());
  let delivery: InvitationDeliveryResult;
  try { delivery = await (dependencies.sender ?? deliverDemandInvitation)({ invitationId: prepared.row.id, email: prepared.row.recipient_email }); }
  catch { delivery = { outcome: "unknown", code: "delivery_unknown" }; }
  const now = (dependencies.now ?? (() => new Date()))();
  return (dependencies.transaction ?? withDemandWorkerDb)(async (tx) => {
    // Retain the send outcome after a membership change without authorizing any
    // new work. Revocation/redemption or a newer send lease always wins.
    await actorLock(tx, actor, false, false);
    let row = await owned(tx, actor, prepared.row.id);
    if (row.status === "sending" && row.delivery_attempts === prepared.send!.attempt && row.delivery_lease_expires_at && iso(row.delivery_lease_expires_at) === prepared.send!.lease) {
      const status = delivery.outcome === "sent" ? "sent" : delivery.outcome === "failed" ? prepared.send!.restore ?? "failed" : "sending";
      const sentAt = delivery.outcome === "sent" ? now.toISOString() : row.sent_at ? iso(row.sent_at) : null;
      const lease = delivery.outcome === "unknown" ? prepared.send!.lease : null;
      const code = delivery.outcome === "sent" ? null : delivery.code;
      const [updated] = await tx.execute<Row>(sql`update private.demand_invitations set status=${status},sent_at=${sentAt}::timestamptz,
        delivery_lease_expires_at=${lease}::timestamptz,last_error_code=${code},updated_at=${now.toISOString()}::timestamptz
        where id=${row.id}::uuid and inviter_user_id=${actor}::uuid returning *`);
      if (!updated) throw new Error("invitation_delivery_not_recorded"); row = updated;
    }
    await recordDelivery(tx, prepared.send!.operationId, delivery.outcome);
    return mutation(row, false, delivery.outcome, now);
  });
}

export async function createDemandInvitation(actorUserId: string, rawInput: CreateDemandInvitation, dependencies: Dependencies = {}) {
  const actor = uuidSchema.parse(actorUserId); const input = createDemandInvitationSchema.parse(rawInput);
  const hash = fingerprint("create", { email: input.email }); const now = (dependencies.now ?? (() => new Date()))();
  const prepared = await (dependencies.transaction ?? withDemandWorkerDb)(async (tx): Promise<Prepared> => {
    await actorLock(tx, actor, true);
    const previous = await replay(tx, actor, input.idempotencyKey, hash);
    if (previous) return { row: await owned(tx, actor, previous.invitation_id), replayed: true, delivery: previous.delivery };
    await tx.execute(sql`update private.demand_invitations set status='expired',delivery_lease_expires_at=null,updated_at=${now.toISOString()}::timestamptz
      where inviter_user_id=${actor}::uuid and status in('pending','sending','sent') and expires_at<=${now.toISOString()}::timestamptz`);
    const [existing] = await tx.execute<Row>(sql`select * from private.demand_invitations where inviter_user_id=${actor}::uuid and recipient_email=${input.email}
      and status in('pending','sending','sent') for update`);
    await rates(tx, actor, !existing);
    if (existing) {
      await record(tx, actor, input.idempotencyKey, hash, existing.id, "create", false);
      return { row: existing, replayed: false, delivery: "not_attempted" };
    }
    await availableSlot(tx, actor, now);
    const id = uuidSchema.parse((dependencies.id ?? randomUUID)()); const lease = new Date(now.getTime() + DEMAND_INVITATION_LEASE_MS).toISOString();
    const expires = new Date(now.getTime() + DEMAND_INVITATION_LIFETIME_MS).toISOString();
    const [row] = await tx.execute<Row>(sql`insert into private.demand_invitations(id,inviter_user_id,recipient_email,status,expires_at,delivery_attempts,delivery_lease_expires_at)
      values(${id}::uuid,${actor}::uuid,${input.email},'sending',${expires}::timestamptz,1,${lease}::timestamptz) returning *`);
    if (!row) throw new Error("invitation_not_created");
    const operationId = await record(tx, actor, input.idempotencyKey, hash, row.id, "create", true);
    return { row, replayed: false, delivery: "unknown", send: { operationId, attempt: 1, lease, restore: null } };
  });
  return finishDelivery(actor, prepared, dependencies);
}

export async function resendDemandInvitation(actorUserId: string, invitationId: string, rawInput: DemandInvitationAction, dependencies: Dependencies = {}) {
  const actor = uuidSchema.parse(actorUserId); const id = uuidSchema.parse(invitationId); const input = demandInvitationActionSchema.parse(rawInput);
  const hash = fingerprint("resend", { id }); const now = (dependencies.now ?? (() => new Date()))();
  const prepared = await (dependencies.transaction ?? withDemandWorkerDb)(async (tx): Promise<Prepared> => {
    await actorLock(tx, actor);
    const previous = await replay(tx, actor, input.idempotencyKey, hash);
    if (previous) return { row: await owned(tx, actor, previous.invitation_id), replayed: true, delivery: previous.delivery };
    const row = await owned(tx, actor, id); const status = effectiveStatus(row, now);
    if (!open(status)) throw unavailable();
    if ((row.status === "sending" && row.delivery_lease_expires_at && time(row.delivery_lease_expires_at) > now.getTime()) ||
      now.getTime() - time(row.updated_at) < DEMAND_INVITATION_COOLDOWN_MS) throw new HttpError(409, "invitation_delivery_pending", "Please wait before resending this invitation.");
    if (row.delivery_attempts >= 100) throw new HttpError(429, "invitation_rate_limited", "This invitation has reached its resend limit.");
    await rates(tx, actor, true);
    const lease = new Date(now.getTime() + DEMAND_INVITATION_LEASE_MS).toISOString();
    const expires = iso(row.expires_at);
    const [updated] = await tx.execute<Row>(sql`update private.demand_invitations set status='sending',delivery_attempts=delivery_attempts+1,
      delivery_lease_expires_at=${lease}::timestamptz,expires_at=${expires}::timestamptz,last_error_code=null,updated_at=${now.toISOString()}::timestamptz
      where id=${id}::uuid and inviter_user_id=${actor}::uuid returning *`);
    if (!updated) throw new Error("invitation_not_prepared");
    const operationId = await record(tx, actor, input.idempotencyKey, hash, id, "resend", true);
    return { row: updated, replayed: false, delivery: "unknown",
      send: { operationId, attempt: updated.delivery_attempts, lease, restore: row.sent_at ? "sent" : "pending" } };
  });
  return finishDelivery(actor, prepared, dependencies);
}

export async function revokeDemandInvitation(actorUserId: string, invitationId: string, rawInput: DemandInvitationAction, dependencies: Dependencies = {}) {
  const actor = uuidSchema.parse(actorUserId); const id = uuidSchema.parse(invitationId); const input = demandInvitationActionSchema.parse(rawInput);
  const hash = fingerprint("revoke", { id }); const now = (dependencies.now ?? (() => new Date()))();
  return (dependencies.transaction ?? withDemandWorkerDb)(async (tx) => {
    await actorLock(tx, actor);
    const previous = await replay(tx, actor, input.idempotencyKey, hash);
    if (previous) return mutation(await owned(tx, actor, previous.invitation_id), true, previous.delivery, now);
    let row = await owned(tx, actor, id);
    await rates(tx, actor, false);
    if (row.status !== "revoked" && row.status !== "redeemed") {
      const [updated] = await tx.execute<Row>(sql`update private.demand_invitations set status='revoked',delivery_lease_expires_at=null,updated_at=${now.toISOString()}::timestamptz
        where id=${id}::uuid and inviter_user_id=${actor}::uuid returning *`);
      if (!updated) throw new Error("invitation_not_revoked"); row = updated;
    }
    await record(tx, actor, input.idempotencyKey, hash, id, "revoke", false);
    return mutation(row, false, "not_attempted", now);
  });
}

/** The caller supplies only a verified JWT subject. The private function checks
 * provider-confirmed email, membership, inviter, deadline and single redemption
 * atomically; possession of the invitation ID alone never grants membership. */
export async function redeemDemandInvitation(verifiedUserId: string, invitationId: string, rawInput: DemandInvitationAction, dependencies: Dependencies = {}) {
  const actor = uuidSchema.parse(verifiedUserId); const id = uuidSchema.parse(invitationId); const input = demandInvitationActionSchema.parse(rawInput);
  const hash = fingerprint("redeem", { id });
  return (dependencies.transaction ?? withDemandWorkerDb)(async (tx) => {
    await globalLock(tx);
    const previous = await replay(tx, actor, input.idempotencyKey, hash);
    const [result] = await tx.execute<{ admitted: boolean }>(sql`select private.redeem_demand_invitation(${id}::uuid,${actor}::uuid) as admitted`);
    if (result?.admitted !== true) throw unavailable();
    if (!previous) await record(tx, actor, input.idempotencyKey, hash, id, "redeem", false);
    return demandInvitationRedemptionSchema.parse({ invitationId: id, admitted: true, replayed: Boolean(previous) });
  });
}
