import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demandWorkspaceSchema } from "@edison/contracts";
import { canContinueDemandAccount, DemandStartupFailure, runDemandAccountRecovery } from "../components/edison/demand-reader";
import { DemandClientError } from "../lib/demand-client";

const workspace = demandWorkspaceSchema.parse({ workspaceId: "00000000-0000-4000-8000-000000000001", readerKind: "account", loops: [], ideas: [], requests: [] });

test("account recovery is restricted to the three confirmed earlier-browser-session failures", () => {
  for (const code of ["guest_session_invalid", "reading_session_expired", "guest_already_claimed"]) {
    assert.equal(canContinueDemandAccount(new DemandClientError({ code, status: 401, message: "Constructed failure" })), true);
  }
  for (const code of ["invitation_required", "alpha_access_required", "session_unavailable", "reading_claim_required", "network_error"]) {
    assert.equal(canContinueDemandAccount(new DemandClientError({ code, status: 401, message: "Constructed failure" })), false);
  }
  assert.equal(canContinueDemandAccount({ code: "guest_session_invalid" }), false);
  assert.equal(canContinueDemandAccount(new Error("guest_session_invalid")), false);
});

test("failed startup offers explicit account continuation and retained retry without a discard promise", () => {
  let calls = 0;
  const props = { error: "", canContinueAccount: true, pending: false, onContinueAccount: () => { calls++; }, onRetry: () => {} };
  const html = renderToStaticMarkup(createElement(DemandStartupFailure, props));
  assert.match(html, /This browser’s earlier reading couldn’t be attached/);
  assert.match(html, /Your account’s reading is still available/);
  assert.match(html, /Continue with my account/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /discard|delete|reset|another account|@/i);
  assert.equal(calls, 0, "rendering cannot initiate account recovery");
  const pending = renderToStaticMarkup(createElement(DemandStartupFailure, { ...props, pending: true }));
  assert.match(pending, /Opening your account…/);
  assert.equal((pending.match(/disabled=""/g) ?? []).length, 2);
  const ordinary = renderToStaticMarkup(createElement(DemandStartupFailure, { ...props, canContinueAccount: false, error: "Please try later." }));
  assert.doesNotMatch(ordinary, /Continue with my account|earlier reading/);
  assert.match(ordinary, /role="alert">Please try later/);
});

test("explicit account recovery prevents synchronous duplicates and restores the exact returned workspace once", async () => {
  const lock = { current: false };
  let finish!: (value: typeof workspace) => void;
  const response = new Promise<typeof workspace>((resolve) => { finish = resolve; });
  let starts = 0;
  const restored: unknown[] = [];
  const start = () => { starts++; return response; };
  const restore = async (value: typeof workspace) => { restored.push(value); };
  const first = runDemandAccountRecovery(lock, start, restore);
  await runDemandAccountRecovery(lock, start, restore);
  assert.equal(starts, 1);
  assert.deepEqual(restored, []);
  assert.equal(lock.current, true);
  finish(workspace);
  await first;
  assert.equal(restored[0], workspace, "recovery does not fabricate or merge an earlier owner’s workspace");
  assert.equal(restored.length, 1);
  assert.equal(lock.current, false);
});

test("unknown account-session outcomes never restore guessed reading and remain explicitly retryable", async () => {
  const lock = { current: false };
  let restored = 0;
  const failure = new Error("Constructed interrupted response");
  await assert.rejects(runDemandAccountRecovery(lock, async () => { throw failure; }, async () => { restored++; }), failure);
  assert.equal(restored, 0);
  assert.equal(lock.current, false);
  await runDemandAccountRecovery(lock, async () => workspace, async () => { restored++; });
  assert.equal(restored, 1);
});

test("startup wiring leaves normal session admission unchanged and only the explicit control selects account recovery", () => {
  const source = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  assert.match(source, /client\.startDemandSession\(\)\.then\(restore\)/);
  const action = source.slice(source.indexOf("const continueWithAccount = async"), source.indexOf("accountRecoveryAction.current = continueWithAccount"));
  assert.match(action, /!accountRecoveryAllowed.current \|\| accountRecoveryLock.current/);
  assert.match(action, /runDemandAccountRecovery\(accountRecoveryLock, client.startDemandAccountSession, restore\)/);
  assert.match(action, /We couldn’t confirm your account session/);
  assert.doesNotMatch(action, /localStorage|sessionStorage|document\.cookie|removeItem|location\.|setWorkspace/);
  assert.match(source, /onContinueAccount=\{\(\) => \{ void accountRecoveryAction.current\?\.\(\); \}\}/);
  assert.match(source, /accountRecoveryAllowed.current = false;\s+setCanContinueAccount\(false\)/);
});
