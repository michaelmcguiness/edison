import { z } from "zod";
import { generatedArticleFormatSchema } from "./schemas";

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
  article: generatedArticleFormatSchema.nullable(),
  claims: z.array(onDemandClaimSchema).max(100),
  reason: z.string().max(1500).nullable(),
}).strict();

export const onDemandCheckOutputSchema = z.object({
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
export type OnDemandCheckOutput = z.infer<typeof onDemandCheckOutputSchema>;
export type OnDemandAnswerOutput = z.infer<typeof onDemandAnswerOutputSchema>;
export type OnDemandIdea = z.infer<typeof ideaCandidateSchema> & {
  id: string;
  loopId: string;
  loopRevision: number;
};
