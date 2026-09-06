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

### September 6 approved on-demand v8 — local implementation, not released

Michael approved the exact v8 in Chief of Staff and requested CTO handoff (D26).
The earlier pause for CoS/Design is resolved. Read
`docs/brand/APPROVED_ON_DEMAND_LOOPS_CTO_HANDOFF_2026-09-06.md` and
`docs/ON_DEMAND_IMPLEMENTATION_2026-09-06.md` before adopting older implementation
gaps or approval holds below. The new general-topic guest/account reading flow,
durable ideas → selected article → automated checks/one repair, scoped additive
principles/Undo and questions are implemented locally on base `d084df4`, with
prompt candidate v1.2. CoS owns editorial/value acceptance and Design reviews
the built interface. Full real-provider/hosted acceptance is still incomplete.

The combined history/continuity freeze passes 285 web tests, 125 API tests, both typechecks,
repository lint and both production builds. Checkpoint `bd2bf2f` is pushed to PR #1;
its CI application job and all three Vercel Preview builds passed. Supabase PG17
CI caught a redundant privileged ALTER ROLE in new001. A narrow follow-up retains
least-privilege CREATE attributes and rejects unsafe role collisions, with 69
local pgTAP assertions and restricted-CREATEROLE checks passing. Correction
`44534e8` passed full CI `34047052622`: application and disposable Supabase PG17
database jobs, all 16 migrations, 234 pgTAP assertions, publication/correction
replays and strict schema lint. Earlier bounded separate-process PostgreSQL 18.6 admission/provider-stage/
checkpoint-contention/owner-isolation checks and all-16 native clean-chain
rehearsal used the original migration before that role correction, with Supabase-owned
prerequisites. A separate 420-row SQL history case passed. Final UI changes cover
ordered responses, draft/Undo safety, half-read leave/reopen/reload, combined For
You, scoped Ask, existing account Profile access and bounded 60-card older/saved
history with exact status recovery beyond recent workspace caps (50 focused tests).
Exact hashes and limits are in the implementation checkpoint; earlier rendered
fixture checks do not establish browser acceptance of the corrected UI.
Design independently closed the original continuity/history source cases at
44/44. Its subsequent late-restoration/navigation finding now has a guarded
success/failure/bootstrap/Retry correction and regressions, with final independent
Design source closure and rendered/connected acceptance still separate.

This record accompanies the scoped feature-off checkpoint for existing PR #1;
the commit containing it identifies the source. The candidate remains off behind
`EDISON_ON_DEMAND_ENABLED`; its reader is isolated at `/demand`. No hosted
migration or explicit deployment has occurred for this assignment. Release-branch
pushes may trigger Preview/CI only. The new additive migration has disposable
PostgreSQL checks, not hosted acceptance. A linked read-only dry run reports only
that migration pending. Vercel's one-time CLI device authorization expired; a
fresh code is needed when Michael is ready. Do not reuse it, bypass the disabled
control, expose saved credentials or substitute the old live generation pipeline.
The implementation record describes the protected aliasless calibration path and
the remaining history indexing/immutability hardening; it has not been executed.
The existing September 5 deployment and domain/origin configuration remain
unchanged. Preserve existing authority, funded capacity, private account
membership and unrelated shared-checkout work. No fresh generic approval is
needed for the selected implementation; do not claim it is production-ready
from local tests or synthetic UI content.

### September 5 apex cutover — completed and verified

Michael explicitly requested, “can we deploy it at edisonreader.com too plese,”
in Chief of Staff's task (user message `01a073c8-52bc-7f90-adc8-0447fa602586`).
CTO verified that original user message. This supersedes the older apex-demo
preservation restriction for the named existing domain only. The cutover is
complete: the `edison-app` Production deployment serves both
`https://edisonreader.com` and `https://project-qlqve.vercel.app`, while
`https://www.edisonreader.com` preserves its path/query-aware `308` redirect to
the apex. Vercel reports all three domain assignments Valid. The apex DOM was
verified against web deployment `dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt` and shows
the approved Sleep/History Pulse application, not the former sample demo.

The API intentionally remains at the temporary
`https://project-fjr95.vercel.app/v1` URL. Its cache-free Production rebuild of
`a681331` is `dpl_JCoE2yh9oxwA56wcjJu1JULq4hC6`, Ready at 23:10:44 UTC and
confirmed after reload. `WEB_APP_URL` is the apex and
`CORS_ALLOWED_ORIGINS` contains exactly the apex plus the retained temporary
web origin. Supabase Auth now uses the apex Site URL and exactly four redirect
entries: `/auth/callback` and `/auth/confirm` on each of those two web origins.
No wildcard, `www` callback, new invitation, provider call, generation run,
content write, paid service or secret inspection was part of the cutover.
Owner-only access, budgets and rollback points remain unchanged. Detailed
cutover and post-deploy evidence belongs in
`docs/PULSE_RELEASE_2026-09-05.md`; do not duplicate or rerun it.

### September 5 Pulse + loops release — latest implementation checkpoint

Michael approved the selected Pulse + loops v5 and explicitly asked the CTO to
get it live in Production. The controlling product scope is
`docs/brand/APPROVED_PULSE_LOOPS_CTO_HANDOFF_2026-09-05.md` and its linked v5
implementation details. This supersedes older interface descriptions below;
this approval did not itself authorize a domain change, merge into `main`, new
readers or paid services. The later apex authorization above supersedes only
that named domain restriction. The older setup checkpoints are historical, not
pending instructions.

Release `f6b7bb1cb49244c28f37f70519b97184510708a9` passed full Node 22 CI
`33995500057` including 165 pgTAP assertions and actual disposable publication/
correction rehearsals. Explicit cache-free Production rebuilds are Ready:

- Initial web: `dpl_ArHbfeAQeHmREgBQjkN91ivL977h`,
  `https://project-qlqve.vercel.app`, September 5 at 22:29:22 UTC.
- API: `dpl_4SBpQxDpes2wrnpGFpJ1z2AWEyHf`,
  `https://project-fjr95.vercel.app`, September 5 at 22:23:54 UTC.

The final web-only follow-up `a08c6a1a346f281182f23214500bc93e72075243`
passed full Node 22 CI `33996724371` with 236 application tests and 165 pgTAP
assertions. Production web `dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt` was Ready at
22:49:02 UTC on the same stable web URL. At that pre-cutover checkpoint the API
remained f6; the follow-up changed only web files, focused tests and
documentation. The later API rebuild is recorded in the cutover section above.
Do not redeploy API or rerun migrations for a documentation-only closeout.

All 15 migrations are applied. The accepted Sleep/History public edition is
published and its real UUIDs/artwork are bound in the client; complete hosted
snapshots were independently verified. The owner article's accepted manual
editorial correction is applied with immutable protected before/after audit
and a narrow owner-only disclosure. Do not repeat those writes or use obsolete
starter/correction drafts. Generation jobs remain 4, usage rows 1, recorded
cost $0.062654. Do not reset quotas or claim this correction improved the writer.

Actual guest reading, Save/Library, Next/Back/card focus, loop matching, Curate
save/undo, question-draft and scroll-position reload checks pass. The new API's
health, private-route rejection, exact CORS and all negative cron checks pass.
Design has rendered actual 320/390/760/1024/1280/1440px layouts without
horizontal overflow. The bounded keyboard/focus/styling follow-up is live;
root verified its deployment marker, heading focus, removed Pulse-only stripe,
Ask dismissal restoring its control's focus and original-card return. Design's
focused a08 recheck closed all five keyboard/styling findings at desktop and
320/390px. Its exact report is linked from the release record. The controlled
browser still has no authenticated owner session; owner-only rendered flows,
the correction note, provider-dashboard reconciliation and backup restoration
remain unverified. Do not extract credentials or resend invitations.

The live release record is `docs/PULSE_RELEASE_2026-09-05.md`. Preserve rollback
deployments and the former demo deployment, but do not describe the apex as an
isolated demo after the cutover. `main` remains unmerged at `e559a6b`.

### September 5 full-release authorization — pre-cutover release authority

At that checkpoint, the owner's instruction was: “I trust you - let's just do
everything to get this fully deployed and ready for production. Only ask me if
you need me if you really think it's necessary.” This superseded the step-by-step stop
boundaries in the historical setup record below. It authorizes secure release
access, reviewed migrations, committing/pushing the candidate, deploying the
existing live projects, and inviting/testing only the previously approved owner,
`mike@michaelmcguiness.com`. Do not request another generic release approval.
Never reveal existing secrets or ask for them in chat. At that checkpoint, no
extra paid services, broader invitations, or website-domain changes were part
of the first release. The separately verified decision above later authorized
and completed the existing apex/`www` cutover only; it did not broaden reader
access or authorize any additional domain.

#### Historical pre-Pulse setup chronology

The following checkpoint is retained as history and is superseded by the
latest Pulse release and apex cutover above. Statements about the apex demo,
single-origin configuration, or a missing starter describe their timestamped
pre-cutover state and are not current instructions.

Candidate `4f774eb` was committed and pushed on
`codex/production-release-candidate` in draft PR #1; `main` is neither merged
nor protected. [CI run 33987973278](https://github.com/michaelmcguiness/edison/actions/runs/33987973278)
passed on Node 22.23.2/pnpm 10.28.0 with lint, both typechecks, 183 application tests,
both production builds, all 107 pgTAP assertions, and strict application-schema
lint. The application total is 110 web plus 73 API tests, with zero failures.

The reviewed linked dry run and backup checkpoint preceded a successful
production push of all 13 migrations to Supabase project
`bcxxnntastmnormcmxbq`. A separate read-only metadata check on PostgreSQL 17.6
found all 24 expected tables, all 21 expected RLS settings, 45 policies, 20
triggers, zero invalid constraints, the expected Storage bucket, and the
intended role/grant boundaries. Auth was empty during that audit; it now has
exactly the single invited owner described below. Recovery from backup remains
untested; do not describe the checkpoint as a restore rehearsal.

Release-branch pushes now correctly target Preview; the current live-project
deployments were explicit Production rebuilds. Web deployment
`dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` of `d463d44` is live at
`https://project-qlqve.vercel.app`; it returned HTTP 200 with the expected
nonce-based CSP at 19:12:56Z. The apex `edisonreader.com` continued to serve the
older isolated sample-data demo with HTTP 200 at 19:12:58Z.

The owner privately saved the actual Supabase Shared Transaction pooler URI; no
secret was read or exposed. Candidate `df3e712` now shares one production TLS
policy between runtime and preflight: a URI without a TLS query option receives
explicit Postgres.js `ssl=require`, certificate-verifying requests remain at
least as strong, and insecure, duplicate, or ambiguous URL controls fail closed.
Explicit constructor precedence also prevents `PGSSL` or URI aliases from
turning TLS off. Focused tests, independent security review, and a local TCP
mock confirm TLS is attempted and a server refusing SSL is rejected without a
plaintext startup fallback.

Production API deployment `dpl_GVJFA1vDQks3eBya4ArrXGpCHzFU` of `df3e712` was
Ready at 19:11:12Z (15:11:12 EDT). At 19:11:46Z, `/v1/health` returned HTTP 200
with configuration, database, and Supabase Auth all `ok` (request
`d641ae5d-26df-4974-b2cc-c1fcff4309ab`). Independent live checks then confirmed
unauthenticated `/v1/me` is `401`, the configured web-origin preflight is `204`
with exact origin reflection, an unapproved origin is `403` without reflection,
and all six missing/wrong-token checks across the three GET cron routes are
`401 invalid_cron_secret`. The unauthenticated public-starter read reached the
real public SQL role and returned the expected `404 starter_edition_unavailable`
because no starter is published. These negative checks preceded the first
valid owner-only scheduler invocation described below.

Vercel CLI 59.11.7 was available only through an ephemeral `pnpm dlx` run. Its
login could not be completed and the pending attempt was canceled, so there is
no authenticated local Vercel CLI session.

OpenAI project `edison-production` (`proj_EFKsL4Yfs6pDFOzI4aGWThSf`) now has an
enforced $50 monthly project cap and model access limited to `gpt-5.6-terra`
and `gpt-5.6-luna`; the owner also funded the API account with $50 in credits.
Its `edison-api-production` service-account key was privately saved as the API
Production `OPENAI_API_KEY`; no secret was printed or stored in the repository.
The owner explicitly approved Responses-only scope, and the key is now saved as
Restricted. A fresh permission readback shows Write only for Responses
(`/v1/responses`) and None for every other permission leaf. The safety reviewer
initially rejected the save when the UI reported “2 selected permissions.” A
non-saving check changed only the Responses control and observed that displayed
count move from `0` at None to `1` at Read and `2` at Write while every other
leaf remained None; the retry then succeeded. No further key-scope approval is
pending. The first provider attempt reached OpenAI but was rejected for an
unsupported output-schema format, as described below. The original
default-project key remains unread and unrevoked.

The single authorized owner invitation was sent once through the Supabase
Dashboard at approximately 19:15Z after health and all ten safe live checks
passed. Auth now contains exactly owner
`5611f8fa-e0dd-460c-ae4d-5fb7dd7bfe83`, with
`invited_at=2026-09-05 19:15:11.951927+00`; Resend metadata shows message
`4fecf81e-099f-4144-acf6-4f26bf85ef51`, subject “Your Edison Reader
invitation,” as Delivered. No email body, callback token, or secret was read.
The owner has now redeemed the invitation: `email_confirmed_at` is
`2026-09-05 19:23:00.363055+00` and `last_sign_in_at` is
`2026-09-05 19:23:00.372394+00`. Live API logs show authenticated `/v1/me`,
`/v1/feed`, and `/v1/editorial-direction` reads plus the first `/v1/me` PATCH
all returning 200 at 19:23:02Z. Read-only metadata confirms active membership,
`onboarding_complete=true`, and `timezone=America/New_York`. No additional
sign-in, invitation, or credential change is required. The owner's signed-in
browser is not connected to the current controlled browser session, so the
rendered authenticated reading journey remains unverified. The hosted template is saved and
fresh-reload verified with exactly one invitation link using the
Dashboard-compatible `.SiteURL` `/auth/confirm` token-hash callback. The
matching repository correction and focused release-boundary regression were
included in pushed checkpoint `d463d44`. Candidate `df3e712` includes the safe
database diagnostic and enforced TLS policy with the full green release gate.

At 19:33:45.426Z, one authorized click on Vercel's existing daily-edition
**Run** control returned 200. A read-only precheck confirmed the scheduler had
exactly one eligible profile, the approved owner. It created exactly three
`initial-edition` jobs and dispatched real Workflows. All three failed by
19:33:57Z, with no article, feed item, provider response ID, or usage-ledger row.
The Workflow inspector identifies the concrete provider error: HTTP 400,
`sources.items.properties.url` emitted unsupported JSON Schema `format: uri`.
Each generation step attempted four times within its one workflow run; the
database job attempt count is one, not a provider-call count. Fix `4f774eb`
separates the compatible provider wire format from unchanged canonical URL and
citation validation and increments the request-envelope version to 2.
Independent review found no P0/P1/P2 issues; actual SDK schema regressions and
all 183 application tests pass.

Production API deployment `dpl_12vWp1rShga96hTQ1yJzu8VTiRYh` of `4f774eb`
was Ready at 19:47:17Z. Its 19:47:37Z health check returned 200 with all three
checks `ok` (request `e3f2ec39-c7b6-4c9a-8004-5434ca61114e`). One subsequent
dashboard scheduler invocation at 19:48:11Z created only the quota-permitted
fresh slot-1 retry. Job `2bc18fba-142d-4be6-af9a-c1c18523809c` succeeded at
19:48:41.516Z, publishing one owner article at rank 1 for September 5. Workflow
`wrun_01M1SHTG1K70NG2D4NE3PC4QNS` is completed. Its one priced ledger row
records `gpt-5.6-terra`, 14,045 input tokens, zero cached tokens, 2,047 output
tokens, one web-search call, and estimated cost 62,654 micro-USD ($0.062654).
The provider usage dashboard still showed no data at the initial follow-up, so
provider-side billing reconciliation is not complete. No quota or history was
reset: all four rolling daily job slots are consumed, and the edition is one
article rather than a complete three-article acceptance.

At this earlier checkpoint, the first genuine production article was not
editorially accepted.
Primary-source review found overconfident headline framing and incorrect precise
source dates; the original private artifact is retained without silently changing
the live article. Chief of Staff now owns Editorial, Strategy, and Growth; do not
reactivate those archived tasks. Chief of Staff's independent final verdict is
**withhold** this exact article pending bounded corrections: headline/opening
certainty, source dates/labels, and clearer projection timing. The core numerical
claims and grid lead-time explanation were supported. The bounded correction
was subsequently accepted and applied with a protected audit as recorded at
the top; this historical withhold is not a current instruction to repeat it.
New unapproved product/design proposals must not enter
engineering until Michael approves their design; existing release fixes continue.

Head of Editorial accepted starter candidate v2 with exact SHA-256
`aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50`
in its isolated worktree. That older draft is superseded by the accepted and
published Sleep/History fixture. Do not integrate or publish the obsolete v2.

### Historical setup and approval record

This section preserves dated setup authority and evidence only. Its stop
boundaries were subsequently superseded by the scoped full-release and apex
decisions above; do not treat them as the current deployment state.

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
draft pull request; at that time, `main` still automatically deployed the
existing apex demo.
Project creation does not authorize merging the release or activating live
services.

The owner subsequently approved signing into Supabase with the
`michaelmcguiness` GitHub account and connecting only
`michaelmcguiness/edison` to both new Vercel projects. The Git connections are
complete. The owner completed Supabase sign-in as `michaelmcguiness` and
created `edison-production` in Mike's Org, North Virginia
(`us-east-1`). Project `bcxxnntastmnormcmxbq` reports Healthy and PostgreSQL
`17.6.1.166`, matching the tested major version. No database password was
read, generated, or entered by the agent. Secret entry and all other stop
limits remain in force.

The owner then upgraded the Vercel team and Mike's Org to Pro; refreshed
dashboards independently confirm both plans. The owner saved `OPENAI_API_KEY`
directly in `edison-api`; its environment list shows a Production-only Secret.
Only metadata was inspected, never its value, and provider access/billing has
not been tested. The owner created and signed into Resend via GitHub, then
explicitly approved adding `mail.edisonreader.com` and its required email DNS
records in Vercel while leaving website routing unchanged. That setup is now
complete: Resend domain `81f985d3-02be-48bd-b9d1-9f7e6902114e`, North Virginia,
reports Verified for DKIM and both sending/SPF records. Sending is enabled,
Receiving is disabled, and tracking is unconfigured. Exactly three TTL-60
records were added; both authoritative nameservers and a public resolver match
the expected records. Apex/`www` HTTP/TLS smoke checks still pass. No optional
DMARC policy, inbound-mail MX, or website routing change was made.

The owner reports creating the Resend key and saving Supabase custom SMTP.
A fresh settings page confirms SMTP enabled, sender
`Edison <auth@mail.edisonreader.com>`, host `smtp.resend.com`, port `465`, and
60-second minimum interval. The owner corrected the SMTP Username to `resend`;
an independent fresh page on September 5 confirms it is saved and SMTP remains
enabled. The password was not revealed, changed, or read by the agent; its
validity and the Resend key's permissions have not been tested. No delivery
test has run. Browser text/DOM inspection
omits some email/username values; fresh screenshots confirmed the public
settings without revealing the password. Do not mistake omitted text for
unsaved settings or reveal secrets to verify them.

No existing secret values or test emails were handled by the agent during
SMTP setup. The separately authorized cron generation is recorded below.
Migration, deployment, invitation, and domain-change boundaries remain in
force; the email-domain approval does not authorize app/API domains.

On September 5, the owner explicitly authorized the remaining non-secret
web/API connection settings, initial usage quotas, temporary origins, and
private-alpha allowlists, plus the hosted Auth restrictions and invitation
template. That setup is complete as recorded below. It does **not** authorize
entering or inspecting additional secrets, configuring the database or cron
secret, applying migrations, pushing code, deploying either live project,
sending an invitation, or changing domains.

The owner then approved guided private credential entry, entered
`DATABASE_URL`, and separately authorized generating `CRON_SECRET`. The agent
generated 32 cryptographically random bytes, encoded them as 64 hexadecimal
characters, and filled only the cron field without printing or reading back
either secret. The database value was not inspected or changed. The owner
clicked Save and confirmed completion. A September 5 metadata-only check
independently confirms both names saved as Production-only Secret values in
`edison-api`, alongside the existing OpenAI Secret. No values were revealed.

All required API variable names are now present, but metadata does not prove
database URL formatting/TLS, credential validity, or provider connectivity.
Full API preflight and real connection tests remain pending. This approval
does not authorize inspecting secrets, secure local migration access, schema
application, deployment, or invitations. Never read an in-progress secret form
or ask for keys in chat. The next gate is separately approved secure local
migration access and a reviewed dry run, not another Vercel secret-entry form.

## Hosted state versus working-tree state

- [edisonreader.com](https://edisonreader.com/) now serves the approved live
  Pulse application from `edison-app`; the retained
  [temporary web URL](https://project-qlqve.vercel.app/) serves the same
  Production deployment. `www` redirects to the apex with `308`, preserving
  path and query. All three assignments were fresh-reload verified as Valid.
- The former credential-free sample deployment remains a separate rollback/
  historical deployment and has not received production Supabase, API, OpenAI,
  SMTP, or cron credentials. It is no longer attached to the apex.
- The public GitHub source is
  [michaelmcguiness/edison](https://github.com/michaelmcguiness/edison). The
  deployed checkpoints are `a08c6a1` (web) and `a681331` (API, with the same
  f6 runtime source). They are on `codex/production-release-candidate` in
  [draft PR #1](https://github.com/michaelmcguiness/edison/pull/1). `main` is
  unmerged and unprotected.
- Separate `edison-app` and `edison-api` Vercel projects exist with the intended
  Next.js/Node 22/build settings and saved production branch `main`.
  Release-branch pushes now target Preview; the current deployments were
  explicit Production rebuilds. Web deployment
  `dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt` (`a08c6a1`) is live at both
  `edisonreader.com` and `project-qlqve.vercel.app`. API deployment
  `dpl_JCoE2yh9oxwA56wcjJu1JULq4hC6` (`a681331`, with unchanged f6 API
  application source) is Ready at `project-fjr95.vercel.app`, and readiness is
  fully healthy. The web project has the apex custom domain; the API still uses
  its temporary Vercel URL.
- `edison-app` has five Production Config values: Corepack, explicit live mode,
  the temporary API `/v1` URL, and the production Supabase URL/publishable key.
  Preview has only Corepack plus explicit demo mode. `edison-api` has 17
  Production Config values for Corepack, Supabase public Auth metadata, JWT
  audience, reviewed models and quotas, exact web/CORS origins, initial
  edition scheduling, and the owner-only reader/admin allowlists. The existing
  Production-only OpenAI Secret now contains the privately transferred
  `edison-api-production` service-account key for the dedicated Edison project;
  it was never printed or read back. Its saved Restricted policy grants only
  Responses Write and leaves every other permission leaf at None; the key is
  known to have returned one successful, priced article-generation response.
  `DATABASE_URL` and `CRON_SECRET` are also verified Production-only Secrets;
  the API has 17 Production Config values and three Production Secrets total.
  API Preview had no variables
  until the final authorized setup step; it now has exactly one Config value,
  `ENABLE_EXPERIMENTAL_COREPACK=1`, and no live values. Future pushes can
  trigger builds;
  do not push merely to update setup notes before deployment is intended.
  See `docs/DEPLOYMENT.md` for IDs and setup status.
- Exact current wiring is web → `https://project-fjr95.vercel.app/v1`, both
  projects → `https://bcxxnntastmnormcmxbq.supabase.co` with the matching public
  key, API `WEB_APP_URL` → `https://edisonreader.com`, and API CORS → exactly
  `https://edisonreader.com` plus `https://project-qlqve.vercel.app`. API models
  are `gpt-5.6-terra`/`gpt-5.6-luna`; per-reader quotas are 4 generations,
  20 article questions, and 10 commands; search accounting is 10000 microdollars
  per call; edition settings are hour 5, target 3, batch 25. Both API email lists
  contain only `mike@michaelmcguiness.com`. Do not put the literal publishable
  key in documentation even though it is intentionally public client metadata.
- The web and API Build Commands persist the production-only
  `scripts/check-production-env.mjs` guards documented in the release runbook.
  Fifteen focused authentication/configuration tests pass.
- A read-only attempt to open Supabase's Direct Connection string was blocked
  before execution because it could expose credentials. No database connection
  value was read, copied, or inferred, and no workaround was attempted. Later
  authorized Vercel entry is complete as recorded above. Secure local migration
  access subsequently succeeded through the official CLI login/link flow;
  never request credentials in chat.
- Supabase project
  [`edison-production`](https://supabase.com/dashboard/project/bcxxnntastmnormcmxbq)
  exists and is Healthy, in the Pro organization in `us-east-1`, PostgreSQL
  `17.6.1.166`; the organization inventory still labels compute Nano.
  All 15 repository migrations are applied. Read-only hosted checks confirm the
  expected schema, RLS, policies, triggers, Storage bucket, functions, and
  constrained grants. Backup contents and recovery have not been verified. The
  owner privately saved the actual Shared Transaction pooler URI. Runtime
  and preflight now share the `df3e712` TLS policy, which explicitly defaults a
  missing TLS query option to `ssl=require` and rejects insecure or ambiguous
  overrides. Production database health passes; no further owner database edit
  is pending.
- Hosted Supabase Auth has global signup and anonymous sign-in disabled, the
  email provider enabled for invitations, apex Site URL, and exactly four
  redirects: `/auth/callback` and `/auth/confirm` on both
  `https://edisonreader.com` and `https://project-qlqve.vercel.app`. There is no
  wildcard or `www` callback. Its current signing key is already ECC P-256. The
  hosted invitation template and subject
  “Your Edison Reader invitation” are saved and fresh-reload verified; its
  single CTA uses
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite`
  because Dashboard invitations cannot supply a callback override. One owner
  invitation was sent and provider metadata reports Delivered; its body and
  token were not read. The matching repository template
  correction and focused regression are included in pushed checkpoint
  `d463d44` and its green CI run.
  In local `supabase/config.toml`, `[auth].enable_signup=false` is the
  signup denial; `[auth.email].enable_signup=true` correctly keeps the email
  provider available and maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Confirm-email
  remains enabled. The dashboard template preview has an unresolved logo and
  the owner has redeemed the invitation successfully. Owner-side email asset
  rendering remains unverified, but the callback/authenticated API gate passes.
- The cache-free API rebuild of `a681331` is deployed and Ready with
  configuration, database, and Auth health all `ok`. The apex and temporary
  web origins and Supabase schema are live. Owner authentication and timezone
  persistence pass; one real article and its usage ledger now exist after the
  provider-schema fix.
  Accepted public articles and the audited manual correction are live. Guest
  rendered acceptance passes; authenticated owner acceptance remains incomplete.
- CI run `33996724371` is green for web follow-up `a08c6a1`: 236 application
  tests, 165 pgTAP
  assertions, strict schema lint, and both production builds. Hosted OpenAI
  billing reconciliation, owner-side email rendering, end-to-end owner acceptance, and
  a backup/restore rehearsal remain release gates.

## Production topology

Edison is an API-first modular monolith and a real client/server application:

| Surface | Target | Responsibility |
| --- | --- | --- |
| Live web (`edison-app`) | `edisonreader.com`; retained alias `project-qlqve.vercel.app` | Next.js UI + Supabase Auth session |
| Web redirect | `www.edisonreader.com` → `edisonreader.com` | Path/query-preserving `308` |
| Live API (`edison-api`) | `project-fjr95.vercel.app/v1` | Authz, Postgres, OpenAI, Workflow, cron |
| Former demo | Separate retained Vercel deployment | Credential-free rollback/history only |
| Data/Auth | Supabase Pro | Canonical Postgres, Auth, reserved Storage |

Web and future native clients authenticate through Supabase, then call the same
versioned Edison API with a bearer token. They do not connect to Edison core
tables or OpenAI directly. The API verifies tokens and the fail-closed alpha
allowlist, executes reader queries under the non-login `edison_api` role, and
relies on enabled RLS policies that are enforced for that non-owner role. The
migrations do not use `FORCE ROW LEVEL SECURITY`; browser/mobile Supabase roles
also have no core table grants.

Use one region: API/Workflow in US East and a nearby Supabase project. The apex
and temporary web alias intentionally share the same `edison-app` Production
build and environment. Keep the former credential-free demo project separate;
do not attach production credentials to it.

## Locked product and design decisions

The current canonical sources, newest last, are:

1. `docs/brand/WHITE_EDITION_HANDOFF.md`
2. `docs/brand/PERSONAL_PUBLICATION_HANDOFF.md`
3. `docs/brand/SIDEBAR_CHAT_HANDOFF.md`
4. `docs/brand/APPROVED_PULSE_LOOPS_CTO_HANDOFF_2026-09-05.md`
5. `docs/brand/PULSE_LOOPS_V5_IMPLEMENTATION_DETAILS.md`

The Pulse v5 sources supersede conflicting legacy shell, rail, dock, category
tab and infinite-feed instructions for the current News experience.

- The feed uses the normal page viewport, a white canvas, the existing Edison
  bulb/wordmark, visible For You/loop navigation and Library/Profile controls.
  It is two columns on desktop and one on phones, with no fixed-height or nested
  scrolling prototype shell.
- The finite feed ends honestly. For You deduplicates real articles across
  loops; subject creation and empty states never fabricate or pad inventory.
- One feed-only Curate control edits future direction. For You requires an
  explicit target loop, and save/clear/undo reflect actual passed backend or
  device-local state.
- Article Ask is a separate article-scoped sheet. It never silently changes
  loop direction or promises live answers when that capability is unavailable.
- Article Next and Back use the actual frozen readable sequence, origin label
  and return position; there is no forced Finish step or auto-advance.
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
- Exactly two genuine public starter articles, Sleep and History, are reviewed,
  published and bound to their hosted UUIDs/artwork. Five prototype concepts
  remain deliberately unwritten and must not be shown as readable inventory.
  Future public editions still require sourced editorial acceptance and the
  guarded operator; do not infer a recurring daily cadence from this prepared
  pair or rerun the publisher for the domain cutover.
- Resend's sending domain is verified and Supabase custom SMTP is configured,
  including the corrected username. Provider metadata confirms the owner invite
  was Delivered, and invitation redemption/authenticated API access pass.
  Owner-side rendering remains unverified. Broad-launch edge policy, monitoring vendor,
  privacy/support copy, and on-call owner still require operational decisions.
- There is no paid staging environment. Add one when multiple developers,
  frequent migrations, hosted CI, or meaningful production traffic justify it.
- Native clients are not built yet, but the production API/auth boundary is the
  intended mobile backend.

## Required release gates

The source, disposable-database, CI, production migration, live-web/API
deployment, health, public-role, and negative auth/CORS/cron gates are complete
through the latest Pulse checkpoint at the top, not just the historical
`df3e712` setup release.
The guest release is live at both approved web origins. Before the owner-only
alpha is accepted as end-to-end verified:

1. Owner invitation redemption, active membership, authenticated `/v1/me`, and
   first-visit timezone persistence passed at 19:23Z. Do not resend an invitation.
2. The provider output-schema fix is live and one bounded article generation
   and priced ledger row pass. Complete provider-dashboard reconciliation;
   preserve the saved Responses-only key, model allowlist, and $50 cap.
3. Complete rendered owner acceptance for private reading, save/share, Q&A,
   direction and the correction disclosure. Existing authenticated API reads
   and the real article/citation/retry/cost-ledger path already pass; do not
   create another owner, invitation or generation merely to test the cutover.
4. Existing cron/Workflow logs and all negative cron checks pass. Do not invoke
   a valid cron, generation or publication operator again for domain
   verification. Add the planned WAF controls and complete a
   backup/restore rehearsal before broader external readers. The accepted
   Sleep/History starter publication is complete; older starter v2 instructions
   are obsolete and must not be run.
5. The authorized apex/`www` cutover is complete and the temporary web origin
   must remain working. Merge the reviewed candidate and protect `main` when
   the alpha is accepted. The API URL remains temporary; any API custom domain,
   additional website domain or broader reader invitation requires a new owner
   decision.

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

For the current on-demand assignment, the September 6 checkpoint above and its
approved v8 handoff supersede the older v5-only development scope in the retained
first prompt below. Continue from the dirty candidate, not from scratch; read
the technical checkpoint's remaining acceptance and coordinate with CoS/Design.

> Continue building Edison Reader from this repository. Read
> `CODEX_HANDOFF.md` completely, then inspect the working tree and current Git
> state before editing. The target is the owner-only production alpha using the
> separate Vercel web/API + Supabase architecture described here. The approved
> Pulse application is live at both `https://edisonreader.com` and
> `https://project-qlqve.vercel.app`; `www` redirects to the apex. The apex is no
> longer the isolated sample demo. The API intentionally remains at
> `https://project-fjr95.vercel.app/v1`. Preserve exact finite News, Pulse +
> loops v5, article-scoped Ask, truthful guest/device boundaries and
> non-overwriting explicit import. Use the latest checkpoint and
> `docs/PULSE_RELEASE_2026-09-05.md`; older setup records are historical.
>
> The current web deployment is the verified a08 Production build and the API's
> cache-free `a681331` Production rebuild is Ready. API `WEB_APP_URL` is the
> apex; CORS contains exactly the apex and retained temporary web origin.
> Supabase Auth uses the apex Site URL and exactly four callback/confirm URLs
> across those two origins. Preserve those allowlists—no wildcard or `www`
> callback.
> `main` is still unmerged and unprotected.
>
> All 15 hosted migrations, the accepted Sleep/History publication, audited
> owner-article correction, real UUID/artwork binding and Production deployment
> are complete. Do not repeat migrations, publication/correction operators,
> valid cron invocations, generation, quota resets or obsolete prepared SQL for
> release verification. Generation jobs remain four, usage rows one, and known
> cost $0.062654. The three original failed jobs remain intact and all four
> daily slots are consumed.
>
> Production API health, exact dual-origin CORS, private-route rejection, public
> reads and negative cron checks pass. Owner invitation redemption,
> authenticated API reads, and timezone/onboarding persistence are verified.
> The controlled browser still has no owner session, so authenticated rendered
> reading/save/share/Q&A/direction and correction-note acceptance remain open.
> Test only the existing owner; do not extract credentials or resend an
> invitation. Provider usage-dashboard reconciliation and a backup restoration
> rehearsal also remain pending.
>
> The dedicated OpenAI service-account key is already Restricted to Responses
> Write with every other leaf None; do not inspect it or request another scope
> approval. Route editorial review to Chief of Staff, not archived tasks. The
> September 5 full-release and exact apex-cutover authorizations at the top
> supersede historical stops only within their stated scope. Never ask for or
> expose secrets, buy additional services, invite other readers, alter current
> domains/origin allowlists, or broaden owner-only access without a new owner
> decision. Report genuine blockers and distinguish an owner-only live alpha
> from broader-reader readiness.
