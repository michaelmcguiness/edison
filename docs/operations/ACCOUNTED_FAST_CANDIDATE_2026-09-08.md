# Accounted Fast processing — off-by-default candidate

September 8, 2026 · Owner: CTO · Branch: `codex/accounted-fast-processing`

## Scope and state

**Later review correction — hosted migration remains unapproved:** CoS independently found
that a late response after its stage becomes uncertain retains the numeric usage
bill but not actual-tier evidence. A proposed metadata-only stage update was
withdrawn before commit/deployment: the existing terminal-stage trigger rejects
all uncertain-row updates, which would also roll back the new usage receipt.
CoS authorized preparing an additive nullable observed-usage field on the existing
append-only billing ledger instead, preserving the stage trigger. The local
correction and migration below are prepared; neither has been deployed/applied to
production. The successful27f663a CI below predates this newly identified gap and
does not establish the correction. The corrected local suite passes1,129 tests,
both typechecks and full lint; exact-source database CI is next. Models, checks,
live3a526fa and Fast off remain.

Chief of Staff assigned this bounded follow-up after the generation-delivery
release at runtime `3a526fad880bdb389b0560805ce96957898986cf`, documented in
`7f35e17e5cb73703bfd04babe7313b9acd1be498`. Michael prioritizes substantially
faster loop and article generation. This candidate is **implemented and locally
verified, not deployed or enabled**. The initial, superseded runtime's CI and
source review closed on `27f663ab8a3c9d468f58ff09f646ad70b82748db`; the additive
correction below has separately closed source review and awaits its own CI.

There is no reader-facing change, streaming implementation, model switch,
prompt/schema/checker-policy change, additional review stage, or new service.
Six offered articles, on-demand selected bodies, existing Auth, tool limits,
durable work and original kind reservations remain. P10/P19/P20/P21 and the
separate strict-six Auth/invitation candidates are not included.

## Prospective request contract

`EDISON_DEMAND_FAST_ENABLED` is API-only and off by default. Exactly `true`
selects a new policy only at fresh v2 ideas/article/question insertion, after
idempotency and canonical saved-article lookups. Feedback and v1 jobs are excluded.
No client parameter selects a tier. The sample environment explicitly says false;
no live environment or OpenAI project setting was changed.

The optional `providerPolicy` is pinned in the request snapshot, mirrored in
progress, and included in every frozen provider-stage fingerprint:

```json
{
  "version": "edison-demand-provider-policy-v1",
  "requestedServiceTier": "priority",
  "pricingVersion": "openai-terra-luna-2026-09-08-v1"
}
```

Only this policy adds `service_tier: "priority"` to the existing provider request.
The strict contract also understands explicit `default`; current admission does
not select that value. Off/absent preserves historical wire bytes and identities.
Changing the flag never changes admitted jobs. Own null/undefined, extra/partial/
unknown fields, ineligible kinds and snapshot/progress/stage mismatches stop.
The stage store independently checks the locked parent before reservation/replay,
then again after recording incurred usage before releasing output.

## Exact cost and failure behavior

Official [Fast documentation](https://developers.openai.com/api/docs/guides/fast-mode)
and [pricing](https://developers.openai.com/api/docs/pricing), checked September8,
support per-request `priority` and report actual `priority`, or `default` on
downgrade. This candidate retains that actual tier before output validation and
in stage usage/output JSON. The later late-uncertain correction also records
whitelisted usage atomically in the billing ledger via the additive migration below.

The frozen short-context rates per million input/cached-input/output tokens are
Terra Standard $2/$0.20/$12 and Fast $4/$0.40/$24; Luna Standard
$0.20/$0.02/$1.20 and Fast $0.40/$0.04/$2.40. The multiplier applies before one
final microdollar rounding. Search charges remain separately configured and are
not doubled. Both initial and research-adjusted stage reservations use the pin.
Actual returned tier, not requested tier, selects settlement rates.

The [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) documentation
places long-context pricing above272K input tokens. This bounded pricing version
rejects that band, unknown models/tiers/versions and regional variants as unpriced;
it does not extrapolate short-context prices. Current bounded request estimates
remain below that threshold. Future prices require a new pinned version.

Missing/malformed/empty actual tier on a pinned job preserves observed usage as
unpriced, with no returned reading. Fresh legacy responses with an explicit
non-default/unknown tier also cannot silently receive standard pricing. Legacy
cached bills are immutable and never repriced. Refused/incomplete/invalid JSON
responses still retain incurred usage. Unpriced spend blocks new admission under
the existing global rule; it is not assigned an invented numeric bill. Unknown
transport remains uncertain, retaining the existing hold and prohibiting another
automatic provider call.

Kind holds remain ideas $0.60, article $1.20, question $0.25 and feedback $0.10;
live dollar limits remain $10 daily/$40 monthly. A stage that cannot fit its
Fast-priced estimate in remaining reservation stops before dispatch. No larger
hold, automatic cheaper-tier retry or extra call is introduced.

## Initial Fast candidate verification and limits (before additive correction)

- Full application suite:1,120 passed, zero failures/skips at final integrated
  runtime freeze. Both typechecks, clean lint and both production builds pass.
- Independent provider/pricing review:67 focused tests; eight exact comparisons
  of actual old `7f35e17` and current absent-policy stage/wire/estimated-reservation
  JSON for v1 and v2 pass. No remaining material finding.
- Independent server-policy review:21 policy/runner tests and108 actual-helper
  JSON roundtrip checks across three kinds, policies and checkpoints pass.
- Actual production-store code under synthetic database I/O:18 settlement groups
  pass, including all seven earlier projection/access cases. Covers exact Fast
  and fallback bills, frozen policy/hold denial, raw cached replay, post-call
  parent mismatch, unpriced usage, refusals and uncertainty. These injected tests
  are not PostgreSQL locking/atomicity proof.
- Reviewer found an empty-tier normalization gap before release; empty provider
  metadata now becomes null and reaches the unpriced accounting path. Regression
  tests preserve usage before withholding the response.
- The existing guarded disposable-Postgres script now covers the new policy and
  actual-tier JSON roundtrip, both costs, exact replay, unpriced accounting and
  budget/pin denial. Its local-only safety check and actual CI execution pass.
  That initial candidate added no migration or workflow step. The later additive
  correction adds one migration and pgTAP suite, using the existing CI workflow.

The first local build hit the known generated-cache hash failure. Moving only
generated `.next` to a recoverable temporary directory cleared it; the next run
needed ordinary network permission for existing Google Fonts downloads. With that
permission the unchanged build passed. No dependency/build configuration changed.

No provider request, new QA identity/mail, live database mutation, secret transfer,
setting activation or paid benchmark occurred. Ordinary real generation speed,
provider availability and whether the premium improves this workload remain
unmeasured. No Terra/Luna speed multiplier is asserted.

## Initial exact-source CI — passed, not correction proof or a live rollout

[PR5](https://github.com/michaelmcguiness/edison/pull/5) contains exact candidate
`27f663ab8a3c9d468f58ff09f646ad70b82748db`, above7f35e17.
[CI34260587306](https://github.com/michaelmcguiness/edison/actions/runs/34260587306)
passed both jobs and all29 steps on that source. Application completed
18:05:43 UTC; database completed18:05:32 UTC. Results:797 web +323 API tests,
zero failures/skips;320 pgTAP assertions across12 files; all seven disposable
database service proofs; schema lint, both types/builds and clean lint.

The new Fast PostgreSQL proof specifically passed at18:03:51.854 UTC: frozen
policy and actual-tier JSON roundtrip, priority/default costs, unchanged search
fees, durable unpriced accounting, exact replay and pre-call pin/budget denial.
All provider responses were local stubs; no hosted project or real AI was used.
Production remains the already verified delivery runtime3a526fa on both projects.
This candidate's receipt closeout is documentation only, not an activation.

## Late-uncertain correction and deployment compatibility

CoS authorized offline schema preparation, not hosted DDL or Fast activation.
`supabase/migrations/20260908000100_demand_observed_usage.sql` adds exactly one
nullable JSONB column, `private.demand_usage.observed_usage`, without a default,
backfill or data rewrite. A bounded-object constraint permits only observed
metering keys and binds its response ID, model and token counts to the same row.
Migration SHA256: `d2a1f2b03e4570c9bb3b99db7da47fdf3d50106020766b02f2d6147a8f71ad80`.

The server inserts `usageSchema.parse(result.usage)` in the same transaction and
same INSERT as the original numeric bill. This strips arbitrary extra fields;
no prompt, article or provider output is copied into the accounting field.
Existing response uniqueness and insert-only worker access preserve the first
bill. No grants, triggers, lease/status/output behavior or paid retries change.
Uncertain stages remain byte-for-byte unchanged; their late priority/default/
unknown-tier evidence belongs to the new billing row, not an attempted stage edit.

The focused actual-store regression was run against immutable27f663a and failed:
the correct22,764 microdollar bill existed but observed usage was absent. It passes
against the new runtime. This is synthetic I/O evidence, not a PostgreSQL claim.
The corrected full application suite passes1,129 tests with zero failures/skips;
both typechecks, full lint and diff checks pass. Its51 focused settlement/stage
tests and58 authored pgTAP assertions cover late priority/default/unknown/null/
missing/refused responses, duplicate and legacy receipts, forbidden content
stripping, immutable uncertainty, unchanged privileges and no second provider call.
Real-Postgres proof is prepared in the existing guarded script and new pgTAP file;
its exact-source CI outcome will be attached after execution. The pgTAP suite's
final SHA256 is `12c3c5ca6961e85de2371e2a4120e3d6023dca0816f3e3e7897814355f9a7c88`.

Required deployment order, only after explicit hosted migration approval:

1. Apply this exact additive migration to the existing production database and
   verify the nullable/no-default column, constraint and unchanged privileges/
   terminal-stage protections. Do not apply unrelated pending migrations.
   **The current `/v1/health` endpoint does not inspect this column.** Successful
   health alone is not compatibility evidence; explicit catalog readback of the
   new column and constraint must succeed before runtime rollout.
2. Deploy the exact reviewed API candidate with Fast still off. New code names
   the new column, so deploying it before the migration is incompatible even off.
   Web has no changed interface and does not need a new deployment for this fix.
3. Verify ordinary health/access and the unchanged API schedules. Only then
   perform a separately bounded supported-session Fast activation/timing step.

Old runtime remains compatible with the added nullable column: old INSERTs omit
it and old rows remain NULL; no historical evidence is fabricated. An application
rollback leaves the additive column/data in place, never drops or backfills it.
After any Fast jobs have been admitted, keep a tier-aware runtime until those
jobs complete or are safely quiescent; reverting to pre-policy3a526fa would not
preserve their frozen behavior. Disabling the flag changes future admission only.

## Next bounded step

The late-uncertain correction needs exact-source database CI/review and explicit
hosted migration approval first. Only with an existing supported authenticated
session and budget room, the bounded activation step can then use
at most the still-unused one loop batch plus one article allowance, estimated
total at most $0.50. Capture useful-card/first-readable/full-completion timing,
actual returned tier, stage breakdown and charged cost. No new QA account, mail,
reader-data edit or repeated provider suite. Without that session, return this
off-by-default candidate with the missing measurement stated; do not activate a
project-wide default. Turning the flag off affects new admission only: pinned
running jobs must retain their original policy through completion/recovery.

The existing live browser was rechecked during this candidate and still shows
the ordinary sign-in screen with a blank email field. No sign-in email was sent.
Thus the supported-session requirement for paid timing is currently unavailable;
the one-batch/one-article allowance remains unused and this candidate stays off.
