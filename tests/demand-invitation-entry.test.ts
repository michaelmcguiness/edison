import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { uuidSchema } from "@edison/contracts";
import * as entry from "../components/auth/invitation-entry-state";
import * as continuation from "../lib/demand-auth-continuation";
import * as acceptance from "../lib/invitation-acceptance";
import { AcceptanceForm } from "../components/auth/acceptance-form";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const path = `/articles/${id(3)}`;
const other = `/s/demand/${"b".repeat(64)}`;
const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("acceptance destination expires, rejects stale/raw/hostile values, and never overrides explicit context", () => {
  const device = storage();
  entry.rememberAuthReturn(path, () => device, 1000);
  assert.equal(entry.readAuthReturn(() => device, 1001), path);
  assert.equal(entry.acceptanceDestination(other, path), other);
  assert.equal(entry.acceptanceDestination("/", path), path);
  assert.equal(entry.readAuthReturn(() => device, 1000 + 30 * 60_000 + 1), "/");
  assert.equal(device.values.size, 0);
  for (const raw of [path, JSON.stringify({ path: "//evil.example", createdAt: 1000 }), JSON.stringify({ path, createdAt: 2000 }), JSON.stringify({ path, createdAt: 1000, email: "not stored" })]) {
    device.setItem(entry.authReturnStorageKey, raw);
    assert.equal(entry.readAuthReturn(() => device, 1001), "/");
    assert.equal(device.values.size, 0);
  }
  entry.rememberAuthReturn("https://evil.example", () => device, 1000);
  assert.equal(device.values.size, 0);
  assert.equal(entry.readAuthReturn(() => { throw new Error("Device access denied"); }), "/");
  assert.doesNotThrow(() => entry.rememberAuthReturn(path, () => { throw new Error("Device access denied"); }));
});

test("accepted-return cleanup does not erase a newer destination", () => {
  const device = storage();
  entry.rememberAuthReturn(other, () => device);
  entry.clearAuthReturn(path, () => device);
  assert.equal(entry.readAuthReturn(() => device), other);
  entry.clearAuthReturn(other, () => device);
  assert.equal(device.values.size, 0);
});

test("resend pacing survives remount and cannot be bypassed while the prior request is pending", () => {
  const device = storage();
  device.setItem(entry.signInRetryStorageKey, String(1000 + entry.signInRetryDelayMs));
  assert.equal(entry.readSignInRetryAt(() => device, 1001), 61_000);
  assert.equal(entry.signInAttemptAllowed(false, 61_000, 60_999), false);
  assert.equal(entry.signInAttemptAllowed(false, 61_000, 61_000), true);
  assert.equal(entry.signInAttemptAllowed(true, 61_000, 62_000), false);
  assert.equal(entry.readSignInRetryAt(() => device, 61_001), 0);
  device.setItem(entry.signInRetryStorageKey, "Infinity");
  assert.equal(entry.readSignInRetryAt(() => device, 1001), 0);
  assert.equal(entry.readSignInRetryAt(() => { throw new Error("Storage denied"); }), 0);
});

test("retained production aliases send callback to the canonical apex with the same safe destination", () => {
  const callback = new URL(entry.signInCallbackUrl(path, "https://project-qlqve.vercel.app", "https://edisonreader.com"));
  assert.equal(callback.origin, "https://edisonreader.com");
  assert.equal(callback.pathname, "/auth/confirm");
  assert.equal(callback.searchParams.get("next"), path);
  assert.equal(new URL(entry.signInCallbackUrl(path, "http://localhost:4310")).origin, "http://localhost:4310");
  assert.equal(new URL(entry.signInCallbackUrl("//evil.example", "https://edisonreader.com")).searchParams.get("next"), "/");
  assert.throws(() => entry.signInCallbackUrl(path, "https://edisonreader.com", "https://evil.example"));
  const renewed = new URL(entry.signInCallbackUrl(path, "https://project-qlqve.vercel.app", "https://edisonreader.com", id(1)));
  assert.equal(renewed.searchParams.get("invitation"), id(1));
  assert.equal(renewed.searchParams.get("next"), path);
  assert.throws(() => entry.signInCallbackUrl(path, "https://edisonreader.com", undefined, "malformed"));
  assert.match(source("app/login/page.tsx"), /authOrigin=\{process.env.NODE_ENV === "production" \? "https:\/\/edisonreader.com"/);
});

test("terminal expiry, unavailable and wrong-account states cannot offer acceptance even with retry query", () => {
  for (const preview of ["expired", "unavailable", "wrong_account"] as const) assert.equal(entry.acceptanceView({ hasContext: true, invitation: true, preview, error: "unconfirmed" }).action, null);
  assert.equal(entry.acceptanceView({ hasContext: true, invitation: true, preview: "available", error: "expired" }).action, null);
  assert.match(entry.acceptanceView({ hasContext: true, invitation: true, preview: "available", error: "expired" }).title, /sign-in link has expired/);
  assert.equal(entry.acceptanceView({ hasContext: false, invitation: true, preview: "accepted" }).action, null);
  assert.equal(entry.acceptanceView({ hasContext: true, invitation: true, preview: "available", error: "accepted" }).action, "accept", "query strings are not proof of acceptance");
  assert.equal(entry.acceptanceView({ hasContext: true, invitation: true, preview: "accepted", error: "unconfirmed" }).action, "continue");
  assert.equal(entry.acceptanceView({ hasContext: true, invitation: true, preview: "unconfirmed", error: "expired" }).action, "refresh", "unknown invitation status after OTP expiry is a read-only status check");
});

test("fresh invitation expiry, revocation and wrong-account state outrank stale Auth-link expiry", () => {
  for (const [preview, title] of [["expired", "This invitation has expired."], ["unavailable", "This invitation is no longer available."], ["wrong_account", "Use the email this invitation was sent to."]] as const) {
    const view = entry.acceptanceView({ hasContext: true, invitation: true, preview, error: "expired" });
    assert.equal(view.title, title);
    assert.equal(view.action, null);
    assert.doesNotMatch(view.message, /new sign-in link|same invitation/);
  }
});

test("ordinary email sign-in and invitation recovery use truthful distinct copy", () => {
  const normal = entry.acceptanceView({ hasContext: true, invitation: false, preview: "available" });
  assert.equal(normal.action, "signin");
  assert.doesNotMatch(normal.title + normal.message, /invitation|invited/);
  assert.match(entry.acceptanceView({ hasContext: true, invitation: false, preview: "available", error: "expired" }).title, /sign-in link has expired/);
  assert.equal(entry.acceptanceView({ hasContext: true, invitation: true, preview: "unconfirmed" }).action, "recover");
  assert.match(entry.invitationExpiryLabel("2026-09-14T12:00:00Z")!, /September 14, 2026.*12:00.*UTC/);
  assert.equal(entry.invitationExpiryLabel("bad timestamp"), null);
});

async function page(preview: entry.AcceptancePreview, error?: string, ordinary = false) {
  const context = { nonce: id(2), tokenHash: "a".repeat(64), type: ordinary ? "email" : "invite", invitationId: ordinary ? null : id(1), returnPath: path, createdAt: Date.now() };
  const calls: string[] = [];
  const exports: { default?: (input: { searchParams: Promise<{ error?: string }> }) => Promise<ReactNode> } = {};
  const compiled = ts.transpileModule(source("app/auth/accept/page.tsx"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Script(compiled).runInNewContext({ exports, process: { env: { NODE_ENV: "production" } }, require(name: string) {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link") return { default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) };
    if (name === "next/headers") return { cookies: async () => ({ get: () => ({ value: Buffer.from(JSON.stringify(context)).toString("base64url") }) }) };
    if (name === "@/components/edison/brand") return { EdisonMark: () => null };
    if (name === "@/components/auth/acceptance-form") return { AcceptanceForm };
    if (name === "@/components/auth/invitation-entry-state") return entry;
    if (name === "@/lib/invitation-acceptance") return acceptance;
    if (name === "@/lib/demand-auth-continuation") return continuation;
    if (name === "@/lib/member-access") return { readInvitationAcceptance: async (value: string) => { calls.push(value); return preview; } };
    if (name.endsWith(".css")) return {};
    throw new Error(name);
  } });
  assert.ok(exports.default);
  return { html: renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({ error }) })), calls };
}

test("actual acceptance page reconciles verified acceptance without POST or token exposure", async () => {
  const result = await page({ state: "accepted" }, "unconfirmed");
  assert.match(result.html, /Continue to reading/);
  assert.match(result.html, new RegExp(`href="${path}"`));
  assert.doesNotMatch(result.html, /method="post"|name="nonce"|tokenHash|token_hash/);
  assert.deepEqual(result.calls, [id(1)]);
});

test("actual page preserves exact nonce on unknown outcome and hides expired OTP submission", async () => {
  const unknown = await page({ state: "unconfirmed" }, "unconfirmed");
  assert.match(unknown.html, /action="\/auth\/confirm" method="post"/);
  assert.match(unknown.html, new RegExp(`name="nonce" value="${id(2)}"`));
  assert.match(unknown.html, /Check status/);
  const expired = await page({ state: "available", maskedEmail: "r***@example.test", expiresAt: "2026-09-14T12:00:00Z" }, "expired");
  assert.doesNotMatch(expired.html, /action="\/auth\/confirm"|Accept invitation/);
  assert.match(expired.html, /Get new sign-in link/);
  assert.match(expired.html, new RegExp(`invitation=${id(1)}`));
  assert.doesNotMatch(expired.html, /send a new invitation|resend your invitation/);
  assert.match(expired.html, /Invitation expires September 14, 2026/);
  const unknownExpired = await page({ state: "unconfirmed" }, "expired");
  assert.match(unknownExpired.html, /href="\/auth\/accept\?error=expired">Check status/);
  assert.doesNotMatch(unknownExpired.html, /action="\/auth\/confirm"|Accept invitation|Get new sign-in link/);
  const wrong = await page({ state: "wrong_account" });
  assert.doesNotMatch(wrong.html, /action="\/auth\/confirm"|r\*\*\*@|Accept invitation/);
  assert.match(wrong.html, /Use another account/);
  assert.match(wrong.html, /name="next" value="\/auth\/accept"/);
  const normal = await page({ state: "available" }, undefined, true);
  assert.match(normal.html, /Continue signing in/);
  assert.doesNotMatch(normal.html, /received this invitation|Accept invitation/);
  assert.equal(normal.calls.length, 0);
});

test("actual page uses current terminal or wrong-account invitation recovery after Auth-link expiry", async () => {
  for (const [state, title] of [["expired", "This invitation has expired."], ["unavailable", "This invitation is no longer available."], ["wrong_account", "Use the email this invitation was sent to."]] as const) {
    const result = await page({ state }, "expired");
    assert.ok(result.html.includes(`<h1>${title}</h1>`));
    assert.doesNotMatch(result.html, /Get new sign-in link|same invitation|action="\/auth\/confirm"|Accept invitation/);
    assert.match(result.html, /Already a member\? Sign in/);
    if (state === "wrong_account") {
      assert.match(result.html, /Use another account/);
      assert.match(result.html, /name="next" value="\/auth\/accept"/);
    }
  }
});

test("login source exposes explicit controlled resend, no signup/provider-detail branch, and usable errors", () => {
  const login = source("components/auth/login-form.tsx");
  assert.match(login, /shouldCreateUser: false/);
  assert.doesNotMatch(login, /Signups not allowed|error\.message|allowSignUp|shouldCreateUser: true/);
  assert.match(login, /We couldn’t complete that request\. Please try again\./);
  assert.match(login, /Resend sign-in link/);
  assert.match(login, /signInAttemptAllowed\(sending.current, nextAttemptAt.current\)/);
  assert.match(login, /emailInput.current\?\.focus/);
  assert.match(login, /aria-describedby=\{message \? "sign-in-message"/);
  assert.doesNotMatch(login, /autoFocus/);
  assert.match(source("components/auth/acceptance-form.tsx"), /addEventListener\("pageshow", restore\)/);
});

type AuthFailure = { code?: string; status?: number; message?: string } | null;
type AuthReply = { error: AuthFailure };
function loginHarness(otp: () => Promise<AuthReply>, resend: () => Promise<AuthReply>, invited = true) {
  const calls: Array<{ method: string; input: { email: string; options: { emailRedirectTo: string; shouldCreateUser?: boolean }; type?: string } }> = [];
  const states: unknown[] = [" reader@example.test ", "idle", "", 0];
  let stateIndex = 0;
  const exports: { LoginForm?: (props: { returnPath: string; authOrigin: string; invitationId?: string }) => { props: { onSubmit: (event: { preventDefault: () => void }) => Promise<void> } } } = {};
  const compiled = ts.transpileModule(source("components/auth/login-form.tsx"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Script(compiled).runInNewContext({ exports, window: { location: { origin: "https://project-qlqve.vercel.app" } }, require(name: string) {
    if (name === "react") return { useState: () => { const slot = stateIndex++; return [states[slot], (value: unknown) => { states[slot] = value; }]; }, useRef: (value: unknown) => ({ current: value }), useEffect() {} };
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "lucide-react") return { ArrowRight: () => null, Check: () => null, LoaderCircle: () => null };
    if (name === "./invitation-entry-state") return entry;
    if (name === "@/lib/supabase/client") return { createClient: () => ({ auth: {
      signInWithOtp: (input: typeof calls[number]["input"]) => { calls.push({ method: "otp", input }); return otp(); },
      resend: (input: typeof calls[number]["input"]) => { calls.push({ method: "resend", input }); return resend(); },
    } }) };
    throw new Error(name);
  } });
  assert.ok(exports.LoginForm);
  const form = exports.LoginForm({ returnPath: path, authOrigin: "https://edisonreader.com", invitationId: invited ? id(1) : undefined });
  return { calls, states, submit: () => form.props.onSubmit({ preventDefault() {} }) };
}

test("actual form renews only definitive unconfirmed-account signup_disabled without creating another invitation", async () => {
  let resolveOtp!: (value: AuthReply) => void;
  let resolveResend!: (value: AuthReply) => void;
  const pendingOtp = new Promise<AuthReply>((resolve) => { resolveOtp = resolve; });
  const pendingResend = new Promise<AuthReply>((resolve) => { resolveResend = resolve; });
  const ui = loginHarness(() => pendingOtp, () => pendingResend);
  const first = ui.submit(); await ui.submit();
  assert.equal(ui.calls.length, 1);
  resolveOtp({ error: { code: "signup_disabled", status: 422, message: "Must not expose provider detail" } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ui.calls.length, 2);
  await ui.submit(); assert.equal(ui.calls.length, 2, "the fallback retains the synchronous submission lock");
  const initial = ui.calls[0].input, fallback = ui.calls[1].input;
  assert.equal(initial.options.shouldCreateUser, false);
  assert.equal(fallback.type, "signup");
  assert.equal(fallback.email, initial.email);
  assert.equal(fallback.options.emailRedirectTo, initial.options.emailRedirectTo);
  const callback = new URL(fallback.options.emailRedirectTo);
  assert.equal(callback.origin, "https://edisonreader.com");
  assert.equal(callback.searchParams.get("invitation"), id(1));
  assert.equal(callback.searchParams.get("next"), path);
  resolveResend({ error: null }); await first;
  assert.equal(ui.states[1], "sent");
  assert.match(String(ui.states[2]), /^If this email can access Edison/);
  await ui.submit(); assert.equal(ui.calls.length, 2, "the same request cannot bypass resend pacing after success");
});

test("OTP unknown, throttle, different errors, and ordinary login cannot fall back to another send", async () => {
  for (const failure of [{ code: "otp_disabled", status: 422 }, { code: "over_email_send_rate_limit", status: 429 }, { code: "signup_disabled", status: 503 }, { message: "Signups not allowed", status: 422 }]) {
    const ui = loginHarness(async () => ({ error: failure }), async () => { throw new Error("Must not resend"); });
    await ui.submit(); assert.equal(ui.calls.length, 1); assert.equal(ui.states[1], "error");
    assert.equal(ui.states[2], "We couldn’t complete that request. Please try again.");
  }
  const unknown = loginHarness(async () => { throw new Error("Connection lost"); }, async () => { throw new Error("Must not resend"); });
  await unknown.submit(); assert.equal(unknown.calls.length, 1);
  const ordinary = loginHarness(async () => ({ error: { code: "signup_disabled", status: 422 } }), async () => { throw new Error("Must not resend"); }, false);
  await ordinary.submit(); assert.equal(ordinary.calls.length, 1);
});

async function loginPage(preview: entry.AcceptancePreview, invitation: string | string[], session = "signed_out") {
  const calls: string[] = [];
  const exports: { default?: (input: { searchParams: Promise<{ invitation: string | string[]; next: string }> }) => Promise<ReactNode> } = {};
  const compiled = ts.transpileModule(source("app/login/page.tsx"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Script(compiled).runInNewContext({ exports, process: { env: { NODE_ENV: "production" } }, require(name: string) {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/navigation") return { redirect: (destination: string) => { throw new Error(`redirect:${destination}`); } };
    if (name === "next/link") return { default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) };
    if (name === "@edison/contracts") return { uuidSchema };
    if (name === "@/components/edison/brand") return { EdisonMark: () => null };
    if (name === "@/components/auth/login-form") return { LoginForm: (props: { invitationId?: string; returnPath: string; authOrigin?: string }) => createElement("form", { "data-invitation": props.invitationId ?? "none", "data-return": props.returnPath, "data-auth-origin": props.authOrigin }) };
    if (name === "@/lib/supabase/env") return { isSupabaseConfigured: () => true };
    if (name === "@/lib/app-mode") return { isDemoMode: () => false };
    if (name === "@/lib/demand-auth-continuation") return continuation;
    if (name === "@/lib/member-access") return { readMemberSession: async () => ({ status: session }), readInvitationAcceptance: async (value: string) => { calls.push(value); return preview; } };
    if (name.endsWith(".css")) return {};
    throw new Error(name);
  } });
  assert.ok(exports.default);
  return { html: renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({ invitation, next: path }) })), calls };
}

test("actual renewal login requires a validated available invitation and retains wrong-account return context", async () => {
  const allowed = await loginPage({ state: "available" }, id(1), "invite_required");
  assert.match(allowed.html, /Get a new sign-in link/);
  assert.match(allowed.html, new RegExp(`data-invitation="${id(1)}"`));
  assert.match(allowed.html, /data-auth-origin="https:\/\/edisonreader.com"/);
  assert.deepEqual(allowed.calls, [id(1)]);
  for (const state of ["expired", "unavailable", "unconfirmed", "wrong_account"] as const) {
    const denied = await loginPage({ state }, id(1));
    assert.doesNotMatch(denied.html, /data-invitation=/);
    if (state === "wrong_account") {
      assert.match(denied.html, new RegExp(`name="invitation" value="${id(1)}"`));
      assert.match(denied.html, new RegExp(`name="next" value="${path}"`));
    }
  }
  const malformed = await loginPage({ state: "available" }, "bad-id");
  assert.equal(malformed.calls.length, 0);
  assert.doesNotMatch(malformed.html, /data-invitation=/);
});
