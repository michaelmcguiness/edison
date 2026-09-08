# Generation latency — bounded delivery increment

September 8, 2026 · Owner: CTO · Candidate: `codex/generation-latency`

## Scope and status

Michael prioritizes faster loops and articles. Chief of Staff assigned concrete
latency corrections within the approved reader and current blocking publication
policy. This increment starts from clean `4fe134662b216200afbdd14fe382e5d5c16a0981`,
above live API runtime `bd528f59145f0878351d665f444d945c8ebdaf31`.
Implemented, independently reviewed and **live** on both existing production
projects from `3a526fad880bdb389b0560805ce96957898986cf`. This receipt's final
update is documentation only; it does not identify a later runtime release.

- Poll a selected known article's result immediately, receiving published body
  and request state together. Remove the separate selected-idea metadata poll
  and the metadata-to-body waterfall. Keep bounded unknown-admission recovery.
- Keep off-window loop polls alive across unrelated workspace updates; fence
  them by workspace and pending request identities.
- Omit the unused loop-count transaction for verified accounts. Historical
  guests still use the same complete owner-group count and gate.
- During provider settlement, select only the prior stage IDs, frozen snapshots
  and usage needed by accounting. Retain raw output storage and full replay reads.
- Restore the already-selected D34 **Edit loop** label. No editor layout or
  save/refresh behavior change is included.

Six offered articles, selected-body generation, personalization, citations,
factual acceptance, model/prompt versions, durable work, spending caps, Auth,
invitations and deployment destinations remain unchanged. P10/P19 progressive
reading and off-path review are separate product decisions; P20/P21 are excluded.

## What this does and does not establish

The old known-request path waits for metadata before requesting the body. The
new path can deliver an already-published body in its first result response,
without that initial timer or serial metadata request. Pending work still takes
time to generate; this is not token streaming or a model-speed improvement.

The account shortcut removes one complete reader transaction containing identity
setup, role setup and COUNT. The settlement projection reduces transferred data,
not query count. Neither has a measured production latency saving.

Existing incident timing is diagnostic, not a production average: one failed
article took 69.546 seconds, with recorded write/check/repair/recheck intervals
of 26.697/14.190/13.444/11.198 seconds. Those intervals include stage overhead,
not only provider computation. The normal durable workflow advances immediately;
there is no source-proven happy-path cron wait to remove.

## Local verification

Independent API reviews found no accounting, authorization or replay regression.
Focused tests execute the real service functions with synthetic I/O, real query
expressions and public contract validation; they are not PostgreSQL measurements.
The old settlement query fails the new projection assertions; the new one passes.

A local actual Next app with the existing synthetic member/API service at
390×844 showed a queued article opening its exact completed body automatically.
Fixture counters after that journey: zero admissions, one completion, zero provider
calls and zero database calls. This is not real Auth, email or generated-content
evidence. Back restored focus to the article card; **Edit loop** opened the
unchanged editor and Escape restored focus to that button, without saving edits.

The final mounted-reader suite passes 33 tests, including all 19 prior ambiguous
admission cases. A fixed 200ms synthetic result roundtrip displays a ready body
at 200ms with one result GET, no metadata GET and no POST. Pending result starts
remain serial at 0/2100/4200ms for 100ms roundtrips despite unrelated snapshots.
An off-window loop read starts at 1500ms despite workspace changes every400ms
and accepts its slow completion response. These are deterministic fixture times,
not provider or production measurements.

Review caught and fixed a read-exhaustion regression: known pending requests now
offer the existing **Load article again** action after bounded read failures.
It reads the same request only. A later authoritative success can also wake an
exhausted transient read; identity/validation failures cannot auto-resume.
Final independent client review ran 80 focused tests with no material finding.
CoS separately closed source review at the exact final hashes below.

- Reader SHA256: `8d1ada8e5f51131ac8ceaaf8ef1f28d57978611f84ff89e5332369e2303075e3`.
- Mounted tests SHA256: `c73080642b07e5bd334813279482b5acadad67c36ed8eb5aead497352da51ae2`.
- Full final application run: **1,078 passed, zero failures/skips** (783 web +295 API).
- Both typechecks, lint and both production builds passed.

The first local web build failed in generated framework cache hashing; moving
only generated output to a recoverable temporary backup and rerunning passed.
Local development also needed the existing pnpm helper directory on NODE_PATH.
No source, dependency, lockfile, build configuration or production setting was
changed for those local-environment issues. The browser's cleanup of its stopped
localhost error page was URL-policy blocked; no workaround was attempted.

## Exact-source CI and production verification

[PR4](https://github.com/michaelmcguiness/edison/pull/4) contains the reviewed
runtime increment above parent `4fe134662b216200afbdd14fe382e5d5c16a0981`.
[CI34256980244](https://github.com/michaelmcguiness/edison/actions/runs/34256980244)
passed on exact `3a526fad880bdb389b0560805ce96957898986cf`: 783 web and295 API
tests, 320 pgTAP assertions across12 files, seven disposable service-database
proofs, schema lint, application lint, both typechecks and production builds.
Both jobs and all29 steps succeeded; database job completed17:29:07 UTC.
Chief of Staff independently verified the exact source and successful CI.

- API `dpl_D1uSkD5rV3Cu5snw5u6RYX1f26qV`, READY17:31:25.851 UTC;
  host `edison-67dzuxppo-mike-michaelmcguis-projects.vercel.app`.
- Web `dpl_5pXE8cMFCnqspuxDkB71KcgZeAoj`, READY17:33:04.250 UTC;
  host `edison-7v5p7fnvn-mike-michaelmcguis-projects.vercel.app`.
- Both deployment source fields match exact3a526fa, target Production and the
  existing project IDs. Apex/www, `project-qlqve.vercel.app`, API
  `project-fjr95.vercel.app` and existing project aliases are retained.
- All three enabled API schedules now bind to the new API deployment/host.
  Reconcile-feed and reconcile-generation remain every five minutes; daily-edition
  scheduling remains minute5 hourly. `disabledAt` remains null.

At17:36:54.432 UTC the public read-only smoke passed: health200 with configuration,
database and Auth checks OK; login200 with nonce/strict-dynamic CSP and private
no-store; apex307 to login and www308 to apex; private access/invitations/workspace
401; apex-origin CORS204 and foreign-origin403; all three unauthenticated cron
paths401. No authenticated cron was invoked. CoS independently verified both
live source identities/aliases, all schedule bindings and public login/health.

No production migration, Auth/template, secret, domain, tier or budget setting
changed. Existing $10 daily/$40 monthly caps remain. No signed-in production
article/loop timing, actual email delivery or model-speed claim is established.
The bounded live generation allowance is unused because an existing supported
authenticated session was unavailable; no new QA identity or mail was created.

## Prospective Fast processing follow-up — not enabled

An accounted per-request Fast option can preserve the current models and review
policy. Official [Fast documentation](https://developers.openai.com/api/docs/guides/fast-mode)
and [pricing](https://developers.openai.com/api/docs/pricing), retrieved September8,
list short-context Fast input/cached-input/output rates per million tokens:
Terra $4/$0.40/$24; Luna $0.40/$0.04/$2.40. These token rates are twice Standard;
tool charges remain separate. No Terra/Luna speed multiplier was established.

Do not change the project-wide tier: omitted tiers inherit that setting and would
affect legacy requests. A follow-up must pin requested tier/pricing at admission
and in stage identities, retain the actual returned tier before output validation,
and price reservations and settlement accordingly. GPT-5.6 reports `priority`
for Fast and `default` when downgraded. Preserve absent-field legacy replay,
unknown-tier accounting holds, failed-response usage, tool caps and dollar limits.
Existing JSON metadata can support this; a new ledger column is not demonstrably
necessary. Offline tests should precede any bounded opt-in timing measurement.

No provider benchmark, new QA account, live content edit, setting change or
extra spend was used for this increment.
