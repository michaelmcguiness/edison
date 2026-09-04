# Edison Reader architecture

Edison is an API-first modular monolith. The web application and future native
clients will share one versioned HTTP API and one canonical Postgres database
when the live stack is activated.

## Current deployment scope: personal demo

The owner currently wants a personal, non-commercial sample-data demo on
Vercel Hobby, not the live service. Deploy only the repository-root web project
with `EDISON_DEMO_MODE=true` in both Production and Preview. This explicit
server-only flag enables the sample UI even in a production build. Without it,
unconfigured production remains on its setup screen and configured live mode
still requires authentication.

The demo has no deployed API, database, Auth, AI, email service, or scheduled
jobs. Interactions change in-memory UI state only and reset on reload; it does
not provide real personalization, accounts, or public share links. No live
credentials belong in this deployment. The `apps/api` cron configuration is
retained for later and must not be copied into the root web project.

This is a deployment scope reduction, not a change to the API-first product
architecture. [Hobby's personal/non-commercial restriction](https://vercel.com/docs/plans/hobby)
still applies; the label “demo” is not a commercial-use exemption.

## Later live deployments

- The repository root is the Next.js web application, deployed to Vercel as
  `app.edisonreader.com`.
- `apps/api` is a separate Next.js API deployment at
  `api.edisonreader.com/v1`.
- Supabase Pro provides Postgres, Auth, Storage, and optional Realtime updates.
- Vercel Workflows performs durable article generation and feed-command parsing.
- OpenAI is called only by the API/workflow deployment.

The two Vercel projects share the packages under `packages/`, but can be
released independently. Business rules remain in framework-independent modules
so the API can move to a dedicated worker service later without changing the
mobile contract.

## Live trust boundaries

- Web and native clients authenticate with Supabase and send an access token as
  `Authorization: Bearer <token>` to the Edison API.
- The API verifies the token, scopes every user query by the verified subject,
  and enforces the private-alpha allowlist.
- User-scoped API transactions install those verified claims and switch to the
  non-login `edison_api` database role. Its grants and RLS policies are separate
  from Supabase's public `authenticated` role. It receives only the Auth schema
  and `auth.uid()` access needed to evaluate those ownership policies.
- Core tables are not a public client-side database. Direct Supabase access is
  limited to authentication. The reserved storage bucket has no client access
  until Edison adds an active-member, server-signed upload flow.
- `OPENAI_API_KEY`, database credentials, and Supabase service credentials are
  server-only environment values.
- Public article shares use sanitized snapshots. They never expose the private
  personalization explanation or user preference data.

## Live background generation

1. An authenticated API request inserts a `generation_jobs` row under a unique
   idempotency key and returns `202 Accepted`.
2. A Vercel Workflow receives only that job ID. Research, drafting, validation,
   and publishing are separate retryable steps.
3. Large artifacts live in Postgres; Workflow state contains IDs only.
4. The database job row is authoritative and outlives Workflow telemetry.
5. A scheduled, idempotent reconciler restarts stale queued jobs.
6. An hourly scheduler creates each onboarded reader's edition after the chosen
   local hour, using one durable key per date and editorial slot.

The feed endpoint only returns persisted, completed articles. It never waits for
model generation.

Feed commands use the same durable handoff pattern: the API first commits the
idempotent command row, then a leased dispatcher starts its workflow. A cron
reconciler replays queued rows after interrupted requests, and each workflow
must atomically claim its run ID before calling OpenAI so concurrent dispatches
cannot duplicate model work.

## Environments

The current demo needs no staging or Supabase environment: local development
and credential-free Vercel previews exercise the same sample UI. Explicit
approval is still required before deploying or attaching a domain.

For the later private alpha, there is intentionally no paid staging stack
initially:

- Local Supabase and automated tests validate schema, RLS, and API behavior.
- Vercel preview deployments validate the web and API build with isolated
  Workflow state.
- A single Supabase production project stores real user data.

Preview deployments must not receive production database secrets. When a test
requires hosted persistence, use a short-lived Supabase branch or local tunnel
rather than testing destructive migrations against production.
