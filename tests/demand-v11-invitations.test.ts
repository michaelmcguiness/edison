import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demandInvitationsSchema, demandWorkspaceSchema, type DemandInvitationMutation } from "@edison/contracts";
import { invitationSubmitAction, InvitationTiming, InviteFriends } from "../components/edison/demand-v11/invitations";
import { ReaderAccount } from "../components/edison/demand-v11/account";
import { clearInvitationAttempt, executeInvitationAttempt, invitationReceiptNotice, invitationStateLabel, sameInvitationRecipient, validInvitationAttempt, type InvitationAttempt, type InvitationClient } from "../components/edison/demand-v11/invitation-state";
import * as invitationState from "../components/edison/demand-v11/invitation-state";
import { definitiveResetRejection } from "../components/edison/demand-v11/reset-state";
import { invitationExpiryLabel } from "../components/auth/invitation-entry-state";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-09-07T12:00:00.000Z";
const invitation = { id: id(10), email: "reader@example.com", status: "sent" as const, createdAt: now, expiresAt: "2026-09-14T12:00:00.000Z", sentAt: now, redeemedAt: null };
const ledger = demandInvitationsSchema.parse({ limit: 5, redeemed: 1, reserved: 3, remaining: 1, invitations: [invitation] });
const operation: InvitationAttempt = { key: `invitation:${id(1)}`, kind: "send", email: "  Reader@example.com  ", invitationId: null };
const ui = readFileSync(new URL("../components/edison/demand-v11/invitations.tsx", import.meta.url), "utf8");

function clientWithCalls(calls: unknown[]): InvitationClient {
  const receipt: DemandInvitationMutation = { invitation, replayed: false, delivery: "sent" };
  return {
    getDemandInvitations: async () => { calls.push(["list"]); return ledger; },
    sendDemandInvitation: async (input) => { calls.push(["send", input]); return receipt; },
    resendDemandInvitation: async (invitationId, input) => { calls.push(["resend", invitationId, input]); return receipt; },
    revokeDemandInvitation: async (invitationId, input) => { calls.push(["revoke", invitationId, input]); return receipt; },
  };
}

test("invitation status labels distinguish admission, delivery, and acceptance", () => {
  assert.deepEqual(["pending", "sending", "sent", "failed", "expired", "revoked", "redeemed"].map((status) => invitationStateLabel(status as typeof invitation.status)), ["Delivery unconfirmed", "Confirming send…", "Pending", "Not sent", "Expired", "Revoked", "Accepted"]);
});

test("normalized invitation form action prioritizes unresolved attempts, then known active recipients", () => {
  const email = "  READER@example.COM  ";
  assert.equal(invitationSubmitAction(email, [{ ...invitation, status: "sending" }], null).kind, "check");
  for (const status of ["sent", "pending"] as const) {
    const action = invitationSubmitAction(email, [{ ...invitation, status }], null);
    assert.equal(action.kind, "resend");
    assert.equal(action.invitation?.id, invitation.id);
    if (status === "pending") assert.equal(invitationStateLabel(status), "Delivery unconfirmed", "manual resend readiness must not imply an active delivery check");
  }
  for (const status of ["expired", "revoked", "failed", "redeemed"] as const) {
    assert.equal(invitationSubmitAction(email, [{ ...invitation, status }], null).kind, "send");
  }
  assert.equal(invitationSubmitAction("another@example.com", [invitation], null).kind, "send");
  const recovery = invitationSubmitAction("a newer unfinished draft", [invitation], operation);
  assert.equal(recovery.kind, "recover");
  assert.equal(recovery.attempt, operation);
  assert.equal(recovery.label, "Check status");
});

type ConstructedNode = { type: unknown; props: Record<string, unknown> };
function invitationFormHarness(email: string, data: typeof ledger, client: InvitationClient, attempt: InvitationAttempt | null = null) {
  const states: unknown[] = [email, attempt, data, "ready", false, "", "", null];
  let stateIndex = 0;
  const exports: { InviteFriends?: (props: { workspaceId: string; client: InvitationClient }) => ConstructedNode } = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  new Script(ts.transpileModule(ui, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)
    .runInNewContext({ exports, crypto, localStorage: { getItem: () => null, setItem() {} }, require(name: string) {
      if (name === "react") return { useState: () => { const slot = stateIndex++; return [states[slot], (value: unknown) => { states[slot] = value; }]; },
        useRef: (current: unknown) => ({ current }), useEffect() {}, useCallback: (value: unknown) => value, useId: () => "constructed-form" };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./invitation-state") return invitationState;
      if (name === "./reset-state") return { definitiveResetRejection };
      if (name === "@/components/auth/invitation-entry-state") return { invitationExpiryLabel };
      throw new Error(`Unexpected invitation UI dependency: ${name}`);
    } });
  const tree = exports.InviteFriends!({ workspaceId: id(99), client });
  const form = (tree.props.children as Array<ConstructedNode | null>).find((node) => node?.type === "form")!;
  assert.ok(form);
  const button = (form.props.children as ConstructedNode[]).find((node) => node.type === "button")!;
  return { form, button, states, submit: () => (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} }) };
}
const settleForm = async () => { for (let step = 0; step < 8; step++) await Promise.resolve(); };

test("primary submit and Enter only check a known sending recipient and synchronously suppress duplicates", async () => {
  const calls: unknown[] = [];
  const client = clientWithCalls(calls);
  let resolve!: (value: typeof ledger) => void;
  client.getDemandInvitations = () => { calls.push(["list"]); return new Promise((done) => { resolve = done; }); };
  const pendingLedger = { ...ledger, invitations: [{ ...invitation, status: "sending" as const }] };
  const form = invitationFormHarness("  READER@example.COM  ", pendingLedger, client);
  assert.equal(form.button.props.children, "Check status");
  assert.equal(form.button.props.disabled, false);
  form.submit(); form.submit();
  assert.deepEqual(calls, [["list"]]);
  resolve(pendingLedger); await settleForm();
  assert.equal(form.states[0], "  READER@example.COM  ");
  assert.equal(form.states[4], false);
});

test("primary submit and Enter resend the same known invitation even when no new slots remain", async () => {
  for (const status of ["sent", "pending"] as const) {
    const calls: unknown[] = [];
    const form = invitationFormHarness("reader@EXAMPLE.com", { ...ledger, redeemed: 4, reserved: 1, remaining: 0, invitations: [{ ...invitation, status }] }, clientWithCalls(calls));
    assert.equal(form.button.props.children, "Resend invitation");
    form.submit(); form.submit(); await settleForm();
    assert.equal((calls[0] as unknown[])[0], "resend");
    assert.equal((calls[0] as unknown[])[1], invitation.id);
    assert.equal(calls.filter((call) => (call as unknown[])[0] === "resend").length, 1);
    assert.equal(calls.some((call) => (call as unknown[])[0] === "send"), false);
    assert.equal(form.states[0], "reader@EXAMPLE.com");
  }
});

test("Enter replays an unresolved operation despite a newer draft, while unrelated recipients remain new sends", async () => {
  const calls: unknown[] = [];
  const form = invitationFormHarness("newer unfinished draft", ledger, clientWithCalls(calls), operation);
  assert.equal(form.button.props.children, "Check status");
  assert.equal(form.form.props.noValidate, true, "recovery must not be blocked by the newer draft’s email validation");
  form.submit(); form.submit(); await settleForm();
  assert.deepEqual(calls[0], ["send", { email: operation.email, idempotencyKey: operation.key }]);
  assert.equal(calls.filter((call) => (call as unknown[])[0] === "send").length, 1);
  assert.equal(form.states[0], "newer unfinished draft");
  const otherCalls: unknown[] = [];
  const other = invitationFormHarness("another@example.com", { ...ledger, invitations: [{ ...invitation, status: "sending" }] }, clientWithCalls(otherCalls));
  assert.equal(other.button.props.children, "Send invitation");
  assert.equal(other.form.props.noValidate, false);
  other.submit(); await settleForm();
  assert.equal((otherCalls[0] as unknown[])[0], "send");
  assert.equal(((otherCalls[0] as unknown[])[1] as { email: string }).email, "another@example.com");
});

test("invitation rows show actual expiry with date, time and timezone rather than creation date", () => {
  for (const status of ["pending", "sending", "sent", "expired"] as const) {
    const html = renderToStaticMarkup(createElement(InvitationTiming, { invitation: { ...invitation, status } }));
    assert.match(html, new RegExp(`<small>${status === "expired" ? "Expired" : "Expires"} `));
    assert.match(html, /dateTime="2026-09-14T12:00:00.000Z"/);
    assert.match(html, /September 14, 2026.*12:00.*UTC/);
    assert.doesNotMatch(html, /September 7/);
  }
  assert.match(ui, /<InvitationTiming invitation=\{invitation\} \/>/);
  const css = readFileSync(new URL("../app/demand.css", import.meta.url), "utf8");
  assert.match(css, /\.demand-invitation-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.demand-invitation-row > small \{[^}]*grid-column: 1\/-1/);
});

test("accepted invitation date stays acceptance, not expiry, and closed links do not promise validity", () => {
  const acceptedAt = "2026-09-08T16:35:00.000Z";
  const accepted = renderToStaticMarkup(createElement(InvitationTiming, { invitation: { ...invitation, status: "redeemed", redeemedAt: acceptedAt } }));
  assert.match(accepted, /<small>Accepted /);
  assert.match(accepted, /September 8, 2026.*4:35.*UTC/);
  assert.match(accepted, /dateTime="2026-09-08T16:35:00.000Z"/);
  assert.doesNotMatch(accepted, /Expire/);
  assert.equal(renderToStaticMarkup(createElement(InvitationTiming, { invitation: { ...invitation, status: "redeemed", redeemedAt: null } })), "");
  for (const status of ["failed", "revoked"] as const) {
    const html = renderToStaticMarkup(createElement(InvitationTiming, { invitation: { ...invitation, status } }));
    assert.match(html, /<small>Created /);
    assert.doesNotMatch(html, /Expire/);
  }
});

test("send and resend confirmations use operation delivery, never the original invitation status", () => {
  const receipt: DemandInvitationMutation = { invitation, replayed: false, delivery: "sent" };
  assert.equal(invitationReceiptNotice("send", receipt).text, "Invitation sent.");
  assert.equal(invitationReceiptNotice("resend", receipt).text, "Invitation resent.");
  for (const delivery of ["failed", "unknown"] as const) {
    const notice = invitationReceiptNotice("resend", { ...receipt, delivery });
    assert.equal(notice.error, true);
    assert.match(notice.text, /couldn’t confirm the resend/);
    assert.doesNotMatch(notice.text, /still available|resent\./);
  }
  assert.equal(invitationReceiptNotice("send", { ...receipt, delivery: "not_attempted" }).text, "Invitation confirmed. Resend is available below.");
  assert.match(invitationReceiptNotice("send", { ...receipt, delivery: "failed", invitation: { ...invitation, status: "failed" } }).text, /still available/);
  assert.equal(invitationReceiptNotice("revoke", { ...receipt, delivery: "not_attempted", invitation: { ...invitation, status: "redeemed", redeemedAt: now } }).text, "This invitation was already accepted.");
  assert.equal(invitationReceiptNotice("send", { ...receipt, replayed: true, invitation: { ...invitation, status: "revoked" } }).text, "Invitation revoked.");
});

test("interrupted send replays the exact recipient and key; resend and revoke retain the same invitation", async () => {
  const calls: unknown[] = [];
  const client = clientWithCalls(calls);
  await executeInvitationAttempt(client, operation);
  await executeInvitationAttempt(client, JSON.parse(JSON.stringify(operation)));
  assert.deepEqual(calls, [["send", { email: operation.email, idempotencyKey: operation.key }], ["send", { email: operation.email, idempotencyKey: operation.key }]]);
  await executeInvitationAttempt(client, { ...operation, kind: "resend", invitationId: invitation.id });
  await executeInvitationAttempt(client, { ...operation, kind: "revoke", invitationId: invitation.id });
  assert.deepEqual(calls.slice(2), [["resend", invitation.id, { idempotencyKey: operation.key }], ["revoke", invitation.id, { idempotencyKey: operation.key }]]);
  assert.equal(ledger.remaining, 1, "client dispatch never mutates ledger counts");
});

test("invitation recovery rejects malformed operations and does not persist unrelated private data", () => {
  assert.equal(validInvitationAttempt(operation), true);
  assert.equal(validInvitationAttempt({ ...operation, invitationId: invitation.id }), false);
  assert.equal(validInvitationAttempt({ ...operation, kind: "resend" }), false);
  assert.equal(validInvitationAttempt({ ...operation, key: "not-an-operation" }), false);
  assert.equal(validInvitationAttempt({ ...operation, articleTitle: "must not persist" }), false);
  assert.equal(validInvitationAttempt({ ...operation, email: " " }), false);
  assert.equal(sameInvitationRecipient("  Reader@example.com ", "reader@EXAMPLE.com"), true);
  assert.equal(sameInvitationRecipient("reader@example.com", "another@example.com"), false);
});

for (const outcome of ["success", "rejection"] as const) test(`late invitation A ${outcome} cannot clear remounted B`, async () => {
  const data = new Map([["scoped", JSON.stringify(operation)]]);
  const storage = () => ({ getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } });
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const response = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const completion = response.then(() => clearInvitationAttempt("scoped", operation.key, storage), () => clearInvitationAttempt("scoped", operation.key, storage));
  assert.equal(clearInvitationAttempt("scoped", operation.key, storage), true);
  const newer = { ...operation, key: `invitation:${id(2)}`, email: "new-draft@example.com" };
  data.set("scoped", JSON.stringify(newer));
  if (outcome === "success") resolve(); else reject(new Error("Old response"));
  assert.equal(await completion, false);
  assert.deepEqual(JSON.parse(data.get("scoped")!), newer);
});

test("denied device storage never turns a confirmed invitation operation into an unknown result", () => {
  assert.equal(clearInvitationAttempt("scoped", operation.key, () => { throw new Error("Storage denied"); }), false);
  assert.doesNotThrow(() => clearInvitationAttempt("scoped", operation.key, () => ({ getItem: () => "broken json", removeItem: () => {} })));
});

test("Account exposes Invite friends between usage and privacy without inventing an unloaded balance", () => {
  const client = clientWithCalls([]);
  const html = renderToStaticMarkup(createElement(InviteFriends, { workspaceId: id(99), client }));
  assert.match(html, /Loading invitations/);
  assert.doesNotMatch(html, /[0-5] invites? left/);
  assert.match(html, /type="email"/);
  assert.match(html, /autoComplete="email"/);
  assert.doesNotMatch(html, /autofocus/i);
  assert.match(html, /Each invitation is for one person/);
  const workspace = demandWorkspaceSchema.parse({ workspaceId: id(99), readerKind: "account", loops: [], ideas: [], requests: [] });
  const account = renderToStaticMarkup(createElement(ReaderAccount, { workspace, getIdentity: async () => null, signOut: async () => {}, onBack: () => {}, onReading: () => {}, onAllowance: () => {}, invitationsClient: client }));
  assert.match(account, /value="usage">Plan &amp; usage<\/option><option value="invites">Invite friends<\/option><option value="privacy">Data &amp; privacy/);
  assert.ok(account.split("Invite friends").length >= 4, "Profile contains a discoverable section link too");
  assert.doesNotMatch(account, /Create account|Start a free loop|waitlist/i);
});

test("UI reads canonical slots, preserves unknown operation identity, and requires explicit new invitations", () => {
  assert.match(ui, /data\.remaining/);
  assert.match(ui, /const result = await executeInvitationAttempt\(client, operation\)/);
  assert.match(ui, /await refresh\(\)/);
  assert.match(ui, /recover \? attemptRef\.current/);
  assert.match(ui, /if \(lock\.current \|\| \(attemptRef\.current && !recover\)\) return/);
  assert.match(ui, /clearInvitationAttempt\(operationKey, operation\.key\)/);
  assert.match(ui, /if \(!mounted\.current\) return/);
  assert.match(ui, /ownsStorage && sameInvitationRecipient/);
  assert.doesNotMatch(ui, /remaining\s*[-+]\s*1|remaining:\s*[05]|already a member|per week/i);
  assert.match(ui, /Send new invitation/);
  assert.match(ui, /invitation\.status !== "redeemed"/);
  assert.match(ui, /All \{data\.limit\} invites are pending or have been accepted/);
  assert.match(ui, /Resending…/);
  assert.match(ui, /invitation\.status === "sent" \|\| invitation\.status === "pending"/, "expired unknown delivery lease has explicit same-slot resend and revoke");
  assert.match(ui, /keepInvitation\.current\?\.focus/);
});

test("D44 member-only share copy preserves deliberate link creation and true copy success", () => {
  const share = readFileSync(new URL("../components/edison/demand-v10/share-panel.tsx", import.meta.url), "utf8");
  assert.match(share, /Edison members with this link/);
  assert.match(share, /Create article link/);
  assert.doesNotMatch(share, /Anyone with this link|Create public link|public, read-only/);
  assert.match(share, /await copyReaderShare\(link, navigator\.clipboard\); setMessage\("Link copied\."\)/);
  assert.match(share, /await navigator\.share/);
});
