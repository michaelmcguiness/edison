"use client";

import { createClient, type AuthError, type Session } from "@supabase/supabase-js";
import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "./env";

export type EmailCodeTransport = {
  send(email: string, contextUrl: string): Promise<AuthError | null>;
  resendConfirmation(email: string, contextUrl: string): Promise<AuthError | null>;
  verify(email: string, token: string): Promise<{ session: Session | null; error: AuthError | null }>;
  commit(session: Session, current: () => boolean): Promise<Session | null>;
  readSession(email: string, current: () => boolean): Promise<Session | null>;
  retryAt?(): number;
  dispose(): void;
};

type Options = {
  config?: { url: string; publishableKey: string };
  fetch?: typeof fetch;
  cookieDocument?: Pick<Document, "cookie">;
  timeoutMs?: number;
};

/** Code verification is intentionally unable to persist or broadcast a browser session. */
export function createEmailCodeTransport(options: Options = {}): EmailCodeTransport {
  const { url, publishableKey } = options.config ?? getPublicSupabaseConfig();
  const rawFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let providerRetryAt = 0;
  const boundedFetch: typeof fetch = async (input, init) => {
    const abort = new AbortController();
    const signal = init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal;
    let timer: ReturnType<typeof setTimeout>;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new Error("auth_request_unconfirmed")); }, options.timeoutMs ?? 15_000);
    });
    const completeResponse = async () => {
      const response = await rawFetch(input, { ...init, signal });
      if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("auth_request_unconfirmed"); }
      if (response.status === 429) {
        const guidance = response.headers.get("retry-after");
        if (guidance) {
          const instant = /^\d+$/.test(guidance) ? Date.now() + Number(guidance) * 1000 : Date.parse(guidance);
          if (Number.isFinite(instant) && instant > Date.now()) providerRetryAt = Math.max(providerRetryAt, Math.min(instant, Date.now() + 86_400_000));
        }
      }
      if (!response.body) return response;
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 1_048_576) throw new Error("auth_response_unconfirmed");
        chunks.push(next.value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    try { return await Promise.race([completeResponse(), timeout]); }
    finally { clearTimeout(timer!); void reader?.cancel().catch(() => {}); }
  };
  const isolated = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
    global: { fetch: boundedFetch },
  });
  const cookieDocument = options.cookieDocument ?? document;
  // Match the installed SDK's project-scoped default storage key. Only Auth's
  // base cookie and numeric chunks participate; unrelated cookies are not locks.
  const authCookieName = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const cookieIdentity = () => JSON.stringify(parseCookieHeader(cookieDocument.cookie)
    .filter(({ name }) => name === authCookieName || (name.startsWith(`${authCookieName}.`) && /^\d+$/.test(name.slice(authCookieName.length + 1))))
    .sort((left, right) => left.name.localeCompare(right.name)));
  const candidates = new WeakMap<Session, { baseline: string }>();
  let disposed = false;

  async function browserSession<T>(current: () => boolean, write: boolean, operation: (auth: ReturnType<typeof createBrowserClient>["auth"]) => Promise<T>, written?: () => void): Promise<T> {
    let armed = false;
    const browser = createBrowserClient(url, publishableKey, {
      isSingleton: false,
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: boundedFetch },
      cookies: {
        // Initialization must not recover, refresh or overwrite another existing
        // account before this particular operation has acquired its guard.
        getAll: () => armed ? parseCookieHeader(cookieDocument.cookie) : [],
        setAll: (batch) => {
          if (!armed || !write || disposed || !current()) throw new Error("stale_email_code_session");
          // Recheck at the storage boundary, then write the SDK batch without
          // yielding. This is not a cross-process cookie transaction or lock.
          for (const { name, value, options: settings } of batch) cookieDocument.cookie = serializeCookieHeader(name, value, settings);
          written?.();
        },
      },
    });
    try {
      const initialized = await browser.auth.initialize();
      if (initialized.error) throw initialized.error;
      if (disposed || !current()) throw new Error("stale_email_code_session");
      armed = true;
      const result = await operation(browser.auth);
      if (disposed || !current()) throw new Error("stale_email_code_session");
      return result;
    } finally {
      armed = false;
      await browser.auth.dispose();
    }
  }

  return {
    async send(email, contextUrl) {
      return (await isolated.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: contextUrl } })).error;
    },
    async resendConfirmation(email, contextUrl) {
      return (await isolated.auth.resend({ type: "signup", email, options: { emailRedirectTo: contextUrl } })).error;
    },
    async verify(email, token) {
      const baseline = cookieIdentity();
      const { data, error } = await isolated.auth.verifyOtp({ email, token, type: "email" });
      if (data.session) candidates.set(data.session, { baseline });
      return { session: data.session, error };
    },
    commit(session, current) {
      const binding = candidates.get(session);
      const unchanged = () => current() && Boolean(binding) && cookieIdentity() === binding!.baseline;
      return browserSession(unchanged, true, async (auth) => {
        const { data, error } = await auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
        if (error) throw error;
        return data.session;
      }, () => {
        // Advance only after our own complete synchronous cookie batch. A retry
        // keeps this same candidate binding; it never adopts another tab's jar.
        binding!.baseline = cookieIdentity();
      });
    },
    readSession(email, current) {
      const baseline = cookieIdentity();
      return browserSession(() => current() && cookieIdentity() === baseline, false, async (auth) => {
        const { data, error } = await auth.getSession();
        if (error) throw error;
        const session = data.session;
        if (!session || session.user.is_anonymous || session.user.email?.toLowerCase() !== email.toLowerCase()) return null;
        const verified = await isolated.auth.getUser(session.access_token);
        if (verified.error) throw verified.error;
        if (verified.data.user.id !== session.user.id || verified.data.user.is_anonymous || verified.data.user.email?.toLowerCase() !== email.toLowerCase() || !verified.data.user.email_confirmed_at) return null;
        return { ...session, user: verified.data.user };
      });
    },
    retryAt: () => providerRetryAt,
    dispose() { disposed = true; void isolated.auth.dispose(); },
  };
}
