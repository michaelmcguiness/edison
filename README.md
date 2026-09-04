# Edison Reader

A private, AI-written daily publication that learns what each reader finds
worthwhile. **The current release target is a personal, non-commercial
sample-data demo on Vercel Hobby**, with no paid services or connected backend.
The repository also contains the API-first product implementation for a later
live release; keeping the demo small does not require rewriting that architecture.

## Current demo

The demo is live at [edison-lake-phi.vercel.app](https://edison-lake-phi.vercel.app/).
The initial deployment of commit `4855596` was verified on September 4, 2026.
The stable production URL is publicly accessible; unique deployment URLs
retain Vercel Authentication. No custom domain or live services are connected.

Deploy only the root Next.js web project with the server-only environment value
`EDISON_DEMO_MODE=true`. Set it in both Vercel **Production** and **Preview**.
Also set the build-only `ENABLE_EXPERIMENTAL_COREPACK=1` in both environments
so Vercel uses the repository's pinned pnpm version.
No Supabase, OpenAI, SMTP, API project, or scheduled jobs are needed. The demo
shows sample stories and lets you explore the reading interface. UI changes
are held in memory and reset on reload; there is no real authentication,
AI generation, persisted personalization, or working public article sharing.

Without the explicit demo flag, an unconfigured production deployment shows
the setup screen, and a configured live deployment still requires authentication.
Do not supply live-service credentials to a demo or preview deployment.

Vercel Hobby is for personal, non-commercial use. Calling a project a “demo”
does not exempt commercial use from that restriction; reassess the plan before
commercial use or a product launch. See [Vercel's Hobby policy](https://vercel.com/docs/plans/hobby).

## Later live architecture

| Layer | Production service | Location |
| --- | --- | --- |
| Web client | Vercel Pro / Next.js | repository root |
| REST API | Vercel Pro / Next.js | `apps/api` |
| Database, auth, storage | Supabase Pro | `supabase` migrations |
| Background jobs | Vercel Workflow | `apps/api/workflows` |
| Research and writing | OpenAI Responses API | `packages/ai` |

The web and future iOS/Android clients authenticate with Supabase and send a
bearer token to `api.edisonreader.com/v1`. The API verifies the token locally,
checks active alpha membership, and executes user queries under the Postgres
non-login `edison_api` role so RLS remains effective. Supabase's browser/mobile
`authenticated` role has no grants on Edison core tables, which prevents clients
from bypassing API rules. OpenAI and database credentials never ship to a client.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for trust boundaries and job behavior.

## Prerequisites

- Node.js 22.x
- pnpm 10.28.0 (pinned by this repository)
- For the later full stack only: Docker Desktop and the Supabase CLI (installed
  as a workspace dev dependency)

## Local development

The web UI has an honest sample-data mode in local development when no live
environment is configured, or when `EDISON_DEMO_MODE=true` is explicitly set.
Run it with:

```bash
pnpm install
pnpm dev
```

For the full stack:

1. Copy `.env.example` to `.env.local`, set `EDISON_DEMO_MODE=false`, and keep it
   uncommitted.
2. Start Docker Desktop.
3. Start and reset the local Supabase project:

   ```bash
   pnpm exec supabase start
   pnpm exec supabase db reset
   pnpm exec supabase test db
   ```

4. Copy the local publishable key printed by `supabase status` into the public
   Supabase variables in `.env.local`.
5. Run the web and API processes in separate terminals:

   ```bash
   pnpm dev:web
   pnpm dev:api
   ```

The API listens on port 3001 and the web client on port 3000. Public sign-up is
disabled. In a hosted project, invite readers from Supabase or run:

```bash
pnpm invite reader@example.com
```

That command requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `WEB_APP_URL`.
Never paste the secret key into source control, an issue, or chat.

For hosted Auth, keep global self-service signup disabled, enable the email
provider for existing/invited users, set the production Site URL and redirect
allowlist, and copy `supabase/templates/invite.html` into the Invite email
template. The template sends invite tokens through `/auth/confirm`, where the
server verifies them and establishes the cookie-backed session.

## Later live OpenAI configuration

Set these server-side on the API Vercel project only:

```text
OPENAI_API_KEY
OPENAI_ARTICLE_MODEL=gpt-5.6-terra
OPENAI_UTILITY_MODEL=gpt-5.6-luna
OPENAI_MAX_DAILY_GENERATIONS=8
```

Without the key, Edison returns a clear setup error and never substitutes fake
AI output. The key is not needed to build or inspect the sample UI.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:all
```

Both deployable applications deliberately build with Next's supported Webpack
path. The workspace also carries a narrow patch for a confirmed Next 16.3.4
metadata AsyncLocalStorage race; `pnpm install --frozen-lockfile` applies it to
both deployments.

Database changes are generated into `supabase/migrations`, but only Supabase CLI
applies them. Do not use `drizzle-kit push` against production:

```bash
pnpm db:generate
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

## Deployment

For the current demo, create **one** Vercel project from the repository:

- Root directory: `.`; framework: Next.js; Node.js: 22.x
- Install: `pnpm install --frozen-lockfile` (pnpm 10.28.0)
- Build: `pnpm build:web`
- Environment: `EDISON_DEMO_MODE=true` and `ENABLE_EXPERIMENTAL_COREPACK=1`
  in Production and Preview; no live keys
- The owner-approved root demo is deployed at
  [edison-lake-phi.vercel.app](https://edison-lake-phi.vercel.app/)

Corepack is required to honor `packageManager: pnpm@10.28.0`. Without it, an
overridden install command can select an older pnpm version. See
[Vercel package managers](https://vercel.com/docs/package-managers) and
[Corepack configuration](https://vercel.com/docs/builds/configure-a-build#corepack).

Do not create an `apps/api` project or copy its cron configuration to the root.
The root web deployment has no crons. The existing API, migrations, and
workflows stay in the repository for the later live release. Its five-minute
and hourly schedules are incompatible with Hobby's once-daily cron limit; see
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

The source repository is
[michaelmcguiness/edison](https://github.com/michaelmcguiness/edison). The owner
has approved publishing the reviewed code there, including public visibility.
The owner has separately authorized importing it into the Vercel Hobby project
[`edison`](https://vercel.com/mike-michaelmcguis-projects/edison) and deploying
the disconnected root demo. The initial deployment is Ready: the hosted clean
install used pnpm 10.28.0, Next 16.3.4 built with Webpack, and the runtime and
saved project setting are Node.js 22.x. Anonymous route checks and desktop/mobile
UI checks passed. Preview environment settings are configured, but a separate
Preview deployment has not been tested. This approval does not authorize the
live backend, paid services, or attaching `edisonreader.com`.

For the **later live release**, create two Vercel projects from that repository:

- Web: project root `.`
- API: project root `apps/api`; enable **Include source files outside of the Root
  Directory** so Vercel receives the workspace lockfile, patches, and shared
  packages

The API project's `vercel.json` reconciles interrupted article-generation and
feed-command dispatches every five minutes and schedules daily editions hourly.
Set `CRON_SECRET` plus the `EDISON_DAILY_EDITION_*` variables shown in
`.env.example`; the scheduler starts after the configured hour in each reader's
own timezone and uses a durable key for every local-date article slot.

Use `iad1` for the API and the Supabase US East region to keep Workflow and
database traffic close. Configure `app.edisonreader.com` and
`api.edisonreader.com` only after the private preview is approved.

There is no paid staging stack for the private alpha. Local Supabase validates
migrations/RLS, Vercel preview builds validate code, and one backed-up Supabase
project holds production data. Preview deployments must not receive the
production database, Supabase secret, OpenAI key, or cron secret.

Before production invitations, configure custom SMTP in Supabase. Its built-in
mailer is not appropriate for external alpha users.

The exact owner actions, environment-variable split, and private launch checks
are in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
