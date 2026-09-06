import { createHash } from "node:crypto";
import {
  answerOnDemandQuestion, assertAcceptedOnDemandAnswerCheck,
  assertAcceptedOnDemandArticleCheck, assertOnDemandEvidence, checkOnDemandAnswer,
  checkOnDemandArticle, checkOnDemandIdeas, getArticleModel, getUtilityModel,
  interpretLoopFeedback, onDemandAnswerOutputSchema,
  onDemandCheckOutputSchema, onDemandContextSchema, onDemandEvidenceSchema,
  onDemandFeedbackOutputSchema, onDemandResearchOutputSchema, onDemandWriterOutputSchema,
  ProviderResponseValidationError, repairOnDemandArticle, researchOnDemandIdeas,
  writeOnDemandArticle,
  type OnDemandAnswerOutput, type OnDemandCheckOutput, type OnDemandContext,
  type OnDemandEvidence, type OnDemandFeedbackOutput, type OnDemandIdea,
  type OnDemandProvider, type OnDemandQuestionInput, type OnDemandResearchOutput,
  type OnDemandStageOptions, type OnDemandWriterOutput, type SelectedOnDemandInput,
} from "@edison/ai";
import { assembleLoopPrincipleContext, type LoopPrincipleState } from "@edison/domain";
import { HttpError } from "../http/errors";
import { DemandUsagePersistenceError, durableDemandProvider } from "./demand-provider-stages";
import { evidencePassageOccurs, normalizeEvidencePassage, retrieveEvidencePage } from "./evidence-retrieval";
import type { DemandRequestRow } from "./demand-reading";

export const DEMAND_EVIDENCE_PACKET_BYTES = 40_000;
type Kind = DemandRequestRow["kind"];
type RetrievalProgress = { nextSourceIndex: number; failures: Array<{ sourceId: string; code: string }> };
export type DemandPipelineState = Record<string, unknown> & {
  phase: string;
  version?: 1;
  requestId?: string;
  requestFingerprint?: string;
  kind?: Kind;
  models?: { article: string; utility: string };
  research?: OnDemandResearchOutput;
  retrieval?: RetrievalProgress;
  evidence?: OnDemandEvidence;
  ideas?: OnDemandIdea[];
  draft?: OnDemandWriterOutput;
  check?: OnDemandCheckOutput;
  feedback?: OnDemandFeedbackOutput;
  answer?: OnDemandAnswerOutput;
  failureCode?: string;
};
type AdvanceResult = { state: DemandPipelineState; outcome?: Kind; failureCode?: string };

export function initialDemandPhase(kind: Kind): string {
  return { ideas: "research", article: "write", feedback: "feedback", question: "answer" }[kind];
}

class PipelineFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(state: DemandPipelineState, code: string): AdvanceResult {
  return { state: { ...state, phase: "failed", failureCode: code }, failureCode: code };
}
function packetSize(packet: OnDemandEvidence) {
  return Buffer.byteLength(JSON.stringify(packet), "utf8");
}
function boundedEvidence(value: unknown): OnDemandEvidence {
  const packet = onDemandEvidenceSchema.parse(value);
  assertOnDemandEvidence(packet);
  if (packetSize(packet) > DEMAND_EVIDENCE_PACKET_BYTES) throw new PipelineFailure("evidence_limit");
  return packet;
}

function selected(request: DemandRequestRow, context: OnDemandContext): SelectedOnDemandInput {
  const selection = request.snapshot.selection as { idea?: OnDemandIdea; evidence?: unknown } | undefined;
  if (!selection?.idea || selection.idea.loopId !== request.loopId || !selection.idea.id || !selection.idea.headline || (request.ideaId !== null && selection.idea.id !== request.ideaId)) throw new PipelineFailure("pipeline_snapshot_invalid");
  return { context, idea: selection.idea, evidence: boundedEvidence(selection.evidence) };
}

function questionInput(request: DemandRequestRow): OnDemandQuestionInput {
  const question = request.snapshot.question as {
    question?: string; articleVersion?: string; draft?: unknown; evidence?: unknown;
    previousMessages?: Array<{ role: "user" | "assistant"; text: string }>;
  } | undefined;
  const draft = onDemandWriterOutputSchema.parse(question?.draft);
  if (!question?.articleVersion || !question.question || draft.status !== "written" || !draft.article || !Array.isArray(question.previousMessages) || question.previousMessages.some((message) => !["user", "assistant"].includes(message.role) || typeof message.text !== "string")) throw new PipelineFailure("pipeline_snapshot_invalid");
  // Each generated-request UUID denotes one immutable article version. The AI
  // DTO's numeric version is 1 within that immutable article identity.
  return { articleId: question.articleVersion, articleVersion: 1, article: draft.article,
    evidence: boundedEvidence(question.evidence), question: question.question, conversation: question.previousMessages };
}

function actualPassages(
  source: OnDemandResearchOutput["sources"][number],
  page: Awaited<ReturnType<typeof retrieveEvidencePage>>,
  research: OnDemandResearchOutput,
) {
  const actual = normalizeEvidencePassage(page.text);
  const leads = research.passages.filter((passage) => passage.sourceId === source.id);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const lead of leads) {
    if (!evidencePassageOccurs(actual, lead.text)) continue;
    const text = normalizeEvidencePassage(lead.text);
    const at = actual.indexOf(text);
    const range = { start: Math.max(0, at - 400), end: Math.min(actual.length, at + text.length + 700) };
    if (!ranges.some((existing) => range.start < existing.end && range.end > existing.start)) ranges.push(range);
    if (ranges.length === 2) break;
  }
  if (!ranges.length) {
    // An unmatched model excerpt is NEVER relabeled as retrieved. Take a small
    // actual page window as new evidence, which the separate checker may reject.
    const terms = [...new Set(leads.flatMap((lead) => lead.text.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? []))]
      .filter((term) => !new Set(["which", "there", "their", "about", "these", "those", "would", "could", "should", "source", "study"]).has(term)).slice(0, 24);
    const lower = actual.toLowerCase();
    // Round-robin occurrences give every lead term a candidate before repeated
    // menu words can consume the bounded search. Score distinct-term coverage,
    // not frequency, so a navigation heading is not preferred to useful prose.
    const positions = new Set([0]);
    const cursors = terms.map((term) => lower.indexOf(term));
    for (let round = 0; round < 64 && positions.size < 64 && cursors.some((position) => position >= 0); round++) {
      for (let index = 0; index < terms.length && positions.size < 64; index++) {
        const position = cursors[index];
        if (position < 0) continue;
        positions.add(position);
        cursors[index] = lower.indexOf(terms[index], position + terms[index].length);
      }
    }
    let best = { start: 0, end: Math.min(actual.length, 2200), score: -1 };
    for (const position of positions) {
      const start = Math.max(0, position - 300);
      const end = Math.min(actual.length, start + 2200);
      const window = lower.slice(start, end);
      const score = terms.filter((term) => window.includes(term)).length;
      if (score > best.score || (score === best.score && start < best.start)) best = { start, end, score };
    }
    ranges.push({ start: best.start, end: best.end });
  }
  return ranges.map(({ start, end }) => ({
    id: `p-${createHash("sha256").update(`${source.id}:${page.url}:${start}:${end}:${actual.slice(start, end)}`).digest("hex").slice(0, 28)}`,
    sourceId: source.id, text: actual.slice(start, end),
    locator: `Retrieved normalized page text, characters ${start + 1}–${end}`,
    provenance: "retrieved" as const, retrievedAt: page.retrievedAt,
  }));
}

async function retrieveGroup(state: DemandPipelineState, retrievePage: typeof retrieveEvidencePage): Promise<AdvanceResult> {
  const research = onDemandResearchOutputSchema.parse(state.research);
  const progress = state.retrieval;
  if (!progress || !Number.isInteger(progress.nextSourceIndex) || progress.nextSourceIndex < 0 || progress.nextSourceIndex > research.sources.length || !Array.isArray(progress.failures)) throw new PipelineFailure("pipeline_state_invalid");
  const packet = boundedEvidence(state.evidence);
  const group = research.sources.slice(progress.nextSourceIndex, progress.nextSourceIndex + 4);
  const results = await Promise.all(group.map(async (source) => {
    try {
      const page = await retrievePage(source.url);
      const hostname = new URL(page.url).hostname;
      return {
        source: { ...source, url: page.url, title: (page.title?.trim() || hostname).slice(0, 300), publisher: hostname,
          publishedDate: null, datePrecision: "unknown" as const },
        passages: actualPassages(source, page, research),
      };
    } catch { return { failure: { sourceId: source.id, code: "evidence_unavailable" } }; }
  }));
  const evidence: OnDemandEvidence = { sources: [...packet.sources], passages: [...packet.passages] };
  const failures = [...progress.failures];
  for (const result of results) {
    if (result.failure) failures.push(result.failure);
    else {
      // Redirect aliases cannot silently become two allegedly independent sources.
      if (evidence.sources.some((source) => source.url === result.source.url)) {
        failures.push({ sourceId: result.source.id, code: "duplicate_source_url" });
        continue;
      }
      evidence.sources.push(result.source);
      evidence.passages.push(...result.passages);
    }
  }
  // Do not silently trim source evidence or reader constraints to fit a budget.
  if (packetSize(evidence) > DEMAND_EVIDENCE_PACKET_BYTES) return fail(state, "evidence_limit");
  boundedEvidence(evidence);
  const nextSourceIndex = progress.nextSourceIndex + group.length;
  const next = { ...state, evidence, retrieval: { nextSourceIndex, failures } };
  if (nextSourceIndex < research.sources.length) return { state: next };
  if (!evidence.passages.length) return fail(next, "evidence_unavailable");
  return { state: { ...next, phase: "ideas_check" } };
}

function ready(state: DemandPipelineState, request: DemandRequestRow): AdvanceResult {
  const kind = request.kind;
  try {
    if (kind === "article") {
      if (!state.draft || !state.check) throw new PipelineFailure("editorial_withheld");
      assertAcceptedOnDemandArticleCheck(selected(request, onDemandContextSchema.parse(request.snapshot.context)), state.draft, state.check);
    }
    if (kind === "question") {
      if (!state.answer || !state.check) throw new PipelineFailure("editorial_withheld");
      assertAcceptedOnDemandAnswerCheck(questionInput(request), state.answer, state.check);
    }
  } catch { return fail(state, "editorial_withheld"); }
  if (kind === "ideas" && !state.ideas?.length) return fail(state, "evidence_unavailable");
  if (kind === "feedback" && state.feedback?.status !== "changes") return fail(state, "feedback_unclear");
  return { state: { ...state, phase: "ready" }, outcome: kind };
}

/** No direct database writes. The caller persists each returned state under its
 * request lease before advancing; supplied providers/retrievers make this pure
 * orchestration testable without paid calls or network access. */
export async function advanceDemandPipeline(
  input: { request: DemandRequestRow; state: DemandPipelineState },
  dependencies: { provider?: OnDemandProvider; retrievePage?: typeof retrieveEvidencePage } = {},
): Promise<AdvanceResult> {
  const { request } = input;
  const state = structuredClone(input.state);
  try {
    if ((state.requestId && state.requestId !== request.id) || (state.requestFingerprint && state.requestFingerprint !== request.requestFingerprint) || (state.kind && state.kind !== request.kind) || (state.version !== undefined && state.version !== 1)) throw new PipelineFailure("pipeline_state_invalid");
    if (!state.models || !state.requestId || !state.requestFingerprint || !state.kind || !state.version) {
      // A phase-only initializer performs no provider/fetch work. Model selection
      // becomes durable in the caller before the first possible paid request.
      return { state: { ...state, version: 1, requestId: request.id, requestFingerprint: request.requestFingerprint, kind: request.kind,
        models: state.models ?? { article: getArticleModel(), utility: getUtilityModel() } } };
    }
    if (!state.models.article || !state.models.utility) throw new PipelineFailure("pipeline_state_invalid");
    if (state.phase === "failed") return fail(state, state.failureCode ?? "preparation_failed");
    if (state.phase === "ready") return ready(state, request);
    const context = onDemandContextSchema.parse(request.snapshot.context);
    if (context.loopId !== request.loopId) throw new PipelineFailure("pipeline_snapshot_invalid");
    const provider = dependencies.provider ?? durableDemandProvider(request.id, request.principalId);
    const options: OnDemandStageOptions = {
      provider, model: state.phase === "write" || state.phase === "repair" ? state.models.article : state.models.utility,
      idempotencyKey: `${request.id}:${state.phase}`, safetyIdentifier: request.principalId,
    };
    if (request.kind === "ideas") {
      if (state.phase === "research") {
        const researched = await researchOnDemandIdeas(context, options);
        if (!researched.output.ideas.length) return fail({ ...state, research: researched.output }, "evidence_unavailable");
        return { state: { ...state, phase: "retrieve", research: researched.output, evidence: { sources: [], passages: [] }, retrieval: { nextSourceIndex: 0, failures: [] } } };
      }
      if (state.phase === "retrieve") return await retrieveGroup(state, dependencies.retrievePage ?? retrieveEvidencePage);
      if (state.phase === "ideas_check") {
        const result = await checkOnDemandIdeas({ context, research: onDemandResearchOutputSchema.parse(state.research), evidence: boundedEvidence(state.evidence), batchId: request.id }, options);
        return ready({ ...state, ideas: result.ideas, ideaCheck: result.output }, request);
      }
    }
    if (request.kind === "article") {
      const selection = selected(request, context);
      if (state.phase === "write") {
        const result = await writeOnDemandArticle(selection, options);
        const next = { ...state, draft: result.output, evidence: selection.evidence };
        return result.output.status === "written" ? { state: { ...next, phase: "check" } } : fail(next, "editorial_withheld");
      }
      if (state.phase === "check" || state.phase === "recheck") {
        const result = await checkOnDemandArticle({ ...selection, draft: onDemandWriterOutputSchema.parse(state.draft) }, options);
        const next = { ...state, check: result.output };
        if (result.accepted) return ready(next, request);
        return state.phase === "check" && result.output.verdict !== "insufficient_evidence" ? { state: { ...next, phase: "repair" } } : fail(next, "editorial_withheld");
      }
      if (state.phase === "repair") {
        const result = await repairOnDemandArticle({ ...selection, draft: onDemandWriterOutputSchema.parse(state.draft), check: onDemandCheckOutputSchema.parse(state.check) }, options);
        const next = { ...state, draft: result.output };
        return result.output.status === "written" ? { state: { ...next, phase: "recheck" } } : fail(next, "editorial_withheld");
      }
    }
    if (request.kind === "feedback" && state.phase === "feedback") {
      const principleState = request.snapshot.principleState as LoopPrincipleState;
      const assembled = assembleLoopPrincipleContext(principleState);
      const feedback = request.snapshot.feedback as { operation?: string; text?: string } | undefined;
      if (!assembled.ok || principleState.loopId !== request.loopId || principleState.revision !== context.revision || feedback?.operation !== "apply" || !feedback.text) throw new PipelineFailure("pipeline_snapshot_invalid");
      const result = await interpretLoopFeedback({ loopId: request.loopId, revision: context.revision, originalCuriosity: context.originalCuriosity,
        principles: principleState.principles.filter((principle) => principle.status === "active").map(({ id, kind, instruction }) => ({ id, kind, instruction })), feedback: feedback.text }, options);
      return ready({ ...state, feedback: onDemandFeedbackOutputSchema.parse(result.output) }, request);
    }
    if (request.kind === "question") {
      const question = questionInput(request);
      if (state.phase === "answer") {
        const result = await answerOnDemandQuestion(question, options);
        return { state: { ...state, answer: result.output, evidence: question.evidence, phase: "answer_check" } };
      }
      if (state.phase === "answer_check") {
        const result = await checkOnDemandAnswer({ ...question, answer: onDemandAnswerOutputSchema.parse(state.answer) }, options);
        return result.accepted ? ready({ ...state, check: result.output }, request) : fail({ ...state, check: result.output }, "editorial_withheld");
      }
    }
    throw new PipelineFailure("pipeline_state_invalid");
  } catch (error) {
    // Preserve observed usage for the runner's recovery path; converting this
    // into a normal failure would hide an unrecorded billable response.
    if (error instanceof DemandUsagePersistenceError || (error instanceof HttpError && error.code === "provider_stage_busy")) throw error;
    if (error instanceof PipelineFailure) return fail(state, error.code);
    if (error instanceof ProviderResponseValidationError) return fail(state, "provider_invalid");
    if (error instanceof HttpError) return fail(state, error.code);
    return fail(state, "provider_invalid");
  }
}
