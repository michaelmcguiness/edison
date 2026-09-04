import { z } from "zod";
import { articleCardSchema } from "./articles";
import { uuidSchema } from "./common";

export const learningThreadSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  summary: z.string(),
  currentLevel: z.string(),
  updatedAt: z.string().datetime(),
});

export const conversationPreviewSchema = z.object({
  id: uuidSchema,
  articleId: uuidSchema,
  articleTitle: z.string(),
  title: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const libraryResponseSchema = z.object({
  saved: z.array(articleCardSchema),
  completed: z.array(articleCardSchema),
  learningThreads: z.array(learningThreadSchema),
  conversations: z.array(conversationPreviewSchema),
});

export type LibraryResponse = z.infer<typeof libraryResponseSchema>;
