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

## Hosted state versus working-tree state

- [edisonreader.com](https://edisonreader.com/) and its `www` redirect still
  serve the credential-free sample demo from the existing Vercel Hobby project.
- The demo is explicit `EDISON_DEMO_MODE=true`; it has no production Supabase,
  API, OpenAI, SMTP, or cron credentials. It must stay isolated while the alpha
  is proven.
- The public GitHub source is
  [michaelmcguiness/edison](https://github.com/michaelmcguiness/edison). The
  candidate is pushed on `codex/production-release-candidate` in
  [draft PR #1](https://github.com/michaelmcguiness/edison/pull/1). Inspect Git
  for the latest revision; do not merge or promote it without approval.
- Separate `edison-app` and `edison-api` Vercel project shells now exist with
  the intended Next.js/Node 22/build settings, but no Git links, deployments,
  credentials, or domains. See `docs/DEPLOYMENT.md` for IDs and setup status.
- Supabase project creation remains blocked at sign-in. Automatic approval
  review requires explicit authorization for Supabase GitHub authentication
  and for Vercel's repository-connection flow. Do not retry these blocked
  controls without the owner signing in or approving the specific action.
- The working tree contains the production private-alpha implementation. It has
  not been migrated, seeded, deployed, or exercised against a hosted database.
- Local pgTAP/migration execution is still required. This machine did not have
  a usable Docker/Postgres runtime during the implementation pass.

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
- Broad-launch edge policy, monitoring vendor, SMTP provider, privacy/support
  copy, and on-call owner are operational choices, not repository defaults.
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
3. Upgrade Vercel/Supabase only when ready to release. Create an Edison-specific
   OpenAI API project/service account; ChatGPT subscriptions are unrelated.
4. Configure custom SMTP, asymmetric Supabase JWT signing, exact Auth redirects,
   disabled self-signup, required reader/admin allowlists, exact CORS, WAF rules,
   spend caps/alerts, external error monitoring, and backups/restore drill.
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
> and guest-reconciliation behavior. Run the full code/build/browser checks and
> run migrations/RLS tests once a disposable Postgres/Supabase runtime is
> available. Work autonomously without secrets, but do not purchase, migrate,
> push, deploy, attach domains, alter hosted services, or invite readers without
> explicit approval for that exact external action. Never request secrets in
> source control or chat.
