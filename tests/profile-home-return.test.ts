import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Script } from "node:vm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { createEmptyPublicationWorkspace } from "../lib/publication-state";
import { emptyPulseWorkspace } from "../lib/pulse-workspace";
import { emptyReaderContinuity } from "../lib/reader-continuity";
import { PulseShell } from "../components/edison/pulse-shell";
import { ProfileView } from "../components/edison/library-profile";

const requireActual = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../components/edison/reader-app.tsx", import.meta.url), "utf8"), {
  fileName: "components/edison/reader-app.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

type Element = ReactElement<Record<string, unknown>>;
function find(node: ReactNode, match: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, match); if (result) return result; }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  return match(node) ? node : find(node.props.children as ReactNode, match);
}

// Execute the actual ReaderSession and its returned UI callbacks. Only React's
// hook scheduler, browser operations and unrelated storage hooks are isolated;
// no provider/Auth/network effects are run. This is not a mounted browser test.
function profileSession(returnHomeToDemand?: boolean, dataMode: "guest" | "live" | "prototype" = "live") {
  const calls: { operation: string; url?: string }[] = [];
  const slots: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  const listeners = new Map<string, (event: { state: unknown }) => void>();
  let cursor = 0;
  const location = {
    href: "https://edison.example/?view=profile", search: "?view=profile",
    assign(url: string) { calls.push({ operation: "assign", url }); },
    replace(url: string) { calls.push({ operation: "replace", url }); },
  };
  const history = {
    state: {}, scrollRestoration: "auto",
    replaceState(state: object, _title: string, url: string) { this.state = state; calls.push({ operation: "replaceState", url }); },
    pushState(state: object, _title: string, url: string) { this.state = state; calls.push({ operation: "pushState", url }); },
    go() { calls.push({ operation: "go" }); },
    back() { calls.push({ operation: "back" }); },
  };
  const continuity = { record: { current: emptyReaderContinuity() }, hydrated: true, error: "", capture() {}, restore() {} };
  const exports: { ReaderApp?: (props: object) => ReactElement<object> } = {};
  new Script(compiled).runInNewContext({
    exports, URLSearchParams, setTimeout, clearTimeout,
    requestAnimationFrame: () => 1,
    window: {
      location, history, scrollY: 0, scrollTo() {},
      addEventListener(name: string, listener: (event: { state: unknown }) => void) { listeners.set(name, listener); },
      removeEventListener(name: string) { listeners.delete(name); },
    },
    require(name: string) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "@/components/edison/pulse-shell") return { PulseShell };
      if (name === "@/components/edison/library-profile") return { ...requireActual("../components/edison/library-profile"), ProfileView };
      if (name === "react") return {
        useCallback: (callback: unknown) => callback,
        useMemo: (compute: () => unknown) => compute(),
        useEffect: (effect: () => void | (() => void)) => effects.push(effect),
        useRef(initial: unknown) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = { current: initial };
          return slots[index];
        },
        useState(initial: unknown) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
          return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
        },
      };
      if (name === "@/hooks/use-publication-workspace") return { usePublicationWorkspace: () => ({ workspace: createEmptyPublicationWorkspace("test"), hydrated: true }) };
      if (name === "@/hooks/use-reading-loops") return { useReadingLoops: () => ({ loops: [], articles: [], guestLoops: [], device: { workspace: emptyPulseWorkspace() } }) };
      if (name === "@/hooks/use-reader-continuity") return { useReaderContinuity: () => continuity };
      return requireActual(name.startsWith("@/") ? `../${name.slice(2)}` : name);
    },
  });
  assert.ok(exports.ReaderApp);
  const session = exports.ReaderApp({ reader: { id: "reader-id", name: "Reader", email: "reader@example.test" }, dataMode, returnHomeToDemand });
  assert.equal(typeof session.type, "function");
  const render = () => {
    cursor = 0; effects.length = 0;
    return (session.type as (props: object) => Element)(session.props);
  };
  render();
  // Run route initialization through the real effect, stopping once its real
  // popstate listener is registered; later effects perform unrelated data loads.
  for (const effect of effects) { effect(); if (listeners.has("popstate")) break; }
  assert.ok(listeners.has("popstate"));
  const tree = render();
  const profile = find(tree, (element) => element.type === ProfileView);
  assert.ok(profile, "actual location initialization must select Profile");
  assert.equal(calls.length, 0, "opening Profile must not navigate away");
  return { tree, profile, calls, location, history, listeners, render };
}

test("demand Profile masthead home invokes full document navigation, not legacy history routing", () => {
  const session = profileSession(true);
  assert.equal(session.tree.type, PulseShell);
  const shell = PulseShell(session.tree.props as unknown as Parameters<typeof PulseShell>[0]);
  const home = find(shell, (element) => element.props["aria-label"] === "Edison home — For You");
  assert.ok(home);
  (home.props.onClick as () => void)();
  assert.deepEqual(session.calls, [{ operation: "assign", url: "/" }]);
});

test("demand Profile Back ignores legacy return-history metadata and resolves the new homepage", () => {
  for (const mode of ["live", "guest"] as const) {
    const session = profileSession(true, mode);
    session.history.state = { __edisonFromPublication: true, __edisonReturnRoute: { section: "news", view: "home", articleId: null } };
    (session.profile.props.back as () => void)();
    assert.deepEqual(session.calls, [{ operation: "assign", url: "/" }]);
  }
});

test("demand Profile browser popstate reaching home performs replacement document navigation", () => {
  const session = profileSession(true);
  session.location.search = "";
  session.listeners.get("popstate")!({ state: {} });
  assert.deepEqual(session.calls, [{ operation: "replace", url: "/" }]);
  assert.ok(find(session.render(), (element) => element.type === ProfileView), "do not render a legacy home while the document navigation is pending");
});

test("disabled and omitted demand Profile props preserve legacy home and Back behavior", () => {
  for (const enabled of [false, undefined]) {
    for (const mode of ["live", "guest", "prototype"] as const) {
      const session = profileSession(enabled, mode);
      (session.profile.props.back as () => void)();
      assert.ok(session.calls.some((call) => call.operation === "replaceState"));
      assert.ok(session.calls.every((call) => call.operation !== "assign" && call.operation !== "replace"));
    }
    const session = profileSession(enabled);
    (session.tree.props.onOpenHome as () => void)();
    assert.ok(session.calls.some((call) => call.operation === "pushState"));
    assert.ok(session.calls.every((call) => call.operation !== "assign" && call.operation !== "replace"));
  }
});

test("disabled demand Profile popstate remains local and does not reload the document", () => {
  const session = profileSession(false);
  session.location.search = "";
  session.listeners.get("popstate")!({ state: {} });
  assert.deepEqual(session.calls, []);
  assert.equal(find(session.render(), (element) => element.type === ProfileView), undefined);
});
