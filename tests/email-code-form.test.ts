import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { AuthApiError, type Session } from "@supabase/supabase-js";
import { createEmailCodeAuthController, type EmailCodeAuthOptions } from "../lib/email-code-auth";
import type { EmailCodeTransport } from "../lib/supabase/email-code-client";
import * as entry from "../components/auth/invitation-entry-state";

type Element = { type: unknown; props: Record<string, unknown> };
type Props = { returnPath?: string; invitationId?: string; authOrigin?: string; hasCode?: boolean };
const invitation = "00000000-0000-4000-8000-000000000001";
const next = "/articles/00000000-0000-4000-8000-000000000002";
const reader = "reader@example.test";
const compiled = ts.transpileModule(readFileSync(new URL("../components/auth/login-form.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Element).props.children) : "";
}
function invoke(value: unknown, ...args: unknown[]): unknown {
  assert.equal(typeof value, "function");
  return (value as (...args: unknown[]) => unknown)(...args);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function session(email: string): Session {
  return { access_token: "offline-token", refresh_token: "offline-refresh", expires_in: 3600, token_type: "bearer",
    user: { id: invitation, email, email_confirmed_at: "2026-09-08T00:00:00Z", aud: "authenticated", created_at: "2026-09-08T00:00:00Z", app_metadata: {}, user_metadata: {} } };
}
function transport(overrides: Partial<EmailCodeTransport> = {}) {
  const calls = { sends: [] as string[], verifies: [] as { email: string; token: string }[], commits: 0, reads: 0 };
  const service: EmailCodeTransport = {
    send: async (email) => { calls.sends.push(email); return null; }, resendConfirmation: async () => null,
    verify: async (email, token) => { calls.verifies.push({ email, token }); return { session: session(email), error: null }; },
    commit: async (value, current) => { calls.commits++; return current() ? value : null; },
    readSession: async () => { calls.reads++; return null; }, dispose() {}, ...overrides,
  };
  return { service, calls };
}

/** Runs the shipped TSX handlers/effects with stable hook slots and the real
 * controller. DOM focus/timers and provider transport are bounded local fakes;
 * browser rendering and real SDK cookie races remain separate acceptance tests. */
function formHarness(props: Props = {}, service = transport().service) {
  let now = 1_000_000; let cursor = 0; let dirty = true; let tree: unknown;
  const slots: unknown[] = []; const effects: (() => void)[] = []; const microtasks: (() => void)[] = [];
  const timerTasks = new Map<number, () => void>(); const intervals = new Map<number, () => void>(); let timerId = 0;
  const focused: string[] = []; const assigned: string[] = []; const contexts: EmailCodeAuthOptions[] = [];
  const saved = new Map<string, string>();
  const localStorage = { getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const refs = new Set<{ current: unknown }>();
  const exports: { LoginForm?: (props: Props) => unknown } = {};
  new Script(compiled).runInNewContext({ exports, URL, Date: class extends Date { static now() { return now; } },
    window: { location: { origin: "https://retained-alias.example.test", assign: (url: string) => assigned.push(url) } },
    sessionStorage: localStorage, queueMicrotask: (work: () => void) => microtasks.push(work),
    requestAnimationFrame: (work: () => void) => microtasks.push(work),
    setTimeout: (work: () => void) => { timerTasks.set(++timerId, work); return timerId; },
    clearTimeout: (id: number) => timerTasks.delete(id),
    setInterval: (work: () => void) => { intervals.set(++timerId, work); return timerId; },
    clearInterval: (id: number) => intervals.delete(id),
    require(name: string) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "lucide-react") return { LoaderCircle: () => null };
      if (name === "react") return {
        useState(initial: unknown) {
          const slot = cursor++; if (!(slot in slots)) slots[slot] = initial;
          return [slots[slot], (value: unknown) => {
            const updated = typeof value === "function" ? invoke(value, slots[slot]) : value;
            if (!Object.is(slots[slot], updated)) { slots[slot] = updated; dirty = true; }
          }];
        },
        useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
        useEffect(work: () => (() => void) | void, dependencies: unknown[]) {
          const slot = cursor++; const previous = slots[slot] as { dependencies: unknown[]; cleanup?: () => void } | undefined;
          if (previous && previous.dependencies.length === dependencies.length && dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))) return;
          const effect = { dependencies, cleanup: undefined as (() => void) | undefined }; slots[slot] = effect;
          effects.push(() => { previous?.cleanup?.(); effect.cleanup = work() || undefined; });
        },
      };
      if (name === "@/lib/email-code-auth") return { createEmailCodeAuthController: (options: EmailCodeAuthOptions) => {
        contexts.push(options); return createEmailCodeAuthController({ ...options, transport: service, now: () => now });
      } };
      if (name === "./invitation-entry-state") return { ...entry,
        rememberAuthReturn: (path: string) => entry.rememberAuthReturn(path, () => localStorage, now),
        readAuthReturn: () => entry.readAuthReturn(() => localStorage, now),
        readSignInRetryAt: () => entry.readSignInRetryAt(() => localStorage, now),
      };
      throw new Error(`Unmocked form dependency: ${name}`);
    },
  });
  assert.ok(exports.LoginForm);
  function flush() {
    for (let pass = 0; dirty || effects.length || microtasks.length || timerTasks.size; pass++) {
      assert.ok(pass < 30, "form effects must converge");
      if (dirty) {
        dirty = false; cursor = 0;
        for (const ref of refs) ref.current = null;
        refs.clear(); tree = exports.LoginForm!(props);
        for (const node of nodes(tree)) {
          const ref = node.props.ref as { current: unknown } | undefined;
          if (!ref) continue;
          refs.add(ref);
          ref.current = { validity: { valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(node.props.value)) },
            focus: () => focused.push(String(node.props.id)) };
        }
      }
      effects.splice(0).forEach((work) => work());
      microtasks.splice(0).forEach((work) => work());
      const timers = [...timerTasks.values()]; timerTasks.clear(); timers.forEach((work) => work());
    }
  }
  function node(predicate: (value: Element) => boolean) { flush(); const found = nodes(tree).find(predicate); assert.ok(found); return found; }
  const input = (id: string) => node((value) => value.type === "input" && value.props.id === id);
  const button = (label: string) => node((value) => value.type === "button" && text(value) === label);
  flush();
  return { focused, assigned, contexts, flush, input, button,
    copy: () => { flush(); return text(tree); },
    primary: () => node((value) => value.type === "button" && value.props.type === "submit"),
    message: () => node((value) => value.props.id === "sign-in-message"),
    change(id: string, value: string) { invoke(input(id).props.onChange, { target: { value } }); flush(); },
    submitHandler: () => node((value) => value.type === "form").props.onSubmit,
    submit() { return invoke(node((value) => value.type === "form").props.onSubmit, { preventDefault() {} }) as Promise<void>; },
    click(label: string) { const target = button(label); assert.equal(Boolean(target.props.disabled), false); invoke(target.props.onClick); flush(); },
    advance(milliseconds: number) { now += milliseconds; intervals.forEach((work) => work()); flush(); },
    async settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flush(); } },
    dispose() { for (const slot of slots) if (slot && typeof slot === "object" && "cleanup" in slot) (slot as { cleanup?: () => void }).cleanup?.(); },
  };
}

test("actual form validates empty and malformed emails, then focuses the field without sending", async (t) => {
  const http = transport(); const form = formHarness({}, http.service); t.after(form.dispose);
  for (const email of ["", "not-an-email"]) {
    form.change("email", email); await form.submit();
    assert.match(form.copy(), /Enter a valid email address\./);
    assert.equal(form.message().props.role, "alert");
    assert.equal(form.input("email").props["aria-invalid"], true);
    assert.equal(form.focused.at(-1), "email");
  }
  assert.equal(http.calls.sends.length, 0);
});

test("actual form serializes duplicate sends and uses the same generic code step for eligible and ineligible emails", async (t) => {
  for (const error of [null, new AuthApiError("Private membership detail", 400, "user_not_found")]) {
    const response = deferred<AuthApiError | null>(); let sends = 0;
    const http = transport({ send: () => { sends++; return response.promise; } });
    const form = formHarness({}, http.service); t.after(form.dispose);
    form.change("email", reader);
    const submit = form.submitHandler();
    const first = invoke(submit, { preventDefault() {} });
    const duplicate = invoke(submit, { preventDefault() {} }); form.flush();
    assert.equal(sends, 1); assert.equal(form.primary().props.disabled, true);
    response.resolve(error); await Promise.all([first, duplicate]);
    assert.match(form.copy(), /Enter your codeCheck your email for a sign-in code\./);
    assert.match(form.copy(), new RegExp(reader));
    assert.doesNotMatch(form.copy(), /Private membership detail|sent|not found|already a member/);
    assert.equal(form.focused.at(-1), "sign-in-code");
  }
});

test("existing-code entry never sends, and pasted leading zeros verify only after explicit Continue on the same origin", async (t) => {
  const http = transport(); const form = formHarness({ hasCode: true, returnPath: next, invitationId: invitation, authOrigin: "https://edisonreader.com" }, http.service); t.after(form.dispose);
  assert.match(form.copy(), /Enter your email to use the code you received\./);
  form.change("email", reader); await form.submit();
  assert.equal(http.calls.sends.length, 0);
  form.change("sign-in-code", "00 12 04");
  assert.equal(http.calls.verifies.length, 0, "paste/autofill cannot submit the form");
  assert.equal(form.input("sign-in-code").props.autoComplete, "one-time-code");
  assert.equal(form.input("sign-in-code").props.type, "text");
  await form.submit();
  assert.deepEqual(http.calls.verifies, [{ email: reader, token: "001204" }]);
  assert.equal(http.calls.commits, 1);
  assert.equal(form.assigned.length, 1);
  const destination = new URL(form.assigned[0]);
  assert.equal(destination.origin, "https://retained-alias.example.test");
  assert.equal(destination.pathname, "/auth/confirm");
  assert.equal(destination.searchParams.get("next"), next);
  assert.equal(destination.searchParams.get("invitation"), invitation);
  assert.equal(new URL(form.contexts[0].contextUrl).origin, "https://edisonreader.com", "email entry remains canonical, unlike same-origin cookie completion");
});

test("invalid code is an inline focused error and cannot trigger verification", async (t) => {
  const http = transport(); const form = formHarness({ hasCode: true }, http.service); t.after(form.dispose);
  form.change("email", reader);
  assert.equal(form.primary().props.disabled, false, "the empty code does not block the email-entry step");
  await form.submit();
  assert.equal(form.primary().props.disabled, true, "the code step starts with Continue disabled");
  for (const code of ["", " \n\t ", "123", "abcd12", "12345678901"]) {
    form.change("sign-in-code", code);
    assert.equal(form.primary().props.disabled, true, `invalid code ${JSON.stringify(code)} cannot enable Continue`);
    // Invoke the form handler directly too: Enter/programmatic submission must
    // not bypass the same validation used by the disabled submit button.
    await form.submit();
    assert.match(form.copy(), /Enter the code from your email\./);
    assert.equal(form.message().props.role, "alert");
    assert.equal(form.focused.at(-1), "sign-in-code");
  }
  assert.equal(http.calls.verifies.length, 0);
});

test("Continue preserves four-to-ten-digit compatibility, whitespace normalization, and leading zeros without auto-submit", async (t) => {
  for (const code of ["0012", "001204", "00120408", "0012040810", " \t00 12 04 08\n"]) {
    const http = transport(); const form = formHarness({ hasCode: true }, http.service); t.after(form.dispose);
    form.change("email", reader); await form.submit();
    form.change("sign-in-code", code);
    assert.equal(form.primary().props.disabled, false, `compatible code ${JSON.stringify(code)} enables Continue`);
    assert.equal(form.input("sign-in-code").props.value, code, "the input does not truncate pasted or autofilled content");
    assert.equal(form.input("sign-in-code").props.maxLength, undefined);
    assert.equal(http.calls.verifies.length, 0, "editing, paste, and autofill never verify automatically");
    await form.submit();
    assert.deepEqual(http.calls.verifies, [{ email: reader, token: code.replace(/\s/g, "") }]);
    assert.equal(http.calls.commits, 1);
    assert.equal(http.calls.sends.length, 0);
  }
});

test("clearing a valid code immediately disables Continue again", async (t) => {
  const http = transport(); const form = formHarness({ hasCode: true }, http.service); t.after(form.dispose);
  form.change("email", reader); await form.submit();
  form.change("sign-in-code", "00120408");
  assert.equal(form.primary().props.disabled, false);
  form.change("sign-in-code", "");
  assert.equal(form.primary().props.disabled, true);
  await form.submit();
  assert.equal(http.calls.verifies.length, 0);
});

test("resending preserves the code step and recipient, clears the prior code, and respects the countdown", async (t) => {
  const response = deferred<null>(); let sends = 0;
  const http = transport({ send: async () => { sends++; return sends === 1 ? null : response.promise; } });
  const form = formHarness({}, http.service); t.after(form.dispose);
  form.change("email", reader); await form.submit(); form.advance(60_000);
  form.change("sign-in-code", "001204"); form.click("Resend code");
  assert.match(form.copy(), /Enter your code/);
  assert.match(form.copy(), new RegExp(reader));
  assert.equal(form.input("sign-in-code").props.value, "");
  assert.equal(form.primary().props.disabled, true);
  assert.equal(sends, 2);
  response.resolve(null); await form.settle();
  assert.match(form.copy(), /Enter your code/);
  assert.equal(form.primary().props.disabled, true, "resend completion leaves empty-code Continue disabled");
  assert.equal(form.button("Resend in 1:00").props.disabled, true);
});

test("Change email preserves editable local email and fences a stale verification without navigation", async (t) => {
  const response = deferred<{ session: Session | null; error: AuthApiError | null }>();
  const http = transport({ verify: () => response.promise });
  const form = formHarness({ hasCode: true }, http.service); t.after(form.dispose);
  form.change("email", reader); await form.submit(); form.change("sign-in-code", "001204");
  const pending = form.submit(); form.flush(); form.click("Change email");
  assert.equal(form.input("email").props.value, reader);
  assert.equal(form.focused.at(-1), "email");
  form.change("email", "new@example.test");
  response.resolve({ session: session(reader), error: null }); await pending;
  assert.equal(form.input("email").props.value, "new@example.test");
  assert.equal(http.calls.commits, 0); assert.equal(form.assigned.length, 0);
  assert.doesNotMatch(form.copy(), /Enter your code|signed in/);
});

test("uncertain verification offers a read-only status check instead of resending or verifying again", async (t) => {
  let verifies = 0;
  const http = transport({ verify: async () => { verifies++; throw new Error("Private provider timeout"); } });
  const form = formHarness({ hasCode: true }, http.service); t.after(form.dispose);
  form.change("email", reader); await form.submit(); form.change("sign-in-code", "001204"); await form.submit();
  assert.match(form.copy(), /We couldn’t confirm whether you’re signed in\./);
  assert.doesNotMatch(form.copy(), /Private provider timeout|expired/);
  assert.equal(form.message().props.role, "status");
  assert.equal(text(form.primary()), "Check sign-in status");
  assert.equal(form.button("Resend code").props.disabled, true);
  assert.equal(form.input("sign-in-code").props.readOnly, true);
  assert.equal(form.primary().props.disabled, false);
  // Reconciliation is a session read, independent of any retained input value.
  // Exercise an empty value through the shipped handler without changing the
  // controller's unknown verification state or its read-only input contract.
  form.change("sign-in-code", "");
  assert.equal(form.primary().props.disabled, false, "an empty code cannot strand the read-only status check");
  await form.submit();
  assert.equal(http.calls.reads, 1); assert.equal(verifies, 1); assert.equal(http.calls.sends.length, 0);
  assert.equal(form.assigned.length, 0);
});
