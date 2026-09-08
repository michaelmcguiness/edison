# Prospective discovery URL rebinding — article reliability correction

September 8, 2026 · Owner: CTO · Editorial scope agreed with Chief of Staff

## Observed failure and limits

Michael's current authenticated article displayed a terminal failure. Exact
read-only metadata for idea `644d0482-13fc-4d1e-810d-d15b69187807` identifies
request `c77169ae-d5cb-42d2-93a4-f99393190160`, admitted at18:30:28.146110 UTC and
failed at18:31:14.857555 UTC (46.711 seconds). It was a new post-release request,
using `edison-reader-first-v2.5-check-v1`, not an old pre-D50 failure.

Only the writer stage ran:45.286 seconds, one priced bill of79,510 microUSD
($0.079510),19,107 input tokens and2,608 output tokens. Three research tool calls
included one billed search; provenance retained12 consulted and2 opened URLs,
with no URL-citation annotations. The prior evidence packet contained no sources
or passages. No checker or repair stage ran, and no article was published.

The writer returned one research source, three discovery passages, one displayed
source key and ten body citations referencing that source. Its declared URL was
not an exact member of the observed provenance set. A consulted URL had identical
origin/path and no fragment; both versions contained only one `trk` query key,
with differing values. The host was exactly `www.nobelprize.org`. Strict
`discovery()` rejects this mismatch before independent acquisition/checking.
The diagnosis used field names, counts, booleans and timing—not private prose.
It does not establish that the source was fabricated, that its claims were
accurate, or that the page is retrievable. A public base-page read returned403;
it is not evidence of page equivalence or an observed production retrieval result.

## Approved bounded correction

Chief of Staff/Editorial authorized implementation and ordinary reviewed API
release under the existing production authority. Scope is only new article
write/sole-repair discovery hints. Match exact provenance unchanged first;
otherwise permit only an unambiguous tracking-only relationship on exact HTTPS
`www.nobelprize.org`, with identical raw prefix/path and fragment and exactly one
literal `trk=` parameter on each side. No other keys, duplicate/encoded keys,
broad query stripping, path decoding or guessed canonical URLs.

Rebind only a cloned new hint to the UNIQUE original URL actually observed by a
research tool. Existing retained source IDs cannot rebind. Validate duplicate
URLs and source/passage relationships again afterward. Preserve all source IDs,
citations, passages, prose and original billed provider responses. Existing
protected acquisition must fetch the exact observed URL; source identity does
not bypass retrieval, claim/quote support or the independent publication check.

Pin a separate optional discovery-contract selector only on newly admitted
articles and their progress. Missing marker preserves exact legacy behavior;
malformed, ineligible or mismatched markers fail before dispatch. A distinct
writer/repair stage version binds this behavior into durable identity without
changing the global prompt, model, provider instructions or schema. No historical
failed request is rescued or rerun, and no additional model stage is introduced.

## Candidate and acceptance

Prepared separately from live `3a526fad880bdb389b0560805ce96957898986cf` on
`codex/source-provenance-rebinding`. Fast, its unapplied migration, the separate
Continue-button web fix and blocked strict-six D48 are excluded. API-only release
must preserve existing addresses, schedules, budgets and all editorial checks.

The integrated local suite passes1,101 tests, zero failures/skips; both standalone
typechecks, full lint and diff checks pass. The23 new test groups cover unique/
exact/ambiguous matches, meaningful/duplicate/encoded query rejection, retained-ID
conflicts and duplicate collapse, raw-result and legacy fingerprint preservation,
marker admission/progress/replay compatibility, and actual acquisition of the
original observed URL through the production pipeline with injected transport.
The acquisition proof uses constructed source text, not Nobel or private prose;
it exercises independent passage selection, unchanged D50 checking, the sole
repair, ready replay and honest failure when acquisition is unavailable. It does
not test live network/SSRF behavior or certify factual model quality.

Independent frozen-live comparison transpiled actual3a526fa code and matched
both complete unmarked write/repair stage snapshots and fingerprints against
the candidate. Independent source review closed without a material finding and
reran all23 new groups successfully. No prompt wording, provider schema, model,
tool budget, output limit, factual check or original bill was changed.

Runtime freeze SHA256 receipts:

- `packages/ai/src/reader-first.ts`: `9f43e17a09651a480ae784ed4991be838fe8c928c00f89c58a12a31e5312ac14`
- `packages/ai/src/reader-first-discovery.ts`: `e51a9b23a67cf0415a3ac8e66a3ebdf9790a4028acdf69580b664c2ac4078451`
- `apps/api/src/services/demand-reading.ts`: `48d17d9edce6b7340582063beaa4dfcbe09367a7a9501cd5136e93becb8af575`
- `apps/api/src/services/demand-runner.ts`: `dc9e660fc477f132126ee4d47efa894fe02393909ca4a9b78a5d7a014180af3a`
- `apps/api/src/services/reader-first-pipeline.ts`: `66a4492dbafde72621ab3e9016e8764c7b23f796078cd3b8a1294f1468c20c80`
- `apps/api/src/services/demand-discovery-contract.ts`: `9157651b75d96745a53f869cded5e723a7fa1852493dbb38e8a303254cda9291`

Current status: implemented and locally verified; exact-source CI and API rollout
remain. No real reader request has exercised the correction.

After this API release, the separately prepared Fast candidate must incorporate
this correction and pass integrated checks before deployment. Deploying its
older live3a-based source would omit the new discovery selector handling. Do not
roll back to a pre-selector worker while admitted selected work could still run;
preserve its pinned semantics. No Fast activation is included in this release.

The engineering-delivery and editorial-review workflows keep this correction
prospective and source-honest. Automated fixture acceptance is not a claim that
the retained failed article is publishable or that generation is now reliable.
