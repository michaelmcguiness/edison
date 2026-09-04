import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isDemoMode()) return NextResponse.redirect(new URL("/", url.origin));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || type !== "invite") {
    return NextResponse.redirect(
      new URL("/login?error=invalid_invite", url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "invite",
  });

  return NextResponse.redirect(
    new URL(error ? "/login?error=invalid_invite" : "/", url.origin),
  );
}
