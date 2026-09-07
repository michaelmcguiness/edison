import { and, count, eq, inArray, sql } from "drizzle-orm";
import { demandPrincipals, demandRequests, type DemandTransaction } from "@edison/db";
import { assertDemandPrincipalActive } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";
import { demandLimits } from "./demand-configuration";

/** Fresh work and released-hold recovery must share this lock order. */
export async function lockDemandAdmission(tx: DemandTransaction, principalId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission', 0))`);
  const [principal] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id, principalId)).for("update").limit(1);
  if (!principal) throw new HttpError(401, "reading_session_required", "That reading session is unavailable.");
  assertDemandPrincipalActive(principal);
  const [active] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
  if (active?.active !== true) throw new HttpError(401, "reading_session_required", "That reading session is unavailable.");
}

/** Mirrors the SQL hold rule below. A retry never reserves the spent amount twice. */
export function demandRequestHeldMicrousd(
  request: { status: string; failureCode: string | null; attempts: number; reservedMicrousd: number },
  stages: readonly { status: string }[],
  spent: number,
) {
  if (!Number.isSafeInteger(spent) || spent < 0 || !Number.isSafeInteger(request.reservedMicrousd) || request.reservedMicrousd < 0) {
    throw new Error("demand_admission_amount_invalid");
  }
  const held = ["queued", "running"].includes(request.status) ||
    (request.status === "failed" && ["worker_interrupted", "workflow_dispatch_failed"].includes(request.failureCode ?? "") && request.attempts < 3) ||
    stages.some((stage) => ["reserved", "uncertain"].includes(stage.status));
  return held ? Math.max(0, request.reservedMicrousd - spent) : 0;
}

export function assertDemandBudgetCapacity(input: {
  daily: number; monthly: number; unpriced: boolean;
  legacy: { daily: number; monthly: number; unpriced: boolean; outstanding: boolean } | null;
  additionalMicrousd: number;
}, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const limits = demandLimits(environment);
  const amounts = [input.daily, input.monthly, input.additionalMicrousd, input.legacy?.daily, input.legacy?.monthly];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount! < 0) || !input.legacy || input.unpriced || input.legacy.unpriced || input.legacy.outstanding ||
    input.daily + input.legacy.daily + input.additionalMicrousd > limits.dailyMicrousd ||
    input.monthly + input.legacy.monthly + input.additionalMicrousd > limits.monthlyMicrousd) {
    throw new HttpError(429, "reading_budget_reached", "New reading is at its current spending limit. Saved articles remain available.");
  }
}

/** Caller holds admission → principal. Daily request counts are unchanged by retry. */
export async function assertDemandAdmissionCapacity(tx: DemandTransaction, input: {
  principalId: string; additionalMicrousd: number;
}, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const limits = demandLimits(environment);
  const [{ outstanding }] = await tx.select({ outstanding: count() }).from(demandRequests)
    .where(and(eq(demandRequests.principalId, input.principalId), inArray(demandRequests.status, ["queued", "running"])));
  if (outstanding >= limits.maxConcurrent) {
    throw new HttpError(429, "reading_busy", "Two requests are already being prepared. You can keep reading while they finish.");
  }
  // Global totals include every principal, legacy work, and ambiguous spend.
  const [total] = await tx.execute<{ monthly: string; daily: string; unpriced: boolean }>(sql`
    with costs as (
      select greatest(0, case when r.status in ('queued','running')
        or (r.status='failed' and r.failure_code in ('worker_interrupted','workflow_dispatch_failed') and r.attempts < 3)
        or exists (
          select 1 from private.demand_stages s where s.request_id=r.id and s.status in ('reserved','uncertain')
        ) then r.reserved_microusd-coalesce(u.cost,0) else 0 end) as held,
        coalesce(u.monthly,0) as monthly, coalesce(u.daily,0) as daily,
        coalesce(u.unpriced, false) as unpriced
      from private.demand_requests r
      left join lateral (
        select sum(cost_microusd) as cost,
          sum(cost_microusd) filter (where created_at >= date_trunc('month', now())) as monthly,
          sum(cost_microusd) filter (where created_at >= now()-interval '24 hours') as daily,
          bool_or(pricing_status='unpriced') as unpriced
        from private.demand_usage where request_id=r.id
      ) u on true
    ) select coalesce(sum(monthly+held),0)::text as monthly,
      coalesce(sum(daily+held),0)::text as daily,
      coalesce(bool_or(unpriced),false) as unpriced from costs
  `);
  const [legacy] = await tx.execute<{ monthly: string; daily: string; unpriced: boolean; outstanding: boolean }>(sql`select * from private.demand_legacy_budget()`);
  assertDemandBudgetCapacity({ daily: Number(total?.daily), monthly: Number(total?.monthly), unpriced: total?.unpriced !== false,
    legacy: legacy ? { ...legacy, daily: Number(legacy.daily), monthly: Number(legacy.monthly) } : null,
    additionalMicrousd: input.additionalMicrousd }, environment);
}
