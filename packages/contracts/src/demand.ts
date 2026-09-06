import { z } from "zod";
import { articleSchema } from "./articles";
import { idempotencyKeySchema, uuidSchema } from "./common";

export const demandPrincipleSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["knowledge", "preference", "direction"]),
  instruction: z.string().min(1).max(500),
  source: z.literal("reader"),
}).strict();

export const demandLoopSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(120),
  originalCuriosity: z.string().min(1).max(500),
  revision: z.number().int().nonnegative(),
  principles: z.array(demandPrincipleSchema).max(20),
  lastMutationId: uuidSchema.nullable(),
  canUndo: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const demandRequestKindSchema = z.enum(["ideas", "article", "feedback", "question"]);
export const demandRequestStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export const demandRequestSchema = z.object({
  id: uuidSchema,
  loopId: uuidSchema,
  ideaId: uuidSchema.nullable(),
  kind: demandRequestKindSchema,
  status: demandRequestStatusSchema,
  stage: z.enum(["queued", "researching", "checking-ideas", "writing", "checking", "repairing",
    "updating", "answering", "ready", "failed"]),
  failure: z.object({ code: z.string().max(80), message: z.string().max(500), retryable: z.boolean() }).strict().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const demandIdeaSchema = z.object({
  id: uuidSchema,
  loopId: uuidSchema,
  batchRequestId: uuidSchema,
  batchRevision: z.number().int().nonnegative(),
  rank: z.number().int().min(1).max(6),
  title: z.string().min(1).max(180),
  deck: z.string().min(1).max(500),
  articleRequestId: uuidSchema.nullable(),
  saved: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();

export const demandWorkspaceSchema = z.object({
  // Public ownership identity for clearing client state on a session/account
  // switch. This is not a credential and cannot authorize API access.
  workspaceId: uuidSchema,
  readerKind: z.enum(["guest", "account"]),
  loops: z.array(demandLoopSchema).max(30),
  ideas: z.array(demandIdeaSchema).max(360),
  requests: z.array(demandRequestSchema).max(120),
}).strict();

export const DEMAND_HISTORY_PAGE_SIZE = 60;
export const demandHistoryCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
export const demandHistoryQuerySchema = z.object({
  scope: z.enum(["all", "saved"]).default("all"),
  loopId: uuidSchema.optional(),
  cursor: demandHistoryCursorSchema.optional(),
}).strict();

/** Only this read route accepts query parameters; duplicates are ambiguous. */
export function parseDemandHistoryQuery(params: URLSearchParams) {
  const input: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw new Error("duplicate_history_parameter");
    input[key] = value;
  }
  return demandHistoryQuerySchema.parse(input);
}

export const demandHistorySchema = z.object({
  workspaceId: uuidSchema,
  ideas: z.array(demandIdeaSchema).max(DEMAND_HISTORY_PAGE_SIZE),
  // Only the selected ideas' article statuses, never drafts or provider data.
  requests: z.array(demandRequestSchema).max(DEMAND_HISTORY_PAGE_SIZE),
  nextCursor: demandHistoryCursorSchema.nullable(),
}).strict().superRefine((page, context) => {
  if (new Set(page.ideas.map((idea) => idea.id)).size !== page.ideas.length ||
      new Set(page.requests.map((request) => request.id)).size !== page.requests.length) {
    context.addIssue({ code: "custom", message: "History identities must be unique." });
  }
  for (const request of page.requests) {
    const idea = page.ideas.find((idea) => idea.articleRequestId === request.id);
    if (!idea || request.kind !== "article" || request.ideaId !== idea.id || request.loopId !== idea.loopId) {
      context.addIssue({ code: "custom", message: "History request must belong to its article idea." });
    }
  }
});

export const demandIdeaResultSchema = z.object({
  workspaceId: uuidSchema,
  idea: demandIdeaSchema,
  request: demandRequestSchema.nullable(),
}).strict().refine(({ idea, request }) => request === null || (
  request.id === idea.articleRequestId && request.ideaId === idea.id && request.loopId === idea.loopId && request.kind === "article"
), "Recovered request must belong to its article idea.");

export const demandResultSchema = z.object({
  request: demandRequestSchema,
  article: articleSchema.nullable(),
  answer: z.object({ text: z.string().min(1).max(8000),
    sourceIds: z.array(z.string().min(1).max(80)).max(20) }).strict().nullable(),
}).strict();

export const createDemandLoopSchema = z.object({
  curiosity: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const requestDemandIdeasSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const requestDemandArticleSchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();

export const demandFeedbackSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("apply"), text: z.string().trim().min(1).max(500),
    baseRevision: z.number().int().nonnegative(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ operation: z.literal("undo"), mutationId: uuidSchema,
    baseRevision: z.number().int().nonnegative(), idempotencyKey: idempotencyKeySchema }).strict(),
]);

export const demandQuestionSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const demandEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("opened"), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ type: z.literal("saved"), saved: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ type: z.literal("progress"), progress: z.number().int().min(0).max(100),
    idempotencyKey: idempotencyKeySchema }).strict(),
]);

export type DemandLoop = z.infer<typeof demandLoopSchema>;
export type DemandIdea = z.infer<typeof demandIdeaSchema>;
export type DemandRequest = z.infer<typeof demandRequestSchema>;
export type DemandWorkspace = z.infer<typeof demandWorkspaceSchema>;
export type DemandResult = z.infer<typeof demandResultSchema>;
export type DemandHistoryQuery = z.infer<typeof demandHistoryQuerySchema>;
export type DemandHistory = z.infer<typeof demandHistorySchema>;
export type DemandIdeaResult = z.infer<typeof demandIdeaResultSchema>;
