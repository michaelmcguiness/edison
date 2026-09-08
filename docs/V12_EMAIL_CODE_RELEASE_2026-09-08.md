# v12 email-code sign-in — September 8, 2026

Owner: CTO. Selected scope: D47 and the approved email-code handoff.
Status: implemented and locally checked; not yet deployed. Design and final
exact-source CI/release verification remain pending at this checkpoint.

## Selected result

Normal entry is email → Send code → one paste/autofill-friendly code field →
Continue. The compact screen uses the installed Inter/Newsreader and existing
full Edison lockup. The note is exactly “Edison is invite-only at this time.”
There is no contact/request-invite/signup CTA or new authentication provider.
Approved pair SHA256:
`bc1ed39a299c8516a1e07cd83a282d1911d09ad313bc72f28b3a4055bc547784`.

Existing Supabase/Resend handles delivery. Only the Magic Link and Confirmation
template bodies change to selectable `{{ .Token }}` and a plain `{{ .RedirectTo }}`
context link. Both candidate bodies have SHA256
`6672d04bfa566f8ad6d0d3f6e739896118baf7d05d4ae76044ded447836a0c28`.
Initial invitation template is unchanged, SHA256
`5a9eb056f5337098195c0fc18318c3332317627f85aee2dc59759a5ed3d457e9`.
Existing subjects, sender, secrets, Auth policy, redirects and expiry stay unchanged.

## Identity, membership and recovery

- The installed SDK requests closed-signup OTP; only an invitation plus the
  definite422 `signup_disabled` rejection can renew via Confirmation resend.
  Unknown/throttled delivery never automatically falls back or sends twice.
- Email codes verify with email/token/type `email`, without browser PKCE. The
  isolated verifier cannot persist/broadcast a browser session. Cookie commit
  is guarded by the current challenge and project-Auth-cookie identity captured
  before verification. A superseded response cannot overwrite a newer session
  in the tested same-controller/two-mounted-controller SDK races. This is not a
  cross-process transactional-cookie-lock guarantee.
- Change email clears the old challenge and fences delayed send/verify results.
  Identity switching is briefly disabled during the bounded cookie commit.
  HTTP408, network loss and5xx are uncertain, not asserted expiry. Supabase's
  `otp_expired` also covers invalid codes, so the UI does not infer true expiry.
- Check sign-in status first validates a matching saved session read-only, then
  may retry only the original verified candidate under its original cookie guard.
  No delivered browser credential means a lost response remains uncertain.
  A further code send is explicit, after the status check and pacing guard.
- Normal resend pacing remains60 seconds; actual Retry-After can extend it.
  Full response headers/body are bounded; there is no automatic verification
  submission when typing/pasting the final digit.
- A fresh browser opening the plain email context link retains the exact invite
  and safe reading destination. Email → Continue there uses the already-received
  code without sending another one. No email, OTP or Auth token enters that URL.
- Tokenless GET never verifies a code or redeems an invitation. A verified
  invitee receives a real session-type acceptance context, not a dummy token.
  Explicit same-origin nonce POST rechecks identity, exact-recipient redemption,
  and active membership.408/429/5xx and malformed membership replies retain
  recovery context. Old token/hash and PKCE email links remain compatible.

No API runtime, schema, migration, membership rule, invitation count,500/week
allowance, reset behavior, $10 rolling daily/$40 monthly ceiling or provider key
changes are included. Code verification alone does not admit pending/revoked
readers or grant another five invitations.

## Verification checkpoint

Actual installed SDK2.112.4 with injected synthetic responses/cookie jars exercises
the save-before-promise negative control, stale old-email commits, simultaneous
mounted controllers, later recovery, cookie chunks, new saved identities, lost
responses, exact Confirmation fallback and request pacing. Actual TSX handlers,
route handlers and locally rendered Next pages are separate from provider proof.

Both production builds, standalone types and full lint passed locally. Final
local unit runs passed735 web and269 API tests (1004 total), none skipped.
Exact committed-source CI remains pending at this checkpoint.
Four stale duplicate ignored API-generated type files were preserved at
`/private/tmp/edison-api-type-duplicates.HvehTp`; no typecheck rules were relaxed.

Root directly inspected the actual390px normal/code forms, empty submission
focus, leading-zero entry without automatic submission and explicit Continue.
The existing synthetic article opened after correcting a local-runner flag from
`1` to literal `true`; the earlier local404 was not a production application fix.
Design directly checked320/390/1440px normal/error/long-address code forms,
leading-zero paste, explicit Continue, Change email and visible keyboard focus.
Its sole current finding—the linked masthead's36px hit area—was increased to44px
with compensating margins, without enlarging the artwork. Rendered fix review
and invitation/recovery browser checks follow.

Local fixture evidence sends no real mail, changes no production account, and
calls no model. Real email delivery, physical phone keyboard/OS autofill and a
fresh production signed-in journey are not established by these tests. Hosted
OTP length/expiry are not inferred from local configuration or promised in copy.

## Coordinated rollout and rollback

1. Freeze the candidate, pass exact-source CI and close Design's bounded review.
2. Deploy only the existing Vercel web project to edisonreader.com. Verify exact
   source, aliases, public sign-in and unchanged private-content gating. Leave
   the API deployment and its three schedules untouched.
3. Save only the two reviewed Supabase email bodies after the compatible web is
   live. Do not run wholesale `supabase config push` or change Auth settings.
   Verify template persistence and preserve the initial invitation template.
4. Keep delivery/session proof explicitly separate; no real test recipient or
   paid generation is authorized by this release QA.

If reverting to the old UI, restore the preceding link-email bodies before
rolling the web back; the old UI cannot use newly emailed codes. The v12 web
remains compatible with old sent links throughout the forward rollout. Do not
redeploy API, reset history, revoke existing access or change domains to roll
back this bounded web/template change.
