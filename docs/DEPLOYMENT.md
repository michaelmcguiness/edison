# Edison deployment

## Current release authorization — September 5, 2026

The owner has authorized completing the production release autonomously. This
supersedes the earlier preparation-only stops below: secure CLI access,
reviewed migrations, candidate commit/push/promotion, existing live-project
deployment, and the single approved owner's invitation/acceptance testing are
authorized. Keep the existing apex demo and website domains unchanged. No
additional paid services, other readers, or disclosure of saved secrets.

Supabase CLI 2.116.0 is now authenticated through its official browser flow and
linked to `bcxxnntastmnormcmxbq`. Its temporary database role completed a linked
dry run proposing exactly the 13 checked-in migrations without applying them
or handling a database password. Strict schema lint has been added to CI after
pgTAP. Local lint, both typechecks, all 163 application tests, and both builds
pass; fresh pinned Node 22 CI and the backup checkpoint precede migration.
Independent review removed two forbidden direct Auth grants from the initial
migration; the final constrained PG17 role membership remains the permission
mechanism. New tests bring the expected totals to 164 application tests and
107 pgTAP assertions. The 66-test API suite, lint, and both typechecks pass.
Hosted preflight confirms zero Auth users, application tables, Edison roles,
reserved bucket, or existing provisioning trigger. Two physical backups are
listed, latest September 5 at 04:35:02 UTC; recovery is not yet rehearsed.
Deployment and real-provider acceptance tests remain pending.

The following setup record is historical; current authority is stated above.

## Authorized release preparation — September 4, 2026

The owner approved committing/pushing the production release candidate and
creating separate temporary Vercel web/API projects and a Supabase production
project. Use `codex/production-release-candidate` with a draft pull request so
the existing demo's automatic `main` deployment is not promoted incidentally.
Stop before paid upgrades, secret entry, live migrations, invitations, or
domain changes. This new authorization supersedes the older demo-only limits
below only for those named preparation actions.

### Preparation completed

- The initial release candidate `6d0ebe9` and permission fix `52aa993` are pushed on
  `codex/production-release-candidate` in
  [draft PR #1](https://github.com/michaelmcguiness/edison/pull/1).
  `main` and the apex demo were not promoted or changed.
- [CI run 33916066769](https://github.com/michaelmcguiness/edison/actions/runs/33916066769)
  passed for `52aa993`: lint, both typechecks, 163 application tests, both
  production builds on Node 22, and all 106 pgTAP assertions after clean
  disposable Supabase/PostgreSQL 17 migration application. Hosted readiness,
  schema lint, real-provider behavior, and backup/restore are still unverified.
- Two Vercel projects were created in the existing team (Hobby at creation,
  now verified Pro after the owner's upgrade):
  [`edison-app`](https://vercel.com/mike-michaelmcguis-projects/edison-app)
  (`prj_TLrYocZ2r6okKwPr59ht2XQo8bmp`) and
  [`edison-api`](https://vercel.com/mike-michaelmcguis-projects/edison-api)
  (`prj_BDlcI2KFhFawilRiMDvloXcOLnsd`). Both are now connected to only
  `michaelmcguiness/edison` with `main` as the production branch. Fresh
  September 5 overviews show **No Production Deployment** and **No Preview
  Deployments** for both. Neither has custom
  domains. The assigned Production domains are `project-qlqve.vercel.app` for
  web and `project-fjr95.vercel.app` for API. The owner-saved `OPENAI_API_KEY`
  remains a Production-only Secret in `edison-api`; only its metadata was
  inspected, never its value.
- Both use Next.js, Node 22.x, and `pnpm install --frozen-lockfile`. Web uses
  the repository root and `pnpm build:web`; API uses `apps/api`, includes
  source outside its root, and runs `pnpm build`. API's selected function
  region is Washington, D.C. (`iad1`). Output directories remain defaults.
- Both Production Build Commands now fail closed through the checked-in
  environment preflight before running the build. Web uses
  `if [ "$VERCEL_ENV" = production ]; then node scripts/check-production-env.mjs web || exit 1; fi; pnpm build:web`;
  API uses
  `if [ "$VERCEL_ENV" = production ]; then node ../../scripts/check-production-env.mjs api || exit 1; fi; pnpm build`.
- After the initial permission-review pause, the owner explicitly approved
  Supabase sign-in with the `michaelmcguiness` GitHub account and connecting
  only `michaelmcguiness/edison` to both Vercel projects. Vercel's existing
  GitHub access was sufficient; no broader installation permissions were
  requested or granted.
- The owner completed Supabase GitHub sign-in as `michaelmcguiness` and
  created
  [`edison-production`](https://supabase.com/dashboard/project/bcxxnntastmnormcmxbq)
  in the existing **Mike's Org** (`sarqlycnznjatyftxttz`), initially Free and
  now independently verified **Pro** after the owner's upgrade.
  The organization inventory shows one project, AWS **us-east-1** (North
  Virginia), **Nano**. Its overview reports **Healthy**, and General
  settings confirm PostgreSQL **17.6.1.166**, matching the tested major.
- The creation form used standard Postgres, Data API enabled,
  **Automatically expose new tables** disabled, and automatic RLS off
  (the migrations explicitly define RLS). Hosted Auth restrictions are now
  configured as recorded below; actual hosted database grants still require
  post-migration verification. The overview reports
  no GitHub schema-deployment connection or migrations. It now shows a recent
  backup; backup contents, retention, and recovery remain unverified.
- No database password was read, generated, or entered by the agent.
  Creation required owner-handled credential entry. The stale creation tab
  did not confirm submission; a fresh organization inventory independently
  confirmed the single created project. Do not submit that form again.
- No live migrations, deployments, or invitations were performed by the agent.
  The Supabase public URL and matching publishable key are configured in the
  appropriate Production Vercel projects. Subsequent authorized database/cron
  entry is complete as recorded below; no application has been deployed against
  this database.
- The owner created and signed into Resend via GitHub, then explicitly approved
  adding `mail.edisonreader.com` and its required email-verification DNS records
  in Vercel without changing website routing. The domain is now **Verified**:
  [Resend domain](https://resend.com/domains/81f985d3-02be-48bd-b9d1-9f7e6902114e),
  region `us-east-1`. DKIM and both sending/SPF records are Verified, Sending
  is on, Receiving is off, and tracking is unconfigured.
- Exactly three DNS records were added in Vercel, each TTL 60:
  `resend._domainkey.mail` TXT (the exact Resend-generated public DKIM key),
  `send.mail` MX priority 10 to `feedback-smtp.us-east-1.amazonses.com.`, and
  `send.mail` TXT `v=spf1 include:amazonses.com ~all`. Both authoritative
  nameservers and resolver `1.1.1.1` return the exact records. No existing
  records, nameservers, optional DMARC policy, inbound-mail MX, or website
  project connections were changed. Apex HTTPS remains 200 with the demo
  banner; `www` remains a path/query-preserving 308; TLS verification passes.
- The owner reports creating the Resend key and saving custom SMTP. A fresh
  Supabase settings page confirms SMTP enabled, sender
  `Edison <auth@mail.edisonreader.com>`, host `smtp.resend.com`, port `465`,
  and minimum interval 60 seconds. The owner corrected the Username from
  `edison-production` to `resend`; an independent fresh settings page on
  September 5 confirms the correction is saved and custom SMTP remains enabled.
  The password was not revealed, changed, or read by the agent. Resend key
  permissions, credential validity, and actual email delivery remain unverified.
  The intended key is Sending-access restricted to `mail.edisonreader.com`,
  entered only in Supabase Auth's SMTP Password field, never in chat, source
  control, or Vercel. No Resend secret was created or read by the agent.

### Non-secret live-project configuration — September 5, 2026

The owner explicitly authorized and the dashboards confirm the following saved
state. Public publishable-key values are deliberately not copied into this file.

- `edison-app` Production has exactly five Config values: Corepack `1`, demo
  mode `false`, API URL `https://project-fjr95.vercel.app/v1`, Supabase URL
  `https://bcxxnntastmnormcmxbq.supabase.co`, and the matching Supabase
  publishable key. Preview has exactly Corepack `1` and demo mode `true`, with
  no live URLs or credentials. Development was left unchanged.
- `edison-api` Production has 17 Config values: Corepack `1`; the same Supabase
  URL and publishable key; JWT audience `authenticated`; article model
  `gpt-5.6-terra`; utility model `gpt-5.6-luna`; rolling per-reader quotas of 4
  generations, 20 article questions, and 10 feed commands; web-search cost
  estimate `10000` microdollars per call; both `WEB_APP_URL` and the sole CORS
  origin set to `https://project-qlqve.vercel.app`; initial edition settings
  hour `5`, target `3`, batch `25`; and both allowed-reader and admin lists set
  to the owner-provided `mike@michaelmcguiness.com`. The existing Production
  OpenAI Secret was preserved unread. Subsequent authorized entry added
  `DATABASE_URL` and `CRON_SECRET` as Production-only Secrets, for three Secrets
  total; their saved values were not revealed or connection-tested.
- `edison-api` Preview now has exactly one Config value,
  `ENABLE_EXPERIMENTAL_COREPACK=1`, and no live URL or credential values.
- No deploy/redeploy, push, branch change, custom-domain alias, invitation,
  migration, or additional secret entry was performed under this authorization.
- A read-only attempt to open Supabase's Direct Connection string was blocked
  before execution because it could expose credentials. No connection value or
  inferred pooler hostname was read or stored, and no workaround was attempted.
  The later approved database/cron entry is recorded below; never send either
  value through chat or documentation. Secure local migration access is a
  separate approval boundary.

Hosted Supabase Auth now has global signup and anonymous sign-in disabled while
the email provider remains enabled for invitations. Site URL is exactly
`https://project-qlqve.vercel.app`, and the only redirect URLs are that origin's
`/auth/callback` and `/auth/confirm`. The current JWT signing key is already ECC
P-256; no rotation was needed. Invite subject “Your Edison Reader invitation”
and `supabase/templates/invite.html` are saved and persisted after reload. The
rendered link is exactly
`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`; no message was sent.

The checked-in local pairing is intentional: `[auth].enable_signup=false`
denies global self-service signup, while `[auth.email].enable_signup=true` keeps
the email provider enabled and maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Do not
change the latter to false as a proxy for invite-only access. Confirm-email is
enabled. Fifteen focused authentication/configuration tests pass. The dashboard
invite preview has an unresolved logo and the web project is still undeployed;
real delivery and asset loading remain release gates.

These are provisioned resources, not a deployed production service.

The owner subsequently approved guided private entry, entered `DATABASE_URL`,
and explicitly requested generation of `CRON_SECRET`. The agent filled only
the cron field with 32 cryptographically random bytes encoded as 64 hexadecimal
characters; neither secret was printed or read back, and the database field
was left untouched. The owner saved the form and confirmed completion.
A September 5 metadata-only check independently confirms both names as
Production-only Secrets alongside the existing OpenAI Secret. The full API
preflight, database URL/TLS validation, and connection testing have not run.
This does not authorize secret inspection, secure local migration access,
deployment, migration, or invitations.

Future Git pushes may trigger builds in the newly connected projects. This
connection-status update is intentionally local until publishing is intended.
The existing demo's Git integration independently built a credential-free
preview of the release branch; that did not change the apex deployment.

## Current hosted phase: isolated sample-data demo

The owner has now asked for the production private-alpha application to be
built in the repository. The hosted environment has not been converted: it is
still a sample-data demo with **no live-service credentials**. The owner has
upgraded the hosting plans, and separate production resources exist as recorded
above; these do not activate the demo or authorize deployment, invitations, or
connecting additional services merely because the production code exists.

The explicit server-only flag `EDISON_DEMO_MODE=true` makes the sample UI
available in a production build. Without it, an unconfigured production app
shows the setup screen and a configured live app still requires authentication.
The demo has sample stories and no account-backed state. Reading state resets on
reload; editorial drafts and direction may remain in the browser’s device-local
workspace. It has no real auth, AI generation, server-side personalization, or
working public article sharing. Keep the sample-data notice visible.

Before the owner's Pro upgrade, Hobby permitted personal, non-commercial use.
The word “demo” does not create an
exception for commercial use; reassess before commercial use or a product
launch. See [Vercel Hobby policy](https://vercel.com/docs/plans/hobby).

### Current authorization and access

1. GitHub authorization was completed for the selected source repository:
   [michaelmcguiness/edison](https://github.com/michaelmcguiness/edison).
   The owner has approved publishing reviewed code there with public visibility.
2. The repository is connected to the existing Vercel team's
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
not an architecture rewrite. Use the existing separate live web project with
`EDISON_DEMO_MODE=false`, activate the independent API and Supabase stack, and
complete every launch check below. Keep the existing apex demo isolated and
keep previews credential-free in explicit demo mode.

The live alpha uses one production Supabase project and two Vercel projects.
There is no paid staging environment initially. Local Supabase is the database
test environment, and Vercel previews are build/UI checks. Never point a
preview deployment at the production database.

### Completed prerequisites and remaining owner gates

Vercel Pro, Supabase Pro, Git connections, the US East Supabase project,
verified sending domain/custom SMTP, temporary public connection metadata, and
the initial owner reader/admin allowlists are in place. Remaining owner-private
or explicitly approved gates are:

1. Configure `DATABASE_URL` and `CRON_SECRET` without sending either through
   chat or source control.
2. Approve and configure provider budget alerts/caps and WAF rules.
3. Review the linked migration dry run, backup/restore evidence, and schema
   lint, then separately approve any real migration.
4. Separately approve live deployment, an owner-only invitation/delivery test,
   and any custom-domain attachment.

Enter every credential directly in the relevant dashboard or local
`.env.local`; do not paste credentials into chat, commits, tickets, or docs.

### Supabase setup

The candidate is verified against PostgreSQL 17, matching
`supabase/config.toml`. Confirm the production project's major version before
planning migrations; the Auth-helper membership migration uses PostgreSQL
16+ membership options and must not be applied to an older database.

1. Link the CLI to the production project.
2. Run database tests against local Supabase first.
3. Inspect `supabase db push --dry-run`, then apply the committed migrations.
4. Keep global self-service signup and anonymous sign-in disabled; keep the
   email provider enabled so administrator-issued invitations can be redeemed.
5. In Auth > JWT Signing Keys, make an asymmetric key (preferably ES256) the
   active signing key. The API intentionally verifies user tokens through the
   project's public JWKS endpoint rather than sharing a JWT secret.
6. Keep the temporary Production Site URL and its two exact Auth redirects until
   the coordinated custom-domain cutover.
7. Keep `supabase/templates/invite.html` and its verified invite subject saved.
8. Custom SMTP is configured; validate delivery only after separate approval to
   send a test invitation to the owner.
9. Use the transaction-pooler URL for `DATABASE_URL`; keep the direct URL only
   for migrations and administrative backup/restore work.

### Live Vercel projects

Use the two existing projects from the same repository and keep automatic
preview deployments credential-free.

#### Web project

- Root directory: `.`
- Production environment:
  - `ENABLE_EXPERIMENTAL_COREPACK=1`
  - `EDISON_DEMO_MODE=false`
  - `NEXT_PUBLIC_API_URL=https://project-fjr95.vercel.app/v1`
  - `NEXT_PUBLIC_SUPABASE_URL=https://bcxxnntastmnormcmxbq.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` matching that project; do not copy it
    into documentation
- Preview environment: only `ENABLE_EXPERIMENTAL_COREPACK=1` and
  `EDISON_DEMO_MODE=true`
- Build command:
  `if [ "$VERCEL_ENV" = production ]; then node scripts/check-production-env.mjs web || exit 1; fi; pnpm build:web`

#### API project

- Root directory: `apps/api`
- Enable **Include source files outside of the Root Directory** so the API build
  receives the root lockfile, patches, and shared workspace packages.
- Region: close to the Supabase project
- Assigned Production domain: `project-fjr95.vercel.app`
- Build command:
  `if [ "$VERCEL_ENV" = production ]; then node ../../scripts/check-production-env.mjs api || exit 1; fi; pnpm build`
- Production environment:
  - `ENABLE_EXPERIMENTAL_COREPACK=1`
  - `DATABASE_URL` — owner-saved Production Secret; value unread and untested
  - `SUPABASE_URL=https://bcxxnntastmnormcmxbq.supabase.co`
  - `SUPABASE_PUBLISHABLE_KEY` matching that project; do not copy it into docs
  - `SUPABASE_JWT_AUDIENCE=authenticated`
  - `OPENAI_API_KEY` — existing owner-saved Production Secret, unread
  - `OPENAI_ARTICLE_MODEL=gpt-5.6-terra`
  - `OPENAI_UTILITY_MODEL=gpt-5.6-luna`
  - `OPENAI_MAX_DAILY_GENERATIONS=4`
  - `OPENAI_MAX_DAILY_ARTICLE_QUESTIONS=20`
  - `OPENAI_MAX_DAILY_FEED_COMMANDS=10`
  - `OPENAI_WEB_SEARCH_COST_MICROUSD=10000`
  - `WEB_APP_URL=https://project-qlqve.vercel.app`
  - `CORS_ALLOWED_ORIGINS=https://project-qlqve.vercel.app`
  - `CRON_SECRET` — verified saved Production Secret; generated on explicit request, no value printed or read back
  - `EDISON_ADMIN_EMAILS=mike@michaelmcguiness.com`
  - `EDISON_ALLOWED_EMAILS=mike@michaelmcguiness.com`
  - `EDISON_DAILY_EDITION_LOCAL_HOUR=5`
  - `EDISON_DAILY_EDITION_TARGET=3`
  - `EDISON_DAILY_EDITION_BATCH_SIZE=25`

The API has 17 persisted Production Config values and three Production Secrets:
`DATABASE_URL`, `CRON_SECRET`, and `OPENAI_API_KEY`. API Preview contains only
`ENABLE_EXPERIMENTAL_COREPACK=1`; every live URL and credential stays out.

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
