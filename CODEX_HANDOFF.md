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

The Supabase CLI 2.116.0 official login flow and linking to production project
`bcxxnntastmnormcmxbq` succeeded. CLI-managed login credentials supplied temporary
database access without handling a database password. A linked dry run succeeded
and lists exactly the 13 checked-in migrations, with no schema applied yet.
Fresh CI now includes strict application-schema lint after the 106 pgTAP tests.
Local lint, both typechecks, all 163 application tests, and both production
builds pass; the pinned Node 22/pnpm 10.28.0 CI result remains the release gate.
Independent review then caught forbidden direct Auth grants in the initial
migration, before the existing final permission fix could execute. Those two
grants are now removed; the final non-delegable PG17 membership supplies access.
A source regression test and direct-ACL pgTAP assertion raise the expected
totals to 164 application tests and 107 database assertions. The 66-test API
suite, lint, and both typechecks pass after that change.
Hosted preflight confirms PG17.6, zero Auth users, zero application tables,
zero Edison roles/bucket/trigger. Supabase lists physical backups at
2026-09-05 04:35:02 UTC and 2026-09-04 19:54:12 UTC. Restoration is untested;
the empty-project checkpoint protects the initial migration only, not a claim
of proven reader-data recovery.

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
  candidate is pushed on `codex/production-release-candidate` in
  [draft PR #1](https://github.com/michaelmcguiness/edison/pull/1). Inspect Git
  for the latest revision. The latest full-release authorization permits
  promotion after the database and CI gates pass.
- Separate `edison-app` and `edison-api` Vercel project shells now exist with
  the intended Next.js/Node 22/build settings. Both are connected to the
  approved repository with `main` as the production branch. Fresh September 5
  overviews show No Production Deployment and No Preview Deployments for both;
  neither has a custom domain. Their assigned
  Production domains are `project-qlqve.vercel.app` for web and
  `project-fjr95.vercel.app` for API.
- `edison-app` has five Production Config values: Corepack, explicit live mode,
  the temporary API `/v1` URL, and the production Supabase URL/publishable key.
  Preview has only Corepack plus explicit demo mode. `edison-api` has 17
  Production Config values for Corepack, Supabase public Auth metadata, JWT
  audience, reviewed models and quotas, temporary web/CORS origin, initial
  edition scheduling, and the owner-only reader/admin allowlists. The existing
  owner-entered Production-only OpenAI Secret was preserved and never read.
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
  Its overview reports no migrations or GitHub schema-deployment connection
  and now shows a recent backup. Backup contents and recovery have not been
  verified. Its public project URL and publishable key are configured in the
  correct Production Vercel projects. The owner-saved database URL has not been
  connection-tested, and no Edison schema has been applied. The creation form
  had automatic table exposure disabled;
  verify actual hosted grants before activation. The current release approval
  permits migration after the reviewed dry run, passing CI, and backup checkpoint.
- Hosted Supabase Auth has global signup and anonymous sign-in disabled, the
  email provider enabled for invitations, the temporary web Site URL, and only
  its exact `/auth/callback` and `/auth/confirm` redirects. Its current signing
  key is already ECC P-256. The repository invitation template and subject
  “Your Edison Reader invitation” are saved, and the preview link contains the
  required `token_hash` plus `type=invite`. No invitation or delivery test was
  sent. In local `supabase/config.toml`, `[auth].enable_signup=false` is the
  signup denial; `[auth.email].enable_signup=true` correctly keeps the email
  provider available and maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Confirm-email
  remains enabled. The dashboard template preview has an unresolved logo and
  the web project is still undeployed; real delivery and asset loading remain
  a release test gate.
- The working tree contains the production private-alpha implementation. It has
  not been migrated, seeded, deployed, or exercised against a hosted database.
- Candidate `52aa993` passed the clean GitHub CI application job on Node 22
  and all 106 pgTAP assertions after applying every migration to disposable
  Supabase/PostgreSQL 17. This machine still has no usable Docker/Postgres
  runtime. Strict schema lint is now included in CI but awaits its fresh run.
  Hosted readiness, real-provider concurrency checks,
  and the backup/restore rehearsal remain release gates.

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
  including the corrected username, but email delivery testing remains pending.
  Broad-launch edge policy, monitoring vendor,
  privacy/support copy, and on-call owner still require operational decisions.
- There is no paid staging environment. Add one when multiple developers,
  frequent migrations, hosted CI, or meaningful production traffic justify it.
- Native clients are not built yet, but the production API/auth boundary is the
  intended mobile backend.

## Required release gates

Before external readers:

1. Run lint, both TypeScript projects, all web/API tests, both production builds,
   and responsive/CSP browser smoke tests.
2. Start a clean disposable/local Supabase stack, apply every migration in
   order, run all pgTAP/RLS tests and database lint, then inspect a linked dry
   run. No real push before explicit approval and a backup checkpoint.
3. Vercel and Supabase are already Pro, and the owner has saved the API's
   Production-only OpenAI Secret. Before release, verify its project scoping,
   provider access, model permissions, billing, rate limits, and spend caps.
4. Preserve the verified custom SMTP, asymmetric JWT key, exact temporary Auth
   redirects, disabled self-signup/anonymous access, owner-only reader/admin
   allowlists, and exact CORS. Add WAF rules, spend alerts, external error
   monitoring, and a backup/restore drill.
5. Deploy API and web first to temporary production URLs, run environment
   preflight and `/v1/health`, invite only the owner, and verify a complete real
   article/citation/save/share/Q&A/direction/retry/cost-ledger flow.
6. Publish a genuine reviewed public starter edition and verify anonymous
   current plus archived deep-link isolation.
7. Obtain a separate owner decision and approval before attaching
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
> and guest-reconciliation behavior. The non-secret temporary-origin, Supabase
> public metadata, quota, allowlist, build-guard, hosted Auth restriction, and
> invitation-template setup is complete; do not redo it. The September 5
> full-release authorization at the top of this file supersedes earlier stops.
> Secure CLI login/link and the 13-migration hosted dry run have succeeded.
> Complete fresh CI/schema lint, backup checkpoint, migrations, candidate
> promotion, live deployment, and the owner-only acceptance tests autonomously.
> Verify provider budgets before AI calls. Do not ask for keys in chat, expose
> secrets, buy additional services, invite other readers, or change website
> domains. Report genuine blockers and distinguish an owner-only live alpha
> from readiness for broader external readers.
