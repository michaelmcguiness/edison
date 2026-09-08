import assert from "node:assert/strict";
import test from "node:test";
import {
  writeReaderFirstArticle, repairReaderFirstArticle, generateReaderFirstIdeas,
  readerFirstWriterProviderSchema, READER_FIRST_DISCOVERY_CONTRACT_VERSION, READER_FIRST_PROMPT_VERSION,
  type ReaderFirstSelection, type ReaderFirstStageOptions,
} from "../packages/ai/src/reader-first";
import { matchReaderFirstDiscoveryUrl } from "../packages/ai/src/reader-first-discovery";
import type { OnDemandProviderRequest, OnDemandProviderResponse } from "../packages/ai/src/on-demand";
import { ProviderResponseValidationError } from "../packages/ai/src/provider-response-error";
import { demandStageDisposition, durableDemandProvider, prepareDemandStage } from "../apps/api/src/services/demand-provider-stages";

// Constructed prose/URLs only. Injected transport exercises production parsing
// and durable fingerprints, not publisher content or measured provider quality.
const base = "https://www.nobelprize.org/stories/women-who-changed-science/marie-curie";
const hint = `${base}?trk=constructed-hint`;
const observed = `${base}?trk=constructed-observed`;
const selected = { discoveryContractVersion: READER_FIRST_DISCOVERY_CONTRACT_VERSION };
const context: ReaderFirstSelection["context"] = {
  loopId: "constructed-loop", revision: 1, originalCuriosity: "How do sensors work?", directions: [], declaredKnowledge: [],
  readingPreferences: [], preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-08",
};
const selection: ReaderFirstSelection = { context, evidence: { sources: [], passages: [] }, idea: {
  key: "sensor", id: "batch:sensor", loopId: context.loopId, loopRevision: 1, headline: "How does a sensor respond?",
  deck: "Connect a signal to an output.", readerQuestion: context.originalCuriosity, payoff: "Understand a response.",
  advanceBeyondPrevious: "A first mechanism.", qualifications: [], passageIds: [],
} };
const usage = { providerResponseId: "constructed-discovery-response", model: "gpt-5.6-terra", inputTokens: 100,
  cachedInputTokens: 0, outputTokens: 80, webSearchCalls: 1, webSearchToolCalls: 3 };
const provenance = (...urls: string[]) => ({ consultedUrls: urls, openedUrls: [], citedUrls: [] });
function article(url = hint) {
  return readerFirstWriterProviderSchema.parse({ status: "written", article: {
    category: "tech-science", kicker: "An explanation", topic: "Sensors", title: selection.idea.headline, deck: selection.idea.deck,
    summary: ["A sensor receives an input.", "It produces a response.", "Tests measure that response."],
    whyWritten: "Connect an input to a response.", readingMinutes: 1, sourceKeys: ["s1"],
    body: Array.from({ length: 10 }, (_, index) => ({ type: "paragraph", text: `Constructed sensor explanation ${index + 1}.`, citations: [{ sourceKey: "s1" }] })),
  }, research: { sources: [{ id: "s1", url, title: "Constructed source", publisher: "nobelprize.org", publishedDate: null, datePrecision: "unknown" }],
    passages: [{ id: "p1", sourceId: "s1", text: "Constructed discovery lead, not independently retrieved text.", locator: "Constructed section" }] }, reason: null });
}
function capture(output = article(), extra: Partial<Omit<OnDemandProviderResponse, "output" | "usage">> = { researchProvenance: provenance(observed) }) {
  const calls: OnDemandProviderRequest[] = [];
  const response = { output, usage, ...extra };
  const options: ReaderFirstStageOptions = { model: usage.model, idempotencyKey: "constructed-request:write", safetyIdentifier: "constructed-reader",
    provider: async (request) => { calls.push(request); return response; } };
  return { options, calls, response };
}
const invalidWithUsage = (error: unknown) => error instanceof ProviderResponseValidationError && error.observedUsage === usage;

test("discovery matcher returns only exact observed strings or one permitted Nobel trk variant", () => {
  assert.equal(matchReaderFirstDiscoveryUrl(hint, [observed]), observed);
  assert.equal(matchReaderFirstDiscoveryUrl(`${hint}#section`, [`${observed}#section`]), `${observed}#section`);
  assert.equal(matchReaderFirstDiscoveryUrl(`${base}?trk=a%26b%3Dc`, [`${base}?trk=other%2Bvalue`]), `${base}?trk=other%2Bvalue`);
  assert.equal(matchReaderFirstDiscoveryUrl(hint, [observed, observed]), observed, "the same actual URL may occur in several provenance lists");
  assert.equal(matchReaderFirstDiscoveryUrl(hint, [observed, `${base}?trk=another`]), null);
  assert.equal(matchReaderFirstDiscoveryUrl(hint, [hint, observed, `${base}?trk=another`]), hint, "exact observed identity wins without rebinding");
  assert.equal(matchReaderFirstDiscoveryUrl("https://example.org/report?edition=2", ["https://example.org/report?edition=2"]), "https://example.org/report?edition=2");
  assert.equal(matchReaderFirstDiscoveryUrl(hint, []), null);
});

test("tracking exception never broadens publisher, path, fragment or meaningful query identity", () => {
  const pairs = [
    [hint, observed.replace("www.nobelprize.org", "nobelprize.org")],
    [hint, observed.replace("www.nobelprize.org", "www.nobelprize.org.example.test")],
    [hint, observed.replace("https:", "http:")],
    [hint, observed.replace("https://", "https://reader@")],
    [hint, observed.replace(".org/", ".org:443/")],
    [hint, observed.replace("marie-curie", "marie-curie/")],
    [hint, observed.replace("marie-curie", "marie-curie.pdf")],
    [hint, observed.replace("marie-curie", "Marie-Curie")],
    [hint, observed.replace("marie-curie", "%6darie-curie")],
    [hint, observed.replace("/marie-curie", "/other/../marie-curie")],
    [hint, `${observed}#different`], [hint, `${observed}#`],
    [hint, base], [base, observed], [hint, `${base}?trk=`], [hint, `${base}?trk`],
    [hint, `${observed}&trk=another`], [hint, `${observed}&edition=2`],
    [`${hint}&edition=2`, `${observed}&edition=2`],
    [hint, observed.replace("?trk=", "?%74rk=")], [hint, observed.replace("?trk=", "?TRK=")],
    [hint, `${observed}\n`], [hint, observed.replace("/stories/", "\\stories/")],
    [hint.replace("nobelprize.org", "example.org"), observed.replace("nobelprize.org", "example.org")],
  ];
  for (const [declared, actual] of pairs) {
    assert.equal(matchReaderFirstDiscoveryUrl(declared, [actual]), null, `${declared} versus ${actual}`);
    assert.equal(matchReaderFirstDiscoveryUrl(actual, [declared]), null, "equivalence cannot work in the unsafe reverse direction either");
  }
});

test("selected writer rebinds one cloned new hint, preserving ten citations and the complete raw billed envelope", async () => {
  const seen = capture(); const before = structuredClone({ selection, response: seen.response });
  const result = await writeReaderFirstArticle(selection, { ...seen.options, ...selected });
  assert.equal(result.output.research.sources[0].url, observed);
  assert.equal(result.output.article!.sources[0].url, observed);
  assert.equal(result.output.article!.sources[0].key, "s1");
  assert.deepEqual(result.output.article!.body.map((block) => block.type !== "heading" && block.citations.map((citation) => citation.sourceKey)), Array.from({ length: 10 }, () => ["s1"]));
  assert.deepEqual(result.output.research.passages, before.response.output.research.passages);
  assert.ok(result.output.research.passages.every((passage) => !Object.hasOwn(passage, "retrievedAt") && !Object.hasOwn(passage, "provenance")));
  assert.deepEqual({ selection, response: seen.response }, before);
  assert.equal(result.usage, usage); assert.equal(result.researchProvenance, seen.response.researchProvenance);
  assert.equal(seen.calls.length, 1); assert.equal(seen.calls[0].promptVersion, READER_FIRST_DISCOVERY_CONTRACT_VERSION);
  assert.equal(result.promptVersion, READER_FIRST_DISCOVERY_CONTRACT_VERSION);
  assert.equal(Object.hasOwn(seen.calls[0].input as object, "discoveryContractVersion"), false);
});

test("missing selector retains the exact legacy failure and invalid explicit selectors stop before provider work", async () => {
  const legacy = capture(); await assert.rejects(writeReaderFirstArticle(selection, legacy.options), invalidWithUsage);
  assert.equal(legacy.calls[0].promptVersion, READER_FIRST_PROMPT_VERSION);
  for (const discoveryContractVersion of [undefined, null, "", "unknown-version"]) {
    const seen = capture();
    await assert.rejects(writeReaderFirstArticle(selection, { ...seen.options, discoveryContractVersion } as ReaderFirstStageOptions), /Unsupported reader-first discovery contract/);
    assert.equal(seen.calls.length, 0);
  }
  const seen = capture();
  await assert.rejects(generateReaderFirstIdeas(context, { ...seen.options, ...selected }), /only supported for article authoring/);
  assert.equal(seen.calls.length, 0, "the article correction cannot upgrade another kind of generation");
});

test("all actual provenance channels work, but legacy researchedUrls and ambiguous candidates confer no substitution", async () => {
  for (const channel of ["consultedUrls", "openedUrls", "citedUrls"] as const) {
    const actual = { consultedUrls: [], openedUrls: [], citedUrls: [], [channel]: [observed] };
    const seen = capture(article(), { researchProvenance: actual });
    assert.equal((await writeReaderFirstArticle(selection, { ...seen.options, ...selected })).output.research.sources[0].url, observed);
  }
  for (const extra of [{ researchedUrls: [observed] }, { researchProvenance: provenance(observed, `${base}?trk=another`) }]) {
    const seen = capture(article(), extra); const before = structuredClone(seen.response);
    await assert.rejects(writeReaderFirstArticle(selection, { ...seen.options, ...selected }), invalidWithUsage);
    assert.deepEqual(seen.response, before);
  }
});

test("retained evidence identity is strict and duplicate source URLs after rebinding remain invalid", async () => {
  const seen = capture();
  const evidence = { sources: [{ ...seen.response.output.research.sources[0], url: observed }], passages: [] };
  const before = structuredClone(evidence);
  await assert.rejects(writeReaderFirstArticle({ ...selection, evidence }, { ...seen.options, ...selected }), invalidWithUsage);
  assert.deepEqual(evidence, before, "a retained source ID cannot be rewritten through tracking equivalence");
  const retained = capture(article(observed), {});
  assert.equal((await writeReaderFirstArticle({ ...selection, evidence }, { ...retained.options, ...selected })).output.research.sources[0].url, observed);
  for (const duplicate of ["id", "url-after-rebind"] as const) {
    const raw = article();
    raw.research.sources.push({ ...raw.research.sources[0], id: duplicate === "id" ? "s1" : "s2", url: `${base}?trk=second-hint` });
    const duplicateSeen = capture(raw); const unchanged = structuredClone(raw);
    await assert.rejects(writeReaderFirstArticle(selection, { ...duplicateSeen.options, ...selected }), invalidWithUsage);
    assert.deepEqual(raw, unchanged);
  }
});

test("sole article repair uses the selected contract without changing original draft or raw repaired response", async () => {
  const original = capture(article(observed));
  const draft = (await writeReaderFirstArticle(selection, original.options)).output;
  const seen = capture(); const before = structuredClone({ draft, response: seen.response });
  const input = { ...selection, draft, deterministicFindings: [{ location: "body.0", reason: "Clarify the constructed explanation." }] };
  const repaired = await repairReaderFirstArticle(input, { ...seen.options, ...selected });
  assert.equal(repaired.output.article!.sources[0].url, observed);
  assert.equal(seen.calls.length, 1); assert.equal(seen.calls[0].stage, "repair");
  assert.equal(seen.calls[0].promptVersion, READER_FIRST_DISCOVERY_CONTRACT_VERSION);
  assert.deepEqual({ draft, response: seen.response }, before);
  const legacy = capture(); await assert.rejects(repairReaderFirstArticle(input, legacy.options), invalidWithUsage);
});

test("the chosen normalization contract is frozen before the provider await", async () => {
  for (const current of [false, true]) {
    const seen = capture(); const options: ReaderFirstStageOptions = { ...seen.options, ...(current ? selected : {}) };
    options.provider = async (request) => {
      seen.calls.push(request);
      Object.assign(options, { discoveryContractVersion: current ? undefined : READER_FIRST_DISCOVERY_CONTRACT_VERSION });
      return seen.response;
    };
    if (current) assert.equal((await writeReaderFirstArticle(selection, options)).output.research.sources[0].url, observed);
    else await assert.rejects(writeReaderFirstArticle(selection, options), invalidWithUsage);
    assert.equal(seen.calls[0].promptVersion, current ? READER_FIRST_DISCOVERY_CONTRACT_VERSION : READER_FIRST_PROMPT_VERSION);
  }
});

test("only the selected stage version changes wire identity, and old cached work cannot be relabeled or called again", async () => {
  const old = capture(article(observed)); const fresh = capture();
  await writeReaderFirstArticle(selection, old.options);
  await writeReaderFirstArticle(selection, { ...fresh.options, ...selected });
  const environment = { OPENAI_ARTICLE_MODEL: usage.model, OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };
  const oldIdentity = prepareDemandStage("constructed-request", "constructed-reader", old.calls[0], environment).identity;
  const newIdentity = prepareDemandStage("constructed-request", "constructed-reader", fresh.calls[0], environment).identity;
  const { promptVersion: oldVersion, estimatedCeilingMicrousd: oldEstimate, ...oldWire } = oldIdentity.snapshot;
  const { promptVersion: newVersion, estimatedCeilingMicrousd: newEstimate, ...newWire } = newIdentity.snapshot;
  assert.equal(oldVersion, READER_FIRST_PROMPT_VERSION); assert.equal(newVersion, READER_FIRST_DISCOVERY_CONTRACT_VERSION);
  assert.deepEqual(oldWire, newWire, "instructions, schema, prose input, tools, model, timeout and output limits are unchanged");
  assert.ok(oldEstimate > 0 && newEstimate > 0, "existing byte-based estimates still account for the selected version length");
  assert.equal(oldIdentity.stageKey, newIdentity.stageKey); assert.notEqual(oldIdentity.requestFingerprint, newIdentity.requestFingerprint);
  const saved = { status: "succeeded" as const, requestFingerprint: oldIdentity.requestFingerprint, leaseExpiresAt: null, output: old.response };
  const before = structuredClone(saved); let calls = 0;
  const cached = durableDemandProvider("constructed-request", "constructed-reader", { environment,
    provider: async () => { calls++; throw new Error("No provider call is permitted"); },
    store: {
      reserve: async (identity, now) => demandStageDisposition(saved, identity.requestFingerprint, now) === "replay"
        ? { disposition: "replay", response: structuredClone(saved.output) } : { disposition: "stop", code: "provider_snapshot_mismatch" },
      record: async () => { throw new Error("No cached receipt update is permitted"); },
      uncertain: async () => { throw new Error("No cached stage update is permitted"); },
    },
  });
  await assert.rejects(writeReaderFirstArticle(selection, { ...old.options, ...selected, provider: cached }), error => error instanceof Error && "code" in error && error.code === "provider_snapshot_mismatch");
  assert.equal((await writeReaderFirstArticle(selection, { ...old.options, provider: cached })).output.article!.sources[0].url, observed);
  assert.equal(calls, 0); assert.deepEqual(saved, before);
});
