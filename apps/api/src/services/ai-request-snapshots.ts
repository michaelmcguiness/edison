import { z } from "zod";
import {
  articleBlockSchema,
  articleLengthSchema,
  articleSourceSchema,
  knowledgeStateSchema,
  maxRetainedExplicitInterests,
} from "@edison/contracts";

const conversationHistoryEntrySchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8_000),
  })
  .strict();

export const articleQuestionRequestSnapshotSchema = z
  .object({
    version: z.literal(1),
    article: z
      .object({
        title: z.string().min(1),
        deck: z.string(),
        body: z.array(articleBlockSchema).min(1),
      })
      .strict(),
    sources: z.array(articleSourceSchema).max(20),
    history: z.array(conversationHistoryEntrySchema).max(20),
    question: z.string().trim().min(1).max(4_000),
  })
  .strict();

const feedPreferenceContextSchema = z
  .object({
    articleLength: articleLengthSchema,
    editorialBrief: z.string(),
    depth: z.number().int().min(0).max(100),
    novelty: z.number().int().min(0).max(100),
    categoryVisibility: z.record(z.boolean()),
    categoryOrder: z.array(z.string()),
    inferredPreferences: z.array(z.string()),
    knowledgeState: knowledgeStateSchema,
  })
  .strict();

const interestSignalsSchema = z
  .object({
    active: z
      .array(z.string().trim().min(1).max(200))
      .max(maxRetainedExplicitInterests),
    muted: z
      .array(z.string().trim().min(1).max(200))
      .max(maxRetainedExplicitInterests),
  })
  .strict()
  .refine(
    (signals) =>
      signals.active.length + signals.muted.length <=
      maxRetainedExplicitInterests,
    "Retained explicit-interest context exceeds its durable limit.",
  );

export const preferenceCommandRequestSnapshotSchema = z
  .object({
    version: z.literal(1),
    command: z.string().trim().min(1).max(4_000),
    currentPreferences: feedPreferenceContextSchema,
    currentInterests: interestSignalsSchema,
  })
  .strict();

export type ArticleQuestionRequestSnapshot = z.infer<
  typeof articleQuestionRequestSnapshotSchema
>;
export type PreferenceCommandRequestSnapshot = z.infer<
  typeof preferenceCommandRequestSnapshotSchema
>;

export function snapshotArticleQuestion(
  input: Omit<ArticleQuestionRequestSnapshot, "version">,
) {
  return articleQuestionRequestSnapshotSchema.parse({ version: 1, ...input });
}

export function snapshotPreferenceCommand(
  input: Omit<PreferenceCommandRequestSnapshot, "version">,
) {
  return preferenceCommandRequestSnapshotSchema.parse({ version: 1, ...input });
}
