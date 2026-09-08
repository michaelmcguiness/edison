import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demandInvitationsSchema, demandWorkspaceSchema, type DemandInvitationMutation } from "@edison/contracts";
import { InviteFriends } from "../components/edison/demand-v11/invitations";
import { ReaderAccount } from "../components/edison/demand-v11/account";
import { clearInvitationAttempt, executeInvitationAttempt, invitationReceiptNotice, invitationStateLabel, sameInvitationRecipient, validInvitationAttempt, type InvitationAttempt, type InvitationClient } from "../components/edison/demand-v11/invitation-state";

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
  assert.deepEqual(["pending", "sending", "sent", "failed", "expired", "revoked", "redeemed"].map((status) => invitationStateLabel(status as typeof invitation.status)), ["Confirming send…", "Confirming send…", "Pending", "Not sent", "Expired", "Revoked", "Accepted"]);
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
