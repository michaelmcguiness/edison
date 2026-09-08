# Edison production release runbook

Verified against the repository and linked provider documentation through
2026-09-05. Recheck provider prices and limits immediately before purchasing or
launching; they can change without a code release.

## Decision and current status

### September 8 — first generation-delivery speed increment live

Both production projects run `3a526fad880bdb389b0560805ce96957898986cf`:
API `dpl_D1uSkD5rV3Cu5snw5u6RYX1f26qV`, READY17:31:25.851 UTC;
web `dpl_5pXE8cMFCnqspuxDkB71KcgZeAoj`, READY17:33:04.250 UTC.
Exact-source CI34256980244 passed1,078 application tests,320 pgTAP assertions,
seven disposable DB proofs, types/lint/builds and schema lint. Independent source,
CI and live identity/alias/schedule reviews are closed; public smoke passed
17:36:54.432 UTC. All existing destinations, schedules and spending caps remain.

Known articles now read result/body immediately, loop polling survives unrelated
updates, verified accounts skip an unused database transaction and settlement
reads less data. The approved **Edit loop** label is restored. This improves
finished-result delivery; no actual model-generation speedup was measured.
Writing/checking/models remain unchanged. No new paid generation, QA identity,
mail, migration, Auth, secret, domain or tier change occurred. The next bounded
Fast candidate remains off by default pending exact accounting/replay review.
See the [generation-latency receipt](operations/GENERATION_LATENCY_RELEASE_2026-09-08.md) for evidence and limits.

### Previous — September 8 D50 checker-format correction live

API source `bd528f59145f0878351d665f444d945c8ebdaf31` is live as
`dpl_3TUAXZC4E5poyaf61sF1jZVyb8zm`, READY 16:17:56.361 UTC. Exact-source
CI34249541600 passed all 1,053 application tests, 320 pgTAP assertions, seven
DB proofs, both builds/types and lint. Live health/access/CORS/cron checks pass;
all aliases and three schedule cadences are retained. Web remains c71af50.
New article/Ask requests use the approved version-pinned clean-pass format;
legacy requests, raw receipts, sole repair, Auth and budgets remain unchanged.
No historical failure was rerun or rescued. Real signed-in acceptance is next.
See the
[checker-format receipt](operations/CHECKER_FORMAT_RELEASE_2026-09-08.md) for authority, compatibility evidence and limits.

### Previous — September 8 article connection recovery live

Both existing production projects run `c71af50de829eef6f236991972332a8b7be81066`:
API `dpl_4FnWzhobqu6WwE94csCJ6xyMt9Z1`, Ready 15:44:52.521 UTC;
web `dpl_HsSPfWLbJeZrtJWPe7yPYNcSFrBC`, Ready 15:47:06.755 UTC.
The source fixes two nested-transaction stalls, bounded same-article recovery,
explicit retry after confirmed absent admission, and sanitized proxy diagnostics.
Michael's rejected advice to leave and return while waiting is removed.

Exact-source CI34245705648 passed 1,026 application tests, 320 pgTAP assertions,
seven disposable database proofs, lint/types/builds and schema lint. Live checks
at 15:47:43.874 UTC passed health/access/CORS, safe login returns, nonce CSP and
all three cron bindings and unchanged cadences. Existing apex/www/web/API addresses
are retained. No Auth/template, migration, secret, domain or budget changes.

The separate checker-format correction subsequently shipped under Michael's
explicit D50 approval, as recorded above. The earlier automatic review rejection
was respected with no checker edits before the stop; his direct “yes continue”
resolved it. CTO owns the single real first-session acceptance journey.
Signed-out browser verification is not fresh article/Ask or mail-delivery proof.
D49 invitations remains queued. D48 strict-six-digit sign-in remains blocked and
excluded: canonical HEAD contains a prepared patch and is NOT the live release.
Use the [article-recovery receipt](operations/ARTICLE_RECOVERY_RELEASE_2026-09-08.md) for exact scope, source and limits.

**Previous — v11.1 / D45 invitation configuration live:** source
`785861a3a25a8b7bdbe5ee1d0fafb60f91ffc7ee`; API
`dpl_Fxu7wuq3jEMr85PxLFa5pj5fMp5N`, Ready12:31:32.348 UTC September8;
web remains`dpl_FBkgbqz8NBLTnSVGBH9TmTYAhz5n` on the existing apex.
Migrations004/005 and reviewed Auth templates are applied. The explicitly approved
server-key transfer passed normal review with direct user authorization; API
Production invitation sending is enabled, with no web/Preview secret copy.
No approval remains pending. See the [single current release receipt](V11_1_RELEASE_CANDIDATE_2026-09-07.md)
for exact deployment/configuration checks, rollback constraints and the separate
unverified actual-mail and fresh signed-in journey limits. No QA email or paid
generation was commissioned, and D32 spending limits remain unchanged.

**Previous — D34/D35 v10 live:** both production apps ran
`27c9944eb268b2ecc8a1735ac79322089effa294`, with exact-source
[CI34128662833](https://github.com/michaelmcguiness/edison/actions/runs/34128662833)
passed (772 app tests/builds/types/lint,279 pgTAP assertions and DB integrations).
CoS applied the three D35-approved migrations through accepted normal review in
the task holding Michael's direct approval; CTO verified the hosted schema, exact
functions/grants/RLS/triggers/index and up-to-date migration state. The earlier
approval-channel hold is resolved; no further confirmation or schema application
is pending for this package.

API `dpl_GesKd8nJZi9d21ne4qrA7QLDxUmP` Ready16:10:58.747UTC, then web
`dpl_B6CTpmmg7M319mswhadVFL6yTVHQ` Ready16:13:13.790UTC. Exact source, retained
aliases/production targets, all three cron hosts/cadences, health/access and
$10 daily/$40 monthly controls passed at16:13:44.499UTC; CoS independently repeated
at16:17:46.702UTC. Actual live existing article/conversation, Ask/Back/settings/feed
reads verify the web/API connection, without new generation or content mutation.
D33 and unchanged P10 policy remain. No paid AI sample or private publication;
device/restore/quality limitations remain explicitly bounded in
[the final D34/D35 receipt](V10_READING_RELEASE_2026-09-07.md).

**Previous — D33 six titles per new batch live:** API source `7f7c6cf` pins six for new
requests and preserve historical four-count retries; semantic gates/actual count
and bodies-on-selection remain. All 707 local tests, types, lint and independent
24-test review pass. Exact-source [CI 34120463122](https://github.com/michaelmcguiness/edison/actions/runs/34120463122)
passed both jobs. Deployment `dpl_wzmxK43BDM6n1azkR17PYPEge12U` was Ready at
12:15:38 UTC; source/alias/target/schedules, health and access passed at 12:16:04 UTC.
No active work preceded rollout. D32's $10 rolling daily/$40 monthly default and
unchanged web were reverified. No paid sample, model, UI, quota or budget change;
provider output quality/count was not sampled for this release.

**Previous configuration rollout — D32, September 7:** API source `0b7611f`
(v2.5), rebuilt as `dpl_G7KPS1UV5VitkgA2fcHSDj24Bos9`, Ready at 11:58:43 UTC.
Only the Edison-wide rolling-24-hour admission ceiling changed from default $4
to explicit $10; exact configuration/deployment inclusion, source/alias/schedules,
health and access checks passed at 11:59:17 UTC. Monthly default $40, per-reader
allowances, concurrency, history and web remain unchanged. No source edit or paid
sample. This is an Edison ledger/admission ceiling, not provider-account billing
configuration. Reuse saved outputs and focused offline tests; do not treat the
ceiling as a spending target. See the [execution record](ON_DEMAND_RELEASE_2026-09-06.md).

**Previous — v2.5 code release, September 7:** API source
`0b7611f9e737fb76c982e426a7bb67d1f00e1f37` passed exact-source
[CI 34118061228](https://github.com/michaelmcguiness/edison/actions/runs/34118061228)
and deployed as `dpl_EGjCTJSkjoWsuzhBQteoRn88TWPq`, Ready at 11:49:31 UTC.
The predeploy aggregate found no active requests. Source identity, retained
public API alias/target and all three enabled schedules match; readiness health,
exact-apex CORS and all unauthenticated cron-denial checks passed at 11:50:43 UTC.
Web `6eb811b` is unchanged. The bounded checker-contract prevention preserves
actual evidence/excerpt identity, original envelopes and every substantive finding;
the sole repair and strict saved acceptance remain. All 699 local tests, both
typechecks, owned lint and independent focused review passed. No new paid sample
or measured provider-quality claim, historical recovery/reset, model, generation
prompt wording, budget, UI, configuration or migration change. The broader
generation recommendation remains proposed, not selected implementation.

**Previous — v2.4, September 7:** API `a38b535` has passed exact-source
[CI 34114058927](https://github.com/michaelmcguiness/edison/actions/runs/34114058927)
and hosted target/schedule/health/access checks. Web remains `6eb811b` at apex.
The short-complete-preview instruction is live with six/eight allowances and
unchanged other controls. The same QA loop retained an explicit preference after
reload and generated four complete concept-led ideas. A selected article published
and was read in the apex UI; a natural contextual question completed successfully.
Root's bounded direct assessment finds useful explanation, not a general-quality
estimate. After Michael confirmed browser ownership, the same article/latest
answer rendered after reload and reading-history reopen; Back restored its loop
and card, and closing Ask restored opener focus. No extra generation or bookmark
action. This is not a full conversation-history or mobile/scroll acceptance claim.
Two later owner-reported football failures are diagnosed separately; a bounded
prospective v2.5 checker-contract fix was prepared and subsequently deployed above:
699 local tests,
both typechecks, lint and independent focused review pass. The larger
single-pass generation recommendation remains proposed, not an active policy.

**Previous release, September 7 — D31:** API `1b05c1e` is live behind the existing
apex/web connection, with six rolling ideas batches per reader; web remains
`6eb811b`. Article allowance eight and all spending/concurrency/history controls
are unchanged. Exact-source [CI 34112267215](https://github.com/michaelmcguiness/edison/actions/runs/34112267215)
passed both jobs. Hosted identity/target, schedules, health, exact-apex access and
unauthenticated cron-denial checks passed. The existing session admitted its
fourth normal ideas batch; the selected article was withheld after its sole
repair/final check for an unfinished preview and missing explanatory payoff.
No published reading/Ask, adaptation or saved-return success is claimed. A
prospective short-complete-preview correction is prepared as v2.4, not yet live;
689 local tests, both typechecks, lint and independent focused review pass.
No new migration, service, configuration, secret, reset or extra repair is needed.

**Previous release, September 6:** D29/D30 reader-first is live on the existing apex
and retained web/API hosts (web `6eb811b`, API `029dc18` / prompt v2.3). Michael selected direct production
testing and doubled the article allowance to8; existing security/dollar limits
remain. First ideas output was withheld at source-discovery validation; a bounded
v2.2 official-source retrieval fix is live. One idea was recovered with unchanged
provider stages/usage after the display-whitespace fix. Its first article was
initially withheld at checker location binding. The correction and qualified
saved-request recovery are live and verified, including exact-source CI's real
database admission races and ordinary apex retry with unchanged original stages
and history. Its sole repair and final check completed; the revised article
remained withheld for missing explanatory payoff despite passing factual and
verification flags. Useful reading/Ask, preference adaptation and saved-reading
return remain unverified. Further paid sampling stopped. A bounded future v2.3
prompt refinement is now live after 680 local tests, both typechecks, owned lint
and exact-source CI's application/database jobs passed. No old queued/running
work was present before rollout. Health/access checks and retained apex state
pass; real-output improvement remains unmeasured. No further paid sample or
quota bypass occurred. See the controlling
[on-demand execution record](ON_DEMAND_RELEASE_2026-09-06.md). No new setup,
migration, invitation, secret entry or staging environment is needed.

**Historical September 5 release:** the authorized Pulse + loops v5 is deployed to the separate
Production web/API projects (web `a08c6a1`, API `a681331`). The subsequently
authorized apex cutover is complete: `https://edisonreader.com` and retained
`https://project-qlqve.vercel.app` serve the same live web deployment; www
preserves its 308 redirect to the apex. API remains at
`https://project-fjr95.vercel.app`, rebuilt with exact dual-origin CORS and
apex `WEB_APP_URL`, Ready at 23:10:44 UTC. Supabase has the apex Site URL and
exact callback/confirm allowlists for both web origins. Independent HTTPS,
redirect, callback, readiness and negative access checks pass. All 15 migrations, the
accepted
Sleep/History publication with verified real article/artwork bindings, and the
accepted private correction with protected audit are complete. Actual guest
reading, persistence and negative API security checks pass. The detailed,
controlling record is `docs/PULSE_RELEASE_2026-09-05.md`; the setup checkpoints
below are historical, not instructions to repeat migrations, invites or older
publication operators.

The bounded rendered keyboard/styling follow-up is live with the complete
236-application-test/165-pgTAP Node 22 gate green. Actual successor checks and
the separate Design review are recorded in the latest release evidence.

**Remaining gate:** authenticated owner reading/correction-note acceptance,
provider-dashboard
reconciliation and backup restore rehearsal remain. No owner credential,
invitation, database or TLS change is pending. No additional generation or
spending is part of this release verification.

**Current authorization, September 5:** the owner has authorized completing
the production release autonomously, including secure CLI access, reviewed
migrations, commit/push/promotion, deploying the existing web/API projects, and
inviting/testing only `mike@michaelmcguiness.com`. This supersedes earlier
step-by-step permission stops recorded below; they are historical, not current
blockers. Michael separately authorized putting the live app at
`edisonreader.com` too; the exact apex/www cutover is complete. Preserve the
retained temporary URL, old demo project and rollback deployments. No additional
domain, paid service or reader is authorized; never reveal saved credentials or
request secrets in chat.

**Earlier September 5 setup checkpoint:** candidate `4f774eb` was committed and pushed on
`codex/production-release-candidate` in draft PR #1; `main` is unmerged and
unprotected. [CI run 33987973278](https://github.com/michaelmcguiness/edison/actions/runs/33987973278)
passed lint, both typechecks, all 183 application tests (110 web plus 73 API),
both production builds, all 107 pgTAP assertions, and strict
application-schema lint on Node 22.23.2/pnpm 10.28.0.
The reviewed dry run and backup checkpoint preceded successful
application of all 13 migrations to Supabase project
`bcxxnntastmnormcmxbq`. A separate read-only production audit confirmed 24/24
expected tables, 21/21 expected RLS settings, 45 policies, 20 triggers, zero
invalid constraints, the expected Storage bucket, and the intended role/grant
boundaries. Auth was empty during that audit; it now contains exactly the one
invited owner described below. Restore testing remains outstanding.

Release-branch pushes now correctly target Preview; the current live-project
deployments were explicit Production rebuilds. Web deployment
`dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` of `d463d44` is live at
`https://project-qlqve.vercel.app`; it returned HTTP 200 with the expected
nonce-based CSP at 19:12:56Z. The apex `edisonreader.com` remained the older
isolated sample-data demo and returned HTTP 200 at 19:12:58Z.

The owner privately saved the actual Supabase Shared Transaction pooler URI;
no secret was read or exposed. Candidate `df3e712` shares one production TLS
policy between runtime and preflight: a URI without a TLS query option receives
explicit Postgres.js `ssl=require`, certificate-verifying requests remain at
least as strong, and insecure, duplicate, or ambiguous URL controls fail
closed. Explicit constructor precedence prevents `PGSSL` or URI aliases from
turning TLS off. Focused tests, independent security review, and a local TCP
mock confirmed that a server refusing SSL is rejected without a plaintext
startup fallback.

Production API deployment `dpl_GVJFA1vDQks3eBya4ArrXGpCHzFU` of `df3e712` was
Ready at 19:11:12Z (15:11:12 EDT). At 19:11:46Z, `/v1/health` returned HTTP 200
with configuration, database, and Supabase Auth all `ok` (request
`d641ae5d-26df-4974-b2cc-c1fcff4309ab`). Live checks confirmed no-auth
`/v1/me` is `401`, the configured-origin preflight is `204` with exact origin
reflection, an unapproved origin is `403` without reflection, and all six
missing/wrong-token checks across the three GET cron routes are
`401 invalid_cron_secret`. The unauthenticated public-starter read reached the
real public SQL role and returned the expected `404 starter_edition_unavailable`
because no starter is published. These checks preceded the valid owner-only
scheduler attempt recorded below.

Dedicated OpenAI project `edison-production`
(`proj_EFKsL4Yfs6pDFOzI4aGWThSf`) has an enforced $50 monthly cap and permits
only `gpt-5.6-terra` and `gpt-5.6-luna`; the owner also funded the API account
with $50 in credits. Its
`edison-api-production` service-account key was privately saved as API
Production `OPENAI_API_KEY`; no key was printed, stored, or read back. The owner
approved Responses-only scope, and the key is now saved as Restricted. Fresh
readback shows Responses (`/v1/responses`) Write and every other permission leaf
None. No further key approval is pending. The new project/key has returned one
successful article-generation response with a priced ledger row. The original default-project
key remains unread and unrevoked.

The hosted invitation template is saved and fresh-reload verified with exactly
one Dashboard-compatible `.SiteURL` `/auth/confirm` token-hash link. The
matching repository fix and release-boundary regression are included in pushed
checkpoint `d463d44`. The single authorized owner invitation was sent once at
approximately 19:15Z. Auth contains only owner
`5611f8fa-e0dd-460c-ae4d-5fb7dd7bfe83`, with
`invited_at=2026-09-05 19:15:11.951927+00`. Resend metadata reports message
`4fecf81e-099f-4144-acf6-4f26bf85ef51`, subject “Your Edison Reader
invitation,” as Delivered; no email body, callback token, or secret was read.
The owner redeemed the invitation: `email_confirmed_at` is
`2026-09-05 19:23:00.363055+00`, and `last_sign_in_at` is
`2026-09-05 19:23:00.372394+00`. Authenticated `/v1/me`, `/v1/feed`,
`/v1/editorial-direction`, and the initial profile PATCH returned 200 at
19:23:02Z. Read-only metadata confirms active membership,
`onboarding_complete=true`, and `America/New_York`. No repeat invitation is
needed. The owner's browser session is not available to the current browser
controls; rendered authenticated reading is not yet verified. Editorial has accepted
unpublished starter candidate v2 with exact
SHA-256 `aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50`
in an isolated worktree.

At 19:33:45.426Z, one Vercel dashboard **Run** invocation of the configured
daily scheduler returned 200 and created exactly three owner-only
`initial-edition` jobs. A precheck confirmed no other eligible reader. The
real Workflow generation steps each attempted four times and failed by
19:33:57Z; each database job records one workflow attempt. Workflow run
`wrun_01M1SH020WMSZV9R17KVGVB8K9` exposed the provider's HTTP 400:
`sources.items.properties.url` had unsupported `format: uri`, which is absent
from the provider's [supported string formats](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas). No article,
feed item, provider response ID, or usage-ledger row exists after those attempts;
the provider usage dashboard also showed no data at the initial check, not a
final billing reconciliation. The prepared fix retains runtime URL/citation
validation and increments the provider request-envelope version to 2. Local verification on Node 24.19 passed
all 183 application tests, both typechecks, and full ESLint; the three new
regressions inspect actual SDK schemas for all provider paths and retain
canonical URL/citation rejection. Independent review found no P0/P1/P2 issues,
and the candidate's Node 22 CI/build gate is now green as recorded above.

Production API deployment `dpl_12vWp1rShga96hTQ1yJzu8VTiRYh` of `4f774eb`
was Ready at 19:47:17Z; health at 19:47:37Z returned 200 with all checks `ok`
(request `e3f2ec39-c7b6-4c9a-8004-5434ca61114e`). The single retry scheduler
invocation at 19:48:11Z created only one fresh job under the unchanged quota.
Job `2bc18fba-142d-4be6-af9a-c1c18523809c` succeeded at 19:48:41.516Z;
Workflow `wrun_01M1SHTG1K70NG2D4NE3PC4QNS` is completed. One owner-only
article is published at rank 1 for September 5. Its unique priced ledger row
has model `gpt-5.6-terra`, 14,045 input tokens, 0 cached input, 2,047 output,
one web-search call, and estimated cost $0.062654. Provider response identity
is present; no secret was read. The provider usage dashboard still showed no
data at the first follow-up, so this is not a completed invoice reconciliation.

Preserve all three original failed jobs and the successful retry. All four
rolling daily job slots are consumed; do not delete history or reset the quota.
The result proves one real article, not a complete three-article edition.
At the earlier generation checkpoint, Editorial withheld the original output
for overconfident headline framing and false precision in source dates. The
later bounded correction was accepted and applied at 22:15:35 UTC with protected
before/after audit, as recorded in the Pulse release evidence. Do not repeat
the correction or treat it as a new provider generation. Full authenticated
rendered save/share/Q&A/direction and correction-note acceptance remains pending
because the owner's signed-in browser session is not available to current
browser controls.

Edison's client/server architecture is appropriate for a web product and later
iOS and Android clients. It is an API-first modular monolith: web and native
clients authenticate with Supabase, send a bearer access token to the versioned
Edison API, and never connect directly to Edison's application tables or to
OpenAI. The API owns authorization and Postgres access; durable Vercel
Workflows own slow AI work. This can scale a useful private alpha and an early
paid product without a rewrite or premature microservices.

The repository and hosted services are **deployed for an owner-only production
acceptance, not yet verified ready for external readers**. The apex and retained
temporary web, production schema, and healthy API are live. Owner sign-in and
one real article generation are verified. The two accepted public articles,
audited private correction and guest reading journey pass. Account-level
rendered acceptance, provider billing reconciliation and backup restoration
remain separate limitations; the apex is no longer the sample demo.

### Historical preparation record

The following provider/setup record preserves the earlier sequence. Statements
that the database or live projects were empty or undeployed describe those
earlier checkpoints and are superseded by the current checkpoint above.

The September 4 owner authorization initially permitted publishing the
candidate and creating temporary project shells; see `docs/DEPLOYMENT.md` for
the full authorization history, preparation record, and draft PR. The owner
then explicitly approved connecting
only the Edison repository to both Vercel projects and signing into Supabase
with their GitHub account. Both Git links and Supabase sign-in are complete.
The owner created Supabase project `bcxxnntastmnormcmxbq`
(`edison-production`) in the existing organization. It reports Healthy
in `us-east-1`, PostgreSQL `17.6.1.166`. It has no Edison migrations or verified
database connection. Its public URL and publishable key are configured in the
appropriate Production Vercel projects, but no live stack is deployed; all
launch gates below remain applicable.

The owner subsequently upgraded the Vercel team and Supabase organization;
refreshed dashboards confirm Pro on both. The owner saved `OPENAI_API_KEY`
directly in `edison-api`; metadata shows a Production-only Secret. Its value
and provider access have not been inspected or tested. Supabase now reports a
recent backup, but recovery remains unverified. The owner also reports creating
a Resend account via GitHub and completed sign-in. The owner then explicitly
approved `mail.edisonreader.com` sending-domain creation and its required
email-verification DNS records in Vercel. That setup is complete and Resend
reports Verified; see the exact record and website-safety evidence in
`docs/DEPLOYMENT.md`. Receiving is disabled and tracking is unconfigured.
The owner has since enabled Supabase custom SMTP and entered the Resend key
privately. A fresh settings page confirms the expected sender, host, and port,
and the owner has corrected its Username to `resend`. An independent fresh
page on September 5 confirms the correction is saved and SMTP remains enabled.
No password value was read or changed by the agent, key permissions verified,
or delivery tested.

On September 5, the owner authorized the remaining non-secret web/API
connection settings, temporary origins, initial quotas, owner-only allowlists,
hosted Auth restrictions, and invite template. Those settings and both
Production build guards are saved and verified as described under Vercel and
Supabase setup. This did not authorize or perform database/cron secret entry,
migration, deployment, invitation, push, branch, or domain changes.

The owner later approved private Vercel credential entry, supplied the database
URL, and explicitly authorized generating the cron secret. The agent generated
32 cryptographically random bytes as 64 hexadecimal characters and filled only
the cron field without printing or reading back secret values. The owner saved
the form. A subsequent metadata-only check confirms `DATABASE_URL` and
`CRON_SECRET` as Production-only Secrets alongside the existing OpenAI Secret.
This does not establish valid connection details or provider access, and does
not authorize local migration credentials, schema changes, deployment, or invites.

Historical preparation audit limits (superseded where noted above):

- The authorized preparation created two undeployed Vercel project shells and
  their Git/build settings, plus the owner-created empty Supabase project. The
  later billing upgrades and OpenAI secret entry were performed by the owner.
  The subsequently authorized email-domain setup added only the three required
  Resend DNS records. Supabase SMTP was configured by the owner. The September 5
  authorization added only the recorded non-secret Production/Preview Config,
  build guards, Auth restrictions, and invitation template.
- No secret value was requested in chat, displayed, read back, or tested by
  the agent. The cron secret was generated and entered only after the owner's
  explicit request. For saved Secrets, only names, types, and scopes were read;
  the authorized Config values are non-secret metadata.
- Fresh September 5 project overviews show No Production Deployment and No
  Preview Deployments for both live Vercel projects. A read-only attempt to open
  Supabase's Direct Connection string was blocked before execution to avoid
  credential exposure; no connection value or pooler hostname was read,
  inferred, or stored, and no workaround was attempted.
- The hosted database exists but has no Edison schema. Candidate `52aa993` passed
  all 106 pgTAP assertions and clean migration application in disposable
  Supabase/PostgreSQL 17 on
  [GitHub CI](https://github.com/michaelmcguiness/edison/actions/runs/33916066769).
  Schema lint and the hosted dry-run/backup/restore gates remain outstanding.
- The nonce-based CSP and responsive sample UI passed a local production-build
  browser smoke test; connected Supabase login and API flows still need testing
  in the isolated live projects.
- Fifteen focused authentication/configuration tests pass. Hosted Auth has global
  signup and anonymous access off, the email provider on, an ECC P-256 signing
  key, the temporary Site URL plus exactly two callback URLs, and the saved
  invitation subject/template. Confirm-email is on. No invite was sent; the
  dashboard preview has an unresolved logo and the web project is undeployed.
  Actual delivery and asset loading remain a release gate.
- The API readiness check has been extended for the new
  editorial-direction/public-starter schema and roles, but that check still
  needs execution against a clean migrated database.
- Current Supabase Auth restricts direct grants from the project `postgres`
  role. The final migration grants `edison_api` an inheritable membership in
  built-in `authenticated` with `ADMIN FALSE` and `SET FALSE`. The role's
  default `NOINHERIT` remains intact; this explicit edge supplies Auth helper
  access, not new role-switch/delegation rights. Tests deny raw Auth-user
  access, privileged role membership, and reverse inheritance by browser
  roles. This relies on
  [PostgreSQL 17 role-membership semantics](https://www.postgresql.org/docs/17/role-membership.html);
  verify the hosted project's major version before migration.
- AI article Q&A and legacy feed commands now use database-atomic rolling
  quotas, durable request fingerprints and exact provider-input snapshots,
  bounded worker leases, and stable provider idempotency keys. Observed invalid
  responses become terminal only after their identity and usage are durably
  ledgered; an accounting failure preserves the frozen request and retry
  capacity. The migrations and
  concurrent-call behavior still need verification against a clean Postgres
  instance and the configured production OpenAI project before launch.
- News generation now freezes the exact provider input per job and direction
  revision, applies the complete bounded set of persistent/current-edition
  instructions, and rejects stale output before publication while preserving
  observed spend. Daily rotation and the authenticated feed now use one exact
  server-owned edition UUID/date. These paths still need real-Postgres race and
  provider-idempotency verification before launch.

## Production topology

Use one region and three independently configured Vercel projects from the same
public GitHub repository:

| Surface | Current host | Responsibility | Credentials |
| --- | --- | --- | --- |
| Retained old demo | `edison-lake-phi.vercel.app` | Credential-free sample | None |
| Live web | `edisonreader.com`, retained `project-qlqve.vercel.app`; www redirects to apex | Next.js UI, Supabase Auth session, server-rendered public shares | Only Supabase publishable values and API URL |
| Live API/workflows | `project-fjr95.vercel.app` | `/v1`, authorization, Postgres, OpenAI, workflows, cron | Pooled DB, OpenAI project key, cron secret |
| Supabase | Provider project URL | Auth, canonical Postgres, reserved Storage | Publishable key on clients; admin key only in a local invitation session |

The owner selected the apex as the live app. Its two existing bindings moved
from `edison` to `edison-app`; the demo's environment was not converted. Every
alias on one Vercel project receives that project's production build and
environment. Do not attach speculative app/API subdomains as a follow-up.

For native apps later:

- Ship only the Supabase URL, Supabase publishable key, and Edison API URL.
- Store the Supabase session in Keychain/Keystore and send its access token as
  `Authorization: Bearer ...` to `/v1`.
- Do not ship a database URL, service-role/secret key, OpenAI key, or cron
  secret. CORS is a browser control, not native-app authorization.
- Add exact universal-link/custom-scheme Auth callbacks when the native clients
  exist. The web callbacks remain unchanged.

## Must-pass release gates

All gates below are blocking before inviting anyone whose data matters.

| Gate | Required evidence |
| --- | --- |
| Clean source release | Reviewed commit on protected `main`; Node 22; frozen install; lint, both typechecks, all tests, and both production builds pass from a clean checkout |
| Database safety | Clean `supabase db reset`; all pgTAP tests pass; schema lint passes; linked `supabase db push --dry-run` reviewed; migration backup checkpoint prepared |
| Complete readiness | `/v1/health` checks every required schema generation, including News edition date/item identity and its index, editorial directions, public starter editions, `edison_api`, `edison_public`, and the narrow public-share function without underlying table grants |
| Browser security | Nonce CSP and all security headers pass in the production build; Supabase login, images/fonts, API fetches, and share pages work without CSP violations |
| AI cost integrity | Generation jobs retain their atomic daily quota and exact request snapshots; Q&A and feed-command reservation tests pass against real Postgres; parallel duplicates produce one provider response; ambiguous retries recover against the original frozen input; stale and invalid observed generation responses reconcile to `private.usage_ledger`; an unexpected returned model identity is recorded as `pricing_status = 'unpriced'` with `cost_microusd = NULL`, stops publication, and makes the estimated total unknown rather than pretending the call cost zero |
| Abuse controls | Application-level reader quotas are authoritative; Vercel WAF rules cover expensive POST routes; Supabase Auth signup/anonymous access stay disabled |
| Auth/email | Exact Site/redirect URLs, asymmetric JWT key, custom SMTP, tested invitation, tested allowlist, active membership, admin membership revocation, revoke procedure |
| Data recovery | Supabase Pro daily backups active, encrypted logical checkpoint taken, and a restore into a disposable project has been timed and verified |
| Operations | Health and web synthetic checks, error alerting, cron/job-age alerts, provider budget alerts/hard caps, named on-call owner |
| User trust | A short privacy notice explains email/preferences/content processing and OpenAI retention; feedback/support and manual export/deletion procedures exist |
| Release acceptance | Owner account completes sign-in, first-visit timezone activation, finite-edition generation, citation review, save, share/revoke, editorial direction, and admin/cron smoke tests |

Before public self-service signup, also add automated account export/deletion,
moderation/abuse review, broader load testing, and formal legal review. A small
invite-only alpha can use documented manual procedures for export/deletion.

## What can stay free while building

The code, local Supabase stack, local database tests, credential-free Vercel
previews, and a non-commercial demo can use free/Hobby plans while building.
The owner has now upgraded the actual Vercel team and Supabase organization
to Pro; the comparisons below explain the production requirements, not their
current subscription status.

Do not treat those plans as the real-user production configuration:

- Vercel Hobby is for personal/non-commercial use and permits a cron job only
  once per day. Edison declares two five-minute reconcilers and one hourly
  scheduler, so the live API requires Vercel Pro. See
  [Hobby policy](https://vercel.com/docs/plans/hobby) and
  [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Supabase Free can pause for inactivity and does not provide the automated
  backups required here. It is acceptable for development or a disposable
  owner-only smoke project, not the source of truth for external readers. See
  [Supabase pricing](https://supabase.com/pricing),
  [database backups](https://supabase.com/docs/guides/platform/backups), and
  [production guidance](https://supabase.com/docs/guides/deployment/going-into-prod).
- Supabase's default Auth mailer is a non-production service: it is limited,
  best-effort, and sends only to authorized team addresses. External invitations
  require custom SMTP. See
  [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- ChatGPT subscriptions do not fund API calls. The live API requires a separate
  OpenAI API project with billing and a server-side project/service-account key.

### Initial monthly budget

| Item | Initial choice | Planning amount |
| --- | --- | ---: |
| Vercel | Pro, one deploying owner; web/API/demo projects on the same team | About $20 plus usage; includes the plan's usage credit |
| Supabase | Pro, one production project in US East | Starts around $25 |
| SMTP | Low-volume transactional provider selected by owner | Reserve $0-$20 |
| OpenAI API | Production project, usage alerts and a suggested $75-$100 hard limit | $75-$100 maximum target |
| Vercel overage | Low alerts and an owner-approved spend-management action | Reserve $20-$30 |

This places the initial target around $140-$195 per month. Validate actual
provider invoices rather than relying on this estimate. Vercel Pro currently
starts at $20 per deploying seat with a usage credit; see
[Vercel Pro](https://vercel.com/docs/plans/pro-plan) and
[pricing](https://vercel.com/pricing).

Do not initially buy:

- Supabase point-in-time recovery: seven-day PITR is currently an additional
  roughly $100/month. Daily Pro backups plus an off-site logical checkpoint are
  proportionate for the first alpha. Add PITR when a 24-hour recovery point is
  unacceptable. See
  [Supabase PITR](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).
- Vercel Advanced Deployment Protection for production custom domains: it is
  currently a $150/month Pro add-on. Application authentication is Edison's
  private-alpha boundary; standard protection should remain enabled for preview
  and unique deployment URLs. See
  [Deployment Protection](https://vercel.com/docs/deployment-protection).
- A Supabase custom domain: it adds cost without improving this architecture,
  and `api.edisonreader.com` belongs to the Edison API. See
  [Supabase custom domains](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains).
- A permanent staging stack. Add it when multiple developers ship regularly,
  hosted schema changes are frequent, or production traffic makes an owner-only
  canary too risky.

OpenAI cost deserves an explicit first-week review. As of the verification
date, `gpt-5.6-terra` is $2/M input tokens, $0.20/M cached input, and $12/M
output; `gpt-5.6-luna` is $0.20/M input, $0.02/M cached input, and $1.20/M
output. Web search on the reasoning models is $10/1,000 calls plus applicable
tokens. Edison currently allows up to 12 searches and 12,000 output tokens for
one generated article, so the tool component alone can reach $0.12 and the
output ceiling adds $0.144 before input tokens. Real usage may be lower, but
three daily articles per reader compounds quickly. Reconcile Edison's usage
ledger with the [official pricing page](https://developers.openai.com/api/docs/pricing)
daily during the alpha.

## Vercel setup

The owner/team is already Pro. Keep one deploying seat unless another person
genuinely needs deployment access.
Enable MFA for every account that can change deployments or environment values.

### Git and release controls

1. Keep the GitHub repository public only if the owner still wants the product
   source open. Public source never changes the credential rules.
2. Enable branch protection for `main`: require a pull request or explicit
   owner review, require the repository check, block force-pushes/deletion, and
   enable available secret scanning/push protection.
3. Configure `main` as Vercel's production branch. Pull requests create previews
   but previews receive no Supabase, database, OpenAI, SMTP, cron, or live API
   values.
4. Require this clean-checkout command before production promotion:

   ```sh
   corepack pnpm install --frozen-lockfile
   corepack pnpm check
   ```

5. Record commit SHA, migration set, both deployment IDs, smoke-test result,
   and the person who approved the release.

### Existing demo project

Keep the current `edison` project as documented in `docs/DEPLOYMENT.md`:

- Root directory: `.`
- Node.js: `22.x`
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm build:web`
- Production and Preview: `EDISON_DEMO_MODE=true` and
  `ENABLE_EXPERIMENTAL_COREPACK=1`
- No live-service credentials

### Live web project (`edison-app`)

| Setting | Value |
| --- | --- |
| Git source | `michaelmcguiness/edison`, production branch `main` |
| Root directory | `.` |
| Framework | Next.js |
| Node.js | `22.x` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | Production-only preflight guard, then `pnpm build:web` |
| Output | Next.js default |
| Assigned Production domains | `edisonreader.com`, retained `project-qlqve.vercel.app`; www 308 to apex |

Production-only environment:

| Name | Required value/purpose |
| --- | --- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
| `EDISON_DEMO_MODE` | Explicitly `false` |
| `NEXT_PUBLIC_API_URL` | Saved as `https://project-fjr95.vercel.app/v1`; replace only during an approved domain cutover |
| `NEXT_PUBLIC_SUPABASE_URL` | Saved as `https://bcxxnntastmnormcmxbq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Saved matching production publishable key; never record its literal value here or use a secret/service-role key |

`NEXT_PUBLIC_*` values are embedded into the browser build and are public by
design. The web project must not contain `DATABASE_URL`, `DIRECT_URL`, any
OpenAI key, any Supabase secret/service-role key, or `CRON_SECRET`—even as an
unreferenced variable.

Preview environment: only `EDISON_DEMO_MODE=true` and
`ENABLE_EXPERIMENTAL_COREPACK=1`. Preview is a UI/build check, never a client of
production Supabase or the production API.

Dashboard metadata confirms exactly those five Production Config values and
two Preview Config values. Development was left unchanged. The saved Build
Command is:

```sh
if [ "$VERCEL_ENV" = production ]; then node scripts/check-production-env.mjs web || exit 1; fi; pnpm build:web
```

Explicit Production deployment `dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` currently
serves `d463d44` at the assigned domain. It was Ready at 13:34:56 EDT and passed
HTTP plus nonce-based CSP smoke checks at 17:38:44Z. The saved production branch
remains `main`, and release-branch pushes now correctly create Preview
deployments.

### Live API project (`edison-api`)

| Setting | Value |
| --- | --- |
| Git source | Same repository and production branch |
| Root directory | `apps/api` |
| Include source files outside root | Enabled; required for workspace packages, root lockfile, and patches |
| Framework | Next.js |
| Node.js | `22.x` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | Production-only preflight guard, then `pnpm build` |
| Function region | `iad1`, paired with a US East Supabase project |
| Output | Next.js default |
| Assigned Production domain | `project-fjr95.vercel.app` |

Production-only environment:

| Name | Purpose / launch value |
| --- | --- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
| `DATABASE_URL` | Owner-saved Production Secret using the actual Supabase Shared Transaction pooler URI; value unread. Runtime explicitly enforces TLS when its query omits a TLS option; never use the Direct or Dedicated endpoint |
| `SUPABASE_URL` | Saved as `https://bcxxnntastmnormcmxbq.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Saved matching publishable key used for Auth health; literal value omitted; not an admin key |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |
| `OPENAI_API_KEY` | Privately transferred `edison-api-production` service-account key for dedicated project `proj_EFKsL4Yfs6pDFOzI4aGWThSf`; saved Restricted to Responses Write only, value unread, provider access untested |
| `OPENAI_ARTICLE_MODEL` | Explicit approved and priced article model; currently `gpt-5.6-terra` (other families fail readiness and accounting closed) |
| `OPENAI_UTILITY_MODEL` | Explicit approved and priced utility model; currently `gpt-5.6-luna` (other families fail readiness and accounting closed) |
| `OPENAI_MAX_DAILY_GENERATIONS` | Saved as `4` for the tiny alpha; must be at least the daily target |
| `OPENAI_MAX_DAILY_ARTICLE_QUESTIONS` | Required rolling-24-hour per-reader quota, saved as `20` |
| `OPENAI_MAX_DAILY_FEED_COMMANDS` | Required rolling-24-hour per-reader quota, saved as `10` |
| `OPENAI_WEB_SEARCH_COST_MICROUSD` | Saved accounting estimate `10000`; recheck current pricing before deployment |
| `WEB_APP_URL` | Saved `https://edisonreader.com`, no trailing slash |
| `CORS_ALLOWED_ORIGINS` | Saved `https://edisonreader.com,https://project-qlqve.vercel.app`, never `*` |
| `CRON_SECRET` | Verified saved Production Secret; generated on explicit request using 32 random bytes encoded as 64 hex characters; no value printed or read back |
| `EDISON_ALLOWED_EMAILS` | Saved owner-only list `mike@michaelmcguiness.com`; authentication/readiness fail closed if missing or invalid |
| `EDISON_ADMIN_EMAILS` | Saved as the same owner email; every admin must also be allowed |
| `EDISON_DAILY_EDITION_LOCAL_HOUR` | Saved as `5` |
| `EDISON_DAILY_EDITION_TARGET` | Saved as `3` |
| `EDISON_DAILY_EDITION_BATCH_SIZE` | Saved as `25`; this controls catch-up work per run, not total spend |

The API runtime must not contain `DIRECT_URL`, `SUPABASE_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_ADMIN_KEY`, `EDISON_DEV_USER_ID`, or
`EDISON_DEV_USER_EMAIL`. `SUPABASE_SECRET_KEY` is needed only by a local,
short-lived invitation command; `DIRECT_URL` is needed only by migration and
backup operators.

Preview API deployments get no production credentials. A preview build may
exist, but its health endpoint should remain not-ready and its workflows should
not process real jobs.

Dashboard metadata confirms 17 Production Config values matching the table,
plus three Production Secrets: `DATABASE_URL`, `CRON_SECRET`, and
`OPENAI_API_KEY`. No saved Secret value was read. API Preview
has exactly one Config value, `ENABLE_EXPERIMENTAL_COREPACK=1`, and no live
values. The saved API Build Command is:

```sh
if [ "$VERCEL_ENV" = production ]; then node ../../scripts/check-production-env.mjs api || exit 1; fi; pnpm build
```

The API build and runtime readiness now pass. Production deployment
`dpl_GVJFA1vDQks3eBya4ArrXGpCHzFU` of `df3e712` was Ready at 19:11:12Z. At
19:11:46Z, health returned `200` with configuration, database, and Supabase Auth
all `ok` (request `d641ae5d-26df-4974-b2cc-c1fcff4309ab`). The Shared
Transaction pooler URI remains unread; the runtime's explicit TLS policy makes
another owner database edit unnecessary. Vercel CLI 59.11.7 was available only
through an ephemeral invocation; login did not complete and the pending attempt
was canceled.

### Credential-safe preflight

The repository includes `scripts/check-production-env.mjs`. It checks names,
presence, exact public origins, credential separation, pooler/TLS settings,
private-alpha lists, and safe scheduling ranges. It never loads a file
automatically and never prints secret, database, or email values.

The production database client and build preflight share one TLS policy. A
provider-issued URI without TLS query parameters is safe to copy in full: the
client explicitly requires encrypted transport instead of relying on a manual
`?sslmode=require` suffix. Explicit certificate-verifying modes stay stronger;
insecure, conflicting, duplicate, or unsupported TLS options fail closed.
The explicit driver option prevents URL or `PGSSL` precedence from disabling
encryption. The default `require` mode encrypts transport but does not verify
the server certificate; prefer `verify-full` when the runtime trust store
supports the provider's certificate chain. Local development is unchanged.

In Supabase's current Connect dialog, choose **Direct → Transaction pooler →
Use IPv4 connection**. That last switch selects the Shared Pooler; leaving it
off selects the Dedicated Pooler on this paid project. Copy the complete
generated URI because both hostname and username differ. No paid IPv4 add-on
is needed for the Shared Pooler.

On September 5, a local audit of the exact saved public web configuration passed
with zero warnings. No hosted secrets were loaded. The latest hosted API build
preflight and runtime health both pass; configuration, database, and Supabase
Auth are all `ok`. The corrected provider request has now returned one real
article and a priced usage row; provider-dashboard reconciliation and full
reading/editorial acceptance remain outstanding.

Run it against one project's environment at a time before production promotion:

```sh
node scripts/check-production-env.mjs web
node scripts/check-production-env.mjs api
```

An exit code of `1` means release-blocking configuration; `2` means invalid
usage. Warnings do not fail the run. Do not merge web and API environment files
just to run the checker. If a temporary local environment file is needed, keep
it outside the repository, restrict its permissions, and remove it immediately
afterward.

Vercel Build Commands can also gate only production builds while preserving
credential-free previews:

```sh
# Web project
if [ "$VERCEL_ENV" = production ]; then node scripts/check-production-env.mjs web || exit 1; fi; pnpm build:web

# API project (Root Directory is apps/api)
if [ "$VERCEL_ENV" = production ]; then node ../../scripts/check-production-env.mjs api || exit 1; fi; pnpm build
```

## Supabase production setup

Use the existing US East `edison-production` project. It is already Pro and now
contains all 13 repository migrations. Do not replay or rewrite the applied
chain; any future schema change must be additive.

### Database

Current operator-access status: Supabase CLI 2.116.0 is authenticated through
the official browser login and linked to `bcxxnntastmnormcmxbq`. Its temporary
database login role completed the linked dry run and production migration
without requesting a database password. CI run `33976398848` passed all 107
pgTAP assertions and strict lint for `public`, `private`, and
`edison_public_api`. The subsequent read-only hosted audit confirmed every
expected migration, table/RLS setting, role boundary, and Storage object. Do
not copy the saved Vercel runtime secret into a migration command or ask for it
in chat.

The procedure below is the required pattern for future migrations; the current
13-migration release has already completed steps 3 through 6.

1. Enable MFA on the owner account and restrict project membership.
2. Store the database password in the password manager. Rotate it if it has ever
   appeared in chat, logs, shell history, source, or a preview environment.
3. Start a clean local Supabase stack and run, from the repository root:

   ```sh
   pnpm supabase:start
   pnpm supabase:reset
   pnpm exec supabase test db
   pnpm exec supabase db lint
   ```

   Confirm the clean reset applies every earlier base migration and then, in
   order, this production-readiness sequence:
   `20260904182546_editorial_directions_and_public_starter.sql`,
   `20260904184023_ai_request_cost_controls.sql`,
   `20260904184140_news_edition_lifecycle.sql`,
   `20260904185513_ai_request_snapshots.sql`,
   `20260904190546_explicit_usage_pricing_status.sql`,
   `20260904192144_preference_bounds.sql`, and
   `20260904195000_public_article_share_boundary.sql`.

4. Confirm pgTAP covers cross-user denial, inactive membership, public-share
   sanitization, public-share table denial and active-owner lookup, the
   `edison_api` role, editorial directions, public starter editions, and the
   `edison_public` role.
5. Link the CLI to the exact production project, then inspect without applying:

   ```sh
   pnpm exec supabase db push --linked --dry-run
   ```

6. Compare the dry run with the reviewed migration set and verify the backup
   checkpoint before applying a future additive migration.
7. Use the transaction pooler for `DATABASE_URL` because Vercel Functions are
   serverless; port `6543`, prepared statements disabled by the checked-in DB
   client, and TLS required. Prefer certificate verification supported by the
   runtime. Keep the direct connection outside Vercel. See
   [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)
   and [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).
8. Enable SSL enforcement only after confirming every operator and runtime uses
   TLS; it can briefly restart connections.
9. Confirm RLS is enabled on every protected table and enforced when the API
   transactionally switches from the pooler user to the non-owner, non-login
   `edison_api` or `edison_public` role. The migrations intentionally do not use
   `FORCE ROW LEVEL SECURITY`; browser clients receive no core-table grants.

Do not add a database network allowlist that silently blocks Vercel's dynamic
egress. Revisit static egress/network restrictions if the selected Vercel
offering supplies stable addresses; application roles, TLS, RLS, rotated
credentials, and minimum runtime credentials remain mandatory either way.

### Auth and private-alpha access

The hosted project matches the invite-only Auth intent at both approved web
origins; the cutover values were verified after a fresh dashboard reload:

- Site URL: exactly `https://edisonreader.com`.
- Production redirect allowlist:
  `https://edisonreader.com/auth/callback`,
  `https://edisonreader.com/auth/confirm`,
  `https://project-qlqve.vercel.app/auth/callback` and
  `https://project-qlqve.vercel.app/auth/confirm` only. Do not add a production
  wildcard or Vercel preview wildcard. See
  [redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).
- Global self-service signup and anonymous sign-in are disabled. The email
  provider remains enabled so invited users can redeem invitations; this does
  not reopen signup while the global gate is off. Locally,
  `[auth].enable_signup=false` supplies the deny, while
  `[auth.email].enable_signup=true` maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED` and
  must remain true for email invitations.
- The current asymmetric signing key is already ECC P-256; no rotation was
  needed. The API verifies public JWKS and never needs the signing secret.
- Keep OTP expiry at no more than 3,600 seconds and review Auth rate limits.
- Invite subject “Your Edison Reader invitation” and the hosted template are
  saved and fresh-reload verified with exactly one CTA. Because Dashboard
  invitations cannot set
  `redirectTo`, the rendered CTA is exactly
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite`;
  confirm-email is enabled. The single owner invitation was delivered and redeemed
  successfully as recorded above. The matching repository
  correction and regression test are included in pushed checkpoint `d463d44`
  and its green CI run. The dashboard preview has an
  unresolved logo; owner-side asset loading remains unverified.
- Custom SMTP is saved on the Edison mail domain. Disable provider click
  tracking/link rewriting, then use the current owner-only release authorization
  to verify delivery, expiry, and one-use behavior with the owner's mailbox.
  SPF and DKIM are already verified; optional DMARC remains a future decision.

Before each invitation, add the normalized email to `EDISON_ALLOWED_EMAILS`.
Add it to `EDISON_ADMIN_EMAILS` only if the owner explicitly approves that
reader as an administrator; ordinary readers must not receive admin access.
API database health and owner invitation redemption now pass. For future
separately approved invitations, use Auth > Users > Send invitation in the
Dashboard after confirming the hosted `.SiteURL` callback;
that flow does not require retrieving or exposing an admin key. The existing
local operator script remains available for a separately controlled session,
but is not required for this owner invitation.

Never put the Supabase secret key in either Vercel project. The database trigger
creates the profile and active alpha membership for a newly invited Auth user;
therefore keeping all signup paths disabled is critical. To remove a reader,
revoke the alpha membership immediately, remove the allowlist entry, revoke
Auth sessions (and delete or ban the Auth user as appropriate), and follow the
documented export/deletion request.

Invited profiles intentionally begin with `onboarding_complete = false`, so the
scheduler cannot create a UTC-placeholder edition before knowing the reader's
local date. On the first authenticated browser visit, the non-blocking `/v1/me`
PATCH stores the browser's IANA timezone and activates scheduling. Do not
backfill this flag or change its default to true; readers can use the public
starter immediately while that first-visit activation completes.

## OpenAI production setup

API billing is separate from ChatGPT. Use an Edison-specific OpenAI API project,
not a personal reusable key and not an organization Admin API key.

Current state: project `edison-production`
(`proj_EFKsL4Yfs6pDFOzI4aGWThSf`) has an enforced $50 monthly cap and allows
only `gpt-5.6-terra` and `gpt-5.6-luna`. Its
`edison-api-production` service-account key is saved privately in the API
Production environment. Its saved Restricted policy grants Responses
(`/v1/responses`) Write and leaves every other permission leaf at None. No
additional key approval is needed. A corrected request returned one successful
generation response and priced ledger row; provider-dashboard reconciliation
is still pending. The old default-project
Edison key remains unread and unrevoked.

1. Give the owner organization/project access with MFA. Create a production
   project and a project-scoped service account.
2. Restrict the key to only the API capabilities Edison uses and allow only the
   reviewed article/utility models. Put the resulting key only in the API
   project's Production environment.
3. Start with provider rate/token limits close to the private-alpha workload.
   Retain the current enforced $50 monthly project cap and add useful lower
   alerts if the dashboard supports them. Hard limits return `429` and can
   overshoot slightly because of
   in-flight work, so Edison must fail gracefully and the provider cap is the
   last guard, not the first. See
   [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
   and [production practices](https://developers.openai.com/api/docs/guides/production-best-practices).
4. Confirm the code still sends `store: false`, structured outputs, bounded
   tokens/tool calls, and a stable pseudonymous safety identifier. Verify the
   two required rolling-quota values and exercise duplicate + abandoned-lease
   recovery against the frozen request snapshot. Confirm an observed invalid
   response is terminal only after being charged once, while an injected
   accounting failure keeps the original request retryable without consuming
   provider-attempt capacity. For article generation, also verify
   that mutable reader context cannot replace a durable request at the same
   direction revision, stale output is charged but never published, and an
   unexpected returned model identity is ledgered with
   `pricing_status = 'unpriced'` and `cost_microusd = NULL`, makes the aggregate
   estimated cost unknown, and stops publication for manual invoice
   reconciliation. It must never masquerade as a zero-cost response. Never log
   prompts, article bodies, tokens, or preference text.
5. Capture provider request IDs in error telemetry without request bodies so a
   failed call can be investigated. Rotate the project key after any suspected
   exposure.
6. Compare provider usage with `private.usage_ledger` daily for the first week.

OpenAI API data is not used to train models unless the organization opts in,
but default abuse-monitoring logs may retain content for up to 30 days even when
`store: false`. Explain this in the alpha privacy notice and tell readers not to
submit highly sensitive personal data. Zero Data Retention requires separate
eligibility and is not assumed. See
[OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
and [API authentication guidance](https://developers.openai.com/api/reference/overview).

## Cron, Workflow, CORS, and firewall

The API's checked-in `apps/api/vercel.json` is authoritative:

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/internal/cron/reconcile-feed-commands` | Every 5 minutes | Restart safely persisted feed commands |
| `/internal/cron/reconcile-generation-jobs` | Every 5 minutes | Restart safely persisted generation jobs |
| `/internal/cron/schedule-daily-editions` | Minute 5 of every UTC hour | Catch up readers whose configured local delivery hour has arrived |

Vercel sends `Authorization: Bearer <CRON_SECRET>` to cron routes when the
secret is configured. Verify that missing and wrong credentials return `401`,
and inspect the first real invocation of each route. Cron is UTC; daily delivery
logic performs the timezone calculation. Each scheduled slot receives at most
two independently identified jobs; after two failures the edition remains
visibly partial until the next local-date rotation. The current feed always
filters by both edition UUID and date and never paginates into history. Keep IDs
rather than article bodies in Workflow state, and treat Postgres job rows as
authoritative.

Set `CORS_ALLOWED_ORIGINS` to exact live browser origins only. No wildcard, no
path, no trailing slash, and no preview origins. Requests with no `Origin` are
allowed intentionally for native/server clients, but they still need a valid
bearer token and active membership. CORS is not authentication.

Before opening the alpha, configure Vercel WAF rate-limit rules for:

- `POST /v1/generation-jobs`
- `POST /v1/articles/*/conversation`
- `POST /v1/feed/commands`
- editorial-direction write routes and admin publication routes

Begin in log/count mode, verify legitimate behavior, then block at conservative
IP rates. IP limits protect the edge but do not replace atomic per-user database
quotas, because native users may share IPs and attackers can rotate them. See
[Vercel WAF custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules)
and [WAF usage/pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing).

## Backup and rollback

### Before every schema release

1. Confirm Supabase reports a recent successful automatic backup.
2. Make an encrypted logical dump through the direct connection and store it in
   owner-controlled off-site storage with tested access. Never commit it.
3. Restore that dump into a disposable project and record duration and result.
4. Record an initial recovery objective of at most 24 hours of data loss and a
   four-hour restore target; these are targets, not promises, until the drill
   proves them.
5. Remember that Supabase database backups do not include Storage objects. Add
   a separate object backup before Edison enables uploads.

### Application rollback

- Keep the previous known-good web and API deployment IDs. Roll back both when
  their contract changed together; otherwise roll back only the failed surface.
- A Vercel instant rollback does **not** restore or change active cron schedules.
  Compare the active cron list with the target commit and update/disable it
  manually. See
  [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- Verify `/v1/health`, login, one authenticated read, CORS, and all cron routes
  after rollback.
- Do not roll the app back across a destructive/incompatible database change.
  Use additive expand/contract migrations and prefer a reviewed forward-fix.

### Database/provider incident

- Pause invitations and AI generation first. Preserve evidence and request IDs.
- For a bad migration, choose a forward migration unless data corruption
  requires a restore. A restore causes downtime and may lose writes after the
  recovery point.
- For OpenAI cost/abuse, disable the production key or generation feature,
  rotate the key, retain usage-ledger evidence, and redeploy only after fixing
  the application-level control.
- For a credential incident, rotate the narrow credential first, invalidate
  affected sessions if needed, then audit Git history, Vercel environments,
  provider logs, and access lists. Never copy the exposed value into a ticket.

## Monitoring and cost controls

Vercel Observability is available on all plans, but current log retention is
short (approximately one day on Pro). Configure an external error tracker/log
destination before external readers depend on Edison; retain only operational
metadata and redact emails, bearer tokens, prompts, preferences, articles, and
database URLs. See [Vercel Observability](https://vercel.com/docs/observability)
and [platform limits](https://vercel.com/docs/limits).

Minimum alerts:

| Signal | Initial action threshold |
| --- | --- |
| `GET https://project-fjr95.vercel.app/v1/health` | Two consecutive non-200 responses |
| Web login/public page | Two consecutive synthetic failures |
| Five-minute reconcilers | No successful invocation for 15 minutes |
| Hourly edition scheduler | No successful invocation for 90 minutes |
| Jobs/commands | Any repeated failure, or queued/running item older than 15 minutes |
| Auth/SMTP | Spike in rejected tokens, invite failure, bounce, or provider limit |
| Supabase | Storage/connection/CPU warning or failed backup |
| OpenAI | 50%, 75%, and 90% of monthly hard limit; unexpected model or token mix |
| Vercel | Low incremental usage alerts and an owner-reviewed pause action before the total monthly budget is exceeded |

Use `/v1/admin/jobs` only from an allowlisted admin session. It contains reader
identifiers and failure detail and must never become public monitoring output.
Correlate failures with Edison's `X-Request-ID` and the provider request ID.
Configure [Vercel Spend Management](https://vercel.com/docs/spend-management),
but decide explicitly whether the action should pause both projects: pausing is
a cost stop and a product outage.

## Release sequence

1. Preserve the completed source, CI, migration, production metadata audit,
   temporary web/API deployments, healthy readiness, public-role read, and
   negative auth/CORS/cron evidence through the completed Pulse/apex cutover;
   do not rerun
   applied migrations as though production were still empty.
2. Owner invitation redemption, active membership, authenticated `/v1/me`,
   timezone persistence, and scheduler activation pass. Do not resend the invite.
3. The corrected OpenAI request and its priced ledger row pass; reconcile the
   usage with the dedicated project dashboard when available.
4. Run one complete finite News edition. Verify exact UUID/date filtering,
   deterministic slot order, searched citations, usage ledger, job state,
   bounded failed-slot retry, save, feedback, Q&A idempotency, share
   sanitization, and share revocation.
5. The accepted Sleep/History starter publication and audited private correction
   are complete. Preserve their immutable identities. Do not publish obsolete
   starter v2 or reapply earlier correction operators.
6. Verify editorial-direction create/update/delete/undo concurrency, the
   50-per-section cap, future-generation effect, and stale-output guard. Verify
   the current and archived public starter responses contain only their
   documented sanitized schema.
7. Verify admin allowlist, non-admin denial, revoked-admin denial with a still
   valid token, CORS denial from another browser origin, unauthenticated denial,
   and cron denial/success behavior.
8. Inspect desktop/mobile layout, CSP console, server logs, Workflow telemetry,
   Supabase logs, owner-side email rendering/callback, OpenAI usage, and all
   configured alerts.
9. Merge the reviewed candidate and protect `main` after temporary-alpha
   acceptance. The branch is currently unmerged and unprotected.
10. The owner-approved apex cutover and its independent security/redirect/TLS
    checks are complete. Retain the temporary web URL and www-to-apex redirect.
    No app/API subdomain attachment is pending.
11. Finish owner/operational acceptance before requesting authorization for
    additional readers. The private allowlist remains the single approved owner;
    a public reading URL does not authorize broader account access.

## Ownership for remaining release work

No immediate owner credential or invitation action is pending. Owner sign-in
works; CTO resolved the generation compatibility defect and is verifying the
remaining reading flow. The owner also
retains decisions on:

- future plan upgrades or higher billing/spend ceilings;
- privacy/support wording and acceptable alpha risk;
- any further domain attachment or invitation beyond the already approved owner;
- incident/on-call ownership.

The September 5 authorization already covers finishing the existing release,
including the single approved owner's acceptance test. Do not ask for another
generic approval. The separate apex instruction authorized only the completed
named cutover. Neither authorization covers new purchases, additional readers
or further website-domain changes.

## Reference checklist

- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Vercel production checklist](https://vercel.com/docs/production-checklist)
- [Vercel Functions pricing](https://vercel.com/docs/functions/usage-and-pricing)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [OpenAI production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [OpenAI safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
