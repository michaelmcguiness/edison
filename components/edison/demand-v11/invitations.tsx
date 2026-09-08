"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DemandInvitation, DemandInvitations } from "@edison/contracts";
import { clearInvitationAttempt, executeInvitationAttempt, invitationReceiptNotice, invitationStateLabel, sameInvitationRecipient, validInvitationAttempt, type InvitationAttempt, type InvitationClient } from "./invitation-state";
import { definitiveResetRejection } from "./reset-state";

export type { InvitationClient } from "./invitation-state";

export function InviteFriends({ workspaceId, client }: { workspaceId: string; client: InvitationClient }) {
  const draftKey = `edison:demand:invitation-draft:${workspaceId}`;
  const operationKey = `edison:demand:invitation-attempt:${workspaceId}`;
  const [email, setEmail] = useState(() => { try { return (localStorage.getItem(draftKey) ?? "").slice(0, 320); } catch { return ""; } });
  const emailRef = useRef(email);
  const [attempt, setAttempt] = useState<InvitationAttempt | null>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem(operationKey) ?? "null"); return validInvitationAttempt(value) ? value : null; } catch { return null; }
  });
  const attemptRef = useRef(attempt);
  const [data, setData] = useState<DemandInvitations | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const recovery = useRef<HTMLButtonElement>(null);
  const keepInvitation = useRef<HTMLButtonElement>(null);
  const revokeTrigger = useRef<HTMLButtonElement | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const serial = useRef(0);
  const id = useId();
  useEffect(() => { if (confirmRevoke) keepInvitation.current?.focus({ preventScroll: true }); }, [confirmRevoke]);

  const refresh = useCallback(async () => {
    const sequence = ++serial.current;
    setListState("loading");
    try {
      const next = await client.getDemandInvitations();
      if (mounted.current && sequence === serial.current) { setData(next); setListState("ready"); }
    } catch { if (mounted.current && sequence === serial.current) setListState("error"); }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    const responseCounter = serial;
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; mounted.current = false; responseCounter.current++; };
  }, [refresh]);
  const awaitingSend = data?.invitations.some((invitation) => invitation.status === "sending");
  useEffect(() => {
    if (!awaitingSend || pending || listState !== "ready") return;
    const timer = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [awaitingSend, pending, listState, refresh, data]);

  function updateEmail(value: string) {
    emailRef.current = value; setEmail(value);
    try { localStorage.setItem(draftKey, value); } catch { /* The in-memory draft remains. */ }
  }
  async function run(kind: InvitationAttempt["kind"], invitation?: DemandInvitation, recover = false) {
    if (lock.current || (attemptRef.current && !recover)) return;
    const operation = recover ? attemptRef.current : { key: `invitation:${crypto.randomUUID()}`, kind, email: kind === "send" ? emailRef.current : invitation?.email ?? "", invitationId: invitation?.id ?? null };
    if (!operation || !validInvitationAttempt(operation)) return;
    lock.current = true; serial.current++; setPending(true); setListState("loading"); setMessage(""); setError("");
    attemptRef.current = operation; setAttempt(operation);
    try { localStorage.setItem(operationKey, JSON.stringify(operation)); } catch { /* In-memory operation remains repeatable. */ }
    try {
      const result = await executeInvitationAttempt(client, operation);
      const ownsStorage = clearInvitationAttempt(operationKey, operation.key);
      if (attemptRef.current?.key === operation.key) attemptRef.current = null;
      if (!mounted.current) return;
      setAttempt(null); setConfirmRevoke(null);
      // A receipt confirms only this operation. Never clear a newer draft or
      // compute the remaining slots: fetch the authoritative ledger next.
      if (operation.kind === "send" && result.delivery === "sent" && result.invitation.status === "sent") {
        let latest = emailRef.current;
        try { if (ownsStorage) latest = localStorage.getItem(draftKey) ?? latest; } catch { /* Retain local draft. */ }
        if (ownsStorage && sameInvitationRecipient(latest, operation.email)) updateEmail("");
      }
      const notice = invitationReceiptNotice(operation.kind, result);
      if (notice.error) setError(notice.text); else setMessage(notice.text);
      await refresh();
    } catch (failure) {
      const rejected = definitiveResetRejection(failure);
      if (rejected) { clearInvitationAttempt(operationKey, operation.key); if (attemptRef.current?.key === operation.key) attemptRef.current = null; }
      if (mounted.current) {
        setAttempt(rejected ? null : operation);
        setError(rejected ? failure instanceof Error ? failure.message : "This invitation request wasn’t accepted. Please try again." : operation.kind === "resend" ? "We couldn’t confirm the resend. Check its status before trying again." : "We couldn’t confirm this invitation request. Check its status before trying again.");
        (operation.kind === "send" ? input.current ?? recovery.current : recovery.current ?? input.current)?.focus({ preventScroll: true });
        await refresh();
      }
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  }

  return <div className="demand-invite-friends">
    {listState === "loading" ? <p role="status">{pending ? "Updating invitations…" : "Loading invitations…"}</p> : null}
    {listState === "error" ? <p role="alert">We couldn’t load your invitations. <button type="button" className="demand-text-action" disabled={pending} onClick={() => void refresh()}>Try again</button></p> : null}
    {listState === "ready" && data ? <p className="demand-invite-balance">{data.remaining} {data.remaining === 1 ? "invite" : "invites"} left</p> : null}
    <p>Invite someone you’d like to share Edison with.</p>
    {listState === "ready" && data?.remaining === 0 ? <p>All {data.limit} invites are pending or have been accepted.</p> : <form onSubmit={(event) => { event.preventDefault(); void run("send"); }} aria-busy={pending}>
      <label htmlFor={`${id}-email`}>Email address</label><input ref={input} id={`${id}-email`} type="email" required maxLength={320} value={email} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} readOnly={pending} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-help`} onChange={(event) => updateEmail(event.target.value)} />
      <button type="submit" className="demand-primary" disabled={pending || listState !== "ready" || !email.trim() || Boolean(attempt)}>{pending && attempt?.kind === "send" ? "Sending…" : "Send invitation"}</button>
    </form>}
    <p id={`${id}-help`} className="demand-scope-note">Each invitation is for one person. Resending won’t use another invite.</p>
    {attempt ? <p className="demand-scope-note">An invitation request needs confirmation. <button ref={recovery} type="button" className="demand-text-action" disabled={pending} onClick={() => void run(attempt.kind, undefined, true)}>Check status</button></p> : null}
    {error ? <p id={`${id}-error`} role="alert" className="demand-dialog-error">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {data?.invitations.length ? <section className="demand-invitation-list" aria-label="Invitations"><h3>Invitations</h3>{data.invitations.map((invitation) => <article key={invitation.id} className="demand-invitation-row">
      <strong>{invitation.email}</strong><span>{invitationStateLabel(invitation.status)}</span>
      <small>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(invitation.createdAt))}</small>
      {confirmRevoke === invitation.id ? <div className="demand-revoke-confirm" role="group" aria-label="Revoke this invitation?"><h4>Revoke this invitation?</h4><p>This link will stop working, and the invite will be available again.</p><button ref={keepInvitation} type="button" className="demand-text-action" onClick={() => { setConfirmRevoke(null); requestAnimationFrame(() => revokeTrigger.current?.focus({ preventScroll: true })); }} disabled={pending}>Keep invitation</button><button type="button" className="demand-text-action" disabled={pending || Boolean(attempt)} onClick={() => void run("revoke", invitation)}>{pending ? "Revoking…" : "Revoke invitation"}</button></div>
        : invitation.status === "sent" || invitation.status === "pending" ? <div className="demand-invite-actions"><button type="button" className="demand-text-action" disabled={pending || Boolean(attempt) || listState !== "ready"} onClick={() => void run("resend", invitation)}>{pending && attempt?.kind === "resend" && attempt.invitationId === invitation.id ? "Resending…" : "Resend"}</button><button type="button" className="demand-text-action" disabled={pending || Boolean(attempt) || listState !== "ready"} onClick={(event) => { revokeTrigger.current = event.currentTarget; setConfirmRevoke(invitation.id); }}>Revoke</button></div>
          : invitation.status === "sending" ? <button type="button" className="demand-text-action" disabled={pending || listState !== "ready"} onClick={() => void refresh()}>Check status</button>
            : invitation.status !== "redeemed" && listState === "ready" && data.remaining > 0 ? <button type="button" className="demand-text-action" disabled={pending || Boolean(attempt)} onClick={() => { updateEmail(invitation.email); input.current?.focus({ preventScroll: true }); }}>Send new invitation</button> : null}
    </article>)}</section> : null}
  </div>;
}
