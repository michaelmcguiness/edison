/** Local, constructed UI evidence only. No database, provider, timers, or
 * production route is involved. Lifecycle completion is always operator-driven.
 *
 * EDISON_V10_FIXTURE=1 node --import tsx scripts/demand-v10-browser-fixture.ts
 * EDISON_V10_FIXTURE=1 node --import tsx scripts/demand-v10-browser-fixture.ts --self-test
 * V11 opt-in (same localhost address; never run both):
 * EDISON_V11_FIXTURE=1 node --import tsx scripts/demand-v10-browser-fixture.ts [--self-test]
 * Additional v11 operator controls:
 * {action:'reader',kind:'guest'|'account'} (UI simulation, NOT verified Auth)
 * {action:'allowance',remaining:0..500} (only with no pending ideas)
 * {action:'fault',mode:'hold-response',path:'/v1/demand/allowance/reset'}
 * {action:'release-responses'} | existing fail/lose-response work for reset too.
 * Session must begin as guest to install the synthetic cookie; then set account
 * and reload. Real Authorization headers and inherited credentials are refused.
 * D44 member-only SDK protocol (no real Auth, mail, or signature proof):
 * EDISON_V11_MEMBER_FIXTURE=1 node --import tsx scripts/demand-v10-browser-fixture.ts
 * Configure the isolated Next app with the exported LOCAL_MEMBER_FIXTURE values.
 * Normal /login -> synthetic confirmation URL -> explicit acceptance writes
 * normal SDK cookies. Never inject storage or weaken app membership checks.
 * Member operator controls: {action:'member',status:'active'|'pending'|'revoked'},
 * {action:'invitation-delivery',outcome:'sent'|'failed'|'unknown'},
 * {action:'invitation-state',id,status}, {action:'invitation-seed',count:0..5,status},
 * {action:'invitation-advance',seconds:0..604801}. Completion stays operator-led.
 * Auth recovery controls (independent of Edison invitation expiry/credits):
 * {action:'auth-user',confirmed:boolean}, {action:'auth-link',status:'expired'|'valid'},
 * {action:'auth-fault',path:'otp'|'resend',mode:'rate-limited'|'unknown'}.
 * Unconfirmed OTP ->422 signup_disabled; explicit signup resend ->confirmation
 * link. GET state.latestAuthLink provides the exact synthetic replacement URL,
 * including original invitation/next and the SDK's optional pkce_ hash prefix.
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
  demandAllowanceSchema, demandAllowanceResetReceiptSchema, resetDemandAllowanceSchema,
  DEMAND_LOOP_PAGE_SIZE, demandLoopsSchema, parseDemandLoopsQuery,
  createDemandInvitationSchema, demandInvitationActionSchema, demandInvitationSchema,
  demandInvitationsSchema, demandInvitationMutationSchema, demandInvitationRedemptionSchema,
  demandInvitationStatusSchema, uuidSchema, type DemandInvitation,
  type DemandArtDescriptor,
  type DemandArticle, type DemandAnswer, type DemandConversationTurn, type DemandIdea,
  type DemandLoop, type DemandRequest, type DemandWorkspace, type PublicDemandArticleShare,
} from "@edison/contracts";

const HOST = "127.0.0.1";
const PORT = 4311;
const TOKEN = "f".repeat(64); // Synthetic fixture credential, never a real session.
const WORKSPACE_ID = id(1);
const BASE_TIME = Date.parse("2026-09-07T13:00:00.000Z");
export const LOCAL_MEMBER_FIXTURE = Object.freeze({
  origin: `http://${HOST}:${PORT}`, apiUrl: `http://${HOST}:${PORT}/v1`,
  publishableKey: "sb_publishable_edison_local_fixture_only",
  email: "member@example.test", userId: id(2), invitationId: id(9500),
  tokenHash: "e".repeat(64), renewedTokenHash: "d".repeat(64), absentEmail: "absent@example.test",
  refreshToken: "edison-local-fixture-refresh-only",
});
// Deliberately not a valid signed credential. Only the exact string is accepted
// by this localhost fixture; no deployed service or real Auth can trust it.
export const LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: LOCAL_MEMBER_FIXTURE.userId, email: LOCAL_MEMBER_FIXTURE.email,
    aud: "authenticated", role: "authenticated", iss: `${LOCAL_MEMBER_FIXTURE.origin}/auth/v1`,
    iat: Math.floor(BASE_TIME / 1000), exp: 4_102_444_800, session_id: id(3), is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} })).toString("base64url"),
  Buffer.from("LOCAL CONSTRUCTED FIXTURE NOT A SIGNATURE").toString("base64url"),
].join(".");
export function localMemberConfirmationPath(invitation = false, next = "/demand") {
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\r\n]/.test(next)) throw new Error("fixture_return_path_invalid");
  const query = new URLSearchParams({ token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: invitation ? "invite" : "email", next });
  if (invitation) query.set("invitation", LOCAL_MEMBER_FIXTURE.invitationId);
  return `/auth/confirm?${query}`;
}
const STAGES = ["queued", "researching", "checking-ideas", "writing", "checking", "repairing", "updating", "answering"] as const;
type PendingStage = typeof STAGES[number];
type Reply = { status: number; body: unknown; headers?: Record<string, string>; loseResponse?: boolean; holdResponse?: boolean };
type Fault = { mode: "fail" | "lose-response" | "hold-response"; path?: string };

export function assertFixtureEnvironment(environment: Readonly<Record<string, string | undefined>>) {
  if ((environment.EDISON_V10_FIXTURE !== "1" && environment.EDISON_V11_FIXTURE !== "1" && environment.EDISON_V11_MEMBER_FIXTURE !== "1") || environment.NODE_ENV === "production" || environment.VERCEL !== undefined) {
    throw new Error("fixture_requires_explicit_local_environment");
  }
  // Reject inherited credentials without inspecting, printing, or using them.
  if (Object.entries(environment).some(([key, value]) => value &&
    (/^(?:DATABASE_URL|DIRECT_URL|POSTGRES(?:QL)?_.*|OPENAI_.*)$/.test(key) ||
      /^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|VERCEL_OIDC_TOKEN|VERCEL_TOKEN)$/.test(key)))) {
    throw new Error("fixture_refuses_inherited_live_credentials");
  }
  if (environment.EDISON_V11_MEMBER_FIXTURE === "1") {
    for (const key of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
      if (environment[key] && environment[key] !== LOCAL_MEMBER_FIXTURE.origin) throw new Error("fixture_refuses_external_auth");
    }
    for (const key of ["SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
      if (environment[key] && environment[key] !== LOCAL_MEMBER_FIXTURE.publishableKey) throw new Error("fixture_refuses_external_auth");
    }
    if (environment.NEXT_PUBLIC_API_URL && environment.NEXT_PUBLIC_API_URL !== LOCAL_MEMBER_FIXTURE.apiUrl) throw new Error("fixture_refuses_external_api");
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

export function createV10Fixture(rawOptions: { v11?: boolean; member?: boolean } = {}) {
  const options = { ...rawOptions, v11: rawOptions.v11 || rawOptions.member };
  const loops = new Map<string, DemandLoop>();
  const ideas = new Map<string, DemandIdea>();
  const requests = new Map<string, DemandRequest>();
  const articles = new Map<string, DemandArticle>();
  const turns = new Map<string, DemandConversationTurn[]>();
  const requestText = new Map<string, string>();
  const shares = new Map<string, PublicDemandArticleShare>();
  const articleShares = new Map<string, string>();
  const operations = new Map<string, { fingerprint: string; reply: Reply }>();
  const allocations = new Map<string, { count: number; revision: number }>();
  const heldResponses: Array<{ reply: Reply; resolve: (reply: Reply) => void }> = [];
  const invitations = new Map<string, DemandInvitation & { owner: "member" | "external"; updatedAt: number; leaseUntil: number | null; redeemedBy: string | null }>();
  let memberStatus: "active" | "pending" | "revoked" = "active";
  let syntheticSessionActive = false;
  let syntheticEmailConfirmed = true;
  let originalAuthLinkExpired = false;
  let latestAuthLink: { url: string; template: "confirmation" | "magic_link"; tokenHash: string } | null = null;
  let authFault: { path: "otp" | "resend"; mode: "rate-limited" | "unknown" } | null = null;
  let nextDelivery: "sent" | "failed" | "unknown" = "sent";
  let invitationClock = BASE_TIME;
  const syntheticAuthRequests = { otp: 0, resend: 0, verify: 0, user: 0, logout: 0, refresh: 0 };
  let readerKind: "guest" | "account" = "guest";
  let allowanceUsed = 6;
  let periodUsed = 6;
  let allowanceRevision = 0;
  let manualResetAt: string | null = null;
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
  function allowance() {
    const reserved = [...allocations.entries()].reduce((sum, [requestId, allocation]) => sum +
      (allocation.revision === allowanceRevision && pending(required(requests.get(requestId))) ? allocation.count : 0), 0);
    const remaining = Math.max(0, 500 - allowanceUsed);
    return demandAllowanceSchema.parse({ limit: 500, used: allowanceUsed, periodUsed, remaining, reserved,
      available: Math.max(0, remaining - reserved), revision: allowanceRevision, manualResetAt,
      periodStart: "2026-09-07T00:00:00.000Z", resetsAt: "2026-09-14T00:00:00.000Z" });
  }
  function accountGate() {
    const account = readerKind === "account";
    return { canCreateLoop: account, canRefresh: account, reason: account ? null : "account_required" as const };
  }
  function workspace(): DemandWorkspace {
    return demandWorkspaceSchema.parse({ workspaceId: WORKSPACE_ID, readerKind,
      ...(options.v11 ? { allowance: allowance(), accountGate: accountGate() } : {}),
      loops: [...loops.values()], ideas: [...ideas.values()].sort(ideaOrder).slice(0, 360),
      requests: [...requests.values()].sort(descending).slice(0, 120) });
  }
  function envelope(request?: DemandRequest): Reply {
    return { status: request && pending(request) ? 202 : 200,
      body: { workspace: workspace(), ...(request ? { requestId: request.id } : {}) } };
  }
  function loopPage(page: DemandLoop[], nextCursor: string | null) {
    const currentIdeas = page.flatMap((loop) => [...ideas.values()].filter((idea) =>
      idea.loopId === loop.id && idea.batchRequestId === loop.currentBatchRequestId));
    const requestIds = new Set(currentIdeas.flatMap((idea) => idea.articleRequestId ? [idea.articleRequestId] : []));
    for (const loop of page) {
      if (loop.currentBatchRequestId) requestIds.add(loop.currentBatchRequestId);
      const latest = [...requests.values()].filter((request) => request.loopId === loop.id && request.kind === "ideas").sort(descending)[0];
      if (latest) requestIds.add(latest.id);
    }
    return { status: 200, body: demandLoopsSchema.parse({ workspaceId: WORKSPACE_ID, loops: page,
      ideas: currentIdeas, requests: [...requestIds].map((requestId) => required(requests.get(requestId))), nextCursor }) };
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
    const illustrated = options.v11 ? ({
      [id(11)]: { composition: "built-space", titles: ["The architecture of the space between things", "How a courtyard changes the way a building feels", "Why repeated arches create a rhythm", "How a threshold divides two spaces", "What a shadow reveals about a building", "How an arcade frames a walk"] },
      [id(12)]: { composition: "living-system", titles: ["How living cells become tools for making things", "What makes a biological system programmable?", "How a genetic instruction becomes a protein", "Why a cell needs more than a genetic recipe", "How a membrane creates a working space", "What a modular gene circuit helps explain"] },
      [id(16)]: { composition: "shared-network", titles: ["How strangers keep the same ledger", "Why a shared ledger needs rules for disagreement", "What agreement means in a distributed record", "Why a ledger can have competing histories", "How a shared record connects separate participants", "What changes when no one keeps the only copy"] },
    } satisfies Record<string, { composition: DemandArtDescriptor["composition"]; titles: string[] }>)[loop.id] : undefined;
    const time = timestamp();
    for (let index = 0; index < count; index++) {
      const ideaId = request.id === id(80) ? id(100 + index) : newId();
      ideas.set(ideaId, { id: ideaId, loopId: loop.id, batchRequestId: request.id, batchRevision: loop.revision,
        rank: index + 1, title: illustrated?.titles[index] ?? (loop.id === id(10) ? titles[index] : `${titles[index]} · ${loop.title.slice(0, 32)}`),
        deck: "A practical explanation of the mechanism, with a concrete example and the limits of what the example shows.",
        ...(options.v11 ? { art: illustrated ? { version: 1, composition: illustrated.composition, palette: "sage", variant: index % 3 } : null } : {}),
        articleRequestId: null, saved: false, createdAt: time });
    }
    if (options.v11 && count > 0) loop.currentBatchRequestId = request.id;
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
    const illustratedBody = options.v11 && idea.art ? [
      "This is constructed reading for the local interface review, not a generated or checked Edison article.",
      idea.art.composition === "living-system" ? "In this illustrative example, a genetic instruction describes a protein and a living cell supplies the machinery that makes it. The metaphor in the artwork shows parts being arranged within a living system; it does not establish the performance of any biological design."
        : idea.art.composition === "built-space" ? "Imagine a sequence of arches around an open courtyard. Their openings frame a walk, while light and shade change the experience along it. The illustration is an imagined building used to explore space, not a documented location."
          : "Imagine separate participants keeping copies of a shared record. Rules for agreement help them decide which updates belong in those copies. The artwork represents that relationship; it is not a protocol diagram or a claim about a particular cryptocurrency.",
      "The fixture preserves the selected headline and its topic so this local review can check reading, return and saved context. These paragraphs are not editorial acceptance evidence.",
    ] : null;
    const articleSourced = sourced && !illustratedBody;
    const article = demandArticleSchema.parse({ id: request.id, slug: `fixture-${request.id}`, category: "tech-science",
      kicker: "A practical explanation", title: idea.title, deck: idea.deck, readingMinutes: illustratedBody ? 1 : 5,
      sourceCount: articleSourced ? 1 : 0, researchedAt: articleSourced ? timestamp() : null, basis: articleSourced ? "mixed" : "general_knowledge",
      reason: "Private fixture direction: understand mechanisms with concrete examples.",
      summary: illustratedBody ? ["This reading is constructed for a local interface review.", "The illustration is a metaphor, not factual evidence.", "The local fixture does not establish editorial acceptance."]
        : ["A sensor converts a physical change into a readable signal.", "A reference connects the signal with an interpretation.", "A test establishes a bounded result, not universal performance."],
      saved: idea.saved, completed: false, topic: illustratedBody ? required(loops.get(idea.loopId)).title : "Measurement", writtenFor: "Private synthetic reader instructions; never include in a public share.",
      shareId: null, correction: null,
      body: illustratedBody ? illustratedBody.map((text) => ({ type: "paragraph", text, citations: [] })) : paragraphs.flatMap((text, index) => index % 3 === 0
        ? [{ type: "heading" as const, level: 2 as const, text: ["From change to signal", "Giving the number meaning", "Understanding variation", "What the test establishes"][index / 3] },
          { type: "paragraph" as const, text, citations }]
        : [{ type: "paragraph" as const, text, citations }]),
      sources: articleSourced ? [{ id: sourceId, title: "Constructed measurement reference for UI testing", publisher: "Fixture reference",
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
    allocations.clear();
    for (const held of heldResponses.splice(0)) held.resolve(error(409, "fixture_reset", "The operator reset this local fixture."));
    readerKind = options.member ? "account" : "guest"; allowanceUsed = 6; periodUsed = 6; allowanceRevision = 0; manualResetAt = null;
    invitations.clear(); memberStatus = "active"; syntheticSessionActive = false; nextDelivery = "sent"; invitationClock = BASE_TIME;
    syntheticEmailConfirmed = true; originalAuthLinkExpired = false; latestAuthLink = null; authFault = null;
    for (const key of Object.keys(syntheticAuthRequests) as (keyof typeof syntheticAuthRequests)[]) syntheticAuthRequests[key] = 0;
    if (options.member) invitations.set(LOCAL_MEMBER_FIXTURE.invitationId, { id: LOCAL_MEMBER_FIXTURE.invitationId,
      email: LOCAL_MEMBER_FIXTURE.email, status: "sent", createdAt: new Date(BASE_TIME).toISOString(),
      expiresAt: new Date(BASE_TIME + 7 * 86_400_000).toISOString(), sentAt: new Date(BASE_TIME).toISOString(), redeemedAt: null,
      owner: "external", updatedAt: BASE_TIME - 60_001, leaseUntil: null, redeemedBy: null });
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
      if (options.v11 && path === "/v1/demand/allowance/reset" && saved.body && typeof saved.body === "object" && "receipt" in saved.body) {
        saved.body = { ...saved.body, receipt: { ...demandAllowanceResetReceiptSchema.parse(saved.body.receipt), replayed: true } };
      }
      if (options.member && path.startsWith("/v1/demand/invitations") && saved.body && typeof saved.body === "object") {
        const previousBody = { ...saved.body, replayed: true };
        saved.body = previousBody;
        if ("invitation" in previousBody) {
          const receipt = demandInvitationMutationSchema.parse(previousBody);
          saved.body = { ...receipt, invitation: invitationDto(required(invitations.get(receipt.invitation.id))) };
        }
      }
      return saved;
    }
    const plannedFault = fault && (!fault.path || fault.path === path) ? fault : null;
    if (plannedFault) fault = null;
    if (plannedFault?.mode === "fail") { counters.failures++; return error(503, "fixture_injected_failure", "The local operator made this synthetic operation fail. Nothing was saved."); }
    const reply = run();
    operations.set(input.idempotencyKey, { fingerprint, reply: copy(reply) }); counters.mutations++;
    if (plannedFault?.mode === "lose-response") { counters.lostResponses++; return { ...reply, loseResponse: true }; }
    if (plannedFault?.mode === "hold-response") return { ...reply, holdResponse: true };
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
    if (request.kind === "ideas") {
      if (options.v11) {
        const allocation = required(allocations.get(request.id));
        if (count > allocation.count) throw error(400, "fixture_count_exceeded", "Only the admitted smaller batch can be delivered.");
        periodUsed += count;
        if (allocation.revision === allowanceRevision) allowanceUsed += count;
      }
      addIdeas(request, count);
    }
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
      ideaIds: [...ideas.keys()], nextStage, fault, providerCalls: 0, databaseCalls: 0,
      ...(options.v11 ? { mode: "v11-constructed-ui", authProof: false, authCalls: 0, readerKind, allowance: allowance(), accountGate: accountGate(),
        allocations: [...allocations.entries()].map(([requestId, allocation]) => ({ requestId, ...allocation })), heldResponses: heldResponses.length,
        currentBatches: [...loops.values()].map(({ id, currentBatchRequestId }) => ({ loopId: id, requestId: currentBatchRequestId })) } : {}),
      ...(options.member ? { mode: "v11-member-constructed-ui", syntheticAuthRequests: copy(syntheticAuthRequests),
        syntheticMember: { ...LOCAL_MEMBER_FIXTURE, status: memberStatus, sessionActive: syntheticSessionActive, emailConfirmed: syntheticEmailConfirmed,
          signInPath: localMemberConfirmationPath(), invitationPath: localMemberConfirmationPath(true) },
        invitations: invitationList(), nextDelivery, invitationClock: new Date(invitationClock).toISOString(),
        originalAuthLinkExpired, latestAuthLink: copy(latestAuthLink), authFault: copy(authFault) } : {}) };
  }
  function control(input: Record<string, unknown>): Reply {
    const stage = input.stage;
    if (input.action === "reset") reset();
    else if (options.member && input.action === "member") {
      if (!["active", "pending", "revoked"].includes(String(input.status))) throw new Error("invalid_member");
      memberStatus = input.status as typeof memberStatus;
    } else if (options.member && input.action === "auth-user") {
      if (typeof input.confirmed !== "boolean") throw new Error("invalid_auth_user");
      syntheticEmailConfirmed = input.confirmed;
      if (!input.confirmed) syntheticSessionActive = false;
    } else if (options.member && input.action === "auth-link") {
      if (input.status !== "expired" && input.status !== "valid") throw new Error("invalid_auth_link");
      originalAuthLinkExpired = input.status === "expired";
    } else if (options.member && input.action === "auth-fault") {
      if (!["otp", "resend"].includes(String(input.path)) || !["rate-limited", "unknown"].includes(String(input.mode))) throw new Error("invalid_auth_fault");
      authFault = { path: input.path as "otp" | "resend", mode: input.mode as "rate-limited" | "unknown" };
    } else if (options.member && input.action === "invitation-delivery") {
      if (!["sent", "failed", "unknown"].includes(String(input.outcome))) throw new Error("invalid_delivery");
      nextDelivery = input.outcome as typeof nextDelivery;
    } else if (options.member && input.action === "invitation-state") {
      const invitation = required(invitations.get(String(input.id)));
      invitation.status = demandInvitationStatusSchema.parse(input.status);
      invitation.redeemedAt = invitation.status === "redeemed" ? new Date(invitationClock).toISOString() : null;
      invitation.redeemedBy = invitation.status === "redeemed" ? invitation.email === LOCAL_MEMBER_FIXTURE.email ? LOCAL_MEMBER_FIXTURE.userId : id(4) : null;
      invitation.leaseUntil = invitation.status === "sending" ? invitationClock + 120_000 : null;
      invitation.updatedAt = invitationClock - 60_001;
      invitation.expiresAt = new Date(invitationClock + (invitation.status === "expired" ? -1 : 7 * 86_400_000)).toISOString();
    } else if (options.member && input.action === "invitation-seed") {
      if (!Number.isInteger(input.count) || Number(input.count) < 0 || Number(input.count) > 5) throw new Error("invalid_count");
      const status = demandInvitationStatusSchema.parse(input.status);
      for (const [key, invitation] of invitations) if (invitation.owner === "member") invitations.delete(key);
      for (let index = 0; index < Number(input.count); index++) {
        const invitation = newInvitation(`constructed.friend.${index + 1}@example.test`, "member");
        invitation.status = status; invitation.updatedAt = invitationClock - 60_001;
        invitation.sentAt = status === "sent" ? new Date(invitationClock).toISOString() : null;
        invitation.redeemedAt = status === "redeemed" ? new Date(invitationClock).toISOString() : null;
        invitation.redeemedBy = status === "redeemed" ? id(4) : null;
        if (status === "expired") invitation.expiresAt = new Date(invitationClock - 1).toISOString();
      }
    } else if (options.member && input.action === "invitation-advance") {
      if (!Number.isInteger(input.seconds) || Number(input.seconds) < 0 || Number(input.seconds) > 604_801) throw new Error("invalid_clock");
      invitationClock += Number(input.seconds) * 1000;
    }
    else if (options.v11 && input.action === "reader") {
      if (options.member) throw new Error("member_fixture_has_no_guest_mode");
      if (input.kind !== "guest" && input.kind !== "account") throw new Error("invalid_reader");
      readerKind = input.kind;
    } else if (options.v11 && input.action === "allowance") {
      if (!Number.isInteger(input.remaining) || Number(input.remaining) < 0 || Number(input.remaining) > 500 ||
        [...allocations.keys()].some((requestId) => pending(required(requests.get(requestId))))) throw new Error("invalid_allowance_control");
      allowanceUsed = 500 - Number(input.remaining); periodUsed = Math.max(periodUsed, allowanceUsed);
    } else if (options.v11 && input.action === "release-responses") {
      for (const held of heldResponses.splice(0)) held.resolve(held.reply);
    }
    else if (input.action === "fault") {
      if (!["fail", "lose-response", ...(options.v11 ? ["hold-response"] : [])].includes(String(input.mode)) ||
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
        const count = input.count ?? (options.v11 && request.kind === "ideas" ? allocations.get(request.id)?.count : 6);
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

  function invitationDto(invitation: ReturnType<typeof newInvitation>) {
    const status = ["pending", "sending", "sent"].includes(invitation.status) && Date.parse(invitation.expiresAt) <= invitationClock ? "expired"
      : invitation.status === "sending" && invitation.leaseUntil !== null && invitation.leaseUntil <= invitationClock ? "pending" : invitation.status;
    return demandInvitationSchema.parse({ id: invitation.id, email: invitation.email, status, createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt, sentAt: invitation.sentAt, redeemedAt: invitation.redeemedAt });
  }
  function newInvitation(email: string, owner: "member" | "external") {
    const time = new Date(invitationClock).toISOString();
    const invitation = { id: newId(), email, status: "sending" as DemandInvitation["status"], createdAt: time,
      expiresAt: new Date(invitationClock + 7 * 86_400_000).toISOString(), sentAt: null as string | null,
      redeemedAt: null as string | null, redeemedBy: null as string | null, owner, updatedAt: invitationClock, leaseUntil: invitationClock + 120_000 as number | null };
    invitations.set(invitation.id, invitation); return invitation;
  }
  function invitationList() {
    const rows = [...invitations.values()].filter((invitation) => invitation.owner === "member").map(invitationDto);
    const reserved = rows.filter((invitation) => ["pending", "sending", "sent"].includes(invitation.status)).length;
    const redeemed = rows.filter((invitation) => invitation.status === "redeemed").length;
    const priority = (invitation: DemandInvitation) => ["pending", "sending", "sent", "redeemed"].includes(invitation.status) ? 0 : 1;
    return demandInvitationsSchema.parse({ limit: 5, redeemed, reserved, remaining: 5 - redeemed - reserved,
      invitations: rows.sort((left, right) => priority(left) - priority(right) || descending(left, right)).slice(0, 100) });
  }
  function invitationReceipt(invitation: ReturnType<typeof newInvitation>, delivery: "sent" | "failed" | "unknown" | "not_attempted") {
    return { status: 200, body: demandInvitationMutationSchema.parse({ invitation: invitationDto(invitation), delivery, replayed: false }) };
  }
  function syntheticDelivery(invitation: ReturnType<typeof newInvitation>, resend: boolean) {
    const previous = invitationDto(invitation).status;
    const delivery = nextDelivery; nextDelivery = "sent";
    invitation.updatedAt = invitationClock; invitation.leaseUntil = delivery === "unknown" ? invitationClock + 120_000 : null;
    invitation.status = delivery === "sent" ? "sent" : delivery === "unknown" ? "sending" : resend ? previous : "failed";
    if (delivery === "sent") invitation.sentAt = new Date(invitationClock).toISOString();
    return invitationReceipt(invitation, delivery);
  }
  function syntheticUser() {
    return { id: LOCAL_MEMBER_FIXTURE.userId, aud: "authenticated", role: "authenticated", email: LOCAL_MEMBER_FIXTURE.email,
      email_confirmed_at: syntheticEmailConfirmed ? new Date(BASE_TIME).toISOString() : null,
      confirmed_at: syntheticEmailConfirmed ? new Date(BASE_TIME).toISOString() : null,
      created_at: new Date(BASE_TIME).toISOString(), updated_at: new Date(BASE_TIME).toISOString(),
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], is_anonymous: false };
  }
  function syntheticSession() {
    return { access_token: LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN, token_type: "bearer", expires_in: 3600,
      expires_at: 4_102_444_800, refresh_token: LOCAL_MEMBER_FIXTURE.refreshToken, user: syntheticUser() };
  }
  function syntheticAuth(method: string, url: URL, raw: unknown, headers: Record<string, string | undefined>): Reply {
    const denied = () => ({ status: 401, body: { code: "bad_jwt", msg: "Only the exact local synthetic credential is accepted." } });
    if (headers.apikey !== LOCAL_MEMBER_FIXTURE.publishableKey) return denied();
    const authorization = headers.authorization;
    if (authorization !== `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}` && authorization !== `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}`) return denied();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return denied();
    const body = raw as Record<string, unknown>;
    if (["/auth/v1/otp", "/auth/v1/resend"].includes(url.pathname) && method === "POST") {
      const resend = url.pathname === "/auth/v1/resend";
      if ((body.email !== LOCAL_MEMBER_FIXTURE.email && body.email !== LOCAL_MEMBER_FIXTURE.absentEmail) ||
        (resend ? body.type !== "signup" : body.create_user !== false)) return { status: 400, body: { code: "validation_failed", msg: "Use only the documented synthetic account and closed-signup flow." } };
      const target = new URL(url.searchParams.get("redirect_to") ?? `${LOCAL_MEMBER_FIXTURE.origin}/auth/confirm?next=%2Fdemand`);
      if (!localOrigin(target.origin) || target.pathname !== "/auth/confirm" || target.username || target.password || target.hash ||
        [...target.searchParams.keys()].some((key) => !["next", "invitation"].includes(key)) ||
        [...new Set(target.searchParams.keys())].some((key) => target.searchParams.getAll(key).length !== 1)) return denied();
      if (target.searchParams.has("invitation") && !uuidSchema.safeParse(target.searchParams.get("invitation")).success) return denied();
      const next = target.searchParams.get("next");
      if (next && (!next.startsWith("/") || next.startsWith("//") || /[\\\r\n]/.test(next))) return denied();
      const operation = resend ? "resend" : "otp";
      syntheticAuthRequests[operation]++;
      if (authFault?.path === operation) {
        const mode = authFault.mode; authFault = null;
        return mode === "rate-limited" ? { status: 429, body: { code: "over_email_send_rate_limit", msg: "Please wait before requesting another synthetic link." } }
          : { status: 500, body: { code: "unexpected_failure", msg: "Synthetic send outcome is unknown." } };
      }
      // Match the reviewed GoTrue branches without creating users or sending:
      // absent OTP =>otp_disabled; unconfirmed OTP =>Signup's signup_disabled;
      // resend signup silently does nothing for absent/already-confirmed users.
      if (body.email === LOCAL_MEMBER_FIXTURE.absentEmail) return resend ? { status: 200, body: {} }
        : { status: 422, body: { code: "otp_disabled", msg: "Signups not allowed for otp" } };
      if (!resend && !syntheticEmailConfirmed) return { status: 422, body: { code: "signup_disabled", msg: "Signups not allowed for this instance" } };
      if (resend && syntheticEmailConfirmed) return { status: 200, body: {} };
      const hash = `${typeof body.code_challenge === "string" && body.code_challenge ? "pkce_" : ""}${LOCAL_MEMBER_FIXTURE.renewedTokenHash}`;
      target.searchParams.set("token_hash", hash); target.searchParams.set("type", "email");
      latestAuthLink = { url: target.href, template: resend ? "confirmation" : "magic_link", tokenHash: hash };
      return { status: 200, body: {} };
    }
    if (url.pathname === "/auth/v1/verify" && method === "POST") {
      syntheticAuthRequests.verify++;
      const original = !originalAuthLinkExpired && body.token_hash === LOCAL_MEMBER_FIXTURE.tokenHash;
      const renewed = latestAuthLink !== null && body.token_hash === latestAuthLink.tokenHash && body.type === "email";
      if ((!original && !renewed) || !["email", "invite"].includes(String(body.type))) return { status: 403, body: { code: "otp_expired", msg: "That synthetic verification link is not available." } };
      syntheticEmailConfirmed = true; syntheticSessionActive = true;
      return { status: 200, body: syntheticSession() };
    }
    const valid = syntheticEmailConfirmed && syntheticSessionActive && authorization === `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}`;
    if (url.pathname === "/auth/v1/user" && method === "GET") {
      if (!valid) return denied(); syntheticAuthRequests.user++;
      return { status: 200, body: syntheticUser() };
    }
    if (url.pathname === "/auth/v1/logout" && method === "POST") {
      if (!valid) return denied(); syntheticAuthRequests.logout++; syntheticSessionActive = false;
      return { status: 200, body: {} };
    }
    if (url.pathname === "/auth/v1/token" && method === "POST" && url.searchParams.get("grant_type") === "refresh_token") {
      if (!syntheticEmailConfirmed || !syntheticSessionActive || body.refresh_token !== LOCAL_MEMBER_FIXTURE.refreshToken) return denied();
      syntheticAuthRequests.refresh++; return { status: 200, body: syntheticSession() };
    }
    return error(404, "not_found", "No synthetic Auth protocol exists here.");
  }
  function invitationRoute(method: string, path: string, parts: string[], body: unknown): Reply {
    if (parts.length === 3 && method === "GET") return { status: 200, body: invitationList() };
    if (parts.length === 3 && method === "POST") {
      const input = createDemandInvitationSchema.parse(body);
      return mutation(path, input, () => {
        const existing = [...invitations.values()].find((row) => row.owner === "member" && row.email === input.email && ["pending", "sending", "sent"].includes(invitationDto(row).status));
        if (existing) return invitationReceipt(existing, "not_attempted");
        if (invitationList().remaining === 0) throw error(429, "invitation_allowance_exhausted", "Your five invitations are already used or awaiting acceptance.");
        return syntheticDelivery(newInvitation(input.email, "member"), false);
      });
    }
    if (parts.length !== 5 || method !== "POST" || !["resend", "revoke", "redeem"].includes(parts[4])) return error(404, "not_found", "No synthetic invitation route exists here.");
    const invitation = required(invitations.get(parts[3])); const input = demandInvitationActionSchema.parse(body);
    if (parts[4] === "redeem") {
      if (memberStatus === "revoked" || invitation.email !== LOCAL_MEMBER_FIXTURE.email) return error(403, "invitation_recipient_mismatch", "Use the email this invitation was sent to.");
      return mutation(path, input, () => {
        if (!["pending", "sending", "sent", "redeemed"].includes(invitationDto(invitation).status)) throw error(404, "invitation_unavailable", "That invitation is no longer available.");
        if (invitation.redeemedBy && invitation.redeemedBy !== LOCAL_MEMBER_FIXTURE.userId) throw error(404, "invitation_unavailable", "That invitation is no longer available.");
        invitation.status = "redeemed"; invitation.redeemedAt ??= new Date(invitationClock).toISOString();
        invitation.redeemedBy = LOCAL_MEMBER_FIXTURE.userId; memberStatus = "active";
        return { status: 200, body: demandInvitationRedemptionSchema.parse({ invitationId: invitation.id, admitted: true, replayed: false }) };
      });
    }
    if (invitation.owner !== "member") return error(404, "not_found", "That synthetic invitation is not owned by this member.");
    return mutation(path, input, () => {
      if (parts[4] === "revoke") {
        if (invitation.status !== "redeemed") { invitation.status = "revoked"; invitation.leaseUntil = null; }
        return invitationReceipt(invitation, "not_attempted");
      }
      if (!["pending", "sending", "sent"].includes(invitationDto(invitation).status)) throw error(404, "invitation_unavailable", "Send a new invitation to use an available slot.");
      if (invitationClock - invitation.updatedAt < 60_000 || (invitation.status === "sending" && (invitation.leaseUntil ?? 0) > invitationClock)) throw error(409, "invitation_delivery_pending", "Please wait before resending this invitation.");
      return syntheticDelivery(invitation, true);
    });
  }

  function admitIdeas(loop: DemandLoop) {
    if (options.v11 && !accountGate().canRefresh) throw error(403, "account_required", "Sign in to create more loops and refresh articles.");
    const available = options.v11 ? allowance().available : 6;
    if (!available) throw error(429, "allowance_exhausted", "Your weekly article allowance is used up. You can keep reading your articles.");
    const request = makeRequest("ideas", loop.id, null);
    if (options.v11) allocations.set(request.id, { revision: allowanceRevision, count: Math.min(6, available) });
    counters.admittedRequests++;
    return request;
  }
  async function dispatch(method: string, rawUrl: string, body: unknown = {}, headers: Record<string, string | undefined> = {}): Promise<Reply> {
    try {
      const url = new URL(rawUrl, `http://${HOST}:${PORT}`); const path = url.pathname;
      if (options.member && url.origin !== LOCAL_MEMBER_FIXTURE.origin) return error(403, "local_only", "Only the fixed local fixture destination is accepted.");
      if (options.member && ((headers.authorization && ![`Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}`, `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}`].includes(headers.authorization)) ||
        (headers.apikey && headers.apikey !== LOCAL_MEMBER_FIXTURE.publishableKey))) return error(401, "fixture_synthetic_only", "This fixture refuses external credentials.");
      if (options.member && path.startsWith("/auth/v1/")) return { ...syntheticAuth(method, url, body, headers),
        headers: { "X-Supabase-Api-Version": "2024-01-01" } };
      if (path === "/health" && method === "GET") return { status: 200, body: { ok: true, fixture: true, providerCalls: 0, databaseCalls: 0 } };
      if (path === "/__fixture/state" && method === "GET") return { status: 200, body: state() };
      if (path === "/__fixture/control" && method === "POST") {
        if (headers["x-edison-fixture-operator"] !== "local-only" || headers.origin) return error(403, "operator_required", "Use the local operator channel.");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_control");
        return control(body as Record<string, unknown>);
      }
      const parts = path.split("/").filter(Boolean);
      if (options.member) {
        const verifiedViewer = syntheticEmailConfirmed && syntheticSessionActive && headers.authorization === `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}`;
        if (method === "GET" && parts.slice(0, 3).join("/") === "v1/demand/invitations" && parts.length === 5 && parts[4] === "preview" && !url.search) {
          if (headers.authorization && !verifiedViewer) return error(401, "reading_session_required", "That synthetic credential cannot identify a verified recipient.");
          const invitation = invitations.get(parts[3]);
          if (!invitation || ["revoked", "failed"].includes(invitation.status)) return { status: 200, body: { state: "unavailable" } };
          if (invitation.status === "redeemed") return { status: 200, body: { state: verifiedViewer &&
            invitation.redeemedBy === LOCAL_MEMBER_FIXTURE.userId && memberStatus === "active" ? "accepted" : "unavailable" } };
          if (invitationDto(invitation).status === "expired") return { status: 200, body: { state: "expired" } };
          if (verifiedViewer && invitation.email !== LOCAL_MEMBER_FIXTURE.email) return { status: 200, body: { state: "wrong_account" } };
          const [local, domain] = invitation.email.split("@");
          return { status: 200, body: { state: "available", maskedEmail: `${local[0]}***@${domain}`, expiresAt: invitation.expiresAt } };
        }
        // Model a pre-D44 browser's old guest cookie during the normal verified
        // account handoff. It never grants access alone or accepts other tokens.
        if (!verifiedViewer || (headers["x-edison-demand-token"] && headers["x-edison-demand-token"] !== TOKEN)) return error(401, "reading_session_required", "Sign in through the synthetic local Auth flow first.");
        const redeem = method === "POST" && parts.slice(0, 3).join("/") === "v1/demand/invitations" && parts.length === 5 && parts[4] === "redeem";
        if (!redeem && memberStatus !== "active") return error(403, "membership_required", "An invitation is needed.");
        if (path === "/v1/demand/access" && method === "GET" && !url.search) return { status: 200, body: { member: true } };
        if (parts.slice(0, 3).join("/") === "v1/demand/invitations") {
          if (url.search) return error(404, "not_found", "Invitation queries are not supported.");
          return invitationRoute(method, path, parts, body);
        }
      }
      if (method === "GET" && parts.slice(0, 3).join("/") === "v1/public/demand-shares" && parts.length === 4) {
        return { status: 200, body: publicDemandArticleShareSchema.parse(required(shares.get(parts[3]))) };
      }
      if (parts[0] !== "v1" || parts[1] !== "demand") return error(404, "not_found", "No fixture route exists here.");
      if (!options.member && headers.authorization) return error(401, "fixture_guest_only", "This fixture never accepts real account credentials.");
      if (parts[2] === "session" && method === "POST") {
        if (options.member) { counters.sessions++; return { status: 200, body: { workspace: workspace() } }; }
        if (headers["x-edison-demand-token"] && headers["x-edison-demand-token"] !== TOKEN) return error(401, "guest_session_invalid", "Unknown synthetic session.");
        counters.sessions++;
        if (options.v11 && readerKind === "account" && !headers["x-edison-demand-token"]) return error(401, "fixture_session_required", "Start as a synthetic guest before switching the fixture to account UI.");
        return { status: headers["x-edison-demand-token"] ? 200 : 201, body: { workspace: workspace(),
          ...(!headers["x-edison-demand-token"] && readerKind === "guest" ? { newGuestToken: TOKEN } : {}) } };
      }
      if (!options.member && headers["x-edison-demand-token"] !== TOKEN) return error(401, "reading_session_required", "Start the synthetic reading session first.");
      if (options.v11 && method === "POST" && path === "/v1/demand/allowance/reset") {
        const input = resetDemandAllowanceSchema.parse(body);
        return mutation(path, input, () => {
          if (readerKind !== "account") throw error(403, "account_required", "Sign in to reset your allowance.");
          if (input.password !== "bulb") throw error(403, "allowance_reset_password_invalid", "That password didn’t work. Try again.");
          if (input.expectedRevision !== allowanceRevision || input.expectedPeriodStart !== allowance().periodStart) throw error(409, "allowance_changed", "Your allowance changed. Reload it before resetting.");
          const previousRevision = allowanceRevision; allowanceRevision++; allowanceUsed = 0; manualResetAt = timestamp();
          const receipt = demandAllowanceResetReceiptSchema.parse({ operationId: newId(), periodStart: allowance().periodStart,
            previousRevision, revision: allowanceRevision, replayed: false });
          return { status: 200, body: { workspace: workspace(), receipt } };
        });
      }
      if (method === "GET") {
        if (options.v11 && parts[2] === "loops" && parts.length === 3) {
          const query = parseDemandLoopsQuery(url.searchParams); const anchor = readCursor(query.cursor);
          if (anchor && (anchor.version !== 1 || anchor.workspaceId !== WORKSPACE_ID || typeof anchor.anchorId !== "string" || !loops.has(anchor.anchorId))) {
            throw error(400, "invalid_loop_cursor", "That fixture loop position is not valid.");
          }
          const ordered = [...loops.values()].sort((left, right) => -descending(left, right));
          const after = anchor ? ordered.findIndex((loop) => loop.id === anchor.anchorId) + 1 : 0;
          const rows = ordered.slice(after).filter((loop) => !loop.archivedAt);
          const page = rows.slice(0, DEMAND_LOOP_PAGE_SIZE);
          return loopPage(page, rows.length > DEMAND_LOOP_PAGE_SIZE
            ? cursor({ version: 1, workspaceId: WORKSPACE_ID, anchorId: page.at(-1)!.id }) : null);
        }
        if (options.v11 && parts[2] === "loops" && parts.length === 4) {
          if (url.searchParams.size) throw new Error("invalid_loop_query");
          return loopPage([required(loops.get(parts[3]))], null);
        }
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
          if (options.v11 && !accountGate().canCreateLoop) throw error(403, "account_required", "Sign in to create more loops and refresh articles.");
          if (options.v11 && !allowance().available) throw error(429, "allowance_exhausted", "Your weekly article allowance is used up. You can keep reading your articles.");
          if (loops.size >= (options.v11 ? 60 : 30)) throw error(409, "loop_limit", "This bounded synthetic workspace has reached its fixture limit.");
          const time = timestamp(); const loopId = newId(); const phrase = input.curiosity.split(/[.!?\n\r]/, 1)[0].trim();
          const text = input.curiosity.replace(/\s+/g, " "); const prefix = text.slice(0, 48);
          const title = phrase && phrase.length <= 40 && phrase.length < input.curiosity.length ? phrase
            : text.length > 48 && prefix.includes(" ") ? prefix.slice(0, prefix.lastIndexOf(" ")) : prefix;
          loops.set(loopId, { id: loopId, title, originalCuriosity: input.curiosity, instructions: input.curiosity, revision: 0,
            archivedAt: null, principles: [], lastMutationId: null, canUndo: false, createdAt: time, updatedAt: time });
          const request = admitIdeas(required(loops.get(loopId))); return envelope(request);
        });
      }
      if (method === "POST" && parts[2] === "loops" && parts.length === 5) {
        if (parts[4] === "ideas") {
          const input = requestDemandIdeasSchema.parse(body);
          return mutation(path, input, () => {
            const loop = usableLoop(parts[3]); revision(loop, input.baseRevision);
            if ([...requests.values()].some((request) => request.loopId === loop.id && request.kind === "ideas" && pending(request))) throw error(409, "reading_busy", "Ideas are already being prepared for this loop.");
            const request = admitIdeas(loop); return envelope(request);
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
        if (options.v11 && request.kind === "ideas") {
          const allocation = required(allocations.get(request.id));
          if (allocation.revision === allowanceRevision && allowance().available < allocation.count) return error(429, "allowance_exhausted", "That refresh's original allowance is no longer available.");
        }
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
  async function handle(...args: Parameters<typeof dispatch>): Promise<Reply> {
    const reply = await dispatch(...args);
    if (!reply.holdResponse) return reply;
    const released = { ...reply }; delete released.holdResponse;
    return new Promise((resolve) => { heldResponses.push({ reply: released, resolve }); });
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

export async function selfTestV11Fixture() {
  assert.doesNotThrow(() => assertFixtureEnvironment({ EDISON_V11_FIXTURE: "1" }));
  for (const environment of [{ EDISON_V11_FIXTURE: "1", NODE_ENV: "production" },
    { EDISON_V11_FIXTURE: "1", VERCEL: "0" }, { EDISON_V11_FIXTURE: "1", OPENAI_API_KEY: "never-read" },
    { EDISON_V11_FIXTURE: "1", SUPABASE_SERVICE_ROLE_KEY: "never-read" }]) assert.throws(() => assertFixtureEnvironment(environment));
  const fixture = createV10Fixture({ v11: true });
  const auth = { "x-edison-demand-token": TOKEN };
  const call = (method: string, path: string, body: unknown = {}) => fixture.handle(method, path, body, auth);
  const operator = (body: unknown) => fixture.handle("POST", "/__fixture/control", body, { "x-edison-fixture-operator": "local-only" });
  const workspace = async () => demandWorkspaceSchema.parse(((await call("GET", "/v1/demand/workspace")).body as { workspace: unknown }).workspace);
  const requestId = (reply: Reply) => (reply.body as { requestId: string }).requestId;
  const sensorPath = `/v1/demand/articles/${id(200)}`;
  const sensor = demandArticleResultSchema.parse((await call("GET", sensorPath)).body);
  const v10Sensor = demandArticleResultSchema.parse((await createV10Fixture().handle("GET", sensorPath, {}, auth)).body);
  assert.deepEqual(sensor.article, v10Sensor.article, "v11 retains the complete ready sensor article unchanged");
  assert.equal((await fixture.handle("POST", "/v1/demand/session")).status, 201);
  let initial = await workspace();
  assert.equal(initial.readerKind, "guest"); assert.equal(initial.accountGate?.canRefresh, false);
  assert.equal(initial.allowance?.remaining, 494);
  assert.equal(initial.ideas.filter((idea) => idea.art).length, 18);
  assert.equal(initial.ideas.find((idea) => idea.id === id(100))?.art, null);
  for (const [loopId, composition] of [[id(11), "built-space"], [id(12), "living-system"], [id(16), "shared-network"]]) {
    const rows = initial.ideas.filter((idea) => idea.loopId === loopId);
    assert.ok(rows.every((idea) => idea.art?.composition === composition));
    assert.ok(rows.every((idea) => !/sensor|measurement/i.test(idea.title)));
    assert.ok(initial.loops.find((loop) => loop.id === loopId)?.currentBatchRequestId);
  }
  const refreshPath = `/v1/demand/loops/${id(12)}/ideas`;
  const refresh = (key: string) => call("POST", refreshPath, { baseRevision: 0, idempotencyKey: key });
  assert.equal((await refresh("fixture-guest-gate")).status, 403);
  assert.equal((await call("POST", "/v1/demand/loops", { curiosity: "A retained draft", idempotencyKey: "fixture-guest-create" })).status, 403);
  await operator({ action: "reader", kind: "account" });
  const account = await call("POST", "/v1/demand/session");
  assert.equal((account.body as { newGuestToken?: string }).newGuestToken, undefined);
  assert.equal((await fixture.handle("POST", "/v1/demand/session")).status, 401);
  assert.equal((await fixture.handle("GET", "/v1/demand/workspace", {}, { ...auth, authorization: "Bearer never-accepted" })).status, 401);
  await operator({ action: "allowance", remaining: 4 });
  initial = await workspace();
  const previousBatch = initial.loops.find((loop) => loop.id === id(12))?.currentBatchRequestId;
  const partial = await refresh("fixture-final-four"); assert.equal(partial.status, 202);
  const pending = await workspace();
  assert.equal(pending.allowance?.remaining, 4); assert.equal(pending.allowance?.reserved, 4); assert.equal(pending.allowance?.available, 0);
  assert.equal(pending.loops.find((loop) => loop.id === id(12))?.currentBatchRequestId, previousBatch);
  assert.equal((await call("POST", `/v1/demand/loops/${id(11)}/ideas`, { baseRevision: 0, idempotencyKey: "fixture-overlap" })).status, 429);
  assert.equal((await operator({ action: "complete", requestId: requestId(partial), count: 5 })).status, 400);
  await operator({ action: "complete", requestId: requestId(partial), count: 2 });
  const accepted = await workspace();
  assert.equal(accepted.allowance?.remaining, 2); assert.equal(accepted.allowance?.reserved, 0);
  assert.equal(accepted.loops.find((loop) => loop.id === id(12))?.currentBatchRequestId, requestId(partial));
  assert.equal(accepted.ideas.filter((idea) => idea.batchRequestId === requestId(partial)).length, 2);
  assert.equal(accepted.ideas.filter((idea) => idea.batchRequestId === previousBatch).length, 6, "previous offered reading remains available in history");
  const zero = await refresh("fixture-zero-accepted");
  await operator({ action: "complete", requestId: requestId(zero), count: 0 });
  assert.equal((await workspace()).allowance?.remaining, 2);
  assert.equal((await workspace()).loops.find((loop) => loop.id === id(12))?.currentBatchRequestId, requestId(partial));
  const failed = await refresh("fixture-terminal-failure");
  await operator({ action: "fail", requestId: requestId(failed), retryable: true });
  assert.equal((await workspace()).allowance?.available, 2);
  assert.equal((await call("POST", `/v1/demand/requests/${requestId(failed)}/retry`)).status, 202);
  await operator({ action: "complete", requestId: requestId(failed) });
  assert.equal((await workspace()).allowance?.remaining, 0);
  assert.equal((await refresh("fixture-zero-wall")).status, 429);
  assert.deepEqual(demandArticleResultSchema.parse((await call("GET", sensorPath)).body).article, sensor.article);
  const resetPath = "/v1/demand/allowance/reset";
  const reset = (key: string, expectedRevision: number, password = "bulb") => call("POST", resetPath, {
    idempotencyKey: key, expectedRevision, expectedPeriodStart: "2026-09-07T00:00:00.000Z", password });
  const beforeReset = await workspace();
  assert.equal((await reset("fixture-wrong-password", 0, "incorrect")).status, 403);
  assert.equal((await call("POST", resetPath, { idempotencyKey: "fixture-stale-period", expectedRevision: 0,
    expectedPeriodStart: "2026-08-31T00:00:00.000Z", password: "bulb" })).status, 409);
  assert.deepEqual(await workspace(), beforeReset);
  await operator({ action: "fault", mode: "fail", path: resetPath });
  assert.equal((await reset("fixture-reset-failed", 0)).status, 503);
  assert.deepEqual(await workspace(), beforeReset);
  await operator({ action: "fault", mode: "lose-response", path: resetPath });
  const lostReset = await reset("fixture-lost-reset", 0); assert.equal(lostReset.loseResponse, true);
  const replay = await reset("fixture-lost-reset", 0);
  assert.equal(demandAllowanceResetReceiptSchema.parse((replay.body as { receipt: unknown }).receipt).replayed, true);
  const restored = await workspace();
  assert.equal(restored.allowance?.remaining, 500); assert.equal(restored.allowance?.revision, 1);
  assert.equal(restored.allowance?.periodUsed, beforeReset.allowance?.periodUsed);
  assert.deepEqual(restored.ideas, beforeReset.ideas); assert.deepEqual(restored.requests, beforeReset.requests);
  const oldPending = await refresh("fixture-before-reset");
  await reset("fixture-reset-with-pending", 1);
  assert.equal((await workspace()).allowance?.available, 500);
  await operator({ action: "complete", requestId: requestId(oldPending), count: 6 });
  assert.equal((await workspace()).allowance?.remaining, 500);
  assert.equal((await workspace()).allowance?.periodUsed, beforeReset.allowance!.periodUsed + 6);
  await operator({ action: "fault", mode: "hold-response", path: resetPath });
  let resolved = false;
  const held = reset("fixture-held-reset", 2).then((reply) => { resolved = true; return reply; });
  await Promise.resolve();
  assert.equal(resolved, false); assert.equal(fixture.state().heldResponses, 1);
  await operator({ action: "release-responses" });
  assert.equal((await held).status, 200);
  assert.equal((await reset("fixture-stale-reset", 2)).status, 409);
  assert.equal(JSON.stringify(fixture.state()).includes('"password"'), false);
  assert.equal(fixture.state().providerCalls, 0); assert.equal(fixture.state().databaseCalls, 0); assert.equal(fixture.state().authCalls, 0);
  assert.equal(fixture.state().authProof, false);
  return { passed: true, fixture: "v11-constructed-ui", providerCalls: 0, databaseCalls: 0, authCalls: 0, authProof: false,
    scenarios: ["live credential refusal", "original sensor article retained", "three matching art sets", "guest/account UI gating only",
      "final four reservation", "over-return rejection", "partial replacement/history", "zero delivery", "failure/retry", "zero wall with retained reading",
      "wrong/reset-failed unchanged", "lost-reset replay", "old pending revision", "operator-held reset response", "stale reset"] };
}

export async function selfTestV11MemberFixture() {
  assert.doesNotThrow(() => assertFixtureEnvironment({ EDISON_V11_MEMBER_FIXTURE: "1" }));
  for (const changed of [{ SUPABASE_URL: "https://external.supabase.co" }, { SUPABASE_PUBLISHABLE_KEY: "not-the-synthetic-key" },
    { NEXT_PUBLIC_API_URL: "https://external.example/v1" }, { SUPABASE_SECRET_KEY: "never-read" }, { NODE_ENV: "production" }]) {
    assert.throws(() => assertFixtureEnvironment({ EDISON_V11_MEMBER_FIXTURE: "1", ...changed }));
  }
  const fixture = createV10Fixture({ member: true });
  const sdk = { apikey: LOCAL_MEMBER_FIXTURE.publishableKey, authorization: `Bearer ${LOCAL_MEMBER_FIXTURE.publishableKey}` };
  const bearer = { authorization: `Bearer ${LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN}` };
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 401);
  assert.equal((await fixture.handle("POST", "/auth/v1/otp", { email: LOCAL_MEMBER_FIXTURE.email, create_user: false }, sdk)).status, 200);
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 401, "asking for a link never creates a session");
  const preview = await fixture.handle("GET", `/v1/demand/invitations/${LOCAL_MEMBER_FIXTURE.invitationId}/preview`);
  assert.equal((preview.body as { state: string }).state, "available");
  assert.equal(fixture.state().syntheticAuthRequests?.verify, 0, "preview cannot consume a token");
  const verified = await fixture.handle("POST", "/auth/v1/verify", { token_hash: LOCAL_MEMBER_FIXTURE.tokenHash, type: "invite" }, sdk);
  assert.equal((verified.body as { access_token: string }).access_token, LOCAL_MEMBER_FIXTURE_ACCESS_TOKEN);
  assert.equal((await fixture.handle("GET", "/v1/demand/access", {}, bearer)).status, 200);
  const session = await fixture.handle("POST", "/v1/demand/session", {}, bearer);
  assert.equal((session.body as { newGuestToken?: string }).newGuestToken, undefined);
  assert.equal(demandWorkspaceSchema.parse((session.body as { workspace: unknown }).workspace).readerKind, "account");
  assert.equal((await fixture.handle("GET", "/v1/demand/workspace", {}, { ...bearer, authorization: "Bearer external-credential-refused" })).status, 401);
  assert.equal((await fixture.handle("GET", "/v1/demand/workspace", {}, { "x-edison-demand-token": TOKEN })).status, 401);
  assert.equal((await fixture.handle("GET", `/v1/public/demand-shares/${"a".repeat(64)}`)).status, 401);
  assert.equal(fixture.state().authProof, false); assert.equal(fixture.state().authCalls, 0);
  return { passed: true, fixture: "v11-member-constructed-ui", authProof: false, providerCalls: 0, databaseCalls: 0, authCalls: 0,
    scenarios: ["explicit mode and external credential refusal", "OTP does not authenticate", "GET preview does not verify",
      "exact synthetic session", "no guest credential", "protected content"] };
}

async function main() {
  assertFixtureEnvironment(process.env);
  const member = process.env.EDISON_V11_MEMBER_FIXTURE === "1";
  const v11 = member || process.env.EDISON_V11_FIXTURE === "1";
  if (process.argv.includes("--self-test")) { process.stdout.write(`${JSON.stringify(member ? await selfTestV11MemberFixture() : v11 ? await selfTestV11Fixture() : await selfTestV10Fixture())}\n`); return; }
  const fixture = createV10Fixture({ v11, member });
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Type", "application/json"); response.setHeader("X-Content-Type-Options", "nosniff");
    const remote = request.socket.remoteAddress;
    const origin = request.headers.origin;
    if (remote !== HOST || ![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(request.headers.host ?? "") || !localOrigin(origin)) {
      response.writeHead(403); response.end(JSON.stringify({ error: { code: "local_only", message: "This fixture is localhost-only." } })); return;
    }
    if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin");
      if (member) response.setHeader("Access-Control-Expose-Headers", "X-Supabase-Api-Version"); }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", member ? "Content-Type, X-Edison-Demand-Token, Authorization, Apikey, X-Client-Info, X-Supabase-Api-Version" : "Content-Type, X-Edison-Demand-Token"); response.writeHead(204); response.end(); return;
    }
    let reply: Reply;
    try {
      reply = await fixture.handle(request.method ?? "GET", request.url ?? "/", await readBody(request), {
        origin, authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
        apikey: typeof request.headers.apikey === "string" ? request.headers.apikey : undefined,
        "x-edison-demand-token": typeof request.headers["x-edison-demand-token"] === "string" ? request.headers["x-edison-demand-token"] : undefined,
        "x-edison-fixture-operator": typeof request.headers["x-edison-fixture-operator"] === "string" ? request.headers["x-edison-fixture-operator"] : undefined,
      });
    } catch { reply = error(400, "invalid_request", "That local request was not valid or exceeded 8192 bytes."); }
    if (reply.loseResponse) { response.destroy(); return; }
    for (const [key, value] of Object.entries(reply.headers ?? {})) response.setHeader(key, value);
    response.writeHead(reply.status); response.end(JSON.stringify(reply.body));
  });
  server.listen(PORT, HOST, () => process.stdout.write(`${JSON.stringify({ fixture: true, url: `http://${HOST}:${PORT}`, state: fixture.state() })}\n`));
  server.on("error", () => { process.stderr.write("Local fixture could not bind its fixed address.\n"); process.exitCode = 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("Local fixture refused startup or failed its self-test.\n"); process.exitCode = 1; });
}
