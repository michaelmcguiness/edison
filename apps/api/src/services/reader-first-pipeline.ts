import {
  answerReaderFirstQuestion, assertAcceptedReaderFirstAnswerCheck, assertAcceptedReaderFirstArticleCheck,
  assertOnDemandEvidence, checkReaderFirstAnswer, checkReaderFirstArticle, checkReaderFirstIdeas,
  compileReaderFirstAnswer, compileReaderFirstArticle, generateReaderFirstIdeas,
  onDemandContextSchema, onDemandEvidenceSchema, ProviderResponseValidationError,
  readerFirstAnswerOutputSchema, readerFirstCheckOutputSchema, readerFirstIdeaSchema,
  readerFirstResearchOutputSchema, readerFirstResearchSchema, readerFirstWriterOutputSchema,
  ReaderFirstDraftValidationError, repairReaderFirstAnswer, repairReaderFirstArticle, writeReaderFirstArticle,
  type OnDemandContext, type OnDemandEvidence, type OnDemandProvider, type OnDemandProviderResponse,
  type ReaderFirstAnswerOutput, type ReaderFirstCheckOutput, type ReaderFirstValidationFinding, type ReaderFirstIdea,
  type ReaderFirstQuestion, type ReaderFirstResearch, type ReaderFirstResearchOutput,
  type ReaderFirstSelection, type ReaderFirstStageOptions, type ReaderFirstWriterOutput,
} from "@edison/ai";
import { HttpError } from "../http/errors";
import { DemandUsagePersistenceError, durableDemandProvider } from "./demand-provider-stages";
import { selectDemandEvidencePassages } from "./demand-evidence-passages";
import { DEMAND_EVIDENCE_PACKET_BYTES } from "./demand-pipeline";
import type { DemandRequestRow } from "./demand-reading";
import { readDemandStoredDraft } from "./demand-result-compatibility";
import { evidenceUrl, retrieveEvidencePage } from "./evidence-retrieval";

type Acquisition = {
  research: ReaderFirstResearch;
  nextSourceIndex: number;
  after: "ideas_check" | "check" | "recheck" | "answer_check" | "answer_recheck";
  failures: Array<{ sourceId: string; code: string }>;
  queries: string[];
  qualifications: string[];
};
export type ReaderFirstPipelineState = Record<string, unknown> & {
  version: 2;
  phase: string;
  requestId: string;
  requestFingerprint: string;
  kind: DemandRequestRow["kind"];
  models: { article: string; utility: string };
  research?: ReaderFirstResearchOutput;
  evidence?: OnDemandEvidence;
  acquisition?: Acquisition;
  ideas?: ReaderFirstIdea[];
  draft?: ReaderFirstWriterOutput;
  answer?: ReaderFirstAnswerOutput;
  check?: ReaderFirstCheckOutput;
  deterministicFindings?: ReaderFirstValidationFinding[];
  repairAttempted?: boolean;
  failureCode?: string;
};
type AdvanceResult = { state: ReaderFirstPipelineState; outcome?: DemandRequestRow["kind"]; failureCode?: string };

export function initialReaderFirstPhase(kind: DemandRequestRow["kind"]) {
  return { ideas: "ideas", article: "write", question: "answer", feedback: "feedback" }[kind];
}

function fail(state: ReaderFirstPipelineState, code: string): AdvanceResult {
  return { state: { ...state, phase: "failed", failureCode: code }, failureCode: code };
}
function stop(code: string): never { throw new HttpError(503, code, "This explanation could not be safely prepared."); }

export function boundedReaderFirstEvidence(value: unknown): OnDemandEvidence {
  const evidence = onDemandEvidenceSchema.parse(value);
  assertOnDemandEvidence(evidence);
  if (Buffer.byteLength(JSON.stringify(evidence), "utf8") > DEMAND_EVIDENCE_PACKET_BYTES) stop("evidence_limit");
  return evidence;
}

export function readerFirstSelection(request: DemandRequestRow, evidence?: OnDemandEvidence): ReaderFirstSelection {
  const context = onDemandContextSchema.parse(request.snapshot.context);
  const selection = request.snapshot.selection as { idea?: unknown; evidence?: unknown } | undefined;
  const idea = readerFirstIdeaSchema.parse(selection?.idea);
  if (context.loopId !== request.loopId || idea.loopId !== request.loopId ||
    (request.ideaId !== null && request.ideaId !== idea.id) || idea.loopRevision > context.revision) stop("pipeline_snapshot_invalid");
  return { context, idea, evidence: boundedReaderFirstEvidence(evidence ?? selection?.evidence) };
}

export function readerFirstQuestion(request: DemandRequestRow, evidence?: OnDemandEvidence): ReaderFirstQuestion {
  const context = onDemandContextSchema.parse(request.snapshot.context);
  const question = request.snapshot.question as {
    articleVersion?: string; question?: string; draft?: unknown; evidence?: unknown;
    previousMessages?: Array<{ role: "user" | "assistant"; text: string }>;
  } | undefined;
  if (context.loopId !== request.loopId || !question?.articleVersion || !question.question ||
    !Array.isArray(question.previousMessages) || question.previousMessages.length > 12 ||
    question.previousMessages.some((message) => !["user", "assistant"].includes(message.role) ||
      typeof message.text !== "string" || message.text.length > 8000)) stop("pipeline_snapshot_invalid");
  const draft = readDemandStoredDraft(question.draft);
  if (draft.status !== "written" || !draft.article) stop("pipeline_snapshot_invalid");
  return { context, articleVersion: question.articleVersion, draft,
    evidence: boundedReaderFirstEvidence(evidence ?? question.evidence), question: question.question,
    previousMessages: question.previousMessages };
}

function consultedUrls(response: Pick<OnDemandProviderResponse, "researchProvenance">) {
  const provenance = response.researchProvenance;
  return new Set((provenance ? [...provenance.consultedUrls, ...provenance.openedUrls, ...provenance.citedUrls] : [])
    .flatMap((url) => {
      // Unused search results may have non-fetchable URLs. They confer no
      // permission and must not poison an unrelated valid source selection.
      try { return [evidenceUrl(url).href]; } catch { return []; }
    }));
}

/** Model excerpts only guide extraction. Every retained character comes from
 * the existing SSRF-protected fetcher before an independent reviewer sees it. */
function prepareAcquisition(
  state: ReaderFirstPipelineState, researchValue: unknown,
  response: Pick<OnDemandProviderResponse, "researchProvenance">,
  after: Acquisition["after"], context: OnDemandContext, request: DemandRequestRow,
): ReaderFirstPipelineState {
  const research = readerFirstResearchSchema.parse(researchValue);
  const evidence = boundedReaderFirstEvidence(state.evidence ?? { sources: [], passages: [] });
  const allowed = consultedUrls(response);
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const source of research.sources) {
    const url = evidenceUrl(source.url).href;
    if (ids.has(source.id) || urls.has(url)) stop("provider_invalid");
    ids.add(source.id); urls.add(url);
    const existing = evidence.sources.find((entry) => entry.id === source.id);
    if (existing && evidenceUrl(existing.url).href !== url) stop("provider_invalid");
    if (!existing && evidence.sources.some((entry) => evidenceUrl(entry.url).href === url)) stop("provider_invalid");
    if (!existing && !allowed.has(url)) stop("provider_invalid");
  }
  if (research.passages.some((passage) => !ids.has(passage.sourceId))) stop("provider_invalid");
  // Sources consulted again must be fetched again: a current question cannot
  // accidentally reuse an old cached passage. Failed refreshes do not fall
  // back to that old passage as though fresh verification had succeeded.
  const sources = research.sources.filter((source) => allowed.has(evidenceUrl(source.url).href) ||
    !evidence.sources.some((entry) => entry.id === source.id));
  const refreshed = new Set(sources.map((source) => source.id));
  evidence.sources = evidence.sources.filter((source) => !refreshed.has(source.id));
  evidence.passages = evidence.passages.filter((passage) => !refreshed.has(passage.sourceId));
  if (evidence.sources.length + sources.length > 16) stop("evidence_limit");
  if (!sources.length) return { ...state, evidence, phase: after, acquisition: undefined };
  const selection = request.kind === "article" ? readerFirstSelection(request, evidence) : null;
  const question = request.kind === "question" ? readerFirstQuestion(request, evidence) : null;
  const queries = [context.originalCuriosity, ...context.directions,
    ...(selection ? [selection.idea.headline, selection.idea.readerQuestion, selection.idea.payoff] : []),
    ...(question ? [question.question] : []),
    ...(state.research?.ideas.flatMap((idea) => [idea.headline, idea.readerQuestion, idea.payoff]) ?? []),
    ...(state.check?.findings.map((finding) => `${finding.excerpt} ${finding.repair}`) ?? [])];
  return { ...state, evidence, phase: "retrieve", acquisition: {
    research: { sources, passages: research.passages.filter((passage) => sources.some((source) => source.id === passage.sourceId)) },
    nextSourceIndex: 0, after, failures: [], queries,
    qualifications: [...(selection?.idea.qualifications ?? []), ...(state.research?.ideas.flatMap((idea) => idea.qualifications) ?? [])],
  } };
}

async function retrieveGroup(state: ReaderFirstPipelineState, retrievePage: typeof retrieveEvidencePage): Promise<ReaderFirstPipelineState> {
  const progress = state.acquisition;
  if (!progress || !Number.isInteger(progress.nextSourceIndex) || progress.nextSourceIndex < 0 ||
    progress.nextSourceIndex >= progress.research.sources.length) stop("pipeline_state_invalid");
  const evidence = boundedReaderFirstEvidence(state.evidence);
  const group = progress.research.sources.slice(progress.nextSourceIndex, progress.nextSourceIndex + 4);
  const targets = { ...progress.research,
    sources: [...new Map([...evidence.sources, ...progress.research.sources].map((source) => [source.id, source])).values()],
    queries: progress.queries, qualifications: progress.qualifications };
  const results = await Promise.all(group.map(async (source) => {
    try {
      const page = await retrievePage(source.url);
      const hostname = new URL(page.url).hostname;
      const passages = selectDemandEvidencePassages(source, page, targets);
      if (!passages.length) throw new Error("evidence_unavailable");
      return { source: { ...source, url: page.url, title: (page.title?.trim() || hostname).slice(0, 300),
        publisher: hostname, publishedDate: null, datePrecision: "unknown" as const }, passages };
    } catch { return { failure: { sourceId: source.id, code: "evidence_unavailable" } }; }
  }));
  const failures = [...progress.failures];
  for (const result of results) {
    if (result.failure) failures.push(result.failure);
    else if (evidence.sources.some((source) => source.url === result.source.url || source.id === result.source.id)) {
      failures.push({ sourceId: result.source.id, code: "duplicate_source_url" });
    } else {
      evidence.sources.push(result.source); evidence.passages.push(...result.passages);
    }
  }
  boundedReaderFirstEvidence(evidence);
  const nextSourceIndex = progress.nextSourceIndex + group.length;
  return { ...state, evidence, acquisition: { ...progress, failures, nextSourceIndex },
    phase: nextSourceIndex < progress.research.sources.length ? "retrieve" : progress.after };
}

function ready(state: ReaderFirstPipelineState, request: DemandRequestRow): AdvanceResult {
  if (request.kind === "ideas") {
    if (!state.ideas?.length) return fail(state, "evidence_unavailable");
  } else if (request.kind === "article") {
    if (!state.draft || !state.check) return fail(state, "editorial_withheld");
    assertAcceptedReaderFirstArticleCheck(readerFirstSelection(request, state.evidence), state.draft, state.check);
  } else if (request.kind === "question") {
    if (!state.answer || !state.check) return fail(state, "editorial_withheld");
    assertAcceptedReaderFirstAnswerCheck(readerFirstQuestion(request, state.evidence), state.answer, state.check);
  } else stop("pipeline_snapshot_invalid");
  return { state: { ...state, phase: "ready" }, outcome: request.kind };
}

/** One bounded provider call or one four-source fetch group per durable step.
 * This version never dispatches old requests under new prompts/contracts. */
export async function advanceReaderFirstPipeline(
  input: { request: DemandRequestRow; state: ReaderFirstPipelineState },
  dependencies: { provider?: OnDemandProvider; retrievePage?: typeof retrieveEvidencePage } = {},
): Promise<AdvanceResult> {
  const request = input.request;
  let state = structuredClone(input.state);
  try {
    if (state.version !== 2 || request.snapshot.version !== 2 || state.requestId !== request.id ||
      state.requestFingerprint !== request.requestFingerprint || state.kind !== request.kind || !state.models?.article || !state.models.utility) stop("pipeline_state_invalid");
    if (state.phase === "failed") return fail(state, state.failureCode ?? "preparation_failed");
    if (state.phase === "ready") return ready(state, request);
    const context = onDemandContextSchema.parse(request.snapshot.context);
    if (context.loopId !== request.loopId) stop("pipeline_snapshot_invalid");
    if (state.phase === "retrieve") return { state: await retrieveGroup(state, dependencies.retrievePage ?? retrieveEvidencePage) };
    const provider = dependencies.provider ?? durableDemandProvider(request.id, request.principalId);
    const repairing = state.phase === "repair" || state.phase === "answer_repair";
    const generating = ["ideas", "write", "answer", "repair", "answer_repair"].includes(state.phase);
    const needsResearch = Boolean(state.check && (!state.check.verificationPassed ||
      state.check.findings.some((finding) => finding.kind === "verification_required")));
    const options: ReaderFirstStageOptions = {
      provider, model: request.kind === "article" && ["write", "repair"].includes(state.phase) ? state.models.article : state.models.utility,
      idempotencyKey: `${request.id}:${state.phase}`, safetyIdentifier: request.principalId,
      researchPolicy: { mode: generating ? repairing && needsResearch ? "required" : "auto" : "none",
        reason: repairing && needsResearch ? "Independent review requires evidence for the exact assertion."
          : generating ? "Research only claims requiring freshness or independent verification." : "Review the saved artifact and retained evidence without new research.",
        maxCalls: generating ? 8 : 0 },
    };
    if (request.kind === "ideas") {
      if (state.phase === "ideas") {
        const result = await generateReaderFirstIdeas(context, options);
        state = { ...state, research: result.output, evidence: { sources: [], passages: [] } };
        if (!result.output.ideas.length) return fail(state, "evidence_unavailable");
        return { state: prepareAcquisition(state, { sources: result.output.sources, passages: result.output.passages }, result, "ideas_check", context, request) };
      }
      if (state.phase === "ideas_check") {
        const result = await checkReaderFirstIdeas({ context, research: readerFirstResearchOutputSchema.parse(state.research),
          evidence: boundedReaderFirstEvidence(state.evidence), batchId: request.id }, options);
        return ready({ ...state, ideas: result.ideas, ideaCheck: result.output }, request);
      }
    }
    if (request.kind === "article") {
      const selection = readerFirstSelection(request, state.evidence);
      if (state.phase === "write" || state.phase === "repair") {
        if (state.repairAttempted) stop("pipeline_state_invalid");
        const result = state.phase === "write" ? await writeReaderFirstArticle(selection, options)
          : await repairReaderFirstArticle({ ...selection, draft: readerFirstWriterOutputSchema.parse(state.draft),
            ...(state.deterministicFindings ? { deterministicFindings: state.deterministicFindings }
              : { check: readerFirstCheckOutputSchema.parse(state.check) }) }, options);
        state = { ...state, draft: result.output, evidence: selection.evidence,
          repairAttempted: repairing, deterministicFindings: undefined };
        if (result.output.status !== "written") return fail(state, "editorial_withheld");
        return { state: prepareAcquisition(state, result.output.research, result, repairing ? "recheck" : "check", context, request) };
      }
      if (state.phase === "check" || state.phase === "recheck") {
        try { state.draft = compileReaderFirstArticle(selection, readerFirstWriterOutputSchema.parse(state.draft), selection.evidence); }
        catch (error) {
          if (!(error instanceof ReaderFirstDraftValidationError) || state.repairAttempted) throw error;
          return { state: { ...state, deterministicFindings: error.findings, phase: "repair" } };
        }
        const result = await checkReaderFirstArticle({ ...selection, draft: state.draft }, options);
        state = { ...state, check: result.output };
        return result.accepted ? ready(state, request) : !state.repairAttempted
          ? { state: { ...state, phase: "repair" } } : fail(state, "editorial_withheld");
      }
    }
    if (request.kind === "question") {
      const question = readerFirstQuestion(request, state.evidence);
      if (state.phase === "answer" || state.phase === "answer_repair") {
        if (state.repairAttempted) stop("pipeline_state_invalid");
        const result = state.phase === "answer" ? await answerReaderFirstQuestion(question, options)
          : await repairReaderFirstAnswer({ ...question, answer: readerFirstAnswerOutputSchema.parse(state.answer),
            ...(state.deterministicFindings ? { deterministicFindings: state.deterministicFindings }
              : { check: readerFirstCheckOutputSchema.parse(state.check) }) }, options);
        state = { ...state, answer: result.output, evidence: question.evidence,
          repairAttempted: repairing, deterministicFindings: undefined };
        if (result.output.status !== "answered") return fail(state, "editorial_withheld");
        return { state: prepareAcquisition(state, result.output.research, result, repairing ? "answer_recheck" : "answer_check", context, request) };
      }
      if (state.phase === "answer_check" || state.phase === "answer_recheck") {
        try { state.answer = compileReaderFirstAnswer(question, readerFirstAnswerOutputSchema.parse(state.answer), question.evidence); }
        catch (error) {
          if (!(error instanceof ReaderFirstDraftValidationError) || state.repairAttempted) throw error;
          return { state: { ...state, deterministicFindings: error.findings, phase: "answer_repair" } };
        }
        const result = await checkReaderFirstAnswer({ ...question, answer: state.answer }, options);
        state = { ...state, check: result.output };
        return result.accepted ? ready(state, request) : !state.repairAttempted
          ? { state: { ...state, phase: "answer_repair" } } : fail(state, "editorial_withheld");
      }
    }
    stop("pipeline_state_invalid");
  } catch (error) {
    if (error instanceof DemandUsagePersistenceError || (error instanceof HttpError && error.code === "provider_stage_busy")) throw error;
    if (error instanceof ReaderFirstDraftValidationError) return fail(state, "editorial_withheld");
    if (error instanceof ProviderResponseValidationError) return fail(state, "provider_invalid");
    return fail(state, error instanceof HttpError ? error.code : "provider_invalid");
  }
}
