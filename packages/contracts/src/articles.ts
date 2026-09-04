import { z } from "zod";
import { articleCategorySchema, uuidSchema } from "./common";

export const citationSchema = z.object({
  sourceId: uuidSchema,
  label: z.string().min(1).max(24),
}).strict();

export const articleBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paragraph"),
    text: z.string().min(1),
    citations: z.array(citationSchema).default([]),
  }).strict(),
  z.object({
    type: z.literal("heading"),
    level: z.literal(2),
    text: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal("quote"),
    text: z.string().min(1),
    attribution: z.string().max(240).nullable().default(null),
    citations: z.array(citationSchema).default([]),
  }).strict(),
]);

export const sourceUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Source URLs must use HTTP(S) without embedded credentials.");

export const articleSourceSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: sourceUrlSchema,
  publishedAt: z.string().datetime().nullable(),
  accessedAt: z.string().datetime(),
}).strict();

export const articleCardSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1),
  category: articleCategorySchema,
  kicker: z.string().min(1),
  title: z.string().min(1),
  deck: z.string().min(1),
  readingMinutes: z.number().int().positive(),
  sourceCount: z.number().int().nonnegative(),
  researchedAt: z.string().datetime(),
  reason: z.string().min(1),
  summary: z.array(z.string().min(1)).length(3),
  saved: z.boolean(),
  completed: z.boolean(),
});

export const articleSchema = articleCardSchema.extend({
  topic: z.string().min(1),
  body: z.array(articleBlockSchema).min(1),
  sources: z.array(articleSourceSchema),
  writtenFor: z.string().min(1),
  shareId: uuidSchema.nullable(),
});

export const articleFeedbackRequestSchema = z.object({
  worthYourTime: z.boolean(),
});

export const readingEventRequestSchema = z.object({
  eventType: z.enum(["opened", "progress", "completed", "shared"]),
  progressPercent: z.number().int().min(0).max(100).optional(),
  idempotencyKey: z.string().min(8).max(128),
});

export const shareArticleResponseSchema = z.object({
  shareId: uuidSchema,
  url: z.string().url(),
  created: z.boolean(),
});

export const shareSlugSchema = z
  .string()
  .length(32)
  .regex(/^[a-f0-9]+$/);

// A share is a deliberately narrow, immutable copy of an article. In
// particular, it excludes whyWritten, writtenFor, ownership, model, and every
// other field that could disclose the reader's private personalization data.
export const sharedArticleSnapshotSchema = z
  .object({
    version: z.literal(1),
    category: articleCategorySchema,
    kicker: z.string().min(1),
    topic: z.string().min(1),
    title: z.string().min(1),
    deck: z.string().min(1),
    body: z.array(articleBlockSchema).min(1),
    summary: z.array(z.string().min(1)).length(3),
    readingMinutes: z.number().int().positive(),
    sourceCount: z.number().int().nonnegative(),
    researchedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    sources: z.array(articleSourceSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    if (sourceIds.size !== snapshot.sources.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Article sources must have unique IDs.",
      });
    }
    if (snapshot.sourceCount !== snapshot.sources.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceCount"],
        message: "The source count must match the included sources.",
      });
    }
    snapshot.body.forEach((block, blockIndex) => {
      if (block.type === "heading") return;
      if (block.citations.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["body", blockIndex, "citations"],
          message: "Every published prose block must include a citation.",
        });
      }
      block.citations.forEach((citation, citationIndex) => {
        if (!sourceIds.has(citation.sourceId)) {
          context.addIssue({
            code: "custom",
            path: ["body", blockIndex, "citations", citationIndex, "sourceId"],
            message: "Every citation must reference an included source.",
          });
        }
      });
    });
  });

export const publicArticleShareSchema = z.object({
  shareId: uuidSchema,
  slug: shareSlugSchema,
  createdAt: z.string().datetime(),
  article: sharedArticleSnapshotSchema,
});

export type Article = z.infer<typeof articleSchema>;
export type ArticleBlock = z.infer<typeof articleBlockSchema>;
export type ArticleCard = z.infer<typeof articleCardSchema>;
export type ArticleSource = z.infer<typeof articleSourceSchema>;
export type SharedArticleSnapshot = z.infer<
  typeof sharedArticleSnapshotSchema
>;
export type PublicArticleShare = z.infer<typeof publicArticleShareSchema>;
