# v11.1 release candidate — September 7, 2026

Owner: CTO. Status: implementation checkpoint, **not released or accepted**.

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

Locally executed: 632 web tests, 269 API tests, lint, typechecks and
both optimized production builds. Focused tests include actual compiled route
and UI modules with injected dependencies. PostgreSQL scripts have only passed
their safety guards locally; actual migration/RLS/concurrency checks require CI.
The CI workflow now executes both new disposable-database checks.

Rendered local QA uses the actual Next app with an explicitly opt-in synthetic
Auth/API service (`EDISON_V11_MEMBER_FIXTURE=1`). The real installed SDK writes
normal cookies; there are no real recipients, credentials, provider calls or
database calls. `authProof:false` is intentional: the fixture does not establish
hosted Auth security, SMTP delivery or durable accounting.

Open at this source checkpoint:

- Local rendered confirmation found native form `Origin:null` under no-referrer
  metadata. Clean login/acceptance pages now use same-origin referrers (no external
  referrer); token-bearing GET retains no-referrer and strict POST Origin checks
  remain. An additional Next route request-cookie context failure is under
  investigation and blocks rendered acceptance; page cookie access works.
- Complete current reader/invitation narrow-width and responsive browser checks,
  exact-build Design review, and actual PostgreSQL CI. No final acceptance claim.
- Review the exact successful candidate and configuration/template/migration
  bundle before hosted mutation. No real email or paid generation is authorized
  merely for QA; existing production remains on its previously verified release.

This checkpoint may be pushed to the existing release PR for CI. It must not be
promoted as a production-ready release while the above gates remain unresolved.
