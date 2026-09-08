import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { uuidSchema } from "@edison/contracts";
import { LoginForm } from "@/components/auth/login-form";
import { EdisonLogo } from "@/components/edison/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDemoMode } from "@/lib/app-mode";
import { demandLoginPath, safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";
import { readInvitationAcceptance, readMemberSession, readSignedInEmail } from "@/lib/member-access";
import "../demand.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Edison", referrer: "same-origin", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[]; invitation?: string | string[]; code?: string | string[] }>;
}) {
  if (isDemoMode()) redirect("/");
  const { error: linkError, next, invitation, code } = await searchParams;
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
  const blocked = needsInvitation || wrongAccount || invitationUnavailable || invitationUnconfirmed;
  const signedInEmail = needsInvitation || wrongAccount ? await readSignedInEmail() : null;
  const title = wrongAccount ? "Use your invited email." : preview?.state === "expired" ? "This invitation has expired." : invitationUnavailable ? "This invitation is no longer available." : invitationUnconfirmed ? "We couldn’t check this invitation." : "An invitation is needed.";
  const initialMessage = session.status === "unavailable" || linkError === "unavailable" ? "We couldn’t check your access. Please try again shortly."
    : linkError && !["invite_required", "unavailable"].includes(String(linkError)) ? "That sign-in link no longer works. Use a code to continue." : undefined;
  const retryPath = `${demandLoginPath(returnPath, undefined, invitationId)}${code === "1" ? "&code=1" : ""}`;

  return (
    <main className="email-code-entry">
      <section className="email-code-card">
        <Link href="/" className="email-code-brand" aria-label="Edison home"><EdisonLogo /></Link>
        <div className="email-code-main">
        {blocked ? <>
          <h1>{title}</h1>
          <p className="email-code-intro">{wrongAccount ? "Change email to continue with this invitation." : invitationUnavailable ? "Sign in if you’re already a member." : invitationUnconfirmed ? "Please try again shortly. Your invitation has not been changed." : "Open the invitation sent to your email to continue."}</p>
          {signedInEmail ? <p className="email-code-signed-in">Signed in as <span>{signedInEmail}</span></p> : null}
        </> : configured ? (
          <LoginForm returnPath={returnPath} authOrigin={process.env.NODE_ENV === "production" ? "https://edisonreader.com" : undefined} invitationId={invitationId} initialMessage={initialMessage} hasCode={code === "1"} />
        ) : (
          <div className="setup-message" role="status">
            Authentication is ready for a Supabase project. Add the public
            Supabase environment values to enable sign-in.
          </div>
        )}
        {needsInvitation || wrongAccount ? <form action="/auth/signout" method="post"><input type="hidden" name="next" value={returnPath} />{invitationId ? <input type="hidden" name="invitation" value={invitationId} /> : null}<button type="submit" className="email-code-primary">Change email</button></form> : null}
        {invitationUnavailable ? <Link className="email-code-link" href={demandLoginPath(returnPath)}>Already a member? Sign in</Link> : null}
        {invitationUnconfirmed ? <Link className="email-code-link" href={retryPath}>Try again</Link> : null}
        <p className="email-code-support">Edison is invite-only at this time.</p>
        </div>
      </section>
    </main>
  );
}
