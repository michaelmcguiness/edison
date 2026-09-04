# Edison deployment

## Current phase: personal sample-data demo on Vercel Hobby

The owner has chosen a personal, non-commercial demo with **no paid services
now**. Deploy only the root web project. Do not deploy `apps/api`, provision a
database, invite real readers, or connect AI/email services for this phase.

The explicit server-only flag `EDISON_DEMO_MODE=true` makes the sample UI
available in a production build. Without it, an unconfigured production app
shows the setup screen and a configured live app still requires authentication.
The demo has sample stories and in-memory UI interactions that reset on reload;
it has no real auth, AI generation, persisted personalization, or working
public article sharing. Keep the sample-data notice visible.

Hobby permits personal, non-commercial use. The word “demo” does not create an
exception for commercial use; reassess before commercial use or a product
launch. See [Vercel Hobby policy](https://vercel.com/docs/plans/hobby).

### What the owner needs to provide now

1. GitHub authorization for the selected source repository:
   [michaelmcguiness/edison](https://github.com/michaelmcguiness/edison).
   The owner has approved publishing reviewed code there with public visibility.
2. Access to the existing Vercel Hobby account.
3. Approval for the separate Vercel deployment and domain attachment steps.

No upgrade, Supabase project, OpenAI billing, SMTP provider, admin email, or
live-service secret is needed for this demo. Do not request or paste secrets
into chat. The decision to keep this a demo is not deployment approval.

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
| Production environment | `EDISON_DEMO_MODE=true` only |
| Preview environment | `EDISON_DEMO_MODE=true` only |

Do not add Supabase, API, OpenAI, SMTP, or cron environment values. Do not
create an `apps/api` Vercel project or copy its `vercel.json` into the root.
The root web deployment has no cron jobs. Existing backend/workflow files stay
intact for later: their five-minute and hourly schedules are not supported by
[Hobby's once-daily cron limit](https://vercel.com/docs/cron-jobs/usage-and-pricing).

### Demo release checks

1. Review the working tree, run lint, TypeScript checks, tests, and the web
   production build. Preserve unrelated owner changes.
2. Publish the reviewed commit to the approved GitHub repository, then obtain
   approval for the separate temporary Vercel deployment.
3. Deploy only the root web project with the settings above.
4. Verify the temporary URL shows the sample-data notice and opens without a
   Supabase login/setup requirement; check feed, article, library, and profile
   layouts on desktop and mobile.
5. Confirm session-only controls reset on reload and AI/share actions clearly
   explain that they need a connected backend. Verify no API or AI requests
   are made by the demo.
6. Check deployment protection before sharing. A generated Vercel URL alone is
   not privacy protection. Do not attach a custom domain or publicly launch
   without separate explicit approval.

Local Supabase/Docker and database tests are not blockers for this sample-data
web deployment. They remain requirements before activating the later live
database. No staging environment is needed for the demo.

## Later phase: live private alpha

This preserves the approved client/server architecture; graduating from the
demo is configuration and release work, not an architecture rewrite. Remove
or set `EDISON_DEMO_MODE=false` on the live production web project, activate
the independent API and Supabase stack, and complete the launch checks below.
Previews must remain credential-free and can retain explicit demo mode.

The live alpha uses one production Supabase project and two Vercel projects.
There is no paid staging environment initially. Local Supabase is the database
test environment, and Vercel previews are build/UI checks. Never point a
preview deployment at the production database.

### What the owner will need for the live alpha

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
  - `OPENAI_WEB_SEARCH_COST_MICROUSD`
  - `WEB_APP_URL=https://<web-host>`
  - `CORS_ALLOWED_ORIGINS=https://<web-host>`
  - `CRON_SECRET` (a newly generated high-entropy value)
  - `EDISON_ADMIN_EMAILS`
  - `EDISON_ALLOWED_EMAILS` if a second explicit allowlist is desired
  - `EDISON_DAILY_EDITION_LOCAL_HOUR`
  - `EDISON_DAILY_EDITION_TARGET`
  - `EDISON_DAILY_EDITION_BATCH_SIZE`

The API readiness endpoint returns `503` until required configuration,
Postgres, and Supabase Auth are all reachable.

`OPENAI_WEB_SEARCH_COST_MICROUSD` is an accounting estimate, not a billing
control. Recheck it against OpenAI's current tool pricing before launch and
reconcile Edison's usage ledger against the provider dashboard.

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
