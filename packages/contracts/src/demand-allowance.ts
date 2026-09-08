import { z } from "zod";
import { idempotencyKeySchema, uuidSchema } from "./common";

export const DEMAND_WEEKLY_ARTICLES = 500;
export const demandAllowanceSchema = z.object({
  limit: z.literal(DEMAND_WEEKLY_ARTICLES),
  used: z.number().int().nonnegative(),
  periodUsed: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  remaining: z.number().int().min(0).max(DEMAND_WEEKLY_ARTICLES),
  available: z.number().int().min(0).max(DEMAND_WEEKLY_ARTICLES),
  periodStart: z.string().datetime(),
  resetsAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  manualResetAt: z.string().datetime().nullable(),
}).strict().refine((value) => value.remaining === Math.max(0, value.limit - value.used) &&
  value.available === Math.max(0, value.remaining - value.reserved) && value.periodUsed >= value.used,
"The displayed allowance must match its settled and pending units.");
export const demandAccountGateSchema = z.object({
  canCreateLoop: z.boolean(), canRefresh: z.boolean(), reason: z.literal("account_required").nullable(),
}).strict();
export const resetDemandAllowanceSchema = z.object({
  idempotencyKey: idempotencyKeySchema, password: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
  expectedPeriodStart: z.string().datetime(),
}).strict();
export const demandAllowanceResetReceiptSchema = z.object({
  operationId: uuidSchema, periodStart: z.string().datetime(),
  previousRevision: z.number().int().nonnegative(), revision: z.number().int().positive(), replayed: z.boolean(),
}).strict();
export type DemandAllowance = z.infer<typeof demandAllowanceSchema>;
export type DemandAccountGate = z.infer<typeof demandAccountGateSchema>;
export type ResetDemandAllowance = z.infer<typeof resetDemandAllowanceSchema>;
export type DemandAllowanceResetReceipt = z.infer<typeof demandAllowanceResetReceiptSchema>;
