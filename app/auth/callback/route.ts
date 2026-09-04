import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isDemoMode()) return NextResponse.redirect(new URL("/", url.origin));
  const code = url.searchParams.get("code");
  const destination = new URL("/", url.origin);

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", url.origin));
  }

  return NextResponse.redirect(destination);
}
