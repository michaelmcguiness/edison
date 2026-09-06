import {
  onDemandContextSchema, onDemandEvidenceSchema, onDemandWriterOutputSchema,
  readerFirstWriterOutputSchema, type ReaderFirstWriterOutput,
} from "@edison/ai";
import { demandAnswerSchema, demandArticleSchema } from "@edison/contracts";

/** Historical results are adapted in memory, never rewritten or re-approved. */
export function readDemandStoredDraft(value: unknown): ReaderFirstWriterOutput {
  const current = readerFirstWriterOutputSchema.safeParse(value);
  if (current.success) return current.data;
  const previous = onDemandWriterOutputSchema.parse(value);
  // A v1-valid saved paragraph may exceed a new author's per-block allowance.
  // Preserve that historical input after its original validation; only new
  // provider output is held to the new authoring contract.
  return {
    status: previous.status,
    article: previous.article,
    research: { sources: [], passages: [] },
    reason: previous.reason,
  };
}

/** New answers own their evidence; old ID-only answers stay readable as saved. */
export function demandAnswerConversationText(value: unknown): string {
  const answer = demandAnswerSchema.parse(value);
  return "body" in answer ? answer.body.map((block) => block.text +
    (block.type === "quote" && block.attribution ? ` — ${block.attribution}` : "")).join("\n\n") : answer.text;
}

export function demandPreviousArticleContext(value: unknown) {
  const article = demandArticleSchema.safeParse(value);
  return article.success ? [{ title: article.data.title, summary: article.data.summary }] : [];
}

/** The evidence belongs to the immutable generated article, not a newer idea. */
export function demandQuestionMaterial(input: {
  articleId: string;
  articleResult: Record<string, unknown>;
  articleProgress: Record<string, unknown> | null;
  articleContext: unknown;
  currentContext: unknown;
  legacyIdeaEvidence: unknown;
  currentDate: string;
}) {
  const draft = readDemandStoredDraft(input.articleResult.draft);
  if (draft.status !== "written" || !draft.article) throw new Error("article_not_ready");
  const evidence = onDemandEvidenceSchema.parse(
    input.articleResult.evidence ?? input.articleProgress?.evidence ?? input.legacyIdeaEvidence,
  );
  // Freeze today's reader instructions for this question, not the older
  // article's preferences. Its original draft/evidence are still immutable.
  const originalContext = onDemandContextSchema.parse(input.articleContext);
  const context = onDemandContextSchema.parse({
    ...onDemandContextSchema.parse(input.currentContext), currentDate: input.currentDate,
  });
  if (context.loopId !== originalContext.loopId || context.revision < originalContext.revision ||
    context.originalCuriosity !== originalContext.originalCuriosity) throw new Error("pipeline_snapshot_invalid");
  return { context, articleVersion: input.articleId, draft, evidence,
    storedDraft: structuredClone(input.articleResult.draft) };
}
