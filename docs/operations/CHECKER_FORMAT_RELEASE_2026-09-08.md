# Article and Ask checker-format release — September 8, 2026

Owner: CTO. Status: implemented and independently reviewed; exact-source CI and
API-only production rollout pending. Baseline: receipt-only `9b1f08f1d900d0ad17f9b4396552db336a1956cc`
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
  separate fresh admissions assert the new marker. Actual database execution is
  pending exact-source CI, not established by source review.
- Local builds exposed isolated dependency/runtime failures: the web's compiled
  webpack hash code threw, and API compiled and typechecked but Next's global-error
  prerender reported an uninitialized work store. These are not passing builds;
  clean locked-dependency CI must pass both builds before rollout.
- Independent ancestry/path review confirms D48 is absent; actual Auth controls,
  tests, templates and settings remain at the existing compatible live behavior.

## Release boundary and remaining evidence

Deploy only the existing API project after exact-source CI succeeds through
ordinary approval review. Web remains the existing c71 recovery deployment;
retain current apex/API aliases, schedules, environment and spending controls.
This candidate has not yet been deployed. No real provider call, email, reader
content mutation, quota reset, rescue or live database operation was used in
these checks. Synthetic checks do not prove real model quality or lower latency.

After release, CTO owns the one agreed real owner journey: normal sign-in, one
chosen loop/six offers, selected article, Ask, explicit direction/new set, and
return to retained article/conversation. Do not duplicate that with another paid
suite. The currently available browser is signed out; no email was requested.
