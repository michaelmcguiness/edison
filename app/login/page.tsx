import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { EdisonMark } from "@/components/edison/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (isDemoMode()) redirect("/");
  const { error: linkError } = await searchParams;
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) redirect("/");
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <EdisonMark className="onboarding-mark" />
        <span className="eyebrow">Private alpha</span>
        <h1>Welcome back to Edison</h1>
        <p>
          Your publication remembers what you care about, what you already know,
          and what has been worth your time.
        </p>
        {linkError ? (
          <p className="form-error" role="alert">
            That sign-in link is invalid or has expired. Request a new link
            below.
          </p>
        ) : null}
        {configured ? (
          <LoginForm />
        ) : (
          <div className="setup-message" role="status">
            Authentication is ready for a Supabase project. Add the public
            Supabase environment values to enable sign-in.
          </div>
        )}
      </section>
    </main>
  );
}
