import { z } from "zod";
import { articleCardSchema } from "./articles";
import {
  contentCategorySchema,
  idempotencyKeySchema,
  uuidSchema,
} from "./common";

export const feedResponseSchema = z
  .object({
    editionId: uuidSchema.nullable(),
    editionDate: z.string().date().nullable(),
    items: z.array(articleCardSchema).max(30),
    itemCount: z.number().int().nonnegative().max(30),
    nextCursor: z.null(),
    activeCategory: contentCategorySchema,
    generatedThrough: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((feed, context) => {
    if ((feed.editionId === null) !== (feed.editionDate === null)) {
      context.addIssue({
        code: "custom",
        path: ["editionId"],
        message: "News edition ID and date must both be present or both be null.",
      });
    }
    if (feed.itemCount !== feed.items.length) {
      context.addIssue({
        code: "custom",
        path: ["itemCount"],
        message: "The item count must match the returned News articles.",
      });
    }
  });

export const feedQuerySchema = z
  .object({
    category: contentCategorySchema.default("for-you"),
    limit: z.coerce.number().int().min(1).max(30).default(12),
  })
  .strict();

export const feedCommandRequestSchema = z.object({
  command: z.string().trim().min(3).max(1000),
  idempotencyKey: idempotencyKeySchema,
});

const explanation = z.string().min(1).max(500);
const topicValue = z.union([
  z.string().min(1).max(200),
  z.array(z.string().min(1).max(200)).min(1).max(20),
]);

export const preferenceChangeSchema = z.discriminatedUnion("path", [
  z.object({
    path: z.literal("interests"),
    operation: z.enum(["add", "remove"]),
    value: topicValue,
    explanation,
  }),
  z.object({
    path: z.literal("knowledgeState"),
    operation: z.enum(["add", "remove"]),
    value: topicValue,
    explanation,
  }),
  z.object({
    path: z.enum(["depth", "novelty"]),
    operation: z.enum(["increase", "decrease", "set"]),
    value: z.number().min(0).max(100),
    explanation,
  }),
  z.object({
    path: z.literal("articleLength"),
    operation: z.literal("set"),
    value: z.enum(["brief", "standard", "deep"]),
    explanation,
  }),
]);

export const feedCommandResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "applied", "no-op", "failed"]),
  changes: z.array(preferenceChangeSchema),
  message: z.string(),
});

export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type FeedCommandRequest = z.infer<typeof feedCommandRequestSchema>;
export type PreferenceChange = z.infer<typeof preferenceChangeSchema>;
