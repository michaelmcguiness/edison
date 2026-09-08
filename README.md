# Edison Reader

Edison Reader is an AI-written personal publication: a finite daily News
edition shaped by explicit reader direction, with Books and Podcasts reserved
as first-class sections for later production services.

The repository now contains the production private-alpha application. The
hosted site at [edisonreader.com](https://edisonreader.com/) is still the
credential-free sample demo until a separate production release is approved
and configured. Building the production version does not by itself authorize a
plan purchase, migration, deployment, domain change, invitation, or secret
entry.

## Product today

- A responsive publication shell with News, Books, and Podcasts in a desktop
  sidebar and mobile bottom navigation.
- A finite daily News edition with explicit edition identity, deterministic
  ordering, a clear end, full article reading, citations, saves, feedback,
  completion, sharing, and article Q&A.
- “Ask Edison” direction immediately below the folio. Instructions can persist
  or target one exact edition; create, edit, remove, and Undo use revision-safe
  compare-and-swap semantics.
- One-off News commissioning is separate from editorial direction, so “write
  one article” never silently changes future editions.
- Useful public reading before sign-in through immutable, sanitized starter
  editions, plus a distinct public-starter mode when a signed-in reader opens
  that content. No private article or preference data enters that surface.
- Device-local guest drafts and directions with an explicit, additive import
  after sign-in. Account content is never overwritten and importing does not
  start generation jobs.
- Honest Books and Podcasts empty states. Their durable direction can be saved,
  but catalog, generation, reader, playback, and storage services are not yet
  connected and the UI does not fabricate them.

The approved visual system is documented in
[docs/brand/WHITE_EDITION_HANDOFF.md](./docs/brand/WHITE_EDITION_HANDOFF.md),
[docs/brand/PERSONAL_PUBLICATION_HANDOFF.md](./docs/brand/PERSONAL_PUBLICATION_HANDOFF.md),
and [docs/brand/SIDEBAR_CHAT_HANDOFF.md](./docs/brand/SIDEBAR_CHAT_HANDOFF.md).
The latter two supersede the old infinite-feed/category-tab navigation.

## Architecture

Edison is a client/server application and an API-first modular monolith. The
same versioned API is intended for the web client and future iOS and Android
apps.

| Layer | Production service | Repository location |
| --- | --- | --- |
| Web client | Next.js on Vercel | repository root |
| REST API | independent Next.js project on Vercel | `apps/api` |
| Database, Auth, Storage | Supabase Postgres/Auth/Storage | `supabase` |
| Durable AI jobs | Vercel Workflow | `apps/api/workflows` |
| Research and writing | OpenAI Responses API | `packages/ai` |

Clients use Supabase only for authentication, then send a bearer token to the
Edison API. The API verifies the token and private-alpha access, installs the
verified identity into each database transaction, and switches to a non-login
`edison_api` role protected by RLS. Browser/mobile Supabase roles have no grants
on Edison’s core tables. Database, OpenAI, cron, and Supabase administrative
credentials never ship to a client.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the trust boundaries and job
lifecycle.

## Deployment topology

Keep the existing apex demo isolated while the private alpha is proven:

- `edisonreader.com`: existing credential-free demo/landing project
- `app.edisonreader.com`: live web project (`edison-app`)
- `api.edisonreader.com`: live API/workflow project (`edison-api`)
- one production Supabase project in the same general region as the API

There is intentionally no paid staging environment at first. Use local
Supabase for schema/RLS testing, credential-free Vercel previews for builds and
UI, and one backed-up production Supabase project for invited readers. Do not
give preview deployments production credentials.

The full release sequence and exact owner actions are in
[docs/PRODUCTION_RELEASE.md](./docs/PRODUCTION_RELEASE.md). The shorter deployment
overview is [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Local development

Requirements:

- Node.js 22.x
- pnpm 10.28.0, pinned by this repository
- Docker Desktop for the full local Supabase stack

Install and run the sample UI:

```bash
pnpm install --frozen-lockfile
EDISON_DEMO_MODE=true pnpm dev:web
```

For the complete local stack:

1. Copy `.env.example` to an uncommitted `.env.local` and set
   `EDISON_DEMO_MODE=false`.
2. Start and reset local Supabase, then run its database tests.
3. Add the local publishable values printed by Supabase to `.env.local`.
4. Start web and API in separate terminals.

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm exec supabase test db
pnpm dev:web
pnpm dev:api
```

The web app uses port 3000 and the API uses port 3001. Hosted private-alpha
readers are invitation-only. The local invitation helper requires a short-lived
operator environment containing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`WEB_APP_URL`:

```bash
pnpm invite reader@example.com
```

Never paste a secret in source control, an issue, or chat.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:all
```

`pnpm test` runs both web tests and API service tests. Database changes are
applied only through the Supabase CLI. Never use `drizzle-kit push` against
production:

```bash
pnpm db:generate
pnpm supabase:reset
pnpm exec supabase test db
pnpm exec supabase db push --linked --dry-run
```

The real migration push requires a clean disposable/local test run, a reviewed
dry run, a backup checkpoint, and explicit approval.

## Production prerequisites

The private alpha will need:

- Vercel Pro for the API workflows and schedules.
- Supabase Pro before real reader data is stored, for dependable availability
  and backups.
- An Edison-specific OpenAI API project/service-account key and API billing.
  A personal ChatGPT subscription is unrelated and is not used.
- Custom SMTP for external invitations.
- A small fail-closed reader allowlist and an admin allowlist backed by current
  active membership.
- Exact production CORS/Auth origins, WAF rules on costly writes, provider
  budgets/alerts, error monitoring, and a tested backup/restore path.

The existing Hobby demo needs none of those credentials. Keep
`EDISON_DEMO_MODE=true` there and never copy production secrets into it.

## Current release boundary

Code can be completed and validated without secrets. The remaining release
work includes running all migrations and pgTAP tests against real Postgres,
publishing a genuine reviewed starter edition, creating provider projects,
entering credentials directly in their dashboards, deploying to temporary
production URLs, and running the private-alpha smoke test.

No migration, external resource, plan purchase, deployment, DNS change, or
reader invitation should happen merely because it is described in this
repository.
