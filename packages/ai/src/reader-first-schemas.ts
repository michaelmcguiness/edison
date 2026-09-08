import { z } from "zod";
import { demandArtDescriptorSchema } from "@edison/contracts";
import { generatedArticleFormatSchema, onDemandArticleFormatSchema } from "./schemas";
import { onDemandSourceSchema } from "./on-demand-schemas";

const key = z.string().min(1).max(40);
const text = z.string().min(1).max(2000);
const citation = z.object({ sourceKey: key, label: z.string().min(1).max(24) }).strict();
const rawCitation = citation.omit({ label: true });
const blocks = <T extends z.ZodTypeAny>(reference: T) => z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1).max(6000), citations: z.array(reference).max(16) }).strict(),
  z.object({ type: z.literal("heading"), level: z.literal(2), text: z.string().min(1).max(300) }).strict(),
  z.object({ type: z.literal("quote"), text: z.string().min(1).max(6000), attribution: z.string().max(240).nullable(), citations: z.array(reference).min(1).max(16) }).strict(),
]);

export const readerFirstBlockSchema = blocks(citation);
const providerBlockSchema = blocks(rawCitation);
export const readerFirstArticleFormatSchema = generatedArticleFormatSchema.extend({
  readingMinutes: z.number().int().min(1).max(20),
  summary: z.array(z.string().min(1).max(280)).length(3),
  body: z.array(readerFirstBlockSchema).min(1).max(40),
  sources: generatedArticleFormatSchema.shape.sources.min(0).max(16),
}).strict();

// Discovery passages are model-reported leads, NEVER independently fetched text.
export const readerFirstResearchSchema = z.object({
  sources: z.array(onDemandSourceSchema).max(16),
  passages: z.array(z.object({ id: key, sourceId: key, text: z.string().min(1).max(12000), locator: z.string().min(1).max(500) }).strict()).max(48),
}).strict();
export const readerFirstIdeaCandidateSchema = z.object({
  key, headline: z.string().min(1).max(180), deck: z.string().min(1).max(500),
  readerQuestion: text, payoff: text, advanceBeyondPrevious: text,
  qualifications: z.array(text).max(8), passageIds: z.array(key).max(12),
  // Older retained briefs have no art. Provider strict JSON requires the
  // nullable field; runtime decoding keeps historical absence unchanged.
  art: demandArtDescriptorSchema.nullable().optional(),
}).strict();
export const readerFirstIdeaSchema = readerFirstIdeaCandidateSchema.extend({
  id: z.string().min(1).max(200), loopId: z.string().min(1).max(120), loopRevision: z.number().int().nonnegative(),
}).strict();
export const readerFirstResearchOutputSchema = readerFirstResearchSchema.extend({
  ideas: z.array(readerFirstIdeaCandidateSchema).max(6), insufficiencyReason: z.string().max(1500).nullable(),
}).strict();

export const readerFirstWriterOutputSchema = z.object({
  status: z.enum(["written", "insufficient_evidence"]), article: readerFirstArticleFormatSchema.nullable(),
  research: readerFirstResearchSchema, reason: z.string().max(1500).nullable(),
}).strict();
// Context-only compatibility: old saved prose remains readable at its original
// limits. This union is never used for new generation or publication approval.
export const readerFirstSavedWriterInputSchema = readerFirstWriterOutputSchema.extend({
  article: z.union([readerFirstArticleFormatSchema, onDemandArticleFormatSchema]).nullable(),
});
export const readerFirstWriterProviderSchema = readerFirstWriterOutputSchema.extend({
  article: readerFirstArticleFormatSchema.omit({ sources: true, body: true }).extend({
    sourceKeys: z.array(key).max(16), body: z.array(providerBlockSchema).min(1).max(40),
  }).strict().nullable(),
}).strict();
export const readerFirstAnswerOutputSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]), body: z.array(readerFirstBlockSchema).max(20),
  sources: readerFirstArticleFormatSchema.shape.sources,
  research: readerFirstResearchSchema, reason: z.string().max(1500).nullable(),
}).strict();
export const readerFirstAnswerProviderSchema = readerFirstAnswerOutputSchema.omit({ sources: true }).extend({
  sourceKeys: z.array(key).max(16), body: z.array(providerBlockSchema).max(20),
}).strict();

export const readerFirstFindingSchema = z.object({
  location: z.string().min(1).max(80), excerpt: z.string().min(1).max(2000),
  severity: z.enum(["material", "nonmaterial"]),
  kind: z.enum(["contradicted", "missing", "verification_required", "citation", "privacy", "reader_fit", "payoff", "clarity"]),
  reason: z.string().min(1).max(1000), repair: z.string().min(1).max(1000), passageIds: z.array(key).max(12),
}).strict();
export const readerFirstCheckOutputSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), verdict: z.enum(["pass", "repair", "insufficient_evidence"]),
  accuracyPassed: z.boolean(), verificationPassed: z.boolean(), promiseFulfilled: z.boolean(),
  readerFit: z.boolean(), continuity: z.boolean(), privacyPassed: z.boolean(),
  findings: z.array(readerFirstFindingSchema).max(24),
}).strict();
export const readerFirstIdeaChecksSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  ideas: z.array(z.object({
    key, verdict: z.enum(["pass", "insufficient_evidence"]), premiseSupported: z.boolean(),
    verificationRequired: z.boolean(), verificationPassed: z.boolean(), fitsLoop: z.boolean(),
    distinctContribution: z.boolean(), passageIds: z.array(key).max(12), reason: text,
  }).strict()).max(6),
}).strict();

export type ReaderFirstResearch = z.infer<typeof readerFirstResearchSchema>;
export type ReaderFirstResearchOutput = z.infer<typeof readerFirstResearchOutputSchema>;
export type ReaderFirstIdea = z.infer<typeof readerFirstIdeaSchema>;
export type ReaderFirstArticle = z.infer<typeof readerFirstArticleFormatSchema>;
export type ReaderFirstBlock = z.infer<typeof readerFirstBlockSchema>;
export type ReaderFirstWriterOutput = z.infer<typeof readerFirstWriterOutputSchema>;
export type ReaderFirstAnswerOutput = z.infer<typeof readerFirstAnswerOutputSchema>;
export type ReaderFirstCheckOutput = z.infer<typeof readerFirstCheckOutputSchema>;
export type ReaderFirstFinding = z.infer<typeof readerFirstFindingSchema>;
