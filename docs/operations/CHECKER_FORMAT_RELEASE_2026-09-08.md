# Article and Ask checker-format release — September 8, 2026

Owner: CTO. Status: independently reviewed, exact-source CI verified, and live
on the existing production API. Source: `bd528f59145f0878351d665f444d945c8ebdaf31`.
Baseline: receipt-only `9b1f08f1d900d0ad17f9b4396552db336a1956cc`
above live recovery source `c71af50de829eef6f236991972332a8b7be81066`.

## Selected scope and authority

Michael's explicit D50 “yes continue” answers the specific question authorizing
implementation and deployment for articles and follow-up answers. The previous
automatic-review rejection was respected: agents stopped and no checker edits
existed before his subsequent approval. This release does not authorize removing
independent factual review, streaming, onboarding redesign, D48 strict-six-digit
Auth, new email, historical article rescue, or changes to budgets/models/limits.

The separate [article connection-recovery release](ARTICLE_RECOVERY_RELEASE_2026-09-08.md)
remains the web baseline. Its later malformed-checker incident motivates this
prospective format correction; that failed request and its receipts are unchanged.

## Implementation

- New article and Ask admission pins `edison-reader-first-v2.5-check-v1` in the
  immutable server snapshot, after idempotency/canonical lookups. Progress retains
  the same marker. Absent means the exact legacy contract; null, unknown,
  inapplicable, missing-on-one-side or changed markers stop before work.
- Only the new checker prompt and provider schema change. A root object contains
  `check`, whose nested union separates pass, repair and insufficient-evidence.
  Passing requires all six existing assessments true and an empty findings array.
  Optional refinements are omitted by the producer, not dropped after receipt.
  Material/verification concerns and failed assessments still prevent a pass.
- Non-pass schemas retain their existing flags, findings, limits and zero minimum
  findings. Initial insufficient-evidence still uses only the existing sole
  repair. No new request/stage, automatic retry, research allowance or token cap.
- Strict parsing and exact evidence/excerpt/fingerprint binding precede lossless
  envelope unwrapping. Raw provider envelopes and observed usage remain retained.
  Article and Ask publication both recheck the selected contract, including when
  resuming a saved ready state. Legacy valid nonmaterial passes remain supported.
- The global v2.5 identity, ideas contract, writer/repair instructions and schemas,
  prose inputs, artifact fingerprints, stage keys and legacy replay stay unchanged.
  Historical saved-check recovery excludes any new or malformed checker marker.
  No migration, authentication, reader-facing interface or provider configuration
  change is included.

## Verification before publication

- All **1,053** application tests pass, no skips: 27 more than the live recovery
  baseline. Both standalone TypeScript checks, whole-repository ESLint and diff
  checks pass. The initial combined test run lacked the isolated checkout's
  dependency-resolution path; rerunning with that existing path passes all tests.
- Independent review ran 108 focused tests successfully and found no actionable
  P1/P2. It compared the actual frozen baseline AI source with the candidate:
  all six legacy writer/article-check/article-repair/answer/answer-check/answer-repair
  complete durable snapshots and fingerprints are identical. Selecting check-v1
  changes only the two checker identities, never the six prose inputs or the four
  writer/repair identities. Literal legacy prompt/schema/request hashes are also
  asserted by regression tests.
- Constructed article/Ask cases exercise legacy/current × pass/repair/insufficient
  evidence through JSON checkpoint round trips, empty non-pass findings, exact
  same stage keys, rejected marker tampering before retrieval/provider/publication,
  and saved-ready checks without another provider call or deleted findings.
- The disposable-database recovery fixture is deliberately inserted with a
  historical marker-free snapshot; no immutable snapshot is rewritten and no
  trigger disabled. Same-key/canonical admission reads retain its old snapshot;
  separate fresh admissions assert the new marker. The exact-source disposable
  database execution subsequently passed in CI, including admission races.
- Local builds exposed isolated dependency/runtime failures: the web's compiled
  webpack hash code threw, and API compiled and typechecked but Next's global-error
  prerender reported an uninitialized work store. Read-only diagnosis proved two
  physical Next copies with unequal work-store instances. They were converged on
  the existing pnpm copy; the duplicate copy and both generated output directories
  were moved to a recoverable temporary backup. Root/API/workflow now resolve the
  same physical package and work store. Both sequential production builds pass,
  with ordinary network access for the web's existing fonts. No source, lockfile
  or framework configuration changed. Clean CI remains an independent release gate.
- Independent ancestry/path review confirms D48 is absent; actual Auth controls,
  tests, templates and settings remain at the existing compatible live behavior.

## Release boundary and remaining evidence

Exact-source [CI34249541600](https://github.com/michaelmcguiness/edison/actions/runs/34249541600)
passed every step: application completed 16:14:36 UTC and database 16:15:24 UTC.
It verified 769 web + 284 API tests (1,053; zero failures/skips), 320 pgTAP assertions
across 12 files, all seven disposable database service proofs, both production
builds, standalone types, lint and migrated-schema lint. The bounded
[PR3](https://github.com/michaelmcguiness/edison/pull/3) base is exactly 9b1f08f;
CoS independently verified that base/head and closed its eight-point source
compatibility review without another paid suite or database/provider call.

Ordinary approval review accepted the API-only production deployment of that exact
source. Deployment `dpl_3TUAXZC4E5poyaf61sF1jZVyb8zm` is READY in Production at
**16:17:56.361 UTC**. Both deployment Git source fields and the live project target
match bd528f5. Its host is `edison-d6cok4wg7-mike-michaelmcguis-projects.vercel.app`;
the existing `project-fjr95.vercel.app` API alias is retained. All three enabled
cron definitions bind to that host and deployment: both reconciliation paths
remain every five minutes, daily-edition scheduling remains minute 5 hourly.
Web remains `dpl_HsSPfWLbJeZrtJWPe7yPYNcSFrBC` / c71af50; no web redeployment,
domain attachment, schedule-cadence, configuration, budget or Auth edit occurred.

Credential-free live smoke checks at **16:19:40.202 UTC** all passed:

- API health 200, configuration/database/Auth OK (1.430s for this sample).
- API access/invitations and web invitation proxy 401 missing_token; web workspace
  401 invitation_required. These verify anonymous boundaries, not member success.
- Login 200 with nonce/strict-dynamic CSP and private/no-store; apex safely returns
  307 to login and www returns 308 to apex.
- Exact-apex CORS preflight 204 with its allow-origin; bad-origin preflight 403
  without one. All three unauthenticated cron reads return 401 invalid_cron_secret,
  invoking no scheduled job.
- The existing browser renders the normal sign-in screen and retained prior article
  return path. Its email field is blank. No sign-in message was requested.

No real provider call, email, reader
content mutation, quota reset, rescue or live database operation was used in
these checks. Synthetic checks do not prove real model quality or lower latency.

After release, CTO owns the one agreed real owner journey: normal sign-in, one
chosen loop/six offers, selected article, Ask, explicit direction/new set, and
return to retained article/conversation. Do not duplicate that with another paid
suite. The currently available browser is signed out; no email was requested.
The historical failed article is not rerun or rescued by this release. Select a
fresh article within the existing allowance for the single post-release journey.
Later documentation-only commits are receipts, not additional deployed builds.
