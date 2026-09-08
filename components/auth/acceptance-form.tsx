"use client";
import { useEffect, useRef, useState } from "react";
import { safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";
import { acceptanceDestination, clearAuthReturn, readAuthReturn } from "./invitation-entry-state";

export { authReturnStorageKey } from "./invitation-entry-state";
export function AcceptanceForm({ nonce, returnPath, label, mode = "invitation" }: { nonce: string; returnPath: string; label: string; mode?: "invitation" | "signin" | "accepted" }) {
  const [destination, setDestination] = useState(safeDemandAuthReturnPath(returnPath));
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    queueMicrotask(() => setDestination(acceptanceDestination(returnPath, readAuthReturn())));
  }, [returnPath]);
  useEffect(() => {
    // Back/forward-cache restoration must not leave a submitted form locked.
    const restore = () => { locked.current = false; setPending(false); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  if (mode === "accepted") return <a className="email-code-primary" href={destination} onClick={(event) => {
    if (locked.current) { event.preventDefault(); return; }
    locked.current = true; clearAuthReturn(destination);
  }}>{label}</a>;
  return <form action="/auth/confirm" method="post" aria-busy={pending} onSubmit={(event) => {
    if (locked.current) { event.preventDefault(); return; }
    locked.current = true; setPending(true);
  }}>
    <input type="hidden" name="nonce" value={nonce} /><input type="hidden" name="next" value={destination} />
    <button type="submit" className="email-code-primary" disabled={pending}>{pending ? mode === "signin" ? "Signing in…" : "Confirming your invitation…" : label}</button>
  </form>;
}
