import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getContext } from "@vercel/oidc";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { demandLoginPath } from "@/lib/demand-auth-continuation";
import { z } from "zod";

export type MemberSession = { status: "member"; accessToken: string } | { status: "signed_out" | "invite_required" | "unavailable" };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/** Server-only, fixed API destination. Browser input never chooses a host. */
export async function memberApiFetch(path: string, accessToken: string | null, init: { method?: "GET" | "POST"; body?: string } = {}) {
  const preview = new RegExp(`^demand/invitations/${UUID}/preview$`).test(path);
  const redeem = new RegExp(`^demand/invitations/${UUID}/redeem$`).test(path);
  if (!/^(?:demand\/access|public\/demand-shares\/[a-f0-9]{64}|shares\/[a-f0-9]{32})$/.test(path) &&
      !redeem && !preview) throw new Error("Unsupported member resource.");
  if ((init.method ?? "GET") !== (redeem ? "POST" : "GET") || (!redeem && init.body !== undefined)) throw new Error("Unsupported member action.");
  if (!accessToken && (!preview || (init.method && init.method !== "GET"))) throw new Error("An authenticated reader is required.");
  const base = new URL(process.env.NEXT_PUBLIC_API_URL ?? "");
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || base.pathname.replace(/\/$/, "") !== "/v1" ||
      (base.protocol !== "https:" && !(local && base.protocol === "http:"))) throw new Error("The reading service is not configured.");
  const headers = new Headers({ "Content-Type": "application/json" });
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (process.env.EDISON_DEMAND_TRUSTED_SOURCE_ENABLED === "true") {
    if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production" ||
        process.env.EDISON_DEMAND_PROTECTED_API_URL !== base.href.replace(/\/$/, "") ||
        !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app\/v1$/.test(base.href.replace(/\/$/, ""))) throw new Error("The protected reading connection is unavailable.");
    const token = getContext().headers?.["x-vercel-oidc-token"];
    if (typeof token !== "string" || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("The protected reading connection is unavailable.");
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: unknown };
    if (!Number.isSafeInteger(claims.exp) || Number(claims.exp) <= Math.floor(Date.now() / 1000)) throw new Error("The protected reading connection is unavailable.");
    headers.set("x-vercel-trusted-oidc-idp-token", token);
  }
  return fetch(`${base.href.replace(/\/$/, "")}/${path}`, {
    method: init.method ?? "GET", ...(init.body ? { body: init.body } : {}), headers,
    cache: "no-store", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15_000),
  });
}

const acceptancePreviewSchema = z.object({
  state: z.enum(["available", "expired", "unavailable", "accepted", "wrong_account"]),
  maskedEmail: z.string().max(320).optional(), expiresAt: z.string().datetime().optional(),
}).strict();
export type InvitationAcceptancePreview = z.infer<typeof acceptancePreviewSchema> | { state: "unconfirmed" };

/** Read-only recovery: the API independently verifies any current credential.
 * Accepted is visible only to the exact, still-active recipient. No GET admits. */
export async function readInvitationAcceptance(invitationId: string): Promise<InvitationAcceptancePreview> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    const path = `demand/invitations/${invitationId}/preview`;
    let response = await memberApiFetch(path, data.session?.access_token ?? null);
    // An expired browser credential does not prevent the public masked preview.
    if (response.status === 401) response = await memberApiFetch(path, null);
    if (!response.ok) return { state: "unconfirmed" };
    const parsed = acceptancePreviewSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { state: "unconfirmed" };
  } catch { return { state: "unconfirmed" }; }
}

/** A cookie session only supplies the credential. The API verifies the token,
 * provider-confirmed identity, and current invited membership before access. */
export const readMemberSession = cache(async (): Promise<MemberSession> => {
  if (!isSupabaseConfigured()) return { status: "signed_out" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) return { status: "signed_out" };
    const response = await memberApiFetch("demand/access", accessToken);
    if (response.status === 401) return { status: "signed_out" };
    if (response.status === 403) return { status: "invite_required" };
    if (!response.ok) return { status: "unavailable" };
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("member" in result) || result.member !== true) return { status: "unavailable" };
    return { status: "member", accessToken };
  } catch { return { status: "unavailable" }; }
});

export async function requireMemberSession(returnPath: string) {
  const session = await readMemberSession();
  if (session.status !== "member") redirect(demandLoginPath(returnPath,
    session.status === "signed_out" ? undefined : session.status));
  return session;
}
