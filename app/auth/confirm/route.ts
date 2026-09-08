import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { uuidSchema } from "@edison/contracts";
import { createClient } from "@/lib/supabase/server";
import { demandLoginPath, safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";
import { memberApiFetch } from "@/lib/member-access";
import { decodeInvitationAcceptance, invitationAcceptanceCookie, invitationAcceptanceSchema } from "@/lib/invitation-acceptance";

export const dynamic = "force-dynamic";
const cookieName = () => invitationAcceptanceCookie(process.env.NODE_ENV === "production");
const redirectTo = (target: URL) => {
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

async function readForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

/** Scanner GETs only stage a short-lived HttpOnly context, never redeem it. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnPath = safeDemandAuthReturnPath(url.searchParams.get("next"));
  const context = invitationAcceptanceSchema.safeParse({
    nonce: crypto.randomUUID(), tokenHash: url.searchParams.get("token_hash"), type: url.searchParams.get("type"),
    invitationId: url.searchParams.get("invitation"), returnPath, createdAt: Date.now(),
  });
  if (!context.success || [...url.searchParams.keys()].some((key) => !["token_hash", "type", "invitation", "next"].includes(key)) ||
      [...new Set(url.searchParams.keys())].some((key) => url.searchParams.getAll(key).length !== 1)) {
    return redirectTo(new URL(demandLoginPath(returnPath, "invalid_invite"), url.origin));
  }
  const response = redirectTo(new URL("/auth/accept", url.origin));
  response.cookies.set(cookieName(), Buffer.from(JSON.stringify(context.data)).toString("base64url"), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600,
  });
  return response;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || Number(request.headers.get("content-length") ?? 0) > 8192 ||
      !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, { status: 403 });
  let form: URLSearchParams | null;
  try { form = await readForm(request); } catch { return new Response(null, { status: 400 }); }
  if (!form) return new Response(null, { status: 413 });
  const store = await cookies();
  const context = decodeInvitationAcceptance(store.get(cookieName())?.value);
  const back = (error: string) => redirectTo(new URL(`/auth/accept?error=${error}`, url.origin));
  if (!context || form.getAll("nonce").length !== 1 || form.getAll("next").length > 1 ||
      [...form.keys()].some((key) => key !== "nonce" && key !== "next") || form.get("nonce") !== context.nonce) return back("interrupted");
  const returnPath = safeDemandAuthReturnPath(form.get("next") ?? context.returnPath);
  // A current account must match the invite. Never silently switch accounts
  // because someone clicked an emailed token; wrong-account signout is explicit.
  let accessToken: string | undefined;
  try {
    const supabase = await createClient();
    const current = await supabase.auth.getUser();
    if (current.error && current.error.name !== "AuthSessionMissingError") return back("unconfirmed");
    if (current.data.user) {
      const existing = await supabase.auth.getSession();
      accessToken = existing.data.session?.access_token;
    } else {
      const verified = await supabase.auth.verifyOtp({ token_hash: context.tokenHash, type: context.type });
      if (verified.error) {
        const status = verified.error.status;
        // Throttling and transport uncertainty do not establish token expiry.
        // Retain the existing context instead of prompting another email send.
        return back(!status || status === 408 || status === 429 || status >= 500 ? "unconfirmed" : "expired");
      }
      accessToken = verified.data.session?.access_token;
    }
    if (!accessToken) return back("unavailable");
    if (context.invitationId) {
      const id = uuidSchema.parse(context.invitationId);
      const response = await memberApiFetch(`demand/invitations/${id}/redeem`, accessToken, {
        method: "POST", body: JSON.stringify({ idempotencyKey: `invitation-accept:${id}` }),
      });
      if (!response.ok) {
        if (response.status >= 500) return back("unconfirmed");
        if (response.status === 403) return back("wrong_account");
        return back("unavailable");
      }
    }
    const access = await memberApiFetch("demand/access", accessToken);
    if (!access.ok) return back(access.status >= 500 ? "unconfirmed" : "invite_required");
  } catch { return back("unconfirmed"); }
  const response = redirectTo(new URL(returnPath, url.origin));
  response.cookies.set(cookieName(), "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}
