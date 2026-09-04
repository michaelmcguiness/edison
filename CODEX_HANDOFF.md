# Edison Reader — Codex Handoff

## Mission

Build a real, responsive web MVP for **Edison Reader** at `edisonreader.com`.

> A publication written entirely for you, every day.

Edison should learn what each reader finds valuable and produce a daily reading experience combining continuous learning, personalized news, biographies, history, and intellectual exploration. The MVP is pure AI-generated editorial content, grounded in current sources where appropriate.

This project is independent. It is not affiliated with Perch.

## Current status

- Latest owner decision: keep Edison a personal, non-commercial sample-data
  demo on Vercel Hobby. Do not activate paid services or the live stack now.
- The hosted demo uses only the root web project, with server-only
  `EDISON_DEMO_MODE=true` in both Vercel Production and Preview. It needs no
  Supabase, OpenAI, SMTP, API deployment, or cron configuration.
- Set build-only `ENABLE_EXPERIMENTAL_COREPACK=1` in Production and Preview
  as well, so Vercel honors the pinned pnpm 10.28.0 rather than selecting an
  older version for the custom install command.
- Demo interactions are in-memory UI exploration and reset on reload; no real
  authentication, AI generation, persisted personalization, or public article
  share links are available. Do not present sample data as a connected product.
- The editorial web experience is implemented in canonical Next.js and has a
  working sample-data mode plus honest production setup states.
- The live client is wired to a versioned REST API for onboarding, feeds,
  articles, saves, events/streaks, feedback, commands, Q&A, library, settings,
  sanitized public shares, generation jobs, and admin diagnostics.
- Supabase migrations define Postgres tables, triggers, grants, RLS policies,
  invite-only Auth behavior, private job/cost tables, storage policies, and pgTAP
  assertions.
- AI article research/writing and preference interpretation use validated
  structured outputs. Durable Vercel Workflows own generation, with idempotency,
  retry leases, reconciliation of interrupted generation and feed-command
  dispatches, and usage accounting.
- Profile controls now directly manage article length, ordered category
  visibility, and explicit active/muted interests.
- The demo web production build, TypeScript, ESLint, and all 30 automated
  tests pass. Local production-server checks confirm the sample home page,
  disconnected live routes, and fail-closed setup state when demo is disabled.
  Those local checks used the installed Node 24 runtime. The first hosted
  deployment also passed its clean pnpm 10.28.0 install and Next 16.3.4 Webpack
  production build; Vercel confirms the runtime and saved project setting are
  Node.js 22.x. The Workflow-enabled API production build passed in the prior
  live-stack work. Database tests remain
  pending until Docker or a disposable hosted Supabase test project is available;
  they are not required to deploy this disconnected sample-data demo.
- The owner has authorized importing the repository into the Vercel Hobby
  project [`edison`](https://vercel.com/mike-michaelmcguis-projects/edison) and
  deploying the disconnected root demo. The initial deployment of commit
  `4855596` is Ready and was verified on September 4, 2026 at
  [edison-lake-phi.vercel.app](https://edison-lake-phi.vercel.app/).
- All 12 unauthenticated production smoke checks passed: home and three assets
  return 200; login, admin, callback, and confirmation redirect home with 307;
  signout POST redirects home with 303; share, API, and cron paths return 404.
  Desktop (1440px) and mobile (390px) UI checks found no horizontal overflow or
  browser errors. Onboarding, reading, summary-to-full-story navigation,
  saves/library, profile, and resetting session changes on reload were verified.
- Standard Vercel Authentication remains enabled: the stable production URL is
  publicly accessible, while the unique deployment URL redirects to Vercel
  sign-in. Production and Preview variables are configured; a separate Preview
  deployment has not been tested. No live backend, paid infrastructure, or
  custom domain was activated, and this step does not authorize those changes
  or a broader public launch.
- The owner created `michaelmcguiness/edison` on GitHub and approved publishing
  the reviewed code there, including public visibility. The canonical source
  URL is `https://github.com/michaelmcguiness/edison`. Check Git status and
  remote refs for the current commit/push state. Source publication and the
  approved root demo deployment do not activate the live backend or a custom
  domain; those remain separate release steps.
- `OPENAI_API_KEY` is not configured or needed for the demo. Never commit it or
  paste it into chat; add it directly to the API Vercel project only when the
  later live stack is approved.

## Architecture decision (supersedes the original starter instructions)

The API-first Vercel/Supabase product architecture remains the later live
target, so Edison can support future iOS and Android clients without rewriting
its backend. The owner has deferred paid services and live deployment in favor
of the Hobby demo described above. The former OpenAI
Sites/Vinext/D1 requirements are retired. The registered Sites identity is
archived under `docs/legacy`, but `.openai/hosting.json` is intentionally absent
so it cannot select the wrong runtime.

- Now: repository-root Next.js sample-data web client on Vercel Hobby
- Later: `apps/api` independent Next.js REST API on Vercel Pro
- Later: Supabase Postgres, Auth, Storage, with Pro backups for the live alpha
- Later: Vercel Workflow durable background generation
- Later: OpenAI Responses API server-side research, writing, and command parsing

The demo must set `EDISON_DEMO_MODE=true` explicitly for a production build.
Without that flag, an unconfigured production app shows its setup screen and a
configured live app retains its authentication requirement. Use Node.js 22.x,
the pinned pnpm 10.28.0, and `pnpm build:web` from the root. Do not deploy
`apps/api`, copy its `vercel.json` to the root, or remove its backend/workflows
to make the web demo deployable. The root demo has no scheduled jobs.

On Vercel, set `ENABLE_EXPERIMENTAL_COREPACK=1` in Production and Preview to
honor the package-manager pin with `pnpm install --frozen-lockfile`. Without
Corepack, a custom pnpm install command can select an older supported version.
See [Vercel package managers](https://vercel.com/docs/package-managers) and
[Corepack configuration](https://vercel.com/docs/builds/configure-a-build#corepack).

Hobby is restricted to personal, non-commercial use; “demo” alone is not an
exemption. Reassess the plan before commercial use or a product launch. See
[Vercel Hobby](https://vercel.com/docs/plans/hobby) and
[cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

There is no paid staging stack now or initially during private alpha. For the
later live phase, use local Supabase, tests, credential-free Vercel previews,
and one backed-up production Supabase project. Do not attach
`edisonreader.com` until the owner explicitly approves.

## Locked product decisions

### Navigation

- One excellent infinite-scroll home feed; do not split Home and Explore.
- No bottom navigation bar.
- Header contains the Edison wordmark and three compact controls on the right:
  1. Library bookmark
  2. Reading-streak flame with count
  3. User avatar/settings
- Do not add a redundant feed title, date, refresh label, or “written for your interests” copy.

### Categories

Use these exact top tabs:

1. For you
2. Tech & Science
3. Business
4. Arts & Culture
5. Sports
6. Entertainment

Tabs scroll horizontally on small screens. A fixed manage button makes categories easy to show, hide, and reorder.

### Feed

- Editorial rather than TikTok-like: calm, beautiful, dense enough to browse, optimized for choosing something worth reading.
- A prominent lead story followed by a clean stream of secondary stories.
- Useful metadata only: reading time, source count, research recency, the learning thread it extends, or the specific reason it was selected.
- Infinite scroll, but prioritize quality over volume.
- Long-pressing or pressing-and-holding a story opens a bottom sheet containing an X-style three-bullet summary. A normal tap opens the article.

### Floating prompt

- A persistent floating composer sits near the bottom of the feed.
- It accepts natural-language requests such as:
  - “More history and less startup news.”
  - “Teach me synthetic biology from first principles.”
  - “Make today’s feed more surprising.”
- The command must be stored, translated into structured preference changes, and visibly affect future ranking/generation.
- In an article, the same composer becomes article-aware. Suggested prompts include **Go deeper**, **Counterpoint**, and **Historical context**.

### Article reader

- Beautiful long-form typography and generous reading width.
- Show a specific “Why Edison wrote this” explanation.
- Clearly label the article as written by Edison for the reader.
- Display sources and claim-level citations. Source links must be real and clickable.
- Allow save, share, feedback, and article Q&A.
- Mark an article complete near the end of the reading experience and update the daily streak.
- Ask: “Was this worth your time?” with a lightweight yes/no response.

### Library and profile

- Library stores saved stories and ongoing learning threads.
- The user/settings page emphasizes:
  - Current streak and weekly reading activity
  - Topics and learning threads
  - What the feed has learned
  - Direct controls for interests, depth, novelty, article length, and category visibility
- The compact streak remains visible in the home header.

### MVP exclusions

- No audio or text-to-speech.
- No ads or subscriptions yet.
- No token/reward economy yet.
- No native iOS or Android clients yet.
- No complicated collaborative-filtering or custom ML system. Start with explicit preferences, behavioral events, LLM interpretation, and simple ranking.

## Visual direction

The locked identity is the **White Edition** system. Its core rule is a quiet,
black-and-white editorial house with a restrained red signal. It should feel
authoritative, literary, contemporary, and almost invisible once a story
begins.

- `docs/brand/WHITE_EDITION_HANDOFF.md` is the canonical visual specification
  and overrides older brand boards, README files, and exploratory assets.
- Mark: use the promoted v2 monoline globe-and-two-rule mark from
  `public/brand/edison-mark.svg`. Do not restore the retired circle-and-curved-
  socket drawing.
- Wordmark: lowercase `edison` in live Newsreader Roman 700, unpunctuated. It is
  a temporary live-type wordmark, not custom lettering.
- Permanent colors: Paper `#FCFBF8`, White `#FFFFFF`, Ink `#0B0B0B`, Soft Ink
  `#30302E`, Caption `#6D6B67`, Rule `#D9D7D2`, Edison Red `#D12F32`, and Red
  Wash `#F2E5E3`. Red is a signal, never a field color.
- Typography roles: Libre Caslon Display for large headlines, Libre Caslon Text
  for reading, Libre Franklin for interface text, and Newsreader only for the
  live wordmark.
- Favor hairline rules, generous margins, square imagery, flat surfaces, and
  full-color editorial art. Do not use gradients, glass effects, tinted image
  filters, hover scaling, ornamental shadows, or rounded-card layouts.
- Mobile-first, excellent on tablet, and centered editorial layout on desktop.
- The brand line remains **The world, edited for one.**

## Later live MVP requirements

These remain the product target; they are not claims about the current
sample-data demo or authorization to activate the live services now.

1. Identity-aware private alpha using Supabase Auth bearer tokens and active membership checks.
2. Supabase/Postgres durable state with grants and RLS for profiles, preferences, articles, feed items, reading events, saves, commands, and article conversations.
3. First-run onboarding asking what the user wants to understand and preferred article length.
4. A real feed populated from the database.
5. AI article generation using the OpenAI Responses API.
6. Web search for news/current topics and verifiable sources.
7. Structured model output for article fields, summaries, topics, and feed-preference changes.
8. Feed prompting that changes persisted preferences and refreshes recommendations.
9. Article Q&A with stored message history.
10. Long-press summaries, saves, feedback, reading completion, streak calculation, library, profile/settings, and shareable article routes.
11. A small admin/diagnostic surface showing generation failures and recent jobs.
12. Graceful seeded content and a clear setup state if `OPENAI_API_KEY` is missing; never fabricate AI results or fake a connected backend.

## Suggested data model

- `profiles`
- `feed_preferences`
- `user_interests`
- `articles`
- `article_sources`
- `feed_items`
- `reading_events`
- `saved_articles`
- `feed_commands`
- `article_conversations`
- `conversation_messages`
- `generation_jobs`

Use ownership checks on every user-specific server route. Execute user queries in
a transaction that installs verified JWT claims and switches to the fixed
non-login `edison_api` database role so RLS remains effective without granting
Supabase browser/mobile roles direct access to core tables. Runtime transaction
pooler connections use `prepare: false`. Generate and inspect migrations, but
apply them only with Supabase CLI; do not create schema dynamically at runtime or
use `drizzle-kit push` against production.

## Later live AI behavior

- Use the Responses API server-side only.
- For current events, use web search and preserve source URLs returned by the model/tooling.
- Require structured JSON output matching a validated schema for generated articles and preference updates.
- Prefer asynchronous or queued generation. The feed itself should normally be a fast database read, not a blocking model call.
- Precompute each article’s three-bullet summary.
- Store user commands and behavioral signals so personalization is explainable and reversible.
- Start with a cost-conscious model. Make the model name configurable through `OPENAI_MODEL`.
- Add sensible per-user generation limits and record approximate usage/cost metadata.

## Quality bar

- The eventual live MVP must be a functioning product, not a landing page or
  static mock. The current owner-approved demo is an explicitly labeled
  sample-data reading experience, not that live MVP.
- Every visible control should work or be intentionally disabled with an honest explanation.
- Include loading, empty, offline/error, and AI-not-configured states.
- Meet basic keyboard, focus, contrast, and reduced-motion accessibility requirements.
- Build successfully and run automated tests before the demo deployment.
  Inspect/test Supabase migrations before a later live database deployment;
  Docker and database tests are not prerequisites for the sample-data web demo.
- Do not deploy, attach `edisonreader.com`, or make the app public without the
  owner's explicit approval. The current approval covers only the disconnected
  root demo on its temporary Vercel URL; domain attachment, live services, and
  a broader launch remain separate. A Vercel URL is not inherently
  access-controlled; check the chosen protection settings before sharing it.

## First prompt to give Codex

> Continue building Edison Reader from this repository. Read
> `CODEX_HANDOFF.md` completely and inspect the working tree before editing.
> The current target is a personal, non-commercial sample-data web demo on
> Vercel Hobby: root project only, `EDISON_DEMO_MODE=true`, no paid services,
> live credentials, API deployment, or crons. Set build-only
> `ENABLE_EXPERIMENTAL_COREPACK=1` for the pinned pnpm version on Vercel.
> Preserve the Vercel/Supabase
> API-first backend for the later live phase. Validate TypeScript, tests, web
> and API builds, and the demo UI; test migrations/RLS before activating a live
> database. Do as much as possible autonomously, but never request secrets in
> source control or chat and never push, deploy, attach domains, or make the
> app public without the owner's explicit approval. The recorded current
> approval covers GitHub source publication and this root-only Vercel demo
> deployment, not domain attachment or live-service activation.
