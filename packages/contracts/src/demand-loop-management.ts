import { z } from "zod";
import { idempotencyKeySchema, uuidSchema } from "./common";
import { demandPrincipleSchema } from "./demand";

export const DEMAND_LOOP_NAME_LIMIT = 80;
export const demandLoopInstructionsSchema = z.string().max(500)
  .refine((value) => !value.includes("\u0000"), "Instructions contain an unsupported character.");

export const editDemandLoopSchema = z.object({
  // An unchanged historical name may exceed the new editor's 80-character
  // limit. The service applies that limit to changed names, not saved history.
  name: z.string().trim().min(1).max(120).refine((value) => !value.includes("\u0000")),
  instructions: demandLoopInstructionsSchema,
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const archiveDemandLoopSchema = z.object({
  confirmed: z.literal(true),
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const managedDemandLoopSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(120),
  originalCuriosity: z.string().min(1).max(500),
  instructions: demandLoopInstructionsSchema,
  archivedAt: z.string().datetime().nullable(),
  revision: z.number().int().nonnegative(),
  principles: z.array(demandPrincipleSchema).max(20),
  lastMutationId: uuidSchema.nullable(),
  canUndo: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const demandLoopManagementResultSchema = z.object({
  workspaceId: uuidSchema,
  operationId: uuidSchema,
  replayed: z.boolean(),
  loop: managedDemandLoopSchema,
}).strict();

export type EditDemandLoop = z.infer<typeof editDemandLoopSchema>;
export type ArchiveDemandLoop = z.infer<typeof archiveDemandLoopSchema>;
export type ManagedDemandLoop = z.infer<typeof managedDemandLoopSchema>;
export type DemandLoopManagementResult = z.infer<typeof demandLoopManagementResultSchema>;
