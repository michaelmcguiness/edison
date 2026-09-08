import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { EdisonMark } from "@/components/edison/brand";
import { AcceptanceForm } from "@/components/auth/acceptance-form";
import { decodeInvitationAcceptance, invitationAcceptanceCookie } from "@/lib/invitation-acceptance";
import { readInvitationAcceptance } from "@/lib/member-access";
import { demandLoginPath } from "@/lib/demand-auth-continuation";
import { acceptanceView, invitationExpiryLabel, type AcceptancePreview } from "@/components/auth/invitation-entry-state";
import "../../demand.css";

export const dynamic = "force-dynamic";
// The token-bearing GET strips its referrer before redirecting here. This clean
// page permits same-origin form Origin headers, but never an external referrer.
export const metadata: Metadata = { title: "Continue — Edison", referrer: "same-origin", robots: { index: false, follow: false } };

export default async function AcceptancePage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const context = decodeInvitationAcceptance((await cookies()).get(invitationAcceptanceCookie(process.env.NODE_ENV === "production"))?.value);
  const preview: AcceptancePreview = context?.invitationId ? await readInvitationAcceptance(context.invitationId) : { state: context ? "available" : "unavailable" };
  const invitation = Boolean(context?.invitationId || context?.type === "invite");
  const view = acceptanceView({ hasContext: Boolean(context), invitation, preview: preview.state, error });
  const maskedEmail = preview.state === "available" ? preview.maskedEmail : null;
  const expiry = preview.state === "available" && preview.expiresAt ? invitationExpiryLabel(preview.expiresAt) : null;
  const switchAccount = preview.state === "wrong_account" || error === "wrong_account" || error === "invite_required";
  const renewSignIn = error === "expired" && preview.state === "available";
  return <main className="login-page invitation-entry"><section className="login-card">
    <EdisonMark className="onboarding-mark" /><h1>{view.title}</h1>
    {maskedEmail ? <p>Invitation for {maskedEmail}</p> : null}
    <p>{view.message}</p>{expiry ? <p className="invitation-expiry">Invitation expires {expiry}.</p> : null}
    {view.action && view.action !== "refresh" && context ? <AcceptanceForm nonce={context.nonce} returnPath={context.returnPath}
      mode={view.action === "continue" ? "accepted" : invitation ? "invitation" : "signin"}
      label={view.action === "continue" ? "Continue to reading" : view.action === "recover" ? "Check status" : invitation ? "Accept invitation" : "Continue signing in"} /> : null}
    {context && switchAccount ? <form action="/auth/signout" method="post"><input type="hidden" name="next" value="/auth/accept" /><button type="submit" className="demand-text-action">Use another account</button></form> : null}
    {renewSignIn && context ? <Link className="demand-primary" href={demandLoginPath(context.returnPath, undefined, context.invitationId ?? undefined)}>Get new sign-in link</Link> : null}
    {view.action === "refresh" ? <Link className="demand-primary" href="/auth/accept?error=expired">Check status</Link> : null}
    {view.action !== "continue" ? <Link className="demand-text-action" href={demandLoginPath(context?.returnPath ?? "/")}>{invitation ? "Already a member? Sign in" : "Request a new sign-in link"}</Link> : null}
  </section></main>;
}
