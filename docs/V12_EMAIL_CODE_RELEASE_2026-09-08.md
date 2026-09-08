# v12 email-code sign-in — September 8, 2026

Owner: CTO. Selected scope: D47 and the approved email-code handoff.
Status: live on edisonreader.com. Exact-source CI, bounded Design/browser checks,
web deployment and both hosted email-body persistence checks passed. Actual email
delivery and a fresh hosted signed-in journey remain unverified.

## D48 follow-up — six digits prepared, production correction blocked

Michael requested a maximum of six digits after the v12 rollout. The bounded
source correction requires exactly six numeric digits in both form submission
and controller verification. Whole-value input handling rejects and clears long
paste/autofill values rather than silently truncating them or retaining a previous
complete code. Spaces normalize without losing leading zeros. Guidance explicitly
offers Resend code for an older long code; the existing cooldown and uncertain
sign-in status check still apply, with no automatic send or verification.

All 738 web tests, including 34 focused controller/form cases, passed locally;
owned lint, standalone TypeScript and the web production build passed. The two
production files are `components/auth/login-form.tsx` and `lib/email-code-auth.ts`;
their existing focused test files carry the regressions. No API, template, schema,
SDK cookie transport or invitation-lifecycle implementation changed.

The hosted Email provider UI showed OTP length **8** and expiration **3600 seconds**;
local `supabase/config.toml` was already 6. CTO edited only the displayed length
to 6, but normal approval review rejected Save before execution because this
production Auth-setting authority was relayed. The unsaved edit was canceled
and the owned settings tab closed. A subsequent coordination message was also
rejected as an indirect workaround; both CTO and Chief of Staff stopped that
provider handoff. CoS confirmed it had attempted no provider change. No alternate
API, credential, settings route or production web deployment was used.

The prepared strict-six web must not deploy until the actual hosted generator
change is explicitly approved and independently reads back 6. TTL, policies,
SMTP, templates, sessions and resend controls must remain unchanged. Older issued
long codes are not to be shortened in the email or browser; readers can explicitly
request a replacement when pacing permits. Chief of Staff owns the precise next
approval request. The v12 deployment and historical receipt below remain live.

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
The two sign-in subjects, sender, secrets, Auth policy, redirects and expiry were
not changed. The initial invitation subject was not edited; its displayed value
has a separately recorded discrepancy with an older receipt below.

## Identity, membership and recovery

- The installed SDK requests closed-signup OTP; only an invitation plus the
  definite 422 `signup_disabled` rejection can renew via Confirmation resend.
  Unknown/throttled delivery never automatically falls back or sends twice.
- Email codes verify with email/token/type `email`, without browser PKCE. The
  isolated verifier cannot persist/broadcast a browser session. Cookie commit
  is guarded by the current challenge and project-Auth-cookie identity captured
  before verification. A superseded response cannot overwrite a newer session
  in the tested same-controller/two-mounted-controller SDK races. This is not a
  cross-process transactional-cookie-lock guarantee.
- Change email clears the old challenge and fences delayed send/verify results.
  Identity switching is briefly disabled during the bounded cookie commit.
  HTTP 408, network loss and 5xx are uncertain, not asserted expiry. Supabase's
  `otp_expired` also covers invalid codes, so the UI does not infer true expiry.
- Check sign-in status first validates a matching saved session read-only, then
  may retry only the original verified candidate under its original cookie guard.
  No delivered browser credential means a lost response remains uncertain.
  A further code send is explicit, after the status check and pacing guard.
- Normal resend pacing remains 60 seconds; actual Retry-After can extend it.
  Full response headers/body are bounded; there is no automatic verification
  submission when typing/pasting the final digit.
- A fresh browser opening the plain email context link retains the exact invite
  and safe reading destination. Email → Continue there uses the already-received
  code without sending another one. No email, OTP or Auth token enters that URL.
- Tokenless GET never verifies a code or redeems an invitation. A verified
  invitee receives a real session-type acceptance context, not a dummy token.
  Explicit same-origin nonce POST rechecks identity, exact-recipient redemption,
  and active membership. 408/429/5xx and malformed membership replies retain
  recovery context. Old token/hash and PKCE email links remain compatible.

No API runtime, schema, migration, membership rule, invitation count, 500/week
allowance, reset behavior, $10 rolling daily/$40 monthly ceiling or provider key
changes are included. Code verification alone does not admit pending/revoked
readers or grant another five invitations.

## Verification checkpoint

Actual installed SDK 2.112.4 with injected synthetic responses/cookie jars exercises
the save-before-promise negative control, stale old-email commits, simultaneous
mounted controllers, later recovery, cookie chunks, new saved identities, lost
responses, exact Confirmation fallback and request pacing. Actual TSX handlers,
route handlers and locally rendered Next pages are separate from provider proof.

Both production builds, standalone types and full lint passed locally. Final
local unit runs passed 735 web and 269 API tests (1,004 total), none skipped.
Exact committed source `f3cde89bdf7ae57a691b70a183fc3432559acdd3` passed
[CI 34233984377](https://github.com/michaelmcguiness/edison/actions/runs/34233984377)
at 13:50:37 UTC: every job and step succeeded, none skipped. This includes the 1,004
unit tests, both builds, lint/types, 320 pgTAP assertions, all seven database/service
proof steps and schema lint. Independent CI inspection matched that source.
Four stale duplicate ignored API-generated type files were preserved at
`/private/tmp/edison-api-type-duplicates.HvehTp`; no typecheck rules were relaxed.

Root directly inspected the actual 390px normal/code forms, empty submission
focus, leading-zero entry without automatic submission and explicit Continue.
The existing synthetic article opened after correcting a local-runner flag from
`1` to literal `true`; the earlier local 404 was not a production application fix.
Design directly checked 320/390/760/1024/1440px representative normal/error/long-address code forms,
leading-zero paste, explicit Continue, Change email and visible keyboard focus.
Its sole current finding—the linked masthead's 36px hit area—was increased to 44px
with compensating margins, without enlarging the artwork. Design reloaded the
actual 390px page, measured 44px and confirmed unchanged composition; the finding
and bounded review are closed. Its evidence is recorded in
`docs/brand/V12_AUTH_IMPLEMENTATION_DESIGN_REVIEW_2026-09-08.md` (Design-owned).

Root then directly exercised the actual local Next/SDK browser flow:

- Pending, unconfirmed synthetic invitee: one OTP request received the exact
  422 rejection, then one Confirmation resend issued code 000124. A separate
  signed-out tab opened its plain context URL and entered that already-received
  code without another send. Exact invitation and original article were retained.
- After verification, tokenless GET staged “Accept invitation” while membership
  remained pending. Explicit acceptance returned to the original sensor article.
  No GET redeemed the invitation; the old article and 125 conversation turns remained.
- A synthetic verify response lost after remote consumption showed “We couldn’t
  confirm whether you’re signed in.” Check sign-in status made no second verify or
  send. Only an explicit replacement send issued code 000126; explicit Continue
  returned to the same article. Final counters were 4 OTP requests, 1 Confirmation
  resend, 4 verifies; allowance 494 and five invitation slots were unchanged.

The first local handoff attempt caught a disposable-runner fault: two Next
package identities split request storage, so `cookies()` failed outside request
scope. Replacing only the isolated package symlink with a byte-identical physical
package fixed it; no application rule or source changed. All 11 relevant auth-file
hashes matched the frozen candidate. This local issue was not a production bug.
Separate-tab evidence is not a clean new-browser profile or physical-device proof.

Local fixture evidence sends no real mail, changes no production account, and
calls no model. Real email delivery, physical phone keyboard/OS autofill and a
fresh production signed-in journey are not established by these tests. Hosted
OTP length/expiry are not inferred from local configuration or promised in copy.

## Live receipt — September 8

Web-only production deployment `dpl_8kzhBZuCnfYvdpJnjywZGD6D7sTc` runs exact
`f3cde89bdf7ae57a691b70a183fc3432559acdd3`, pinned in both Git source and commit
metadata. It became Ready at 14:00:54.245 UTC, with aliases assigned 14:00:54.492 UTC.
Host: `edison-lxnqecgat-mike-michaelmcguis-projects.vercel.app`; existing aliases
include edisonreader.com, www.edisonreader.com and project-qlqve.vercel.app.
Normal deployment review accepted this existing-project production action.
Independent CTO-agent and Chief of Staff metadata checks matched the deployment.

API remains `dpl_Fxu7wuq3jEMr85PxLFa5pj5fMp5N` on exact
`785861a3a25a8b7bdbe5ee1d0fafb60f91ffc7ee`, with project-fjr95.vercel.app still
pointing to it. All three enabled cron definitions retain the existing API host
`edison-h0swtz5uw-mike-michaelmcguis-projects.vercel.app` and cadences. There was
no API deployment, migration, environment, secret, billing or domain change.

After the compatible web was Ready, CTO saved only the Confirmation body and
then the Magic Link/OTP body through their existing Supabase editor pages. Each
was selected/copied in full before Save and again after a fresh page reload;
both readbacks matched the reviewed 1,771-character body exactly. Both retained
subject “Continue to Edison”. The two save/reload checks completed by 14:04:13 UTC.
This is hosted editor persistence evidence, not an independent provider-settings
API export or actual delivered-email proof. No SMTP/Auth policy/expiry/redirect
controls were edited and no email was sent by this verification.

Initial Invite was not edited or saved. Its full displayed body was read-only
copied and matched the unchanged repository body. Its subject input displayed
empty after a fresh reload, unlike the earlier receipt's “You’re invited to
Edison” wording. CTO did not infer a delivered subject or change this unrelated
field. Chief of Staff treats this as a separate read-only evidence discrepancy,
not a failure of the selected two-template rollout.

Root reloaded the actual apex sign-in and inspected its 390px screenshot: the
approved full lockup, Send code form and exact invite-only note are live. At
14:07:04 UTC, independent root HTTP checks returned login 200, private article 307
to login retaining the exact destination, private/no-store and nonce CSP,
www 308 to the apex, and API health 200 with configuration/database/Auth all “ok”.
Chief of Staff independently verified anonymous root/article/share gating and
the same deployment/cron state. No fresh production member session, real mailbox
delivery, physical keyboard/autofill or real-provider writing was exercised.

Four root local test tabs were closed and temporary viewport overrides reset.
Only the two isolated test servers were stopped; ports 4310/4311 were confirmed
clear. Disposable source/cache evidence and all unrelated repository work remain.

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

The exact preceding bodies are preserved at
`785861a3a25a8b7bdbe5ee1d0fafb60f91ffc7ee:supabase/templates/magic-link.html`
and the same revision's `confirmation.html`, each SHA256
`b8305bea32a346115789c74e046066c3d4bd1f32f2c44b09cfe49543884a63e8`.
Restoring those templates does not convert code emails already sent. Keeping the
compatible v12 web and applying a bounded forward fix avoids that old-UI limitation.
