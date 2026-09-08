import assert from "node:assert/strict";
import test from "node:test";
import {
  answerReaderFirstQuestion, checkReaderFirstAnswer, checkReaderFirstArticle, checkReaderFirstIdeas,
  compileReaderFirstAnswer, compileReaderFirstArticle, generateReaderFirstIdeas,
  readerFirstAnswerFingerprint, readerFirstArticleFingerprint, readerFirstFingerprint,
  repairReaderFirstAnswer, repairReaderFirstArticle, writeReaderFirstArticle,
  READER_FIRST_CHECKER_CONTRACT_VERSION, READER_FIRST_CHECKER_PROMPT,
  READER_FIRST_IDEAS_ART_PROMPT_VERSION, READER_FIRST_PROMPTS, READER_FIRST_PROMPT_VERSION,
  type ReaderFirstCheckOutput, type ReaderFirstQuestion, type ReaderFirstResearchOutput,
  type ReaderFirstSelection, type ReaderFirstStageOptions, type ReaderFirstWriterOutput,
} from "../packages/ai/src/reader-first";
import type { OnDemandProviderRequest } from "../packages/ai/src/on-demand";
import { onDemandProviderBody } from "../packages/ai/src/on-demand-provider";
import {
  DEMAND_PROVIDER_POLICY_VERSION, DEMAND_PROVIDER_PRICING_VERSION, type DemandProviderPolicy,
} from "../packages/ai/src/provider-policy";

// Authored packets and injected responses exercise actual reader-first stages.
// The wire helper is pure: no client, provider, retrieval or database is opened.
const empty = { sources: [], passages: [] };
const usage = { providerResponseId: "constructed-policy-response", model: "injected-model",
  inputTokens: 100, cachedInputTokens: 0, outputTokens: 80, webSearchCalls: 0 };
const repairs = [{ location: "body.0", reason: "Constructed bounded structural repair." }];
const cleanChecker = { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION } as const;

function policy(tier: DemandProviderPolicy["requestedServiceTier"]): DemandProviderPolicy {
  return { version: DEMAND_PROVIDER_POLICY_VERSION, requestedServiceTier: tier,
    pricingVersion: DEMAND_PROVIDER_PRICING_VERSION };
}
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

function fixture() {
  const context: ReaderFirstSelection["context"] = { loopId: "contract-loop", revision: 1,
    originalCuriosity: "How do thermostats work?", directions: [], declaredKnowledge: [], readingPreferences: [],
    preferences: { length: "brief", depth: 50 }, previousArticles: [], currentDate: "2026-09-07" };
  const selection: ReaderFirstSelection = { context, evidence: structuredClone(empty), idea: {
    id: "contract-idea", key: "control", loopId: context.loopId, loopRevision: 1,
    headline: "How does a thermostat control heat?", deck: "Follow an everyday feedback example.",
    readerQuestion: context.originalCuriosity, payoff: "Distinguish a reading from its target.",
    advanceBeyondPrevious: "A first feedback explanation.", qualifications: [], passageIds: [],
  } };
  const value: ReaderFirstWriterOutput = { status: "written", reason: null, research: structuredClone(empty), article: {
    category: "tech-science", kicker: "Feedback", topic: "Thermostats", title: selection.idea.headline,
    deck: selection.idea.deck, summary: ["Read a temperature.", "Compare it with a target.", "Adjust the heat."],
    whyWritten: "An everyday example explains the reader's feedback question.", readingMinutes: 1,
    body: [{ type: "paragraph", text: "A thermostat compares a reading with a target.", citations: [] }], sources: [],
  } };
  const draft = compileReaderFirstArticle(selection, value);
  const question: ReaderFirstQuestion = { context, evidence: selection.evidence, draft,
    articleVersion: "contract-article-v1", question: "What does the measurement establish?", previousMessages: [] };
  const answer = compileReaderFirstAnswer(question, { status: "answered", reason: null,
    research: structuredClone(empty), body: structuredClone(draft.article!.body), sources: [] });
  const candidate = omit(selection.idea, "id", "loopId", "loopRevision");
  const research: ReaderFirstResearchOutput = { ...structuredClone(empty), ideas: [candidate], insufficiencyReason: null };
  const article = omit(draft.article!, "sources");
  const answerFields = omit(answer, "sources");
  return { selection, draft, question, answer, research,
    rawWriter: { ...draft, article: { ...article, sourceKeys: [] } },
    rawAnswer: { ...answerFields, sourceKeys: [] } };
}

type Fixture = ReturnType<typeof fixture>;
const stages = ["ideas", "ideas_check", "write", "article_check", "repair", "answer", "answer_check", "answer_repair"] as const;
type Stage = typeof stages[number];
function isCheck(name: Stage) { return name === "article_check" || name === "answer_check"; }
function invoke(name: Stage, data: Fixture, options: ReaderFirstStageOptions) {
  switch (name) {
    case "ideas": return generateReaderFirstIdeas(data.selection.context, options, 1);
    case "ideas_check": return checkReaderFirstIdeas({ context: data.selection.context, research: data.research,
      evidence: data.selection.evidence, batchId: "constructed-batch" }, options);
    case "write": return writeReaderFirstArticle(data.selection, options);
    case "article_check": return checkReaderFirstArticle({ ...data.selection, draft: data.draft }, options);
    case "repair": return repairReaderFirstArticle({ ...data.selection, draft: data.draft, deterministicFindings: repairs }, options);
    case "answer": return answerReaderFirstQuestion(data.question, options);
    case "answer_check": return checkReaderFirstAnswer({ ...data.question, answer: data.answer }, options);
    case "answer_repair": return repairReaderFirstAnswer({ ...data.question, answer: data.answer, deterministicFindings: repairs }, options);
  }
}
function passed(fingerprint: string): ReaderFirstCheckOutput {
  return { fingerprint, verdict: "pass", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    readerFit: true, continuity: true, privacyPassed: true, findings: [] };
}
function output(name: Stage, data: Fixture, request: OnDemandProviderRequest, options: Partial<ReaderFirstStageOptions>) {
  if (isCheck(name)) {
    const check = passed((request.input as { fingerprint: string }).fingerprint);
    return options.checkerContractVersion ? { check } : check;
  }
  if (name === "ideas") return data.research;
  if (name === "ideas_check") return { fingerprint: (request.input as { fingerprint: string }).fingerprint,
    ideas: [{ key: data.selection.idea.key, verdict: "pass", premiseSupported: true, verificationRequired: false,
      verificationPassed: true, fitsLoop: true, distinctContribution: true, passageIds: [], reason: "Constructed stable mechanism." }] };
  return name === "write" || name === "repair" ? data.rawWriter : data.rawAnswer;
}
async function capture(name: Stage, extra: Partial<ReaderFirstStageOptions> = {}) {
  const data = fixture(), before = JSON.stringify(data), calls: OnDemandProviderRequest[] = [];
  const raw: unknown[] = [], rawBefore: string[] = [];
  const options: ReaderFirstStageOptions = { model: "injected-model", idempotencyKey: "constructed-policy-stage",
    safetyIdentifier: "constructed-reader", ...extra, provider: async (request) => {
      calls.push(request);
      const value = structuredClone(output(name, data, request, extra));
      raw.push(value); rawBefore.push(JSON.stringify(value));
      return { output: value, usage };
    } };
  const result = await invoke(name, data, options);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(data), before, "stage preserves the supplied artifact packet");
  assert.deepEqual(raw.map((value) => JSON.stringify(value)), rawBefore, "raw retained responses are not rewritten");
  assert.deepEqual(result.usage, usage);
  return { data, request: calls[0], raw: raw[0], result };
}
function frozen(request: OnDemandProviderRequest) {
  return { ...omit(request, "schema"), wireFormat: onDemandProviderBody(request).text!.format };
}
function withoutPolicy(request: OnDemandProviderRequest) {
  return omit(request, "providerPolicy");
}
function withoutTier(request: OnDemandProviderRequest) {
  return omit(onDemandProviderBody(request), "service_tier");
}

test("every actual reader-first stage forwards a validated independent policy clone for either service tier", async () => {
  assert.equal(DEMAND_PROVIDER_POLICY_VERSION, "edison-demand-provider-policy-v1");
  assert.equal(DEMAND_PROVIDER_PRICING_VERSION, "openai-terra-luna-2026-09-08-v1");
  for (const name of stages) for (const tier of ["default", "priority"] as const) {
    const supplied = policy(tier), expected = structuredClone(supplied);
    const seen = await capture(name, { providerPolicy: supplied });
    assert.ok(Object.hasOwn(seen.request, "providerPolicy"), name);
    assert.deepEqual(seen.request.providerPolicy, expected, name);
    assert.notEqual(seen.request.providerPolicy, supplied, "caller cannot alter a frozen provider request by alias");
    supplied.requestedServiceTier = tier === "priority" ? "default" : "priority";
    assert.deepEqual(seen.request.providerPolicy, expected, name);
    assert.equal(onDemandProviderBody(seen.request).service_tier, tier, name);
    assert.equal(seen.request.stage, isCheck(name) ? "check" : name === "answer_repair" ? "repair" : name);
  }
});

test("owned undefined, null, partial, unknown and non-strict policies fail before every injected provider", async () => {
  const valid = policy("priority");
  const invalid = [undefined, null, {}, { version: valid.version },
    { ...valid, version: "edison-demand-provider-policy-v2" },
    { ...valid, pricingVersion: "unfrozen-pricing" }, { ...valid, requestedServiceTier: "fast" },
    { ...valid, requestedServiceTier: "auto" }, { ...valid, requestedServiceTier: null },
    { ...valid, unexpected: true }, [], "priority"];
  for (const name of stages) for (const value of invalid) {
    let calls = 0;
    const options = { model: "injected-model", idempotencyKey: "constructed-policy-invalid",
      safetyIdentifier: "constructed-reader", providerPolicy: value,
      provider: async () => { calls++; throw new Error("Invalid policy reached provider"); } } as unknown as ReaderFirstStageOptions;
    assert.ok(Object.hasOwn(options, "providerPolicy"));
    await assert.rejects(async () => invoke(name, fixture(), options), (error: unknown) => {
      assert.equal((error as Error).name, "ZodError"); return true;
    });
    assert.equal(calls, 0, name);
  }
});

test("absent policy preserves pinned pre-policy legacy requests, wire bodies and exact-artifact fingerprints", async () => {
  // Literal baselines captured from committed 7f35e17, before provider-policy
  // changes, using these same authored fixtures and the installed SDK converter.
  const actual: Record<string, unknown> = {};
  for (const name of stages) {
    const seen = await capture(name);
    assert.equal(Object.hasOwn(seen.request, "providerPolicy"), false, name);
    assert.equal(Object.hasOwn(onDemandProviderBody(seen.request), "service_tier"), false, name);
    actual[name] = { request: readerFirstFingerprint(frozen(seen.request)), wire: readerFirstFingerprint(onDemandProviderBody(seen.request)) };
  }
  const data = fixture();
  actual.artifacts = { article: readerFirstArticleFingerprint(data.selection, data.draft),
    answer: readerFirstAnswerFingerprint(data.question, data.answer) };
  assert.deepEqual(actual, {
    ideas: { request: "4a2ade882aeb39b1d884eae7bccb385441620a92508ce47d566a0a5b352b0136",
      wire: "83bfd98b2b51c45cffef43af1414c16996906a99868556eade177541c18fa11f" },
    ideas_check: { request: "40f07d461e27585183573918a917a221801468eb446e0c5af7836a36f11ff06c",
      wire: "b1de9a101d6b37d68554d3a714d578584680b11a61731cc73f0a834957527b3f" },
    write: { request: "be14e4d96f91b15185bc24a4d2a2ce1a90481c878bb1bd864017622707f09445",
      wire: "2a0f752cfaff83d3d81a3c03bf6719719e389fe95f2238fd5703bdc3147bf0b3" },
    article_check: { request: "179e9e0d6599b1dd8eb471c94dcdda7483e28935b734fecab7da26dbfb90d31d",
      wire: "059c6180b32dfdb864e8485e8a1a112a8303131e72abe89b14f83bfc03ae764c" },
    repair: { request: "b9429437a9c78eccfb2ef7ba09c7a84a59c04330aad7a27cb7237e87b66d85a0",
      wire: "2caddabe007e0207e2a05f9529493c5f6eb5452e060a19070f16debe7058756b" },
    answer: { request: "538ef21624a81b7fa07b7b27c845cf4d6632fec30c6947c464c823dece18c81b",
      wire: "14762c9934c1d2d065ad5c697d2a494040cb60443f8a77e04fb1cebbe9765061" },
    answer_check: { request: "ddbe6b15d639569e7d0b23a87bea881f1f99e79a5eae9cd10df7bd245bee3e7c",
      wire: "e615dab1da432f23f86bd3daaeb485eadef3c15b61c50e180eec6333736ebf45" },
    answer_repair: { request: "80196ea1bba8b272c4a6d5c5cc6c89604f1e46bdc464bc8de75087fbd3c5fc79",
      wire: "fe2bfbb5e80c80ce33e7f6bc0a2a5e259e7f7d4947a73a1fec3188006cc6be3c" },
    artifacts: { article: "0515df681ed1b663180584561fa05bace46c61371f0393cb14330631d75087e6",
      answer: "cde5f25d23918bd3f6232cac047bcf2019151df9c135d9550a2c0014fdb800c0" },
  });
});

test("policy changes only provider metadata and the service-tier wire field, not prompts, inputs, schema, caps or results", async () => {
  for (const name of stages) {
    const legacy = await capture(name);
    for (const tier of ["default", "priority"] as const) {
      const selected = await capture(name, { providerPolicy: policy(tier) });
      assert.deepEqual(frozen(withoutPolicy(selected.request)), frozen(legacy.request), name);
      assert.deepEqual(withoutTier(selected.request), onDemandProviderBody(legacy.request), name);
      assert.deepEqual(selected.result, legacy.result, name);
      if (isCheck(name) || name === "ideas_check") {
        assert.equal((selected.request.input as { fingerprint: string }).fingerprint,
          (legacy.request.input as { fingerprint: string }).fingerprint);
      }
    }
  }
});

test("D50 remains a distinct checker pin under either tier and cannot change other stage contracts", async () => {
  for (const name of stages) {
    const legacy = await capture(name), clean = await capture(name, cleanChecker);
    for (const providerOptions of [{}, { providerPolicy: policy("default") }, { providerPolicy: policy("priority") }]) {
      const seen = await capture(name, { ...cleanChecker, ...providerOptions });
      assert.deepEqual(frozen(withoutPolicy(seen.request)), frozen(clean.request), name);
      assert.deepEqual(withoutTier(seen.request), onDemandProviderBody(clean.request), name);
      assert.deepEqual(seen.request.input, legacy.request.input, "neither selector enters artifact or repair identity");
      assert.deepEqual(seen.result.output, legacy.result.output);
      if (isCheck(name)) {
        assert.equal(legacy.request.promptVersion, READER_FIRST_PROMPT_VERSION);
        assert.equal(legacy.request.instructions, READER_FIRST_PROMPTS.check);
        assert.equal(seen.request.promptVersion, READER_FIRST_CHECKER_CONTRACT_VERSION);
        assert.equal(seen.request.instructions, READER_FIRST_CHECKER_PROMPT);
        assert.deepEqual(seen.raw, { check: seen.result.output }, "new checker envelope unwraps losslessly");
        assert.notDeepEqual(onDemandProviderBody(seen.request).text!.format, onDemandProviderBody(legacy.request).text!.format);
      } else {
        assert.equal(seen.request.promptVersion, name === "ideas" ? READER_FIRST_IDEAS_ART_PROMPT_VERSION : READER_FIRST_PROMPT_VERSION);
        assert.deepEqual(frozen(withoutPolicy(seen.request)), frozen(legacy.request), name);
      }
    }
  }
});

test("same-policy replay reconstructs identical requests and retains raw output with either checker contract", async () => {
  for (const name of stages) for (const checkerOptions of [{}, cleanChecker]) {
    const providerPolicy = policy("priority"), first = await capture(name, { ...checkerOptions, providerPolicy });
    const retained = structuredClone(first.raw), before = JSON.stringify(retained);
    let calls = 0;
    const replay = await invoke(name, fixture(), { ...checkerOptions, providerPolicy,
      model: "injected-model", idempotencyKey: "constructed-policy-stage", safetyIdentifier: "constructed-reader",
      provider: async (request) => {
        calls++; assert.deepEqual(frozen(request), frozen(first.request));
        return { output: retained, usage };
      } });
    assert.equal(calls, 1); assert.deepEqual(replay, first.result); assert.equal(JSON.stringify(retained), before);
  }
});
