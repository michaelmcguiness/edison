"use client";
import { useEffect, useId, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { DemandWorkspace } from "@edison/contracts";
import { allowanceResetLabel, articleBalance } from "./state";
import { InviteFriends, type InvitationClient } from "./invitations";

const sections = [{ id: "profile", title: "Profile" }, { id: "reading", title: "Reading" }, { id: "usage", title: "Plan & usage" }, { id: "invites", title: "Invite friends" }, { id: "privacy", title: "Data & privacy" }] as const;
type Section = typeof sections[number]["id"];
export function ReaderAccount({ workspace, getIdentity, signOut, onBack, onReading, onAllowance, initialSection = "profile", hasPendingReset = false, invitationsClient }: {
  workspace: DemandWorkspace; getIdentity: () => Promise<{ email: string } | null>; signOut: () => Promise<void>;
  onBack: () => void; onReading: () => void; onAllowance: () => void;
  initialSection?: Section;
  hasPendingReset?: boolean;
  invitationsClient?: InvitationClient;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [email, setEmail] = useState<string | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  useEffect(() => { let active = true; void getIdentity().then((value) => { if (active) { setEmail(value?.email ?? null); setIdentityLoaded(true); } }).catch(() => { if (active) { setError("Your account details couldn’t be loaded."); setIdentityLoaded(true); } }); return () => { active = false; }; }, [getIdentity]);
  const allowance = workspace.allowance;
  return <main className="demand-account">
    <button type="button" className="demand-text-action" onClick={onBack}><ChevronLeft aria-hidden="true" />Back to reading</button>
    <h1>Account</h1><p className="demand-intro">Your profile, reading and usage.</p>
    <label className="demand-account-select-label" htmlFor={id}>Account section</label><select id={id} className="demand-account-select" value={section} onChange={(event) => setSection(event.target.value as Section)}>{sections.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
    <div className="demand-account-layout"><nav aria-label="Account sections">{sections.map((item) => <button key={item.id} type="button" aria-current={item.id === section ? "page" : undefined} onClick={() => setSection(item.id)}>{item.title}</button>)}</nav>
      <section className="demand-account-content" aria-labelledby={`${id}-heading`}>
        <h2 id={`${id}-heading`}>{sections.find((item) => item.id === section)!.title}</h2>
        {section === "profile" ? <><p>{workspace.readerKind === "account" ? "Your loops and reading are connected to your account." : "Edison is invite-only. Sign in through your invitation to continue."}</p>
          <div className="demand-account-row"><span>Email</span><strong>{!identityLoaded ? "Loading…" : email ?? (workspace.readerKind === "guest" ? "Guest reader" : "Unavailable")}</strong></div>
          {workspace.readerKind === "account" ? <><button type="button" className="demand-text-action" onClick={() => setSection("invites")}>Invite friends</button><button type="button" disabled={pending} className="demand-text-action" onClick={() => { setPending(true); setError(""); void signOut().catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : "Sign out could not be confirmed."); setPending(false); }); }}>{pending ? "Signing out…" : "Sign out"}</button></> : null}</> : null}
        {section === "reading" ? <><p>Each loop has its own Direction. Tell Edison what to focus on, explain or avoid in that loop’s editor.</p><p>Direction changes apply to future articles. Your existing reading stays as it is.</p><button type="button" className="demand-primary" onClick={onReading}>Choose a loop to edit</button></> : null}
        {section === "usage" ? <><p className="demand-account-balance">{articleBalance(allowance)}</p>{allowance ? <><p>Your next allowance starts {allowanceResetLabel(allowance)}.</p><div className="demand-account-row"><span>Articles received this week</span><strong>{allowance.periodUsed}</strong></div>{allowance.reserved ? <p>{allowance.reserved} {allowance.reserved === 1 ? "article is" : "articles are"} being prepared. Only accepted articles count toward your used allowance.</p> : null}{allowance.manualResetAt ? <p>The current allowance was reset {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(allowance.manualResetAt))}. Earlier reading is included in this week’s total.</p> : null}{allowance.remaining === 0 ? <button type="button" className="demand-text-action" onClick={onAllowance}>Article allowance</button> : null}</> : <p>Allowance details couldn’t be loaded. Reopen Account to try again.</p>}<p>No payment is required for this temporary reading allowance.</p></> : null}
        {section === "invites" ? invitationsClient ? <InviteFriends key={workspace.workspaceId} workspaceId={workspace.workspaceId} client={invitationsClient} /> : <p>We couldn’t load your invitations. Reopen Account to try again.</p> : null}
        {section === "privacy" ? <><p>Your loops, Direction and conversations are private to your reading workspace. Sharing an article creates a link for Edison members only after you confirm it; it does not share your conversations.</p><p>Deleting a loop removes it from your loops. Saved reading stays in Library, and existing articles and conversations remain available through reading history and article links.</p><p>Account export and deletion are not available in the app yet.</p></> : null}
        {section === "usage" && hasPendingReset ? <p className="demand-scope-note">An interrupted reset needs confirmation. <button type="button" className="demand-text-action" onClick={onAllowance}>Check reset status</button></p> : null}
        {error ? <p role="alert" className="demand-dialog-error">{error}</p> : null}
      </section>
    </div>
  </main>;
}
