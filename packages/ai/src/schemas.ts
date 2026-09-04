import { z } from "zod";
import {
  articleCategorySchema,
  preferenceChangeSchema,
  sourceUrlSchema,
} from "@edison/contracts";

const generatedCitationSchema = z.object({
  sourceKey: z.string().min(1).max(40),
  label: z.string().min(1).max(24),
});

const generatedBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paragraph"),
    text: z.string().min(1),
    // Generated prose is only publishable when it is grounded. Headings are
    // the sole body block that may omit citations.
    citations: z.array(generatedCitationSchema).min(1),
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
    citations: z.array(generatedCitationSchema).min(1),
  }),
]);

const generatedSourceShape = {
  key: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(160),
  publishedAt: z.string().datetime().nullable(),
};

const generatedSourceFormatSchema = z.object({
  ...generatedSourceShape,
  // The provider-facing strict JSON schema cannot represent sourceUrlSchema's
  // custom protocol/credential refinement. Repeat its representable bounds
  // here, then apply the canonical contract schema before publication below.
  url: z.string().url().max(2048),
});

const generatedSourceSchema = z.object({
  ...generatedSourceShape,
  url: sourceUrlSchema,
});

const generatedArticleShape = {
  category: articleCategorySchema,
  kicker: z.string().min(1).max(100),
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(180),
  deck: z.string().min(1).max(500),
  summary: z.array(z.string().min(1).max(280)).length(3),
  whyWritten: z.string().min(1).max(600),
  readingMinutes: z.number().int().min(3).max(20),
  body: z.array(generatedBlockSchema).min(6).max(40),
};

export const generatedArticleFormatSchema = z.object({
  ...generatedArticleShape,
  sources: z.array(generatedSourceFormatSchema).min(2).max(20),
});

const generatedArticlePublicationSchema = z.object({
  ...generatedArticleShape,
  sources: z.array(generatedSourceSchema).min(2).max(20),
});

export const generatedArticleSchema = generatedArticlePublicationSchema.superRefine(
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

    article.body.forEach((block, blockIndex) => {
      if (block.type === "heading") return;

      block.citations.forEach((citation, citationIndex) => {
        if (keys.has(citation.sourceKey)) return;
        context.addIssue({
          code: "custom",
          path: ["body", blockIndex, "citations", citationIndex, "sourceKey"],
          message: "Every citation must reference an included source.",
        });
      });
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
