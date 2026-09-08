import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReaderFirstIdeas, generateReaderFirstIdeas, readerFirstResearchOutputSchema,
  readerFirstIdeaSchema, READER_FIRST_IDEAS_ART_PROMPT_VERSION, READER_FIRST_PROMPT_VERSION,
  type ReaderFirstResearchOutput, type ReaderFirstStageOptions,
} from "../packages/ai/src/reader-first";
import { onDemandProviderBody } from "../packages/ai/src/on-demand-provider";
import type { OnDemandContext, OnDemandProviderRequest } from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import { normalizeOnDemandIdeaArt } from "../packages/ai/src/on-demand-art";
import { durableDemandProvider, prepareDemandStage } from "../apps/api/src/services/demand-provider-stages";

// All responses and judgments below are constructed offline fixtures. No real
// source, provider, database or semantic artwork-matching accuracy is measured.
const context: OnDemandContext = { loopId: "art-loop", revision: 1,
  originalCuriosity: "How do living cells make proteins?", directions: [], declaredKnowledge: [], readingPreferences: [],
  previousArticles: [], preferences: { length: "brief", depth: 50 }, currentDate: "2026-09-07" };
const descriptor = { version: 1 as const, composition: "living-system" as const, palette: "sage" as const, variant: 0 };
const idea = { key: "protein", headline: "How do living cells make proteins?", deck: "Follow a genetic instruction to see how a cell makes a protein.",
  readerQuestion: context.originalCuriosity, payoff: "Understand the relationship between a genetic instruction and a protein.",
  advanceBeyondPrevious: "A first explanation.", qualifications: [], passageIds: [], art: descriptor };
const raw: ReaderFirstResearchOutput = { ideas: [idea], sources: [], passages: [], insufficiencyReason: null };
const usage = { providerResponseId: "offline-art-response", model: "gpt-5.6-luna", inputTokens: 100, cachedInputTokens: 0, outputTokens: 120, webSearchCalls: 0 };
function capture(output: unknown | ((request: OnDemandProviderRequest) => unknown)) {
  const calls: OnDemandProviderRequest[] = [];
  const options: ReaderFirstStageOptions = { model: usage.model, idempotencyKey: "art-request:ideas", safetyIdentifier: "art-reader",
    provider: async (request) => { calls.push(request); return { output: typeof output === "function" ? output(request) : output, usage }; } };
  return { calls, options };
}

test("art selection stays inside the existing ideas response and survives the existing independent check", async () => {
  const before = JSON.stringify(raw); const generation = capture(raw);
  const generated = await generateReaderFirstIdeas(context, generation.options, 1);
  assert.deepEqual(generation.calls.map((call) => call.stage), ["ideas"]);
  assert.equal(generation.calls[0].promptVersion, READER_FIRST_IDEAS_ART_PROMPT_VERSION);
  assert.equal(generated.promptVersion, READER_FIRST_IDEAS_ART_PROMPT_VERSION);
  assert.match(generation.calls[0].instructions, /Return null when no supplied composition fits/);
  assert.match(generation.calls[0].instructions, /never research or call a tool solely for art/);
  assert.equal(JSON.stringify(raw), before);
  const wire = onDemandProviderBody(generation.calls[0]);
  assert.ok(wire.tools?.every((tool) => tool.type === "web_search"));
  assert.equal(wire.max_output_tokens, 8000);
  assert.equal(wire.model, usage.model);
  const format = wire.text?.format;
  assert.ok(format?.type === "json_schema");
  const schema = format.schema as { properties: { ideas: { items: { properties: { art: unknown }; required: string[] } } } };
  assert.ok(schema.properties.ideas.items.required.includes("art"));
  assert.match(JSON.stringify(schema.properties.ideas.items.properties.art), /living-system/);
  assert.match(JSON.stringify(schema.properties.ideas.items.properties.art), /"additionalProperties":false/);

  const checking = capture((request: OnDemandProviderRequest) => ({ fingerprint: (request.input as { fingerprint: string }).fingerprint,
    ideas: [{ key: idea.key, verdict: "pass", premiseSupported: true, verificationRequired: false, verificationPassed: true,
      fitsLoop: true, distinctContribution: true, passageIds: [], reason: "Constructed stable concept verdict." }] }));
  const checked = await checkReaderFirstIdeas({ context, research: generated.output, evidence: { sources: [], passages: [] }, batchId: "saved-art-batch" }, checking.options);
  assert.equal(checking.calls[0].promptVersion, READER_FIRST_PROMPT_VERSION);
  assert.deepEqual(checked.ideas[0].art, descriptor);
  assert.deepEqual(readerFirstIdeaSchema.parse(JSON.parse(JSON.stringify(checked.ideas[0]))).art, descriptor);
  assert.equal(checked.ideas[0].id, "saved-art-batch:protein");
  assert.deepEqual(checked.ideas[0].passageIds, []);
  assert.deepEqual(checked.ideas[0].qualifications, []);
});

test("bad art is quarantined without losing valid text, changing retained output or making another call", async () => {
  for (const art of [null, { ...descriptor, svg: "<script>malicious()</script>" }, { ...descriptor, variant: Infinity },
    { ...descriptor, composition: "football" }, "https://example.org/track.svg"]) {
    const output = { ...raw, ideas: [{ ...idea, art }] }; const original = structuredClone(output);
    const generated = capture(output);
    const result = await generateReaderFirstIdeas(context, generated.options, 1);
    assert.equal(result.output.ideas[0].art, null);
    assert.equal(result.output.ideas[0].headline, idea.headline);
    assert.equal(result.output.ideas[0].payoff, idea.payoff);
    assert.equal(generated.calls.length, 1);
    assert.deepEqual(output, original);
  }
});

test("historical absent art remains absent; malformed text and invented evidence still fail normally", async () => {
  const { art, ...historical } = idea;
  assert.deepEqual(art, descriptor);
  const output = { ...raw, ideas: [historical] };
  assert.deepEqual(readerFirstResearchOutputSchema.parse(output), output);
  const generated = await generateReaderFirstIdeas(context, capture(output).options, 1);
  assert.deepEqual(generated.output, output);
  for (const invalid of [
    { ...raw, ideas: [{ ...idea, deck: "", art: "invalid" }] },
    { ...raw, ideas: [{ ...idea, passageIds: ["invented"], art: "invalid" }] },
    { ...raw, ideas: [{ ...idea, body: [{ text: "Not an idea brief" }], art: "invalid" }] },
  ]) {
    const observed = capture(invalid);
    await assert.rejects(generateReaderFirstIdeas(context, observed.options, 1), (error: unknown) =>
      error instanceof ProviderResponseValidationError && error.observedUsage === usage);
    assert.equal(observed.calls.length, 1);
  }
  const oversized = { ...raw, ideas: Array(7).fill(idea) };
  assert.equal(normalizeOnDemandIdeaArt(oversized), oversized, "normalization does not clip an oversized batch");
});

test("cached idea response reuses the same descriptor with zero additional provider calls", async () => {
  const observed = capture(raw);
  await generateReaderFirstIdeas(context, observed.options, 1);
  const request = observed.calls[0];
  const environment = { OPENAI_UTILITY_MODEL: usage.model, OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
  const original = prepareDemandStage("art-request", "art-reader", request, environment);
  let providerCalls = 0;
  const cached = durableDemandProvider("art-request", "art-reader", { environment,
    provider: async () => { providerCalls++; throw new Error("Unexpected image or text provider call"); },
    store: {
      reserve: async (identity) => {
        assert.equal(identity.requestFingerprint, original.identity.requestFingerprint);
        return { disposition: "replay", response: { output: structuredClone(raw), usage } };
      },
      record: async () => { throw new Error("Unexpected cache write"); },
      uncertain: async () => { throw new Error("Unexpected cache mutation"); },
    },
  });
  const restored = await generateReaderFirstIdeas(context, { ...observed.options, provider: cached }, 1);
  assert.deepEqual(restored.output.ideas[0].art, descriptor);
  assert.equal(providerCalls, 0);
  // Exact request freezing distinguishes pre-art snapshots; they cannot be
  // relabeled/recommissioned as this art selection response.
  const previous = prepareDemandStage("art-request", "art-reader", { ...request, promptVersion: READER_FIRST_PROMPT_VERSION,
    schema: readerFirstResearchOutputSchema.extend({ ideas: readerFirstResearchOutputSchema.shape.ideas.element.omit({ art: true }).array().max(6) }) }, environment);
  assert.notEqual(previous.identity.requestFingerprint, original.identity.requestFingerprint);
});
