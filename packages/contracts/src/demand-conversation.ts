import { z } from "zod";
import { uuidSchema } from "./common";
import { demandAnswerSchema, demandArticleSchema, demandHistoryCursorSchema, demandIdeaSchema, demandLoopSchema, demandRequestSchema } from "./demand";

export const DEMAND_CONVERSATION_PAGE_SIZE = 60;
export const demandConversationQuerySchema = z.object({ cursor: demandHistoryCursorSchema.optional() }).strict();
export type DemandConversationQuery = z.infer<typeof demandConversationQuerySchema>;
export function parseDemandConversationQuery(params: URLSearchParams) {
  const input: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw new Error("duplicate_conversation_parameter");
    input[key] = value;
  }
  return demandConversationQuerySchema.parse(input);
}

export const demandArticleResultSchema = z.object({
  workspaceId: uuidSchema, idea: demandIdeaSchema, request: demandRequestSchema, article: demandArticleSchema, loop: demandLoopSchema,
}).strict().refine(({ idea, request, article, loop }) => loop.id === idea.loopId && request.kind === "article" && request.status === "succeeded" &&
  request.id === article.id && request.id === idea.articleRequestId && request.ideaId === idea.id && request.loopId === idea.loopId,
"The saved article must match its exact request and idea.");

export const demandConversationTurnSchema = z.object({
  request: demandRequestSchema,
  // Only the submitted text, never its context/evidence/provider snapshot.
  question: z.string().min(1).max(1000),
  answer: demandAnswerSchema.nullable(),
}).strict().refine(({ request, answer }) => request.kind === "question" &&
  ((request.status === "succeeded") === (answer !== null)), "A conversation turn must reflect its saved question result.");

export const demandConversationSchema = z.object({
  workspaceId: uuidSchema, articleId: uuidSchema,
  turns: z.array(demandConversationTurnSchema).max(DEMAND_CONVERSATION_PAGE_SIZE),
  nextCursor: demandHistoryCursorSchema.nullable(),
}).strict().refine(({ turns }) => new Set(turns.map((turn) => turn.request.id)).size === turns.length,
"Conversation request identities must be unique.");

export type DemandArticleResult = z.infer<typeof demandArticleResultSchema>;
export type DemandConversationTurn = z.infer<typeof demandConversationTurnSchema>;
export type DemandConversation = z.infer<typeof demandConversationSchema>;
