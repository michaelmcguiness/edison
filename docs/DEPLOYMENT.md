# Edison deployment

## Authorized release preparation — September 4, 2026

The owner approved committing/pushing the production release candidate and
creating separate temporary Vercel web/API projects and a Supabase production
project. Use `codex/production-release-candidate` with a draft pull request so
the existing demo's automatic `main` deployment is not promoted incidentally.
Stop before paid upgrades, secret entry, live migrations, invitations, or
domain changes. This new authorization supersedes the older demo-only limits
below only for those named preparation actions.

## Current hosted phase: sample-data demo on Vercel Hobby

The owner has now asked for the production private-alpha application to be
built in the repository. The hosted environment has not been converted: it is
still a personal, non-commercial demo with **no paid services or live
credentials**. Do not deploy `apps/api`, provision a database, invite readers,
or connect AI/email services merely because the production code exists.

The explicit server-only flag `EDISON_DEMO_MODE=true` makes the sample UI
available in a production build. Without it, an unconfigured production app
shows the setup screen and a configured live app still requires authentication.
The demo has sample stories and no account-backed state. Reading state resets on
reload; editorial drafts and direction may remain in the browser’s device-local
workspace. It has no real auth, AI generation, server-side personalization, or
working public article sharing. Keep the sample-data notice visible.

Hobby permits personal, non-commercial use. The word “demo” does not create an
exception for commercial use; reassess before commercial use or a product
launch. See [Vercel Hobby policy](https://vercel.com/docs/plans/hobby).

### Current authorization and access

1. GitHub authorization was completed for the selected source repository:
   [michaelmcguiness/edison](https://github.com/michaelmcguiness/edison).
   The owner has approved publishing reviewed code there with public visibility.
2. The repository is connected to the existing Vercel Hobby account's
   [`edison` project](https://vercel.com/mike-michaelmcguis-projects/edison).
3. The owner has approved this disconnected root demo deployment to a
   Vercel production URL, then purchased `edisonreader.com` on Vercel and
   explicitly approved connecting it. The primary demo URL is now
   [edisonreader.com](https://edisonreader.com/); the
   [Vercel alias](https://edison-lake-phi.vercel.app/) is retained.
   Live services, paid hosting upgrades, additional domains, and a broader
   product launch still require separate approval.

No upgrade, Supabase project, OpenAI billing, SMTP provider, admin email, or
live-service secret is needed for this demo. Do not request or paste secrets
into chat. The recorded deployment approval is limited to this root web demo.

### Verified initial deployment — September 4, 2026

- Source commit: `4855596` on GitHub `main`.
- Hosted clean install: pnpm 10.28.0; successful Next 16.3.4 Webpack build.
  The deployed runtime and saved Vercel project setting are Node.js 22.x.
- All 12 unauthenticated smoke checks passed: `/` and three static assets
  returned 200; `/login`, `/admin/jobs`, `/auth/callback`, and `/auth/confirm`
  redirected home with 307; POST `/auth/signout` redirected home with 303;
  sample share, API, and cron paths returned 404.
- Desktop at 1440px and mobile at 390px had no horizontal overflow. Onboarding,
  article reading, summary-to-full-story navigation, saves/library, profile,
  and session-state resets on reload were verified. Browser error logs were
  empty during these checks.
- Standard Vercel Authentication remains enabled. The stable production URL
  accepts anonymous visitors; the unique deployment URL redirects to Vercel
  sign-in. Do not describe the stable production demo as private.
- Production and Preview variables are configured as below, but a separate
  Preview deployment has not been tested. No live services or paid hosting
  upgrades were activated by that initial deployment.

### Custom domain and Git integration — September 4, 2026

- The owner purchased `edisonreader.com` through Vercel and authorized attaching
  it to the existing Edison Production project. Vercel reports Valid
  Configuration for the apex, and [its HTTPS page](https://edisonreader.com/)
  loads the sample UI. The existing Vercel alias remains available.
- Both apex and `www` passed independent TLS verification
  (`ssl_verify_result=0`). HTTPS on the apex returns 200 with the sample banner.
  `www.edisonreader.com` returns a 308 Permanent Redirect to the apex while
  preserving paths and query parameters; HTTP upgrades to HTTPS. Domain checks
  also confirm `/login` redirects home with 307 while share, API, and cron paths
  return 404.
- Docs-only commit `87973fd` automatically deployed successfully from GitHub
  `main`, confirming the Git deployment integration. The application code is
  unchanged from the initial verified release.
- Domain attachment does not activate Supabase, OpenAI, the API, crons, or a
  paid hosting upgrade. The product remains the disconnected Hobby demo.

### Demo Vercel project settings

Create exactly one Next.js project from the reviewed repository:

| Setting | Value |
| --- | --- |
| Root directory | `.` |
| Framework | Next.js |
| Node.js | 22.x |
| Package manager | pnpm 10.28.0, pinned in `package.json` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build:web` |
| Output directory | Next.js default; do not override |
| Production environment | `EDISON_DEMO_MODE=true`, `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Preview environment | `EDISON_DEMO_MODE=true`, `ENABLE_EXPERIMENTAL_COREPACK=1` |

The Corepack variable is a build-tool setting, not a live-service credential.
It makes Vercel honor `packageManager: pnpm@10.28.0` in the root `package.json`.
Without Corepack, an overridden pnpm install command can select an older
supported version. See [Vercel package managers](https://vercel.com/docs/package-managers)
and [Corepack configuration](https://vercel.com/docs/builds/configure-a-build#corepack).

Do not add Supabase, API, OpenAI, SMTP, or cron environment values. Do not
create an `apps/api` Vercel project or copy its `vercel.json` into the root.
The root web deployment has no cron jobs. Existing backend/workflow files stay
intact for later: their five-minute and hourly schedules are not supported by
[Hobby's once-daily cron limit](https://vercel.com/docs/cron-jobs/usage-and-pricing).

### Demo release checks

1. Review the working tree, run lint, TypeScript checks, tests, and the web
   production build. Preserve unrelated owner changes.
2. Publish the reviewed commit to the approved GitHub repository and confirm
   approval for the Vercel deployment. Both have been completed for this root
   demo, as has separate approval for its apex domain and `www` redirect;
   production deployment and live-service activation remain unapproved.
3. Deploy only the root web project with the settings above.
4. Verify the production URL shows the sample-data notice and opens without a
   Supabase login/setup requirement; check feed, article, library, and profile
   layouts on desktop and mobile.
5. Confirm session-only controls reset on reload and AI/share actions clearly
   explain that they need a connected backend. Verify no API or AI requests
   are made by the demo.
6. Check deployment protection before sharing. A generated Vercel URL alone is
   not privacy protection. The approved production demo is public on
   `edisonreader.com` and its Vercel alias; do not attach additional domains or
   broaden the product launch without separate explicit approval.

Local Supabase/Docker and database tests are not blockers for this sample-data
web deployment. They remain requirements before activating the production
private-alpha database. No staging environment is needed for the demo.

## Production private-alpha release (not deployed)

The production client/server implementation is now the repository target;
graduating from the hosted demo is configuration and controlled release work,
not an architecture rewrite. Create a separate live web project with
`EDISON_DEMO_MODE=false`, activate the independent API and Supabase stack, and
complete every launch check below. Keep the existing apex demo isolated and
keep previews credential-free in explicit demo mode.

The live alpha uses one production Supabase project and two Vercel projects.
There is no paid staging environment initially. Local Supabase is the database
test environment, and Vercel previews are build/UI checks. Never point a
preview deployment at the production database.

### What the owner will need for the private alpha

1. Vercel Pro for the current API schedules, a suitable Supabase plan (Pro is
   recommended for backups and availability once readers depend on it), and
   OpenAI billing/accounts.
2. Access to the Git host/repository that Vercel should deploy.
3. A production Supabase project in the same general region as the Vercel API.
4. A transactional email provider connected to Supabase Auth before external
   invitations.
5. The first reader/admin email addresses.
6. Explicit approval before any deployment or custom-domain attachment.

Enter every credential directly in the relevant dashboard or local
`.env.local`; do not paste credentials into chat, commits, tickets, or docs.

### Supabase setup

1. Link the CLI to the production project.
2. Run database tests against local Supabase first.
3. Inspect `supabase db push --dry-run`, then apply the committed migrations.
4. Keep global and email self-service signup disabled.
5. In Auth > JWT Signing Keys, make an asymmetric key (preferably ES256) the
   active signing key. The API intentionally verifies user tokens through the
   project's public JWKS endpoint rather than sharing a JWT secret.
6. Set the production Site URL and redirect allowlist.
7. Install `supabase/templates/invite.html` as the Invite email template.
8. Configure custom SMTP and send a test invitation to the owner.
9. Use the transaction-pooler URL for `DATABASE_URL`; keep the direct URL only
   for migrations and administrative backup/restore work.

### Live Vercel projects

Create both projects from the same repository and keep automatic preview
deployments credential-free.

#### Web project

- Root directory: `.`
- Production environment:
  - `EDISON_DEMO_MODE=false` (or remove the demo flag)
  - `NEXT_PUBLIC_API_URL=https://<api-host>/v1`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

#### API project

- Root directory: `apps/api`
- Enable **Include source files outside of the Root Directory** so the API build
  receives the root lockfile, patches, and shared workspace packages.
- Region: close to the Supabase project
- Production environment:
  - `DATABASE_URL`
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_JWT_AUDIENCE=authenticated`
  - `OPENAI_API_KEY`
  - `OPENAI_ARTICLE_MODEL`
  - `OPENAI_UTILITY_MODEL`
  - `OPENAI_MAX_DAILY_GENERATIONS`
  - `OPENAI_MAX_DAILY_ARTICLE_QUESTIONS`
  - `OPENAI_MAX_DAILY_FEED_COMMANDS`
  - `OPENAI_WEB_SEARCH_COST_MICROUSD`
  - `WEB_APP_URL=https://<web-host>`
  - `CORS_ALLOWED_ORIGINS=https://<web-host>`
  - `CRON_SECRET` (a newly generated high-entropy value)
  - `EDISON_ADMIN_EMAILS`
  - `EDISON_ALLOWED_EMAILS` (required, fail-closed private-alpha allowlist)
  - `EDISON_DAILY_EDITION_LOCAL_HOUR`
  - `EDISON_DAILY_EDITION_TARGET`
  - `EDISON_DAILY_EDITION_BATCH_SIZE`

The API readiness endpoint returns `503` until required configuration,
Postgres, and Supabase Auth are all reachable.

`OPENAI_WEB_SEARCH_COST_MICROUSD` is an accounting estimate, not a billing
control. Recheck it against OpenAI's current tool pricing before launch and
reconcile Edison's usage ledger against the provider dashboard. If the provider
returns an unexpected model identity, Edison records its tokens and response ID
as explicitly `unpriced` with a `NULL` cost and stops that operation. Treat the
aggregate estimate as unknown and reconcile manually; never convert that
missing price to a zero-cost call.

### Live private launch sequence

1. Deploy to temporary Vercel production URLs without attaching custom domains.
2. Confirm `/v1/health` returns `200` and all readiness checks are `ok`.
3. Invite only the owner and complete sign-in/onboarding.
4. With the freshly issued owner session, confirm `/v1/me` succeeds; this proves
   the deployed API can resolve the token's `kid` through Supabase Auth JWKS.
5. Generate an article, verify citations, save it, share it, and inspect the
   generation job in `/admin/jobs`.
6. Verify the daily scheduler plus generation-job and feed-command reconciler
   logs once.
7. Add Vercel Firewall rate limits around generation, article Q&A, and feed
   command POST routes. Configure a conservative OpenAI project budget, usage
   alerts, and model rate limits; provider budgets must be treated as alerts
   unless the provider explicitly documents them as hard stops.
8. Take a database backup/restore checkpoint.
9. Attach `app.edisonreader.com` and `api.edisonreader.com` only after explicit
   owner approval, then update Auth URLs, CORS, and the web/API origins together.

## When to add staging

Add a separate Supabase staging project (or short-lived database branches) when
there are multiple regular developers, schema migrations are frequent, hosted
integration tests become part of CI, or production has enough active readers
that testing a migration there is no longer an acceptable risk. Until then, a
second always-on stack adds cost and configuration drift without much benefit.
