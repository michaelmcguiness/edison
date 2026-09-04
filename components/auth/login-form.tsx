"use client";

import { useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setMessage(
        error.message.includes("Signups not allowed")
          ? "This private alpha is invitation-only."
          : "Edison could not send that link. Please try again.",
      );
      return;
    }

    setStatus("sent");
    setMessage("Check your inbox for a private sign-in link.");
  }

  return (
    <form className="login-form" onSubmit={sendMagicLink}>
      <label htmlFor="email">Email address</label>
      <div className="login-field">
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          disabled={status === "sending" || status === "sent"}
        />
        <button
          type="submit"
          disabled={!email.trim() || status === "sending" || status === "sent"}
        >
          {status === "sending" ? (
            <LoaderCircle className="spin" aria-label="Sending" />
          ) : status === "sent" ? (
            <Check aria-label="Sent" />
          ) : (
            <ArrowRight aria-label="Continue" />
          )}
        </button>
      </div>
      {message ? (
        <p
          className={status === "error" ? "form-error" : "form-success"}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
