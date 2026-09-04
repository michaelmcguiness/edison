import { z } from "zod";
import { articleCategorySchema, preferenceChangeSchema } from "@edison/contracts";

const generatedCitationSchema = z.object({
  sourceKey: z.string().min(1).max(40),
  label: z.string().min(1).max(24),
});

const generatedBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paragraph"),
    text: z.string().min(1),
    citations: z.array(generatedCitationSchema),
  }),
  z.object({
    type: z.literal("heading"),
    level: z.literal(2),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string().min(1),
    attribution: z.string().max(240).nullable(),
    citations: z.array(generatedCitationSchema),
  }),
]);

export const generatedArticleFormatSchema = z.object({
    category: articleCategorySchema,
    kicker: z.string().min(1).max(100),
    topic: z.string().min(1).max(200),
    title: z.string().min(1).max(180),
    deck: z.string().min(1).max(500),
    summary: z.array(z.string().min(1).max(280)).length(3),
    whyWritten: z.string().min(1).max(600),
    readingMinutes: z.number().int().min(3).max(20),
    body: z.array(generatedBlockSchema).min(6).max(40),
    sources: z
      .array(
        z.object({
          key: z.string().min(1).max(40),
          title: z.string().min(1).max(300),
          publisher: z.string().min(1).max(160),
          url: z.string().url(),
          publishedAt: z.string().datetime().nullable(),
        }),
      )
      .min(2)
      .max(20),
  });

export const generatedArticleSchema = generatedArticleFormatSchema.superRefine(
  (article, context) => {
    const keys = new Set<string>();
    const urls = new Set<string>();

    article.sources.forEach((source, index) => {
      if (keys.has(source.key)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "key"],
          message: "Source keys must be unique.",
        });
      }
      if (urls.has(source.url)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "url"],
          message: "Source URLs must be unique.",
        });
      }
      keys.add(source.key);
      urls.add(source.url);
    });
  },
);

export const parsedPreferenceCommandSchema = z.object({
  changes: z.array(preferenceChangeSchema).max(8),
  confirmation: z.string().min(1).max(280),
});

export const articleAnswerSchema = z.object({
  answer: z.string().min(1).max(8000),
  citations: z.array(generatedCitationSchema).max(12),
});

export type GeneratedArticle = z.infer<typeof generatedArticleSchema>;
export type ParsedPreferenceCommand = z.infer<
  typeof parsedPreferenceCommandSchema
>;
export type ArticleAnswer = z.infer<typeof articleAnswerSchema>;
