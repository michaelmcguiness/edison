import { z } from "zod";
import { onDemandArticleFormatSchema } from "./schemas";

const key = z.string().min(1).max(40);
const text = z.string().min(1).max(2000);

export const onDemandContextSchema = z.object({
  loopId: z.string().min(1).max(120),
  revision: z.number().int().nonnegative(),
  originalCuriosity: z.string().min(1).max(2000),
  directions: z.array(text).max(24),
  declaredKnowledge: z.array(text).max(24),
  readingPreferences: z.array(text).max(20).default([]),
  preferences: z.object({
    length: z.enum(["brief", "standard", "deep"]),
    depth: z.number().min(0).max(100),
  }).strict(),
  previousArticles: z.array(z.object({
    title: z.string().min(1).max(180),
    summary: z.array(z.string().max(600)).max(6),
  }).strict()).max(20),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export const onDemandSourceSchema = z.object({
  id: key,
  // Network resolution, redirect limits and private-address rejection belong to
  // the server-owned retriever. A schema-valid URL is not safe to fetch by itself.
  url: z.string().regex(/^https:\/\//).max(2048),
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(160),
  publishedDate: z.string().max(10).nullable(),
  datePrecision: z.enum(["unknown", "year", "month", "day"]),
}).strict();

export const onDemandPassageSchema = z.object({
  id: key,
  sourceId: key,
  text: z.string().min(1).max(12000),
  locator: z.string().min(1).max(500),
  provenance: z.enum(["model_reported", "retrieved"]),
  retrievedAt: z.string().datetime().nullable(),
}).strict();

export const onDemandEvidenceSchema = z.object({
  sources: z.array(onDemandSourceSchema).max(16),
  passages: z.array(onDemandPassageSchema).max(48),
}).strict();

const ideaCandidateSchema = z.object({
  key,
  headline: z.string().min(1).max(180),
  deck: z.string().min(1).max(500),
  readerQuestion: text,
  payoff: text,
  advanceBeyondPrevious: text,
  qualifications: z.array(text).max(8),
  passageIds: z.array(key).min(1).max(12),
}).strict();

// The provider has no field capable of marking its own prose as fetched evidence.
export const onDemandResearchOutputSchema = z.object({
  ideas: z.array(ideaCandidateSchema).max(6),
  sources: z.array(onDemandSourceSchema).max(16),
  passages: z.array(z.object({
    id: key,
    sourceId: key,
    text: z.string().min(1).max(12000),
    locator: z.string().min(1).max(500),
  }).strict()).max(48),
  insufficiencyReason: z.string().max(1000).nullable(),
}).strict();

export const onDemandIdeaChecksSchema = z.object({
  ideas: z.array(z.object({
    key,
    verdict: z.enum(["pass", "insufficient_evidence"]),
    premiseSupported: z.boolean(),
    fitsLoop: z.boolean(),
    distinctContribution: z.boolean(),
    passageIds: z.array(key).max(12),
    reason: text,
  }).strict()).max(6),
}).strict();

export const onDemandClaimSchema = z.object({
  id: key,
  text: z.string().min(1).max(2000),
  // e.g. title, deck, summary.0, body.2; mappings cover ALL prose surfaces.
  locations: z.array(z.string().min(1).max(80)).min(1).max(48),
  passageIds: z.array(key).min(1).max(12),
}).strict();

export const onDemandWriterOutputSchema = z.object({
  status: z.enum(["written", "insufficient_evidence"]),
  article: onDemandArticleFormatSchema.nullable(),
  claims: z.array(onDemandClaimSchema).max(100),
  reason: z.string().max(1500).nullable(),
}).strict();

// Provider-only authoring contract. Evidence lives beside its prose surface;
// locations, claim IDs, citations and source presentation are server-owned.
const localClaimSchema = z.object({ text, passageIds: z.array(key).min(1).max(12) }).strict();
const localClaimsSchema = z.array(localClaimSchema).min(1).max(100);
const surfaceSchema = (prose: z.ZodString) => z.object({ text: prose, claims: localClaimsSchema }).strict();
export const onDemandWriterProviderOutputSchema = z.object({
  status: z.enum(["written", "insufficient_evidence"]),
  article: onDemandArticleFormatSchema.omit({ title: true, deck: true, summary: true, body: true, sources: true }).extend({
    title: surfaceSchema(onDemandArticleFormatSchema.shape.title),
    deck: surfaceSchema(onDemandArticleFormatSchema.shape.deck),
    summary: z.array(surfaceSchema(z.string().min(1).max(280))).length(3),
    body: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("paragraph"), text: z.string().min(1), claims: localClaimsSchema }).strict(),
      z.object({ type: z.literal("quote"), text: z.string().min(1), attribution: z.string().max(240).nullable(), claims: localClaimsSchema }).strict(),
      z.object({ type: z.literal("heading"), level: z.literal(2), text: z.string().min(1), evidence: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("neutral"), claims: z.array(localClaimSchema).length(0) }).strict(),
        z.object({ kind: z.literal("material"), claims: localClaimsSchema }).strict(),
      ]) }).strict(),
    ])).min(6).max(40),
  }).strict().nullable(),
  reason: z.string().max(1500).nullable(),
}).strict();

// These are server-produced structural findings, not a model's factual verdict.
export const onDemandDraftValidationFindingsSchema = z.array(z.object({
  location: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
}).strict()).min(1).max(24);
export type OnDemandDraftValidationFinding = z.infer<typeof onDemandDraftValidationFindingsSchema>[number];

const surfaceVerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "missing", "nonfactual"]),
  passageIds: z.array(key).max(12),
  reason: z.string().min(1).max(160),
}).strict();
export const onDemandSurfaceChecksSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  surfaces: z.array(surfaceVerdictSchema.extend({ location: z.string().min(1).max(80) })).min(1).max(45),
}).strict();

// Question checks deliberately retain their previous provider format.
export const onDemandAnswerCheckProviderSchema = z.object({
  verdict: z.enum(["pass", "repair", "insufficient_evidence"]),
  promiseFulfilled: z.boolean(),
  readerFit: z.boolean(),
  continuity: z.boolean(),
  privacyPassed: z.boolean(),
  sourceMetadataPassed: z.boolean(),
  claims: z.array(z.object({
    claimId: key,
    verdict: z.enum(["supported", "contradicted", "missing"]),
    passageIds: z.array(key).max(12),
    reason: text,
  }).strict()).max(100),
  missedMaterialClaims: z.array(z.object({
    location: z.string().min(1).max(80),
    text,
  }).strict()).max(40),
  findings: z.array(z.object({
    location: z.string().min(1).max(80),
    severity: z.enum(["material", "nonmaterial"]),
    reason: text,
    repair: text,
  }).strict()).max(40),
}).strict();

// Historical/question checks can be read without an article audit. Article
// acceptance explicitly requires it; absence never manufactures a passing audit.
export const onDemandCheckOutputSchema = onDemandAnswerCheckProviderSchema.extend({
  surfaceChecks: onDemandSurfaceChecksSchema.optional(),
});

// Article metadata is assembled and checked by the server, not guessed by a
// model. Question checks retain their existing contract. Prose dates remain
// material claims even when optional source metadata dates are unknown.
export function onDemandArticleCheckProviderSchema(locations: [string, ...string[]], fingerprint: string) {
  const location = z.enum(locations);
  const findingLocation = z.enum([...locations, "whyWritten"] as [string, ...string[]]);
  return onDemandAnswerCheckProviderSchema.omit({ sourceMetadataPassed: true }).extend({
    missedMaterialClaims: z.array(onDemandCheckOutputSchema.shape.missedMaterialClaims.element.extend({ location })).max(40),
    findings: z.array(onDemandCheckOutputSchema.shape.findings.element.extend({ location: findingLocation })).max(40),
    surfaceChecks: z.object({
      // Supplied by the server. A literal copy, never model-computed hashing.
      fingerprint: z.literal(fingerprint),
      surfaces: z.object(Object.fromEntries(locations.map((key) => [key, surfaceVerdictSchema]))).strict(),
    }).strict(),
  }).strict();
}

export const onDemandAnswerOutputSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  answer: z.string().min(1).max(8000),
  claims: z.array(onDemandClaimSchema).max(30),
  missingEvidence: z.string().max(1000).nullable(),
}).strict();

export type OnDemandContext = z.infer<typeof onDemandContextSchema>;
export type OnDemandEvidence = z.infer<typeof onDemandEvidenceSchema>;
export type OnDemandSource = z.infer<typeof onDemandSourceSchema>;
export type OnDemandPassage = z.infer<typeof onDemandPassageSchema>;
export type OnDemandResearchOutput = z.infer<typeof onDemandResearchOutputSchema>;
export type OnDemandWriterOutput = z.infer<typeof onDemandWriterOutputSchema>;
export type OnDemandWriterProviderOutput = z.infer<typeof onDemandWriterProviderOutputSchema>;
export type OnDemandCheckOutput = z.infer<typeof onDemandCheckOutputSchema>;
export type OnDemandSurfaceChecks = z.infer<typeof onDemandSurfaceChecksSchema>;
export type OnDemandAnswerOutput = z.infer<typeof onDemandAnswerOutputSchema>;
export type OnDemandIdea = z.infer<typeof ideaCandidateSchema> & {
  id: string;
  loopId: string;
  loopRevision: number;
};
