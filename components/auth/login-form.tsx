"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { createEmailCodeAuthController, type EmailCodeSnapshot } from "@/lib/email-code-auth";
import { acceptanceDestination, readAuthReturn, readSignInRetryAt, rememberAuthReturn, signInCallbackUrl, signInRetryStorageKey } from "./invitation-entry-state";

const emptyState: EmailCodeSnapshot = { email: "", phase: "email", issue: null, retryAt: 0 };
const sixDigitMessage = "Enter the six-digit code from your email.";
const longerCodeMessage = "Codes are now six digits. Choose Resend code below to get a new one.";
const issueCopy = {
  invalid_email: "Enter a valid email address.",
  invalid: "That code didn’t work. Check it and try again.",
  expired: "That code has expired. Request a new one below.",
  rate_limited: "Too many attempts. Please wait before trying again.",
  delivery_unknown: "We couldn’t confirm delivery. A code may still arrive; check your inbox before requesting another.",
  verification_unknown: "We couldn’t confirm whether you’re signed in.",
};

export function LoginForm({ returnPath = "/", authOrigin, invitationId, initialMessage, hasCode = false }: {
  returnPath?: string; authOrigin?: string; invitationId?: string; initialMessage?: string; hasCode?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState(emptyState);
  const [validation, setValidation] = useState("");
  const [notice, setNotice] = useState(initialMessage ?? "");
  const [remaining, setRemaining] = useState(0);
  const [resending, setResending] = useState(false);
  const [checkedSignIn, setCheckedSignIn] = useState(false);
  const controller = useRef<ReturnType<typeof createEmailCodeAuthController> | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const destination = useRef(returnPath);
  const codeStep = state.phase !== "email" && (state.phase !== "sending" || resending);
  const working = ["sending", "verifying", "committing", "signed_in"].includes(state.phase);
  const reconciling = state.issue === "verification_unknown";
  const message = validation || (state.issue ? issueCopy[state.issue] : notice);
  const neutral = !validation && (!state.issue || ["delivery_unknown", "verification_unknown"].includes(state.issue));

  useEffect(() => {
    rememberAuthReturn(returnPath);
    destination.current = acceptanceDestination(returnPath, readAuthReturn());
    const instance = createEmailCodeAuthController({
      contextUrl: signInCallbackUrl(destination.current, window.location.origin, authOrigin, invitationId), invitationId,
      initialRetryAt: readSignInRetryAt(),
      onAttempt: (retryAt) => { try { sessionStorage.setItem(signInRetryStorageKey, String(retryAt)); } catch { /* In-memory pacing remains. */ } },
    });
    controller.current = instance;
    const unsubscribe = instance.subscribe(() => setState(instance.snapshot()));
    queueMicrotask(() => setState(instance.snapshot()));
    return () => { unsubscribe(); instance.dispose(); controller.current = null; };
  }, [returnPath, authOrigin, invitationId]);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000)));
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [state.retryAt]);

  useEffect(() => {
    if (codeStep) codeInput.current?.focus({ preventScroll: true });
  }, [codeStep]);

  function continueReading() {
    // Verify on this origin: its SDK cookie is not shared with another alias.
    // Email entry links themselves still use the canonical, allowlisted apex.
    window.location.assign(signInCallbackUrl(destination.current, window.location.origin, undefined, invitationId));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !controller.current) return;
    setValidation(""); setNotice("");
    if (!codeStep) {
      if (!email.trim() || !emailInput.current?.validity.valid) {
        setValidation("Enter a valid email address."); emailInput.current?.focus({ preventScroll: true }); return;
      }
      if (hasCode) controller.current.beginCode(email.trim());
      else await controller.current.send(email.trim());
      return;
    }
    if (reconciling) {
      const result = await controller.current.checkSession();
      if (result === "signed_in") continueReading();
      else if (result === "unknown") setCheckedSignIn(true);
      return;
    }
    const token = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) {
      setValidation(validation === longerCodeMessage ? longerCodeMessage : sixDigitMessage);
      codeInput.current?.focus({ preventScroll: true }); return;
    }
    setCheckedSignIn(false);
    if (await controller.current.verify(token) === "signed_in") continueReading();
  }

  function changeEmail() {
    if (!controller.current?.changeEmail()) return;
    setCode(""); setValidation(""); setNotice(""); setResending(false); setCheckedSignIn(false);
    requestAnimationFrame(() => emailInput.current?.focus({ preventScroll: true }));
  }

  function changeCode(raw: string) {
    const token = raw.replace(/\s/g, "");
    // Inspect the whole paste/autofill value. Native maxLength or slicing can
    // silently turn an older eight-digit code into a different six-digit code.
    if (!/^\d{0,6}$/.test(token)) {
      setCode("");
      setValidation(/^\d{7,}$/.test(token) ? longerCodeMessage : sixDigitMessage);
      return;
    }
    setCode(token); setValidation("");
  }

  async function resend() {
    if (working || remaining > 0 || (reconciling && !checkedSignIn)) return;
    setValidation(""); setNotice(""); setCode(""); setResending(true); setCheckedSignIn(false);
    try { await controller.current?.send(state.email); }
    finally { setResending(false); }
  }

  return <>
    <h1>{codeStep ? "Enter your code" : "Sign in"}</h1>
    <p className="email-code-intro">{codeStep ? "Check your email for a six-digit sign-in code." : hasCode ? "Enter your email to use the code you received." : "Enter your email to get a six-digit sign-in code."}</p>
    {codeStep ? <div className="email-code-recipient"><span>{state.email}</span><button className="email-code-link" type="button" disabled={state.phase === "committing" || state.phase === "signed_in"} onClick={changeEmail}>Change email</button></div> : null}
    <form className="email-code-form" onSubmit={submit} noValidate aria-busy={working}>
      <label htmlFor={codeStep ? "sign-in-code" : "email"}>{codeStep ? "Sign-in code" : "Email address"}</label>
      {codeStep ? <input ref={codeInput} id="sign-in-code" className="email-code-input email-code-input--code" type="text" inputMode="numeric"
        autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={code}
        onChange={(event) => changeCode(event.target.value)} pattern="[0-9]{6}" placeholder="6-digit code"
        readOnly={working || reconciling} aria-invalid={Boolean(validation) || state.issue === "invalid" || state.issue === "expired"}
        aria-describedby={message ? "sign-in-message" : undefined} />
        : <input ref={emailInput} id="email" className="email-code-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          value={email} onChange={(event) => { if (state.phase === "sending") controller.current?.changeEmail(); setEmail(event.target.value); setValidation(""); setNotice(""); }}
          placeholder="you@example.com" required maxLength={320} aria-invalid={Boolean(validation) || state.issue === "invalid_email"} aria-describedby={message ? "sign-in-message" : undefined} />}
      {message ? <p id="sign-in-message" className={`email-code-message${neutral ? " email-code-message--neutral" : ""}`} role={neutral ? "status" : "alert"}>{message}</p> : null}
      <button type="submit" className="email-code-primary" disabled={working || (state.issue === "rate_limited" && remaining > 0) || (!codeStep && !hasCode && remaining > 0)}>
        {working ? <><LoaderCircle className="spin" aria-hidden="true" />{state.phase === "sending" ? "Sending code…" : "Checking…"}</> : reconciling ? "Check sign-in status" : codeStep || hasCode ? "Continue" : "Send code"}
      </button>
    </form>
    {codeStep ? <div className="email-code-resend"><span>Didn’t get a code?</span><button type="button" className="email-code-link" disabled={working || remaining > 0 || (reconciling && !checkedSignIn)} onClick={() => void resend()}>{remaining > 0 ? `Resend in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Resend code"}</button></div>
      : remaining > 0 && !hasCode ? <p className="email-code-message email-code-message--neutral" role="status">You can request another code in {remaining} seconds.</p> : null}
  </>;
}
