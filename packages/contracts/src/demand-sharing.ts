import { z } from "zod";
import { articleBlockSchema, articleSourceSchema } from "./articles";
import { idempotencyKeySchema } from "./common";

export const DEMAND_SHARE_MAX_BYTES = 262_144;
export const demandShareTokenSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/);

/** A separate contract: legacy shares still require fully researched prose. */
export const demandSharedArticleSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(300),
  deck: z.string().min(1).max(500),
  body: z.array(articleBlockSchema).min(1).max(160),
  sources: z.array(articleSourceSchema).max(20),
  sourceCount: z.number().int().min(0).max(20),
  basis: z.enum(["general_knowledge", "researched", "mixed"]),
  researchedAt: z.string().datetime().nullable(),
  readingMinutes: z.number().int().positive().max(1000),
  publishedAt: z.string().datetime(),
  correction: z.object({ note: z.string().trim().min(1).max(500),
    correctedAt: z.string().datetime() }).strict().nullable(),
}).strict().superRefine((article, context) => {
  const sourceIds = new Set(article.sources.map((source) => source.id));
  if (sourceIds.size !== article.sources.length || article.sourceCount !== article.sources.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "Share source identities and count must match." });
  }
  const researched = article.basis !== "general_knowledge";
  if (researched !== (article.sources.length > 0) || researched !== (article.researchedAt !== null)) {
    context.addIssue({ code: "custom", path: ["basis"], message: "Share research basis and retained sources must agree." });
  }
  article.body.forEach((block, index) => {
    if (block.type !== "heading" && block.citations.some((citation) => !sourceIds.has(citation.sourceId))) {
      context.addIssue({ code: "custom", path: ["body", index, "citations"], message: "A share citation must use an included source." });
    }
  });
  if (new TextEncoder().encode(JSON.stringify(article)).byteLength > DEMAND_SHARE_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "The public article exceeds the bounded snapshot size." });
  }
});

export const createDemandArticleShareSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  confirmPublic: z.literal(true),
}).strict();

export const demandArticleShareReceiptSchema = z.object({
  token: demandShareTokenSchema,
  createdAt: z.string().datetime(),
  created: z.boolean(),
}).strict();

export const publicDemandArticleShareSchema = z.object({
  token: demandShareTokenSchema,
  createdAt: z.string().datetime(),
  article: demandSharedArticleSchema,
}).strict();

export type DemandSharedArticle = z.infer<typeof demandSharedArticleSchema>;
export type CreateDemandArticleShare = z.infer<typeof createDemandArticleShareSchema>;
export type DemandArticleShareReceipt = z.infer<typeof demandArticleShareReceiptSchema>;
export type PublicDemandArticleShare = z.infer<typeof publicDemandArticleShareSchema>;
