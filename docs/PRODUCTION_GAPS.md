# Edison production-readiness audit

Last updated: September 5, 2026

This file describes the production backend currently implemented in the
working tree and the work that still blocks a real launch. Nothing described
here should be inferred from an earlier audit alone. All 15 migrations and the
separate temporary live web/API projects are now deployed; API readiness,
negative auth/CORS/cron checks, owner invitation redemption, authenticated API
reads, and first-visit timezone activation pass. The apex remains an isolated
demo. The approved Pulse + learning-loops interface and the two accepted public
articles are deployed. See `docs/PULSE_RELEASE_2026-09-05.md` for the latest
candidate, publication, correction and hosted evidence; older setup evidence is
retained in `docs/PRODUCTION_RELEASE.md`.

## Implemented in this slice

### Pulse learning loops and reading continuity

The approved News interface uses the real finite inventory, per-loop reading,
an explicitly targeted Curate dialog, article-scoped Ask, and truthful empty
states. Sleep and History are bound to actual published UUIDs and approved
artwork. Five unwritten concepts remain excluded. Guests can retain loops,
directions and public saves on their device; guest directions do not generate,
adapt or reorder prepared articles. Explicit guest import adds missing account
loops without overwriting conflicts or starting generation.

Authenticated loops have immutable original curiosity, revisioned direction
and undo, active-owner isolation and capacity bounds. Generation request v3
freezes exact loop revision and bounded recent article context; publication
rejects stale context. Per-identity client state is remounted, article journeys
freeze Next destinations and source labels, and per-tab drafts/semantic reading
positions survive reload without putting curiosity text in URLs.

### Audited correction

The first owner article's bounded headline/source-date correction is accepted
by Editorial through Chief of Staff and applied. Its original and corrected
snapshots are retained in a protected private audit, and a narrow active-owner
function exposes only the dated correction note. The application cannot read
the raw audit. The atomic operator rejects original drift, existing shares or
conversations and safely replays. This was a manual editorial correction, not a
new provider generation or acceptance of the automated writer in general.

### Revision-safe editorial direction

Authenticated active-alpha readers have durable section-specific direction for
`news`, `books`, and `podcasts`. The server owns a monotonically increasing
revision and current-edition UUID for every reader and section. Instructions
are either persistent or bound to that exact edition UUID; stale writes and
Undo operations fail with `409` rather than overwriting newer state.

Create, edit, soft delete, and Undo are atomic, idempotent compare-and-swap
transactions with immutable mutation history. The server serializes creates on
the section state row and enforces the same maximum as the local client: 50
non-deleted instructions per reader and section. Listing and generation use a
deterministic, complete bounded set, so newer instructions cannot disappear
behind an arbitrary query limit and prompt size cannot grow without bound.

The authenticated endpoints are:

- `GET /v1/editorial-direction`
- `POST /v1/editorial-direction`
- `PATCH /v1/editorial-direction/:instructionId`
- `DELETE /v1/editorial-direction/:instructionId`
- `POST /v1/editorial-direction/mutations/:mutationId/undo`

Books and Podcasts direction can be stored and reviewed, but remains explicitly
non-operational until those content engines exist. News direction now affects
future News generation as described below.

### Direction-aware News generation

Every News generation job captures the section revision, current-edition UUID
and date, all persistent News instructions, and only the edition instructions
whose UUID matches the current edition. The exact model input—including model,
date, preferences, interests, recent titles, and directions—is written to the
durable job before OpenAI is called. An ambiguous workflow retry therefore
reuses the stored request and provider key even if reader context changed. Only
a strictly newer direction revision starts a new logical request.

The OpenAI SDK performs no hidden retries for this path, the provider call has
a two-minute timeout, and the workflow has a bounded retry count. A returned
but invalid structured/citation response is treated as terminal only after its
observed identity and usage are durable in the ledger. If accounting itself
fails, the same frozen request and provider key remain retryable without
consuming another application attempt. A valid response is rechecked against
the direction revision, edition UUID, and date in
the publication transaction. Stale output records its actual observed usage,
inserts no article or feed item, and retries against the new revision. No
database transaction stays open during an OpenAI call.

Scheduled slots have deterministic feed ranks, so concurrent completion cannot
randomly choose the lead. Commissioned/replenishment News work appends after
the planned slots. A failed daily slot can receive one fresh job/provider
attempt; after the bounded second failure the current edition remains honestly
partial and the failure remains visible to operators instead of retrying
forever.

### Server-owned finite News editions

The scheduler establishes or advances one News edition per reader local date.
Rotation, the first jobs, a new server UUID, and the section revision increment
share one transaction. Repeated scheduler delivery is idempotent. Requests for
an older date never rotate state backwards, and prior edition-only instructions
remain in history but are inactive for new generation.

`GET /v1/feed` now returns one bounded current edition only:

```json
{
  "editionId": "uuid-or-null",
  "editionDate": "YYYY-MM-DD-or-null",
  "items": [],
  "itemCount": 0,
  "nextCursor": null,
  "activeCategory": "for-you",
  "generatedThrough": null
}
```

The ID/date pair is both null when no News edition has been established. A
non-null pair with no items means the current edition exists but has no
published items for that category yet. Category filtering cannot cross edition
UUID/date boundaries, and cursors are rejected because this surface is a finite
issue rather than an archive paginator.

New invited profiles deliberately retain `onboarding_complete = false` and the
scheduler continues to require it. On the first authenticated browser visit,
the existing non-blocking `/v1/me` timezone PATCH records the browser's IANA
timezone and activates onboarding. This avoids generating a future UTC-dated
edition for a reader in a negative offset before their timezone is known. The
public starter edition remains immediately readable before sign-in.

### Fail-closed public starter News edition

`GET /v1/public/editions/news/current` requires no account and explicitly reads
only the published starter through the narrow non-login `edison_public` role.
Starter articles are immutable, sanitized publication snapshots and never
references to private feed rows. Drafts and future publications remain hidden.
Archived immutable editions/items remain readable through narrow public article
deep links so bookmarks survive rotation; the current-edition endpoint still
selects only `published`.

The operational publisher is `POST /v1/admin/public-starter-editions`, guarded
by a valid bearer token, the fail-closed `EDISON_ADMIN_EMAILS` allowlist, and a
currently active alpha membership. Its JSON body is streamed through an
explicit 2 MiB limit before schema validation, independent of a client-supplied
`Content-Length` header.
The accepted Sleep/History edition was published at `2026-09-05T22:15:29.572Z`
with the reviewed native SQL operator. Current and both public detail endpoints
return `200`; complete hosted snapshots were independently compared with the
accepted source fixture. The no-publication state still fails closed with
`404 starter_edition_unavailable`.

Legacy `GET /v1/shares/:slug` links also switch to `edison_public`, but that role
cannot select from shares or memberships. It can execute one fixed
security-definer function that returns only the immutable sanitized snapshot
for an unrevoked share whose owner still has active membership. The API validates
the returned row and snapshot again before responding.

### Guest and signed-in public-reading continuity

Public reading is implemented for both signed-out and signed-in readers. A
signed-in reader can open the same sanitized starter article without the UI
pretending it belongs to their private edition, and stable archived public
article URLs remain shareable. Public cards and article controls do not claim
that feedback, completion, or private-library saves occurred when those actions
are unavailable for the starter snapshot.

Device-local guest directions and drafts are also implemented. After sign-in,
the web client offers an explicit additive import through the revision-safe
direction API. Exact instructions are deduplicated, logical request IDs remain
stable across retries, edition-only notes map to the account's disclosed
current edition, and a guest draft is copied only when the account has no draft
in that slot. Conflicts are left untouched, import never starts generation, and
the original guest workspace remains recoverable on the device.

### Atomic Q&A and feed-command cost controls

Article Q&A and natural-language feed commands reserve calls in
`private.ai_request_reservations` under explicit rolling 24-hour per-reader
limits. Exact provider input is frozen before a call, workers use bounded
leases and attempts, provider calls use stable keys and shorter timeouts, and
every observed response is promptly deduplicated into
`private.usage_ledger`. Configuration and configured model pricing fail closed.
Malformed structured responses retain their observed provider ID and token
usage; they become terminal only after that accounting is durable. A transient
accounting failure preserves retry capacity and the original provider key.
If the provider nevertheless returns an unrecognized model identity, its
tokens and response ID are retained with `pricing_status = 'unpriced'` and
`cost_microusd = NULL`; the logical operation stops, the known-cost subtotal
remains visible, and the aggregate estimate becomes unknown. An unpriced call
never masquerades as a zero-cost call.

Required API configuration includes:

- `OPENAI_MAX_DAILY_ARTICLE_QUESTIONS` (private-alpha start: `20`)
- `OPENAI_MAX_DAILY_FEED_COMMANDS` (private-alpha start: `10`)
- `OPENAI_MAX_DAILY_GENERATIONS` (must cover the edition target and bounded
  retry allowance)

## Deliberate launch exclusions (not hidden blockers)

- Books and Podcasts remain permanent navigation/direction surfaces with
  honest disconnected states. Their catalog, recommendation, generation,
  object-storage, reader, playback, and progress services are outside this News
  private-alpha release; the UI must continue to avoid fake content or actions.
- Editorial direction affects future generation. It intentionally does not
  rewrite or reorder already published articles, which preserves the version a
  reader opened, read, or saved.
- Native iOS and Android clients are not included in this release. The shared
  versioned API and Supabase bearer-auth boundary are the production backend
  those clients are intended to use.

## Remaining launch blockers

1. **Broader editorial operation is not yet accepted.** The two public starter
   articles and the bounded private correction are accepted and live. A
   reliable recurring editorial pipeline and quality acceptance for future
   automatically generated articles remain separate work. Do not substitute
   demo fixtures or infer a daily publication cadence from the prepared pair.
2. **Broad-access edge/write-rate controls remain operational work.** Database
   quotas protect model spend, but production WAF rules and a modest
   editorial-write limit are still required before broad public access.
3. **Authenticated end-to-end acceptance remains incomplete.** The first owner-only daily
   scheduler invoked real Workflows, but all three articles failed because
   OpenAI rejected the source URL's unsupported `format: uri`. Fix `4f774eb` is
   now live without weakening canonical URL/citation validation. One fresh
   bounded retry succeeded and produced one article plus a priced $0.062654
   ledger row. Provider-dashboard reconciliation remains pending. All four daily
   slots are consumed; do not reset quotas or delete failed history. The first
   article originally received a **withhold** verdict; its accepted bounded
   correction is now live with a protected audit. Actual guest reading,
   Save/Library, Next/Back, direction save/undo and draft/scroll reload checks
   pass on the new deployed interface. The controlled browser has no owner
   session: authenticated rendered save/share/Q&A/direction and correction-note
   acceptance remain unverified. Do not extract tokens or resend invitations.
   Final web `a08c6a1` and API `f6b7bb1` passed full Node 22 CI gates, including
   236 application tests for the final follow-up and 165 pgTAP assertions,
   strict schema lint, both builds and hosted readiness. Full owner acceptance,
   provider-dashboard reconciliation and backup recovery testing remain open.
4. **Production operations and reader-trust materials remain external setup.**
   Approved provider projects/plans, exact origins/owner allowlists, custom SMTP,
   invite delivery/redemption, and the dedicated OpenAI project cap are configured.
   Firewall rules, actionable alerts/error monitoring, a backup/restore drill,
   privacy/support copy, and a named incident owner remain before broader readers.

## Database verification reference

All 15 migrations are applied to the production project. Do not reapply them
or run a production reset. The earlier timestamped base migrations remain part
of future clean disposable verification. In a disposable
environment, let a clean reset apply every migration; review this newer
production-readiness sequence in order as part of that reset:

1. `20260904182546_editorial_directions_and_public_starter.sql`
2. `20260904184023_ai_request_cost_controls.sql`
3. `20260904184140_news_edition_lifecycle.sql`
4. `20260904185513_ai_request_snapshots.sql`
5. `20260904190546_explicit_usage_pricing_status.sql`
6. `20260904192144_preference_bounds.sql`
7. `20260904195000_public_article_share_boundary.sql`
8. `20260904202000_edison_api_auth_membership.sql`
9. `20260905201500_learning_loops.sql`
10. `20260905223000_article_correction_audit.sql`

For a new clean release, run every pgTAP test, schema lint, both typechecks, all application tests,
and both production builds from a clean checkout. Verify current/archived public
RLS while executing as the non-owner `edison_api`/`edison_public` roles,
direction concurrency and limits, rotation replay, stale-result accounting,
unpriced-response constraints, daily partial-edition retry behavior, and
exact-edition feed filtering against real Postgres. Verify the concurrency-safe
50-item retained explicit-interest cap and strict 80-entry/256 KiB knowledge
state guard as well. Confirm the public share function returns only active,
unrevoked snapshots while `edison_public` has no direct share or membership
table access. RLS is enabled and enforced
for those roles; these migrations do not use `FORCE ROW LEVEL SECURITY`.

The configured Supabase, Vercel, SMTP, dedicated billed OpenAI API project, and
exact origins/allowlists are no longer setup blockers. Remaining operations
include the restore drill, health/job/cost alerts, credential-rotation procedure,
editorial provenance review, and acceptance. Existing release deployment is
authorized; any domain cutover or broader invitation requires a separate owner
decision. Credentials stay server-only.

## One-off generation boundary

Authenticated `POST /v1/generation-jobs` commissions News only. It uses the
same current News edition and direction snapshot as scheduled generation, but
its successful item appends after deterministic daily slots and requires its
own idempotency key. There is no corresponding Book or Podcast generation job.
