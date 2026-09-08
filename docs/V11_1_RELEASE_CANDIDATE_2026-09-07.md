# v11.1 release candidate — September 7, 2026

Owner: CTO. Status: **source, CI/database and bounded integrated Design gates
closed; hosted rollout pending**. Final application candidate:
`785861a3a25a8b7bdbe5ee1d0fafb60f91ffc7ee`.
Updated September 8, 2026 at 02:02 UTC (September 7 in New York).

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

Prepared only; **none of these hosted changes has been performed**:

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

Source/Design/CI gates are closed. The following hosted actions are **prepared,
not performed**; Chief of Staff reviews this concrete bundle under existing
authorization, without asking Michael for a repeated generic approval.

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

Read-only Vercel metadata at this closeout confirms API production remains
`dpl_GesKd8nJZi9d21ne4qrA7QLDxUmP`, with all three enabled cron definitions on
`edison-jxsjvit8r-mike-michaelmcguis-projects.vercel.app`. API Production has no
`SUPABASE_SECRET_KEY`, invitation flag or reset-password variable yet. Only
variable names/types/targets were read, not secret values. Existing deployment
session is authenticated. These are preparation facts, not connectivity proof.

Reviewed immutable artifact SHA256:

| Artifact | SHA256 |
| --- | --- |
|004 weekly allowance|1489fc0ae5dbb21b646b67544cdaa3446468943c4181c01442587770fe15135d|
|005 invitation membership|700144bc2c1ff6324d3c2e0147f2b5c684ff7335acb88ef68462a0880a1200a1|
|Invite template|5a9eb056f5337098195c0fc18318c3332317627f85aee2dc59759a5ed3d457e9|
|Magic Link / Confirm Signup (each)|b8305bea32a346115789c74e046066c3d4bd1f32f2c44b09cfe49543884a63e8|

Rollback:005 changes admission/function semantics despite additive tables; an
old v10 application rollback is not automatically compatible. Prefer disabling
new sends and forward-fixing while preserving grants, receipts and history.
Vercel rollback does not establish restored cron bindings: inspect schedules
after any API deployment/rollback. Do not create an aliasless production canary
as a supposedly harmless preview. Restore readiness remains explicitly unproven.
