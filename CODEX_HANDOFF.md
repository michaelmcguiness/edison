# Edison Reader — Codex handoff

## Mission

Build Edison Reader into a real, production-grade personal publication for the
web now and iOS/Android later.

> A publication written entirely for you, every day.

Edison learns what a reader finds worthwhile and publishes a finite daily News
edition. Books and Podcasts are permanent top-level sections, but their content
services must remain honestly unavailable until they are actually built.

This project is independent and is not affiliated with Perch.

## Latest owner decision

### September 5 full-release authorization — current and controlling

The owner's latest instruction is: “I trust you - let's just do everything to
get this fully deployed and ready for production. Only ask me if you need me
if you really think it's necessary.” This supersedes the step-by-step stop
boundaries in the historical setup record below. It authorizes secure release
access, reviewed migrations, committing/pushing the candidate, deploying the
existing live projects, and inviting/testing only the previously approved owner,
`mike@michaelmcguiness.com`. Do not request another generic release approval.
Never reveal existing secrets or ask for them in chat. No extra paid services,
broader invitations, or website-domain changes are part of this first release;
the apex demo remains isolated while the owner-only live alpha is validated.

Candidate `4f774eb` is committed and pushed on
`codex/production-release-candidate` in draft PR #1; `main` is neither merged
nor protected. [CI run 33987973278](https://github.com/michaelmcguiness/edison/actions/runs/33987973278)
passed on Node 22.23.2/pnpm 10.28.0 with lint, both typechecks, 183 application tests,
both production builds, all 107 pgTAP assertions, and strict application-schema
lint. The application total is 110 web plus 73 API tests, with zero failures.

The reviewed linked dry run and backup checkpoint preceded a successful
production push of all 13 migrations to Supabase project
`bcxxnntastmnormcmxbq`. A separate read-only metadata check on PostgreSQL 17.6
found all 24 expected tables, all 21 expected RLS settings, 45 policies, 20
triggers, zero invalid constraints, the expected Storage bucket, and the
intended role/grant boundaries. Auth was empty during that audit; it now has
exactly the single invited owner described below. Recovery from backup remains
untested; do not describe the checkpoint as a restore rehearsal.

Release-branch pushes now correctly target Preview; the current live-project
deployments were explicit Production rebuilds. Web deployment
`dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` of `d463d44` is live at
`https://project-qlqve.vercel.app`; it returned HTTP 200 with the expected
nonce-based CSP at 19:12:56Z. The apex `edisonreader.com` continued to serve the
older isolated sample-data demo with HTTP 200 at 19:12:58Z.

The owner privately saved the actual Supabase Shared Transaction pooler URI; no
secret was read or exposed. Candidate `df3e712` now shares one production TLS
policy between runtime and preflight: a URI without a TLS query option receives
explicit Postgres.js `ssl=require`, certificate-verifying requests remain at
least as strong, and insecure, duplicate, or ambiguous URL controls fail closed.
Explicit constructor precedence also prevents `PGSSL` or URI aliases from
turning TLS off. Focused tests, independent security review, and a local TCP
mock confirm TLS is attempted and a server refusing SSL is rejected without a
plaintext startup fallback.

Production API deployment `dpl_GVJFA1vDQks3eBya4ArrXGpCHzFU` of `df3e712` was
Ready at 19:11:12Z (15:11:12 EDT). At 19:11:46Z, `/v1/health` returned HTTP 200
with configuration, database, and Supabase Auth all `ok` (request
`d641ae5d-26df-4974-b2cc-c1fcff4309ab`). Independent live checks then confirmed
unauthenticated `/v1/me` is `401`, the configured web-origin preflight is `204`
with exact origin reflection, an unapproved origin is `403` without reflection,
and all six missing/wrong-token checks across the three GET cron routes are
`401 invalid_cron_secret`. The unauthenticated public-starter read reached the
real public SQL role and returned the expected `404 starter_edition_unavailable`
because no starter is published. These negative checks preceded the first
valid owner-only scheduler invocation described below.

Vercel CLI 59.11.7 was available only through an ephemeral `pnpm dlx` run. Its
login could not be completed and the pending attempt was canceled, so there is
no authenticated local Vercel CLI session.

OpenAI project `edison-production` (`proj_EFKsL4Yfs6pDFOzI4aGWThSf`) now has an
enforced $50 monthly project cap and model access limited to `gpt-5.6-terra`
and `gpt-5.6-luna`; the owner also funded the API account with $50 in credits.
Its `edison-api-production` service-account key was privately saved as the API
Production `OPENAI_API_KEY`; no secret was printed or stored in the repository.
The owner explicitly approved Responses-only scope, and the key is now saved as
Restricted. A fresh permission readback shows Write only for Responses
(`/v1/responses`) and None for every other permission leaf. The safety reviewer
initially rejected the save when the UI reported “2 selected permissions.” A
non-saving check changed only the Responses control and observed that displayed
count move from `0` at None to `1` at Read and `2` at Write while every other
leaf remained None; the retry then succeeded. No further key-scope approval is
pending. The first provider attempt reached OpenAI but was rejected for an
unsupported output-schema format, as described below. The original
default-project key remains unread and unrevoked.

The single authorized owner invitation was sent once through the Supabase
Dashboard at approximately 19:15Z after health and all ten safe live checks
passed. Auth now contains exactly owner
`5611f8fa-e0dd-460c-ae4d-5fb7dd7bfe83`, with
`invited_at=2026-09-05 19:15:11.951927+00`; Resend metadata shows message
`4fecf81e-099f-4144-acf6-4f26bf85ef51`, subject “Your Edison Reader
invitation,” as Delivered. No email body, callback token, or secret was read.
The owner has now redeemed the invitation: `email_confirmed_at` is
`2026-09-05 19:23:00.363055+00` and `last_sign_in_at` is
`2026-09-05 19:23:00.372394+00`. Live API logs show authenticated `/v1/me`,
`/v1/feed`, and `/v1/editorial-direction` reads plus the first `/v1/me` PATCH
all returning 200 at 19:23:02Z. Read-only metadata confirms active membership,
`onboarding_complete=true`, and `timezone=America/New_York`. No additional
sign-in, invitation, or credential change is required. The owner's signed-in
browser is not connected to the current controlled browser session, so the
rendered authenticated reading journey remains unverified. The hosted template is saved and
fresh-reload verified with exactly one invitation link using the
Dashboard-compatible `.SiteURL` `/auth/confirm` token-hash callback. The
matching repository correction and focused release-boundary regression were
included in pushed checkpoint `d463d44`. Candidate `df3e712` includes the safe
database diagnostic and enforced TLS policy with the full green release gate.

At 19:33:45.426Z, one authorized click on Vercel's existing daily-edition
**Run** control returned 200. A read-only precheck confirmed the scheduler had
exactly one eligible profile, the approved owner. It created exactly three
`initial-edition` jobs and dispatched real Workflows. All three failed by
19:33:57Z, with no article, feed item, provider response ID, or usage-ledger row.
The Workflow inspector identifies the concrete provider error: HTTP 400,
`sources.items.properties.url` emitted unsupported JSON Schema `format: uri`.
Each generation step attempted four times within its one workflow run; the
database job attempt count is one, not a provider-call count. Fix `4f774eb`
separates the compatible provider wire format from unchanged canonical URL and
citation validation and increments the request-envelope version to 2.
Independent review found no P0/P1/P2 issues; actual SDK schema regressions and
all 183 application tests pass.

Production API deployment `dpl_12vWp1rShga96hTQ1yJzu8VTiRYh` of `4f774eb`
was Ready at 19:47:17Z. Its 19:47:37Z health check returned 200 with all three
checks `ok` (request `e3f2ec39-c7b6-4c9a-8004-5434ca61114e`). One subsequent
dashboard scheduler invocation at 19:48:11Z created only the quota-permitted
fresh slot-1 retry. Job `2bc18fba-142d-4be6-af9a-c1c18523809c` succeeded at
19:48:41.516Z, publishing one owner article at rank 1 for September 5. Workflow
`wrun_01M1SHTG1K70NG2D4NE3PC4QNS` is completed. Its one priced ledger row
records `gpt-5.6-terra`, 14,045 input tokens, zero cached tokens, 2,047 output
tokens, one web-search call, and estimated cost 62,654 micro-USD ($0.062654).
The provider usage dashboard still showed no data at the initial follow-up, so
provider-side billing reconciliation is not complete. No quota or history was
reset: all four rolling daily job slots are consumed, and the edition is one
article rather than a complete three-article acceptance.

The first article is genuine production output but is not editorially accepted.
Primary-source review found overconfident headline framing and incorrect precise
source dates; the original private artifact is retained without silently changing
the live article. Chief of Staff now owns Editorial, Strategy, and Growth; do not
reactivate those archived tasks. Chief of Staff's independent final verdict is
**withhold** this exact article pending bounded corrections: headline/opening
certainty, source dates/labels, and clearer projection timing. The core numerical
claims and grid lead-time explanation are supported. No content was changed;
a preserved corrected version and focused recheck remain pending. New unapproved product/design proposals must not enter
engineering until Michael approves their design; existing release fixes continue.

Head of Editorial accepted starter candidate v2 with exact SHA-256
`aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50`
in its isolated worktree. It remains an unpublished draft; integrate only that
exact accepted artifact after the owner account and admin boundary work.

### Historical setup and approval record

The owner has asked to build the actual production version and wants as much as
possible completed autonomously. The approved technical direction is Vercel
Pro + Supabase Pro + an Edison-specific OpenAI API project when the private
alpha is released. A reasonable all-in budget is a few hundred dollars per
month. There is no paid staging stack initially; use local Supabase,
credential-free previews, and one backed-up production project.

That authorizes code and documentation work. It does **not** by itself authorize
buying plans, creating or mutating hosted services, entering/requesting secrets,
applying migrations, deploying the production stack, attaching new domains,
changing the apex deployment, publishing commits, or inviting readers. Stop at
those boundaries unless the owner explicitly approves the exact action.

Never ask the owner to paste a secret in chat. Provider credentials belong in
the relevant provider dashboard or a short-lived uncommitted local environment.

On September 4, 2026, the owner explicitly authorized committing and pushing the
production release candidate and creating separate temporary Vercel web/API
projects plus a Supabase production project. This authorization stops before
paid upgrades, secret entry, live migrations, invitations, or domain changes.
Publish the candidate on `codex/production-release-candidate` and review it in a
draft pull request; `main` still automatically deploys the existing apex demo.
Project creation does not authorize merging the release or activating live
services.

The owner subsequently approved signing into Supabase with the
`michaelmcguiness` GitHub account and connecting only
`michaelmcguiness/edison` to both new Vercel projects. The Git connections are
complete. The owner completed Supabase sign-in as `michaelmcguiness` and
created `edison-production` in Mike's Org, North Virginia
(`us-east-1`). Project `bcxxnntastmnormcmxbq` reports Healthy and PostgreSQL
`17.6.1.166`, matching the tested major version. No database password was
read, generated, or entered by the agent. Secret entry and all other stop
limits remain in force.

The owner then upgraded the Vercel team and Mike's Org to Pro; refreshed
dashboards independently confirm both plans. The owner saved `OPENAI_API_KEY`
directly in `edison-api`; its environment list shows a Production-only Secret.
Only metadata was inspected, never its value, and provider access/billing has
not been tested. The owner created and signed into Resend via GitHub, then
explicitly approved adding `mail.edisonreader.com` and its required email DNS
records in Vercel while leaving website routing unchanged. That setup is now
complete: Resend domain `81f985d3-02be-48bd-b9d1-9f7e6902114e`, North Virginia,
reports Verified for DKIM and both sending/SPF records. Sending is enabled,
Receiving is disabled, and tracking is unconfigured. Exactly three TTL-60
records were added; both authoritative nameservers and a public resolver match
the expected records. Apex/`www` HTTP/TLS smoke checks still pass. No optional
DMARC policy, inbound-mail MX, or website routing change was made.

The owner reports creating the Resend key and saving Supabase custom SMTP.
A fresh settings page confirms SMTP enabled, sender
`Edison <auth@mail.edisonreader.com>`, host `smtp.resend.com`, port `465`, and
60-second minimum interval. The owner corrected the SMTP Username to `resend`;
an independent fresh page on September 5 confirms it is saved and SMTP remains
enabled. The password was not revealed, changed, or read by the agent; its
validity and the Resend key's permissions have not been tested. No delivery
test has run. Browser text/DOM inspection
omits some email/username values; fresh screenshots confirmed the public
settings without revealing the password. Do not mistake omitted text for
unsaved settings or reveal secrets to verify them.

No existing secret values or test emails were handled by the agent during
SMTP setup. The separately authorized cron generation is recorded below.
Migration, deployment, invitation, and domain-change boundaries remain in
force; the email-domain approval does not authorize app/API domains.

On September 5, the owner explicitly authorized the remaining non-secret
web/API connection settings, initial usage quotas, temporary origins, and
private-alpha allowlists, plus the hosted Auth restrictions and invitation
template. That setup is complete as recorded below. It does **not** authorize
entering or inspecting additional secrets, configuring the database or cron
secret, applying migrations, pushing code, deploying either live project,
sending an invitation, or changing domains.

The owner then approved guided private credential entry, entered
`DATABASE_URL`, and separately authorized generating `CRON_SECRET`. The agent
generated 32 cryptographically random bytes, encoded them as 64 hexadecimal
characters, and filled only the cron field without printing or reading back
either secret. The database value was not inspected or changed. The owner
clicked Save and confirmed completion. A September 5 metadata-only check
independently confirms both names saved as Production-only Secret values in
`edison-api`, alongside the existing OpenAI Secret. No values were revealed.

All required API variable names are now present, but metadata does not prove
database URL formatting/TLS, credential validity, or provider connectivity.
Full API preflight and real connection tests remain pending. This approval
does not authorize inspecting secrets, secure local migration access, schema
application, deployment, or invitations. Never read an in-progress secret form
or ask for keys in chat. The next gate is separately approved secure local
migration access and a reviewed dry run, not another Vercel secret-entry form.

## Hosted state versus working-tree state

- [edisonreader.com](https://edisonreader.com/) and its `www` redirect still
  serve the credential-free sample demo from the existing Vercel project,
  now in the upgraded Pro team.
- The demo is explicit `EDISON_DEMO_MODE=true`; it has no production Supabase,
  API, OpenAI, SMTP, or cron credentials. It must stay isolated while the alpha
  is proven.
- The public GitHub source is
  [michaelmcguiness/edison](https://github.com/michaelmcguiness/edison). The
  current candidate is `4f774eb`, pushed on
  `codex/production-release-candidate` in
  [draft PR #1](https://github.com/michaelmcguiness/edison/pull/1). `main` is
  unmerged and unprotected.
- Separate `edison-app` and `edison-api` Vercel projects exist with the intended
  Next.js/Node 22/build settings and saved production branch `main`.
  Release-branch pushes now target Preview; the current deployments were
  explicit Production rebuilds. Web deployment
  `dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` (`d463d44`) is live at
  `project-qlqve.vercel.app`. API deployment
  `dpl_12vWp1rShga96hTQ1yJzu8VTiRYh` (`4f774eb`) is Ready at
  `project-fjr95.vercel.app`, and readiness is fully healthy.
  Neither project has a custom domain.
- `edison-app` has five Production Config values: Corepack, explicit live mode,
  the temporary API `/v1` URL, and the production Supabase URL/publishable key.
  Preview has only Corepack plus explicit demo mode. `edison-api` has 17
  Production Config values for Corepack, Supabase public Auth metadata, JWT
  audience, reviewed models and quotas, temporary web/CORS origin, initial
  edition scheduling, and the owner-only reader/admin allowlists. The existing
  Production-only OpenAI Secret now contains the privately transferred
  `edison-api-production` service-account key for the dedicated Edison project;
  it was never printed or read back. Its saved Restricted policy grants only
  Responses Write and leaves every other permission leaf at None; the key is
  has returned one successful, priced article-generation response.
  `DATABASE_URL` and `CRON_SECRET` are also verified Production-only Secrets;
  the API has 17 Production Config values and three Production Secrets total.
  API Preview had no variables
  until the final authorized setup step; it now has exactly one Config value,
  `ENABLE_EXPERIMENTAL_COREPACK=1`, and no live values. Future pushes can
  trigger builds;
  do not push merely to update setup notes before deployment is intended.
  See `docs/DEPLOYMENT.md` for IDs and setup status.
- Exact temporary wiring is web → `https://project-fjr95.vercel.app/v1`, both
  projects → `https://bcxxnntastmnormcmxbq.supabase.co` with the matching public
  key, and API web/CORS → only `https://project-qlqve.vercel.app`. API models
  are `gpt-5.6-terra`/`gpt-5.6-luna`; per-reader quotas are 4 generations,
  20 article questions, and 10 commands; search accounting is 10000 microdollars
  per call; edition settings are hour 5, target 3, batch 25. Both API email lists
  contain only `mike@michaelmcguiness.com`. Do not put the literal publishable
  key in documentation even though it is intentionally public client metadata.
- The web and API Build Commands persist the production-only
  `scripts/check-production-env.mjs` guards documented in the release runbook.
  Fifteen focused authentication/configuration tests pass.
- A read-only attempt to open Supabase's Direct Connection string was blocked
  before execution because it could expose credentials. No database connection
  value was read, copied, or inferred, and no workaround was attempted. Later
  authorized Vercel entry is complete as recorded above. Secure local migration
  access subsequently succeeded through the official CLI login/link flow;
  never request credentials in chat.
- Supabase project
  [`edison-production`](https://supabase.com/dashboard/project/bcxxnntastmnormcmxbq)
  exists and is Healthy, in the Pro organization in `us-east-1`, PostgreSQL
  `17.6.1.166`; the organization inventory still labels compute Nano.
  All 13 repository migrations are applied. Read-only hosted checks confirm the
  expected schema, RLS, policies, triggers, Storage bucket, functions, and
  constrained grants. Backup contents and recovery have not been verified. The
  owner privately saved the actual Shared Transaction pooler URI. Runtime
  and preflight now share the `df3e712` TLS policy, which explicitly defaults a
  missing TLS query option to `ssl=require` and rejects insecure or ambiguous
  overrides. Production database health passes; no further owner database edit
  is pending.
- Hosted Supabase Auth has global signup and anonymous sign-in disabled, the
  email provider enabled for invitations, the temporary web Site URL, and only
  its exact `/auth/callback` and `/auth/confirm` redirects. Its current signing
  key is already ECC P-256. The hosted invitation template and subject
  “Your Edison Reader invitation” are saved and fresh-reload verified; its
  single CTA uses
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite`
  because Dashboard invitations cannot supply a callback override. One owner
  invitation was sent and provider metadata reports Delivered; its body and
  token were not read. The matching repository template
  correction and focused regression are included in pushed checkpoint
  `d463d44` and its green CI run.
  In local `supabase/config.toml`, `[auth].enable_signup=false` is the
  signup denial; `[auth.email].enable_signup=true` correctly keeps the email
  provider available and maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Confirm-email
  remains enabled. The dashboard template preview has an unresolved logo and
  the owner has redeemed the invitation successfully. Owner-side email asset
  rendering remains unverified, but the callback/authenticated API gate passes.
- Candidate `4f774eb` is pushed and its API deployment is Ready with
  configuration, database, and Auth health all `ok`. The temporary web and
  Supabase schema are live. Owner authentication and timezone persistence pass;
  one real article and its usage ledger now exist after the provider-schema fix.
  Full rendered reading and editorial acceptance remain incomplete.
- CI run `33987973278` is green for all 183 application tests, 107 pgTAP
  assertions, strict schema lint, and both production builds. Hosted OpenAI
  billing reconciliation, owner-side email rendering, end-to-end owner acceptance, and
  a backup/restore rehearsal remain release gates.

## Production topology

Edison is an API-first modular monolith and a real client/server application:

| Surface | Target | Responsibility |
| --- | --- | --- |
| Existing demo/landing | `edisonreader.com` | Credential-free sample UI |
| Live web (`edison-app`) | `app.edisonreader.com` | Next.js UI + Supabase Auth session |
| Live API (`edison-api`) | `api.edisonreader.com/v1` | Authz, Postgres, OpenAI, Workflow, cron |
| Data/Auth | Supabase Pro | Canonical Postgres, Auth, reserved Storage |

Web and future native clients authenticate through Supabase, then call the same
versioned Edison API with a bearer token. They do not connect to Edison core
tables or OpenAI directly. The API verifies tokens and the fail-closed alpha
allowlist, executes reader queries under the non-login `edison_api` role, and
relies on enabled RLS policies that are enforced for that non-owner role. The
migrations do not use `FORCE ROW LEVEL SECURITY`; browser/mobile Supabase roles
also have no core table grants.

Use one region: API/Workflow in US East and a nearby Supabase project. Keep the
existing apex demo project separate because all aliases on one Vercel project
share one production build and environment.

## Locked product and design decisions

The current canonical sources, newest last, are:

1. `docs/brand/WHITE_EDITION_HANDOFF.md`
2. `docs/brand/PERSONAL_PUBLICATION_HANDOFF.md`
3. `docs/brand/SIDEBAR_CHAT_HANDOFF.md`

The latter specifications supersede the old category-tab/infinite-feed design.

- Desktop: a 184px left rail with exactly News, Books, Podcasts; centered Edison
  masthead; library/streak/profile tools at upper right.
- Below 960px available shell width: fixed bottom navigation with those same
  three destinations.
- A contextual `+` exists only on the three section homes and commissions one
  new piece; it never edits ongoing direction.
- “Ask Edison” sits inline immediately after the folio as a chat-style control.
  Exact placeholders:
  - News: “More economic history, less startup news…”
  - Books: “Short books on history and architecture…”
  - Podcasts: “More science. Episodes under 30 minutes…”
- News is one finite daily edition with a clear end, not an infinite feed.
- Useful public reading appears before authentication. There is no blocking
  onboarding/account gate before the reader can see a real public edition.
- Books is a cover-led library and Podcasts is a listening queue only when real
  services/data exist. No fake covers, books, audio, duration, progress, or play
  actions.
- Direction is durable, section-scoped, reviewable, editable, removable, and
  undoable. Edition-only direction binds to a stable server edition identity.
- Guest direction/drafts remain device-local and are explicitly reconciled on
  sign-in without overwriting account state or creating duplicate jobs.
- The White Edition identity remains quiet black-and-white editorial design
  with restrained Edison Red, hairline rules, flat surfaces, square imagery,
  and no gradients/glass/ornamental shadows/rounded-card language.

## Implemented production behavior

### Web

- Prototype, signed-out guest, signed-in public-starter, and authenticated
  private-live modes are separate.
- Unauthenticated readers load only the sanitized current public starter News
  edition. Signed-in readers can also read that starter without the UI
  misrepresenting it as their private edition. Stable public deep links can
  reopen archived immutable starter articles.
- Authenticated readers load the bounded current News edition envelope and
  runtime-validate it. Feed and direction edition identities are cross-checked;
  a mismatch disables edition-scoped writes and safely shows the public starter.
- News date/count/label come from the displayed edition rather than client time.
- Public and guest cards do not promise a library save they cannot perform.
- Article reading, saves, feedback, completion/streak, sharing, Q&A, library,
  profile, explicit interests, inferred-interest removal, and category controls
  use the live API where connected.
- Guest directions and drafts receive an explicit additive sign-in import.
  Exact duplicates are skipped, account drafts are never overwritten, the
  logical request IDs are stable, and imports never dispatch generation.
- Books and Podcasts render honest disconnected production states.
- A nonce-based CSP and security headers protect the web surface.

### API and data

- Versioned REST API under `apps/api`; CORS uses exact origins.
- Supabase bearer verification, active membership, required private-alpha email
  allowlist, active-member admin allowlist, `edison_api`/`edison_public` roles,
  grants, and RLS. Legacy public shares use one narrow security-definer lookup;
  the public role cannot read the share or membership tables.
- Revision-safe editorial-direction state/instructions/mutation history with
  create, full edit, soft remove, Undo, CAS conflicts, and idempotency.
- Immutable sanitized public starter editions, atomic admin publication, current
  listing, and stable archived article reads.
- Daily News edition identity/date rotation, deterministic scheduled ranks,
  exact-edition feed filtering, and finite `nextCursor: null` response.
- Active persistent plus current-edition News direction is captured for article
  generation. The workflow rechecks direction revision/edition/date before
  publish so stale output is accounted for but never inserted into the new
  edition.
- Slow article generation and feed-command parsing use Vercel Workflow with
  authoritative database rows and reconciliation.
- Article generation, Q&A, and feed commands use bounded per-reader quotas,
  leases/attempts, invariant provider-request snapshots, provider idempotency,
  timeouts, and usage accounting for every observed response, including invalid
  structured output.
- Usage accounting distinguishes priced responses from unexpected unpriced
  provider model identities. An unpriced response retains its tokens and
  provider ID with `cost_microusd = NULL`, stops the logical operation, and
  makes the aggregate estimate unknown; it is never recorded as free.
- API health/readiness and `scripts/check-production-env.mjs` fail closed on
  missing production configuration and schema capabilities.

## Deliberate product gaps

- Books and Podcasts do not yet have production catalog/recommendation,
  generation, object-storage, reader, playback, or progress services.
- No genuine public starter content is checked in or seeded. An operator must
  publish sourced, reviewed snapshots; the anonymous endpoint correctly returns
  unavailable until then.
- Resend's sending domain is verified and Supabase custom SMTP is configured,
  including the corrected username. Provider metadata confirms the owner invite
  was Delivered, and invitation redemption/authenticated API access pass.
  Owner-side rendering remains unverified. Broad-launch edge policy, monitoring vendor,
  privacy/support copy, and on-call owner still require operational decisions.
- There is no paid staging environment. Add one when multiple developers,
  frequent migrations, hosted CI, or meaningful production traffic justify it.
- Native clients are not built yet, but the production API/auth boundary is the
  intended mobile backend.

## Required release gates

The source, disposable-database, CI, production migration, temporary-web/API
deployment, health, public-role, and negative auth/CORS/cron gates are complete
through `df3e712`.
Before the owner-only alpha is usable:

1. Owner invitation redemption, active membership, authenticated `/v1/me`, and
   first-visit timezone persistence passed at 19:23Z. Do not resend an invitation.
2. The provider output-schema fix is live and one bounded article generation
   and priced ledger row pass. Complete provider-dashboard reconciliation;
   preserve the saved Responses-only key, model allowlist, and $50 cap.
3. Complete one real article/citation/save/share/Q&A/direction/retry/cost-ledger
   flow for the owner.
4. Verify cron/Workflow logs, add the planned WAF controls, publish and review
   only the accepted starter v2 artifact with SHA-256
   `aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50`,
   and complete a backup/restore rehearsal before broader external readers.
5. Merge the reviewed candidate and protect `main` when the temporary alpha is
   accepted. Obtain a separate owner decision before attaching
   `app.edisonreader.com`/`api.edisonreader.com` or replacing the apex demo.

The detailed runbook is `docs/PRODUCTION_RELEASE.md`; the shorter overview is
`docs/DEPLOYMENT.md`. `docs/PRODUCTION_GAPS.md` must remain current with the
working tree and must not list already-completed blockers.

## Local commands

Use Node.js 22.x and pnpm 10.28.0:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:all
```

`pnpm test` includes root web tests and API service tests. With Docker:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm exec supabase test db
pnpm exec supabase db lint
pnpm exec supabase db push --linked --dry-run
```

Apply schema only with the Supabase CLI. Never use `drizzle-kit push` against
production. Vercel builds deliberately use Next’s Webpack path. Read relevant
local Next 16 documentation under `node_modules/next/dist/docs/` before making
framework changes; this repository’s Next version differs from remembered APIs.

## First prompt to give Codex

> Continue building Edison Reader from this repository. Read
> `CODEX_HANDOFF.md` completely, then inspect the working tree and current Git
> state before editing. The target is the production private alpha using the
> separate Vercel web/API + Supabase architecture described here; the hosted
> apex remains an isolated credential-free demo. Preserve the exact finite News,
> three-section sidebar/mobile-nav, inline Ask Edison, one-off commissioning,
> and guest-reconciliation behavior. Candidate `4f774eb`, CI run `33987973278`,
> all 13 hosted migrations, the read-only schema/grant audit, the temporary web
> deployment, and the negative auth/CORS/cron smokes are complete; do not redo
> them. The apex demo is still isolated. The Production API is Ready and health
> passes configuration, database, and Auth; the shared runtime/preflight policy
> enforces TLS even when the provider URI omits a query option. No further owner
> database edit is pending. Owner invitation redemption, authenticated API reads,
> and timezone/onboarding persistence are now verified. Continue with the
> remaining owner reading checks. The provider output-schema fix is live and
> one retry succeeded with a priced $0.062654 ledger row. The three original
> failed jobs remain intact and all four daily slots are consumed; do not reset
> quotas. Editorial withheld the first real output for overconfident headline
> framing and incorrect source dates; controlled correction/recheck is pending. Route editorial
> review to Chief of Staff, not archived tasks. The dedicated OpenAI service-account
> key is already
> Restricted to Responses Write with every other leaf None; no further scope
> approval is needed. Provider usage-dashboard reconciliation remains pending.
> The hosted invite callback and matching pushed repository regression
> are corrected. The single owner invitation was sent once and provider metadata
> reports Delivered without its body or token being read. Test only that owner;
> the already completed sign-in does not need repeating.
> The September 5
> full-release authorization at the top supersedes historical stops. Never ask
> for or expose secrets, buy additional services, invite other readers, or
> change website domains. Report genuine blockers and distinguish an owner-only
> live alpha from broader-reader readiness.
