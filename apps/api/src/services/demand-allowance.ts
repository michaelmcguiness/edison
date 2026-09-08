import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { withDemandWorkerDb, type DemandTransaction } from "@edison/db";
import { demandAllowanceSchema, type ResetDemandAllowance } from "@edison/contracts";
import type { DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";
import { lockDemandAdmission } from "./demand-admission";

export const WEEKLY_ARTICLES = 500;
export function demandAllowancePeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return { periodStart: start, resetsAt: new Date(start.getTime() + 7 * 86_400_000) };
}
export function demandAvailableArticles(used: number, reserved: number) {
  if (![used, reserved].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("demand_allowance_count_invalid");
  return Math.max(0, WEEKLY_ARTICLES - used - reserved);
}
export function demandBatchSize(used: number, reserved: number) {
  const available = demandAvailableArticles(used, reserved);
  if (!available) throw new HttpError(429, "allowance_exhausted", "Your weekly article allowance is used up. You can keep reading your articles.");
  return Math.min(6, available);
}
type Grant = { id: string; principal_id: string; period_start: Date; revision: number; created_at: Date };
export async function demandReaderId(tx: DemandTransaction, principalId: string) {
  const [row] = await tx.execute<{ id: string }>(sql`select private.demand_reader_id(${principalId}::uuid) as id`);
  if (!row?.id) throw new Error("demand_reader_missing");
  return row.id;
}

/** Caller holds the shared admission lock. Bootstrap historic offers once;
 * entitlement accounting never changes request snapshots or provider spend. */
export async function currentDemandGrant(tx: DemandTransaction, principalId: string, now = new Date()): Promise<Grant> {
  const { periodStart, resetsAt } = demandAllowancePeriod(now);
  await tx.execute(sql`insert into private.demand_allowance_grants(principal_id,period_start,revision)
    values(${principalId}::uuid,${periodStart.toISOString()}::timestamptz,0) on conflict do nothing`);
  const [initial] = await tx.execute<Grant>(sql`select * from private.demand_allowance_grants
    where principal_id=${principalId}::uuid and period_start=${periodStart.toISOString()}::timestamptz and revision=0`);
  // Includes pending pre-release requests and terminal offers, including failed
  // requests eligible for retry. A unique request ID makes lazy backfill stable.
  await tx.execute(sql`insert into private.demand_allowance_allocations(request_id,grant_id,units)
    select r.id,${initial.id}::uuid,case when jsonb_typeof(r.snapshot->'requestedCount')='number' then case
      when (r.snapshot->>'requestedCount')::numeric between 1 and 6
      and trunc((r.snapshot->>'requestedCount')::numeric)=(r.snapshot->>'requestedCount')::numeric
      then (r.snapshot->>'requestedCount')::integer else 4 end else 4 end
    from private.demand_requests r where r.principal_id=${principalId}::uuid and r.kind='ideas'
      and r.created_at>=${periodStart.toISOString()}::timestamptz and r.created_at<${resetsAt.toISOString()}::timestamptz
    on conflict(request_id) do nothing`);
  const [current] = await tx.execute<Grant>(sql`select * from private.demand_allowance_grants
    where principal_id=${principalId}::uuid and period_start=${periodStart.toISOString()}::timestamptz order by revision desc limit 1`);
  return current;
}

export async function demandGrantCounts(tx: DemandTransaction, grantId: string) {
  const [counts] = await tx.execute<{ used: number; reserved: number }>(sql`
    select coalesce(sum(case when r.status='succeeded' then (select count(*) from private.demand_ideas i where i.batch_request_id=r.id) else 0 end),0)::integer as used,
      coalesce(sum(case when r.status in ('queued','running') then a.units else 0 end),0)::integer as reserved
    from private.demand_allowance_allocations a join private.demand_requests r on r.id=a.request_id
    where a.grant_id=${grantId}::uuid or a.grant_id in (
      select source_grant_id from private.demand_allowance_carryovers where target_grant_id=${grantId}::uuid)
  `);
  return counts ?? { used: 0, reserved: 0 };
}

export async function demandAllowanceInTransaction(tx: DemandTransaction, principalId: string, now = new Date()) {
  const readerId = await demandReaderId(tx, principalId);
  const grant = await currentDemandGrant(tx, readerId, now);
  const { used, reserved } = await demandGrantCounts(tx, grant.id);
  const { periodStart, resetsAt } = demandAllowancePeriod(now);
  const [history] = await tx.execute<{ used: number }>(sql`select count(i.id)::integer as used
    from private.demand_allowance_allocations a join private.demand_allowance_grants g on g.id=a.grant_id
    join private.demand_requests r on r.id=a.request_id and r.status='succeeded'
    join private.demand_ideas i on i.batch_request_id=r.id
    where private.demand_reader_id(g.principal_id)=${readerId}::uuid and g.period_start=${periodStart.toISOString()}::timestamptz`);
  return demandAllowanceSchema.parse({ limit: WEEKLY_ARTICLES, used, reserved, periodUsed: history.used,
    remaining: Math.max(0, WEEKLY_ARTICLES-used), available: demandAvailableArticles(used, reserved),
    periodStart: periodStart.toISOString(), resetsAt: resetsAt.toISOString(), revision: grant.revision,
    manualResetAt: grant.revision ? new Date(grant.created_at).toISOString() : null });
}
export async function demandAllowance(principal: DemandPrincipal) {
  return withDemandWorkerDb(async (tx) => { await lockDemandAdmission(tx, principal.id); return demandAllowanceInTransaction(tx, principal.id); });
}

/** Reserve before inserting the request; attach the returned grant in the same
 * transaction. The saved requestedCount is the immutable provider input. */
export async function prepareDemandAllowance(tx: DemandTransaction, principalId: string) {
  const grant = await currentDemandGrant(tx, await demandReaderId(tx, principalId));
  const counts = await demandGrantCounts(tx, grant.id);
  return { grantId: grant.id, requestedCount: demandBatchSize(counts.used, counts.reserved) };
}
export async function allocateDemandAllowance(tx: DemandTransaction, requestId: string, allocation: { grantId: string; requestedCount: number }) {
  await tx.execute(sql`insert into private.demand_allowance_allocations(request_id,grant_id,units)
    values(${requestId}::uuid,${allocation.grantId}::uuid,${allocation.requestedCount})`);
}
export async function assertDemandAllowanceSettlement(tx: DemandTransaction, requestId: string, accepted: number) {
  const [allocation]=await tx.execute<{units:number}>(sql`select units from private.demand_allowance_allocations where request_id=${requestId}::uuid`);
  // A pre-feature in-flight request can finish under its original saved count;
  // next allowance read bootstraps it. New requests always have allocations.
  if (!Number.isInteger(accepted)||accepted<0||accepted>6||(allocation&&accepted>allocation.units)) throw new Error("provider_invalid");
}
export async function assertDemandAllowanceRetry(tx: DemandTransaction, request: { id: string; principalId: string; kind: string; status: string }) {
  if (request.kind !== "ideas" || request.status !== "failed") return;
  const [allocation] = await tx.execute<{ grant_id: string; units: number; target_grant_id: string | null }>(sql`
    select a.grant_id,a.units,c.target_grant_id from private.demand_allowance_allocations a
    left join private.demand_allowance_carryovers c on c.source_grant_id=a.grant_id where request_id=${request.id}::uuid`);
  // Pre-release, old-period retries acquire an original-period grant lazily.
  // Current-period bootstrap is performed at session resolution/admission.
  if (!allocation) throw new HttpError(409,"allowance_recovery_unavailable","That old refresh cannot be retried safely. Request a new refresh instead.");
  for (const grantId of [allocation.grant_id, allocation.target_grant_id].filter((id): id is string => Boolean(id))) {
    const counts = await demandGrantCounts(tx, grantId);
    if (demandAvailableArticles(counts.used, counts.reserved) < allocation.units) {
      throw new HttpError(429,"allowance_exhausted","That refresh's original allowance is no longer available. You can keep reading your articles.");
    }
  }
}

export async function carryDemandAllowance(tx: DemandTransaction, guestId: string, accountId: string) {
  const now=new Date();
  const guest = await currentDemandGrant(tx, guestId,now);
  const account = await currentDemandGrant(tx, accountId,now);
  await tx.execute(sql`insert into private.demand_allowance_carryovers(source_grant_id,target_grant_id)
    values(${guest.id}::uuid,${account.id}::uuid) on conflict(source_grant_id) do nothing`);
}

export function validDemandResetPassword(password: string, environment: Readonly<Record<string,string|undefined>> = process.env) {
  const configured = environment.EDISON_DEMAND_ALLOWANCE_RESET_PASSWORD;
  if (!configured) throw new HttpError(503,"allowance_reset_unavailable","Allowance reset is not currently available.");
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(password), hash(configured));
}
export async function resetDemandAllowance(principal: DemandPrincipal, input: ResetDemandAllowance) {
  if (!principal.accountUserId) throw new HttpError(403,"account_required","Sign in to reset your allowance.");
  const valid = validDemandResetPassword(input.password);
  const outcome = await withDemandWorkerDb(async (tx) => {
    await lockDemandAdmission(tx, principal.id);
    const readerId = await demandReaderId(tx, principal.id);
    const [replay] = valid ? await tx.execute<{ id:string; period_start:Date; revision:number; previous_revision:number }>(sql`
      select r.id,g.period_start,g.revision,p.revision as previous_revision from private.demand_allowance_resets r
      join private.demand_allowance_grants g on g.id=r.grant_id join private.demand_allowance_grants p on p.id=r.previous_grant_id
      where r.principal_id=${readerId}::uuid and r.idempotency_key=${input.idempotencyKey}`) : [];
    if (replay) {
      if (replay.previous_revision !== input.expectedRevision || new Date(replay.period_start).toISOString() !== input.expectedPeriodStart) throw new HttpError(409,"idempotency_key_reused","That reset identity was already used for different input.");
      return { receipt: { operationId: replay.id, periodStart:new Date(replay.period_start).toISOString(), previousRevision:replay.previous_revision,revision:replay.revision,replayed:true } };
    }
    const [attempts] = await tx.execute<{ size: number }>(sql`select count(*)::integer as size from private.demand_allowance_reset_attempts
      where principal_id=${readerId}::uuid and not accepted and created_at>now()-interval '15 minutes'`);
    if (attempts.size >= 5) return { error: new HttpError(429,"allowance_reset_rate_limited","Please wait before trying another reset password.") };
    if (!valid) {
      await tx.execute(sql`insert into private.demand_allowance_reset_attempts(principal_id,accepted) values(${readerId}::uuid,false)`);
      return { error: new HttpError(403,"allowance_reset_password_invalid","That password didn’t work. Try again.") };
    }
    const current = await currentDemandGrant(tx, readerId);
    if (current.revision !== input.expectedRevision || new Date(current.period_start).toISOString() !== input.expectedPeriodStart) throw new HttpError(409,"allowance_changed","Your allowance changed. Reload it before resetting.");
    const [next] = await tx.execute<Grant>(sql`insert into private.demand_allowance_grants(principal_id,period_start,revision)
      values(${readerId}::uuid,${new Date(current.period_start).toISOString()}::timestamptz,${current.revision+1}) returning *`);
    const [receipt] = await tx.execute<{ id:string }>(sql`insert into private.demand_allowance_resets(principal_id,idempotency_key,previous_grant_id,grant_id)
      values(${readerId}::uuid,${input.idempotencyKey},${current.id}::uuid,${next.id}::uuid) returning id`);
    await tx.execute(sql`insert into private.demand_allowance_reset_attempts(principal_id,accepted) values(${readerId}::uuid,true)`);
    return { receipt: { operationId:receipt.id,periodStart:new Date(next.period_start).toISOString(),previousRevision:current.revision,revision:next.revision,replayed:false } };
  });
  if (outcome.error) throw outcome.error;
  return outcome.receipt;
}
