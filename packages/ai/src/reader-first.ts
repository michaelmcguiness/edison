import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertOnDemandEvidence, type OnDemandContext, type OnDemandEvidence, type OnDemandSource,
  type OnDemandProviderRequest, type OnDemandProviderResponse, type OnDemandStageOptions,
  onDemandContextSchema,
} from "./on-demand";
import { ProviderResponseValidationError } from "./provider-response-error";
import { READER_FIRST_PROMPTS, READER_FIRST_PROMPT_VERSION, READER_FIRST_IDEAS_ART_PROMPT_VERSION } from "./reader-first-prompts";
import { normalizeOnDemandIdeaArt } from "./on-demand-art";
import {
  readerFirstSavedWriterInputSchema, readerFirstWriterOutputSchema, readerFirstWriterProviderSchema,
  readerFirstAnswerOutputSchema, readerFirstAnswerProviderSchema, readerFirstResearchOutputSchema,
  readerFirstCheckOutputSchema, readerFirstIdeaChecksSchema, readerFirstIdeaSchema,
  type ReaderFirstArticle, type ReaderFirstBlock, type ReaderFirstWriterOutput, type ReaderFirstAnswerOutput,
  type ReaderFirstResearch, type ReaderFirstResearchOutput, type ReaderFirstCheckOutput, type ReaderFirstIdea,
} from "./reader-first-schemas";

export * from "./reader-first-schemas";
export { READER_FIRST_PROMPT_VERSION, READER_FIRST_PROMPTS, READER_FIRST_IDEAS_ART_PROMPT_VERSION } from "./reader-first-prompts";
export type ReaderFirstStageOptions = OnDemandStageOptions & { researchPolicy?: NonNullable<OnDemandProviderRequest["researchPolicy"]> };
export type ReaderFirstSelection = { context: OnDemandContext; idea: ReaderFirstIdea; evidence: OnDemandEvidence };
const referenceKey = z.string().min(1).max(40);
const previousReferenceSchema = z.object({
  label: z.string().min(1).max(24), sourceId: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  url: z.string().min(1).max(2048).refine((value) => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch { return false; }
  }, "Historical reference URLs must be credential-free HTTPS"),
  accessedAt: z.string().datetime().nullable(), evidenceSourceKey: referenceKey.nullable(),
  passageIds: z.array(referenceKey).max(48),
}).strict();
export const readerFirstPreviousMessagesSchema = z.array(z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string().min(1).max(8000) }).strict(),
  z.object({ role: z.literal("assistant"), text: z.string().min(1).max(8000), references: z.array(previousReferenceSchema).max(16).optional() }).strict(),
])).max(12);
export type ReaderFirstPreviousReference = z.infer<typeof previousReferenceSchema>;
export type ReaderFirstPreviousMessage = z.infer<typeof readerFirstPreviousMessagesSchema>[number];
export type ReaderFirstQuestion = {
  context: OnDemandContext; articleVersion: string; draft: ReaderFirstWriterOutput; evidence: OnDemandEvidence;
  question: string; previousMessages: ReaderFirstPreviousMessage[];
};
export type ReaderFirstStageResult<T> = Omit<OnDemandProviderResponse, "output"> & {
  output: T; stage: OnDemandProviderRequest["stage"]; promptVersion: typeof READER_FIRST_PROMPT_VERSION | typeof READER_FIRST_IDEAS_ART_PROMPT_VERSION;
};
export type ReaderFirstValidationFinding = { location: string; reason: string };
export class ReaderFirstDraftValidationError extends Error {
  readonly deterministicFindings: ReaderFirstValidationFinding[];
  constructor(readonly findings: ReaderFirstValidationFinding[]) {
    super("The draft needs a bounded structural or evidence repair");
    this.name = "ReaderFirstDraftValidationError";
    this.deterministicFindings = findings.slice(0, 24);
  }
}

const none = { mode: "none" as const, reason: "Independent checking uses the final retained evidence", maxCalls: 0 };
function invalid(message: string): never { throw new Error(message); }
function unique(values: string[], name: string) { if (new Set(values).size !== values.length) invalid(`Duplicate ${name}`); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function readerFirstFingerprint(value: unknown) { return createHash("sha256").update(stable(value)).digest("hex"); }

async function stage<T>(
  name: keyof typeof READER_FIRST_PROMPTS, input: unknown, schema: z.ZodType<T>, options: ReaderFirstStageOptions,
  normalize?: (output: T, response: OnDemandProviderResponse) => void,
): Promise<ReaderFirstStageResult<T>> {
  if (!options.model || !options.idempotencyKey || !options.safetyIdentifier) invalid("Explicit model and request identities are required");
  const checking = name === "check" || name === "ideas_check";
  const researchPolicy = checking ? none : options.researchPolicy ?? { mode: "auto", reason: "Selectively verify the reader's question and specific assertions", maxCalls: 8 };
  if (!Number.isInteger(researchPolicy.maxCalls) || researchPolicy.maxCalls < 0 || researchPolicy.maxCalls > 8 || !researchPolicy.reason.trim() || researchPolicy.reason.length > 500 || (researchPolicy.mode === "none" && researchPolicy.maxCalls !== 0)) invalid("Invalid bounded research policy");
  const providerStage = name === "answer_repair" ? "repair" : name;
  const promptVersion = name === "ideas" ? READER_FIRST_IDEAS_ART_PROMPT_VERSION : READER_FIRST_PROMPT_VERSION;
  const response = await options.provider({
    stage: providerStage, promptVersion, instructions: READER_FIRST_PROMPTS[name],
    input, schema, model: options.model, idempotencyKey: options.idempotencyKey, safetyIdentifier: options.safetyIdentifier,
    timeoutMs: options.timeoutMs ?? 90_000, maxOutputTokens: providerStage === "write" || providerStage === "repair" ? 12_000 : 8000,
    research: researchPolicy.mode !== "none", researchPolicy,
  });
  try {
    const output = schema.parse(name === "ideas" ? normalizeOnDemandIdeaArt(response.output) : response.output);
    normalize?.(output, response);
    return { ...response, output, stage: providerStage, promptVersion };
  } catch {
    // The durable provider already retains the original response. Preserve its
    // observed usage even if strict parsing or provenance validation fails.
    throw new ProviderResponseValidationError(`The ${providerStage} response failed reader-first validation`, response.usage);
  }
}

function selection(input: ReaderFirstSelection) {
  onDemandContextSchema.parse(input.context); readerFirstIdeaSchema.parse(input.idea); assertOnDemandEvidence(input.evidence);
  if (input.idea.loopId !== input.context.loopId || input.idea.loopRevision > input.context.revision) invalid("Idea does not belong to the frozen selection context");
}
function question(input: ReaderFirstQuestion) {
  onDemandContextSchema.parse(input.context); readerFirstSavedWriterInputSchema.parse(input.draft); assertOnDemandEvidence(input.evidence);
  if (!input.articleVersion || input.articleVersion.length > 120 || input.draft.status !== "written" || !input.draft.article || !input.question.trim() || input.question.length > 2000) invalid("Invalid bounded article question");
  assertReaderFirstPreviousMessages(input.previousMessages, input.evidence);
}

/** Historical display identity is preserved even when its evidence is omitted
 * from the bounded packet. A URL is metadata, not authority to fetch it. */
export function assertReaderFirstPreviousMessages(messages: unknown, evidence: OnDemandEvidence): asserts messages is ReaderFirstPreviousMessage[] {
  const parsed = readerFirstPreviousMessagesSchema.parse(messages);
  assertOnDemandEvidence(evidence);
  for (const message of parsed) {
    if (message.role !== "assistant" || !message.references) continue;
    unique(message.references.map((reference) => reference.label), "historical message label");
    unique(message.references.map((reference) => reference.sourceId), "historical message source identity");
    for (const reference of message.references) {
      unique(reference.passageIds, "historical reference passage");
      if (reference.evidenceSourceKey === null) {
        if (reference.passageIds.length) invalid("Unavailable historical evidence cannot retain passage mappings");
        continue;
      }
      const source = evidence.sources.find((candidate) => candidate.id === reference.evidenceSourceKey);
      if (!source || new URL(source.url).href !== new URL(reference.url).href || !reference.passageIds.length) invalid("Historical reference does not match retained evidence");
      for (const id of reference.passageIds) {
        const passage = evidence.passages.find((candidate) => candidate.id === id);
        if (!passage || passage.sourceId !== source.id || passage.provenance !== "retrieved" || !passage.retrievedAt) invalid("Historical reference passage is not independently retained for its source");
      }
    }
  }
}
function normalizedResearchHints(research: ReaderFirstResearch): ReaderFirstResearch {
  // Publication dates come from independently retained metadata, never these
  // model discovery hints. Preserve the raw billed response and supplied
  // evidence; only this parsed generation result receives unknown dates.
  const normalized = structuredClone(research);
  normalized.sources = normalized.sources.map((source) => ({ ...source, publishedDate: null, datePrecision: "unknown" }));
  return normalized;
}
function discoveryStructure(research: ReaderFirstResearch) {
  assertOnDemandEvidence({ sources: research.sources, passages: research.passages.map((passage) => ({ ...passage, provenance: "model_reported", retrievedAt: null })) });
}
function actualDiscoveryUrls(response: OnDemandProviderResponse) {
  const provenance = response.researchProvenance;
  return new Set([...(provenance?.consultedUrls ?? []), ...(provenance?.openedUrls ?? []), ...(provenance?.citedUrls ?? [])]);
}
function discovery(research: ReaderFirstResearch, response: OnDemandProviderResponse, evidence: OnDemandEvidence) {
  discoveryStructure(research);
  const urls = actualDiscoveryUrls(response);
  for (const source of research.sources) {
    const prior = evidence.sources.find((candidate) => candidate.id === source.id);
    if (prior && prior.url !== source.url) invalid("Research source ID changed its URL");
    if (!urls.has(source.url) && prior?.url !== source.url) invalid("A declared source has no actual tool provenance");
  }
}
function identities(research: ReaderFirstResearch, evidence: OnDemandEvidence) {
  const map = new Map(research.sources.map((source) => [source.id, source]));
  for (const source of evidence.sources) {
    if (map.has(source.id) && map.get(source.id)!.url !== source.url) invalid("Research source ID collision");
    map.set(source.id, source);
  }
  return map;
}
function displaySource(source: OnDemandSource): ReaderFirstArticle["sources"][number] {
  return { key: source.id, title: source.title, publisher: source.publisher, url: source.url,
    publishedAt: source.datePrecision === "day" ? `${source.publishedDate}T00:00:00.000Z` : null };
}
function label(source: OnDemandSource, index: number) {
  const host = new URL(source.url).hostname.replace(/^www\./, "");
  return host.length <= 24 ? host : `Source ${index + 1}`;
}
type RawBlock = z.infer<typeof readerFirstWriterProviderSchema>["article"] extends infer A ? NonNullable<A> extends { body: infer B } ? B : never : never;
function materialize(keys: string[], body: RawBlock, research: ReaderFirstResearch, evidence: OnDemandEvidence) {
  unique(keys, "displayed source");
  const map = identities(research, evidence);
  const sources = keys.map((id) => { const source = map.get(id); if (!source) invalid("Unknown displayed source"); return displaySource(source); });
  unique(sources.map((source) => source.url), "displayed source URL");
  return { sources, body: body.map((block): ReaderFirstBlock => {
    if (block.type === "heading") return block;
    unique(block.citations.map((citation) => citation.sourceKey), "block citation");
    return { ...block, citations: block.citations.map((citation) => {
      const index = keys.indexOf(citation.sourceKey);
      if (index < 0) invalid("Citation not included in source list");
      return { sourceKey: citation.sourceKey, label: label(map.get(citation.sourceKey)!, index) };
    }) };
  }) };
}

export function generateReaderFirstIdeas(context: OnDemandContext, options: ReaderFirstStageOptions, requestedCount = 6) {
  onDemandContextSchema.parse(context);
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 6) invalid("Idea count must be 1–6");
  return stage("ideas", { context, requestedCount }, readerFirstResearchOutputSchema, options, (output, response) => {
    unique(output.ideas.map((idea) => idea.key), "idea key");
    if (output.ideas.length > requestedCount || (!output.ideas.length && !output.insufficiencyReason)) invalid("Invalid idea count or unavailable reason");
    const normalized = normalizedResearchHints(output);
    output.sources = normalized.sources; output.passages = normalized.passages;
    // Malformed relationships remain invalid even if their source would later
    // be excluded: quarantine must not hide invented IDs or duplicate keys.
    discoveryStructure(output);
    const ids = new Set(output.passages.map((passage) => passage.id));
    for (const idea of output.ideas) { unique(idea.passageIds, "idea passage"); if (idea.passageIds.some((id) => !ids.has(id))) invalid("Unknown discovery passage"); }
    const consulted = actualDiscoveryUrls(response);
    const unsupportedSources = new Set(output.sources.filter((source) => !consulted.has(source.url)).map((source) => source.id));
    const unsupportedPassages = new Set(output.passages.filter((passage) => unsupportedSources.has(passage.sourceId)).map((passage) => passage.id));
    const before = output.ideas.length;
    output.sources = output.sources.filter((source) => !unsupportedSources.has(source.id));
    output.passages = output.passages.filter((passage) => !unsupportedSources.has(passage.sourceId));
    output.ideas = output.ideas.filter((idea) => !idea.passageIds.some((id) => unsupportedPassages.has(id)));
    if (before > 0 && output.ideas.length === 0) output.insufficiencyReason = "Every proposed idea depended on a source absent from the actual research provenance.";
  });
}
export async function checkReaderFirstIdeas(input: { context: OnDemandContext; research: ReaderFirstResearchOutput; evidence: OnDemandEvidence; batchId: string }, options: ReaderFirstStageOptions) {
  onDemandContextSchema.parse(input.context); readerFirstResearchOutputSchema.parse(input.research); assertOnDemandEvidence(input.evidence);
  if (!input.batchId || input.batchId.length > 120) invalid("Batch identity required");
  unique(input.research.ideas.map((idea) => idea.key), "idea key");
  const fingerprint = readerFirstFingerprint({ version: READER_FIRST_PROMPT_VERSION, kind: "ideas", ...input });
  const result = await stage("ideas_check", { ...input, fingerprint }, readerFirstIdeaChecksSchema.extend({ fingerprint: z.literal(fingerprint) }), options, (output) => {
    unique(output.ideas.map((idea) => idea.key), "checked idea key");
    if (output.ideas.length !== input.research.ideas.length || output.ideas.some((idea) => !input.research.ideas.some((candidate) => candidate.key === idea.key))) invalid("Incomplete idea checks");
    for (const checked of output.ideas) retrieved(checked.passageIds, input.evidence);
  });
  const ideas = result.output.ideas.filter((checked) => checked.verdict === "pass" && checked.premiseSupported && checked.verificationPassed && checked.fitsLoop && checked.distinctContribution && (!checked.verificationRequired || checked.passageIds.length > 0)).map((checked) => readerFirstIdeaSchema.parse({
    ...input.research.ideas.find((candidate) => candidate.key === checked.key)!, passageIds: checked.passageIds,
    id: `${input.batchId}:${checked.key}`, loopId: input.context.loopId, loopRevision: input.context.revision,
  }));
  return { ...result, ideas };
}

async function writer(name: "write" | "repair", input: ReaderFirstSelection & Record<string, unknown>, options: ReaderFirstStageOptions): Promise<ReaderFirstStageResult<ReaderFirstWriterOutput>> {
  selection(input);
  const result = await stage(name, input, readerFirstWriterProviderSchema, options, (output, response) => {
    output.research = normalizedResearchHints(output.research);
    discovery(output.research, response, input.evidence);
    if ((output.status === "written") !== Boolean(output.article) || (output.status === "written" ? output.reason !== null : !output.reason)) invalid("Inconsistent article availability");
    if (output.article) materialize(output.article.sourceKeys, output.article.body, output.research, input.evidence);
  });
  const raw = result.output;
  const article = raw.article ? (() => {
    const { sourceKeys, body, ...prose } = raw.article;
    return { ...prose, ...materialize(sourceKeys, body, raw.research, input.evidence) };
  })() : null;
  return { ...result, output: readerFirstWriterOutputSchema.parse({ ...raw, article }) };
}
export function writeReaderFirstArticle(input: ReaderFirstSelection, options: ReaderFirstStageOptions) { return writer("write", input, options); }

function retrieved(ids: string[], evidence: OnDemandEvidence) {
  unique(ids, "retrieved passage");
  if (ids.some((id) => !evidence.passages.some((passage) => passage.id === id && passage.provenance === "retrieved" && passage.retrievedAt))) invalid("Unknown or unretrieved supporting passage");
}
const plain = (value: string) => value.replace(/\s+/g, " ").trim();
function compileBody(body: ReaderFirstBlock[], sources: ReaderFirstArticle["sources"], evidence: OnDemandEvidence) {
  assertOnDemandEvidence(evidence);
  unique(sources.map((source) => source.key), "source key"); unique(sources.map((source) => source.url), "source URL");
  const findings: ReaderFirstValidationFinding[] = [];
  const keys = sources.map((source) => source.key);
  for (const source of sources) {
    const canonical = evidence.sources.find((candidate) => candidate.id === source.key);
    if (!canonical || !evidence.passages.some((passage) => passage.sourceId === source.key && passage.provenance === "retrieved" && passage.retrievedAt)) findings.push({ location: "sources", reason: `Source ${source.key} needs independently retrieved support` });
  }
  body.forEach((block, index) => {
    if (block.type === "heading") return;
    unique(block.citations.map((citation) => citation.sourceKey), "block citation");
    if (block.citations.some((citation) => !keys.includes(citation.sourceKey))) findings.push({ location: `body.${index}`, reason: "A citation is absent from the displayed source list" });
    if (block.type === "quote" && !evidence.passages.some((passage) => passage.provenance === "retrieved" && passage.retrievedAt && block.citations.some((citation) => citation.sourceKey === passage.sourceId) && plain(passage.text).includes(plain(block.text)))) findings.push({ location: `body.${index}`, reason: "The quotation is not exact text in a cited independently retrieved passage" });
  });
  if (!body.some((block) => block.type === "paragraph")) findings.push({ location: "body", reason: "Reading needs a substantive explanatory paragraph" });
  if (findings.length) throw new ReaderFirstDraftValidationError(findings);
  // The server retriever owns redirect resolution and the retained identity.
  // Discovery URLs are not authoritative after that secure fetch. Final
  // acceptance separately requires this exact canonical presentation.
  return materialize(keys, body, { sources: [], passages: [] }, evidence);
}

/** Call after bounded retrieval. Metadata is compiled from the final evidence,
 * never from provider-authored title/date/label fields. Raw outputs stay retained. */
export function compileReaderFirstArticle(input: ReaderFirstSelection, draft: ReaderFirstWriterOutput, finalEvidence: OnDemandEvidence = input.evidence): ReaderFirstWriterOutput {
  selection({ ...input, evidence: finalEvidence }); readerFirstWriterOutputSchema.parse(draft);
  if (draft.status !== "written" || !draft.article || draft.reason !== null) invalid("Cannot compile an unavailable article");
  if (draft.article.title !== input.idea.headline) throw new ReaderFirstDraftValidationError([{ location: "title", reason: "Selected headline changed" }]);
  return { ...draft, article: { ...draft.article, ...compileBody(draft.article.body, draft.article.sources, finalEvidence) } };
}
export function compileReaderFirstAnswer(input: ReaderFirstQuestion, answer: ReaderFirstAnswerOutput, finalEvidence: OnDemandEvidence = input.evidence): ReaderFirstAnswerOutput {
  question({ ...input, evidence: finalEvidence }); readerFirstAnswerOutputSchema.parse(answer);
  if (answer.status !== "answered" || answer.reason !== null) invalid("Cannot compile an unavailable answer");
  if (readerFirstAnswerText(answer).length > 8000) throw new ReaderFirstDraftValidationError([{ location: "body", reason: "The answer exceeds its bounded context length" }]);
  return { ...answer, ...compileBody(answer.body, answer.sources, finalEvidence) };
}
export function readerFirstAnswerText(answer: ReaderFirstAnswerOutput | ReaderFirstBlock[]) {
  return (Array.isArray(answer) ? answer : answer.body).map((block) => block.text + (block.type === "quote" && block.attribution ? ` — ${block.attribution}` : "")).join("\n\n");
}

function articleLocations(article: ReaderFirstArticle) {
  return { title: article.title, deck: article.deck, whyWritten: article.whyWritten,
    ...Object.fromEntries(article.summary.map((value, index) => [`summary.${index}`, value])), ...bodyLocations(article.body) };
}
function bodyLocations(body: ReaderFirstBlock[]) {
  return Object.fromEntries(body.flatMap((block, index) => [[`body.${index}`, block.text], ...(block.type === "quote" && block.attribution ? [[`body.${index}.attribution`, block.attribution]] : [])]));
}
export function readerFirstArticleFingerprint(input: ReaderFirstSelection, draft: ReaderFirstWriterOutput) {
  return readerFirstFingerprint({ version: READER_FIRST_PROMPT_VERSION, kind: "article", context: input.context, idea: input.idea, evidence: input.evidence, draft });
}
export function readerFirstAnswerFingerprint(input: ReaderFirstQuestion, answer: ReaderFirstAnswerOutput) {
  return readerFirstFingerprint({ version: READER_FIRST_PROMPT_VERSION, kind: "answer", context: input.context,
    articleVersion: input.articleVersion, draft: input.draft, evidence: input.evidence,
    question: input.question, previousMessages: input.previousMessages, answer });
}
function boundCheck(check: ReaderFirstCheckOutput, fingerprint: string, locations: Record<string, string>, evidence: OnDemandEvidence) {
  readerFirstCheckOutputSchema.parse(check);
  if (check.fingerprint !== fingerprint) invalid("Stale or mismatched exact-artifact check");
  for (const finding of check.findings) {
    if (!locations[finding.location]?.includes(finding.excerpt)) invalid("Finding does not quote its actual text location");
    retrieved(finding.passageIds, evidence);
  }
}
/** Constrain only new provider output. Saved checks keep their historical
 * structural schema and must still pass exact binding at runtime. */
function providerCheckSchema(fingerprint: string, locations: Record<string, string>, evidence: OnDemandEvidence) {
  const allowedLocations = Object.keys(locations);
  if (!allowedLocations.length) invalid("A check requires actual text locations");
  const passageIds = evidence.passages.filter((passage) => passage.provenance === "retrieved" && passage.retrievedAt).map((passage) => passage.id);
  const finding = readerFirstCheckOutputSchema.shape.findings.element;
  return readerFirstCheckOutputSchema.extend({
    fingerprint: z.literal(fingerprint),
    findings: z.array(finding.extend({
      location: z.enum(allowedLocations as [string, ...string[]]),
      // An empty enum/never item is not a valid provider wire schema. A normal
      // bounded string array with maxItems:0 represents no retained evidence.
      passageIds: passageIds.length ? z.array(z.enum(passageIds as [string, ...string[]])).max(12)
        : finding.shape.passageIds.max(0),
    })).max(24),
  });
}

/** null means no candidate; false means ambiguous. Change only the first ASCII
 * letter and return the actual author-text slice, never case-folded prose. */
function uniqueInitialCaseExcerpt(text: string, excerpt: string): string | false | null {
  const index = excerpt.search(/[A-Za-z]/);
  if (index < 0) return null;
  const letter = excerpt[index];
  const candidate = excerpt.slice(0, index) + (letter >= "a" && letter <= "z" ? letter.toUpperCase() : letter.toLowerCase()) + excerpt.slice(index + 1);
  const start = text.indexOf(candidate);
  if (start < 0) return null;
  if (text.indexOf(candidate, start + 1) >= 0) return false;
  return text.slice(start, start + candidate.length);
}
/** Provider-boundary correction only. A checker can count paragraphs without
 * headings; rebind its unchanged verbatim excerpt only when the intended full
 * body location is unambiguous. A first-letter case correction is restricted to
 * its original location; it never enables cross-location case-folded matching.
 * Stored checks and final gates stay strict. */
function normalizeProviderFindingLocations(check: ReaderFirstCheckOutput, locations: Record<string, string>) {
  for (const finding of check.findings) {
    const text = locations[finding.location];
    if (text?.includes(finding.excerpt)) continue;
    if (text !== undefined) {
      const correction = uniqueInitialCaseExcerpt(text, finding.excerpt);
      if (correction === false) continue;
      if (correction !== null) {
        // Another exact anchor makes case correction versus location correction
        // ambiguous. Neither correction may choose the checker's intended text.
        if (Object.entries(locations).some(([location, value]) => location !== finding.location && value.includes(finding.excerpt))) continue;
        finding.excerpt = correction;
        continue;
      }
    }
    if (!/^body\.\d+$/.test(finding.location) || !Object.hasOwn(locations, finding.location)) continue;
    const matches = Object.entries(locations).filter(([location, text]) => /^body\.\d+$/.test(location) && text.includes(finding.excerpt));
    if (matches.length === 1) finding.location = matches[0][0];
  }
}
export function readerFirstCheckAccepted(check: ReaderFirstCheckOutput) {
  readerFirstCheckOutputSchema.parse(check);
  return check.verdict === "pass" && check.accuracyPassed && check.verificationPassed && check.promiseFulfilled && check.readerFit && check.continuity && check.privacyPassed && !check.findings.some((finding) => finding.severity === "material" || finding.kind === "verification_required");
}
export function assertAcceptedReaderFirstArticleCheck(input: ReaderFirstSelection, draft: ReaderFirstWriterOutput, check: ReaderFirstCheckOutput) {
  const compiled = compileReaderFirstArticle(input, draft);
  if (readerFirstFingerprint(compiled) !== readerFirstFingerprint(draft)) invalid("Article source presentation is not canonical");
  boundCheck(check, readerFirstArticleFingerprint(input, draft), articleLocations(draft.article!), input.evidence);
  if (!readerFirstCheckAccepted(check)) invalid("editorial_withheld");
}
export function assertAcceptedReaderFirstAnswerCheck(input: ReaderFirstQuestion, answer: ReaderFirstAnswerOutput, check: ReaderFirstCheckOutput) {
  const compiled = compileReaderFirstAnswer(input, answer);
  if (readerFirstFingerprint(compiled) !== readerFirstFingerprint(answer)) invalid("Answer source presentation is not canonical");
  boundCheck(check, readerFirstAnswerFingerprint(input, answer), bodyLocations(answer.body), input.evidence);
  if (!readerFirstCheckAccepted(check)) invalid("editorial_withheld");
}
export async function checkReaderFirstArticle(input: ReaderFirstSelection & { draft: ReaderFirstWriterOutput }, options: ReaderFirstStageOptions) {
  const compiled = compileReaderFirstArticle(input, input.draft);
  if (readerFirstFingerprint(compiled) !== readerFirstFingerprint(input.draft)) invalid("Compile final article evidence before checking");
  const fingerprint = readerFirstArticleFingerprint(input, input.draft);
  const locations = articleLocations(input.draft.article!);
  const result = await stage("check", { ...input, mode: "article", fingerprint, allowedLocations: Object.keys(locations) }, providerCheckSchema(fingerprint, locations, input.evidence), options, (output) => {
    normalizeProviderFindingLocations(output, locations);
    boundCheck(output, fingerprint, locations, input.evidence);
  });
  const accepted = readerFirstCheckAccepted(result.output);
  if (accepted) assertAcceptedReaderFirstArticleCheck(input, input.draft, result.output);
  return { ...result, accepted };
}
export async function checkReaderFirstAnswer(input: ReaderFirstQuestion & { answer: ReaderFirstAnswerOutput }, options: ReaderFirstStageOptions) {
  const compiled = compileReaderFirstAnswer(input, input.answer);
  if (readerFirstFingerprint(compiled) !== readerFirstFingerprint(input.answer)) invalid("Compile final answer evidence before checking");
  const fingerprint = readerFirstAnswerFingerprint(input, input.answer);
  const locations = bodyLocations(input.answer.body);
  const result = await stage("check", { ...input, mode: "answer", fingerprint, allowedLocations: Object.keys(locations) }, providerCheckSchema(fingerprint, locations, input.evidence), options, (output) => {
    normalizeProviderFindingLocations(output, locations);
    boundCheck(output, fingerprint, locations, input.evidence);
  });
  const accepted = readerFirstCheckAccepted(result.output);
  if (accepted) assertAcceptedReaderFirstAnswerCheck(input, input.answer, result.output);
  return { ...result, accepted };
}

type Failure = { check: ReaderFirstCheckOutput; deterministicFindings?: never } | { check?: never; deterministicFindings: ReaderFirstValidationFinding[] };
function repairable(input: Failure, fingerprint: string, locations: Record<string, string>, evidence: OnDemandEvidence) {
  if ((input.check !== undefined) === (input.deterministicFindings !== undefined)) invalid("Repair requires exactly one failure report");
  if (input.check) {
    boundCheck(input.check, fingerprint, locations, evidence);
    if (readerFirstCheckAccepted(input.check)) invalid("Repair needs a repairable failed check");
  } else if (!input.deterministicFindings?.length || input.deterministicFindings.length > 24 || input.deterministicFindings.some((finding) => !finding.location || finding.location.length > 80 || !finding.reason || finding.reason.length > 500)) invalid("Invalid deterministic failure report");
}
export function repairReaderFirstArticle(input: ReaderFirstSelection & { draft: ReaderFirstWriterOutput } & Failure, options: ReaderFirstStageOptions) {
  selection(input); readerFirstWriterOutputSchema.parse(input.draft);
  if (input.draft.status !== "written" || !input.draft.article) invalid("Cannot repair an unavailable article");
  repairable(input, readerFirstArticleFingerprint(input, input.draft), articleLocations(input.draft.article), input.evidence);
  return writer("repair", input, options);
}
async function answerStage(name: "answer" | "answer_repair", input: ReaderFirstQuestion & Record<string, unknown>, options: ReaderFirstStageOptions): Promise<ReaderFirstStageResult<ReaderFirstAnswerOutput>> {
  question(input);
  const result = await stage(name, input, readerFirstAnswerProviderSchema, options, (output, response) => {
    output.research = normalizedResearchHints(output.research);
    discovery(output.research, response, input.evidence);
    if (output.status === "answered" ? !output.body.length || output.reason !== null : !output.reason) invalid("Inconsistent answer availability");
    materialize(output.sourceKeys, output.body, output.research, input.evidence);
  });
  const { sourceKeys, body, ...rest } = result.output;
  return { ...result, output: readerFirstAnswerOutputSchema.parse({ ...rest, ...materialize(sourceKeys, body, rest.research, input.evidence) }) };
}
export function answerReaderFirstQuestion(input: ReaderFirstQuestion, options: ReaderFirstStageOptions) { return answerStage("answer", input, options); }
export function repairReaderFirstAnswer(input: ReaderFirstQuestion & { answer: ReaderFirstAnswerOutput } & Failure, options: ReaderFirstStageOptions) {
  question(input); readerFirstAnswerOutputSchema.parse(input.answer);
  if (input.answer.status !== "answered") invalid("Cannot repair an unavailable answer");
  repairable(input, readerFirstAnswerFingerprint(input, input.answer), bodyLocations(input.answer.body), input.evidence);
  return answerStage("answer_repair", input, options);
}
