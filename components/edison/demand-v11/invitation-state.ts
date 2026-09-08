import type { DemandInvitation, DemandInvitationMutation, DemandInvitations } from "@edison/contracts";

export type InvitationClient = {
  getDemandInvitations: () => Promise<DemandInvitations>;
  sendDemandInvitation: (input: { email: string; idempotencyKey: string }) => Promise<DemandInvitationMutation>;
  resendDemandInvitation: (id: string, input: { idempotencyKey: string }) => Promise<DemandInvitationMutation>;
  revokeDemandInvitation: (id: string, input: { idempotencyKey: string }) => Promise<DemandInvitationMutation>;
};

export type InvitationAttempt = { key: string; kind: "send" | "resend" | "revoke"; email: string; invitationId: string | null };
export function invitationStateLabel(status: DemandInvitation["status"]) {
  return { pending: "Confirming send…", sending: "Confirming send…", sent: "Pending", failed: "Not sent", expired: "Expired", revoked: "Revoked", redeemed: "Accepted" }[status];
}
export function validInvitationAttempt(value: unknown): value is InvitationAttempt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InvitationAttempt>;
  if (Object.keys(value).some((key) => !["key", "kind", "email", "invitationId"].includes(key))) return false;
  return typeof item.key === "string" && /^invitation:[0-9a-f-]{36}$/.test(item.key) &&
    ["send", "resend", "revoke"].includes(item.kind ?? "") && typeof item.email === "string" && item.email.length <= 320 &&
    (item.kind === "send" ? item.invitationId === null && item.email.trim().length > 0 : typeof item.invitationId === "string" && /^[0-9a-f-]{36}$/.test(item.invitationId));
}
export function clearInvitationAttempt(key: string, operationId: string, storage: () => Pick<Storage, "getItem" | "removeItem"> = () => localStorage) {
  try { const device = storage(); const value: unknown = JSON.parse(device.getItem(key) ?? "null"); if (validInvitationAttempt(value) && value.key === operationId) { device.removeItem(key); return true; } } catch { /* Device persistence can be unavailable. */ }
  return false;
}
export function sameInvitationRecipient(left: string, right: string) { return left.trim().toLowerCase() === right.trim().toLowerCase(); }

export function executeInvitationAttempt(client: InvitationClient, operation: InvitationAttempt) {
  if (!validInvitationAttempt(operation)) throw new Error("This invitation request could not be recovered. Reload Account to try again.");
  if (operation.kind === "send") return client.sendDemandInvitation({ email: operation.email, idempotencyKey: operation.key });
  const input = { idempotencyKey: operation.key };
  return operation.kind === "resend" ? client.resendDemandInvitation(operation.invitationId!, input) : client.revokeDemandInvitation(operation.invitationId!, input);
}

export function invitationReceiptNotice(kind: InvitationAttempt["kind"], result: DemandInvitationMutation): { error: boolean; text: string } {
  const status = result.invitation.status;
  if (status === "redeemed") return { error: false, text: kind === "revoke" ? "This invitation was already accepted." : "Invitation accepted." };
  if (status === "revoked") return { error: false, text: "Invitation revoked." };
  if (status === "expired") return { error: false, text: "This invitation has expired." };
  if (kind === "revoke") return { error: false, text: "The invitation’s status has been updated." };
  // Row status describes the invitation, not whether this operation sent mail.
  // In particular a failed resend leaves the original invitation valid.
  if (result.delivery === "sent") return { error: false, text: kind === "resend" ? "Invitation resent." : "Invitation sent." };
  if (kind === "resend" && result.delivery !== "not_attempted") return { error: true, text: "We couldn’t confirm the resend. Check its status before trying again." };
  if (result.delivery === "failed" && status === "failed") return { error: true, text: "We couldn’t send this invitation. Your invite is still available." };
  if (result.delivery === "not_attempted" && status === "sent") return { error: false, text: "Invitation confirmed. Resend is available below." };
  return { error: false, text: "Confirming send… Check its status below." };
}
