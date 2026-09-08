"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DemandAllowance, ResetDemandAllowance } from "@edison/contracts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useEditorialDialogViewport } from "@/components/edison/editorial-composer";
import { allowanceResetLabel } from "./state";
import { clearMatchingResetAttempt, definitiveResetRejection, resetPasswordFingerprint, validResetAttempt, type AllowanceResetAttempt } from "./reset-state";

export function AllowanceWall({ workspaceId, allowance, onClose, onReset }: {
  workspaceId: string; allowance: DemandAllowance; onClose: () => void;
  onReset: (input: ResetDemandAllowance) => Promise<void>;
}) {
  const storageKey = `edison:demand:allowance-reset:${workspaceId}`;
  const [attempt, setAttempt] = useState<AllowanceResetAttempt | null>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null"); return validResetAttempt(value) ? value : null; } catch { return null; }
  });
  const attemptRef = useRef(attempt);
  const [revealed, setRevealed] = useState(Boolean(attempt));
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const title = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const panel = useEditorialDialogViewport(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit() {
    if (lock.current || !password) return;
    lock.current = true; setPending(true); setError("");
    try {
      const fingerprint = await resetPasswordFingerprint(password);
      const previous = attemptRef.current;
      if (previous && previous.fingerprint !== fingerprint) { setError("Re-enter the same password to check the interrupted reset. Your allowance has not been changed on this device."); return; }
      const operation = previous ?? { idempotencyKey: `allowance:${crypto.randomUUID()}`, expectedRevision: allowance.revision, periodStart: allowance.periodStart, fingerprint };
      attemptRef.current = operation; setAttempt(operation);
      try { localStorage.setItem(storageKey, JSON.stringify(operation)); } catch { /* Server replay remains authoritative. */ }
      try {
        await onReset({ password, idempotencyKey: operation.idempotencyKey, expectedRevision: operation.expectedRevision, expectedPeriodStart: operation.periodStart });
        clearMatchingResetAttempt(() => localStorage, storageKey, operation.idempotencyKey);
        if (mounted.current) { attemptRef.current = null; setAttempt(null); setPassword(""); onClose(); }
      } catch (failure) {
        const rejected = definitiveResetRejection(failure);
        if (rejected) { clearMatchingResetAttempt(() => localStorage, storageKey, operation.idempotencyKey); attemptRef.current = null; if (mounted.current) setAttempt(null); }
        if (mounted.current) {
          setError(rejected ? failure instanceof Error ? failure.message : "The reset was not accepted. Check your password and try again." : "We couldn’t confirm the reset. Keep this password and check its status before starting another reset.");
          input.current?.focus({ preventScroll: true });
        }
      }
    } catch { if (mounted.current) setError("We couldn’t securely prepare the reset. Please try again."); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent ref={panel} className="demand-allowance-wall" showCloseButton={false}
    onOpenAutoFocus={(event) => { event.preventDefault(); title.current?.focus(); }}>
    <button type="button" className="demand-wall-close" aria-label="Close article allowance" onClick={onClose}><X aria-hidden="true" /></button>
    <p className="demand-card-kicker">Weekly allowance</p>
    <DialogTitle ref={title} tabIndex={-1}>{allowance.remaining === 0 ? "You’ve reached your article limit" : "Confirm your article allowance reset"}</DialogTitle>
    <DialogDescription>{allowance.remaining > 0 ? `${allowance.remaining} articles are currently available. ` : ""}Your next allowance starts {allowanceResetLabel(allowance)}. You can keep reading your articles, saved reading and conversations.</DialogDescription>
    {!revealed ? <button type="button" className="demand-primary" onClick={onClose}>Keep reading</button> : null}
    {!revealed ? <button type="button" className="demand-text-action" onClick={() => { setRevealed(true); requestAnimationFrame(() => input.current?.focus()); }}>Enter reset password</button> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={pending}>
      <label htmlFor={`${id}-password`}>Reset password</label>
      <input ref={input} id={`${id}-password`} type="password" value={password} maxLength={100} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} readOnly={pending} onChange={(event) => { setPassword(event.target.value); setError(""); }} />
      {attempt ? <p className="demand-scope-note">An earlier reset needs confirmation. Re-enter its password to check the same request.</p> : null}
      {error ? <p id={`${id}-error`} className="demand-dialog-error" role="alert">{error}</p> : null}
      <button type="submit" className="demand-primary" disabled={pending || !password}>{pending ? "Resetting…" : attempt ? "Check reset status" : "Reset allowance"}</button>
      <button type="button" className="demand-text-action" onClick={onClose}>Keep reading</button>
    </form>}
  </DialogContent></Dialog>;
}
