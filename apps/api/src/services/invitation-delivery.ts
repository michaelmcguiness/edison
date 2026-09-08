import { z } from "zod";

export const invitationDeliveryCodeSchema = z.enum([
  "delivery_not_configured", "delivery_rejected", "delivery_rate_limited", "delivery_unknown",
]);
export type InvitationDeliveryResult = { outcome: "sent" } | {
  outcome: "failed" | "unknown"; code: z.infer<typeof invitationDeliveryCodeSchema>;
};
export type InvitationDeliveryInput = { invitationId: string; email: string };
export type InvitationSender = (input: InvitationDeliveryInput) => Promise<InvitationDeliveryResult>;
type Environment = Readonly<Record<string, string | undefined>>;
type DeliveryConfiguration = { authOrigin: string; webOrigin: string; secretKey: string; publishableKey: string };
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const TIMEOUT_MS = 10_000;

/** Only server configuration determines either destination. The recipient and
 * invitation ID cannot supply a URL, arbitrary metadata, or an Auth credential. */
export function invitationDeliveryConfiguration(environment: Environment): DeliveryConfiguration {
  if (environment.EDISON_MEMBER_INVITATIONS_ENABLED !== "true" || environment.EDISON_ON_DEMAND_ENABLED !== "true") {
    throw new Error("invitation_delivery_disabled");
  }
  const auth = new URL(environment.SUPABASE_URL ?? "");
  const web = new URL(environment.WEB_APP_URL ?? "");
  for (const url of [auth, web]) {
    const local = environment.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("invitation_configuration_invalid");
  }
  const secretKey = environment.SUPABASE_SECRET_KEY;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!secretKey?.startsWith("sb_secret_") || !publishableKey || /\s/.test(secretKey + publishableKey)) throw new Error("invitation_configuration_invalid");
  return { authOrigin: auth.origin, webOrigin: web.origin, secretKey, publishableKey };
}

export function invitationConfirmationUrl(webOrigin: string, invitationId: string) {
  const url = new URL("/auth/confirm", webOrigin);
  url.searchParams.set("invitation", z.string().uuid().parse(invitationId));
  return url.href;
}

async function errorCode(response: Response) {
  try {
    // Error bodies are private provider data. Read only a bounded body and
    // return a fixed protocol code; never persist or log its free-form message.
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const item = await reader.read(); if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 16_384) { await reader.cancel(); return null; }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const value = body as { error_code?: unknown; code?: unknown };
    return typeof value.error_code === "string" ? value.error_code : typeof value.code === "string" ? value.code : null;
  } catch { return null; }
}

function rejected(status: number, code: string | null): InvitationDeliveryResult {
  if (status === 429 || code === "over_email_send_rate_limit") return { outcome: "failed", code: "delivery_rate_limited" };
  if ([400, 401, 403, 404, 422].includes(status)) return { outcome: "failed", code: "delivery_rejected" };
  return { outcome: "unknown", code: "delivery_unknown" };
}

/** Supabase Auth owns email delivery through its configured Resend SMTP. The
 * installed Auth protocol POST /invite also sends again to unconfirmed users.
 * Only explicit email_exists (confirmed user, no invite sent) permits the
 * shouldCreateUser:false OTP fallback. Network/5xx ambiguity never auto-retries.
 * Both templates must carry .RedirectTo to the explicit-confirmation web page.
 * References: supabase/auth internal/api/invite.go; Auth email-template docs. */
export function createInvitationSender(environment: Environment, transport: typeof fetch = fetch): InvitationSender {
  return async (input) => {
    const email = emailSchema.parse(input.email);
    const invitationId = z.string().uuid().parse(input.invitationId);
    let config: DeliveryConfiguration;
    try { config = invitationDeliveryConfiguration(environment); }
    catch { return { outcome: "failed", code: "delivery_not_configured" }; }
    const redirect = invitationConfirmationUrl(config.webOrigin, invitationId);
    const send = async (path: "invite" | "otp", key: string, body: object) => {
      const url = new URL(`/auth/v1/${path}`, config.authOrigin);
      url.searchParams.set("redirect_to", redirect);
      return transport(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" }, body: JSON.stringify(body) });
    };
    try {
      const invitation = await send("invite", config.secretKey, { email });
      if (invitation.ok) { await invitation.body?.cancel(); return { outcome: "sent" }; }
      const code = await errorCode(invitation);
      if (invitation.status === 422 && code === "email_exists") {
        const existing = await send("otp", config.publishableKey, { email, create_user: false });
        if (existing.ok) { await existing.body?.cancel(); return { outcome: "sent" }; }
        return rejected(existing.status, await errorCode(existing));
      }
      return rejected(invitation.status, code);
    } catch { return { outcome: "unknown", code: "delivery_unknown" }; }
  };
}

export const deliverDemandInvitation: InvitationSender = (input) => createInvitationSender(process.env)(input);
