# Edison deployment

## Current release authorization — September 5, 2026

The database connection and owner sign-in are working. Authenticated API reads
and first-visit New York timezone persistence pass. The provider schema fix is
live, and one real article with a priced usage record has been produced. Full
reading/editorial acceptance and provider-dashboard reconciliation remain; no
owner credential, invitation, database setting, or key-scope change is pending.

The owner has authorized completing the production release autonomously. This
supersedes the earlier preparation-only stops below: secure CLI access,
reviewed migrations, candidate commit/push/promotion, existing live-project
deployment, and the single approved owner's invitation/acceptance testing are
authorized. Keep the existing apex demo and website domains unchanged. No
additional paid services, other readers, or disclosure of saved secrets.

Candidate `4f774eb` is committed and pushed on
`codex/production-release-candidate`; draft PR #1 remains open and `main` is
unmerged and unprotected. [CI run 33987973278](https://github.com/michaelmcguiness/edison/actions/runs/33987973278)
passed lint, both typechecks, 183 application tests (110 web, 73 API), both
production builds, all 107 pgTAP assertions, and strict schema lint on Node
22.23.2/pnpm 10.28.0.

The reviewed dry run and backup checkpoint preceded successful application of
all 13 migrations to Supabase project `bcxxnntastmnormcmxbq`. A separate
read-only hosted audit found 24/24 expected tables, RLS on all 21 expected
tables, 45 policies, 20 triggers, zero invalid constraints, the expected
Storage bucket, and the intended role and grant boundaries. Auth was empty at
that audit and now contains the single invited owner. Recovery is not rehearsed.

Release-branch pushes now correctly target Preview; the current live-project
deployments were explicit Production rebuilds. Web deployment
`dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` of `d463d44` served
`https://project-qlqve.vercel.app` with HTTP 200 and the expected nonce-based CSP
at 19:12:56Z. The apex demo remained the older isolated sample deployment and
returned HTTP 200 at 19:12:58Z.

Production API deployment `dpl_GVJFA1vDQks3eBya4ArrXGpCHzFU` of `df3e712` was
Ready at 19:11:12Z (15:11:12 EDT). Health at 19:11:46Z returned HTTP 200 with
configuration, database, and Auth all `ok`. The owner privately corrected the
Shared Pooler URI; the client now enforces TLS even when that URI has no TLS
query suffix. Runtime and preflight share the same policy, retain stronger
certificate verification, and reject insecure or ambiguous overrides. No saved
secret was read or altered by the agent.

Root and independent hosted checks passed: no-auth `/v1/me` is 401, allowed
CORS preflight is 204 with exact origin reflection, denied CORS is 403 without
reflection, and all six missing/wrong-token GET cron checks are 401. The public
starter read reaches its real SQL role and returns the expected
`404 starter_edition_unavailable`; no starter is published. These checks preceded
the valid owner-only scheduler attempt described below.

Dedicated OpenAI project `edison-production`
(`proj_EFKsL4Yfs6pDFOzI4aGWThSf`) has an enforced $50 monthly project cap and
allows only `gpt-5.6-terra` and `gpt-5.6-luna`; the owner also funded the API
account with $50 in credits. The
`edison-api-production` service-account key was transferred privately into the
API Production `OPENAI_API_KEY` without printing, storing, or reading either
secret. The key is now saved as Restricted: a fresh readback shows Responses
(`/v1/responses`) Write and every other permission leaf None. No key approval
remains pending. The key has returned one successful generation response with
priced usage; provider-dashboard reconciliation is not yet complete. The original
default-project key remains unread and unrevoked. Vercel
CLI 59.11.7 was installed only through an ephemeral `pnpm dlx`; login could not
be completed and the pending login was canceled, so no authenticated CLI
session exists.

The hosted invitation template is saved and fresh-reload verified with exactly
one Dashboard-compatible `.SiteURL` `/auth/confirm` token-hash link. The
matching repository fix and release-boundary regression are included in pushed
checkpoint `d463d44`. The single owner invitation was sent at
`2026-09-05 19:15:11.951927+00`; Resend message
`4fecf81e-099f-4144-acf6-4f26bf85ef51` reports Delivered with subject
“Your Edison Reader invitation.” No email body or callback token was read.
Owner redemption now passes: `email_confirmed_at` is
`2026-09-05 19:23:00.363055+00`, and `last_sign_in_at` is
`2026-09-05 19:23:00.372394+00`. At 19:23:02Z, authenticated `/v1/me`,
`/v1/feed`, `/v1/editorial-direction`, and the initial profile PATCH returned
200. Read-only metadata confirms active membership, completed onboarding, and
timezone `America/New_York`. Email asset rendering and the full rendered reading
journey remain unverified; no additional invitation is needed. Editorial accepted unpublished
starter candidate v2 with exact SHA-256
`aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50`
in an isolated worktree.

At 19:33:45.426Z, one click on the existing Vercel daily-edition **Run** control
returned 200. A read-only precheck found only the approved owner eligible. It
created three real `initial-edition` jobs; all failed by 19:33:57Z without an
article, feed item, provider response ID, or usage-ledger row. Workflow exposed
HTTP 400: the article schema's source URL had unsupported `format: uri`.
Each generation step made four attempts within one workflow/job attempt. The
compatibility fix keeps canonical URL/citation validation and bumps the
request version to 2. Independent review and all 183 tests pass.

Fixed Production API deployment `dpl_12vWp1rShga96hTQ1yJzu8VTiRYh` of
`4f774eb` was Ready at 19:47:17Z; health was 200/all `ok` at 19:47:37Z.
One scheduler retry at 19:48:11Z created a single fresh slot-1 job under the
unchanged quota. It succeeded at 19:48:41.516Z and published one owner article.
The completed Workflow is `wrun_01M1SHTG1K70NG2D4NE3PC4QNS`. Its priced
ledger records `gpt-5.6-terra`, 14,045 input tokens, 0 cached input, 2,047
output tokens, one web-search call, and $0.062654 estimated cost. The provider
dashboard still showed no data at the first follow-up; billing reconciliation
remains pending. All four daily job slots are consumed, with failed history
preserved. Do not reset quotas. This is one real article, not a complete edition.
Chief of Staff's independent editorial verdict is **withhold** pending bounded
headline/source-date corrections and recheck; no
private output was checked into Git or silently changed in production.

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

## Current apex phase: isolated sample-data demo

The apex website has not been converted: `edisonreader.com` remains a
sample-data demo with **no live-service credentials**. The separate live web
project now serves `d463d44` at its temporary Vercel URL. The `df3e712` API
deployment is healthy; its owner invitation has been delivered and awaits
redemption. The demo's isolation remains intentional.

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

Local Supabase/Docker and database tests were not blockers for this sample-data
web deployment. The production database requirements have since passed in CI
and the hosted migration audit. No staging environment is needed for the demo.

## Production private-alpha release (partially deployed)

The production client/server implementation is now live in the separate web
project and its schema is live in Supabase. Finishing the owner-only alpha is
an API credential/deployment and acceptance-test sequence, not an architecture
rewrite. Keep the apex demo isolated and previews credential-free in explicit
demo mode.

The live alpha uses one production Supabase project and two Vercel projects.
There is no paid staging environment initially. Local Supabase is the database
test environment, and Vercel previews are build/UI checks. Never point a
preview deployment at the production database.

### Completed prerequisites and current gates

Vercel Pro, Supabase Pro, Git connections, hosted Auth/SMTP, the production
schema, temporary web deployment, public connection metadata, owner-only
allowlists, cron secret, dedicated OpenAI project/model access, and its $50 cap
are in place. Current gates are:

1. The owner redeems the single delivered invitation. Database, Auth readiness,
   and negative auth/CORS/cron checks are complete; no database edit is pending.
2. Verify the Auth callback, active membership, `/v1/me`, and timezone capture.
3. Run the first bounded provider request through that authenticated owner,
   then finish reader, Workflow, cost-ledger, email rendering, and responsive
   browser acceptance. No provider smoke exists without an authenticated owner
   or the valid cron secret; never retrieve a secret or bypass that boundary.
4. Publish only the accepted starter v2 artifact with SHA-256
   `aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50`;
   it remains an unpublished draft in an isolated worktree.
5. Merge the reviewed candidate and protect `main` after acceptance. Domain
   attachment remains a separate owner decision.

Enter every credential directly in the relevant dashboard or local
`.env.local`; do not paste credentials into chat, commits, tickets, or docs.

### Supabase setup

The candidate and production project both use PostgreSQL 17. CLI linking,
disposable database tests, the linked dry run, and all 13 production migrations
are complete. The read-only post-migration audit confirms the expected schema,
RLS, and constrained privileges.

1. Do not rerun or edit the applied migration chain for this release; future
   schema changes require a new additive migration.
2. Preserve the recorded migration and post-migration evidence with the release.
3. Rehearse restoration before relying on the database for readers beyond the
   owner-only alpha.
4. Keep global self-service signup and anonymous sign-in disabled; keep the
   email provider enabled so administrator-issued invitations can be redeemed.
5. In Auth > JWT Signing Keys, make an asymmetric key (preferably ES256) the
   active signing key. The API intentionally verifies user tokens through the
   project's public JWKS endpoint rather than sharing a JWT secret.
6. Keep the temporary Production Site URL and its two exact Auth redirects until
   the coordinated custom-domain cutover.
7. Keep the verified invite subject and Dashboard-compatible hosted CTA
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite` saved.
   Its matching repository correction and focused release-boundary test are in
   pushed checkpoint `d463d44` and its green CI run.
8. Custom SMTP delivered the single authorized owner invitation; verify its
   rendering and callback when the owner redeems it. Do not send another by
   default.
9. Use **Direct → Transaction pooler → Use IPv4 connection** in Connect to
   obtain the Shared Pooler URI. Copy it in full; both hostname and username
   differ from the Dedicated endpoint. The production client enforces TLS even
   without a query suffix. Keep direct access for migration/backup tooling.

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
  - `DATABASE_URL` — owner-saved Production Secret; the actual Shared
    Transaction pooler URI is now connected and healthy. The shared runtime /
    preflight policy enforces explicit TLS, defaults a missing query option to
    `require`, preserves stronger verification, and rejects insecure or
    ambiguous controls. The secret remains unread.
  - `SUPABASE_URL=https://bcxxnntastmnormcmxbq.supabase.co`
  - `SUPABASE_PUBLISHABLE_KEY` matching that project; do not copy it into docs
  - `SUPABASE_JWT_AUDIENCE=authenticated`
  - `OPENAI_API_KEY` — privately transferred service-account key for project
    `proj_EFKsL4Yfs6pDFOzI4aGWThSf`; saved Restricted to Responses Write only,
    value unread, and provider access untested
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

Production deployment `dpl_GVJFA1vDQks3eBya4ArrXGpCHzFU` of `df3e712` was
Ready at 15:11:12 EDT. Health at 19:11:46Z returned `200` with configuration,
Postgres, and Supabase Auth all `ok`; negative access-control checks also pass.

`OPENAI_WEB_SEARCH_COST_MICROUSD` is an accounting estimate, not a billing
control. Recheck it against OpenAI's current tool pricing before launch and
reconcile Edison's usage ledger against the provider dashboard. If the provider
returns an unexpected model identity, Edison records its tokens and response ID
as explicitly `unpriced` with a `NULL` cost and stops that operation. Treat the
aggregate estimate as unknown and reconcile manually; never convert that
missing price to a zero-cost call.

### Live private launch sequence

1. Keep the healthy API and live web at their temporary URLs, with the apex
   demo isolated. Preserve the recorded passing readiness/public-role and
   negative auth/CORS/cron evidence for `df3e712`.
2. The single authorized invitation is already delivered. Have the owner redeem
   its corrected `.SiteURL` callback; do not retrieve its token or send a
   duplicate invitation by default.
3. With the freshly issued owner session, confirm `/v1/me` succeeds and the
   browser persists its timezone. This checks the real JWKS/active-member path.
4. Run one bounded provider test through the owner using the already-Restricted
   Responses-only service-account key and dedicated project.
5. Verify the invite rendering and callback, including its logo asset. Delivery
   metadata alone does not prove the owner's complete email/sign-in experience.
6. Generate an article, verify citations, save it, share it, and inspect the
   generation job in `/admin/jobs`.
7. Verify the daily scheduler plus generation-job and feed-command reconciler
   logs once.
8. Add Vercel Firewall rate limits around generation, article Q&A, and feed
   command POST routes. Retain the enforced $50 OpenAI project cap and inspect
   actual provider usage alongside Edison's ledger.
9. Complete a database backup/restore rehearsal.
10. Merge the reviewed candidate and protect `main` after the temporary alpha
   passes acceptance.
11. Attach `app.edisonreader.com` and `api.edisonreader.com` only after explicit
   owner approval, then update Auth URLs, CORS, and the web/API origins together.

## When to add staging

Add a separate Supabase staging project (or short-lived database branches) when
there are multiple regular developers, schema migrations are frequent, hosted
integration tests become part of CI, or production has enough active readers
that testing a migration there is no longer an acceptable risk. Until then, a
second always-on stack adds cost and configuration drift without much benefit.
