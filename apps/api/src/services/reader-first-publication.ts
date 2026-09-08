import {
  assertAcceptedReaderFirstAnswerCheck, assertAcceptedReaderFirstArticleCheck,
  type OnDemandEvidence, type ReaderFirstArticle, type ReaderFirstBlock,
  type ReaderFirstWriterOutput, type ReaderFirstAnswerOutput, type ReaderFirstCheckOutput,
  type ReaderFirstQuestion, type ReaderFirstSelection, type ReaderFirstCheckerContractVersion,
} from "@edison/ai";
import { demandAnswerV2Schema, demandArticleSchema } from "@edison/contracts";
import { slugifyArticleTitle } from "@edison/domain";
import { demandArtifactId } from "./demand-publication";

function presentation(requestId: string, body: ReaderFirstBlock[], sourceList: ReaderFirstArticle["sources"], evidence: OnDemandEvidence) {
  const sources = sourceList.map((source) => {
    const retained = evidence.sources.find((candidate) => candidate.id === source.key);
    const accessedAt = evidence.passages.filter((passage) => passage.sourceId === source.key &&
      passage.provenance === "retrieved" && passage.retrievedAt).map((passage) => passage.retrievedAt!).sort().at(-1);
    if (!retained || !accessedAt) throw new Error("evidence_unavailable");
    return { id: demandArtifactId(`${requestId}:source:${source.key}`), title: retained.title,
      publisher: retained.publisher, url: retained.url,
      publishedAt: retained.datePrecision === "day" && retained.publishedDate ? `${retained.publishedDate}T00:00:00.000Z` : null,
      accessedAt };
  });
  const publishedBody = body.map((block) => block.type === "heading" ? block : {
    ...block, citations: block.citations.map((citation) => {
      const index = sourceList.findIndex((source) => source.key === citation.sourceKey);
      if (index < 0) throw new Error("evidence_unavailable");
      return { sourceId: sources[index].id, label: String(index + 1) };
    }),
  });
  return { body: publishedBody, sources,
    basis: sources.length ? "mixed" as const : "general_knowledge" as const,
    researchedAt: sources.map((source) => source.accessedAt).sort().at(-1) ?? null };
}

export function publishReaderFirstArticle(input: {
  requestId: string; selection: ReaderFirstSelection; draft: ReaderFirstWriterOutput; check: ReaderFirstCheckOutput;
  checkerContractVersion?: ReaderFirstCheckerContractVersion;
}) {
  try { assertAcceptedReaderFirstArticleCheck(input.selection, input.draft, input.check, { checkerContractVersion: input.checkerContractVersion }); }
  catch { throw new Error("editorial_withheld"); }
  const article = input.draft.article!;
  const published = presentation(input.requestId, article.body, article.sources, input.selection.evidence);
  const words = published.body.reduce((count, block) => count + block.text.trim().split(/\s+/u).length, 0);
  return demandArticleSchema.parse({
    id: input.requestId, slug: slugifyArticleTitle(article.title), category: article.category,
    kicker: article.kicker, title: article.title, deck: article.deck,
    readingMinutes: Math.max(1, Math.ceil(words / 220)), sourceCount: published.sources.length,
    ...published, reason: article.whyWritten, summary: article.summary, saved: false, completed: false,
    topic: article.topic, writtenFor: "Your learning loop", shareId: null,
  });
}

export function publishReaderFirstAnswer(input: {
  requestId: string; question: ReaderFirstQuestion; answer: ReaderFirstAnswerOutput; check: ReaderFirstCheckOutput;
  checkerContractVersion?: ReaderFirstCheckerContractVersion;
}) {
  try { assertAcceptedReaderFirstAnswerCheck(input.question, input.answer, input.check, { checkerContractVersion: input.checkerContractVersion }); }
  catch { throw new Error("editorial_withheld"); }
  return demandAnswerV2Schema.parse({ version: 2,
    ...presentation(input.requestId, input.answer.body, input.answer.sources, input.question.evidence) });
}
