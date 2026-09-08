"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { acceptanceDestination, readAuthReturn, readSignInRetryAt, rememberAuthReturn, signInAttemptAllowed, signInCallbackUrl, signInRetryDelayMs, signInRetryStorageKey } from "./invitation-entry-state";

export function LoginForm({ returnPath = "/", authOrigin, invitationId }: { returnPath?: string; authOrigin?: string; invitationId?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const sending = useRef(false);
  const nextAttemptAt = useRef(0);
  const emailInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    rememberAuthReturn(returnPath);
    const saved = readSignInRetryAt();
    nextAttemptAt.current = saved;
    queueMicrotask(() => setRetryAt(saved));
  }, [returnPath]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => { nextAttemptAt.current = 0; setRetryAt(0); }, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  async function sendMagicLink(event?: React.FormEvent<HTMLFormElement>, resend = false) {
    event?.preventDefault();
    if (!signInAttemptAllowed(sending.current, nextAttemptAt.current) || (status === "sent" && !resend)) return;
    sending.current = true;
    const waitUntil = Date.now() + signInRetryDelayMs;
    nextAttemptAt.current = waitUntil; setRetryAt(waitUntil);
    try { sessionStorage.setItem(signInRetryStorageKey, String(waitUntil)); } catch { /* In-memory duplicate/cooldown control remains. */ }
    setStatus("sending"); setMessage("");
    try {
      const supabase = createClient();
      const callback = signInCallbackUrl(acceptanceDestination(returnPath, readAuthReturn()), window.location.origin, authOrigin, invitationId);
      const targetEmail = email.trim();
      let { error } = await supabase.auth.signInWithOtp({ email: targetEmail, options: { shouldCreateUser: false, emailRedirectTo: callback } });
      // Closed signup rejects this specific unconfirmed-user path before mail.
      // Confirmation resend operates only on an existing account and retains
      // this invitation; unknown outcomes must never trigger a second send.
      if (invitationId && error?.code === "signup_disabled" && error.status === 422) {
        ({ error } = await supabase.auth.resend({ type: "signup", email: targetEmail, options: { emailRedirectTo: callback } }));
      }
      if (error) throw new Error("sign_in_request_unconfirmed");
      setStatus("sent");
      setMessage("If this email can access Edison, you’ll receive a link shortly. Open it in this browser to continue.");
    } catch {
      setStatus("error"); setMessage("We couldn’t complete that request. Please try again.");
      emailInput.current?.focus({ preventScroll: true });
    } finally { sending.current = false; }
  }

  return <form className="login-form" onSubmit={(event) => sendMagicLink(event)} aria-busy={status === "sending"}>
    <label htmlFor="email">Email address</label>
    <div className="login-field"><input ref={emailInput} id="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={320}
      readOnly={status === "sending" || status === "sent"} aria-invalid={status === "error"} aria-describedby={message ? "sign-in-message" : undefined} />
      <button type="submit" disabled={!email.trim() || status === "sending" || status === "sent" || Boolean(retryAt)}>
        {status === "sending" ? <><LoaderCircle className="spin" aria-hidden="true" />Sending…</> : status === "sent" ? <><Check aria-hidden="true" />Check your email</> : <>Continue with email<ArrowRight aria-hidden="true" /></>}
      </button></div>
    {message ? <p id="sign-in-message" className={status === "error" ? "form-error" : "form-success"} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
    {retryAt ? <p className="invitation-signin-wait">Please wait before requesting another sign-in link.</p> : null}
    {status === "sent" ? <div className="invitation-signin-actions"><button type="button" className="demand-text-action" disabled={Boolean(retryAt)} onClick={() => void sendMagicLink(undefined, true)}>Resend sign-in link</button>
      <button type="button" className="demand-text-action" onClick={() => { setStatus("idle"); setMessage(""); emailInput.current?.focus({ preventScroll: true }); }}>Use another email</button></div> : null}
  </form>;
}
