# On-demand reading — local implementation checkpoint

September 6, 2026 · Owner: CTO · Status: implemented locally; release acceptance incomplete.

Latest execution state is in [the release record](ON_DEMAND_RELEASE_2026-09-06.md).
It supersedes the expired-login and untested logical-backup notes retained below:
Vercel sign-in is verified; exact 81ac136 CI is green; an encrypted current-data
checkpoint was restored and verified. A default-off protected web/API connector
is prepared; activating the exact Trusted Sources access boundary awaits
Michael's specific approval after automatic review rejected the broader authority.
No hosted migration, new deployment or real on-demand provider call is implied.

## Candidate and authority

The controlling assignment is [D26's approved v8 handoff](brand/APPROVED_ON_DEMAND_LOOPS_CTO_HANDOFF_2026-09-06.md). Michael's newer approval in Chief of Staff resolves the historical design hold. This record accompanies the scoped feature-off checkpoint on `codex/production-release-candidate`, based on `d084df4f96ce8ee78bc8c1b9d88376c9519f4ec8`. The commit containing this record identifies the candidate; it is not a deployed revision or a completed release. CoS retains operations/editorial/status ownership; unrelated shared changes are preserved.

The September 5 live web/API release is unchanged. Scoped commit/push to existing PR #1 is authorized for this checkpoint; it can trigger feature-off Preview builds and CI, not Production promotion. No live migration, explicit deployment, domain change, invitation, secret extraction or paid provider call was performed. `EDISON_ON_DEMAND_ENABLED` is off unless explicitly set to `true`; the new reader is at `/demand`, not yet the root-page rollout.

## Implemented scope

- Guest or existing authorized account ownership, separate from private account admission. Guest credentials are random tokens transported in an HttpOnly same-origin cookie and stored hashed server-side. Application tables use scoped roles and forced row-level security.
- Atomic loop creation and first-ideas admission; durable jobs for ideas, selected articles, explicit feedback and article questions. Exact request identity, frozen reader context, model choice, stage inputs/output, observed usage and provider-response identity are retained server-side.
- Source-informed ideas first, independent bounded HTTPS retrieval, then a body only when selected. Material-claim checking, headline/reader-fit checks, one repair and full recheck precede publication. Unresolved, invalid or uncertain results are withheld.
- Prompt candidate `edison-demand-v1.2`. The final publication gate binds each body claim to checker-supported displayed citations; overall sources include accepted support. Factual headings can carry checked claims; neutral headings need not invent them. These are structural/coverage defenses, not proof that a model's factual judgment is correct.
- Explicit loop knowledge, preferences and direction remain separate, additive and scoped. Long-lived working-state compaction is opt-in only when complete mutation requests and before/after states are archived atomically. Undo restores the exact prior active principles. Reading or asking a question does not infer mastery.
- Usage admission includes legacy spending/work, outstanding reservations and uncertain provider responses. Dispatch/retry recovery retains live leases, rejects ambiguous provider replays and counts attempts consistently. Checkpoint fingerprints distinguish successive retrieval groups even when the visible stage name stays the same. Failure settlement compares the exact expected checkpoint and replays a newer committed state instead of overwriting it. Pipeline/snapshot/prompt versions and snapshot identity are pinned; unsupported versions fail before provider work.
- Existing active-account Profile length/depth preferences are frozen as defaults through a worker-only, active-account-bound helper, without exposing raw profile rows. Guest defaults and explicit per-loop instructions remain separate. No new in-article length selector or article-version generation is part of D26.
- `/demand` uses the existing Pulse shell, actual request stages, no-art ideas, Curate, saved reading, question drafts, contextual Back and multiple loops. For You combines the actual idea cards; Curate from For You requires an explicit loop choice. Sticky-toolbar Ask opens an article-scoped dialog, leaving Sources → Next uninterrupted. A same-origin allowlisted proxy prevents browser-readable guest tokens and arbitrary API forwarding.
- Response ordering preserves independent pending work and Save decisions, ignores pre-mutation polls and scopes late retry results/errors to their original selection. A noncredential workspace identity prevents cross-principal merges. Validated device continuity restores the loop, exact commissioned article, return origin and reading position without commissioning again. Feedback completion clears only the exact applied draft/request; Undo preserves unrelated unsent text.
- Library and optional loop/For You history use fixed 60-card keyset pages, with Older/Latest navigation and a separate 24-record exact metadata cache. Older saved ideas and article status remain recoverable beyond the recent workspace caps, without pulling unselected bodies or recommissioning. Page/filter/cursor and contextual Back survive reload; the 120-entry device position map is bound to the workspace and immutable article request. Overlapping page/exact reads, Save and commissioning preserve canonical identity and newer status, and an invalidated loader exposes a retry instead of spinning indefinitely.
- One additive migration, `20260906000100_on_demand_reading.sql`, prepares eight demand tables, narrow roles/helpers, immutable snapshots/provider identities, progress checkpoints and ranked idea batches. It has **not** been applied to hosted Supabase.

## Verification evidence

Verified runtime: official Node `v22.23.2`, archive SHA-256 `61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6`, checked against the official Node release checksums. Existing locked dependencies were used; no project dependency installation or model change was needed.

| Layer | Observed result | Limit |
| --- | --- | --- |
| Full application tests | Web 285/285, including 50 focused reader/state/history cases; API 125/125 after history integration. Root independently reran the full web/API suites | Synthetic/unit tests; deferred-response tests exercise the actual shared coordinator/helpers, not mounted-browser event integration or provider-quality acceptance |
| Type/lint/build | Both typechecks, repository lint, both production Webpack builds and post-build typechecks passed. API build registered 13 steps/3 workflows | Not a hosted durable-job execution |
| Migration | Corrected exact migration and 69/69 demand pgTAP assertions passed on disposable PGlite PostgreSQL 18.3. Actual Supabase PostgreSQL 17.6.1.165 CI on 44534e8 applied all 16 migrations, passed 234 assertions across 8 files, both publication/correction replay checks and strict schema lint. A restricted local CREATEROLE runner also created/rechecked both roles and rejected an unsafe collision with 55000 | CI is disposable platform evidence, not a migration of the hosted production database or hosted Workflow execution |
| Full migration chain | All 16 migrations plus the empty seed applied in timestamp order on a fresh native PostgreSQL 18.6 cluster. Zero invalid indexes/unvalidated constraints; selected Auth trigger, active membership and account/guest ownership checks passed | Only Supabase-owned roles/auth/storage prerequisites were bootstrapped, not Edison application stubs. Not PG17-specific behavior, hosted pooler/privileges, full Auth/Storage/PostgREST or historical production-data upgrade proof |
| Older history SQL | Actual services recovered 420 saved ideas over seven 60-row pages, including precise timestamp/rank ties, new arrivals, unsaved anchor and off-cap exact identity. Foreign/revoked access failed; reads created zero requests/stages/events | PGlite 0.5.8/PostgreSQL 18.3 with synthetic dependencies, not hosted or rendered verification |
| Real SQL services | Actual repository Postgres.js/Drizzle client exercised guest creation/resume, hashed storage, loop idempotency, dispatch/claim/publication, save/read, owner isolation and stale-job recovery | PGlite's single-connection socket adapter; not real-server multi-session concurrency proof. Workflow start and final idea state were injected fixtures; no provider call |
| Native PostgreSQL concurrency | PostgreSQL 18.6: separate processes/connections serialized concurrent admissions; one duplicate provider-stage execution was allowed, the other denied before provider entry; exactly one stage and usage row persisted; a stale failure checkpoint preserved a concurrently committed running state under row-lock contention, while the exact checkpoint settled `worker_interrupted`; distinct API-role sessions preserved principal isolation | Original migration SHA 48c8ee0e… before the narrow role-bootstrap correction, with synthetic Supabase dependencies, mocked Workflow start and injected provider. Not hosted pooler/Auth/extensions, real provider or lost-network behavior |
| Recovery branches | Stale queued-with-run and running jobs recovered; expired reserved provider stage became uncertain; live provider lease was preserved; revoked principal failed closed. Exact versus stale failure checkpoints were exercised through real SQL; unsupported prompt/snapshot versions failed with zero provider-stage rows | Native contention evidence above covers bounded local cases; hosted lease/network recovery remains separate |
| Retrieval | An actual public HTTPS fetch of NHGRI's Synthetic Biology page returned title and 15,420 text characters at `2026-09-06T14:49:19.074Z` | No article was generated, and retrieval alone does not establish claim support |
| Rendered interface | Actual component + compiled CSS/fonts rendered in a disposable browser harness. Desktop 1280, phone Curate 390 and article 320 inspected. At 390/320, DOM page width matched viewport without horizontal overflow. Additive preference/Undo presentation, article Back/focus and retained question draft/answer presentation were exercised | Synthetic injected client/content, not a connected Next/API/provider journey. Full responsive/keyboard/reduced-motion matrix and Design review remain separate |

The two CoS [v1.1 review findings](editorial/ON_DEMAND_V1_1_REVIEW_2026-09-06.md) have source/regression fixes. AI/pipeline/principle focused suite: 89/89. CoS independently replayed the citation cases, checked factual/neutral headings and closed E01/E02 at the source/synthetic level on the exact hashes below. This is not a manual per-article publication queue.

Exact relevant files at the combined history/continuity local freeze (supersedes the earlier 257/119 UI checkpoint):

| File | SHA-256 |
| --- | --- |
| `packages/ai/src/on-demand.ts` | `0b8d42021e2fe46f75c6f7de61a64350f25bc84c2c00181a0461746dea33d086` |
| `packages/ai/src/on-demand-prompts.ts` | `3cc5e017de73724c4d314bc277a43be104b7cc2554313968a8ef390edac24c6a` |
| `apps/api/src/services/demand-publication.ts` | `70df95ba36072e65e20db53b043d2d02f7f289c712334df95bfc18d93a5b11d5` |
| `components/edison/demand-reader.tsx` | `09ccc391d86d42c1e58e5b629225a148834be33dd4b06584bb88613ddb027fd3` |
| `app/demand.css` | `67d7138c96dd9f9a0b862b0115b89b080318ef0e849133515c5d7e562dbfa9c2` |
| `lib/demand-reader-state.ts` | `53eb70e0d6bb9743e3a17b9cfe29d6e6fb92f8b1310fec18f781703383c172c8` |
| `lib/demand-reader-history.ts` | `528aab4e78148574f0895693120aa8bec2faf065bdd6a018010740485592e5a1` |
| `tests/demand-reader.test.ts` | `529700b7ab8db319cd09f42568207793ab9fd22cc25e3f41172a7f8e02916fdc` |
| `tests/demand-reader-state.test.ts` | `4c69a52fc86e8cfbdaca37f9b043d128192b16121505dfd9d77765efde8d147b` |
| `tests/demand-reader-history.test.ts` | `e5f87c6ae2ff42b34574d997ffdd701cf0dbddc7d3b9a9c9f20d65ee86e862e7` |
| `apps/api/src/services/demand-runner.ts` | `80d222c169bfa32cef7e984955936c7628ce78a3cb26c601d67e876f1cd7a366` |
| `apps/api/workflows/on-demand-reading.ts` | `7d12eb504bb8b2c4054ce30d5eba26a931167f947081d1656d4382eee88aa385` |
| `apps/api/src/services/demand-history.ts` | `b5fa7e9d7eb36ad46d163e68b8f83913616cfa7e00de4f0f9942a9bdd39c9ea4` |
| `apps/api/src/services/demand-reading.ts` | `f05429c4d5a8953115f7a9a6ef9f4bf47b908002f6c12b5899948c06c639b547` |
| `packages/contracts/src/demand.ts` | `49242aab7772d9e8f7eefb497d4a6b678ba21905490d48bd19322e465593db15` |
| `lib/demand-client.ts` | `f0b2bf60312afcac3549d441d01f049859b30c7d410fd5fe1c11acb41c53437e` |
| `supabase/migrations/20260906000100_on_demand_reading.sql` | `908ad32d67b7f45ce7127559ebf9bcc57f36bf3301a31972d74099053a861cad` |

## Bounded Design corrections

### Committed checkpoint and CI correction

Checkpoint `bd2bf2fa0f2cd6f7558067410dc61e30b1e963e9` is pushed to [existing PR #1](https://github.com/michaelmcguiness/edison/pull/1). [CI run 34045636526](https://github.com/michaelmcguiness/edison/actions/runs/34045636526) passed the complete application job; all three Vercel Preview statuses succeeded. Its disposable Supabase PostgreSQL 17 database job applied the historical 15 migrations, then failed on the new migration's redundant `ALTER ROLE ... NOSUPERUSER` (42501), before pgTAP. This is a real platform compatibility failure, not an infrastructure flake or a live migration attempt.

Correction `44534e8fc762e465ec7c5065aca8f6fe62ecb18a` removes only the restricted redundant ALTER statements. New roles retain all least-privilege CREATE attributes; unsafe pre-existing attributes or role memberships fail closed instead of requesting elevated privilege. The corrected migration hash is recorded above; its demand pgTAP file is `4f8650225b5c272c41079cd4326bd216010ea7af1bf53aaee60d4c8a57f29177`. Exact migration/69 assertions and restricted CREATEROLE creation/recheck/collision cases pass locally. Earlier native full-chain/concurrency evidence is explicitly on original migration SHA `48c8ee0e6a2271ac1546faee2553d27d3e6fa02dd5fd7537181f585fe2a7f400`; it did not catch this Supabase permission boundary. [CI 34047052622](https://github.com/michaelmcguiness/edison/actions/runs/34047052622) passed both application and Supabase PostgreSQL 17 database jobs on the correction, including 234 pgTAP assertions and strict schema lint. No hosted migration or production change occurred.

Design independently reran all 44 focused cases on the preceding UI freeze and closed same-article leave/reopen, ending Back and the bounded history surface. Its one additional finding—delayed old metadata restoration overriding newer navigation on success/failure—is now corrected with an intent captured before bootstrap/metadata waits. Explicit navigation clears the obsolete recovery surface; ordinary restoration and deliberate Retry retain their own intent, and Retry session-check failure stays recoverable. The current freeze adds deferred success/failure, bootstrap/retry and normal-restoration regressions (50 focused / 285 web). Root independently reran the tests; Design's follow-up closure and corrected mounted/browser/connected acceptance remain separate.

The corrected source and focused regressions cover Design's card state/action copy, accessible names, sticky article-scoped Ask, explicit dialog opener/fallback focus, keyboard-aware growing textareas, late retry and stale poll ordering, independent Save responses, exact Undo draft preservation, second-loop and Library-origin half-read reload, and combined For You feed/return behavior. Root inspected the final integration; Design's independent source closure remains a separate review. Existing account reading preferences are linked to their actual Profile route; no proposed length-tier selector was added.

These corrections are not a claim of corrected-candidate browser acceptance. Earlier rendered checks applied only to reader SHA `d22d638d4422ae59f2d004cd64714e9590914b11f3c075e65324aa4ea02a8935` and CSS SHA `557a3facfcb17ec189ae3ea10dc596eb9e15261adc7b198f2a63a27680fd4591`, before this final correction pass.

## Reproduction

Use the verified Node binary at `/private/tmp/edison-node22.uHDgp6/node-v22.23.2-darwin-arm64/bin/node`, or an equivalent supported Node 22 installation. Run existing binaries directly if the expected package manager is unavailable:

```sh
node --import tsx --test tests/*.test.ts
node --import tsx --test apps/api/src/auth/*.test.ts apps/api/src/http/*.test.ts apps/api/src/services/*.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --ignore-pattern .next --ignore-pattern apps/api/.next
node node_modules/next/dist/bin/next build --webpack
```

Also run API typecheck/build in `apps/api`; run builds sequentially and avoid simultaneous generated-type checks. Do not use a different package-manager major that attempts to rewrite the installed dependency layout.

Disposable database evidence runners: `/private/tmp/edison-pglite.uWWJqx/run-demand-migration.mjs` and `run-demand-services.mjs`. The service runner requires Node's `--experimental-test-module-mocks --import tsx` and local loopback access. Temporary dependencies and synthetic database data are outside the repository.

Native PostgreSQL evidence: `/private/tmp/edison-postgres.psTxw5/EVIDENCE.md`, completed `2026-09-06T15:42:49Z`, with retained bootstrap and separate-process admission/stage/concurrency scripts. Official Postgres.app v2.9.6 PostgreSQL 18.6 DMG observed SHA-256 matches the GitHub release digest `9fc7d0dc08cf46dfd94bb32cbaaad81b41b37847a42d6dcb2f9fbd292813defb`. DMG CRC verification passed; this macOS runtime did not independently attest the app's code signature. No system installation/service was created. The loopback-only server is stopped, port 55432 has no listener and the DMG is unmounted. An initial JSONB constraint failure was isolated to raw Postgres.js double encoding in the temporary harness; the actual Drizzle loop/snapshot/progress/stage/usage writes passed object constraints. No application change was warranted for that harness error.

Disposable UI harness: `/private/tmp/edison-demand-ui.NQuoLb/entry.tsx` and `serve.mjs`; when running, `http://127.0.0.1:4317/`, `?empty` and `?error`. It imports the actual component but deliberately injects synthetic state. It is not a public product endpoint or generation substitute. The server is stopped and its browser tab closed. Design's separate local-prototype browser restriction remains intact: Design is performing a bounded source review, not opening this fixture or using an alternate host/tool to bypass the restriction. Initial rendered evidence applies only to the earlier UI hashes specified in the bounded-corrections section.

## Remaining acceptance / next owner

### Completed local follow-up (hosted/rendered acceptance remains separate)

Design independently matched earlier freezes and reran first 26, then 44 focused cases. The current focused cases cover same-article leave/reopen and ending Back, pages begun before/during Save, both page/exact response orders, monotonic request identity/status, principal changes, cache limits, older-page reload/Back and navigation-intent-safe restoration. Root inspected the integration and reran 285 web tests. Design's final intent-correction closure and actual rendered/connected acceptance remain separate.

The history API offers fixed 60-row keyset pages (`scope=all|saved`, optional loop, principal/filter-bound cursor) and exact older-idea/status recovery. Workspace and history queries select only metadata, not private briefs/evidence/progress/results. API 125/125 and focused history/proxy 8/8 passed. `/private/tmp/edison-history.qQLS3c/check-history.mjs` (SHA-256 `8d52226d029e2f0cc28515e2ab6e590491ef16c1fceb819fdaaecd3b7b3f9722`) exercised the actual services on PGlite 0.5.8/PostgreSQL 18.3: 420 saved ideas across seven pages, precise timestamp/rank ties, new arrivals, unsaved cursor anchor, off-cap exact recovery, ownership/revocation and zero new requests/stages/events from reads. The adapter is stopped. This is synthetic-dependency local SQL evidence; hosted checks are separate.

Full-chain native evidence is now at `/private/tmp/edison-pgchain.CRIaKo/EVIDENCE.md`: all 16 migrations and the empty seed applied successfully in timestamp order on a fresh PostgreSQL 18.6 cluster. Postchecks found zero invalid indexes/unvalidated constraints; auth-trigger and application/demand ownership checks passed. Its bootstrap supplies only explicit Supabase-owned roles/auth/storage prerequisites, not Edison application stubs. The server is stopped/unmounted. This does not replace PG17 Supabase CI, hosted privileges, Auth/Storage/PostgREST, historical-data upgrade or backup/restore validation.

Secure operator access: existing GitHub keyring and Supabase CLI sign-ins work; initial sandbox-only failures were not expired credentials. A linked `supabase db push --linked --dry-run --skip-vault` reports exactly `20260906000100_on_demand_reading.sql` pending and applies nothing. Vercel dashboard is signed in but the official isolated CLI 59.11.7 is logged out. Michael was asked to complete its one-time device authorization; the in-app browser's genuine Allow Access control stayed disabled, and that attempt subsequently timed out. A fresh code is needed when the owner is ready; do not reuse the old code or bypass the disabled control. No credential value was requested in chat, exported, or bypassed. The old live API cannot establish new v1.2 output evidence. Normal secure candidate execution is the next access dependency; no new general release approval is requested.

1. **CTO + CoS:** execute the real Synthetic Biology vertical slice within existing funded capacity, then the approved broader cases. Retain exact prompt/model/context, offered brief, independently retrieved passages/metadata, draft and claim map, checks, sole repair/full recheck, final outcome, stage latency and observed usage. Pair baseline/adapted samples without losing prior instructions. No actual model-output quality, adaptation benefit, latency or economics has yet been measured for this candidate.
2. **Design + CTO:** finish actual rendered responsive, keyboard/focus, reduced motion, slow/failure and return behavior in a permitted environment; distinguish fixture-backed component review from a fully connected environment. Design and CoS clarified that article length tiers remain P02/proposed, not a D26 requirement or release hold. Preserve existing account Profile preference access separately from per-loop Curate; no fake length toggle or new article-version generation.
3. **CTO:** retain green full PG17/Supabase CI on the final candidate and verify actual hosted pooler/Workflow retry/accounting, building on the completed disposable platform/full-chain/multi-session evidence above. Use existing release authority only once the applicable checks pass; do not rerun historical migrations/publication operators.
4. **CTO + Design:** verify the implemented older-history surface and return behavior in the permitted connected candidate before calling daily continuity complete. Recent workspace caps remain 360 ideas/120 requests; the separate paged surface now covers older saved reading locally. `/demand` is still isolated; root-page rollout is a later release step.

No new product-direction decision or generic design approval is currently needed from Michael. Local implementation is substantial progress, not production readiness or demonstrated daily reader value.

Independent final history security review found no cross-principal/filter leak or private generation-payload exposure. Two non-blocking CTO hardening follow-ups remain before relying on large, long-lived histories: add indexes matching the principal/loop/saved keyset ordering (the response is bounded, but current database scan/sort work can grow with lifetime history); enforce idea ownership/identity/order immutability in SQL or use validated cursor ordering keys (the current worker does not mutate those keys, but a future trusted-worker mistake could disrupt anchor-based pagination). These are not demonstrated production incidents or blockers for the small protected calibration. No unbounded-history performance claim is made.

## Protected calibration path — prepared, not executed

After the exact candidate is committed, full CI is green and the additive hosted migration is reviewed/applied under existing authority, use a clean detached checkout for an **aliasless Production-environment deployment of the existing `edison-api` project**. Vercel's `--prod --skip-domain` leaves domain promotion separate; add only the nonsecret per-deployment `EDISON_ON_DEMAND_ENABLED=true` override. Existing Production credentials stay inside the hosted runtime. This is a protected calibration against the production database and funded API, not an isolated staging database or a public rollout.

Verify the exact account/project/root settings, plan support for the existing five-minute crons, and Standard Deployment Protection before deployment. Confirm the returned deployment is Staged, has no aliases, rejects anonymous requests, and leaves the current public API/domains unchanged. The demand session route deliberately admits no-account readers when enabled, so an obscure URL is not an acceptable spending/access boundary. Use the authenticated CLI's protected request facility on the unique URL, with guest credentials kept out of logs and repository artifacts. Health must pass with the flag enabled, followed by the harmless demand-specific check and one bounded real calibration; health with the feature off is insufficient.

The API contains three existing mutating cron schedules. Official documentation does not explicitly settle whether a staged Production deployment changes active cron registration; inspect the dashboard before/after, do not invoke a valid cron for calibration, and do not disable project-wide cron jobs. Workflow documentation pins runs to the deployment that started them and keeps queue callbacks private; verify the actual run's deployment ID and terminal outcome, retaining the staged deployment until its runs finish. No `promote`, alias/domain change, secret export, new project, paid upgrade or cleanup deletion is part of this checkpoint.

Read-only release-path review: [Vercel staged deployment](https://vercel.com/docs/cli/deploy), [protected CLI requests](https://vercel.com/docs/cli/curl), [Deployment Protection](https://vercel.com/docs/deployment-protection), [cron behavior](https://vercel.com/docs/cron-jobs), and [Workflow's Vercel deployment behavior](https://workflow-sdk.dev/worlds/vercel). These describe the prepared path; they do not establish a hosted candidate or successful generation. The expired one-time CLI authorization remains the actual access dependency.
