import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";
import { demandLoginPath, safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403 });
  if (isDemoMode()) {
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  }
  const form = await request.formData();
  const next = form.get("next");
  const invitation = form.get("invitation");
  const invitationId = typeof invitation === "string" ? invitation : undefined;
  const destination = next === "/auth/accept" ? next : demandLoginPath(safeDemandAuthReturnPath(next), undefined,
    invitationId);
  const failure = () => NextResponse.redirect(new URL(next === "/auth/accept" ? "/auth/accept?error=unconfirmed"
    : demandLoginPath(safeDemandAuthReturnPath(next), "unavailable", invitationId), request.url), { status: 303 });
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return failure();
  } catch { return failure(); }
  const response = NextResponse.redirect(new URL(destination, request.url), { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
