import { z } from "zod";
import { citationSchema } from "./articles";
import {
  articleCategorySchema,
  idempotencyKeySchema,
  uuidSchema,
} from "./common";

export const generationKindSchema = z.enum([
  "initial-edition",
  "feed-replenishment",
  "learning-thread",
  "article-follow-up",
]);

export const generationStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const createGenerationJobSchema = z.object({
  kind: z.enum(["initial-edition", "feed-replenishment"]),
  topic: z.string().trim().min(2).max(500).optional(),
  category: articleCategorySchema.optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const generationJobSchema = z.object({
  id: uuidSchema,
  kind: generationKindSchema,
  status: generationStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  outputArticleId: uuidSchema.nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const conversationRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  idempotencyKey: idempotencyKeySchema,
});

export const conversationResponseSchema = z.object({
  conversationId: uuidSchema,
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema,
  answer: z.string().min(1),
  citations: z.array(citationSchema),
});

export const conversationMessageSchema = z.object({
  id: uuidSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  citations: z.array(citationSchema),
  createdAt: z.string().datetime(),
});

export const articleConversationSchema = z.object({
  id: uuidSchema,
  articleId: uuidSchema,
  title: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(conversationMessageSchema),
});

export const articleConversationResponseSchema = z.object({
  conversation: articleConversationSchema.nullable(),
});

export type GenerationJob = z.infer<typeof generationJobSchema>;
export type CreateGenerationJob = z.infer<typeof createGenerationJobSchema>;
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ArticleConversation = z.infer<typeof articleConversationSchema>;
export type ArticleConversationResponse = z.infer<
  typeof articleConversationResponseSchema
>;
