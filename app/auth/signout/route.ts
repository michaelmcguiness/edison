import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";

export async function POST(request: Request) {
  if (isDemoMode()) {
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
