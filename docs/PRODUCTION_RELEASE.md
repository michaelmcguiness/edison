# Edison production release runbook

Verified against the repository and linked provider documentation through
2026-09-05. Recheck provider prices and limits immediately before purchasing or
launching; they can change without a code release.

## Decision and current status

**Current authorization, September 5:** the owner has authorized completing
the production release autonomously, including secure CLI access, reviewed
migrations, commit/push/promotion, deploying the existing web/API projects, and
inviting/testing only `mike@michaelmcguiness.com`. This supersedes earlier
step-by-step permission stops recorded below; they are historical, not current
blockers. Preserve the apex demo and website domains, do not add paid services
or other readers, and never reveal saved credentials or request secrets in chat.

**Current release checkpoint:** official Supabase CLI 2.116.0 login and link to
`bcxxnntastmnormcmxbq` succeeded with CLI-managed temporary database access and
no database password handling. The linked dry run succeeds and proposes all
13 checked-in migrations only. Nothing has been applied yet. Strict schema
lint was added to CI after pgTAP. Local lint, both typechecks, 163 application
tests, and both builds pass; wait for the fresh pinned Node 22 CI before the
actual migration and production promotion. Independent review then removed
two forbidden direct Auth grants from the never-deployed initial migration;
the final constrained PG17 membership supplies the same effective access.
New regression coverage raises totals to 164 application tests / 107 pgTAP
assertions. Post-fix API tests, lint, and both typechecks pass.
Hosted preflight confirms PG17.6 and zero Auth users, application tables,
Edison roles, reserved bucket, or provisioning trigger. Supabase lists physical
backups from September 5 04:35:02 UTC and September 4 19:54:12 UTC. Restore
testing remains outstanding before external reader data; do not describe this
empty-database checkpoint as a successful restore rehearsal.

Edison's client/server architecture is appropriate for a web product and later
iOS and Android clients. It is an API-first modular monolith: web and native
clients authenticate with Supabase, send a bearer access token to the versioned
Edison API, and never connect directly to Edison's application tables or to
OpenAI. The API owns authorization and Postgres access; durable Vercel
Workflows own slow AI work. This can scale a useful private alpha and an early
paid product without a rewrite or premature microservices.

The repository is **authorized for an owner-only production release, not yet
verified ready for external readers**. The
existing `edisonreader.com` deployment is still a credential-free sample-data
demo. This document is a release gate, not authorization to buy plans, create
external resources, apply migrations, add secrets, invite readers, deploy, or
attach domains.

The September 4 owner authorization initially permitted publishing the
candidate and creating temporary project shells; see `docs/DEPLOYMENT.md` for
the full authorization history, preparation record, and draft PR. The owner
then explicitly approved connecting
only the Edison repository to both Vercel projects and signing into Supabase
with their GitHub account. Both Git links and Supabase sign-in are complete.
The owner created Supabase project `bcxxnntastmnormcmxbq`
(`edison-production`) in the existing organization. It reports Healthy
in `us-east-1`, PostgreSQL `17.6.1.166`. It has no Edison migrations or verified
database connection. Its public URL and publishable key are configured in the
appropriate Production Vercel projects, but no live stack is deployed; all
launch gates below remain applicable.

The owner subsequently upgraded the Vercel team and Supabase organization;
refreshed dashboards confirm Pro on both. The owner saved `OPENAI_API_KEY`
directly in `edison-api`; metadata shows a Production-only Secret. Its value
and provider access have not been inspected or tested. Supabase now reports a
recent backup, but recovery remains unverified. The owner also reports creating
a Resend account via GitHub and completed sign-in. The owner then explicitly
approved `mail.edisonreader.com` sending-domain creation and its required
email-verification DNS records in Vercel. That setup is complete and Resend
reports Verified; see the exact record and website-safety evidence in
`docs/DEPLOYMENT.md`. Receiving is disabled and tracking is unconfigured.
The owner has since enabled Supabase custom SMTP and entered the Resend key
privately. A fresh settings page confirms the expected sender, host, and port,
and the owner has corrected its Username to `resend`. An independent fresh
page on September 5 confirms the correction is saved and SMTP remains enabled.
No password value was read or changed by the agent, key permissions verified,
or delivery tested.

On September 5, the owner authorized the remaining non-secret web/API
connection settings, temporary origins, initial quotas, owner-only allowlists,
hosted Auth restrictions, and invite template. Those settings and both
Production build guards are saved and verified as described under Vercel and
Supabase setup. This did not authorize or perform database/cron secret entry,
migration, deployment, invitation, push, branch, or domain changes.

The owner later approved private Vercel credential entry, supplied the database
URL, and explicitly authorized generating the cron secret. The agent generated
32 cryptographically random bytes as 64 hexadecimal characters and filled only
the cron field without printing or reading back secret values. The owner saved
the form. A subsequent metadata-only check confirms `DATABASE_URL` and
`CRON_SECRET` as Production-only Secrets alongside the existing OpenAI Secret.
This does not establish valid connection details or provider access, and does
not authorize local migration credentials, schema changes, deployment, or invites.

Current audit limits:

- The authorized preparation created two undeployed Vercel project shells and
  their Git/build settings, plus the owner-created empty Supabase project. The
  later billing upgrades and OpenAI secret entry were performed by the owner.
  The subsequently authorized email-domain setup added only the three required
  Resend DNS records. Supabase SMTP was configured by the owner. The September 5
  authorization added only the recorded non-secret Production/Preview Config,
  build guards, Auth restrictions, and invitation template.
- No secret value was requested in chat, displayed, read back, or tested by
  the agent. The cron secret was generated and entered only after the owner's
  explicit request. For saved Secrets, only names, types, and scopes were read;
  the authorized Config values are non-secret metadata.
- Fresh September 5 project overviews show No Production Deployment and No
  Preview Deployments for both live Vercel projects. A read-only attempt to open
  Supabase's Direct Connection string was blocked before execution to avoid
  credential exposure; no connection value or pooler hostname was read,
  inferred, or stored, and no workaround was attempted.
- The hosted database exists but has no Edison schema. Candidate `52aa993` passed
  all 106 pgTAP assertions and clean migration application in disposable
  Supabase/PostgreSQL 17 on
  [GitHub CI](https://github.com/michaelmcguiness/edison/actions/runs/33916066769).
  Schema lint and the hosted dry-run/backup/restore gates remain outstanding.
- The nonce-based CSP and responsive sample UI passed a local production-build
  browser smoke test; connected Supabase login and API flows still need testing
  in the isolated live projects.
- Fifteen focused authentication/configuration tests pass. Hosted Auth has global
  signup and anonymous access off, the email provider on, an ECC P-256 signing
  key, the temporary Site URL plus exactly two callback URLs, and the saved
  invitation subject/template. Confirm-email is on. No invite was sent; the
  dashboard preview has an unresolved logo and the web project is undeployed.
  Actual delivery and asset loading remain a release gate.
- The API readiness check has been extended for the new
  editorial-direction/public-starter schema and roles, but that check still
  needs execution against a clean migrated database.
- Current Supabase Auth restricts direct grants from the project `postgres`
  role. The final migration grants `edison_api` an inheritable membership in
  built-in `authenticated` with `ADMIN FALSE` and `SET FALSE`. The role's
  default `NOINHERIT` remains intact; this explicit edge supplies Auth helper
  access, not new role-switch/delegation rights. Tests deny raw Auth-user
  access, privileged role membership, and reverse inheritance by browser
  roles. This relies on
  [PostgreSQL 17 role-membership semantics](https://www.postgresql.org/docs/17/role-membership.html);
  verify the hosted project's major version before migration.
- AI article Q&A and legacy feed commands now use database-atomic rolling
  quotas, durable request fingerprints and exact provider-input snapshots,
  bounded worker leases, and stable provider idempotency keys. Observed invalid
  responses become terminal only after their identity and usage are durably
  ledgered; an accounting failure preserves the frozen request and retry
  capacity. The migrations and
  concurrent-call behavior still need verification against a clean Postgres
  instance and the configured production OpenAI project before launch.
- News generation now freezes the exact provider input per job and direction
  revision, applies the complete bounded set of persistent/current-edition
  instructions, and rejects stale output before publication while preserving
  observed spend. Daily rotation and the authenticated feed now use one exact
  server-owned edition UUID/date. These paths still need real-Postgres race and
  provider-idempotency verification before launch.

## Production topology

Use one region and three independently configured Vercel projects from the same
public GitHub repository:

| Surface | Recommended host | Responsibility | Credentials |
| --- | --- | --- | --- |
| Existing demo/landing | `edisonreader.com` and `www` redirect | Sample or later marketing page | None |
| Live web | `app.edisonreader.com` | Next.js UI, Supabase Auth session, server-rendered public shares | Only Supabase publishable values and API URL |
| Live API/workflows | `api.edisonreader.com` | `/v1`, authorization, Postgres, OpenAI, workflows, cron | Pooled DB, OpenAI project key, cron secret |
| Supabase | Provider project URL | Auth, canonical Postgres, reserved Storage | Publishable key on clients; admin key only in a local invitation session |

Keep the separate `edison-app` Vercel project for the live web app. Do not flip
the existing `edison` demo project to live mode while it owns the apex and
`www`: every alias on one Vercel project receives the same build and production
environment. The owner may instead decide that the apex itself should become
the live app, but that is a product/domain decision to make before attachment.

For native apps later:

- Ship only the Supabase URL, Supabase publishable key, and Edison API URL.
- Store the Supabase session in Keychain/Keystore and send its access token as
  `Authorization: Bearer ...` to `/v1`.
- Do not ship a database URL, service-role/secret key, OpenAI key, or cron
  secret. CORS is a browser control, not native-app authorization.
- Add exact universal-link/custom-scheme Auth callbacks when the native clients
  exist. The web callbacks remain unchanged.

## Must-pass release gates

All gates below are blocking before inviting anyone whose data matters.

| Gate | Required evidence |
| --- | --- |
| Clean source release | Reviewed commit on protected `main`; Node 22; frozen install; lint, both typechecks, all tests, and both production builds pass from a clean checkout |
| Database safety | Clean `supabase db reset`; all pgTAP tests pass; schema lint passes; linked `supabase db push --dry-run` reviewed; migration backup checkpoint prepared |
| Complete readiness | `/v1/health` checks every required schema generation, including News edition date/item identity and its index, editorial directions, public starter editions, `edison_api`, `edison_public`, and the narrow public-share function without underlying table grants |
| Browser security | Nonce CSP and all security headers pass in the production build; Supabase login, images/fonts, API fetches, and share pages work without CSP violations |
| AI cost integrity | Generation jobs retain their atomic daily quota and exact request snapshots; Q&A and feed-command reservation tests pass against real Postgres; parallel duplicates produce one provider response; ambiguous retries recover against the original frozen input; stale and invalid observed generation responses reconcile to `private.usage_ledger`; an unexpected returned model identity is recorded as `pricing_status = 'unpriced'` with `cost_microusd = NULL`, stops publication, and makes the estimated total unknown rather than pretending the call cost zero |
| Abuse controls | Application-level reader quotas are authoritative; Vercel WAF rules cover expensive POST routes; Supabase Auth signup/anonymous access stay disabled |
| Auth/email | Exact Site/redirect URLs, asymmetric JWT key, custom SMTP, tested invitation, tested allowlist, active membership, admin membership revocation, revoke procedure |
| Data recovery | Supabase Pro daily backups active, encrypted logical checkpoint taken, and a restore into a disposable project has been timed and verified |
| Operations | Health and web synthetic checks, error alerting, cron/job-age alerts, provider budget alerts/hard caps, named on-call owner |
| User trust | A short privacy notice explains email/preferences/content processing and OpenAI retention; feedback/support and manual export/deletion procedures exist |
| Release acceptance | Owner account completes sign-in, first-visit timezone activation, finite-edition generation, citation review, save, share/revoke, editorial direction, and admin/cron smoke tests |

Before public self-service signup, also add automated account export/deletion,
moderation/abuse review, broader load testing, and formal legal review. A small
invite-only alpha can use documented manual procedures for export/deletion.

## What can stay free while building

The code, local Supabase stack, local database tests, credential-free Vercel
previews, and a non-commercial demo can use free/Hobby plans while building.
The owner has now upgraded the actual Vercel team and Supabase organization
to Pro; the comparisons below explain the production requirements, not their
current subscription status.

Do not treat those plans as the real-user production configuration:

- Vercel Hobby is for personal/non-commercial use and permits a cron job only
  once per day. Edison declares two five-minute reconcilers and one hourly
  scheduler, so the live API requires Vercel Pro. See
  [Hobby policy](https://vercel.com/docs/plans/hobby) and
  [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Supabase Free can pause for inactivity and does not provide the automated
  backups required here. It is acceptable for development or a disposable
  owner-only smoke project, not the source of truth for external readers. See
  [Supabase pricing](https://supabase.com/pricing),
  [database backups](https://supabase.com/docs/guides/platform/backups), and
  [production guidance](https://supabase.com/docs/guides/deployment/going-into-prod).
- Supabase's default Auth mailer is a non-production service: it is limited,
  best-effort, and sends only to authorized team addresses. External invitations
  require custom SMTP. See
  [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- ChatGPT subscriptions do not fund API calls. The live API requires a separate
  OpenAI API project with billing and a server-side project/service-account key.

### Initial monthly budget

| Item | Initial choice | Planning amount |
| --- | --- | ---: |
| Vercel | Pro, one deploying owner; web/API/demo projects on the same team | About $20 plus usage; includes the plan's usage credit |
| Supabase | Pro, one production project in US East | Starts around $25 |
| SMTP | Low-volume transactional provider selected by owner | Reserve $0-$20 |
| OpenAI API | Production project, usage alerts and a suggested $75-$100 hard limit | $75-$100 maximum target |
| Vercel overage | Low alerts and an owner-approved spend-management action | Reserve $20-$30 |

This places the initial target around $140-$195 per month. Validate actual
provider invoices rather than relying on this estimate. Vercel Pro currently
starts at $20 per deploying seat with a usage credit; see
[Vercel Pro](https://vercel.com/docs/plans/pro-plan) and
[pricing](https://vercel.com/pricing).

Do not initially buy:

- Supabase point-in-time recovery: seven-day PITR is currently an additional
  roughly $100/month. Daily Pro backups plus an off-site logical checkpoint are
  proportionate for the first alpha. Add PITR when a 24-hour recovery point is
  unacceptable. See
  [Supabase PITR](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).
- Vercel Advanced Deployment Protection for production custom domains: it is
  currently a $150/month Pro add-on. Application authentication is Edison's
  private-alpha boundary; standard protection should remain enabled for preview
  and unique deployment URLs. See
  [Deployment Protection](https://vercel.com/docs/deployment-protection).
- A Supabase custom domain: it adds cost without improving this architecture,
  and `api.edisonreader.com` belongs to the Edison API. See
  [Supabase custom domains](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains).
- A permanent staging stack. Add it when multiple developers ship regularly,
  hosted schema changes are frequent, or production traffic makes an owner-only
  canary too risky.

OpenAI cost deserves an explicit first-week review. As of the verification
date, `gpt-5.6-terra` is $2/M input tokens, $0.20/M cached input, and $12/M
output; `gpt-5.6-luna` is $0.20/M input, $0.02/M cached input, and $1.20/M
output. Web search on the reasoning models is $10/1,000 calls plus applicable
tokens. Edison currently allows up to 12 searches and 12,000 output tokens for
one generated article, so the tool component alone can reach $0.12 and the
output ceiling adds $0.144 before input tokens. Real usage may be lower, but
three daily articles per reader compounds quickly. Reconcile Edison's usage
ledger with the [official pricing page](https://developers.openai.com/api/docs/pricing)
daily during the alpha.

## Vercel setup

The owner/team is already Pro. Keep one deploying seat unless another person
genuinely needs deployment access.
Enable MFA for every account that can change deployments or environment values.

### Git and release controls

1. Keep the GitHub repository public only if the owner still wants the product
   source open. Public source never changes the credential rules.
2. Enable branch protection for `main`: require a pull request or explicit
   owner review, require the repository check, block force-pushes/deletion, and
   enable available secret scanning/push protection.
3. Configure `main` as Vercel's production branch. Pull requests create previews
   but previews receive no Supabase, database, OpenAI, SMTP, cron, or live API
   values.
4. Require this clean-checkout command before production promotion:

   ```sh
   corepack pnpm install --frozen-lockfile
   corepack pnpm check
   ```

5. Record commit SHA, migration set, both deployment IDs, smoke-test result,
   and the person who approved the release.

### Existing demo project

Keep the current `edison` project as documented in `docs/DEPLOYMENT.md`:

- Root directory: `.`
- Node.js: `22.x`
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm build:web`
- Production and Preview: `EDISON_DEMO_MODE=true` and
  `ENABLE_EXPERIMENTAL_COREPACK=1`
- No live-service credentials

### Live web project (`edison-app`)

| Setting | Value |
| --- | --- |
| Git source | `michaelmcguiness/edison`, production branch `main` |
| Root directory | `.` |
| Framework | Next.js |
| Node.js | `22.x` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | Production-only preflight guard, then `pnpm build:web` |
| Output | Next.js default |
| Assigned Production domain | `project-qlqve.vercel.app` |

Production-only environment:

| Name | Required value/purpose |
| --- | --- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
| `EDISON_DEMO_MODE` | Explicitly `false` |
| `NEXT_PUBLIC_API_URL` | Saved as `https://project-fjr95.vercel.app/v1`; replace only during an approved domain cutover |
| `NEXT_PUBLIC_SUPABASE_URL` | Saved as `https://bcxxnntastmnormcmxbq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Saved matching production publishable key; never record its literal value here or use a secret/service-role key |

`NEXT_PUBLIC_*` values are embedded into the browser build and are public by
design. The web project must not contain `DATABASE_URL`, `DIRECT_URL`, any
OpenAI key, any Supabase secret/service-role key, or `CRON_SECRET`—even as an
unreferenced variable.

Preview environment: only `EDISON_DEMO_MODE=true` and
`ENABLE_EXPERIMENTAL_COREPACK=1`. Preview is a UI/build check, never a client of
production Supabase or the production API.

Dashboard metadata confirms exactly those five Production Config values and
two Preview Config values. Development was left unchanged. The saved Build
Command is:

```sh
if [ "$VERCEL_ENV" = production ]; then node scripts/check-production-env.mjs web || exit 1; fi; pnpm build:web
```

### Live API project (`edison-api`)

| Setting | Value |
| --- | --- |
| Git source | Same repository and production branch |
| Root directory | `apps/api` |
| Include source files outside root | Enabled; required for workspace packages, root lockfile, and patches |
| Framework | Next.js |
| Node.js | `22.x` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | Production-only preflight guard, then `pnpm build` |
| Function region | `iad1`, paired with a US East Supabase project |
| Output | Next.js default |
| Assigned Production domain | `project-fjr95.vercel.app` |

Production-only environment:

| Name | Purpose / launch value |
| --- | --- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
| `DATABASE_URL` | Owner-saved Production Secret; value unread and untested. Must use the Supabase transaction-pooler URI, port `6543`, TLS required; never the direct connection |
| `SUPABASE_URL` | Saved as `https://bcxxnntastmnormcmxbq.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Saved matching publishable key used for Auth health; literal value omitted; not an admin key |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |
| `OPENAI_API_KEY` | Existing owner-saved Production Secret; value unread and omitted |
| `OPENAI_ARTICLE_MODEL` | Explicit approved and priced article model; currently `gpt-5.6-terra` (other families fail readiness and accounting closed) |
| `OPENAI_UTILITY_MODEL` | Explicit approved and priced utility model; currently `gpt-5.6-luna` (other families fail readiness and accounting closed) |
| `OPENAI_MAX_DAILY_GENERATIONS` | Saved as `4` for the tiny alpha; must be at least the daily target |
| `OPENAI_MAX_DAILY_ARTICLE_QUESTIONS` | Required rolling-24-hour per-reader quota, saved as `20` |
| `OPENAI_MAX_DAILY_FEED_COMMANDS` | Required rolling-24-hour per-reader quota, saved as `10` |
| `OPENAI_WEB_SEARCH_COST_MICROUSD` | Saved accounting estimate `10000`; recheck current pricing before deployment |
| `WEB_APP_URL` | Saved temporary origin `https://project-qlqve.vercel.app`, no trailing slash |
| `CORS_ALLOWED_ORIGINS` | Saved sole browser origin `https://project-qlqve.vercel.app`, never `*` |
| `CRON_SECRET` | Verified saved Production Secret; generated on explicit request using 32 random bytes encoded as 64 hex characters; no value printed or read back |
| `EDISON_ALLOWED_EMAILS` | Saved owner-only list `mike@michaelmcguiness.com`; authentication/readiness fail closed if missing or invalid |
| `EDISON_ADMIN_EMAILS` | Saved as the same owner email; every admin must also be allowed |
| `EDISON_DAILY_EDITION_LOCAL_HOUR` | Saved as `5` |
| `EDISON_DAILY_EDITION_TARGET` | Saved as `3` |
| `EDISON_DAILY_EDITION_BATCH_SIZE` | Saved as `25`; this controls catch-up work per run, not total spend |

The API runtime must not contain `DIRECT_URL`, `SUPABASE_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_ADMIN_KEY`, `EDISON_DEV_USER_ID`, or
`EDISON_DEV_USER_EMAIL`. `SUPABASE_SECRET_KEY` is needed only by a local,
short-lived invitation command; `DIRECT_URL` is needed only by migration and
backup operators.

Preview API deployments get no production credentials. A preview build may
exist, but its health endpoint should remain not-ready and its workflows should
not process real jobs.

Dashboard metadata confirms 17 Production Config values matching the table,
plus three Production Secrets: `DATABASE_URL`, `CRON_SECRET`, and the preserved
owner-saved `OPENAI_API_KEY`. No saved Secret value was read. API Preview
has exactly one Config value, `ENABLE_EXPERIMENTAL_COREPACK=1`, and no live
values. The saved API Build Command is:

```sh
if [ "$VERCEL_ENV" = production ]; then node ../../scripts/check-production-env.mjs api || exit 1; fi; pnpm build
```

### Credential-safe preflight

The repository includes `scripts/check-production-env.mjs`. It checks names,
presence, exact public origins, credential separation, pooler/TLS settings,
private-alpha lists, and safe scheduling ranges. It never loads a file
automatically and never prints secret, database, or email values.

On September 5, a local audit of the exact saved public web configuration passed
with zero warnings. No hosted secrets were loaded. All required API variable
names are now saved, but the full API preflight is still unexecuted and must
not be reported as passed based on environment-name metadata alone. Database
URL/TLS formatting and provider connectivity remain unverified.

Run it against one project's environment at a time before production promotion:

```sh
node scripts/check-production-env.mjs web
node scripts/check-production-env.mjs api
```

An exit code of `1` means release-blocking configuration; `2` means invalid
usage. Warnings do not fail the run. Do not merge web and API environment files
just to run the checker. If a temporary local environment file is needed, keep
it outside the repository, restrict its permissions, and remove it immediately
afterward.

Vercel Build Commands can also gate only production builds while preserving
credential-free previews:

```sh
# Web project
if [ "$VERCEL_ENV" = production ]; then node scripts/check-production-env.mjs web || exit 1; fi; pnpm build:web

# API project (Root Directory is apps/api)
if [ "$VERCEL_ENV" = production ]; then node ../../scripts/check-production-env.mjs api || exit 1; fi; pnpm build
```

## Supabase production setup

Use the existing empty US East `edison-production` project. It is already Pro;
do not apply the live migration or store reader data before the remaining gates
and explicit approval.

### Database

Current operator-access status: Supabase CLI 2.116.0 is authenticated through
the official browser login and linked to `bcxxnntastmnormcmxbq`. Its temporary
database login role completed the linked migration dry run without requesting
a database password. Do not copy the saved Vercel runtime secret into a
migration command or ask for it in chat.
The machine has no available container runtime, so clean local reset, pgTAP,
and schema lint cannot currently run here. Existing CI covers migration
application and pgTAP; the release change adds strict lint for `public`,
`private`, and `edison_public_api`. Require its fresh CI result before migration.

1. Enable MFA on the owner account and restrict project membership.
2. Store the database password in the password manager. Rotate it if it has ever
   appeared in chat, logs, shell history, source, or a preview environment.
3. Start a clean local Supabase stack and run, from the repository root:

   ```sh
   pnpm supabase:start
   pnpm supabase:reset
   pnpm exec supabase test db
   pnpm exec supabase db lint
   ```

   Confirm the clean reset applies every earlier base migration and then, in
   order, this production-readiness sequence:
   `20260904182546_editorial_directions_and_public_starter.sql`,
   `20260904184023_ai_request_cost_controls.sql`,
   `20260904184140_news_edition_lifecycle.sql`,
   `20260904185513_ai_request_snapshots.sql`,
   `20260904190546_explicit_usage_pricing_status.sql`,
   `20260904192144_preference_bounds.sql`, and
   `20260904195000_public_article_share_boundary.sql`.

4. Confirm pgTAP covers cross-user denial, inactive membership, public-share
   sanitization, public-share table denial and active-owner lookup, the
   `edison_api` role, editorial directions, public starter editions, and the
   `edison_public` role.
5. Link the CLI to the exact production project, then inspect without applying:

   ```sh
   pnpm exec supabase db push --linked --dry-run
   ```

6. Compare the dry run with the reviewed migration set and verify the backup
   checkpoint. The September 5 full-release authorization permits the real
   `db push` after these checks and fresh CI pass.
7. Use the transaction pooler for `DATABASE_URL` because Vercel Functions are
   serverless; port `6543`, prepared statements disabled by the checked-in DB
   client, and TLS required. Prefer certificate verification supported by the
   runtime. Keep the direct connection outside Vercel. See
   [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)
   and [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).
8. Enable SSL enforcement only after confirming every operator and runtime uses
   TLS; it can briefly restart connections.
9. Confirm RLS is enabled on every protected table and enforced when the API
   transactionally switches from the pooler user to the non-owner, non-login
   `edison_api` or `edison_public` role. The migrations intentionally do not use
   `FORCE ROW LEVEL SECURITY`; browser clients receive no core-table grants.

Do not add a database network allowlist that silently blocks Vercel's dynamic
egress. Revisit static egress/network restrictions if the selected Vercel
offering supplies stable addresses; application roles, TLS, RLS, rotated
credentials, and minimum runtime credentials remain mandatory either way.

### Auth and private-alpha access

The hosted project now matches the invite-only Auth intent at the temporary
web origin:

- Site URL: exactly `https://project-qlqve.vercel.app` until an approved domain
  cutover.
- Production redirect allowlist:
  `https://project-qlqve.vercel.app/auth/callback` and
  `https://project-qlqve.vercel.app/auth/confirm` only. Do not add a production
  wildcard or Vercel preview wildcard. See
  [redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).
- Global self-service signup and anonymous sign-in are disabled. The email
  provider remains enabled so invited users can redeem invitations; this does
  not reopen signup while the global gate is off. Locally,
  `[auth].enable_signup=false` supplies the deny, while
  `[auth.email].enable_signup=true` maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED` and
  must remain true for email invitations.
- The current asymmetric signing key is already ECC P-256; no rotation was
  needed. The API verifies public JWKS and never needs the signing secret.
- Keep OTP expiry at no more than 3,600 seconds and review Auth rate limits.
- Invite subject “Your Edison Reader invitation” and
  `supabase/templates/invite.html` are saved and persisted after reload. The
  rendered link is
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`; confirm-email is
  enabled, and no invitation was sent. The dashboard preview has an unresolved
  logo and the web project is undeployed; actual delivery and asset loading
  still require verification.
- Custom SMTP is saved on the Edison mail domain. Disable provider click
  tracking/link rewriting, then—only after separate send approval—verify
  delivery, expiry, and one-use behavior with the owner's mailbox. SPF and DKIM
  are already verified; optional DMARC remains a future decision.

Before each invitation, add the normalized email to `EDISON_ALLOWED_EMAILS`.
Add it to `EDISON_ADMIN_EMAILS` only if the owner explicitly approves that
reader as an administrator; ordinary readers must not receive admin access.
Redeploy the API only after the applicable approval. In a secure local operator
session, provide only
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `WEB_APP_URL`, then run:

```sh
pnpm invite reader@example.com
```

Never put the Supabase secret key in either Vercel project. The database trigger
creates the profile and active alpha membership for a newly invited Auth user;
therefore keeping all signup paths disabled is critical. To remove a reader,
revoke the alpha membership immediately, remove the allowlist entry, revoke
Auth sessions (and delete or ban the Auth user as appropriate), and follow the
documented export/deletion request.

Invited profiles intentionally begin with `onboarding_complete = false`, so the
scheduler cannot create a UTC-placeholder edition before knowing the reader's
local date. On the first authenticated browser visit, the non-blocking `/v1/me`
PATCH stores the browser's IANA timezone and activates scheduling. Do not
backfill this flag or change its default to true; readers can use the public
starter immediately while that first-visit activation completes.

## OpenAI production setup

API billing is separate from ChatGPT. Use an Edison-specific OpenAI API project,
not a personal reusable key and not an organization Admin API key.

1. Give the owner organization/project access with MFA. Create a production
   project and a project-scoped service account.
2. Restrict the key to only the API capabilities Edison uses and allow only the
   reviewed article/utility models. Put the resulting key only in the API
   project's Production environment.
3. Start with provider rate/token limits close to the private-alpha workload.
   Configure usage alerts around $25, $50, and $75 and a $75-$100 hard monthly
   spend limit. Hard limits return `429` and can overshoot slightly because of
   in-flight work, so Edison must fail gracefully and the provider cap is the
   last guard, not the first. See
   [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
   and [production practices](https://developers.openai.com/api/docs/guides/production-best-practices).
4. Confirm the code still sends `store: false`, structured outputs, bounded
   tokens/tool calls, and a stable pseudonymous safety identifier. Verify the
   two required rolling-quota values and exercise duplicate + abandoned-lease
   recovery against the frozen request snapshot. Confirm an observed invalid
   response is terminal only after being charged once, while an injected
   accounting failure keeps the original request retryable without consuming
   provider-attempt capacity. For article generation, also verify
   that mutable reader context cannot replace a durable request at the same
   direction revision, stale output is charged but never published, and an
   unexpected returned model identity is ledgered with
   `pricing_status = 'unpriced'` and `cost_microusd = NULL`, makes the aggregate
   estimated cost unknown, and stops publication for manual invoice
   reconciliation. It must never masquerade as a zero-cost response. Never log
   prompts, article bodies, tokens, or preference text.
5. Capture provider request IDs in error telemetry without request bodies so a
   failed call can be investigated. Rotate the project key after any suspected
   exposure.
6. Compare provider usage with `private.usage_ledger` daily for the first week.

OpenAI API data is not used to train models unless the organization opts in,
but default abuse-monitoring logs may retain content for up to 30 days even when
`store: false`. Explain this in the alpha privacy notice and tell readers not to
submit highly sensitive personal data. Zero Data Retention requires separate
eligibility and is not assumed. See
[OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
and [API authentication guidance](https://developers.openai.com/api/reference/overview).

## Cron, Workflow, CORS, and firewall

The API's checked-in `apps/api/vercel.json` is authoritative:

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/internal/cron/reconcile-feed-commands` | Every 5 minutes | Restart safely persisted feed commands |
| `/internal/cron/reconcile-generation-jobs` | Every 5 minutes | Restart safely persisted generation jobs |
| `/internal/cron/schedule-daily-editions` | Minute 5 of every UTC hour | Catch up readers whose configured local delivery hour has arrived |

Vercel sends `Authorization: Bearer <CRON_SECRET>` to cron routes when the
secret is configured. Verify that missing and wrong credentials return `401`,
and inspect the first real invocation of each route. Cron is UTC; daily delivery
logic performs the timezone calculation. Each scheduled slot receives at most
two independently identified jobs; after two failures the edition remains
visibly partial until the next local-date rotation. The current feed always
filters by both edition UUID and date and never paginates into history. Keep IDs
rather than article bodies in Workflow state, and treat Postgres job rows as
authoritative.

Set `CORS_ALLOWED_ORIGINS` to exact live browser origins only. No wildcard, no
path, no trailing slash, and no preview origins. Requests with no `Origin` are
allowed intentionally for native/server clients, but they still need a valid
bearer token and active membership. CORS is not authentication.

Before opening the alpha, configure Vercel WAF rate-limit rules for:

- `POST /v1/generation-jobs`
- `POST /v1/articles/*/conversation`
- `POST /v1/feed/commands`
- editorial-direction write routes and admin publication routes

Begin in log/count mode, verify legitimate behavior, then block at conservative
IP rates. IP limits protect the edge but do not replace atomic per-user database
quotas, because native users may share IPs and attackers can rotate them. See
[Vercel WAF custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules)
and [WAF usage/pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing).

## Backup and rollback

### Before every schema release

1. Confirm Supabase reports a recent successful automatic backup.
2. Make an encrypted logical dump through the direct connection and store it in
   owner-controlled off-site storage with tested access. Never commit it.
3. Restore that dump into a disposable project and record duration and result.
4. Record an initial recovery objective of at most 24 hours of data loss and a
   four-hour restore target; these are targets, not promises, until the drill
   proves them.
5. Remember that Supabase database backups do not include Storage objects. Add
   a separate object backup before Edison enables uploads.

### Application rollback

- Keep the previous known-good web and API deployment IDs. Roll back both when
  their contract changed together; otherwise roll back only the failed surface.
- A Vercel instant rollback does **not** restore or change active cron schedules.
  Compare the active cron list with the target commit and update/disable it
  manually. See
  [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- Verify `/v1/health`, login, one authenticated read, CORS, and all cron routes
  after rollback.
- Do not roll the app back across a destructive/incompatible database change.
  Use additive expand/contract migrations and prefer a reviewed forward-fix.

### Database/provider incident

- Pause invitations and AI generation first. Preserve evidence and request IDs.
- For a bad migration, choose a forward migration unless data corruption
  requires a restore. A restore causes downtime and may lose writes after the
  recovery point.
- For OpenAI cost/abuse, disable the production key or generation feature,
  rotate the key, retain usage-ledger evidence, and redeploy only after fixing
  the application-level control.
- For a credential incident, rotate the narrow credential first, invalidate
  affected sessions if needed, then audit Git history, Vercel environments,
  provider logs, and access lists. Never copy the exposed value into a ticket.

## Monitoring and cost controls

Vercel Observability is available on all plans, but current log retention is
short (approximately one day on Pro). Configure an external error tracker/log
destination before external readers depend on Edison; retain only operational
metadata and redact emails, bearer tokens, prompts, preferences, articles, and
database URLs. See [Vercel Observability](https://vercel.com/docs/observability)
and [platform limits](https://vercel.com/docs/limits).

Minimum alerts:

| Signal | Initial action threshold |
| --- | --- |
| `GET https://api.edisonreader.com/v1/health` | Two consecutive non-200 responses |
| Web login/public page | Two consecutive synthetic failures |
| Five-minute reconcilers | No successful invocation for 15 minutes |
| Hourly edition scheduler | No successful invocation for 90 minutes |
| Jobs/commands | Any repeated failure, or queued/running item older than 15 minutes |
| Auth/SMTP | Spike in rejected tokens, invite failure, bounce, or provider limit |
| Supabase | Storage/connection/CPU warning or failed backup |
| OpenAI | 50%, 75%, and 90% of monthly hard limit; unexpected model or token mix |
| Vercel | Low incremental usage alerts and an owner-reviewed pause action before the total monthly budget is exceeded |

Use `/v1/admin/jobs` only from an allowlisted admin session. It contains reader
identifiers and failure detail and must never become public monitoring output.
Correlate failures with Edison's `X-Request-ID` and the provider request ID.
Configure [Vercel Spend Management](https://vercel.com/docs/spend-management),
but decide explicitly whether the action should pause both projects: pausing is
a cost stop and a product outage.

## Release sequence

1. Close every must-pass code gate and run the clean local test/database suite.
2. Vercel/Supabase Pro, SMTP, and all required API variable names are in place,
   including the three Production Secrets. Provider budget alerts/caps, full
   API preflight, and runtime credential validation remain gates. Secure CLI
   access and linking are complete. Nobody sends secrets through chat.
3. Supabase Auth/JWT/SMTP, invite template, exact temporary callbacks, web/API
   public metadata, quotas, allowlists, origins, and build guards are configured.
4. Review the linked migration dry run, verify the checkpoint and fresh CI,
   then apply migrations under the current full-release authorization.
5. Deploy `edison-api` and `edison-app` to their temporary Vercel production
   URLs. Run both environment preflights. Keep apex/demo untouched.
6. Confirm API health is `200`; invite only the owner; verify token/JWKS,
   membership, the first-visit timezone PATCH, and scheduler activation.
7. Run one complete finite News edition. Verify exact UUID/date filtering,
   deterministic slot order, searched citations, usage ledger, job state,
   bounded failed-slot retry, save, feedback, Q&A idempotency, share
   sanitization, and share revocation.
8. Verify editorial-direction create/update/delete/undo concurrency, the
   50-per-section cap, future-generation effect, and stale-output guard. Verify
   the current and archived public starter responses contain only their
   documented sanitized schema.
9. Verify admin allowlist, non-admin denial, revoked-admin denial with a still
   valid token, CORS denial from another browser origin, unauthenticated denial,
   and cron denial/success behavior.
10. Inspect desktop/mobile layout, CSP console, server logs, Workflow telemetry,
    Supabase logs, email delivery, OpenAI usage, and all configured alerts.
11. Owner chooses the domain topology and explicitly approves attachment. Add
    `app.edisonreader.com` and `api.edisonreader.com`, then update and redeploy
    the web API URL, API web/CORS origins, and Supabase Site/redirect URLs as one
    coordinated cutover.
12. Repeat the complete smoke test on custom domains. Invite no more than two or
    three readers for 48 hours; review cost, reliability, and feedback before
    increasing the allowlist.

## User actions versus work that can be completed autonomously

The owner must personally review or perform:

- plan upgrades and billing/spend ceilings;
- Supabase/OpenAI/SMTP project ownership, MFA, and credential entry;
- first reader/admin email selection (enter them directly, not in chat);
- privacy/support wording and acceptable alpha risk;
- migration application, production promotion, domain attachment, and reader
  invitation approvals;
- incident/on-call ownership.

Codex can continue without secrets to finish code, tests, RLS coverage,
readiness coverage, the checked-in CI workflow, deployment manifests,
smoke-test scripts, and reviewable release checklists. It must stop before
purchases, external project mutations, secrets, live migration, deployment,
DNS, or email unless the owner separately authorizes that exact action.

## Reference checklist

- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Vercel production checklist](https://vercel.com/docs/production-checklist)
- [Vercel Functions pricing](https://vercel.com/docs/functions/usage-and-pricing)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [OpenAI production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [OpenAI safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
