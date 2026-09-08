# v11.1 release candidate — September 7, 2026

Owner: CTO. Status: **source, CI/database and bounded integrated Design gates
closed; web/API and migrations live; invitation sending configured and enabled
under D45. Actual email delivery and fresh authorized reading remain unverified**.
Final application candidate:
`785861a3a25a8b7bdbe5ee1d0fafb60f91ffc7ee`.
Updated September 8, 2026 at 12:36 UTC (September 8 in New York).

## Selected scope

D42–D44 authorize the approved mobile-first v11.1 reader, trusted SVG article
art, 500 offered articles per UTC week with an auditable current-week password
reset, and invite-only membership with five initial lifetime invitation slots.
Existing admitted members and historical content remain intact. Refresh replaces
the current article set while reading origins retain their original sequence.
Global provider budgets remain $10 rolling daily / $40 monthly; no pricing,
checkout, native app, new image-provider call or automatic invitation is added.

Selected design index SHA256:
`e8172d598e7bed5550d567326e76180c0fa61edf1477fe1cf890777e07a866cd`.
Current invitation addendum SHA256:
`e76c9e272e30ad5769b564c93d540f9ead82df7d3255674ad2811251d047e57d`.

## Implemented boundary

- All live reading and former public article/share endpoints require verified,
  active membership. Link-preview metadata is generic. Legacy/admin email lists
  remain restricted; demand member access does not inherit an owner-only list.
- New Auth profiles are pending. Explicit acceptance by the exact verified
  recipient is the only invitation-based admission path. Revoked memberships
  cannot reactivate through acceptance; existing members get no second grant.
- Five lifetime slots: pending/unknown reserves, initial definitive failure or
  unaccepted expiry/revocation releases, redemption consumes permanently.
  Immutable operation/delivery receipts prevent transport retries from sending
  another email or spending another slot. Resend retains the same invitation.
- Email GET stages an HttpOnly context without consuming Auth or membership.
  Explicit same-origin, nonce-bound POST verifies and accepts. Read-only accepted
  preview supports lost-response recovery for the exact active recipient.
- A still-valid Edison invitation can outlive an Auth link. Verification renewal
  preserves that invitation and destination, with no slot/expiry/membership change.
- Weekly grants, allocations, resets and receipts preserve prior jobs, costs and
  reservations. Final 1–5 articles are usable; only actual offered articles count.

## Provider path and required hosted configuration

Required configuration is listed below. Migrations, web/API deployment,
API-only sensitive reset configuration, and the three email templates are now
applied. **The invitation flag and API-only sensitive Auth secret are now enabled
in the freshly deployed API**. See the September 8 activation receipt below;
earlier disabled-sender checkpoints and rejected reviews are historical.

1. Migrations `20260907000400_demand_weekly_allowance.sql` and
   `20260907000500_demand_invitation_membership.sql`, after actual disposable
   PostgreSQL and release review. Do not replace or rerun prior migrations.
2. API-only `EDISON_MEMBER_INVITATIONS_ENABLED=true` with narrowly scoped
   server-only `SUPABASE_SECRET_KEY` for Auth invitation sending. Never put this
   key in web/Preview/browser code. Legacy service-role keys remain prohibited.
3. API-only `EDISON_DEMAND_ALLOWANCE_RESET_PASSWORD`, matching the selected
   temporary password. No client fallback, hint or plaintext UI implementation.
4. Hosted Invite, Magic Link and Confirm Signup email templates matching
   `supabase/templates/`. All preserve `.RedirectTo`, append the exact token hash
   and use scanner-safe confirmation. Signup and anonymous Auth remain disabled.
5. Existing API/web targets only. The canonical email callback is on
   `https://edisonreader.com`, including when sign-in starts on the retained alias;
   no wildcard redirect, origin, domain or new service is needed.

Admin invite handles new/unconfirmed users; only definite confirmed-existing
`email_exists` permits a no-signup OTP fallback. For recipient verification
renewal, only definite `422 signup_disabled` permits one existing-user signup
resend. Unknown/429/5xx outcomes never trigger a second transport automatically.
These paths were checked against installed Auth SDK 2.112.4 and upstream source,
not the hosted Auth version or actual mail delivery:
[invite](https://github.com/supabase/auth/blob/master/internal/api/invite.go),
[OTP](https://github.com/supabase/auth/blob/master/internal/api/otp.go),
[magic link](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go),
[signup](https://github.com/supabase/auth/blob/master/internal/api/signup.go),
[resend](https://github.com/supabase/auth/blob/master/internal/api/resend.go),
[verification](https://github.com/supabase/auth/blob/master/internal/api/verify.go).

Accepted limits: the upstream public Auth endpoint can expose account-existence
differences; generic Edison UI and sender lifecycle do not eliminate those.
Actual Edison expiry is shown on the acceptance page/list, not invented in mail.
Cross-device continuation uses an available validated destination, otherwise
Edison home; device-local reading memory is not transferable by assumption.

## Verification and outstanding gates

The exact final candidate passed [CI 34178380633](https://github.com/michaelmcguiness/edison/actions/runs/34178380633):
680 web + 269 API tests (949 total), both typechecks, full lint, both production
builds, 12 pgTAP files / 320 assertions, all disposable database integrations and
strict schema lint. Both application/database jobs succeeded; no required step
was skipped. Chief of Staff independently confirmed this exact run.

At 02:01:00 UTC the allowance integration passed final1–6,500/501,partial0–6,
replay, reserve/reset/settlement contention, old-revision retry, UTC rollover,
guest/account continuity, isolation and unchanged nonzero spend. At02:01:05 UTC
the invitation integration passed five lifetime slots, explicit confirmed
email-bound acceptance, pending/failed/unknown/replay/expiry, immutable receipts,
separate-backend create/accept/revoke races, reset and nonzero spend preservation.
All recipients were synthetic, with zero external HTTP/email/provider calls.

Earlier CI failures were corrected, not waived: historical fixture timestamp
ordering, approved-model/frozen-context sentinel setup, raw SQL Date encoding,
and a real production permission mismatch. The last was fixed by removing an
unused row lock on immutable invitation grants; the shared admission advisory
lock remains, and no UPDATE privilege was added. The complete corrected suite
first passed at45d2f1f and passed again at the final UI successor above.

Local full checks at a28720e passed938 tests and both builds; subsequent focused
checks covered the final11 new overlay-history tests. Local generated duplicate
Next type-cache files cleared through the normal build; no source workaround was
used. Final full-suite evidence is the exact CI run, not an inferred local rerun.

Rendered local QA uses the actual Next app with an explicitly opt-in synthetic
Auth/API service (`EDISON_V11_MEMBER_FIXTURE=1`). The real installed SDK writes
normal cookies; there are no real recipients, credentials, provider calls or
database calls. `authProof:false` is intentional: the fixture does not establish
hosted Auth security, SMTP delivery or durable accounting.

Rendered blockers are closed. Clean login/acceptance pages use same-origin
referrers; token-bearing GET remains no-referrer and strict POST Origin remains.
The isolated Next request-cookie failure was a duplicated dependency-resolution
context, resolved only in the disposable render environment by a byte-identical
physical copy of installed Next and correct dependency lookup; no production
framework/security bypass was added. Uninstrumented native confirmation passed.

Actual browser journeys included:

- Scanner-safe GET, explicit acceptance, expired Auth link with still-valid
  invitation, one SDK OTP→confirmation-resend fallback, then renewed explicit
  acceptance of the same invitation. No activation occurred on GET/renewal alone.
- Explicit account-only recovery after a one-use synthetic startup error;
  same workspace, eight loops, two retained articles,125-turn conversation and
 494 allowance returned. Cookie non-transfer/non-deletion rules have separate
  proxy/unit coverage; the constructed error is not proof of hosted Auth security.
- Invite send/failure/unknown/replay, accepted-versus-revoke UI, normalized
  same-recipient Check status (including Enter), expired lease→Delivery
  unconfirmed→same-ID resend with four remaining, actual expiry display.
- Final-four refresh retained six old choices while pending, accepted two
  charged two, and Next/reload kept the original sequence. Return retained the
  old set until explicit Latest articles selected the replacement.
- Zero allowance remained dismissible; wrong password was rejected; a lost reset
  response recovered the same operation, with500 remaining, prior period usage
  intact and no generation. Final reset completion immediately closed the wall
  and focused Refresh. Repeated Curate Enter/Escape and explicit close focused
  Curate. Modal teardown and delayed-history reconciliation regressions passed.

Design closed V1–V4/E1 at785861a with no material remaining finding or new design
approval hold. [Native screenshot manifest](evidence/v11.1/manifest.json) records
pixels, MIME, hashes and capture phases; selected native JPEGs are retained
without pixel changes. Earlier malformed/scaled/gray-overlay frames are not
accepted as final width/header evidence. Clean320 entry and1024 final feed were
captured. At02:02 UTC all182 tracked web/app/component/client/contract/public
files in the isolated renderer matched the final candidate byte-for-byte.
Earlier progression frames are not retroactively attributed to the final build.

Limits: no physical iOS/Android device/software keyboard,200% browser zoom or OS
reduced-motion execution; relevant CSS/source checks are separate. No hosted
Auth-version, real mail delivery, editorial/model-quality or restore rehearsal
claim is made from this local evidence. No broad repeat audit is needed.

## Exact existing-target rollout bundle

Source/Design/CI gates and Chief of Staff's concrete bundle review are closed.
The reviewed order below is retained as the execution plan. Steps1–5 have been
performed. Step6 was initially rejected before execution, then accepted through
normal review in the task containing Michael's direct D45 approval; the fresh
API deployment is live. Step7 read-only verification and its limits are recorded
below. No test invitation or paid generation was used.

1. Record current deployment IDs and exact migration list; verify a recent
   backup/checkpoint. Review linked migration dry-run showing only004 then005.
   Never use the Vercel runtime database secret as the migration credential.
2. Apply only004→005 in the existing Supabase project. Preserve all earlier
   migrations, current active/revoked memberships, histories and ledgers.
3. Deploy this exact API source initially with invitation sending disabled
   (`EDISON_MEMBER_INVITATIONS_ENABLED=false` or absent) and its new Auth secret
   absent. Add the selected reset value only as sensitive API Production config.
   Preserve demand enablement, strict TLS, current DB/cron, exact CORS and
   unchanged $10 rollingdaily/$40 monthly provider limits and model/check policy.
4. Deploy the same source to the existing web project/apex. Verify scanner-safe
   confirmation/acceptance routes before enabling delivery. Web receives only
   its existing public Auth/API configuration, never either new server secret.
5. Apply the reviewed Invite, Magic Link and Confirm Signup templates. Preserve
   `.RedirectTo`, exact token hash including any`pkce_` prefix, invitation/next
   context; Invite type=invite, other two type=email. No tracking, wildcard,
   domain or localhost redirect changes. Keep global signup/anonymous disabled.
6. Enable invitation flag and current-format`sb_secret_` key on API Production
   only, run credential-safe preflight, redeploy the same source. Do not use a
   legacy service-role/direct Resend key or enter secrets in chat/source/logs.
7. Verify actual source/aliases, health, apex CORS, negative membership checks,
   an existing authorized read, migration/RLS/immutable-grant protections and
   all three cron hosts/cadences after the last API deployment. Do not create
   invites, reset allowance or generate articles merely for release QA.

Targets: Supabase`bcxxnntastmnormcmxbq`; API`prj_BDlcI2KFhFawilRiMDvloXcOLnsd`
(`edison-api`, root`apps/api`); web`prj_TLrYocZ2r6okKwPr59ht2XQo8bmp`
(`edison-app`, repository root). Existing apex, www redirect, API and retained
web alias stay; no new environment, service or paid plan.

Read-only Vercel metadata at the original 02:02 UTC preparation checkpoint
confirmed API production was
`dpl_GesKd8nJZi9d21ne4qrA7QLDxUmP`, with all three enabled cron definitions on
`edison-jxsjvit8r-mike-michaelmcguis-projects.vercel.app`. API Production then had no
`SUPABASE_SECRET_KEY`, invitation flag or reset-password variable. Only
variable names/types/targets were read, not secret values. Existing deployment
session was authenticated. These were preparation facts, not connectivity proof.

## September 7 hosted checkpoint — invitation activation pending (historical)

The latest completed physical daily backup was1601031663, created
2026-09-07T04:40:27.146Z. PITR is disabled; no backup restore was rehearsed.
Linked migration dry-run listed only004 then005. The approved apply succeeded
for exactly those two migrations; a subsequent linked list confirmed all21
local/remote entries match. No seeds, roles or earlier migrations were applied.

Both fresh Git-source deployments pin785861a, use existing project settings and
current Production configuration, and are **READY / PROMOTED**. The final
sanitized provider receipt was read at02:36:34–02:36:37 UTC:

| Target | Live deployment | Ready UTC |
| --- | --- | --- |
| API | `dpl_FvfGDUC8BGXZrAbnefrcbGYa8L85` | 02:21:57.081 |
| Web | `dpl_FBkgbqz8NBLTnSVGBH9TmTYAhz5n` | 02:24:30.427 |

API alias remains`project-fjr95.vercel.app`; actual host is
`edison-41ad37vh5-mike-michaelmcguis-projects.vercel.app`.
Web aliases include`edisonreader.com`,`www.edisonreader.com` and retained
`project-qlqve.vercel.app`; actual host is
`edison-nfhgrsihw-mike-michaelmcguis-projects.vercel.app`.
Both resolved Git-source and GitHub metadata SHA equal the exact candidate.
No new domain, environment, provider or paid plan was created.

All three API schedules are enabled and bound to the new API deployment/host:
feed-command and generation-job reconciliation each`*/5 * * * *`, daily-edition
scheduling`5 * * * *`. Web has no cron definitions.

API Production has sensitive`EDISON_DEMAND_ALLOWANCE_RESET_PASSWORD` and plain
`EDISON_MEMBER_INVITATIONS_ENABLED=false`. `SUPABASE_SECRET_KEY` is absent.
The web project has none of these server-only names, and the reset variable has
only the Production target. Existing D32 limits were not changed by this rollout.
Targeted nonsecret value reads at02:39:32–02:39:33 UTC independently confirmed
daily`10000000` microUSD and demand enabled`true`. The monthly override remains
absent, retaining the deployed source's`40000000` microUSD default. No general
environment-value dump or secret retrieval was used for these checks.

After web promotion, the reviewed local Invite, Magic Link and Confirm Signup
bodies were entered through the existing Supabase editor and saved. Invite uses
type=invite; the other two use type=email. The reviewed subjects were saved too.
Editor line counts/link content and save-state confirmations were inspected;
this is UI submission/persistence evidence, not an independent hosted byte-hash
or actual-delivery claim. No email was sent. Site URL remains the exact apex,
with the same four apex/retained-alias callback/confirm redirect entries. No
wildcards or localhost redirects were added. Signup, anonymous and manual
linking remain off; email confirmation remains on and the email provider enabled.
Existing SMTP configuration was not changed.

Read-only hosted verification:

- API`/v1/health`200: configuration, database and Auth all OK. An initial probe
  at the nonexistent unversioned`/health`returned404; the actual versioned
  readiness endpoint above passed.
- Exact-apex CORS preflight204 with only the intended grant; unapproved origin
 403 without a CORS grant. Unauthenticated demand access/loops, former public
  article/share paths and all three cron paths returned401. No authorized cron
  invocation or fabricated identity was used.
- Apex redirects unauthenticated readers to login; login200. Confirmation GET
  without a token303 to invalid-invite entry, acceptance entry200 with nonce CSP
  and no-store. No real token was consumed.
- Independent read-only database checks passed at02:25:14 UTC: all10 new tables
  have forced RLS and expected worker-only permissions; immutable guards,
  validated constraints and restrictive foreign keys are present. All nine
  normalized function bodies match the selected migrations. New profiles default
  pending; invitation functions are worker-only and old PostgREST share access
  is denied.
- Current aggregate checkpoint: one active membership; no invitation/grant/
  operation rows and no allowance/reset/claim rows. Existing history contains
 9 loops,33 ideas,81 stages; requests24 succeeded/13 failed with none active.
  Demand ledger81 rows/1,294,319 microUSD, legacy ledger4 rows/346,754 microUSD,
  no unpriced rows. This is a current aggregate, not a before/after proof.
- Reloading the previously open production article led to the invite-only login
  screen because no usable sign-in session remained. The live entry was directly
  viewed; **a fresh hosted authorized-reading check is still pending sign-in**.
  No sign-in email, test invitation, redemption, allowance reset or new article
  generation was requested merely for release QA.

### Initial approval blocker and next owner

Normal review rejected the command before it ran: read the existing current-format
Supabase server key, keep it in memory, and store it as sensitive API Production
`SUPABASE_SECRET_KEY` on the existing Vercel API project. The reviewer stated that
the user had not specifically authorized exposing that credential to that
destination. **No secret lookup or transfer executed.** No alternate task, tool,
credential or indirect route may bypass that rejection.

The key is privileged server access, so its destination must be explicitly
approved. Chief of Staff owned the single specific approval question to Michael;
that approval was subsequently received as recorded below. Resubmit the exact transfer through
normal review, then update the existing flag to true and create another fresh
Production deployment of785861a with current configuration. Reverify readiness,
aliases and all three cron bindings after that API deployment. Never use a
legacy service-role key or put either new secret in web/Preview/browser code.
Actual email delivery and authenticated reading remain separately unproven.

### September 8 — exact transfer resubmitted, approval-channel rejection

Chief of Staff relayed Michael's explicit “yes” to: “May we transfer the existing
Supabase server key into the Edison API's server-only Vercel production secrets
to enable invitations?” CTO resubmitted the **same** in-memory existing-key lookup
and CLI-stdin sensitive Production storage command through normal review, citing
that exact approval. This was not an alternate credential or execution route.

At12:25 UTC normal review again rejected the command before execution. The stated
reason was that the approval appeared only in untrusted tool output rather than
trusted direct user content authorizing that credential and destination. **No key
lookup, transfer, flag update or deployment ran.** No route around normal review
is authorized. Chief of Staff received the exact reason and confirmed that
Michael's direct approval exists in the original Chief of Staff conversation.
CTO supplied only the exact previously submitted command text, without secret
values, for normal review there against that direct user authorization. This
preparation is not itself permission to execute; a further rejection must be
respected. No different credential or transfer mechanism was proposed. CTO stayed
stopped on credential, flag and deployment mutation until the review outcome was
reported. Michael was not asked to repeat his approval.

The pre-submit metadata check still showed only the disabled invitation flag
and sensitive Production-only reset configuration, with no Auth secret entry.
The existing deployed API/web IDs and application source recorded above remain
unchanged by this attempt. An independent source review also confirms that the
health endpoint uses the publishable Auth key: health OK must not be described
as a successful privileged sender call or proof of actual email delivery.

### September 8 — D45 accepted and invitation configuration live

Chief of Staff submitted the exact same transfer through **normal** approval
review in the conversation containing Michael's direct “yes”. That review
accepted the action and the command completed exit0. The historical approval
hold is resolved; no new approval question remains. No alternate credential or
transfer mechanism was used.

The sanitized transfer receipt identified API Production variable
`SUPABASE_SECRET_KEY`, type`sensitive`, id`TUGGjJ7DqS8r1aZc`, sourced from the
existing current-format project key. Its value stayed in process memory and
CLI stdin, not tool output, chat, source or local files. CTO independently read
only metadata at12:29:34–12:29:35 UTC: key and reset setting are Production-only,
and the web project has none of the three server-only configuration names.
There was no second credential retrieval or transfer by CTO.

CTO changed the existing invitation flag to`true`, preserving its name, plain
type and Production target, then created a fresh Git-source API deployment with
the current configuration and exact reviewed SHA:

- API`dpl_Fxu7wuq3jEMr85PxLFa5pj5fMp5N`, created12:30:14.780 UTC,
  **READY / PROMOTED at12:31:32.348 UTC**.
- Exact source`785861a3a25a8b7bdbe5ee1d0fafb60f91ffc7ee`, existing project
 `prj_BDlcI2KFhFawilRiMDvloXcOLnsd`, target Production, root`apps/api`.
- Actual API host`edison-h0swtz5uw-mike-michaelmcguis-projects.vercel.app`;
  public alias remains`project-fjr95.vercel.app`.
- Web remains`dpl_FBkgbqz8NBLTnSVGBH9TmTYAhz5n` at the same785861a source,
  with its existing apex/retained aliases. No web rebuild or domain change.

Chief of Staff independently verified the exact Production deployment identity,
both source-SHA fields, promotion, retained alias and all three enabled cron
bindings at12:32:40.546 UTC. Feed-command and generation-job reconciliation each
remain`*/5 * * * *`, and daily-edition scheduling remains`5 * * * *`, all on the
new`edison-h0swtz5uw` API host. Key/reset settings remain sensitive and
Production-only; the invitation flag was true before this deployment was created.

Independent bounded checks at12:33 UTC passed production-alias health200,
exact-apex CORS, unapproved-origin403 with no CORS grant, anonymous invitation
list/access401, and an unused invitation preview returning unavailable with
no-store/no-referrer/noindex. The unique deployment host redirected302 and was
not followed or bypassed; public readiness evidence is from the production alias.
Targeted nonsecret reads at12:33:53–12:33:56 UTC confirmed invitation flag true,
demand true, daily10000000 microUSD and no monthly override, retaining the
40000000 microUSD source default. Web has neither server secret. At12:35:40 UTC,
CTO confirmed all three cron routes still reject unauthenticated requests401.
The tracked application/configuration diff against785861a is empty; this
activation changes configuration and documentation, not the reviewed application.

CTO observed post-promotion readiness200 with configuration, database and Auth
all OK. This health endpoint uses the **publishable** Auth key; it validates
configuration shape, database protections and public Auth connectivity, not
the privileged invitation sender or SMTP delivery. The sender's first
credential-bearing operation would send an invitation, so it was not invoked
for QA. No user list, test recipient, invitation, grant, redemption, reset,
session bootstrap or paid content request was created to test activation.

The existing browser still displays login with the original article destination
preserved. No usable existing signed-in session was available, and no sign-in
email was requested. The accurate closeout is **invitation sending configured
and enabled in production**, with actual mail delivery and a fresh authorized
reading journey separately unverified.

Reviewed immutable artifact SHA256:

| Artifact | SHA256 |
| --- | --- |
|004 weekly allowance|1489fc0ae5dbb21b646b67544cdaa3446468943c4181c01442587770fe15135d|
|005 invitation membership|700144bc2c1ff6324d3c2e0147f2b5c684ff7335acb88ef68462a0880a1200a1|
|Invite template|5a9eb056f5337098195c0fc18318c3332317627f85aee2dc59759a5ed3d457e9|
|Magic Link / Confirm Signup (each)|b8305bea32a346115789c74e046066c3d4bd1f32f2c44b09cfe49543884a63e8|

Rollback:005 changes admission/function semantics despite additive tables; an
old v10 application rollback is not automatically compatible. To disable new
sends after activation, remove`SUPABASE_SECRET_KEY` from API Production **and**
set the invitation flag false, then redeploy the compatible785861a source;
keeping the key with a disabled flag deliberately fails runtime validation.
Preserve the reset password and all other configuration, grants, receipts and
history; prefer a forward fix over an old incompatible application rollback.
Vercel rollback does not establish restored cron bindings: inspect schedules
after any API deployment/rollback. Do not create an aliasless production canary
as a supposedly harmless preview. Restore readiness remains explicitly unproven.
