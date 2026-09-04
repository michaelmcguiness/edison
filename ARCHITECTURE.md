# Edison Reader architecture

Edison is a client/server application built as an API-first modular monolith.
The web application and future native clients share one versioned HTTP API and
one canonical Postgres database. This is deliberately simpler than
microservices while preserving the boundary a mobile app needs.

## Deployable surfaces

| Surface | Recommended host | Responsibility |
| --- | --- | --- |
| Existing demo/landing | `edisonreader.com` | Credential-free sample UI |
| Live web | `app.edisonreader.com` | Next.js UI and Supabase Auth session |
| Live API | `api.edisonreader.com/v1` | Authorization, business rules, Postgres, OpenAI, Workflow, cron |
| Supabase | Provider URL | Auth, canonical Postgres, reserved Storage |

The root web and `apps/api` are independent Vercel projects built from the same
repository. Shared contracts and business code live under `packages/`. A later
iOS or Android client needs only the Supabase publishable configuration and the
Edison API base URL; it does not need web-specific server code.

## Trust boundaries

1. Web and native clients authenticate with Supabase and send the resulting
   access token as `Authorization: Bearer <token>` to Edison.
2. The API verifies the signature, issuer, audience, authenticated/non-anonymous
   role, and fail-closed private-alpha email allowlist.
3. Each user-scoped database transaction installs only the verified claims and
   switches to the fixed non-login `edison_api` role.
4. Postgres RLS is enabled and checks ownership when the transaction switches
   to the non-owner `edison_api` role. The migrations do not depend on `FORCE
   ROW LEVEL SECURITY`; Supabase browser/mobile roles also have no direct grants
   on Edison core tables, so a client cannot bypass API policy.
5. `DATABASE_URL`, OpenAI keys, cron secrets, and Supabase administrative keys
   exist only in the API/operator environments.

The anonymous application surface is deliberately narrow. `edison_public` can
read immutable published or archived public-starter snapshots. Legacy article
share links execute one locked `SECURITY DEFINER` function in a dedicated
schema; the role has no direct access to shares or memberships, and the function
returns only a sanitized snapshot when both the share and its owner are active.
It cannot read private articles, owners, personalization explanations, reader
preferences, conversations, saves, or jobs. Current-edition listing selects
only the published edition; archived snapshots remain readable by stable public
article links.

## Publication model

News is a finite daily edition. Each reader has a durable News direction state
containing a server-issued edition UUID, local calendar date, and monotonically
increasing revision. Feed items carry that exact edition identity and the API
returns a bounded response with no pagination cursor.

Directions are section-specific and either:

- persistent, applying to the current and later editions; or
- edition-only, bound to one exact server-issued edition UUID.

Create, edit, remove, and Undo use expected revisions and durable idempotency
keys. A stale client receives a conflict instead of overwriting newer state.
Direction mutations persist editorial intent but do not falsely claim that a
piece was created. One-off News commissioning uses a separate generation-job
contract.

Books and Podcasts share the direction model, navigation, and draft continuity,
but do not yet have production content services. Their UI stays explicit about
that boundary.

## Daily edition lifecycle

The hourly scheduler scans onboarded readers whose configured local publication
hour has arrived. In one locked transition it creates or rotates the News
edition identity for that reader/date, advances the direction revision, and
creates deterministic generation slots. A timezone captured on first signed-in
use activates scheduling without a blocking onboarding gate.

Each scheduled item receives a rank derived from its edition slot. One-off
commissioned pieces append without displacing the lead. The feed endpoint reads
only published items whose edition ID and date exactly match the current News
state.

The browser runtime parses this edition envelope and cross-checks it against
the direction snapshot before allowing an edition-only write. A mismatch fails
closed and falls back to the public starter rather than binding an instruction
to the wrong edition.

## Durable AI work

1. The API commits an idempotent domain row before dispatch.
2. Vercel Workflow receives identifiers, not article bodies or secrets.
3. A bounded database lease establishes one current worker owner.
4. The exact provider request is durably snapshotted before the call. Ambiguous
   transport retries reuse that invariant request and provider idempotency key.
5. Every observed provider response is accounted for, including rejected
   structured output and stale-direction output.
6. Domain persistence and reservation/job completion are committed atomically.
7. A reconciler safely resumes abandoned queued or retryable work.

Article generation captures the active persistent plus current-edition News
directions and the originating revision. It rechecks edition UUID/date/revision
before publication. Output for stale direction is accounted for but never
published into the new edition.

Article Q&A and the legacy feed-command parser use rolling per-reader quotas,
request fingerprints, bounded leases/attempts, and the same invariant request
snapshot rule. OpenAI calls are server-side, use structured output and bounded
tool/token settings, and set `store: false`. A provider response from an
unpriced model is retained with its tokens and response ID, a `NULL` cost and
explicit `unpriced` status; it stops the logical operation and makes the total
estimate unknown instead of being counted as free.

## Guest and account continuity

Before sign-in, editorial drafts and directions can be stored on the device.
After authentication, Edison explicitly offers an additive import:

- matching account instructions are deduplicated;
- new instructions use account revision checks and stable request IDs;
- edition-only guest instructions target the account’s current matching
  edition only after the user accepts the disclosed mapping;
- a guest draft is copied only when the corresponding account draft is empty;
- conflicting drafts remain untouched; and
- no generation job starts as a side effect.

Guest data remains on the device until the user removes it, so an interrupted
import is recoverable.

## Environments and release isolation

The existing Vercel Hobby project stays in explicit `EDISON_DEMO_MODE=true`
with no live credentials. It can remain the apex demo or later become a landing
page.

The initial private alpha has no paid staging stack:

- local Supabase validates schema, RLS, and migrations;
- credential-free Vercel previews validate builds and the sample UI; and
- one backed-up Supabase production project stores real reader data.

Production credentials never enter previews or the demo. The live web receives
only publishable Supabase values and the API URL. The live API receives the
pooled database connection and server-only credentials. Migrations use a direct
operator connection and the Supabase CLI after a reviewed dry run; runtime code
never creates or pushes schema.

See [docs/PRODUCTION_RELEASE.md](./docs/PRODUCTION_RELEASE.md) for release gates,
backup/rollback, monitoring, and the exact provider setup.
