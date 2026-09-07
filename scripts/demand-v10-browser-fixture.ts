/** Local, constructed UI evidence only. No database, provider, timers, or
 * production route is involved. Lifecycle completion is always operator-driven.
 *
 * EDISON_V10_FIXTURE=1 node --import tsx scripts/demand-v10-browser-fixture.ts
 * EDISON_V10_FIXTURE=1 node --import tsx scripts/demand-v10-browser-fixture.ts --self-test
 * Operator: POST /__fixture/control, X-Edison-Fixture-Operator: local-only
 * {action:'complete',requestId,count?:0..6} | {action:'fail',requestId,retryable?:boolean}
 * {action:'stage',requestId,stage} | {action:'next-stage',stage}
 * {action:'fault',mode:'fail'|'lose-response',path?:'/v1/demand/...'}
 * {action:'seed-turns',articleId,count:0..240,failedIndex?:number}
 * {action:'seed-history',count:0..180} | {action:'reset'}
 * Read-only IDs/counters: GET /__fixture/state. No control is shipped in the UI.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import {
  archiveDemandLoopSchema, createDemandArticleShareSchema, createDemandLoopSchema,
  demandAnswerV2Schema, demandArticleResultSchema, demandArticleSchema, demandArticleShareReceiptSchema,
  demandConversationSchema, demandEventSchema, demandHistorySchema, demandIdeaResultSchema,
  demandQuestionSchema, demandRequestSchema, demandResultSchema, demandWorkspaceSchema,
  editDemandLoopSchema, parseDemandConversationQuery, parseDemandHistoryQuery,
  publicDemandArticleShareSchema, requestDemandArticleSchema, requestDemandIdeasSchema,
  type DemandArticle, type DemandAnswer, type DemandConversationTurn, type DemandIdea,
  type DemandLoop, type DemandRequest, type DemandWorkspace, type PublicDemandArticleShare,
} from "@edison/contracts";

const HOST = "127.0.0.1";
const PORT = 4311;
const TOKEN = "f".repeat(64); // Synthetic fixture credential, never a real session.
const WORKSPACE_ID = id(1);
const BASE_TIME = Date.parse("2026-09-07T13:00:00.000Z");
const STAGES = ["queued", "researching", "checking-ideas", "writing", "checking", "repairing", "updating", "answering"] as const;
type PendingStage = typeof STAGES[number];
type Reply = { status: number; body: unknown; loseResponse?: boolean };
type Fault = { mode: "fail" | "lose-response"; path?: string };

export function assertFixtureEnvironment(environment: Readonly<Record<string, string | undefined>>) {
  if (environment.EDISON_V10_FIXTURE !== "1" || environment.NODE_ENV === "production" || environment.VERCEL !== undefined) {
    throw new Error("fixture_requires_explicit_local_environment");
  }
  // Reject inherited credentials without inspecting, printing, or using them.
  if (Object.entries(environment).some(([key, value]) => value &&
    (/^(?:DATABASE_URL|DIRECT_URL|POSTGRES(?:QL)?_.*|OPENAI_.*)$/.test(key) ||
      /^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|VERCEL_OIDC_TOKEN|VERCEL_TOKEN)$/.test(key)))) {
    throw new Error("fixture_refuses_inherited_live_credentials");
  }
}

function id(number: number) { return `10000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`; }
function copy<T>(value: T): T { return structuredClone(value); }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function error(status: number, code: string, message: string): Reply { return { status, body: { error: { code, message } } }; }
function required<T>(value: T | undefined, message = "That synthetic reading resource was not found."): T {
  if (value === undefined) throw error(404, "not_found", message);
  return value;
}
function cursor(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function readCursor(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const result: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid_cursor");
  return result as Record<string, unknown>;
}
function descending(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }) {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}
function ideaOrder(left: Pick<DemandIdea, "createdAt" | "id" | "rank">, right: Pick<DemandIdea, "createdAt" | "id" | "rank">) {
  return right.createdAt.localeCompare(left.createdAt) || left.rank - right.rank || right.id.localeCompare(left.id);
}

export function createV10Fixture() {
  const loops = new Map<string, DemandLoop>();
  const ideas = new Map<string, DemandIdea>();
  const requests = new Map<string, DemandRequest>();
  const articles = new Map<string, DemandArticle>();
  const turns = new Map<string, DemandConversationTurn[]>();
  const requestText = new Map<string, string>();
  const shares = new Map<string, PublicDemandArticleShare>();
  const articleShares = new Map<string, string>();
  const operations = new Map<string, { fingerprint: string; reply: Reply }>();
  let serial = 10_000;
  let clock = 0;
  let nextStage: PendingStage = "queued";
  let fault: Fault | null = null;
  const counters = { sessions: 0, mutations: 0, replays: 0, admittedRequests: 0, completions: 0,
    questions: 0, shares: 0, edits: 0, archives: 0, opened: 0, saved: 0, lostResponses: 0, failures: 0 };
  const timestamp = () => new Date(BASE_TIME + clock++ * 1000).toISOString();
  const newId = () => id(serial++);
  const pending = (request: DemandRequest) => request.status === "queued" || request.status === "running";
  function makeRequest(kind: DemandRequest["kind"], loopId: string, ideaId: string | null,
    options: { id?: string; succeeded?: boolean; stage?: PendingStage } = {}) {
    const stage = options.stage ?? nextStage;
    const time = timestamp();
    const request = demandRequestSchema.parse({ id: options.id ?? newId(), loopId, ideaId, kind,
      status: options.succeeded ? "succeeded" : stage === "queued" ? "queued" : "running",
      stage: options.succeeded ? "ready" : stage, failure: null, createdAt: time, updatedAt: time });
    requests.set(request.id, request);
    return request;
  }
  function workspace(): DemandWorkspace {
    return demandWorkspaceSchema.parse({ workspaceId: WORKSPACE_ID, readerKind: "guest",
      loops: [...loops.values()], ideas: [...ideas.values()].sort(ideaOrder).slice(0, 360),
      requests: [...requests.values()].sort(descending).slice(0, 120) });
  }
  function envelope(request?: DemandRequest): Reply {
    return { status: request && pending(request) ? 202 : 200,
      body: { workspace: workspace(), ...(request ? { requestId: request.id } : {}) } };
  }
  function usableLoop(loopId: string) {
    const loop = required(loops.get(loopId));
    if (loop.archivedAt) throw error(409, "loop_archived", "This loop has been deleted. Existing reading remains available.");
    return loop;
  }
  function revision(loop: DemandLoop, expected: number) {
    if (loop.revision !== expected) throw error(409, "loop_changed", "The loop changed. Reload its current settings before saving.");
  }
  function addIdeas(request: DemandRequest, count = 6) {
    const loop = required(loops.get(request.loopId));
    const titles = ["How a sensor turns light into a number", "Why a measurement needs a reference",
      "What a changing signal can tell you", "How to separate a reading from its noise",
      "Why two sensors can disagree", "What a useful calibration test establishes"];
    const time = timestamp();
    for (let index = 0; index < count; index++) {
      const ideaId = request.id === id(80) ? id(100 + index) : newId();
      ideas.set(ideaId, { id: ideaId, loopId: loop.id, batchRequestId: request.id, batchRevision: loop.revision,
        rank: index + 1, title: loop.id === id(10) ? titles[index] : `${titles[index]} · ${loop.title.slice(0, 32)}`,
        deck: "A practical explanation of the mechanism, with a concrete example and the limits of what the example shows.",
        articleRequestId: null, saved: false, createdAt: time });
    }
  }
  function makeArticle(idea: DemandIdea, request: DemandRequest, sourced: boolean) {
    const sourceId = id(900);
    const citations = sourced ? [{ sourceId, label: "Fixture reference" }] : [];
    const paragraphs = [
      "A sensor does not begin with a number. It begins with a physical change. Light falling on a light-sensitive component changes an electrical property, and the surrounding circuit turns that change into a signal that another part of the system can read. Following those steps is more useful than imagining that the sensor simply knows how bright a room is.",
      "Consider a lamp and a sensor placed on a desk. Moving the lamp changes the light reaching the sensor. The sensor circuit responds, but its output is still an electrical signal, not a statement about what the lamp is doing. The interpretation comes from the relationship established between that signal and a known reference.",
      "The next step is conversion. An analog-to-digital converter represents the signal with a finite set of numbers. Small changes that fall between available steps cannot each receive their own distinct number. This is one reason that a long string of digits on a display does not, by itself, establish how accurately a quantity was measured.",
      "A reference measurement gives those numbers meaning. If a known input produces a particular output, that pair supplies an anchor. Several anchors can reveal whether the relationship is approximately straight over the range of interest or whether a curved relationship needs to be considered. Calibration describes that relationship; it does not make every future reading correct.",
      "An everyday comparison is a kitchen scale. The instrument can show a stable number while a small offset remains. A check with a suitable known mass can expose the offset. It does not establish that the scale behaves equally well at every weight, temperature, or position on the counter. The test answers a bounded question.",
      "Repeated readings help separate variation from a steady shift. A group of values that clusters tightly can still be centered on the wrong answer. Precision describes the clustering, while accuracy concerns closeness to an appropriate reference. Keeping those ideas separate prevents a repeatable measurement from being mistaken for a fully verified one.",
      "Noise adds another layer. Some variation belongs to the input itself, and some comes from the sensor, circuit, or surrounding conditions. Averaging may make certain fluctuations less visible, but it can also hide a short event. The useful choice depends on whether the reader needs a stable background level or a record of rapid changes.",
      "A good test therefore begins with a question. You might ask whether the sensor can distinguish two light levels under a fixed arrangement. Hold other conditions steady, compare the readings, and repeat the comparison. The result speaks to that arrangement and those levels; it is not a certificate for every situation in which the device might be used.",
      "It also helps to record what changed. Distance, angle, surrounding light, supply conditions, and timing can all influence an observation. A short record makes a surprising result easier to investigate. Without that record, a later difference may look like a failure even when the measuring situation has changed.",
      "The central lesson is a chain of interpretation: physical input, sensor response, electrical signal, conversion, and comparison with a reference. Each link contributes something necessary, and each introduces limits. Once the chain is visible, questions about a device become more concrete: which link was tested, under what conditions, and what remains unknown?",
    ];
    const article = demandArticleSchema.parse({ id: request.id, slug: `fixture-${request.id}`, category: "tech-science",
      kicker: "A practical explanation", title: idea.title, deck: idea.deck, readingMinutes: 5,
      sourceCount: sourced ? 1 : 0, researchedAt: sourced ? timestamp() : null, basis: sourced ? "mixed" : "general_knowledge",
      reason: "Private fixture direction: understand mechanisms with concrete examples.",
      summary: ["A sensor converts a physical change into a readable signal.", "A reference connects the signal with an interpretation.", "A test establishes a bounded result, not universal performance."],
      saved: idea.saved, completed: false, topic: "Measurement", writtenFor: "Private synthetic reader instructions; never include in a public share.",
      shareId: null, correction: null,
      body: paragraphs.flatMap((text, index) => index % 3 === 0
        ? [{ type: "heading" as const, level: 2 as const, text: ["From change to signal", "Giving the number meaning", "Understanding variation", "What the test establishes"][index / 3] },
          { type: "paragraph" as const, text, citations }]
        : [{ type: "paragraph" as const, text, citations }]),
      sources: sourced ? [{ id: sourceId, title: "Constructed measurement reference for UI testing", publisher: "Fixture reference",
        url: "https://example.org/fixture-measurement", publishedAt: null, accessedAt: timestamp() }] : [],
    });
    articles.set(request.id, article);
    idea.articleRequestId = request.id;
    return article;
  }
  function answer(question: string, sourced = false): DemandAnswer {
    const sourceId = id(901);
    return demandAnswerV2Schema.parse({ version: 2, basis: sourced ? "mixed" : "general_knowledge",
      researchedAt: sourced ? timestamp() : null,
      body: [{ type: "paragraph", text: `You asked: “${question}” This is an explicitly constructed answer for the local interface check. The useful distinction is between the physical signal and the interpretation assigned to it.`, citations: [] },
        { type: "paragraph", text: "For example, a steady display can show repeatable readings without establishing that the readings match a reference. A scoped comparison addresses that question; it does not prove performance in every setting.",
          citations: sourced ? [{ sourceId, label: "Answer fixture" }] : [] }],
      sources: sourced ? [{ id: sourceId, title: "Constructed answer-owned reference", publisher: "Answer fixture",
        url: "https://example.org/fixture-answer", publishedAt: null, accessedAt: timestamp() }] : [] });
  }
  function syncTurn(request: DemandRequest, resolvedAnswer: DemandAnswer | null = null) {
    for (const conversation of turns.values()) {
      const turn = conversation.find((item) => item.request.id === request.id);
      if (turn) { turn.request = copy(request); turn.answer = resolvedAnswer; }
    }
  }
  function seedTurns(articleId: string, count: number, failedIndex?: number) {
    const article = required(articles.get(articleId));
    const idea = required([...ideas.values()].find((item) => item.articleRequestId === article.id));
    for (const previous of turns.get(articleId) ?? []) { requests.delete(previous.request.id); requestText.delete(previous.request.id); }
    const conversation: DemandConversationTurn[] = [];
    for (let index = 0; index < count; index++) {
      const time = new Date(Date.parse("2026-09-01T12:00:00Z") + index * 1000).toISOString();
      const question = `Constructed earlier question ${index + 1}: what does a reference measurement establish?`;
      const request = demandRequestSchema.parse({ id: newId(), loopId: idea.loopId, ideaId: idea.id, kind: "question",
        status: "succeeded", stage: "ready", failure: null, createdAt: time, updatedAt: time });
      if (index === failedIndex) {
        request.status = "failed"; request.stage = "failed";
        request.failure = { code: "worker_interrupted", retryable: true, message: "This constructed earlier answer can resume saved work." };
      }
      requests.set(request.id, request); requestText.set(request.id, question);
      conversation.push({ request, question, answer: index === failedIndex ? null : answer(question, index % 3 === 0) });
    }
    turns.set(articleId, conversation);
  }
  function seedHistory(count: number) {
    const example = required(ideas.get(id(100)));
    for (let index = 0; index < count; index++) {
      const time = new Date(Date.parse("2026-08-20T12:00:00Z") + index * 1000).toISOString();
      const idea: DemandIdea = { ...copy(example), id: newId(), title: `Constructed saved reading ${index + 1}: interpreting a measurement`,
        createdAt: time, rank: 1, saved: true, articleRequestId: null };
      const request = makeRequest("article", idea.loopId, idea.id, { succeeded: true });
      request.createdAt = time; request.updatedAt = time;
      ideas.set(idea.id, idea); makeArticle(idea, request, false); turns.set(request.id, []);
    }
  }
  function reset() {
    for (const map of [loops, ideas, requests, articles, turns, requestText, shares, articleShares, operations]) map.clear();
    serial = 10_000; clock = 0; nextStage = "queued"; fault = null;
    for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
    const names = ["Light sensors", "Architecture", "Synthetic Biology", "Artificial Intelligence", "History",
      "Luxury Hospitality — how exceptional hotels are designed, operated, and experienced by their guests", "Cryptocurrency", "Space exploration"];
    names.forEach((title, index) => {
      const time = timestamp();
      const loop: DemandLoop = { id: id(10 + index), title, originalCuriosity: index === 0
        ? "Explain how sensors turn physical changes into useful measurements, using concrete examples and their limitations."
        : `Help me understand ${title.toLowerCase()} through clear explanations and useful examples.`,
        revision: 0, instructions: index === 0 ? "Explain how sensors turn physical changes into useful measurements, using concrete examples and their limitations." : `Help me understand ${title.toLowerCase()} through clear explanations and useful examples.`,
        archivedAt: null, principles: index === 0 ? [{ id: id(700), kind: "preference", instruction: "Use concise examples.", source: "reader" }] : [],
        lastMutationId: null, canUndo: false, createdAt: time, updatedAt: time };
      loops.set(loop.id, loop);
      addIdeas(makeRequest("ideas", loop.id, null, { id: id(80 + index), succeeded: true }));
    });
    for (let index = 0; index < 2; index++) {
      const idea = required(ideas.get(id(100 + index))); idea.saved = true;
      makeArticle(idea, makeRequest("article", idea.loopId, idea.id, { id: id(200 + index), succeeded: true }), index === 1);
      turns.set(id(200 + index), []);
    }
    for (const [index, stage] of [[3, "queued"], [4, "checking"]] as const) {
      const idea = required(ideas.get(id(100 + index)));
      idea.articleRequestId = makeRequest("article", idea.loopId, idea.id, { id: id(202 + index - 3), stage }).id;
    }
    const failures = [required(ideas.get(id(105))), required([...ideas.values()].find((idea) => idea.loopId === id(11)))];
    failures.forEach((idea, index) => {
      const request = makeRequest("article", idea.loopId, idea.id, { id: id(204 + index) });
      request.status = "failed"; request.stage = "failed";
      request.failure = { code: index ? "worker_interrupted" : "editorial_withheld", retryable: Boolean(index),
        message: index ? "This synthetic request can resume saved work." : "We couldn’t finish this article. Nothing was published." };
      idea.articleRequestId = request.id;
    });
    seedTurns(id(200), 125);
    workspace();
  }
  reset();

  function mutation(path: string, input: { idempotencyKey: string }, run: () => Reply): Reply {
    const fingerprint = digest({ path, input });
    const existing = operations.get(input.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return error(409, "idempotency_key_reused", "That synthetic operation identity was used for different input.");
      counters.replays++;
      const saved = copy(existing.reply);
      if (saved.body && typeof saved.body === "object" && "workspace" in saved.body) saved.body = { ...saved.body, workspace: workspace() };
      return saved;
    }
    const plannedFault = fault && (!fault.path || fault.path === path) ? fault : null;
    if (plannedFault) fault = null;
    if (plannedFault?.mode === "fail") { counters.failures++; return error(503, "fixture_injected_failure", "The local operator made this synthetic operation fail. Nothing was saved."); }
    const reply = run();
    operations.set(input.idempotencyKey, { fingerprint, reply: copy(reply) }); counters.mutations++;
    if (plannedFault?.mode === "lose-response") { counters.lostResponses++; return { ...reply, loseResponse: true }; }
    return reply;
  }
  function articleResult(articleId: string) {
    const article = required(articles.get(articleId));
    const request = required(requests.get(articleId));
    const idea = required(ideas.get(request.ideaId!));
    return demandArticleResultSchema.parse({ workspaceId: WORKSPACE_ID, idea, request, article: { ...article, saved: idea.saved }, loop: required(loops.get(idea.loopId)) });
  }
  function complete(request: DemandRequest, count: number, sourced: boolean) {
    if (!pending(request)) throw error(409, "fixture_not_pending", "Only a pending synthetic request can be completed.");
    if (request.kind === "ideas") addIdeas(request, count);
    if (request.kind === "article") makeArticle(required(ideas.get(request.ideaId!)), request, sourced);
    request.status = "succeeded"; request.stage = "ready"; request.failure = null; request.updatedAt = timestamp();
    if (request.kind === "question") syncTurn(request, answer(required(requestText.get(request.id)), sourced));
    counters.completions++;
  }
  function state() {
    return { fixture: true, host: HOST, port: PORT, workspaceId: WORKSPACE_ID, counters: copy(counters),
      loops: [...loops.values()].map(({ id, title, revision, archivedAt }) => ({ id, title, revision, archivedAt })),
      articles: [...articles.values()].map(({ id, title, basis }) => ({ id, title, basis, ownerPath: `/articles/${id}`, conversationTurns: turns.get(id)?.length ?? 0 })),
      pending: [...requests.values()].filter(pending), failed: [...requests.values()].filter((request) => request.status === "failed"),
      shares: [...shares.keys()].map((token) => ({ token, localPath: `/s/demand/${token}` })),
      ideaIds: [...ideas.keys()], nextStage, fault, providerCalls: 0, databaseCalls: 0 };
  }
  function control(input: Record<string, unknown>): Reply {
    const stage = input.stage;
    if (input.action === "reset") reset();
    else if (input.action === "fault") {
      if (!["fail", "lose-response"].includes(String(input.mode)) ||
          (input.path !== undefined && (typeof input.path !== "string" || !input.path.startsWith("/v1/demand/")))) throw new Error("invalid_control");
      fault = { mode: input.mode as Fault["mode"], ...(input.path ? { path: String(input.path) } : {}) };
    } else if (input.action === "next-stage") {
      if (!STAGES.includes(stage as PendingStage)) throw new Error("invalid_stage"); nextStage = stage as PendingStage;
    } else if (input.action === "seed-turns") {
      if (!Number.isInteger(input.count) || Number(input.count) < 0 || Number(input.count) > 240) throw new Error("invalid_count");
      if (input.failedIndex !== undefined && (!Number.isInteger(input.failedIndex) || Number(input.failedIndex) < 0 || Number(input.failedIndex) >= Number(input.count))) throw new Error("invalid_index");
      seedTurns(String(input.articleId), Number(input.count), input.failedIndex === undefined ? undefined : Number(input.failedIndex));
    } else if (input.action === "seed-history") {
      if (!Number.isInteger(input.count) || Number(input.count) < 0 || Number(input.count) > 180) throw new Error("invalid_count");
      seedHistory(Number(input.count));
    } else {
      const request = required(requests.get(String(input.requestId)));
      if (input.action === "complete") {
        const count = input.count ?? 6;
        if (!Number.isInteger(count) || Number(count) < 0 || Number(count) > 6) throw new Error("invalid_count");
        complete(request, Number(count), input.sourced === true);
      } else if (input.action === "stage") {
        if (!pending(request) || !STAGES.includes(stage as PendingStage)) throw new Error("invalid_stage");
        request.stage = stage as PendingStage; request.status = stage === "queued" ? "queued" : "running"; request.updatedAt = timestamp(); syncTurn(request);
      } else if (input.action === "fail") {
        if (!pending(request)) throw new Error("request_not_pending");
        request.status = "failed"; request.stage = "failed"; request.updatedAt = timestamp();
        request.failure = { code: input.retryable === true ? "worker_interrupted" : "editorial_withheld", retryable: input.retryable === true,
          message: "We couldn’t finish this article. Nothing was published." }; syncTurn(request); counters.failures++;
      } else throw new Error("invalid_control");
    }
    return { status: 200, body: state() };
  }

  async function handle(method: string, rawUrl: string, body: unknown = {}, headers: Record<string, string | undefined> = {}): Promise<Reply> {
    try {
      const url = new URL(rawUrl, `http://${HOST}:${PORT}`); const path = url.pathname;
      if (path === "/health" && method === "GET") return { status: 200, body: { ok: true, fixture: true, providerCalls: 0, databaseCalls: 0 } };
      if (path === "/__fixture/state" && method === "GET") return { status: 200, body: state() };
      if (path === "/__fixture/control" && method === "POST") {
        if (headers["x-edison-fixture-operator"] !== "local-only" || headers.origin) return error(403, "operator_required", "Use the local operator channel.");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_control");
        return control(body as Record<string, unknown>);
      }
      const parts = path.split("/").filter(Boolean);
      if (method === "GET" && parts.slice(0, 3).join("/") === "v1/public/demand-shares" && parts.length === 4) {
        return { status: 200, body: publicDemandArticleShareSchema.parse(required(shares.get(parts[3]))) };
      }
      if (parts[0] !== "v1" || parts[1] !== "demand") return error(404, "not_found", "No fixture route exists here.");
      if (headers.authorization) return error(401, "fixture_guest_only", "This fixture never accepts real account credentials.");
      if (parts[2] === "session" && method === "POST") {
        if (headers["x-edison-demand-token"] && headers["x-edison-demand-token"] !== TOKEN) return error(401, "guest_session_invalid", "Unknown synthetic session.");
        counters.sessions++;
        return { status: headers["x-edison-demand-token"] ? 200 : 201, body: { workspace: workspace(),
          ...(!headers["x-edison-demand-token"] ? { newGuestToken: TOKEN } : {}) } };
      }
      if (headers["x-edison-demand-token"] !== TOKEN) return error(401, "reading_session_required", "Start the synthetic reading session first.");
      if (method === "GET") {
        if (parts[2] === "workspace" && parts.length === 3) return envelope();
        if (parts[2] === "history" && parts.length === 3) {
          const query = parseDemandHistoryQuery(url.searchParams); const anchor = readCursor(query.cursor);
          if (anchor && (anchor.scope !== query.scope || anchor.loopId !== (query.loopId ?? null) || typeof anchor.createdAt !== "string" || typeof anchor.id !== "string" || !Number.isInteger(anchor.rank))) throw new Error("invalid_cursor");
          const rows = [...ideas.values()].filter((idea) => (!query.loopId || idea.loopId === query.loopId) && (query.scope !== "saved" || idea.saved))
            .sort(ideaOrder).filter((idea) => !anchor || ideaOrder(idea, anchor as Pick<DemandIdea, "createdAt" | "id" | "rank">) > 0);
          const page = rows.slice(0, 60); const last = page.at(-1);
          return { status: 200, body: demandHistorySchema.parse({ workspaceId: WORKSPACE_ID, ideas: page,
            requests: page.flatMap((idea) => idea.articleRequestId ? [required(requests.get(idea.articleRequestId))] : []),
            nextCursor: rows.length > 60 && last ? cursor({ scope: query.scope, loopId: query.loopId ?? null, createdAt: last.createdAt, id: last.id, rank: last.rank }) : null }) };
        }
        if (parts[2] === "ideas" && parts.length === 4) {
          const idea = required(ideas.get(parts[3]));
          return { status: 200, body: demandIdeaResultSchema.parse({ workspaceId: WORKSPACE_ID, idea,
            request: idea.articleRequestId ? required(requests.get(idea.articleRequestId)) : null }) };
        }
        if (parts[2] === "requests" && parts.length === 4) {
          const request = required(requests.get(parts[3]));
          const turn = [...turns.values()].flat().find((item) => item.request.id === request.id);
          return { status: 200, body: demandResultSchema.parse({ request, article: articles.get(request.id) ?? null, answer: turn?.answer ?? null }) };
        }
        if (parts[2] === "articles" && parts.length === 4) return { status: 200, body: articleResult(parts[3]) };
        if (parts[2] === "articles" && parts[4] === "conversation" && parts.length === 5) {
          articleResult(parts[3]); const query = parseDemandConversationQuery(url.searchParams); const anchor = readCursor(query.cursor);
          if (anchor && (anchor.articleId !== parts[3] || typeof anchor.createdAt !== "string" || typeof anchor.id !== "string")) throw new Error("invalid_cursor");
          const rows = [...(turns.get(parts[3]) ?? [])].sort((a, b) => descending(a.request, b.request))
            .filter((turn) => !anchor || descending(turn.request, anchor as { createdAt: string; id: string }) > 0);
          const page = rows.slice(0, 60); const last = page.at(-1);
          return { status: 200, body: demandConversationSchema.parse({ workspaceId: WORKSPACE_ID, articleId: parts[3],
            turns: page.reverse(), nextCursor: rows.length > 60 && last ? cursor({ articleId: parts[3], createdAt: last.request.createdAt, id: last.request.id }) : null }) };
        }
      }
      if (method === "POST" && parts[2] === "loops" && parts.length === 3) {
        const input = createDemandLoopSchema.parse(body);
        return mutation(path, input, () => {
          if (loops.size >= 30) throw error(409, "loop_limit", "This synthetic workspace has reached its loop limit.");
          const time = timestamp(); const loopId = newId(); const phrase = input.curiosity.split(/[.!?\n\r]/, 1)[0].trim();
          const text = input.curiosity.replace(/\s+/g, " "); const prefix = text.slice(0, 48);
          const title = phrase && phrase.length <= 40 && phrase.length < input.curiosity.length ? phrase
            : text.length > 48 && prefix.includes(" ") ? prefix.slice(0, prefix.lastIndexOf(" ")) : prefix;
          loops.set(loopId, { id: loopId, title, originalCuriosity: input.curiosity, instructions: input.curiosity, revision: 0,
            archivedAt: null, principles: [], lastMutationId: null, canUndo: false, createdAt: time, updatedAt: time });
          const request = makeRequest("ideas", loopId, null); counters.admittedRequests++; return envelope(request);
        });
      }
      if (method === "POST" && parts[2] === "loops" && parts.length === 5) {
        if (parts[4] === "ideas") {
          const input = requestDemandIdeasSchema.parse(body);
          return mutation(path, input, () => {
            const loop = usableLoop(parts[3]); revision(loop, input.baseRevision);
            if ([...requests.values()].some((request) => request.loopId === loop.id && request.kind === "ideas" && pending(request))) throw error(409, "reading_busy", "Ideas are already being prepared for this loop.");
            const request = makeRequest("ideas", loop.id, null); counters.admittedRequests++; return envelope(request);
          });
        }
        if (parts[4] === "edit") {
          const input = editDemandLoopSchema.parse(body);
          return mutation(path, input, () => {
            const loop = usableLoop(parts[3]); revision(loop, input.baseRevision);
            if (input.name !== loop.title && input.name.length > 80) throw error(400, "loop_name_too_long", "Use a loop name of 80 characters or fewer.");
            const changed = input.instructions !== loop.instructions || input.name !== loop.title;
            if (input.instructions !== loop.instructions) loop.principles = [];
            if (changed) { loop.title = input.name; loop.instructions = input.instructions; loop.revision++; loop.updatedAt = timestamp(); loop.canUndo = false; loop.lastMutationId = null; }
            counters.edits++; return envelope();
          });
        }
        if (parts[4] === "archive") {
          const input = archiveDemandLoopSchema.parse(body);
          return mutation(path, input, () => {
            const loop = usableLoop(parts[3]); revision(loop, input.baseRevision);
            loop.archivedAt = timestamp(); loop.updatedAt = loop.archivedAt; counters.archives++; return envelope();
          });
        }
      }
      if (method === "POST" && parts[2] === "articles" && parts[4] === "share" && parts.length === 5) {
        const input = createDemandArticleShareSchema.parse(body);
        return mutation(path, input, () => {
          const { article, request } = articleResult(parts[3]); const previous = articleShares.get(article.id);
          if (previous) return { status: 200, body: demandArticleShareReceiptSchema.parse({ token: previous, createdAt: required(shares.get(previous)).createdAt, created: false }) };
          const token = digest({ fixture: true, articleId: article.id }); const createdAt = timestamp();
          // Explicit public projection, never spread a private article or turn.
          const share = publicDemandArticleShareSchema.parse({ token, createdAt, article: {
            version: 1, title: article.title, deck: article.deck, body: copy(article.body), sources: copy(article.sources),
            sourceCount: article.sourceCount, basis: article.basis, researchedAt: article.researchedAt,
            readingMinutes: article.readingMinutes, publishedAt: request.updatedAt, correction: article.correction ?? null,
          } });
          shares.set(token, share); articleShares.set(article.id, token); counters.shares++;
          return { status: 201, body: demandArticleShareReceiptSchema.parse({ token, createdAt, created: true }) };
        });
      }
      if (method === "POST" && parts[2] === "ideas" && parts.length === 5) {
        if (parts[4] === "article") {
          const input = requestDemandArticleSchema.parse(body);
          return mutation(path, input, () => {
            const idea = required(ideas.get(parts[3]));
            if (idea.articleRequestId) return envelope(required(requests.get(idea.articleRequestId)));
            usableLoop(idea.loopId);
            const request = makeRequest("article", idea.loopId, idea.id); idea.articleRequestId = request.id;
            counters.admittedRequests++; return envelope(request);
          });
        }
        if (parts[4] === "questions") {
          const input = demandQuestionSchema.parse(body);
          return mutation(path, input, () => {
            const idea = required(ideas.get(parts[3])); const articleId = required(idea.articleRequestId ?? undefined); articleResult(articleId);
            if ([...requests.values()].some((request) => request.ideaId === idea.id && request.kind === "question" && pending(request))) throw error(409, "reading_busy", "A question is already being answered.");
            const request = makeRequest("question", idea.loopId, idea.id); requestText.set(request.id, input.question);
            turns.set(articleId, [...(turns.get(articleId) ?? []), { request: copy(request), question: input.question, answer: null }]);
            counters.admittedRequests++; counters.questions++; return envelope(request);
          });
        }
      }
      if (method === "POST" && parts[2] === "requests" && parts[4] === "retry" && parts.length === 5) {
        const request = required(requests.get(parts[3]));
        if (pending(request)) return envelope(request);
        if (!request.failure?.retryable) return error(409, "request_not_retryable", "That synthetic request cannot be retried.");
        request.status = "queued"; request.stage = "queued"; request.failure = null; request.updatedAt = timestamp(); syncTurn(request);
        return envelope(request);
      }
      if (method === "PUT" && parts[2] === "ideas" && parts[4] === "events" && parts.length === 5) {
        const input = demandEventSchema.parse(body);
        return mutation(path, input, () => {
          const idea = required(ideas.get(parts[3]));
          if (input.type === "saved") { idea.saved = input.saved; counters.saved++; }
          if (input.type === "opened") counters.opened++;
          return envelope();
        });
      }
      return error(404, "not_found", "No fixture route exists here.");
    } catch (caught) {
      if (caught && typeof caught === "object" && "status" in caught && "body" in caught) return caught as Reply;
      return error(400, "invalid_request", "That synthetic fixture request is not valid.");
    }
  }
  return { handle, state };
}

function localOrigin(origin: string | undefined) {
  if (!origin) return true;
  try { const parsed = new URL(origin); return parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.origin === origin; }
  catch { return false; }
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length; if (bytes > 8192) throw new Error("request_too_large"); chunks.push(buffer);
  }
  return bytes ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export async function selfTestV10Fixture() {
  assert.doesNotThrow(() => assertFixtureEnvironment({ EDISON_V10_FIXTURE: "1" }));
  for (const environment of [{}, { EDISON_V10_FIXTURE: "1", NODE_ENV: "production" }, { EDISON_V10_FIXTURE: "1", VERCEL: "0" },
    { EDISON_V10_FIXTURE: "1", DATABASE_URL: "never-read" }, { EDISON_V10_FIXTURE: "1", OPENAI_API_KEY: "never-read" }]) {
    assert.throws(() => assertFixtureEnvironment(environment));
  }
  const fixture = createV10Fixture(); const auth = { "x-edison-demand-token": TOKEN };
  const call = (method: string, path: string, body: unknown = {}) => fixture.handle(method, path, body, auth);
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  assert.equal((await fixture.handle("GET", "/v1/demand/workspace")).status, 401);
  assert.equal((await fixture.handle("GET", "/v1/demand/workspace", {}, { ...auth, authorization: "Bearer rejected-fixture-input" })).status, 401);
  assert.equal((await fixture.handle("POST", "/__fixture/control", { action: "reset" },
    { "x-edison-fixture-operator": "local-only", origin: "http://127.0.0.1:3000" })).status, 403);
  const session = await fixture.handle("POST", "/v1/demand/session"); assert.equal(session.status, 201);
  assert.equal((session.body as { newGuestToken: string }).newGuestToken, TOKEN);
  assert.equal((await call("GET", `/v1/public/demand-shares/${"a".repeat(64)}`)).status, 404);
  for (const articleId of [id(200), id(201)]) demandArticleResultSchema.parse((await call("GET", `/v1/demand/articles/${articleId}`)).body);
  let continuation = ""; const turnIds = new Set<string>();
  do {
    const page = demandConversationSchema.parse((await call("GET", `/v1/demand/articles/${id(200)}/conversation${continuation ? `?cursor=${continuation}` : ""}`)).body);
    page.turns.forEach((turn) => { assert.ok(!turnIds.has(turn.request.id)); turnIds.add(turn.request.id); }); continuation = page.nextCursor ?? "";
  } while (continuation);
  assert.equal(turnIds.size, 125);
  const qPath = `/v1/demand/ideas/${id(100)}/questions`; const question = { question: "What exactly does this test establish?", idempotencyKey: "fixture-question-1" };
  await operator({ action: "fault", mode: "lose-response", path: qPath });
  const lost = await call("POST", qPath, question); assert.equal(lost.loseResponse, true);
  const questionId = (lost.body as { requestId: string }).requestId;
  const replay = await call("POST", qPath, question); assert.equal((replay.body as { requestId: string }).requestId, questionId);
  assert.equal(fixture.state().counters.questions, 1); assert.equal(fixture.state().counters.completions, 0);
  assert.equal((await call("POST", qPath, { ...question, question: "A different question with the same key" })).status, 409);
  await operator({ action: "complete", requestId: questionId, sourced: true });
  const result = demandResultSchema.parse((await call("GET", `/v1/demand/requests/${questionId}`)).body);
  assert.ok(result.answer && "body" in result.answer && result.answer.body[0].text.includes(question.question));
  const sharePath = `/v1/demand/articles/${id(200)}/share`;
  assert.equal((await call("POST", sharePath, { confirmPublic: false, idempotencyKey: "fixture-share-bad" })).status, 400);
  const receipt = demandArticleShareReceiptSchema.parse((await call("POST", sharePath, { confirmPublic: true, idempotencyKey: "fixture-share-1" })).body);
  const publicCopy = publicDemandArticleShareSchema.parse((await call("GET", `/v1/public/demand-shares/${receipt.token}`)).body);
  const serialized = JSON.stringify(publicCopy);
  for (const forbidden of ['"writtenFor":', '"reason":', '"workspaceId":', '"question":', "Private synthetic", "Private fixture"]) assert.ok(!serialized.includes(forbidden));
  const editPath = `/v1/demand/loops/${id(10)}/edit`;
  await operator({ action: "fault", mode: "fail", path: editPath });
  assert.equal((await call("POST", editPath, { name: "Not saved", instructions: "", baseRevision: 0, idempotencyKey: "fixture-edit-failure" })).status, 503);
  assert.equal(fixture.state().loops.find((loop) => loop.id === id(10))?.title, "Light sensors");
  await call("POST", `/v1/demand/loops/${id(10)}/edit`, { name: "<b>Measurements</b>", instructions: "", baseRevision: 0, idempotencyKey: "fixture-edit-1" });
  await call("POST", `/v1/demand/loops/${id(10)}/archive`, { confirmed: true, baseRevision: 1, idempotencyKey: "fixture-archive-1" });
  assert.equal((await call("GET", `/v1/demand/articles/${id(200)}`)).status, 200);
  assert.equal((await call("GET", `/v1/demand/articles/${id(200)}/conversation`)).status, 200);
  const reloaded = await call("POST", "/v1/demand/session");
  const reloadedWorkspace = demandWorkspaceSchema.parse((reloaded.body as { workspace: unknown }).workspace);
  assert.equal(reloadedWorkspace.workspaceId, WORKSPACE_ID);
  assert.ok(reloadedWorkspace.loops.find((loop) => loop.id === id(10))?.archivedAt);
  assert.deepEqual((await call("GET", `/v1/public/demand-shares/${receipt.token}`)).body, publicCopy);
  assert.equal((await call("POST", `/v1/demand/loops/${id(10)}/ideas`, { baseRevision: 1, idempotencyKey: "fixture-ideas-blocked" })).status, 409);
  assert.equal((await call("POST", `/v1/demand/requests/${id(204)}/retry`)).status, 409);
  assert.equal((await call("POST", `/v1/demand/requests/${id(205)}/retry`)).status, 202);
  const more = await call("POST", `/v1/demand/loops/${id(12)}/ideas`, { baseRevision: 0, idempotencyKey: "fixture-more-1" });
  const before = fixture.state().ideaIds.length;
  await operator({ action: "complete", requestId: (more.body as { requestId: string }).requestId, count: 3 });
  assert.equal(fixture.state().ideaIds.length, before + 3);
  await operator({ action: "seed-history", count: 65 });
  const savedPage = demandHistorySchema.parse((await call("GET", "/v1/demand/history?scope=saved")).body);
  assert.equal(savedPage.ideas.length, 60); assert.ok(savedPage.nextCursor);
  const olderSaved = demandHistorySchema.parse((await call("GET", `/v1/demand/history?scope=saved&cursor=${savedPage.nextCursor}`)).body);
  assert.equal(olderSaved.ideas.length, 7);
  assert.ok(olderSaved.ideas.every((idea) => !savedPage.ideas.some((current) => current.id === idea.id)));
  await operator({ action: "seed-turns", articleId: id(200), count: 125, failedIndex: 1 });
  const olderFailure = required(fixture.state().failed.find((request) => request.kind === "question"));
  assert.equal((await call("POST", `/v1/demand/requests/${olderFailure.id}/retry`)).status, 202);
  await operator({ action: "complete", requestId: olderFailure.id });
  assert.equal(demandResultSchema.parse((await call("GET", `/v1/demand/requests/${olderFailure.id}`)).body).request.status, "succeeded");
  assert.equal(fixture.state().providerCalls, 0); assert.equal(fixture.state().databaseCalls, 0);
  return { passed: true, scenarios: ["environment guards", "session isolation", "source-free/sourced articles", "125-turn pagination",
    "lost response/idempotent question", "operator-only completion", "public whitelist", "edit/archive retention", "retry eligibility", "partial More batch", "older saved-reading pages", "older exact question retry"] };
}

async function main() {
  assertFixtureEnvironment(process.env);
  if (process.argv.includes("--self-test")) { process.stdout.write(`${JSON.stringify(await selfTestV10Fixture())}\n`); return; }
  const fixture = createV10Fixture();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Type", "application/json"); response.setHeader("X-Content-Type-Options", "nosniff");
    const remote = request.socket.remoteAddress;
    const origin = request.headers.origin;
    if (remote !== HOST || ![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(request.headers.host ?? "") || !localOrigin(origin)) {
      response.writeHead(403); response.end(JSON.stringify({ error: { code: "local_only", message: "This fixture is localhost-only." } })); return;
    }
    if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Edison-Demand-Token"); response.writeHead(204); response.end(); return;
    }
    let reply: Reply;
    try {
      reply = await fixture.handle(request.method ?? "GET", request.url ?? "/", await readBody(request), {
        origin, authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
        "x-edison-demand-token": typeof request.headers["x-edison-demand-token"] === "string" ? request.headers["x-edison-demand-token"] : undefined,
        "x-edison-fixture-operator": typeof request.headers["x-edison-fixture-operator"] === "string" ? request.headers["x-edison-fixture-operator"] : undefined,
      });
    } catch { reply = error(400, "invalid_request", "That local request was not valid or exceeded 8192 bytes."); }
    if (reply.loseResponse) { response.destroy(); return; }
    response.writeHead(reply.status); response.end(JSON.stringify(reply.body));
  });
  server.listen(PORT, HOST, () => process.stdout.write(`${JSON.stringify({ fixture: true, url: `http://${HOST}:${PORT}`, state: fixture.state() })}\n`));
  server.on("error", () => { process.stderr.write("Local fixture could not bind its fixed address.\n"); process.exitCode = 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("Local fixture refused startup or failed its self-test.\n"); process.exitCode = 1; });
}
