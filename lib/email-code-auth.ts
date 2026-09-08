"use client";

import type { Session } from "@supabase/supabase-js";
import { createEmailCodeTransport, type EmailCodeTransport } from "./supabase/email-code-client";

export type EmailCodeIssue = "invalid_email" | "invalid" | "expired" | "rate_limited" | "delivery_unknown" | "verification_unknown" | null;
export type EmailCodeSnapshot = Readonly<{
  email: string;
  phase: "email" | "sending" | "code" | "verifying" | "committing" | "signed_in";
  issue: EmailCodeIssue;
  retryAt: number;
}>;
export type EmailCodeOutcome = "signed_in" | "code" | "stale" | "busy" | "cooldown" | "invalid" | "rate_limited" | "unknown";
export type EmailCodeAuthOptions = {
  contextUrl: string;
  invitationId?: string;
  initialRetryAt?: number;
  onAttempt?: (retryAt: number) => void;
  transport?: EmailCodeTransport;
  now?: () => number;
};

function validEmail(email: string) { return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function confirmedSession(session: Session | null, email: string): session is Session {
  return Boolean(session?.access_token && session.refresh_token && !session.user.is_anonymous && session.user.email_confirmed_at && session.user.email?.toLowerCase() === email.toLowerCase());
}
function status(error: unknown) { return error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 0; }

/** Keeps challenge state in memory. Membership and invitation acceptance remain server-owned. */
export function createEmailCodeAuthController(options: EmailCodeAuthOptions) {
  const transport = options.transport ?? createEmailCodeTransport();
  const now = options.now ?? Date.now;
  let snapshot: EmailCodeSnapshot = { email: "", phase: "email", issue: null, retryAt: options.initialRetryAt ?? 0 };
  let generation = 0;
  let disposed = false;
  let candidate: Session | null = null;
  const listeners = new Set<() => void>();
  const update = (value: Partial<EmailCodeSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...value };
    for (const listener of listeners) listener();
  };
  const busy = () => ["sending", "verifying", "committing"].includes(snapshot.phase);
  const current = (ticket: number) => !disposed && generation === ticket;
  function rateLimited(): EmailCodeOutcome {
    const retryAt = Math.max(snapshot.retryAt, transport.retryAt?.() ?? 0);
    update({ phase: "code", issue: "rate_limited", retryAt });
    if (retryAt > now()) { try { options.onAttempt?.(retryAt); } catch { /* In-memory cooldown remains. */ } }
    return "rate_limited";
  }

  async function commit(ticket: number, session: Session): Promise<EmailCodeOutcome> {
    if (!current(ticket)) return "stale";
    candidate = session;
    update({ phase: "committing", issue: null });
    try {
      const saved = await transport.commit(session, () => current(ticket));
      if (!current(ticket)) return "stale";
      if (!confirmedSession(saved, snapshot.email)) throw new Error("session_unconfirmed");
      candidate = null;
      update({ phase: "signed_in", issue: null });
      return "signed_in";
    } catch {
      if (!current(ticket)) return "stale";
      update({ phase: "code", issue: "verification_unknown" });
      return "unknown";
    }
  }

  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    beginCode(email: string) {
      if (disposed || snapshot.phase === "committing") return false;
      const target = email.trim();
      if (!validEmail(target)) { update({ issue: "invalid_email" }); return false; }
      generation++; candidate = null;
      update({ email: target, phase: "code", issue: null });
      return true;
    },
    changeEmail() {
      if (disposed || snapshot.phase === "committing") return false;
      generation++; candidate = null;
      update({ email: "", phase: "email", issue: null });
      return true;
    },
    async send(email: string): Promise<EmailCodeOutcome> {
      if (disposed) return "stale";
      if (busy()) return "busy";
      const target = email.trim();
      if (!validEmail(target)) { update({ issue: "invalid_email" }); return "invalid"; }
      if (snapshot.retryAt > now()) return "cooldown";
      const ticket = ++generation;
      candidate = null;
      const retryAt = now() + 60_000;
      update({ email: target, phase: "sending", issue: null, retryAt });
      try { options.onAttempt?.(retryAt); } catch { /* In-memory duplicate/cooldown control remains. */ }
      try {
        let error = await transport.send(target, options.contextUrl);
        if (!current(ticket)) return "stale";
        // This exact rejection occurs before mail. It is the sole permitted
        // second transport, and only renews an existing invited account.
        if (options.invitationId && error?.status === 422 && error.code === "signup_disabled") {
          error = await transport.resendConfirmation(target, options.contextUrl);
          if (!current(ticket)) return "stale";
        }
        if (status(error) === 429) return rateLimited();
        if (error && (status(error) === 408 || status(error) < 400 || status(error) >= 500)) throw error;
        // Eligible and ineligible addresses have the same public send outcome.
        update({ phase: "code", issue: null });
        return "code";
      } catch {
        if (!current(ticket)) return "stale";
        update({ phase: "code", issue: "delivery_unknown" });
        return "unknown";
      }
    },
    async verify(code: string): Promise<EmailCodeOutcome> {
      if (disposed) return "stale";
      if (busy()) return "busy";
      if (snapshot.phase !== "code") return "invalid";
      if (snapshot.issue === "rate_limited" && snapshot.retryAt > now()) return "cooldown";
      const token = code.replace(/\s/g, "");
      if (!/^\d{4,10}$/.test(token)) { update({ issue: "invalid" }); return "invalid"; }
      const ticket = generation;
      const email = snapshot.email;
      update({ phase: "verifying", issue: null });
      try {
        const { session, error } = await transport.verify(email, token);
        if (!current(ticket)) return "stale";
        if (error) {
          if (status(error) === 429) return rateLimited();
          if (status(error) !== 408 && status(error) >= 400 && status(error) < 500) {
            // Supabase's otp_expired also covers invalid tokens; don't invent expiry.
            update({ phase: "code", issue: "invalid" }); return "invalid";
          }
          throw error;
        }
        if (!confirmedSession(session, email)) throw new Error("session_unconfirmed");
        return await commit(ticket, session);
      } catch {
        if (!current(ticket)) return "stale";
        update({ phase: "code", issue: "verification_unknown" });
        return "unknown";
      }
    },
    async checkSession(): Promise<EmailCodeOutcome> {
      if (disposed) return "stale";
      if (busy()) return "busy";
      if (!validEmail(snapshot.email)) return "invalid";
      const ticket = generation;
      update({ phase: "verifying", issue: null });
      try {
        const session = await transport.readSession(snapshot.email, () => current(ticket));
        if (!current(ticket)) return "stale";
        if (confirmedSession(session, snapshot.email)) {
          candidate = null;
          update({ phase: "signed_in", issue: null });
          return "signed_in";
        }
      } catch {
        if (!current(ticket)) return "stale";
      }
      // A matching saved browser session wins without rewriting credentials.
      // Otherwise the transport may retry only this candidate's original guard.
      if (candidate) return commit(ticket, candidate);
      update({ phase: "code", issue: "verification_unknown" });
      return "unknown";
    },
    dispose() { disposed = true; generation++; candidate = null; listeners.clear(); transport.dispose(); },
  };
}

export type EmailCodeAuthController = ReturnType<typeof createEmailCodeAuthController>;
