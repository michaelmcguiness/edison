import { z } from "zod";
import { onDemandArticleSchema } from "./schemas";
import { ProviderResponseValidationError, type ObservedProviderUsage } from "./provider-response-error";
import { ON_DEMAND_PROMPTS, ON_DEMAND_PROMPT_VERSION } from "./on-demand-prompts";
import {
  onDemandAnswerOutputSchema,
  onDemandArticleCheckProviderSchema,
  onDemandCheckOutputSchema,
  onDemandContextSchema,
  onDemandDraftValidationFindingsSchema,
  onDemandEvidenceSchema,
  onDemandIdeaChecksSchema,
  onDemandResearchOutputSchema,
  onDemandWriterOutputSchema,
  onDemandWriterProviderOutputSchema,
  type OnDemandAnswerOutput,
  type OnDemandCheckOutput,
  type OnDemandContext,
  type OnDemandDraftValidationFinding,
  type OnDemandEvidence,
  type OnDemandIdea,
  type OnDemandResearchOutput,
  type OnDemandWriterOutput,
  type OnDemandWriterProviderOutput,
} from "./on-demand-schemas";

export * from "./on-demand-schemas";
export { ON_DEMAND_PROMPT_VERSION, ON_DEMAND_PROMPTS } from "./on-demand-prompts";

export type OnDemandStage = keyof typeof ON_DEMAND_PROMPTS;
export type OnDemandProviderRequest = {
  stage: OnDemandStage;
  promptVersion: string;
  instructions: string;
  input: unknown;
  schema: z.ZodTypeAny;
  // Durable callers can freeze the exact wire schema before the provider call.
  wireFormat?: { type: "json_schema"; name: string; schema: Record<string, unknown>; strict: boolean };
  model: string;
  idempotencyKey: string;
  safetyIdentifier: string;
  timeoutMs: number;
  maxOutputTokens: number;
  research: boolean;
};
export type OnDemandProviderResponse = {
  output: unknown;
  usage: ObservedProviderUsage;
  // Discovery provenance only; these URLs do not establish passage support.
  researchedUrls?: string[];
};
export type OnDemandProvider = (request: OnDemandProviderRequest) => Promise<OnDemandProviderResponse>;
export type OnDemandStageOptions = {
  provider: OnDemandProvider;
  model: string;
  idempotencyKey: string;
  safetyIdentifier: string;
  timeoutMs?: number;
};
export type OnDemandStageResult<T> = {
  output: T;
  usage: ObservedProviderUsage;
  stage: OnDemandStage;
  promptVersion: typeof ON_DEMAND_PROMPT_VERSION;
};

/** A parseable initial written draft needs the sole deterministic repair. Its
 * original provider response/usage is already retained by the durable wrapper. */
export class OnDemandDraftValidationError extends ProviderResponseValidationError {
  readonly draft: OnDemandWriterOutput;
  readonly findings: OnDemandDraftValidationFinding[];
  constructor(readonly result: OnDemandStageResult<OnDemandWriterOutput>, findings: OnDemandDraftValidationFinding[]) {
    super("The initial written draft failed deterministic validation", result.usage);
    this.draft = result.output;
    this.findings = onDemandDraftValidationFindingsSchema.parse(findings);
  }
}

function invalid(message: string): never {
  throw new Error(message);
}

async function runStage<T>(
  stage: OnDemandStage,
  input: unknown,
  schema: z.ZodType<T>,
  options: OnDemandStageOptions,
  validate?: (output: T, response: OnDemandProviderResponse) => void,
): Promise<OnDemandStageResult<T>> {
  if (!options.model || !options.idempotencyKey || !options.safetyIdentifier) {
    invalid("On-demand stages require explicit model, request identity and safety identity");
  }
  const response = await options.provider({
    stage,
    promptVersion: ON_DEMAND_PROMPT_VERSION,
    instructions: ON_DEMAND_PROMPTS[stage],
    input,
    schema,
    model: options.model,
    idempotencyKey: options.idempotencyKey,
    safetyIdentifier: options.safetyIdentifier,
    timeoutMs: options.timeoutMs ?? 90_000,
    maxOutputTokens: stage === "write" || stage === "repair" ? 12_000 : stage === "feedback" ? 3000 : 8000,
    research: stage === "ideas",
  });
  try {
    const output = schema.parse(response.output);
    validate?.(output, response);
    return { output, usage: response.usage, stage, promptVersion: ON_DEMAND_PROMPT_VERSION };
  } catch {
    // Never lose the billed response when validation fails, and never include
    // private prompt/source/prose contents in the public error message.
    throw new ProviderResponseValidationError(
      `The ${stage} response failed on-demand validation`,
      response.usage,
    );
  }
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) invalid(`Duplicate ${label}`);
}

/** Validates provenance structure, NOT the truth of a passage or a claim. */
export function assertOnDemandEvidence(evidence: OnDemandEvidence) {
  onDemandEvidenceSchema.parse(evidence);
  unique(evidence.sources.map((source) => source.id), "source ID");
  unique(evidence.sources.map((source) => source.url), "source URL");
  unique(evidence.passages.map((passage) => passage.id), "passage ID");
  const sources = new Set(evidence.sources.map((source) => source.id));
  for (const source of evidence.sources) {
    const parsed = new URL(source.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) invalid("Invalid evidence URL");
    const datePatterns = { year: /^\d{4}$/, month: /^\d{4}-(0[1-9]|1[0-2])$/, day: /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/ };
    if (source.datePrecision === "unknown") {
      if (source.publishedDate !== null) invalid("Unknown source date must be null");
    } else {
      if (!source.publishedDate || !datePatterns[source.datePrecision].test(source.publishedDate)) invalid("Source date precision mismatch");
      if (source.datePrecision === "day" && new Date(`${source.publishedDate}T00:00:00Z`).toISOString().slice(0, 10) !== source.publishedDate) invalid("Invalid calendar date");
    }
  }
  for (const passage of evidence.passages) {
    if (!sources.has(passage.sourceId)) invalid("Unknown passage source");
    if (passage.provenance === "retrieved" && !passage.retrievedAt) invalid("Retrieved evidence needs retrieval time");
  }
}

function assertRetrievedPassages(ids: string[], evidence: OnDemandEvidence) {
  if (!ids.length) invalid("No supporting passages");
  unique(ids, "supporting passage ID");
  for (const id of ids) {
    const passage = evidence.passages.find((candidate) => candidate.id === id);
    if (!passage || passage.provenance !== "retrieved" || !passage.retrievedAt) {
      invalid("Material support requires independently retrieved evidence");
    }
  }
}

export function discoveryEvidence(output: OnDemandResearchOutput): OnDemandEvidence {
  return {
    sources: output.sources,
    passages: output.passages.map((passage) => ({ ...passage, provenance: "model_reported", retrievedAt: null })),
  };
}

export async function researchOnDemandIdeas(
  context: OnDemandContext,
  options: OnDemandStageOptions,
  requestedCount = 4,
) {
  onDemandContextSchema.parse(context);
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 6) invalid("Idea count must be bounded to 1–6");
  return runStage("ideas", { context, requestedCount }, onDemandResearchOutputSchema, options, (output, response) => {
    if (output.ideas.length > requestedCount) invalid("Research exceeded requested idea count");
    unique(output.ideas.map((idea) => idea.key), "idea key");
    unique(output.ideas.map((idea) => idea.headline.trim().toLowerCase()), "idea headline");
    const evidence = discoveryEvidence(output);
    assertOnDemandEvidence(evidence);
    const researched = new Set(response.researchedUrls ?? []);
    if (output.sources.some((source) => !researched.has(source.url))) invalid("Unobserved research source URL");
    const passages = new Set(output.passages.map((passage) => passage.id));
    if (output.ideas.some((idea) => idea.passageIds.some((id) => !passages.has(id)))) invalid("Unknown brief passage");
    if (!output.ideas.length && !output.insufficiencyReason) invalid("Empty research requires an honest reason");
  });
}

export async function checkOnDemandIdeas(
  input: { context: OnDemandContext; research: OnDemandResearchOutput; evidence: OnDemandEvidence; batchId: string },
  options: OnDemandStageOptions,
) {
  onDemandContextSchema.parse(input.context);
  onDemandResearchOutputSchema.parse(input.research);
  assertOnDemandEvidence(input.evidence);
  if (!input.batchId) invalid("Idea checks require a stable batch identity");
  const result = await runStage("ideas_check", input, onDemandIdeaChecksSchema, options, (output) => {
    unique(output.ideas.map((idea) => idea.key), "idea check");
    const expected = new Set(input.research.ideas.map((idea) => idea.key));
    if (output.ideas.length !== expected.size || output.ideas.some((idea) => !expected.has(idea.key))) invalid("Every idea requires exactly one check");
    for (const check of output.ideas) {
      if (check.verdict === "pass") {
        if (!check.premiseSupported || !check.fitsLoop || !check.distinctContribution) invalid("Inconsistent idea verdict");
        assertRetrievedPassages(check.passageIds, input.evidence);
      }
    }
  });
  const ideas: OnDemandIdea[] = result.output.ideas.filter((check) => check.verdict === "pass").map((check) => {
    const candidate = input.research.ideas.find((idea) => idea.key === check.key)!;
    return { ...candidate, passageIds: check.passageIds, id: `${input.batchId}:${candidate.key}`, loopId: input.context.loopId, loopRevision: input.context.revision };
  });
  return { ...result, ideas };
}

export type SelectedOnDemandInput = { context: OnDemandContext; idea: OnDemandIdea; evidence: OnDemandEvidence };

function assertSelection(input: SelectedOnDemandInput) {
  onDemandContextSchema.parse(input.context);
  assertOnDemandEvidence(input.evidence);
  if (input.idea.loopId !== input.context.loopId || !Number.isInteger(input.idea.loopRevision) || input.idea.loopRevision < 0 || input.idea.loopRevision > input.context.revision) invalid("Selected idea belongs to a different loop or future context revision");
  assertRetrievedPassages(input.idea.passageIds, input.evidence);
}

function articleLocations(output: OnDemandWriterOutput, includeHeadings = false) {
  if (!output.article) return [];
  return ["title", "deck", ...output.article.summary.map((_, index) => `summary.${index}`), ...output.article.body.flatMap((block, index) => block.type === "heading" && !includeHeadings ? [] : [`body.${index}`])];
}

function assertClaimMap(claims: OnDemandWriterOutput["claims"], locations: string[], evidence: OnDemandEvidence, allowedLocations = locations) {
  unique(claims.map((claim) => claim.id), "claim ID");
  const mapped = new Set<string>();
  for (const claim of claims) {
    assertRetrievedPassages(claim.passageIds, evidence);
    for (const location of claim.locations) {
      if (!allowedLocations.includes(location)) invalid("Unknown claim location");
      mapped.add(location);
    }
  }
  if (locations.some((location) => !mapped.has(location))) invalid("A prose surface is missing its material-claim map");
}

function retainedSourceDate(source: OnDemandEvidence["sources"][number]) {
  return source.datePrecision === "day" ? `${source.publishedDate}T00:00:00.000Z` : null;
}

function retainedSourceLabel(sourceId: string, evidence: OnDemandEvidence) {
  const index = evidence.sources.findIndex((source) => source.id === sourceId);
  if (index < 0) invalid("Unknown citation source");
  const host = new URL(evidence.sources[index].url).hostname.replace(/^www\./, "");
  // Never truncate an identity into a dangling reference. A full hostname or
  // complete numbered label links to the full retained identity in Sources.
  return host.length <= 24 ? host : `Source ${index + 1}`;
}

/** Normalize only after the provider wrapper has retained its raw output/usage.
 * This does not establish factual support: every generated claim still needs
 * the independent full-article check against these exact retained passages. */
export function assembleOnDemandWriterOutput(input: SelectedOnDemandInput, raw: OnDemandWriterProviderOutput): OnDemandWriterOutput {
  const output = onDemandWriterProviderOutputSchema.parse(raw);
  assertOnDemandEvidence(input.evidence);
  if (output.status === "insufficient_evidence") {
    if (output.article || !output.reason) invalid("Inconsistent insufficient-evidence result");
    return { ...output, article: null, claims: [] };
  }
  if (!output.article || output.reason !== null) invalid("Inconsistent written result");
  const authored = output.article;
  const claims: OnDemandWriterOutput["claims"] = [];
  const sourceIds = new Set<string>();
  const append = (location: string, local: Array<{ text: string; passageIds: string[] }>) => {
    const localSources = new Set<string>();
    for (const claim of local) {
      if (claims.length >= 100) invalid("The complete article exceeds the 100-claim bound");
      assertRetrievedPassages(claim.passageIds, input.evidence);
      claims.push({ id: `c${claims.length + 1}`, text: claim.text, locations: [location], passageIds: [...claim.passageIds] });
      for (const id of claim.passageIds) {
        const sourceId = input.evidence.passages.find((passage) => passage.id === id)!.sourceId;
        localSources.add(sourceId);
        sourceIds.add(sourceId);
      }
    }
    return [...localSources].map((sourceKey) => ({ sourceKey, label: retainedSourceLabel(sourceKey, input.evidence) }));
  };
  append("title", authored.title.claims);
  append("deck", authored.deck.claims);
  authored.summary.forEach((surface, index) => append(`summary.${index}`, surface.claims));
  const body = authored.body.map((block, index) => {
    if (block.type === "heading") {
      append(`body.${index}`, block.evidence.claims);
      return { type: block.type, level: block.level, text: block.text };
    }
    const citations = append(`body.${index}`, block.claims);
    return block.type === "quote"
      ? { type: block.type, text: block.text, attribution: block.attribution, citations }
      : { type: block.type, text: block.text, citations };
  });
  const sources = [...sourceIds].map((id) => {
    const source = input.evidence.sources.find((candidate) => candidate.id === id)!;
    return { key: source.id, url: source.url, title: source.title, publisher: source.publisher, publishedAt: retainedSourceDate(source) };
  });
  return onDemandWriterOutputSchema.parse({
    status: "written", reason: null, claims,
    article: { category: authored.category, kicker: authored.kicker, topic: authored.topic,
      whyWritten: authored.whyWritten, readingMinutes: authored.readingMinutes,
      title: authored.title.text, deck: authored.deck.text,
      summary: authored.summary.map((surface) => surface.text), body, sources },
  });
}

async function runWriterStage(stage: "write" | "repair", input: SelectedOnDemandInput, options: OnDemandStageOptions) {
  const result = await runStage(stage, input, onDemandWriterProviderOutputSchema, options);
  try { return { ...result, output: assembleOnDemandWriterOutput(input, result.output) }; }
  catch { throw new ProviderResponseValidationError(`The ${stage} response failed on-demand assembly`, result.usage); }
}

export function assertOnDemandDraft(input: SelectedOnDemandInput, output: OnDemandWriterOutput) {
  onDemandWriterOutputSchema.parse(output);
  if (output.status === "insufficient_evidence") {
    if (output.article || output.claims.length || !output.reason) invalid("Inconsistent insufficient-evidence result");
    return;
  }
  if (!output.article || output.reason !== null) invalid("Inconsistent written result");
  const article = onDemandArticleSchema.parse(output.article);
  if (!article.body.some((block) => block.type === "paragraph")) invalid("An article must contain explanatory prose, not headings alone");
  if (article.title !== input.idea.headline) invalid("Selected headline changed");
  // Every prose surface needs coverage. A factual heading can also carry a
  // material claim, while a neutral section label need not invent one.
  assertClaimMap(output.claims, articleLocations(output), input.evidence, articleLocations(output, true));
  for (const source of article.sources) {
    const evidenceSource = input.evidence.sources.find((candidate) => candidate.id === source.key);
    if (!evidenceSource || source.url !== evidenceSource.url || source.title !== evidenceSource.title || source.publisher !== evidenceSource.publisher) invalid("Article source metadata does not match retained evidence");
    if (source.publishedAt !== retainedSourceDate(evidenceSource)) invalid("Article source date does not match retained evidence precision");
  }
  const includedSourceIds = new Set(article.sources.map((source) => source.key));
  for (const claim of output.claims) {
    for (const id of claim.passageIds) {
      const passage = input.evidence.passages.find((candidate) => candidate.id === id)!;
      if (!includedSourceIds.has(passage.sourceId)) invalid("Claim source omitted from article sources");
    }
  }
  article.body.forEach((block, index) => {
    if (block.type === "heading") return;
    if (block.citations.some((citation) => citation.label !== retainedSourceLabel(citation.sourceKey, input.evidence))) invalid("Article citation label does not match canonical retained source identity");
    if (block.citations.some((citation) => malformedCitationLabel(citation.label))) invalid("A citation label contains an unfinished reference fragment");
    if (block.type === "paragraph" && hasInlineCitationDebris(block.text, block.citations.map((citation) => citation.label))) invalid("Citation references belong only in structured citation fields, not inline prose");
    const claims = output.claims.filter((claim) => claim.locations.includes(`body.${index}`));
    const supportSources = new Set(claims.flatMap((claim) => claim.passageIds.map((id) => input.evidence.passages.find((passage) => passage.id === id)!.sourceId)));
    if (block.citations.some((citation) => !supportSources.has(citation.sourceKey))) invalid("A block citation lacks mapped supporting evidence");
    if (block.type === "quote") {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
      if (!claims.some((claim) => claim.passageIds.some((id) => normalize(input.evidence.passages.find((passage) => passage.id === id)!.text).includes(normalize(block.text))))) invalid("Quotation is absent from cited retained passages");
    }
  });
}

function malformedCitationLabel(label: string) {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const character of label) {
    if ("([{".includes(character)) stack.push(character);
    else if (character in pairs && stack.pop() !== pairs[character]) return true;
  }
  return stack.length > 0;
}

function hasInlineCitationDebris(text: string, labels: string[]) {
  // Match duplicated actual citation labels / unmistakable reference markers,
  // not arbitrary brackets that may be legitimate mathematics or notation.
  if (/cite|【\d+(?::\d+)?†|\[(?:source|reference|ref)[ _:-]*\d+\]/i.test(text)) return true;
  return labels.some((label) => new RegExp(`\\[\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|[\\])]|$)`, "i").test(text));
}

function initialDraftFindings(output: OnDemandWriterOutput, error: unknown): OnDemandDraftValidationFinding[] {
  const findings: OnDemandDraftValidationFinding[] = error instanceof z.ZodError
    ? error.issues.slice(0, 12).map((issue) => ({ location: `article.${issue.path.join(".")}`.slice(0, 80), reason: issue.message.slice(0, 500) }))
    : [{ location: "article", reason: error instanceof Error ? error.message.slice(0, 500) : "The complete draft failed deterministic validation." }];
  const mapped = new Set(output.claims.flatMap((claim) => claim.locations));
  for (const location of articleLocations(output)) {
    if (!mapped.has(location)) findings.push({ location, reason: "This non-heading prose surface has no material-claim mapping. Body indices include every heading in the array." });
  }
  output.article?.body.forEach((block, index) => {
    if (block.type === "heading") return;
    if (block.citations.some((citation) => malformedCitationLabel(citation.label))) findings.push({ location: `body.${index}`, reason: "Replace unfinished citation labels with concise, accurate source-identity labels." });
    if (block.type === "paragraph" && hasInlineCitationDebris(block.text, block.citations.map((citation) => citation.label))) findings.push({ location: `body.${index}`, reason: "Remove duplicated inline reference fragments; citations belong only in structured fields." });
  });
  const distinct = findings.filter((finding, index) => findings.findIndex((other) => other.location === finding.location && other.reason === finding.reason) === index);
  return distinct.length <= 24 ? distinct : [...distinct.slice(0, 23), { location: "article", reason: "Additional deterministic defects may remain. Revalidate the entire draft and complete claim map, not only the listed findings." }];
}

export function writeOnDemandArticle(input: SelectedOnDemandInput, options: OnDemandStageOptions) {
  assertSelection(input);
  return runWriterStage("write", input, options).then((result) => {
    try { assertOnDemandDraft(input, result.output); }
    catch (error) {
      // Unparseable output never reaches this point; inconsistent insufficiency
      // is terminal rather than permission to invent an article during repair.
      if (result.output.status === "written" && result.output.article) {
        throw new OnDemandDraftValidationError(result, initialDraftFindings(result.output, error));
      }
      throw new ProviderResponseValidationError("The write response failed on-demand validation", result.usage);
    }
    return result;
  });
}

function assertCheckCoverage(check: OnDemandCheckOutput, claims: OnDemandWriterOutput["claims"], evidence: OnDemandEvidence) {
  unique(check.claims.map((claim) => claim.claimId), "checked claim ID");
  const expected = new Set(claims.map((claim) => claim.id));
  if (check.claims.length !== expected.size || check.claims.some((claim) => !expected.has(claim.claimId))) invalid("Checker did not assess every claim exactly once");
  for (const claim of check.claims) {
    if (claim.verdict === "supported") assertRetrievedPassages(claim.passageIds, evidence);
    else if (claim.passageIds.length) assertRetrievedPassages(claim.passageIds, evidence);
  }
}

export function onDemandCheckAccepted(check: OnDemandCheckOutput) {
  return check.verdict === "pass" && check.promiseFulfilled && check.readerFit && check.continuity && check.privacyPassed && check.sourceMetadataPassed && check.missedMaterialClaims.length === 0 && check.findings.every((finding) => finding.severity !== "material") && check.claims.every((claim) => claim.verdict === "supported");
}

/** Publication/replay gate for the exact retained draft and evidence packet.
 * This validates complete checker coverage, not semantic truth by itself. */
export function assertAcceptedOnDemandArticleCheck(
  selection: SelectedOnDemandInput, draft: OnDemandWriterOutput, check: OnDemandCheckOutput,
) {
  assertSelection(selection);
  assertOnDemandDraft(selection, draft);
  onDemandCheckOutputSchema.parse(check);
  if (draft.status !== "written" || !draft.article) invalid("editorial_withheld");
  assertCheckCoverage(check, draft.claims, selection.evidence);
  if (!onDemandCheckAccepted(check)) invalid("editorial_withheld");
  const displayedSources = new Set(draft.article.sources.map((source) => source.key));
  const supportedByBody = new Map<string, Set<string>>();
  for (const checked of check.claims) {
    const supportSources = new Set(checked.passageIds.map((id) =>
      selection.evidence.passages.find((passage) => passage.id === id)!.sourceId));
    if ([...supportSources].some((id) => !displayedSources.has(id))) invalid("Checked support source is absent from article sources");
    const claim = draft.claims.find((candidate) => candidate.id === checked.claimId)!;
    for (const location of claim.locations) {
      if (!location.startsWith("body.")) continue;
      const block = draft.article.body[Number(location.slice(5))];
      if (!block) invalid("Unknown claim location");
      // Heading blocks have no inline-citation field. Their mapped claims still
      // require full checking and support from the displayed overall sources.
      if (block.type === "heading") continue;
      if (!block.citations.some((citation) => supportSources.has(citation.sourceKey))) {
        invalid("A displayed body citation lacks checker-supported evidence for its claim");
      }
      const blockSupport = supportedByBody.get(location) ?? new Set<string>();
      for (const sourceId of supportSources) blockSupport.add(sourceId);
      supportedByBody.set(location, blockSupport);
    }
  }
  draft.article.body.forEach((block, index) => {
    if (block.type === "heading") return;
    const blockSupport = supportedByBody.get(`body.${index}`);
    if (block.citations.some((citation) => !blockSupport?.has(citation.sourceKey))) {
      invalid("An extra displayed citation has no checker-supported claim in its block");
    }
  });
}

export async function checkOnDemandArticle(input: SelectedOnDemandInput & { draft: OnDemandWriterOutput }, options: OnDemandStageOptions) {
  assertSelection(input);
  assertOnDemandDraft(input, input.draft);
  if (input.draft.status !== "written") invalid("Cannot check an unavailable article");
  const locations = articleLocations(input.draft, true) as [string, ...string[]];
  const result = await runStage("check", input, onDemandArticleCheckProviderSchema(locations), options, (output) => {
    const check = { ...output, sourceMetadataPassed: true };
    assertCheckCoverage(check, input.draft.claims, input.evidence);
    if (onDemandCheckAccepted(check)) assertAcceptedOnDemandArticleCheck(input, input.draft, check);
  });
  // This flag certifies only exact server-owned metadata, already validated
  // above. No factual verdict, finding, missing claim or prose flag is changed.
  const output = { ...result.output, sourceMetadataPassed: true };
  return { ...result, output, accepted: onDemandCheckAccepted(output) };
}

export type OnDemandArticleRepairInput = SelectedOnDemandInput & { draft: OnDemandWriterOutput } & (
  { check: OnDemandCheckOutput; validationFindings?: never } |
  { validationFindings: OnDemandDraftValidationFinding[]; check?: never }
);

export function repairOnDemandArticle(input: OnDemandArticleRepairInput, options: OnDemandStageOptions) {
  assertSelection(input);
  const draft = onDemandWriterOutputSchema.parse(input.draft);
  if (draft.status !== "written" || !draft.article || (input.check !== undefined) === (input.validationFindings !== undefined)) invalid("Repair requires exactly one explicit failure report for a written draft");
  if (input.validationFindings !== undefined) onDemandDraftValidationFindingsSchema.parse(input.validationFindings);
  else {
    onDemandCheckOutputSchema.parse(input.check);
    if (input.check.verdict === "insufficient_evidence" || onDemandCheckAccepted(input.check)) invalid("Repair requires a repairable failed check");
  }
  return runWriterStage("repair", input, options).then((result) => {
    try { assertOnDemandDraft(input, result.output); }
    catch { throw new ProviderResponseValidationError("The repair response failed on-demand validation", result.usage); }
    return result;
  });
}

// Convenience composition for local/evaluation callers. Durable production
// integration should invoke/cache/account EACH exported stage independently.
// This never schedules itself and makes at most write + check + repair + recheck.
export async function generateSelectedArticle(
  input: SelectedOnDemandInput,
  stages: {
    write: typeof writeOnDemandArticle;
    check: typeof checkOnDemandArticle;
    repair: typeof repairOnDemandArticle;
  },
  options: { write: OnDemandStageOptions; check: OnDemandStageOptions; repair: OnDemandStageOptions; recheck: OnDemandStageOptions },
) {
  if (new Set(Object.values(options).map((option) => option.idempotencyKey)).size !== 4) invalid("Each generation stage needs a distinct stable request identity");
  const trace: OnDemandStageResult<unknown>[] = [];
  let written: OnDemandStageResult<OnDemandWriterOutput>;
  let repairInput: OnDemandArticleRepairInput | undefined;
  try { written = await stages.write(input, options.write); }
  catch (error) {
    if (!(error instanceof OnDemandDraftValidationError)) throw error;
    written = error.result;
    repairInput = { ...input, draft: error.draft, validationFindings: error.findings };
  }
  trace.push(written);
  if (written.output.status !== "written") return { status: "withheld" as const, article: null, trace };
  if (!repairInput) {
    const checked = await stages.check({ ...input, draft: written.output }, options.check);
    trace.push(checked);
    if (checked.accepted) {
      assertAcceptedOnDemandArticleCheck(input, written.output, checked.output);
      return { status: "accepted" as const, article: written.output.article, claims: written.output.claims, trace };
    }
    if (checked.output.verdict === "insufficient_evidence") return { status: "withheld" as const, article: null, trace };
    repairInput = { ...input, draft: written.output, check: checked.output };
  }
  const repaired = await stages.repair(repairInput, options.repair);
  trace.push(repaired);
  if (repaired.output.status !== "written") return { status: "withheld" as const, article: null, trace };
  const rechecked = await stages.check({ ...input, draft: repaired.output }, options.recheck);
  trace.push(rechecked);
  if (rechecked.accepted) assertAcceptedOnDemandArticleCheck(input, repaired.output, rechecked.output);
  return rechecked.accepted
    ? { status: "accepted" as const, article: repaired.output.article, claims: repaired.output.claims, trace }
    : { status: "withheld" as const, article: null, trace };
}

export type OnDemandQuestionInput = {
  articleId: string;
  articleVersion: number;
  article: NonNullable<OnDemandWriterOutput["article"]>;
  evidence: OnDemandEvidence;
  question: string;
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
};

function assertQuestionInput(input: OnDemandQuestionInput) {
  if (!input.articleId || !Number.isInteger(input.articleVersion) || input.articleVersion < 1 || !input.question.trim() || input.question.length > 2000 || input.conversation.length > 12 || input.conversation.some((message) => message.text.length > 8000)) invalid("Invalid bounded article question context");
  onDemandArticleSchema.parse(input.article);
  assertOnDemandEvidence(input.evidence);
}

function assertOnDemandAnswer(input: OnDemandQuestionInput, output: OnDemandAnswerOutput) {
  assertQuestionInput(input);
  onDemandAnswerOutputSchema.parse(output);
  if (output.status === "answered") {
    if (output.missingEvidence !== null) invalid("Answered question has unresolved evidence");
    assertClaimMap(output.claims, ["answer"], input.evidence);
  } else {
    if (!output.missingEvidence) invalid("Insufficient answer needs an evidence limitation");
    if (output.claims.length) assertClaimMap(output.claims, ["answer"], input.evidence);
  }
}

export function assertAcceptedOnDemandAnswerCheck(
  question: OnDemandQuestionInput, answer: OnDemandAnswerOutput, check: OnDemandCheckOutput,
) {
  assertOnDemandAnswer(question, answer);
  onDemandCheckOutputSchema.parse(check);
  assertCheckCoverage(check, answer.claims, question.evidence);
  if (!onDemandCheckAccepted(check)) invalid("editorial_withheld");
}

export function answerOnDemandQuestion(input: OnDemandQuestionInput, options: OnDemandStageOptions) {
  assertQuestionInput(input);
  return runStage("answer", input, onDemandAnswerOutputSchema, options, (output) => assertOnDemandAnswer(input, output));
}

export async function checkOnDemandAnswer(input: OnDemandQuestionInput & { answer: OnDemandAnswerOutput }, options: OnDemandStageOptions) {
  assertOnDemandAnswer(input, input.answer);
  const result = await runStage("check", { ...input, mode: "article_question", requiredProseLocation: "answer" }, onDemandCheckOutputSchema, options, (output) => {
    assertCheckCoverage(output, input.answer.claims, input.evidence);
    if (onDemandCheckAccepted(output)) assertAcceptedOnDemandAnswerCheck(input, input.answer, output);
  });
  return { ...result, accepted: onDemandCheckAccepted(result.output) };
}

const principleSchema = z.object({ id: z.string().min(1).max(120), kind: z.enum(["knowledge", "preference", "direction"]), instruction: z.string().min(1).max(500) }).strict();
export const onDemandFeedbackOutputSchema = z.object({
  status: z.enum(["changes", "no_change", "clarification"]),
  operations: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("set"), targetPrincipleId: z.string().min(1).max(120).nullable(), kind: principleSchema.shape.kind, instruction: principleSchema.shape.instruction }).strict(),
    z.object({ type: z.literal("remove"), targetPrincipleId: z.string().min(1).max(120) }).strict(),
  ])).max(12),
  message: z.string().min(1).max(500),
}).strict();
export type OnDemandFeedbackOutput = z.infer<typeof onDemandFeedbackOutputSchema>;

export function interpretLoopFeedback(
  input: { loopId: string; revision: number; originalCuriosity: string; principles: Array<z.infer<typeof principleSchema>>; feedback: string },
  options: OnDemandStageOptions,
) {
  if (!input.loopId || !Number.isInteger(input.revision) || input.revision < 0 || !input.originalCuriosity || input.originalCuriosity.length > 2000 || !input.feedback.trim() || input.feedback.length > 2000 || input.principles.length > 24) invalid("Invalid loop feedback context");
  input.principles.forEach((principle) => principleSchema.parse(principle));
  unique(input.principles.map((principle) => principle.id), "principle ID");
  return runStage("feedback", input, onDemandFeedbackOutputSchema, options, (output) => {
    if ((output.status === "changes") !== (output.operations.length > 0)) invalid("Inconsistent feedback status");
    const known = new Set(input.principles.map((principle) => principle.id));
    const targets: string[] = [];
    for (const operation of output.operations) {
      if (operation.targetPrincipleId !== null) {
        if (!known.has(operation.targetPrincipleId)) invalid("Feedback targets an unknown/other-loop principle");
        targets.push(operation.targetPrincipleId);
      }
    }
    unique(targets, "feedback target");
    // Applying, assigning IDs, provenance, CAS, Undo and confirmation-after-save
    // belong to the server-owned reducer, never to this model response.
  });
}
