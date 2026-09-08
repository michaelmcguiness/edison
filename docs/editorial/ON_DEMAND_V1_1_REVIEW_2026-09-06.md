# On-demand v1.1 review and v1.2 corrections

September 6, 2026 · Chief of Staff acting as Editorial · D26 implementation checkpoint

**Current verdict:** E01 and E02 are closed for the reviewed v1.2 source/synthetic cases. CoS verified the factual-heading correction and a temporary independent reviewer replayed the citation failures and valid alternatives. Overall editorial-system acceptance remains open pending real-output calibration. No generated article, factual-accuracy rate, reader appeal, adaptation improvement or production-readiness claim is accepted by this review.

## V1.2 correction verification — 15:13–15:14 UTC

CTO integrated prompt version `edison-demand-v1.2` and bounded validation changes. CoS directly inspected the updated prompts and acceptance code. The prompt now requires each material body claim to have a supporting displayed citation, requests repair when necessary support differs from displayed citations, and allows material factual heading claims while leaving neutral headings unmapped.

CoS directly ran the focused **“factual heading claims can be mapped and must be checked; neutral headings need no invented claim”** regression: one test passed. It covers a mapped factual heading, rejection of an omitted checker result for that claim, and a neutral heading without a made-up claim.

At 15:14:12 UTC, the independent reviewer replayed five injected citation cases through the publication gate:

| Case | Result |
| --- | --- |
| Separate A+B claims, but only A cited | Withheld |
| Writer citation A, checker support only B | Withheld |
| Separate A+B claims, both cited | Accepted |
| Multiple supporting passages, checker selects a valid subset | Accepted |
| Checker selects another supporting passage from the same cited source | Accepted |

Source hashes were unchanged before/after the citation replay:

- `packages/ai/src/on-demand.ts`: `0b8d42021e2fe46f75c6f7de61a64350f25bc84c2c00181a0461746dea33d086`.
- `apps/api/src/services/demand-publication.ts`: `70df95ba36072e65e20db53b043d2d02f7f289c712334df95bfc18d93a5b11d5`.
- Separately inspected v1.2 prompt: `3cc5e017de73724c4d314bc277a43be104b7cc2554313968a8ef390edac24c6a`.
- Focused test file at review: `cf20baafdd5af92a5ecb5fcdc54c8178b7ef78d4150c8491a2b01314dacb7d7d`.

CoS made no application edits or provider/network requests. These checks establish the two bounded corrections, not semantic truth of model verdicts or reliable detection of every omitted claim. CTO separately reports 89 combined AI/pipeline/principle tests, then the full 243 web plus 110 API tests, typechecks, lint and both production builds passed; CoS did not rerun that full suite. Two other admission/configuration issues remain under CTO correction before its technical freeze. The candidate remains uncommitted with the feature off and no reported live changes.

The original failing snapshot and reproduction below are preserved as history, not current open findings.

## Reviewed evidence

CTO reports a local integrated candidate on the uncommitted saved checkout based on `d084df4`, with the demand feature off by default and no live changes. Reported evidence includes a Node 22 API production build, focused tests, independent retrieval of a public NIH page, and the additive migration plus 63 pgTAP assertions against disposable PGlite/Postgres 17.5 with synthetic legacy dependencies. This is not the full Supabase migration chain, multi-session concurrency, authenticated production behavior, or real provider output. CoS did not rerun those reported checks.

CoS directly inspected the v1.1 prompts, orchestration, evidence-window provenance and reader-context assembly. A temporary independent reviewer inspected the draft/final acceptance gates and reproduced the findings below with injected local state. No application edits, provider calls or network requests were made by the review team.

Snapshot recorded around 14:53–14:54 UTC; CTO was actively integrating later changes:

| Source | SHA-256 |
| --- | --- |
| `packages/ai/src/on-demand-prompts.ts` | `467b793548dab4f0346d5d7cf4b770aae8f61c34b8eccb7c39dc8eef8efbf688` |
| `apps/api/src/services/demand-pipeline.ts` | `2e6f8ffb6168f53e1562f029f6c2d8149572b4a8118d0aaf7f2deb8c63566f56` |
| `apps/api/src/services/demand-reading.ts` | `b7063dd3eb6804be0e5b2cc25df83b8351a9a29de642c9da3c8d91a05acfb64e` |
| `packages/ai/src/on-demand.ts` | `664fc8c2262f39660b0f8247807d5f8bf3c34ea49a7d2258789368d983bfccb4` |
| `packages/ai/src/on-demand-schemas.ts` | `a07ec68fc32fec7053d01d1696f2fdeafffd5ad8ef16106c02204138604135fd` |
| `apps/api/src/services/demand-publication.ts` | `70df95ba36072e65e20db53b043d2d02f7f289c712334df95bfc18d93a5b11d5` |

## Findings sent to CTO

### E01 — citation support mismatch, corrected in v1.2

At the reviewed `on-demand.ts` lines 246–250 and 263–269, displayed citations are checked against the writer's mapped sources, while checker passage IDs are validated separately. The final publication path uses the same acceptance gate.

Both constructed cases reached successful publication at 14:54:20 UTC:

- A paragraph has separate material claims supported by source A and source B, but displays only a citation to A.
- The writer maps and cites source A; the checker identifies passage B as the supporting evidence; publication still retains citation A.

The source snapshot was unchanged during the independent replay. These are demonstrated structural acceptance failures using injected data, not observed hallucinations in paid model output.

**Required consequence:** each material displayed claim has an inspectable citation backed by checker-accepted support. If the checker changes necessary support, repair the claim map/citations consistently and recheck, or withhold. Several passages can genuinely support a claim, so naive list equality is not the acceptance criterion. Add the two cases to regression coverage and show the corrected final article/citation packet.

### E02 — factual heading mapping, corrected in v1.2

At `on-demand.ts` lines 205–217, `articleLocations` excludes heading blocks and claim-map validation rejects locations outside that set. A writer that correctly maps a factual heading to `body.0` receives **“Unknown claim location.”**

**Required consequence:** allow material factual claims in headings to carry evidence mappings and be assessed by the checker, including omitted-claim review. Neutral headings need not acquire invented factual claims. Verify a supported factual heading, an unsupported factual heading and a neutral section heading.

## What the source now supports, and what remains unproven

- Version `edison-demand-v1.1` separates idea research, independent retrieved-evidence checks, selected writing, checking, one repair and full recheck. The source avoids a routine human publication queue.
- Context assembly passes explicit directions, declared knowledge, reading preferences and bounded prior opened-article summaries into requests. The prompts give explicit preferences precedence over generic length/depth defaults and distinguish exposure from mastery. This proves input wiring, not useful output changes.
- Independently fetched page content supplies retained passage windows; unmatched model excerpts are not relabeled as retrieved evidence. Titles/hostnames come from the fetched page and unknown publication dates remain unknown. Evidence-window sufficiency, source selection and full claim support still require real-case evaluation.
- Prompt language asks for distinct, compelling ideas and useful original explanations. No real sample yet establishes that the output meets Michael's taste or the reader's purpose. Do not tune a new prompt version without diagnosing an actual failure.

## Next checkpoint and owner

CTO owns remaining integration and technical freeze. Design reviews the actual built experience using permitted tools. CoS has closed the two bounded source findings and next reviews a compact real-output packet: exact prompt/model/context, offered headline/brief, retained passages, draft/claim map, checker findings, any sole repair/full recheck, final result and stage-level time/usage. Pair baseline and medicine/DNA or shorter/deeper outputs, preserving compatible prior preferences. Broader acceptance includes the four anchor subjects and a fresh topic outside fixtures within existing authorized capacity.

Selected sample review calibrates prompts and automated checks. It is not a requirement for CoS to approve every future article. The [D25 acceptance cases](../operations/LOOP_VALUE_ACCEPTANCE_2026-09-06.md) and [approved D26 handoff](../brand/APPROVED_ON_DEMAND_LOOPS_CTO_HANDOFF_2026-09-06.md) remain controlling.
