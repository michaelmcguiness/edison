import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import type { DemandArticle, DemandIdeaResult, DemandRequest, DemandResult, DemandWorkspace } from "@edison/contracts";
import { DemandClientError } from "../lib/demand-client";
import { ambiguousArticleAdmission, ARTICLE_ADMISSION_BACKOFF, reconcileArticleAdmission } from "../components/edison/demand-v13/article-admission-reconciliation";
import { createV10Fixture } from "../scripts/demand-v10-browser-fixture";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Element = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element; return [node, ...nodes(node.props.children)];
}
function copy(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(copy).join("");
  return value && typeof value === "object" && "props" in value ? copy((value as Element).props.children) : "";
}
function invoke(value: unknown, ...args: unknown[]): unknown { assert.equal(typeof value, "function"); return (value as (...args: unknown[]) => unknown)(...args); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const unknown = () => new DemandClientError({ code: "upstream_unavailable", status: 502, message: "The reading service response was interrupted." });

async function scenario() {
  const fixture = createV10Fixture({ v11: true });
  const headers = { "x-edison-demand-token": "f".repeat(64) };
  const workspace = structuredClone(((await fixture.handle("GET", "/v1/demand/workspace", {}, headers)).body as { workspace: DemandWorkspace }).workspace);
  workspace.readerKind = "account";
  const articleId = fixture.state().articles[0].id;
  const target = workspace.ideas.find((idea) => idea.articleRequestId === articleId)!;
  const reply = await fixture.handle("GET", `/v1/demand/articles/${articleId}`, {}, headers);
  assert.equal(reply.status, 200);
  const result = reply.body as { article: DemandArticle; request: DemandRequest };
  target.articleRequestId = null;
  workspace.requests = workspace.requests.filter((request) => request.id !== result.request.id && request.status === "succeeded");
  const state = { workspace, result: { ...result, answer: null } as DemandResult, target, reads: 0, posts: [] as { ideaId: string; idempotencyKey: string }[], bodies: 0,
    exact: { workspaceId: workspace.workspaceId, idea: target, request: null } as DemandIdeaResult };
  const client = {
    startDemandSession: async () => state.workspace,
    getDemandWorkspace: async () => state.workspace,
    getDemandLoops: async () => ({ workspaceId: state.workspace.workspaceId, loops: state.workspace.loops, ideas: state.workspace.ideas, requests: state.workspace.requests, nextCursor: null }),
    getDemandIdea: async () => { state.reads++; return state.exact; },
    requestDemandArticle: async (ideaId: string, input: { idempotencyKey: string }): Promise<{ workspace: DemandWorkspace; requestId: string }> => { state.posts.push({ ideaId, ...input }); throw unknown(); },
    getDemandResult: async () => { state.bodies++; return state.result; },
    updateDemandIdeaEvent: async () => ({ workspace: state.workspace }),
  };
  const admit = (status: DemandRequest["status"] = "succeeded") => {
    state.result = { ...state.result, article: status === "succeeded" ? result.article : null,
      request: { ...state.result.request, status, stage: status === "succeeded" ? "ready" : "writing" } };
    state.exact = { workspaceId: workspace.workspaceId, idea: { ...target, articleRequestId: result.request.id }, request: state.result.request };
  };
  return { state, client, admit };
}

/** Mounts the shipped reader hooks, effects and handlers, with only host DOM,
 * timers, child presentation and transport replaced. No server/provider is used. */
function mountReader(client: object, initialWorkspace: DemandWorkspace, saved = new Map<string, string>(), initialPath = "/", discardMutation = false) {
  let clock = 0; let timerId = 0; let cursor = 0; let dirty = true; let tree: unknown; let mounted = true;
  const slots: unknown[] = []; const effects: (() => void)[] = []; const microtasks: (() => void)[] = [];
  const timers = new Map<number, { work: () => void; at: number }>();
  const events = new Map<string, Set<() => void>>();
  const eventTarget = { addEventListener(name: string, work: () => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(work); },
    removeEventListener(name: string, work: () => void) { events.get(name)?.delete(work); } };
  const schedule = (work: () => void, delay = 0) => { timers.set(++timerId, { work, at: clock + delay }); return timerId; };
  const cancel = (id: number) => timers.delete(id);
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) };
  let location = new URL(initialPath, "https://fixture.example.test");
  const history = { state: null as unknown, pushState(state: unknown, _title: string, path: string) { this.state = state; location = new URL(path, location); },
    replaceState(state: unknown, _title: string, path: string) { this.state = state; location = new URL(path, location); }, back() {} };
  const win = { ...eventTarget, get location() { return location; }, history, scrollY: 0, innerHeight: 800, scrollTo() {} };
  const doc = { ...eventTarget, visibilityState: "visible", querySelector: () => null, activeElement: null, documentElement: { scrollHeight: 800 } };
  const navigator = { onLine: true };
  const exports: { DemandReader?: (props: unknown) => unknown } = {};
  const effect = (work: () => (() => void) | void, dependencies: unknown[]) => {
    const slot = cursor++; const previous = slots[slot] as { dependencies: unknown[]; cleanup?: () => void } | undefined;
    if (previous && previous.dependencies.length === dependencies.length && dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))) return;
    const next = { dependencies, cleanup: undefined as (() => void) | undefined }; slots[slot] = next;
    effects.push(() => { previous?.cleanup?.(); next.cleanup = work() || undefined; });
  };
  new Script(compiled).runInNewContext({ exports, URL, Map, Set, Error, HTMLElement: class {}, navigator, document: doc, window: win, localStorage: storage,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000009999" },
    requestAnimationFrame: (work: () => void) => { microtasks.push(work); return 1; }, cancelAnimationFrame() {},
    queueMicrotask: (work: () => void) => microtasks.push(work), setTimeout: schedule, clearTimeout: cancel,
    require(name: string) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react") return {
        useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === "function" ? invoke(initial) : initial;
          return [slots[slot], (next: unknown) => { if (!mounted) return; const value = typeof next === "function" ? invoke(next, slots[slot]) : next;
            if (!Object.is(value, slots[slot])) { slots[slot] = value; dirty = true; } }]; },
        useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
        useMemo(work: () => unknown, dependencies: unknown[]) { const slot = cursor++; const previous = slots[slot] as { dependencies: unknown[]; value: unknown } | undefined;
          if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) slots[slot] = { dependencies, value: work() };
          return (slots[slot] as { value: unknown }).value; },
        useCallback(work: unknown, dependencies: unknown[]) { const slot = cursor++; const previous = slots[slot] as { dependencies: unknown[]; value: unknown } | undefined;
          if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) slots[slot] = { dependencies, value: work };
          return (slots[slot] as { value: unknown }).value; }, useEffect: effect, useLayoutEffect: effect, useId: () => "mounted-reader",
      };
      if (name.endsWith("/article-admission-reconciliation")) return { ambiguousArticleAdmission,
        reconcileArticleAdmission: (options: Parameters<typeof reconcileArticleAdmission>[0]) => reconcileArticleAdmission({ ...options,
          schedule: schedule as unknown as typeof setTimeout, cancel: cancel as unknown as typeof clearTimeout }) };
      if (name === "lucide-react" || /\/(reader-shell|loop-editor|article-conversation|share-panel|feed|account|allowance-wall|brand|dialog)$/.test(name)) return new Proxy({}, { get: (_object, key) => String(key) });
      if (name.endsWith("/editorial-composer")) return { useEditorialDialogViewport: () => ({}) };
      if (name.endsWith("/pulse-shell")) return { PULSE_FOR_YOU_ID: "for-you" };
      if (name === "@/lib/demand-reader-state" && discardMutation) {
        const actual = require("../lib/demand-reader-state");
        return { ...actual, DemandWorkspaceResponses: class extends actual.DemandWorkspaceResponses {
          acceptMutation() { return null; } // A superseded response cannot own a workspace update.
        } };
      }
      if (name.startsWith("@/")) return require(new URL(`../${name.slice(2)}`, import.meta.url).pathname);
      return require(name);
    },
  });
  function flush() {
    for (let count = 0; dirty || effects.length || microtasks.length; count++) {
      assert.ok(count < 40, "reader effects must settle");
      if (dirty) { dirty = false; cursor = 0; tree = exports.DemandReader!({ client, initialWorkspace }); }
      effects.splice(0).forEach((work) => work()); microtasks.splice(0).forEach((work) => work());
    }
  }
  async function settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); flush(); } }
  async function advance(milliseconds: number) {
    const end = clock + milliseconds;
    for (let count = 0; ; count++) {
      assert.ok(count < 300, "bounded timer work"); await settle();
      const first = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      timers.delete(first[0]); clock = first[1].at; first[1].work();
    }
    clock = end; await settle();
  }
  flush();
  return { saved, navigator, doc, settle, advance, now: () => clock, wait: (milliseconds: number) => new Promise<void>((resolve) => schedule(resolve, milliseconds)),
    path: () => location.pathname + location.search,
    recoveryActions: () => nodes(tree).find((node) => node.props.className === "flex flex-wrap gap-x-5"),
    replaceInitialWorkspace(next: DemandWorkspace) { initialWorkspace = next; dirty = true; flush(); },
    text: () => { flush(); return copy(tree); },
    open(ideaId: string) { flush(); const card = nodes(tree).find((node) => (node.props.idea as { id?: string })?.id === ideaId && typeof node.props.onOpen === "function"); assert.ok(card, `card ${ideaId}`); invoke(card.props.onOpen); flush(); },
    selectLoop(loopId: string) { flush(); invoke(nodes(tree).find((node) => node.type === "ReaderShell")?.props.onSelectLoop, loopId); flush(); },
    click(label: string) { flush(); const node = nodes(tree).find((value) => value.type === "button" && copy(value).includes(label)); assert.ok(node, label); invoke(node.props.onClick); flush(); },
    action(label: string) { flush(); const node = nodes(tree).find((value) => value.type === "button" && copy(value).includes(label)); assert.ok(node, label); return () => invoke(node.props.onClick); },
    event(name: string) { events.get(name)?.forEach((work) => work()); flush(); },
    unmount() { mounted = false; for (const slot of slots) if (slot && typeof slot === "object" && "cleanup" in slot) (slot as { cleanup?: () => void }).cleanup?.(); },
  };
}

test("only ambiguous admissions trigger automatic read-only recovery", () => {
  for (const status of [0, 408, 500, 502, 504]) assert.equal(ambiguousArticleAdmission(new DemandClientError({ code: "request_failed", status, message: "failure" })), true);
  for (const status of [400, 401, 403, 404, 409, 429]) assert.equal(ambiguousArticleAdmission(new DemandClientError({ code: "request_failed", status, message: "failure" })), false);
  assert.equal(ambiguousArticleAdmission(new DemandClientError({ code: "session_unavailable", status: 503, message: "before POST" })), false);
  assert.equal(ambiguousArticleAdmission(new TypeError("Failed to fetch")), true);
});

test("mounted lost admission discovers the exact queued job outside workspace, then reads its ready body without a second POST", async (t) => {
  const { state, client, admit } = await scenario(); admit("running");
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle();
  reader.open(state.target.id); await reader.advance(0);
  assert.equal(state.posts.length, 1); assert.equal(state.reads, 1);
  assert.match(reader.text(), /Writing/);
  assert.doesNotMatch(reader.text(), /You can keep browsing|This article will be here when it’s ready/);
  admit(); await reader.advance(2_000);
  assert.match(reader.text(), /Written by Edison for this loop/);
  assert.equal(reader.path(), `/articles/${state.result.request.id}`);
  assert.equal(state.posts.length, 1); assert.equal(state.bodies, 2, "one immediate pending result read and one ready read, with no metadata waterfall");
  assert.equal(state.reads, 1, "exact idea reads stop as soon as the canonical request is known");
  assert.equal([...reader.saved.keys()].some((key) => key.includes("article-attempt")), false);
});

test("mounted no-job and outage recovery is finite, retains key and resumes only reads on foreground/online", async (t) => {
  for (const outage of [false, true]) {
    const { state, client, admit } = await scenario();
    if (outage) client.getDemandIdea = async () => { state.reads++; throw unknown(); };
    const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id);
    await reader.advance(50_000);
    assert.equal(state.reads, ARTICLE_ADMISSION_BACKOFF.length); assert.equal(state.posts.length, 1);
    assert.match(reader.text(), /couldn’t confirm this article request yet/);
    assert.equal(reader.text().includes("Try again"), !outage);
    const attemptKey = [...reader.saved.keys()].find((key) => key.includes("article-attempt"))!;
    assert.equal(JSON.parse(reader.saved.get(attemptKey)!).idempotencyKey, state.posts[0].idempotencyKey);
    reader.navigator.onLine = false; reader.event("focus"); await reader.advance(50_000); assert.equal(state.reads, 6);
    admit(); client.getDemandIdea = async () => { state.reads++; return state.exact; };
    reader.navigator.onLine = true; reader.event("online"); reader.event("focus"); await reader.advance(0);
    assert.equal(state.reads, 7, "coincident wake events do not overlap");
    assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 1);
  }
});

test("mounted unrelated workspace polling binds the canonical request even while exact reconciliation is unavailable", async (t) => {
  const { state, client, admit } = await scenario();
  state.workspace.requests.push({ ...state.result.request, id: "10000000-0000-4000-8000-000000009998", ideaId: state.workspace.ideas.at(-1)!.id, status: "running", stage: "writing" });
  client.getDemandIdea = async () => { state.reads++; throw unknown(); };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(0);
  admit(); state.workspace = { ...state.workspace, ideas: state.workspace.ideas.map((idea) => idea.id === state.target.id ? state.exact.idea : idea), requests: [...state.workspace.requests, state.result.request] };
  await reader.advance(1_200);
  assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 1); assert.equal(state.bodies, 1);
});

test("mounted reload retains unknown key and route, and reconciles without commissioning", async (t) => {
  const { state, client, admit } = await scenario();
  const first = mountReader(client, state.workspace); await first.settle(); first.open(state.target.id); await first.advance(0);
  const saved = first.saved; const path = first.path(); first.unmount();
  admit(); const restored = mountReader(client, state.workspace, saved, path); t.after(restored.unmount); await restored.advance(0);
  assert.equal(state.posts.length, 1); assert.match(restored.text(), /Written by Edison for this loop/);
  assert.equal(restored.path(), `/articles/${state.result.request.id}`);
});

test("mounted navigation and unmount fence late exact reads without stealing the current view", async (t) => {
  const { state, client, admit } = await scenario(); const pending = deferred<DemandIdeaResult>();
  client.getDemandIdea = async () => { state.reads++; return pending.promise; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(0);
  reader.click("Back to your loops"); admit(); pending.resolve(state.exact); await reader.settle();
  assert.doesNotMatch(reader.text(), /Written by Edison for this loop/); assert.equal(state.bodies, 0);
  reader.open(state.target.id); await reader.advance(0); assert.equal(state.posts.length, 1, "returning to an uncertain card never re-POSTs");
  reader.unmount(); await reader.advance(60_000); assert.equal(state.posts.length, 1);
});

test("mounted definitive admission failure does not start reconciliation or promise a new request", async (t) => {
  const { state, client } = await scenario();
  client.requestDemandArticle = async (ideaId, input) => { state.posts.push({ ideaId, ...input }); throw new DemandClientError({ code: "reading_budget_reached", status: 429, message: "Reading budget reached." }); };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(60_000);
  assert.equal(state.reads, 0); assert.equal(state.posts.length, 1); assert.match(reader.text(), /Reading budget reached/);
});

test("mounted transient body-read failure retries only the same GET and preserves the admitted identity", async (t) => {
  const { state, client, admit } = await scenario(); admit();
  client.getDemandResult = async () => { state.bodies++; if (state.bodies === 1) throw unknown(); return state.result; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(1_200);
  assert.equal(state.bodies, 2); assert.equal(state.posts.length, 1); assert.match(reader.text(), /Written by Edison for this loop/);
});

test("mounted returning to A before its first POST settles starts recovery under the new navigation intent", async (t) => {
  const { state, client, admit } = await scenario(); const post = deferred<never>();
  client.requestDemandArticle = async (ideaId, input) => { state.posts.push({ ideaId, ...input }); return post.promise; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.settle();
  reader.click("Back to your loops"); reader.open(state.target.id); await reader.settle();
  assert.equal(state.posts.length, 1); assert.equal(state.reads, 0);
  admit(); post.reject(unknown()); await reader.advance(0);
  assert.equal(state.posts.length, 1); assert.equal(state.reads, 1); assert.match(reader.text(), /Written by Edison for this loop/);
  assert.doesNotMatch(reader.text(), /service response was interrupted/);
});

test("mounted discarded successful admission envelope remains uncertain in memory and recovers with reads only", async (t) => {
  const { state, client, admit } = await scenario();
  client.requestDemandArticle = async (ideaId, input) => { state.posts.push({ ideaId, ...input }); return { workspace: state.workspace, requestId: state.result.request.id }; };
  const reader = mountReader(client, state.workspace, new Map(), "/", true); t.after(reader.unmount); await reader.settle();
  reader.open(state.target.id); await reader.advance(0); assert.equal(state.reads, 1);
  reader.click("Back to your loops"); admit(); reader.open(state.target.id); await reader.advance(0);
  assert.equal(state.posts.length, 1); assert.match(reader.text(), /Written by Edison for this loop/);
});

test("mounted reload during initial admission preserves uncertainty before any response and ignores the old completion", async (t) => {
  const { state, client, admit } = await scenario(); const post = deferred<never>();
  client.requestDemandArticle = async (ideaId, input) => { state.posts.push({ ideaId, ...input }); return post.promise; };
  const first = mountReader(client, state.workspace); await first.settle(); first.open(state.target.id); await first.settle();
  const key = [...first.saved.keys()].find((value) => value.includes("article-attempt"))!;
  assert.equal(JSON.parse(first.saved.get(key)!).uncertain, true);
  first.unmount(); admit(); const restored = mountReader(client, state.workspace, first.saved, first.path()); t.after(restored.unmount);
  await restored.advance(0); assert.equal(state.posts.length, 1); assert.match(restored.text(), /Written by Edison for this loop/);
  post.reject(unknown()); await restored.settle();
  assert.equal(restored.saved.has(key), false, "unmounted old rejection cannot recreate a resolved attempt");
});

test("mounted hanging exact reads time out finitely; their late result cannot steal a later reading scope", async (t) => {
  const { state, client, admit } = await scenario(); const exact = deferred<DemandIdeaResult>();
  client.getDemandIdea = async () => { state.reads++; return exact.promise; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id);
  await reader.advance(140_000); assert.equal(state.reads, 6); assert.equal(state.posts.length, 1);
  assert.match(reader.text(), /couldn’t confirm this article request yet/); assert.match(reader.text(), /Article request unconfirmed/);
  reader.click("Back to your loops"); admit(); exact.resolve(state.exact); await reader.settle();
  assert.equal(state.bodies, 0); assert.doesNotMatch(reader.text(), /Written by Edison for this loop/);
});

test("mounted pre-recovery legacy saved attempts are unknown, never permission for a second POST", async (t) => {
  const { state, client, admit } = await scenario();
  const first = mountReader(client, state.workspace); await first.settle(); first.open(state.target.id); await first.advance(0);
  const key = [...first.saved.keys()].find((value) => value.includes("article-attempt"))!;
  const old = JSON.parse(first.saved.get(key)!); delete old.uncertain; first.saved.set(key, JSON.stringify(old)); first.unmount();
  const restored = mountReader(client, state.workspace, first.saved); t.after(restored.unmount); await restored.settle();
  admit(); restored.open(state.target.id); await restored.advance(0);
  assert.equal(state.posts.length, 1); assert.match(restored.text(), /Written by Edison for this loop/);
});

test("mounted an already admitted failed request shows its actual outcome and never commissions another body", async (t) => {
  const { state, client, admit } = await scenario(); admit("failed");
  state.workspace = { ...state.workspace, ideas: state.workspace.ideas.map((idea) => idea.id === state.target.id ? state.exact.idea : idea), requests: [...state.workspace.requests, state.result.request] };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(30_000);
  assert.equal(state.posts.length, 0); assert.equal(state.bodies, 0); assert.match(reader.text(), /We couldn’t finish this article/);
  assert.match(reader.text(), /Nothing was published/); assert.doesNotMatch(reader.text(), /This article will be here/);
});

test("mounted confirmed no-request exhaustion permits one explicit same-key retry, with a synchronous double-click lock", async (t) => {
  const { state, client, admit } = await scenario();
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(50_000);
  assert.equal(state.posts.length, 1); const firstKey = state.posts[0].idempotencyKey;
  const actions = reader.recoveryActions(); assert.ok(actions);
  assert.deepEqual(nodes(actions).filter((node) => node.type === "button").map((node) => copy(node)), ["Check article status", "Try again"]);
  assert.match(readFileSync(new URL("../app/demand.css", import.meta.url), "utf8"), /\.demand-text-action \{\s*display: inline-flex;\s*min-height: 44px;/);
  const retry = reader.action("Try again"); const pending = deferred<{ workspace: DemandWorkspace; requestId: string }>();
  client.requestDemandArticle = async (ideaId, input) => { state.posts.push({ ideaId, ...input }); return pending.promise; };
  retry(); retry(); await reader.settle(); assert.equal(state.posts.length, 2); assert.equal(state.posts[1].idempotencyKey, firstKey);
  const stored = [...reader.saved.entries()].find(([key]) => key.includes("article-attempt"))!;
  assert.equal(JSON.parse(stored[1]).uncertain, true);
  admit(); pending.resolve({ workspace: state.workspace, requestId: state.result.request.id }); await reader.advance(0);
  assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 2);
});

test("mounted retry remains the original key when the server accepted the original request after the last read", async (t) => {
  const { state, client, admit } = await scenario();
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(50_000);
  admit(); // Late admission is not in the browser's last null observation.
  client.requestDemandArticle = async (ideaId, input) => {
    state.posts.push({ ideaId, ...input }); assert.equal(input.idempotencyKey, state.posts[0].idempotencyKey);
    return { workspace: state.workspace, requestId: state.result.request.id }; // Idempotent canonical receipt.
  };
  reader.click("Try again"); await reader.advance(0);
  assert.equal(state.posts.length, 2); assert.match(reader.text(), /Written by Edison for this loop/);
  assert.equal(reader.path(), `/articles/${state.result.request.id}`);
});

test("mounted no-job retry proof expires on navigation and reload; later canonical discovery disables its stale handler", async (t) => {
  const { state, client, admit } = await scenario();
  const first = mountReader(client, state.workspace); await first.settle(); first.open(state.target.id); await first.advance(50_000);
  const stale = first.action("Try again"); first.click("Back to your loops"); stale(); await first.settle(); assert.equal(state.posts.length, 1);
  first.open(state.target.id); await first.advance(0); assert.doesNotMatch(first.text(), /Try again/);
  await first.advance(50_000); stale(); await first.settle();
  assert.equal(state.posts.length, 1, "an earlier A callback cannot consume a later A retry proof");
  first.unmount(); stale();
  const restored = mountReader(client, state.workspace, first.saved, first.path()); t.after(restored.unmount); await restored.advance(0);
  assert.doesNotMatch(restored.text(), /Try again/); assert.equal(state.posts.length, 1);
  await restored.advance(50_000); const oldRetry = restored.action("Try again");
  admit(); restored.event("focus"); await restored.advance(0); oldRetry(); await restored.settle();
  assert.equal(state.posts.length, 1); assert.match(restored.text(), /Written by Edison for this loop/);
});

test("mounted mismatched or invalid exact results never authorize explicit retry", async (t) => {
  for (const invalid of ["workspace", "idea", "missing-pointer"] as const) {
    const { state, client } = await scenario();
    state.exact = invalid === "workspace" ? { ...state.exact, workspaceId: "10000000-0000-4000-8000-000000009900" }
      : invalid === "idea" ? { ...state.exact, idea: { ...state.exact.idea, id: "10000000-0000-4000-8000-000000009900" } }
        : { ...state.exact, idea: { ...state.exact.idea, articleRequestId: undefined } } as unknown as DemandIdeaResult;
    const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(50_000);
    assert.doesNotMatch(reader.text(), /Try again/); assert.equal(state.posts.length, 1);
  }
});

test("mounted a prior owner's retry handler cannot request an article after an account workspace change", async (t) => {
  const { state, client } = await scenario();
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(50_000);
  const stale = reader.action("Try again");
  reader.replaceInitialWorkspace({ ...state.workspace, workspaceId: "10000000-0000-4000-8000-000000009901", loops: [], ideas: [], requests: [] });
  await reader.settle(); stale(); await reader.advance(50_000);
  assert.equal(state.posts.length, 1); assert.doesNotMatch(reader.text(), /Try again/);
});

function retainKnownArticle(state: Awaited<ReturnType<typeof scenario>>["state"]) {
  state.workspace = { ...state.workspace, ideas: state.workspace.ideas.map((idea) => idea.id === state.target.id ? state.exact.idea : idea),
    requests: [...state.workspace.requests.filter(({ id }) => id !== state.result.request.id), state.result.request] };
}

test("mounted known request displays an already published article in one result RTT, before either old metadata timer", async (t) => {
  const { state, client, admit } = await scenario(); admit("queued"); retainKnownArticle(state); admit();
  const times: number[] = []; let workspaceReads = 0;
  client.getDemandWorkspace = async () => { workspaceReads++; return state.workspace; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle();
  client.getDemandResult = async () => { state.bodies++; times.push(reader.now()); await reader.wait(200); return state.result; };
  reader.open(state.target.id); await reader.advance(199);
  assert.deepEqual(times, [0], "the known result read starts immediately, not after the old 1200ms/2000ms metadata timers");
  assert.doesNotMatch(reader.text(), /Written by Edison for this loop/);
  await reader.advance(1);
  assert.match(reader.text(), /Written by Edison for this loop/);
  assert.equal(reader.path(), `/articles/${state.result.request.id}`);
  assert.equal(workspaceReads, 0); assert.equal(state.reads, 0); assert.equal(state.bodies, 1); assert.equal(state.posts.length, 0);
  await reader.advance(10_000); assert.equal(state.bodies, 1, "publication stops the selected poll");
});

test("mounted known queued/running reads keep one serial cadence despite metadata churn and stop on terminal failure", async (t) => {
  const { state, client, admit } = await scenario(); admit("queued"); retainKnownArticle(state);
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle();
  const times: number[] = [];
  client.getDemandResult = async () => { state.bodies++; times.push(reader.now()); await reader.wait(100); return state.result; };
  reader.open(state.target.id); await reader.advance(100);
  admit("running"); retainKnownArticle(state);
  reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.advance(500);
  reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.advance(1_599);
  assert.deepEqual(times, [0, 2_100], "queued→running and unrelated workspace objects do not restart or duplicate the read");
  await reader.advance(1); assert.match(reader.text(), /Writing/);
  admit("failed"); await reader.advance(2_100);
  assert.match(reader.text(), /We couldn’t finish this article/);
  await reader.advance(30_000); assert.deepEqual(times, [0, 2_100, 4_200]);
  assert.equal(state.reads, 0); assert.equal(state.posts.length, 0);
});

test("mounted completion metadata wakes the existing result poll without duplicating an in-flight read", async (t) => {
  const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state);
  const first = deferred<DemandResult>();
  client.getDemandResult = async () => { state.bodies++; return state.bodies === 1 ? first.promise : state.result; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(0);
  admit(); retainKnownArticle(state); reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.settle();
  assert.equal(state.bodies, 1, "workspace success cannot overlap an existing GET");
  first.resolve(state.result); await reader.settle();
  assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.bodies, 1);
});

test("mounted completion metadata bypasses the remaining 2s wait when no result read is in flight", async (t) => {
  const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state);
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(100);
  assert.equal(state.bodies, 1);
  admit(); retainKnownArticle(state); reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.settle();
  assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.bodies, 2); assert.equal(reader.now(), 100);
  await reader.advance(5_000); assert.equal(state.bodies, 2);
});

test("mounted delayed result reads cannot steal Back, a reopened idea, a new owner, or an unmounted view", async (t) => {
  for (const change of ["back", "reopen", "owner", "unmount"] as const) {
    for (const reject of [false, true]) {
      const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state);
      const stale = deferred<DemandResult>(); const next = deferred<DemandResult>();
      client.getDemandResult = async () => { state.bodies++; return state.bodies === 1 ? stale.promise : next.promise; };
      const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.settle();
      if (change === "owner") reader.replaceInitialWorkspace({ ...state.workspace, workspaceId: "10000000-0000-4000-8000-000000009901", loops: [], ideas: [], requests: [] });
      else if (change === "unmount") reader.unmount();
      else { reader.click("Back to your loops"); if (change === "reopen") reader.open(state.target.id); }
      await reader.settle(); admit();
      if (reject) stale.reject(unknown()); else stale.resolve(state.result);
      await reader.advance(10_000);
      assert.doesNotMatch(reader.text(), /Written by Edison for this loop|service response was interrupted/);
      assert.equal(state.bodies, change === "reopen" ? 2 : 1); assert.equal(state.posts.length, 0);
      if (change === "reopen") { next.resolve(state.result); await reader.settle(); assert.match(reader.text(), /Written by Edison for this loop/); }
    }
  }
});

test("mounted mismatched known result identities stop without publishing or retrying", async (t) => {
  for (const field of ["id", "ideaId", "loopId", "kind", "article"] as const) {
    const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state); admit();
    const valid = state.result;
    state.result = field === "article" ? { ...state.result, article: { ...state.result.article!, id: "10000000-0000-4000-8000-000000009900" } }
      : { ...state.result, request: { ...state.result.request, [field]: field === "kind" ? "question" : "10000000-0000-4000-8000-000000009900" } };
    const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(30_000);
    assert.match(reader.text(), /different article request/); assert.doesNotMatch(reader.text(), /Written by Edison for this loop/);
    assert.equal(state.bodies, 1); assert.equal(state.posts.length, 0);
    state.result = valid; retainKnownArticle(state); reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.advance(10_000);
    assert.equal(state.bodies, 1, "completion metadata cannot automatically restart a poll stopped for invalid identity");
  }
});

test("mounted missing published body retries boundedly and manual loading reuses the same request", async (t) => {
  const { state, client, admit } = await scenario(); admit(); retainKnownArticle(state);
  const ready = state.result; state.result = { ...state.result, article: null };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(30_000);
  assert.equal(state.bodies, 4); assert.match(reader.text(), /ready request without its article/); assert.doesNotMatch(reader.text(), /Written by Edison for this loop/);
  state.result = ready; reader.click("Load article again"); await reader.settle();
  assert.equal(state.bodies, 5); assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 0);
});

test("mounted newer retry metadata wins over an older failed result and keeps polling the same request", async (t) => {
  const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state);
  const old = deferred<DemandResult>(); client.getDemandResult = async () => { state.bodies++; return state.bodies === 1 ? old.promise : state.result; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.settle();
  admit("failed"); const failure = structuredClone(state.result);
  admit("queued"); state.result.request.updatedAt = "2026-09-09T00:00:00.000Z"; retainKnownArticle(state);
  reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.settle(); old.resolve(failure); await reader.advance(2_000);
  assert.equal(state.bodies, 2); assert.doesNotMatch(reader.text(), /We couldn’t finish this article/);
  admit(); await reader.advance(2_000); assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 0);
});

test("mounted failed known request resumes only after an explicit same-ID retry", async (t) => {
  const { state, client, admit } = await scenario(); admit("failed");
  state.result.request.failure = { code: "provider_unavailable", message: "Try again.", retryable: true }; retainKnownArticle(state);
  let retries = 0;
  const retryClient = { ...client, retryDemandRequest: async (id: string) => {
    assert.equal(id, state.result.request.id); retries++; admit("queued"); state.result.request.updatedAt = "2026-09-09T00:00:00.000Z"; retainKnownArticle(state);
    return { workspace: state.workspace, requestId: id };
  } };
  const reader = mountReader(retryClient, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(5_000);
  assert.equal(state.bodies, 0); reader.click("Try again"); await reader.settle(); assert.equal(state.bodies, 1); assert.equal(retries, 1);
  admit(); await reader.advance(2_000); assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 0);
});

test("mounted off-window loop polling survives unrelated snapshots and accepts a slow response without resetting its timer", async (t) => {
  const { state, client } = await scenario();
  const loop = state.workspace.loops[0];
  const request: DemandRequest = { ...state.result.request, id: "10000000-0000-4000-8000-000000009902", ideaId: null, kind: "ideas", status: "running", stage: "researching" };
  state.workspace = { ...state.workspace, loops: state.workspace.loops.filter(({ id }) => id !== loop.id), ideas: [], requests: [request] };
  const page = { workspaceId: state.workspace.workspaceId, loops: [loop], ideas: [], requests: [request], nextCursor: null };
  client.getDemandLoops = async () => page;
  const response = deferred<typeof page>(); const calls: number[] = [];
  const reader = mountReader({ ...client, getDemandLoop: async (id: string) => { assert.equal(id, loop.id); calls.push(reader.now()); return response.promise; } }, state.workspace);
  t.after(reader.unmount); await reader.settle();
  for (let i = 0; i < 4; i++) { await reader.advance(400); reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.settle(); }
  assert.deepEqual(calls, [1_500], "unrelated snapshots do not defer the first read");
  await reader.advance(2_000); assert.deepEqual(calls, [1_500], "slow loop reads remain serial during workspace polls");
  response.resolve({ ...page, requests: [{ ...request, status: "failed", updatedAt: "2026-09-09T00:00:00.000Z" }] }); await reader.settle();
  await reader.advance(10_000); assert.deepEqual(calls, [1_500], "the accepted terminal response stops this loop poll");
  reader.selectLoop(loop.id); await reader.settle(); assert.match(reader.text(), /We couldn’t refresh your articles/);
});

test("mounted exhausted running result reads remain explicitly recoverable off the workspace page, using only the original GET", async (t) => {
  for (const recovery of ["manual", "metadata"] as const) {
    const { state, client, admit } = await scenario(); admit("running");
    let failing = true;
    client.getDemandResult = async () => { state.bodies++; if (failing) throw unknown(); return state.result; };
    // Lost admission is recovered as exact history metadata, not a recent row.
    const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(30_000);
    assert.equal(state.bodies, 4); assert.equal(state.posts.length, 1); assert.match(reader.text(), /Load article again/);
    await reader.advance(30_000); assert.equal(state.bodies, 4, "exhaustion never creates an unlimited background retry loop");
    failing = false; admit();
    if (recovery === "manual") reader.click("Load article again");
    else { retainKnownArticle(state); reader.replaceInitialWorkspace(structuredClone(state.workspace)); }
    await reader.settle(); assert.equal(state.bodies, 5); assert.equal(state.posts.length, 1);
    assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(reader.path(), `/articles/${state.result.request.id}`);
  }
});

test("mounted stale pending results do not regress newer completion metadata or publish a body before their own success", async (t) => {
  const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state);
  const old = structuredClone(state.result); const first = deferred<DemandResult>();
  client.getDemandResult = async () => { state.bodies++; return state.bodies === 1 ? first.promise : state.result; };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.settle();
  admit(); state.result.request.updatedAt = "2026-09-09T00:00:00.000Z"; retainKnownArticle(state);
  reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.settle();
  first.resolve({ ...old, article: state.result.article }); await reader.settle();
  assert.doesNotMatch(reader.text(), /Written by Edison for this loop/); assert.equal(state.bodies, 1);
  await reader.advance(2_000); assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.bodies, 2);
});

test("mounted definitive result-read failures stop until explicit retry, without commissioning", async (t) => {
  const { state, client, admit } = await scenario(); admit("running"); retainKnownArticle(state);
  client.getDemandResult = async () => { state.bodies++; throw new DemandClientError({ status: 403, code: "access_denied", message: "Access could not be confirmed." }); };
  const reader = mountReader(client, state.workspace); t.after(reader.unmount); await reader.settle(); reader.open(state.target.id); await reader.advance(30_000);
  assert.equal(state.bodies, 1); assert.match(reader.text(), /Load article again/);
  admit(); retainKnownArticle(state); reader.replaceInitialWorkspace(structuredClone(state.workspace)); await reader.settle();
  assert.equal(state.bodies, 1, "metadata completion is not permission to ignore a definitive access error");
  client.getDemandResult = async () => { state.bodies++; return state.result; };
  reader.click("Load article again"); await reader.settle(); assert.match(reader.text(), /Written by Edison for this loop/); assert.equal(state.posts.length, 0);
});

test("mounted off-window loop responses cannot reintroduce a previous workspace after owner change", async (t) => {
  const { state, client } = await scenario(); const loop = state.workspace.loops[0];
  const request: DemandRequest = { ...state.result.request, ideaId: null, kind: "ideas", status: "running", stage: "researching" };
  state.workspace = { ...state.workspace, loops: [], ideas: [], requests: [request] };
  const page = { workspaceId: state.workspace.workspaceId, loops: [loop], ideas: [], requests: [request], nextCursor: null };
  client.getDemandLoops = async () => page;
  const pending = deferred<typeof page>(); let calls = 0;
  const reader = mountReader({ ...client, getDemandLoop: async () => { calls++; return pending.promise; } }, state.workspace); t.after(reader.unmount);
  await reader.advance(1_500); assert.equal(calls, 1);
  reader.replaceInitialWorkspace({ ...state.workspace, workspaceId: "10000000-0000-4000-8000-000000009901", loops: [], ideas: [], requests: [] });
  await reader.settle(); pending.resolve(page); await reader.advance(10_000);
  assert.equal(calls, 1); reader.selectLoop(loop.id); assert.doesNotMatch(reader.text(), new RegExp(loop.title));
});
