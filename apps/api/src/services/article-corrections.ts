import { sql } from "drizzle-orm";
import { uuidSchema } from "@edison/contracts";
import type { UserTransaction } from "@edison/db";
import { z } from "zod";

const articleCorrectionDisclosureRowSchema = z.object({
  note: z.string().trim().min(1).max(500),
  correctedAt: z.preprocess(
    (value) => (typeof value === "string" ? new Date(value) : value),
    z.date(),
  ),
});

export type ArticleCorrectionDisclosure = {
  note: string;
  correctedAt: string;
};

export async function getArticleCorrectionDisclosure(
  transaction: UserTransaction,
  rawArticleId: string,
): Promise<ArticleCorrectionDisclosure | null> {
  const articleId = uuidSchema.parse(rawArticleId);
  const [rawDisclosure] = await transaction.execute(sql`
    select
      correction_note as "note",
      corrected_at as "correctedAt"
    from private.read_article_correction_disclosure(${articleId})
  `);

  if (!rawDisclosure) return null;
  const disclosure = articleCorrectionDisclosureRowSchema.parse(rawDisclosure);
  return {
    note: disclosure.note,
    correctedAt: disclosure.correctedAt.toISOString(),
  };
}
