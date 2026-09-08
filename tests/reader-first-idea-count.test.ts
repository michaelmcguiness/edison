import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReaderFirstIdeas, generateReaderFirstIdeas,
  type ReaderFirstResearchOutput, type ReaderFirstStageOptions,
} from "../packages/ai/src/reader-first";
import type { OnDemandContext, OnDemandProviderRequest } from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import { demandStageDisposition, durableDemandProvider, prepareDemandStage } from "../apps/api/src/services/demand-provider-stages";

// Constructed briefs and injected checker judgments test count/acceptance
// contracts, not actual writing quality. No real provider or database is used.
const context: OnDemandContext = {
  loopId: "count-loop", revision: 1, originalCuriosity: "How does feedback control work?",
  directions: [], declaredKnowledge: [], readingPreferences: [], previousArticles: [],
  preferences: { length: "brief", depth: 50 }, currentDate: "2026-09-07",
};
const titles = [
  "How does a thermostat know when to stop heating?",
  "Why can a thermostat overshoot its target?",
  "What happens when a temperature sensor is in the wrong place?",
  "Why does a thermostat use a small temperature band?",
  "How does opening a window change a feedback loop?",
  "What does feedback control share with steering a bicycle?",
];
function research(count: number): ReaderFirstResearchOutput {
  return { sources: [], passages: [], insufficiencyReason: count ? null : "No suitable distinct idea was found.",
    ideas: Array.from({ length: count }, (_, index) => ({
      key: `feedback-${index + 1}`, headline: titles[index] ?? "What limits a simple controller?",
      deck: "Follow an everyday example to see what a feedback controller measures and what the measurement cannot establish.",
      readerQuestion: titles[index] ?? "What limits a simple controller?",
      payoff: "Understand one useful distinction through a concrete feedback example.",
      advanceBeyondPrevious: `A distinct constructed angle ${index + 1}.`,
      qualifications: ["A single sensor does not measure every part of a room."], passageIds: [],
    })) };
}
const usage = { providerResponseId: "constructed-count-response", model: "gpt-5.6-luna",
  inputTokens: 100, cachedInputTokens: 0, outputTokens: 80, webSearchCalls: 0 };
function capture(output: unknown | ((request: OnDemandProviderRequest) => unknown)) {
  const calls: OnDemandProviderRequest[] = [];
  const options: ReaderFirstStageOptions = {
    model: usage.model, idempotencyKey: "count-request:ideas", safetyIdentifier: "count-reader",
    provider: async (request) => {
      calls.push(request);
      return { output: typeof output === "function" ? output(request) : output, usage };
    },
  };
  return { calls, options };
}

test("the active default requests six compact ideas without commissioning article bodies", async () => {
  const raw = research(6); const before = JSON.stringify(raw); const seen = capture(raw);
  const result = await generateReaderFirstIdeas(context, seen.options);
  assert.deepEqual(seen.calls.map((request) => request.stage), ["ideas"]);
  assert.deepEqual(seen.calls[0].input, { context, requestedCount: 6 });
  assert.equal(result.output.ideas.length, 6);
  assert.deepEqual(result.output.ideas.map((idea) => idea.headline), titles);
  assert.equal(Object.hasOwn(result.output, "article"), false);
  assert.ok(result.output.ideas.every((idea) => !Object.hasOwn(idea, "body")));
  assert.equal(JSON.stringify(raw), before);
});

test("fewer actual candidates, including explicit insufficiency, remain unchanged and are never padded", async () => {
  for (const count of [0, 1, 3, 5]) {
    const raw = research(count); const before = JSON.stringify(raw); const seen = capture(raw);
    const result = await generateReaderFirstIdeas(context, seen.options);
    assert.equal((seen.calls[0].input as { requestedCount: number }).requestedCount, 6);
    assert.deepEqual(result.output, raw);
    assert.equal(JSON.stringify(raw), before);
  }
});

test("explicit one-through-six counts still work and invalid requested counts stop before dispatch", async () => {
  for (let count = 1; count <= 6; count++) {
    const seen = capture(research(count));
    const result = await generateReaderFirstIdeas(context, seen.options, count);
    assert.equal((seen.calls[0].input as { requestedCount: number }).requestedCount, count);
    assert.equal(result.output.ideas.length, count);
  }
  const forbidden = capture(research(1));
  for (const count of [0, -1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => generateReaderFirstIdeas(context, forbidden.options, count), /Idea count must be 1–6/);
  }
  assert.equal(forbidden.calls.length, 0);
});

test("over-returned candidates and article-body fields are rejected without clipping or changing raw output", async () => {
  const withBody = research(1);
  const cases = [
    { output: research(7), count: undefined },
    { output: research(3), count: 2 },
    { output: { ...withBody, ideas: [{ ...withBody.ideas[0], body: [{ text: "An unsolicited article." }] }] }, count: undefined },
  ];
  for (const { output, count } of cases) {
    const before = JSON.stringify(output); const seen = capture(output);
    await assert.rejects(generateReaderFirstIdeas(context, seen.options, count),
      (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage === usage);
    assert.equal(seen.calls.length, 1);
    assert.equal(JSON.stringify(output), before);
  }
});

test("independent checks cover the actual returned count and filter unacceptable ideas without replacement", async () => {
  for (const count of [3, 6]) {
    const raw = research(count); const before = JSON.stringify(raw);
    const generated = await generateReaderFirstIdeas(context, capture(raw).options);
    const seen = capture((request: OnDemandProviderRequest) => {
      const input = request.input as { research: ReaderFirstResearchOutput; fingerprint: string };
      assert.equal(input.research.ideas.length, count);
      return { fingerprint: input.fingerprint, ideas: input.research.ideas.map((idea, index) => ({
        key: idea.key, verdict: "pass", premiseSupported: true, verificationRequired: index === 1,
        verificationPassed: true, fitsLoop: index !== 0, distinctContribution: true, passageIds: [],
        reason: "Injected judgment; any required current evidence is absent.",
      })) };
    });
    const checked = await checkReaderFirstIdeas({ context, research: generated.output,
      evidence: { sources: [], passages: [] }, batchId: "count-batch" }, seen.options);
    assert.equal(checked.output.ideas.length, count);
    assert.equal(checked.ideas.length, count - 2);
    assert.deepEqual(checked.ideas.map((idea) => idea.key), raw.ideas.slice(2).map((idea) => idea.key));
    assert.deepEqual(seen.calls.map((request) => request.stage), ["ideas_check"]);
    assert.equal(JSON.stringify(raw), before);
    const incomplete = capture((request: OnDemandProviderRequest) => ({ fingerprint: (request.input as { fingerprint: string }).fingerprint,
      ideas: checked.output.ideas.slice(1) }));
    await assert.rejects(checkReaderFirstIdeas({ context, research: generated.output,
      evidence: { sources: [], passages: [] }, batchId: "count-batch" }, incomplete.options), ProviderResponseValidationError);
  }
});

test("the new default cannot silently replay or recommission an old four-count provider stage", async () => {
  const old = capture(research(4)); const current = capture(research(6));
  await generateReaderFirstIdeas(context, old.options, 4);
  await generateReaderFirstIdeas(context, current.options);
  const environment = { OPENAI_UTILITY_MODEL: usage.model, OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
  const oldIdentity = prepareDemandStage("count-request", "count-reader", old.calls[0], environment).identity;
  const newIdentity = prepareDemandStage("count-request", "count-reader", current.calls[0], environment).identity;
  assert.equal(oldIdentity.stageKey, newIdentity.stageKey);
  assert.notEqual(oldIdentity.requestFingerprint, newIdentity.requestFingerprint);
  const saved = { status: "succeeded" as const, requestFingerprint: oldIdentity.requestFingerprint,
    leaseExpiresAt: null, output: { output: research(4), usage } };
  const before = JSON.stringify(saved);
  assert.equal(demandStageDisposition(saved, newIdentity.requestFingerprint, new Date("2026-09-07T12:00:00Z")), "mismatch");
  assert.equal(demandStageDisposition(saved, oldIdentity.requestFingerprint, new Date("2026-09-07T12:00:00Z")), "replay");
  let providerCalls = 0;
  const cached = durableDemandProvider("count-request", "count-reader", { environment,
    provider: async () => { providerCalls++; throw new Error("Unexpected provider call"); },
    store: {
      reserve: async (identity, now) => demandStageDisposition(saved, identity.requestFingerprint, now) === "replay"
        ? { disposition: "replay", response: structuredClone(saved.output) }
        : { disposition: "stop", code: "provider_snapshot_mismatch" },
      record: async () => { throw new Error("Unexpected cache write"); },
      uncertain: async () => { throw new Error("Unexpected cache mutation"); },
    },
  });
  await assert.rejects(cached(current.calls[0]), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "provider_snapshot_mismatch");
  assert.deepEqual(await cached(old.calls[0]), saved.output);
  assert.equal(providerCalls, 0);
  assert.equal(JSON.stringify(saved), before);
});
