import { z } from "zod";

export const articleCategories = [
  "tech-science",
  "business",
  "arts-culture",
  "sports",
  "entertainment",
] as const;

export const contentCategorySchema = z.enum(["for-you", ...articleCategories]);

export type ContentCategory = z.infer<typeof contentCategorySchema>;

export const articleCategorySchema = z.enum(articleCategories);
export type ArticleCategory = z.infer<typeof articleCategorySchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationSchema = z.object({
  nextCursor: z.string().nullable(),
});

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const uuidSchema = z.string().uuid();
