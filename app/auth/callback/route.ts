import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";
import { demandLoginPath, safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isDemoMode()) return NextResponse.redirect(new URL("/", url.origin));
  const code = url.searchParams.get("code");
  const returnPath = safeDemandAuthReturnPath(url.searchParams.get("next"));
  const destination = new URL(returnPath, url.origin);

  if (!code) {
    return NextResponse.redirect(new URL(demandLoginPath(returnPath, "missing_code"), url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(demandLoginPath(returnPath, "invalid_link"), url.origin));
  }

  return NextResponse.redirect(destination);
}
