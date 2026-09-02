# Edison Reader — Codex Handoff

## Mission

Build a real, responsive web MVP for **Edison Reader** at `edisonreader.com`.

> A publication written entirely for you, every day.

Edison should learn what each reader finds valuable and produce a daily reading experience combining continuous learning, personalized news, biographies, history, and intellectual exploration. The MVP is pure AI-generated editorial content, grounded in current sources where appropriate.

This project is independent. It is not affiliated with Perch.

## Current status

- A new OpenAI Sites/Vinext project has been scaffolded.
- Dependencies have been installed successfully with `npm run install:ci`.
- The Site is registered as **Edison Reader**.
- `.openai/hosting.json` contains the existing Site identity and declares a D1 database binding named `DB`.
- No product UI, database schema, AI routes, tests, production version, or deployment has been completed yet.
- No paid infrastructure has been activated.
- `OPENAI_API_KEY` is not configured. Never commit it. Use `.env.local` locally and a secret environment variable in production.

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

The product should feel like a modern, personal magazine rather than an AI chatbot.

- Warm paper background: `#F4EFE5`
- Editorial surface: `#FFFDF7`
- Ink: `#17232C`
- Deep blue: `#183746`
- Muted text: `#68726E`
- Edison gold: `#EFBD4E`
- Rust accent: `#CA6544`
- Soft mint: `#E4EADC`
- Headings/body editorial serif: Newsreader or a locally available equivalent
- UI sans: DM Sans or a locally available equivalent
- Rounded but restrained cards; subtle borders; no generic dashboard aesthetic
- The lightbulb is the core brand mark. Keep it simple enough to become the app icon later.
- Mobile-first, excellent on tablet, and centered editorial layout on desktop.

## Required working MVP

1. Identity-aware private alpha using the platform-provided authenticated-user headers.
2. D1-backed durable state for profiles, preferences, articles, feed items, reading events, saves, commands, and article conversations.
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

Use ownership checks on every user-specific server route. Keep D1 access behind a small server helper and use prepared statements. Generate and inspect Drizzle migrations; do not create schema dynamically at runtime.

## AI behavior

- Use the Responses API server-side only.
- For current events, use web search and preserve source URLs returned by the model/tooling.
- Require structured JSON output matching a validated schema for generated articles and preference updates.
- Prefer asynchronous or queued generation. The feed itself should normally be a fast database read, not a blocking model call.
- Precompute each article’s three-bullet summary.
- Store user commands and behavioral signals so personalization is explainable and reversible.
- Start with a cost-conscious model. Make the model name configurable through `OPENAI_MODEL`.
- Add sensible per-user generation limits and record approximate usage/cost metadata.

## Quality bar

- This must be a functioning product, not a landing page or static mock.
- Every visible control should work or be intentionally disabled with an honest explanation.
- Include loading, empty, offline/error, and AI-not-configured states.
- Meet basic keyboard, focus, contrast, and reduced-motion accessibility requirements.
- Build successfully, run automated tests, and inspect the generated D1 migration before deployment.
- Keep the initial deployment private. Do not attach `edisonreader.com` or make the Site public without the owner’s explicit approval.

## First prompt to give Codex

> Continue building Edison Reader from this repository. Read `CODEX_HANDOFF.md` completely, then inspect the existing Vinext starter and `.openai/hosting.json`. Create a short implementation plan and build the complete working private-alpha MVP described in the handoff. Preserve the registered Site identity and D1 binding. Use the Sites building and hosting workflows, validate the build and migrations, and deploy only after the application is complete. Before implementing the OpenAI-backed routes, help me configure `OPENAI_API_KEY` securely without placing it in source control or chat.

