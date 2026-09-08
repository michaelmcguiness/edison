# Accounted Fast processing — off-by-default candidate

September 8, 2026 · Owner: CTO · Branch: `codex/accounted-fast-processing`

## Scope and state

Chief of Staff assigned this bounded follow-up after the generation-delivery
release at runtime `3a526fad880bdb389b0560805ce96957898986cf`, documented in
`7f35e17e5cb73703bfd04babe7313b9acd1be498`. Michael prioritizes substantially
faster loop and article generation. This candidate is **implemented and locally
verified, not deployed or enabled**. Exact-source CI remains to be attached.

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
in existing stage usage/output JSON. No schema migration is required.

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

## Verification and limits

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
  budget/pin denial. Its local-only safety check passes; actual execution awaits
  the existing CI database job. No new migration or workflow step was added.

The first local build hit the known generated-cache hash failure. Moving only
generated `.next` to a recoverable temporary directory cleared it; the next run
needed ordinary network permission for existing Google Fonts downloads. With that
permission the unchanged build passed. No dependency/build configuration changed.

No provider request, new QA identity/mail, live database mutation, secret transfer,
setting activation or paid benchmark occurred. Ordinary real generation speed,
provider availability and whether the premium improves this workload remain
unmeasured. No Terra/Luna speed multiplier is asserted.

## Next bounded step

Close exact-source accounting/replay CI and review before enabling production use.
Then, only with an existing supported authenticated session and budget room, use
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
