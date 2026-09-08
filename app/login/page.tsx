import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { uuidSchema } from "@edison/contracts";
import { LoginForm } from "@/components/auth/login-form";
import { EdisonMark } from "@/components/edison/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDemoMode } from "@/lib/app-mode";
import { demandLoginPath, safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";
import { readInvitationAcceptance, readMemberSession } from "@/lib/member-access";
import "../demand.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Edison", referrer: "same-origin", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[]; invitation?: string | string[] }>;
}) {
  if (isDemoMode()) redirect("/");
  const { error: linkError, next, invitation } = await searchParams;
  const returnPath = safeDemandAuthReturnPath(next);
  const configured = isSupabaseConfigured();
  const session = await readMemberSession();
  const parsedInvitation = uuidSchema.safeParse(invitation);
  const invitationId = parsedInvitation.success ? parsedInvitation.data : undefined;
  const preview = invitationId ? await readInvitationAcceptance(invitationId) : null;
  if (session.status === "member" && (!invitationId || preview?.state === "accepted")) redirect(returnPath);
  const renewInvitation = preview?.state === "available";
  const wrongAccount = preview?.state === "wrong_account";
  const invitationUnavailable = Boolean(invitation !== undefined && !invitationId) || preview?.state === "expired" || preview?.state === "unavailable";
  const invitationUnconfirmed = preview?.state === "unconfirmed";
  const needsInvitation = session.status === "invite_required" && !renewInvitation;
  const title = wrongAccount ? "Use the email this invitation was sent to." : preview?.state === "expired" ? "This invitation has expired." : invitationUnavailable ? "This invitation is no longer available." : invitationUnconfirmed ? "We couldn’t check this invitation." : needsInvitation ? "An invitation is needed." : renewInvitation ? "Get a new sign-in link" : "Welcome to Edison";

  return (
    <main className="login-page invitation-entry">
      <section className="login-card">
        <EdisonMark className="onboarding-mark" />
        <h1>{title}</h1>
        <p>
          {wrongAccount ? "Use another account to continue with this invitation." : invitationUnavailable ? "Ask the person who invited you for a new invitation, or sign in if you’re already a member." : invitationUnconfirmed ? "Please try again shortly. Your invitation has not been changed." : renewInvitation ? "Enter the email address that received this invitation. Your invitation stays the same." : needsInvitation ? "Edison is invite-only. Open the invitation sent to this email, or ask a member to invite you." : "Edison is invite-only. Already a member? Sign in below."}
        </p>
        {session.status === "unavailable" || linkError === "unavailable" ? <p className="form-error" role="alert">We couldn’t check your access. Please try again shortly.</p> : null}
        {linkError && !["invite_required", "unavailable"].includes(String(linkError)) ? (
          <p className="form-error" role="alert">
            That sign-in link is invalid or has expired. Request a new link
            below.
          </p>
        ) : null}
        {needsInvitation || wrongAccount || invitationUnavailable || invitationUnconfirmed ? null : configured ? (
          <LoginForm returnPath={returnPath} authOrigin={process.env.NODE_ENV === "production" ? "https://edisonreader.com" : undefined} invitationId={invitationId} />
        ) : (
          <div className="setup-message" role="status">
            Authentication is ready for a Supabase project. Add the public
            Supabase environment values to enable sign-in.
          </div>
        )}
        {!invitationId && !needsInvitation ? <p>Have an invitation? Open the link in your email.</p> : null}
        {needsInvitation || wrongAccount ? <form action="/auth/signout" method="post"><input type="hidden" name="next" value={returnPath} />{invitationId ? <input type="hidden" name="invitation" value={invitationId} /> : null}<button type="submit" className="demand-primary">Use another account</button></form> : null}
        {invitationUnavailable ? <Link className="demand-text-action" href={demandLoginPath(returnPath)}>Already a member? Sign in</Link> : null}
        {invitationUnconfirmed ? <Link className="demand-text-action" href={demandLoginPath(returnPath, undefined, invitationId)}>Try again</Link> : null}
      </section>
    </main>
  );
}
