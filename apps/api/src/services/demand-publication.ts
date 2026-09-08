import { createHash } from "node:crypto";
import { articleSchema } from "@edison/contracts";
import { slugifyArticleTitle, type LoopPrincipleOperation } from "@edison/domain";
import {
  assertOnDemandDraft, assertAcceptedOnDemandArticleCheck, assertAcceptedOnDemandAnswerCheck, onDemandFeedbackOutputSchema,
  type OnDemandCheckOutput, type OnDemandFeedbackOutput, type OnDemandWriterOutput,
  type OnDemandQuestionInput, type OnDemandAnswerOutput, type SelectedOnDemandInput,
} from "@edison/ai";

/** Stable opaque IDs survive a transaction retry without changing citations. */
export function demandArtifactId(value: string) {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function publishableDemandArticle(input: {
  requestId: string; selection: SelectedOnDemandInput; draft: OnDemandWriterOutput;
  check: OnDemandCheckOutput; publishedAt: string;
}) {
  assertOnDemandDraft(input.selection, input.draft);
  if (!input.draft.article) throw new Error("editorial_withheld");
  try { assertAcceptedOnDemandArticleCheck(input.selection, input.draft, input.check); }
  catch { throw new Error("editorial_withheld"); }
  const article = input.draft.article;
  const sources = article.sources.map((source) => {
    const retained = input.selection.evidence.sources.find((candidate) => candidate.id === source.key);
    const retrievedAt = input.selection.evidence.passages.find((passage) =>
      passage.sourceId === source.key && passage.provenance === "retrieved")?.retrievedAt;
    if (!retained || !retrievedAt) throw new Error("evidence_unavailable");
    return { id: demandArtifactId(`${input.requestId}:source:${source.key}`), title: retained.title,
      publisher: retained.publisher, url: retained.url,
      publishedAt: retained.datePrecision === "day" && retained.publishedDate ? `${retained.publishedDate}T00:00:00.000Z` : null,
      accessedAt: retrievedAt };
  });
  const body = article.body.map((block) => block.type === "heading" ? block : {
    ...block,
    citations: block.citations.map((citation) => {
      const sourceId = demandArtifactId(`${input.requestId}:source:${citation.sourceKey}`);
      const index = sources.findIndex((source) => source.id === sourceId);
      if (index < 0) throw new Error("evidence_unavailable");
      // Numeric source labels avoid truncating a publisher into a false name.
      return { sourceId, label: String(index + 1) };
    }),
  });
  const words = body.reduce((total, block) => total + block.text.trim().split(/\s+/u).length, 0);
  return articleSchema.parse({
    id: input.requestId, slug: slugifyArticleTitle(article.title), category: article.category,
    kicker: article.kicker, title: article.title, deck: article.deck,
    readingMinutes: Math.max(1, Math.ceil(words / 220)), sourceCount: sources.length,
    researchedAt: sources.map((source) => source.accessedAt).sort().at(-1) ?? input.publishedAt,
    reason: article.whyWritten, summary: article.summary, saved: false, completed: false,
    topic: article.topic, body, sources, writtenFor: "Your learning loop", shareId: null,
  });
}

export function publishableDemandAnswer(question: OnDemandQuestionInput, answer: OnDemandAnswerOutput, check: OnDemandCheckOutput) {
  try { assertAcceptedOnDemandAnswerCheck(question, answer, check); }
  catch { throw new Error("editorial_withheld"); }
  const sourceKeys = [...new Set(answer.claims.flatMap((claim) => claim.passageIds.map((id) =>
    question.evidence.passages.find((passage) => passage.id === id)?.sourceId).filter((id): id is string => Boolean(id))))];
  if (sourceKeys.some((id) => !question.article.sources.some((source) => source.key === id))) throw new Error("editorial_withheld");
  return { text: answer.answer, sourceIds: sourceKeys.map((id) => demandArtifactId(`${question.articleId}:source:${id}`)) };
}

export function demandFeedbackOperations(requestId: string, feedback: OnDemandFeedbackOutput): LoopPrincipleOperation[] {
  onDemandFeedbackOutputSchema.parse(feedback);
  if (feedback.status !== "changes" || !feedback.operations.length) throw new Error("feedback_unclear");
  return feedback.operations.map((operation, index) => operation.type === "remove"
    ? { op: "remove", principleId: operation.targetPrincipleId }
    : operation.targetPrincipleId
      ? { op: "replace", principleId: operation.targetPrincipleId, kind: operation.kind, instruction: operation.instruction }
      : { op: "add", principle: { id: demandArtifactId(`${requestId}:principle:${index}`), kind: operation.kind, instruction: operation.instruction } });
}
