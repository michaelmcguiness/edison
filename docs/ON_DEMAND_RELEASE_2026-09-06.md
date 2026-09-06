# On-demand release execution — September 6, 2026

Owner: CTO. Scope: D26 on-demand reading, protected real-output calibration,
connected/browser acceptance, then the authorized existing apex rollout.
This is an execution record, not a claim that the new experience is live.

## D28 reader-first implementation — locally integrated, protected release pending

Michael's D28 approval supersedes the older v1.7 assessment/hosted-work hold below.
CTO implements natural explanations with selective research and the existing D26
interface. Stable general knowledge needs no invented bibliography; current,
uncertain, specific empirical/statistical/quoted and consequential claims still
need appropriate verification. Papers are optional. No new service, migration,
model, quota or dollar-ceiling change is included.

Initial checkpoint committed/pushed as `9d28746355209c5c7011748c7e9a206ab35b6dd3`
(32 CTO-owned files). The following describes that source; the focused chained-Ask
correction below is subsequent, locally verified:

- Version-2 request snapshots and an isolated generation/check/sole-repair path.
  Existing version-1 prompts/results remain preserved, not rewritten or reapproved.
- Full actual draft checking for accuracy, verification, question payoff, reader
  fit, continuity and privacy; exact artifact/assignment/evidence fingerprint.
  Duplicate author-paraphrased claim ledgers and mandatory per-paragraph support
  are absent from the new path. Publication reasserts the accepted fingerprint.
- Bounded optional hosted search with actual tool-result URL provenance; fetched
  passages still pass the existing SSRF-protected retriever. Safe redirects use
  final retrieved identity. Failed refreshes cannot reuse old evidence as fresh.
- Eight total research-tool actions across the whole request, allocated under
  existing principal/request locks, with exact replay allocation. Search actions
  and other tool actions are counted separately; unknown pricing is retained and
  fails closed. No second repair or provider SDK retry was added.
- Articles and Ask can acquire sources. Answers publish their own canonical
  citations/source list; saved article text and references remain immutable. Final
  article evidence is retained for follow-ups; new questions freeze current loop
  knowledge/preferences and date without rewriting the article's original context.
  Historical large paragraphs, old answers
  and source-free new reading survive the compatibility boundary.
- Existing reading/Ask components render zero-source and researched states
  truthfully. No empty Sources list or made-up research time. D26 layout, focus,
  drafts/navigation and recovery controls remain; no Perplexity visual redesign.

Initial checkpoint verification: **430 web + 163 API tests pass**, both standalone
typechecks pass, full lint has no warnings and both production builds pass.
API build registers 13 steps/three workflows. Initial build type errors were in
new test fixtures/imports and were corrected before the successful reruns. Added
publication tests independently pass9/9; pipeline tests pass13/13, including
stable concepts, researched Ask, sole repair, genuine provenance, safe redirects,
refresh failure and cross-version/loop rejection. The final integration review
also found and closed stale Ask preferences: admission now locks the owned loop,
freezes its current knowledge/preferences and date, and preserves exact replay
and the immutable article. Tests cover updated preferences and reject foreign or
regressed contexts. These are constructed fixtures
and injected verdicts, not real generated-writing quality evidence.

No local disposable PostgreSQL/Docker instance is available. Existing CI retains
234 declared pgTAP assertions plus publication/correction replay checks. A bounded
local-only integration check now exercises the changed real provider
allocation/accounting transaction path in that CI database; its offline safety
guards/types/lint pass. Exact-head [CI 34067166843](https://github.com/michaelmcguiness/edison/actions/runs/34067166843)
also passed both application/database jobs, including this new real transaction
check, pgTAP and strict schema lint. All three Vercel contexts are successful.
The permitted protected deployment/rendered states and actual explanation/Ask/return
remain pending. Existing public and protected hosts,
scheduled jobs and guest data are unchanged; no D28 paid calls have been made.

Local alternative screenshot routes remain restricted. Preparation was stopped
before any harness build, localhost server, browser access or screenshot; the one
unexecuted synthetic fixture is not release evidence. Design will receive actual
screenshots from the permitted protected deployment.

Frozen initial-checkpoint source hashes (9d28746, not the subsequent correction):

| Source | SHA-256 |
| --- | --- |
| `packages/ai/src/reader-first.ts` | `cefcc7dcab98a86f899bb840fde730d799423e6972ebfd38e98057f14d401be4` |
| `apps/api/src/services/reader-first-pipeline.ts` | `3a9fdaa787717d5f855b9d715d502e0ba85bee8284e121701958ccecdafcb3fb` |
| `apps/api/src/services/reader-first-publication.ts` | `1393c5aa31a1f011650a1a32ffe1083a6b8dff15d3481a4b88cdff5642aea83a` |
| `apps/api/src/services/demand-result-compatibility.ts` | `00a56c1a8da9a9509a149f4bbb9335a6d73ea0432ad75269619e69632914af40` |
| `apps/api/src/services/demand-reading.ts` | `8c8472a9fcde26b2e374be2863a210e920d9b1a8f8856491f891910606b0034f` |
| `apps/api/src/services/demand-provider-stages.ts` | `3c9721e2532e716eb35ad4d628ffbb57ac283f672009c75a0754e70836b89d9b` |
| `components/edison/demand-reader.tsx` | `0d2fe34b4e5380490461fde66237bd715e6e9909fbb5cfbc7fe67bf09b8f1cfe` |
| `scripts/check-demand-provider-local-db.ts` | `e688b66dc22a84b694315fd27862c6977cc95f12c93054859e967dc04ca243c8` |

### Chained-Ask reference correction — implemented and locally verified

CoS independently found that admission forwarded prior answer prose but omitted
its canonical owned sources and saved `result.evidence`. A follow-up asking what
that answer's “source 1” means could not resolve the actual reference, especially
after a source-free article. The focused correction retains a message-local source
mapping and genuine supporting passages under existing bounds. Numeric labels in
different answers do not merge. Prior prose remains conversation context, not
factual authority; old retrieval times never imply fresh verification. If packet
limits or a source refresh remove historical support, retain its known identity
with explicit unavailable support, requiring research or an honest limitation.
Original articles/results and admitted request replay stay immutable. New regressions
cover source-number collisions, source-free article chains, exact fingerprints,
overflow and refresh. Legacy unresolved references are omitted and the remaining
labels match the compact displayed source list. History imports only genuine
retrieved passages at the answer's actual saved retrieval version. Sources that
cannot fit retain their identity with explicitly unavailable evidence.

Corrected-source verification: **449 web + 163 API tests pass**, both final
standalone typechecks pass, full lint has no warnings and both production builds
pass (API 13 steps/three workflows). The history helper passes 15 regressions;
pipeline 14 and the focused AI suite 105. These remain constructed/injected tests,
not semantic provider or rendered UI acceptance. Commit/CI follows separately.

Frozen correction source hashes (commit `2beaea99a1525d219d6dcd7ab8023746c3304e5a`):

| Source | SHA-256 |
| --- | --- |
| `apps/api/src/services/demand-question-history.ts` | `09751945c059bd298c50b83fe4f0711ab73ff7b5c1996d6ac2d013cace8e785e` |
| `apps/api/src/services/reader-first-pipeline.ts` | `e7cb65f92d6918230e9b989a2054d19b2193e265623ed48dfdd8559b9bb97b0d` |
| `apps/api/src/services/demand-reading.ts` | `931e87039905585c4986196c7cb7f346b4a29138aba3115b4ba327943053a65f` |
| `packages/ai/src/reader-first.ts` | `cbe8e397b526cdc0cecbbeb903a47d5996ef6013c3326ad9316c05ad06d5371f` |
| `packages/ai/src/reader-first-prompts.ts` | `88f45b3c5c5fa3809ddf736259e2b105a40f786150b04e83a10c6c9c85024058` |
| `tests/demand-question-history.test.ts` | `d5833b49536141f8ddba3361254cdc696e5ce173439f6ffb7f44ab327ce7e485` |
| `tests/reader-first-pipeline.test.ts` | `32faf6d6cf030d07f42ff06d7ec714425c8df685802b27df00f3cc43ff6ee30f` |
| `tests/reader-first-ai.test.ts` | `97bf1d73400d2a0b729eb536366502522b5b235a5f95fa91d3caaa6a12fbe5f2` |

Final independent review reproduced a JSONB persistence edge case: field-order
changes could mark identical historical passages unavailable. The retained packet
now passes the same existing bounded schema as the saved packet before exact
comparison. The reordered-field regression failed before the fix and passes
afterward; actual refreshed passages still remove support without rebinding the
historical reference. All **450 web tests**, both standalone typechecks and
focused warning-free lint pass. Exact final CI remains pending; no deployment
has occurred. Updated pipeline hash is
`7d3006e17d1783478cc86e5f65a271b974c827f46631abb5bfb1bdcf24c61e50`;
pipeline-test hash `c857a72aa3c8b1d211d3e02a4a17384a31d7ca0df5cfe71be44513549e4d0285`.

CoS's successor sample is authorized in
`operations/LOOP_VALUE_ACCEPTANCE_2026-09-06.md`: at most two idea batches, two
selected articles, two Ask and one labeled QA preference change, in the same
guest under unchanged normal limits. First practical article eligibility is
September7 **3:14:32PM EDT or later**; the second around3:57:30PM. The old aggregate
sample cap is superseded, not the normal limits. No quota reset, new principal,
blocked-bookmark retry, raw-API workaround or automatic scheduled run. Stop paid
sampling on material failure. CoS reviews selected real outputs; this is not a
routine manual publishing queue. Public rollout follows actual value acceptance.

## Unpaid v1.7 correction — implemented and locally verified, not deployed

CoS closed the real lupus diagnosis with independent editorial review. No further
distorted clinical result was identified, but the roughly 350-word draft did not
explain the selected immune-reset concept for the reader; a factual pass alone
would not establish useful reading. The final check misread design intent as
demonstrated compatibility, while its definition remained imprecise. The historical
request stays withheld and immutable.

Selected bounded correction, owned by CTO:

1. Clarify the difference between contradictory evidence and missing support,
   design intent and achieved result, and imprecise definitions and false outcomes.
   Reasons must identify the actual unsupported meaning, not a stronger substitute.
2. Inspect the complete retained packet before removing a necessary explanation
   for a displayed-source mismatch; repair its citation when existing support
   exists. Keep background concepts separate from another study's outcomes.
3. Preserve the core explanatory bridge through writing/check/repair. Explain or
   omit nonessential jargon and evaluate reader fit/payoff independently of
   factual support and length. Return insufficiency if the actual evidence cannot
   sustain the necessary bridge.

Scope is versioned prompts and focused contrastive contract tests, not a schema,
retrieval, ledger or publication-gate redesign. Models, dollar ceilings, stages,
sole repair and existing historical records stay unchanged. No staging, public
release or additional paid call is authorized at this checkpoint. The same guest's
next normal quota eligibility is being calculated read-only; an available quota
slot is not a new sampling decision or proof of readiness.

Fresh read-only admission verification at 21:56:19 UTC finds this guest at **4/4
articles**, legacy article count zero, and zero of two concurrent slots in use.
The oldest counted request was created September 6 at 19:14:31.066561 UTC. Its
next per-reader slot opens September 7 just after the same UTC time; the actual
millisecond cutoff is **19:14:31.067 UTC / 3:14:31.067 PM EDT** (practically
3:14:32 PM EDT or later). Failures count, and the rolling window is not a midnight
reset. Admission still requires the $1.20 request reservation to fit shared budgets,
no blocking unpriced/uncertain spend, a valid session and concurrency capacity.
This is not guaranteed admission or permission for another calibration request.
No wakeup or paid test has been scheduled.

The implementation uses task-specific examples and separate criteria, consistent
with current official [prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
and [evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
Constructed tests can verify prompt delivery and unchanged acceptance boundaries;
they cannot prove improved semantic judgment or a useful fresh article.

The correction is now frozen. Production changes are limited to writer/check/repair
instructions and the `edison-demand-v1.7` version; ideas, idea-check, answer and
feedback instruction strings are byte-identical to v1.6. A separate importable
five-case contrast corpus records authored expected meanings/verdicts. Six injected
regressions cover verdict preservation, citation repair without deleting prose,
independent fit/payoff rejection, insufficiency stops, immutable outputs/usage and
the unchanged sole-repair/token bounds. They contain no prompt-wording assertions
and do not run a semantic provider comparison. The existing pipeline version
assertion verifies the new version reaches its stages.

Root independently read all final source/tests/corpus and the final single-line
evidence-gap fixture correction. All **373 web + 149 API tests**, final standalone
typechecks, full lint and both production builds pass. API remains 13 steps/three
workflows. Owner's 121 focused tests also pass. CoS independently closed the bounded
prompt/source review and final fixture extraction, matching all four frozen hashes.

Frozen source identities:

- Prompts `9cd7dfb7b8af47afb22caf1b4b6e28c418707c45dd429618d6dbb4dfa8c1b3e5`.
- Calibration tests `91342a32cb8b72645207fb60802c757558e646acc5c3521cc263fcc4600c89d5`.
- Contrast corpus `3c6dd9230e75f5559e1927cbdead72610604195285ff69da65638fbabc91d923`.
- Pipeline version test `018c3c84147733c649a0af55c2beedb0b3d4a4aa09ca367558642d8c8d815c45`.

This is a local-only source checkpoint. No v1.7 push-triggered hosted checks,
protected deployment, provider comparison or public promotion has occurred.
Hosted calibration remains exact c600d939/v1.6; public September 5 remains live.
Next dependency is a scoped live validation after normal quota availability and
a selected next sampling step—not another credential or generic approval request.

## v1.6 adapted article withheld — 21:48 UTC

Selected idea `bbbbd1e2-815c-4da9-8d54-ecb5a59519bc`, **Could Off-the-Shelf
Engineered T Cells Reset Lupus?**, ran only after the saved revision-1 feedback and
fresh adapted ideas. Article request `772dbf04-ed94-45ac-adc5-d3842b01fb48`
ran 21:46:12.575788–21:47:34.530050 UTC and failed `editorial_withheld`.
Workflow `wrun_01M1WAZA048ZD2GAT23NBTBXNE` independently confirms completion
at 21:47:34.963 UTC on exact v1.6 API `dpl_DKxE4WYPSePEYNock194nVMmAYuf`,
with no runtime error. The UI shows the selected card and an honest unpublished
failure; root inspected the desktop screenshot
`/private/tmp/edison-calibration-ui.SgJRjD/v16-adapted-withheld.png`.

All four writer/check/sole-repair/check stages completed. Charges are 40,228 +
5,573 + 46,238 + 5,230 microUSD, **$0.097269**. Cumulative on-demand calibration
ledger estimate is **$0.515594**, not invoice reconciliation. Terminal private
packet `/private/tmp/edison-calibration-capture.YuLWR5` retains exact input,
evidence, original/repaired drafts, checks and charges. Its stage-1 through stage-4
JSON SHA-256 identities are respectively:

- `cbd52ebb9e52d711653425de25fa6ffee2ad2568cbf2b69773c6a29c9589a3c9`.
- `1ea0d31617516c8893fdca466311f3ebfb6f21b91ee6f74047e826c1ee7f0717`.
- `61a8957082a1d6d76b17cb14f4f37a179ee35814ad8268bbd6575fb0fa3ad870`.
- `121a784b1dd90fa5ac42b87dce8bcf588956255ebf37f7a93b3b39eaffb02625`.

The first check objected to the CD19/B-cell explanation not being in cited s1,
and to a neutral heading's clinical claim mapping. The sole repair removed that
explanation, fixed the heading mapping and supplied the title claim map. The final
check supported all 14 authored claims and found promise, fit, continuity, privacy
and metadata passed, with no missed material claims. It nevertheless rejected the
exact body.1 definition **“hypoimmune, meaning engineered for use across recipients”**
as expanding beyond the retained evidence. That paragraph is byte-identical to
the first draft, where the initial complete check marked it supported.

Both check snapshots contain all four sources/12 passages; this is not an absent
final audit or a lost-evidence incident. The first check's CD19 objection concerns
the displayed source mapping: s2 has B-cell context, but the paragraph cited only
s1. Its proposed repair failed to identify the already-retained source as an
available citation repair. Exact unchanged-paragraph/check classification and
editorial severity are under unpaid review. Do not equate “beyond evidence” with
proof of an opposing fact, silently override a failed audit, or manually rescue
the article. This is not current-version reading acceptance.

Independent mechanical diagnosis found no runtime defect: both complete 11-surface
audits and 13/14-claim assessments normalized faithfully; raw provider drafts
assemble exactly into checker input; the original findings reached repair intact;
both fingerprint values recompute correctly. Evidence/context/idea/instructions
were identical, but body.0 and some claim mappings/paraphrases changed, so the full
checker inputs were not identical. Evidence JSON SHA-256 is
`e7320d4908847437dc17d7e5029eccb35b03b6c910d11fbfc5f0094857e9f2ff`;
unchanged body.1 text SHA-256 is
`1ca7aae075b46310dce076ee2d9c62d05cbcd8b3ff333d205d7291abc26b4d1d`.
The pipeline correctly ran a fresh complete final check and withheld on its
material failure, without inheriting a previous pass or adding a second repair.
Inconsistent assessment is established; which semantic judgment is appropriate
requires the separate editorial diagnosis, not an automatic deterministic override.

CoS's direct preliminary read also identifies overgenerous reader-fit acceptance:
the revision removes a useful B-cell explanation despite retained s2 support, leaves
several unfamiliar medical terms/acronyms unexplained for the stated DNA-basics
reader, and repeats limitations in both ending paragraphs. It distinguishes design
intent (“engineered for use”) from proof of successful compatibility and does not
accept the final check's contradiction label on that rationale. These are separate
semantic and useful-explanation findings, not permission to publish the draft.

**New paid work and public rollout are stopped.** No contextual Ask or adapted
article return/reopen occurred. Terminal quota shows zero queued/running requests;
the same replacement guest used two ideas/four articles/one feedback, with original
guest records preserved. The aggregate three-ideas/five-articles sampling plan is
exhausted; no extra principal, quota reset or automatic replacement sample. Broader
topics, mobile rendering, accepted-article Save, current Ask/reading acceptance,
and final public configuration/cron activation remain explicitly unverified.
CTO owns the mechanical diagnosis/record; CoS owns editorial interpretation and
the next bounded prompt/QA calibration proposal. Existing public release remains
unchanged; no new credentials or founder hosting action is required for diagnosis.

## v1.6 protected checkpoint and adapted feedback — 21:27 UTC

Reviewed source `c600d9393a6ae16ff78a61ce0a2efcf87e9addf1` is committed/pushed.
[CI 34060400262](https://github.com/michaelmcguiness/edison/actions/runs/34060400262)
passed (application 21:16:23 UTC; database 21:15:53 UTC), with all three Vercel
Preview contexts successful. Independent verification matched all eight recorded
hashes to shared files, committed blobs and the clean exact-revision copy
`/private/tmp/edison-release-v16.d8gnIA/candidate`.

Ready protected Production pair at that exact revision:

- API `dpl_DKxE4WYPSePEYNock194nVMmAYuf`,
  `edison-i8fnrvnth-mike-michaelmcguis-projects.vercel.app`.
- Web `dpl_25F72uWd9nw9xyg6FXf7ykBApKjS`,
  `edison-fi1dr2zxa-mike-michaelmcguis-projects.vercel.app`.

The same stable calibration alias points to this web, pinned at build/runtime to
the exact API using existing approved trust. Independent 21:22:56 UTC read-back
confirmed anonymous SSO302 on stable/unique web and API, both protections/team
OIDC, unchanged exact Production-to-Production trust, and unchanged public web/API
aliases and production targets. Public API configuration/database/Auth are OK.
Preflights passed; the existing API TLS-verification warning remains.

Immediate cron recovery `dpl_ASYND9pjYLVDdx29S17ifNwBy9oi` is Ready at exact
old `a681331673b416d1267cd27a263222399b5285f1`, demand=false,
`edison-k596u7a8h-mike-michaelmcguis-projects.vercel.app`. All three original
schedules are enabled there with original enabledAt and disabledAt=null. This
verifies binding/configuration, not actual scheduled execution. No public rollout.

Same-origin reload retained the existing guest, loop and prior history. Exact
feedback “Focus on medicine. I know the basics of DNA. Keep future articles concise
and include concrete examples.” succeeded as request
`147ac0f8-4ebf-4108-a918-ec46c562a580`, 21:23:52–21:24:01 UTC. Persisted loop
revision 1 separately records medicine direction, declared DNA knowledge, and
concise/examples preference with exact feedback provenance. UI and stored state
agree; three principles survived reload. Cost is $0.000424. Terminal private
packet: `/private/tmp/edison-calibration-capture.L5lTHC`.

The final adapted ideas request `8353c67c-0a64-4c09-bb20-1b6dea12fa12`
succeeded 21:25:30–21:26:15 UTC, two stages, $0.018377. It offered three medical
cards and withheld one broader unsupported premise. Earlier ideas remain visible,
not rewritten. Terminal private packet:
`/private/tmp/edison-calibration-capture.AOD48x`. Cumulative on-demand ledger
estimate is now **$0.418325**, not invoice reconciliation. Actual idea promises and
evidence are being reviewed before the one remaining selected body request; no
adapted body or contextual Ask has yet been requested. Preserve original quotas,
same guest and stop new paid work on any material failure.

Independent Workflow metadata confirms both feedback and ideas runs completed
without runtime errors on exact `dpl_DKxE4WYPSePEYNock194nVMmAYuf` (21:24:02.448
and 21:26:16.258 UTC). Root/CoS found no concrete false premise in the qualified
lupus brief. The temporary-cell-therapy headline merits more tentative framing;
its explicit no-superiority qualification and engineering-tradeoff payoff do not
establish comparative clinical safety. This is a follow-up, not a new sample.

## v1.5 hosted checkpoint — 20:41 UTC

Exact `60da1482784152fc5a080ba328bf9b5c8cdbef94` is committed/pushed and
[CI 34058363433](https://github.com/michaelmcguiness/edison/actions/runs/34058363433)
is green (application completed 20:36:23 UTC; database 20:36:09 UTC). All three
Vercel Preview contexts succeeded. Independent verification matched all six
recorded hashes to current files, committed blobs and the clean isolated copy
`/private/tmp/edison-release-v15.4zHdu1/candidate`.

Ready protected Production deployments at that exact revision:

- API `dpl_A4A124JPSe21wsA5D2qVqSnfNUpu`,
  `edison-h475znjw7-mike-michaelmcguis-projects.vercel.app`.
- Web `dpl_5qccEniYKV15SLJhZ86Lix2vthyS`,
  `edison-waoucgkiv-mike-michaelmcguis-projects.vercel.app`.

The existing stable calibration alias points to that web; its runtime/build
configuration pins the exact API using the already-approved project trust.
Independent checks confirmed anonymous SSO302 protection, both team OIDC settings,
the exact Production-to-Production trust and unchanged public aliases/targets.
Public health returned configuration/database/auth all OK. Both build preflights
passed; the existing API TLS verification warning remains.

Clean old-source a681331 cron recovery is Ready as
`dpl_4vuYaoLhE9tc5sUwDkmf3evFdm6m`,
`edison-4hz6i520c-mike-michaelmcguis-projects.vercel.app`, demand explicitly false.
All three original schedules were independently verified enabled there, original
enabledAt unchanged and disabledAt=null. No manual cron run or public rollout.

Same-origin reload retained the existing guest, loop and all four cards. The next
previously unselected Bag of Reactions card was selected at 20:41:51 UTC. Request
`edfd42a4-ddb6-4716-a683-f01ecd54518c` / Workflow
`wrun_01M1W79F84K0Y52Z3HH91RKT8F` ended `editorial_withheld` at 20:43:33.918466
UTC. Independent Workflow metadata confirms completion at 20:43:34.344 UTC on the
exact corrected API with no runtime error. **No article was published.**

Four writer/check/sole-repair/check stages cost 42,948 + 6,286 + 54,468 + 6,159
microUSD, **$0.109861**, cumulative on-demand ledger estimate **$0.399524**.
Terminal private packet `/private/tmp/edison-calibration-capture.1JIKsv` preserves
the exact request, evidence, both drafts, both checks and charges. The intermediate
packet `.730XpS` was captured while the final check was running and is not terminal
evidence. Neither packet nor hosted failure record has been rewritten.

Both complete exact-surface checks ran within the existing cap. Initial check
caught unsupported mutual-maintenance/dependency assertions and material heading
mapping; the sole repair changed actual prose and replaced those headings with
neutral labels. The final check still returned repair/promiseFulfilled=false,
two missing claims, six missed assertions, and failed body.0/.2/.4/.6/summary.2
surfaces. Objections include a universal threshold claim, a same-mixture qualifier,
and claims about maintenance/growth/reproduction/evolution absent from the retained
excerpts. CoS is reviewing which objections are substantive versus overly literal
treatment of cautious limitations. Separately, both checks requested classifying
the rhetorical title as nonfactual and removing its map, which conflicts with the
current title contract. **That mismatch is not the sole final failure.**

Further paid calls and public rollout are paused for diagnosis. No feedback or
adapted batch has been submitted; remaining allowance is one ideas batch/one
article, unchanged same guest and all other ceilings. Do not rescue the failed
article, retry with another principal or automatically consume the remaining slot.

### Unpaid v1.6 correction — locally verified and source-reviewed, not hosted

CoS's exact review distinguishes real unsupported global threshold wording from
some overly literal treatment of study-scope caveats. The full primary paper has
substantive results and limitations absent from the retained three windows. Its
reviewed content is diagnostic evidence, not text to inject into old records.

The title contract is being aligned with headings: explicitly neutral/material
authored evidence, independent exact-title judgment, no question-mark exemption
for factual premises, and the same sole repair for mapping defects. Supported
study-scope qualifications remain distinct from unsupported universal negatives.
Prior reading remains continuity context, never a source of factual authority.
The idea check must also assess the reader question, payoff and negative bounds
against the actual retained passages before offering the idea.

Unpaid retrieval diagnosis found concrete query starvation: two abstract-only
discovery leads receive two of the three source windows; the third query truncates
the concatenated brief at 64 distinct terms. This idea has 60 terms before its
qualifications and 74 total, dropping seven of the second qualification's eleven
terms, including reproduction/evolution bounds. A generic facet-balanced approach
is being evaluated against the actual page and constructed diverse-topic cases,
within unchanged three-window/per-source/whole-packet bounds. No selection-quality
improvement is established merely by retaining more query terms.

CoS revised its sampling sequence, not the server quotas or dollar ceiling: after
unpaid source review/checks and protected deployment, use the remaining one ideas
batch/one article for the **fresh adapted journey**, not another unadapted card.
Submit the exact medicine/DNA/concise/examples feedback, verify stored principles,
then the final ideas batch and one selected body; contextual Ask and return/reopen
follow within existing caps. The prior ideas and read v1.4 body/history are the
before-context, with its factual failure explicitly preserved. A fresh unadapted
v1.6 body will be unrun, not manufactured through a new principal or quota reset.
Stop new paid calls if the final output fails materially. Paid hold remains while
the current source correction is in progress; no feedback has been submitted.

Final integration is now complete. CoS closed the bounded title/prompt and retrieval
source review with no concrete residual. The selector separates qualification
facets, prefers substantive result/constraint context when present, rejects short
misleading section lists and preserves same-family lexical fallback when cue words
are absent. Sentence-start alignment avoids orphaned prefixes. Models, network
transport, provider stages, source/packet caps, database and sole repair are unchanged.

Root independently replayed the implementation against the safely fetched cached
page: exact normalized ranges **1–2200, 27557–29705, 38034–40187**, **6,516 JSON
text bytes**, three windows. The actual output retains complete abstract context,
measured crosstalk results and the explicit limited lipid yield/no physical membrane
expansion, together with heterogeneity explanations. No publisher prose is committed
as a fixture. Private output `implemented.json` in
`/private/tmp/edison-passage-diagnosis.eBya7c` has SHA-256
`cb05304c73022c50b0f5b7cef5fba73602490aa1c271b685835456ffd6492002`;
cached-page hash `2af1ee296011bab7c02a3c0e779ce805cc723bbdcae2e2d6271e95b19433e7cd`.
This confirms improved discovery coverage for the inspected case, not model accuracy.

All **367 web + 149 API tests**, both final standalone typechecks, full lint,
diff check and both production builds pass. The API still builds 13 steps/three
workflows. All 13 prior selector tests remain passing; six new regressions cover
qualification starvation with/without cue words, non-paper/TOC/ordinary-explanation
behavior and sentence boundaries. Private comparison confirms both qualification
regressions fail the original selector and pass the corrected one. Constructed
title/publication/replay tests require exact audits and preserve failed material
assessments; they do not certify actual model classification.

Final reviewed SHA-256 identities:

- AI runtime `226698de08f066729d33d6b0b378c9ec9e9fe7f38e7b0701236dc54403ed29a4`.
- Schemas `ed8af685ac11e825944101b02509f1e9871f0f6adc8f1b2e0b424aa49dbec0ec`.
- Prompts `058ad061c2ae49f80cc255aec9722bd2b11fc4493180b4ca5c59d91b544b4140`.
- Selector `7611ce2bc3d601ba16d1ee13120e0577ab49e85fcaa62983fba8bae21626d1d0`.
- Selector tests `8ef1c69aa21f60275fcb8d8905e7ec7645c8cf7fcf7be3cd4ad75152ec7965eb`.
- Title audit tests `319f168d91d864c3949156a299171cff5eb9d3e0aa4d87d0af4be4240a417fc6`.
- Pipeline tests `671538036afae980f04b03f4a6323d65b11a6c8f0b789db4f5640d5347c5c572`.
- Publication tests `7661b9dbaaf95bb631ae0d7111860c3d9287741f78ca5e2fbc53eec5d0eb1763`.

Commit/CI and the same protected deployment sequence are next. No v1.6 provider
call, feedback submission or public rollout has occurred. The final adapted journey
above remains the selected next paid sequence only after that checkpoint.

## Actual v1.4 acceptance false positive — latest finding

Reviewed source `de8ce3d3c8e57635b38e2af87f78855f62881e64` is committed/pushed.
[CI 34056080702](https://github.com/michaelmcguiness/edison/actions/runs/34056080702)
passed at 19:52 UTC (338 web/143 API tests, builds/types/lint and database checks);
all three Vercel Preview contexts succeeded. Independent review confirmed clean
isolated `/private/tmp/edison-release-v14.QxIzWi/candidate` at that exact revision.

Protected API `dpl_DSVxCEymev86fRbKZsLTNe3B2axn`,
`edison-a0w1lvj4e-mike-michaelmcguis-projects.vercel.app`, and protected web
`dpl_E2XatpaspFhY2nzqQP65pUy7i8jy`,
`edison-n73sh3y90-mike-michaelmcguis-projects.vercel.app`, are Ready exact de8ce3d.
The existing stable calibration alias moved to this web; independent anonymous
checks still receive Vercel SSO302. Per-deployment web configuration pins the
exact API via existing approved trust. Public apex/production web target remain
dpl_3pz; public API alias/target remain dpl_JCo. Both protections and exact trust
are unchanged. After staging, clean old a681331 recovery
`dpl_7fJHWRo993aXNsy5i67SheKc1Umo`,
`edison-t3we522si-mike-michaelmcguis-projects.vercel.app`, restored the three
original enabled cron schedules; enabledAt unchanged, disabledAt=null. No manual
cron invocation or public rollout occurred.

The existing guest/loop/Library state survived alias movement and reload. The next
previously unselected card was selected before body generation as agreed. Request
`1c02f1c9-ce65-498a-94d2-89a1c0e6ac8f` ran 19:57:29–19:59:11 UTC and became
`succeeded/ready`. Workflow `wrun_01M1W4R7A94V4V9PF3PVNVR6BN` was independently
verified completed on the exact corrected API at 19:59:12.349 UTC with no Workflow
error (a completed Workflow is not editorial acceptance). Four actual writer/check/repair/check
stages cost **$0.127128** (54,564 + 5,732 + 62,398 + 4,434 microUSD). Total
on-demand calibration ledger estimates are now **$0.289663**. This is not invoice
reconciliation. Exact private packet `/private/tmp/edison-calibration-capture.iVqyFz`
contains all retained stages, input/evidence and final output for CoS review.

The first check correctly caught unsupported co-evolution framing in body.0; the
sole repair replaced it and the final check marked 19 listed claims supported.
However, **CoS rejected the actual accepted result at editorial scope**: summary.1
says engineered tRNAs can be charged *provided* the ribosome–tRNA interface is
redesigned. Retained evidence separately establishes aaRS-mediated charging and
ribosome accommodation; charging is not conditional on ribosome redesign. The
repaired c4 paraphrase changed to supported separate/AND statements while the
summary's unsupported conditional remained. The final checker accepted that weaker
paraphrase. The three unchanged headings were also relabeled material→neutral,
reducing the claim map from 22 to 19. CoS's exact heading review finds body.5
and body.13 factual/interpretive and requiring support; body.9 is reasonably
rhetorical. The tag change is a coverage regression, not proof of three false
headings. Exact final-check hash is
`ccb21a391ba0d061b0760a32a5546f8a0842952c95c8a0f1abc5ceb98a489886`.

**Paid calibration and public rollout are paused** for the smallest systemic
exact-surface/heading QA correction. No new provider request is in flight; no loop
feedback or adapted ideas/article has been submitted. Do not manually rewrite,
rescue or erase the private accepted record or its raw responses/charges. This
sample proves connected delivery, not acceptable factual quality. Current aggregate
remainder was one ideas batch/one article. CoS subsequently clarified that the
aggregate cap was its own sampling limit, not Michael's budget, and revised it
by **one article within the same replacement guest's existing server allowance**.
The current remainder is **one ideas batch/two articles**, total across both
existing guests at most three ideas/five articles; existing server/dollar/model
limits and both principals remain unchanged. This is not a quota reset or new
budget. After source/regression review and corrected hosted deployment, select
the next unselected *When Does a Bag of Reactions Become a Cell?* card before
body generation as baseline. Require useful accepted exact prose, then the agreed
feedback and one adapted batch/article. Stop on a material failure; do not
automatically consume the second article. No extra repair/critique round or
additional paid work beyond that sequence is authorized by this adjustment.

### Bounded v1.5 correction — local verification and source review complete

The checker now receives a deterministic manifest of the actual title, deck,
summaries and all body blocks, including heading text and quote attribution,
plus their authored mappings/citations. A single server-computed fingerprint
binds that manifest and exact why-written copy; the provider echoes it rather
than computing a hash. The strict wire contract requires an assessment keyed to
every material surface. Canonical persisted audit rows accompany the existing
claim checks; final acceptance/publication/replay recompute the fingerprint and
require complete exact-surface coverage. A weaker paraphrase cannot substitute
for that explicit surface assessment. This still relies on actual model judgment;
structural tests alone cannot prove recognition of every semantic defect.

Unknown/unretrieved evidence, stale fingerprints and missing/duplicate surfaces
remain hard validation failures. A valid failed assessment with a missing authored
heading map or a supporting source absent from current display remains repairable
through the existing sole repair. Final acceptance requires all supporting sources
displayed for the relevant surface. A checker-classified rhetorical heading can
have an erroneous writer mapping removed by that repair; factual unchanged/moved
headings cannot evade checking by losing their mappings. No factual verdict or
source evidence is silently rewritten. Question-check wire format remains unchanged.
Models, stages, eight-thousand-token checker cap, budget/usage/replay rules and
database are unchanged. Maximal schema-shaped output is not guaranteed to fit
the token cap; incomplete results fail honestly rather than omitting checks.

CoS independently closed the bounded exact-surface source review, including the
repair-routing and final paragraph/quote versus overall-source-list clarification.
The why-written field is allowed as a privacy/fit finding location, but is not
invented as an externally evidenced factual surface. A regression exercises that
finding through the sole repair and a fresh complete check.

Final local verification: **354/354 web tests, 143/143 API tests, both standalone
typechecks, full lint and both production builds pass**. The initial standalone
typecheck encountered duplicate generated API `.next` type artifacts; successful
production builds regenerated the output, and both standalone checks then passed.
Focused contract/pipeline/publication checks pass 102/102. Constructed assertions
exercise coverage, binding and repair routing, not live semantic recognition.

Reviewed SHA-256 identities:

- Runtime `5b7983af85763a355f2dfb0e6c9a52ccd49446a89c49a23db21caad0aafbd11c`.
- Schemas `baa5c66244cba5f47af42a289d7614a1fb7f5ffa0d94de8ba242f37927ee5a21`.
- Prompt `6ccd2cf4718052dc864e0bae6db134a47cc33a5ec02d63e27c1a1e0562da60f0`.
- Surface-audit tests `bf20c7e70a6e5f22ad0f5fbd42c9365307e8ee6910c70ac87719496a54bfc64a`.
- Pipeline tests `3733e2892c74272041281e865312f665e1cc9da38a80eafed8af9343016c4db0`.
- Publication tests `45b8b79775a16002d4c7fd6f5f8e636dd444171feeafea707a386679098a5fcd`.

Commit, CI and protected deployment are next. This correction is not hosted or
real-output accepted yet. No further paid call has occurred; the same guest and
existing stable alias must be retained for the authorized next baseline.

### Actual desktop evidence and limits

Design directly viewed the accepted article top screenshot at 1280×720 and found
no visible hierarchy/legibility/control-discovery blocker in that crop. The body
and complete numbered Sources list render. At scrollY1440, Back returned focus to
the correct card; reopening restored the same article at scrollY1111.5, and reload
retained1111.5. Nonzero return/identity/reload are verified; exact-pixel continuity
is not. The source link was clicked but no separate publisher tab was observed,
so external source-opening remains unverified. Scrolling for QA is not a reader
learning/mastery result. Screenshots remain private; none are mobile captures.

The browser approval reviewer rejected checking **Save article** as a persistent
mutation without explicit authority. No alternate route/retry followed; accepted
article save is unverified and its state untouched. Earlier failed-idea
save/Library/reload/unsave evidence is separate and remains valid. This is a
verification limit, not proof that the implementation is broken.

## v1.4 integration after actual second failure — current checkpoint

Exact committed/pushed `eeab414927f900950aff9e4428a0313534c4567a` passed
[CI 34053531026](https://github.com/michaelmcguiness/edison/actions/runs/34053531026)
(324 web/143 API tests, both builds/types/lint and 234 database assertions).
The clean isolated deployment copy is `/private/tmp/edison-release-v13.QGxtsl/candidate`.
All three Preview deployments are Ready; protected Production candidates are:

- API `dpl_DqLUVom3BZEHPtGBTKi5jGphpXHL`,
  `edison-gq5rllvgp-mike-michaelmcguis-projects.vercel.app`.
- Web `dpl_9Shr37tEZc2JJQn1o2U7gju8KsAM`,
  `edison-g8ws98v9b-mike-michaelmcguis-projects.vercel.app`.
  Stable protected alias `edison-calibration-mike-michaelmcguis-projects.vercel.app`
  resolves to this exact deployment. It was verified unused before assignment,
  and anonymous requests receive protection302. The same stable alias must move
  to later candidates; no cookie/token transfer or another principal is allowed.

The approved replacement guest was created at 19:10:37 UTC in the normal browser.
Ideas request `6ddf74ef-1896-4ffd-aa3f-71917c615ebc` completed at 19:12:54 with
four supported cards. Workflow `wrun_01M1W25F3E0YKGSM6X5NHR5Z9H` independently
completed on the exact API above. Two actual Luna stages cost **$0.017791**.

The first selected card was *Can a Synthetic Cell Make the Machinery That Makes
It?*, selected before body generation. Article request
`aeaeb6ee-0bfe-4805-b6e3-546725e2cd69` ran 19:14:31–19:15:37 and ended
`editorial_withheld`. Writer → sole deterministic repair → full check cost
**$0.091272**. Workflow `wrun_01M1W29HM440P84PTGCQ98TVSF` independently reports
completed on exact `dpl_DqLUVom3BZEHPtGBTKi5jGphpXHL`, completedAt
`2026-09-06T19:15:37.754Z`, no Workflow error. This is handled application failure,
not article acceptance. Total actual on-demand calibration ledger estimates are
**$0.162535**, not an invoice reconciliation. Original records/charges are intact.

The initial writer omitted ending body claim mappings and consumed the sole repair.
The repaired draft had clipped labels `Nature Communications: “`; the shared
24-character limit made this a repeated structural failure. The final checker
supported all seven listed claims and passed promise/fit/continuity/privacy, but
reported incomplete labels, a missing factual-heading map and a required exact
publication date where retained authoritative metadata was null/unknown. CoS and
independent source review confirmed the failure; no manual rescue or extra round
followed. Exact private packets were supplied to CoS, outside the repository.

### Approved bounded v1.4 correction

Provider writer/repair claims now sit beside their actual title/deck/summary/body
surfaces. Server assembly assigns IDs and positions in traversal order, without
claim trimming/merging; aggregate over 100 fails explicitly. Heading output marks
neutral labels or material claims, and the independent checker still searches all
headings/prose for omissions. Retained source metadata and complete hostname/numbered
labels are server-owned. Article checker wire output no longer supplies a metadata
flag; exact canonical metadata is validated before checking and again at the final
publication gate. No factual verdict, finding or missed claim is overridden.
Unknown optional dates remain null; asserted dates in prose still need support.
Raw durable provider snapshots/usage, sole repair, model/prices/budgets, replay
guards, pipeline/runner contracts, database and public article shape remain intact.

Final local checks pass: **338 web + 143 API tests**, both typechecks, repository
lint/diff checks and both production builds (13 API steps/three workflows).
Actual SDK wire-schema checks confirm strict writer/checker shapes; CoS's separate
bounded source review and prompt review close with no concrete residual. This is
source/test/build evidence, not v1.4 hosted or real factual/prose acceptance.
After source checks, green CI and stable-host deployment, choose the next previously
unselected current card, *Before Rewriting Life’s Code, Can We Prototype a New One?*,
before seeing its body. It is a replacement baseline, not a pass for the failed
PURE article. Then apply the exact loop feedback: “Focus on medicine. I know the
basics of DNA. Keep future articles concise and include concrete examples.”
Only after persisted feedback request the final adapted batch and one article.
**Remaining aggregate window: one ideas batch/two articles**, same replacement
guest, unchanged other ceilings. No more principal creation, quota reset, ad hoc
extra article or historical rescue. Architecture/Health/History/Crypto remain
unrun follow-up benchmarks.

### Real UI and operational limits

The protected eeab414 root renders the demand homepage. Guest Profile → existing
account Profile → Back to edition performs full navigation and restores the same
workspace; this is guest-route evidence, not authenticated account verification.
Saving the failed PURE idea, opening Library and reloading preserves the saved
card, failure status and Library view. No provider request was made by these checks.
Successful article/Sources/Ask/reading-position/adaptation acceptance remains open.
Actual desktop captures are 1280×720. The documented 390×844 viewport override did
not affect actual DOM/image dimensions; mobile rendering is **unverified**, not
a pass. Do not spend further calibration time on alternate rendering workarounds.

API staging again rebound cron hosts, so the established clean old-source recovery
was repeated as `dpl_9F3rBqaDqrvzxqKbo8tkyzZnnn7A`,
`edison-6zx1qtvwi-mike-michaelmcguis-projects.vercel.app`, exact a681331 and demand=false.
Fresh safe read-back confirms all three original schedules enabled there, original
enabledAt `1788629148557`, disabledAt=null, public target still dpl_JCo. No demand
reconciler is active during calibration; direct Workflow pinning is verified,
scheduled demand recovery is not. Public web/API and trust/protection remain intact.

Final rollout must verify API aliases **and cron binding** after promotion; official
promotion documentation does not guarantee cron reassignment. If necessary use the
supported corrected-source Production deploy path, not an undocumented cron patch.
The final public web build needs `NEXT_PUBLIC_API_URL=https://project-fjr95.vercel.app/v1`
and the normal public connection, not the protected calibration web configuration:
legacy account calls are direct browser API requests. Verify that final configuration
separately; do not claim it was established by the protected calibration.
At final rollout, persist the selected production flags in the existing projects
and read them back by name/scope, without exposing secrets, so later normal Git
deployments do not revert to the saved feature-off defaults. Saved configuration
alone is not runtime verification; recheck the resulting deployment. No such
production configuration change has been made during private calibration.

## Real calibration failure and bounded correction — 18:55 UTC

Latest committed source before this correction is `343b474f4bb0adc2ad9e29118409e4630c5a35f6`;
[CI 34051930097](https://github.com/michaelmcguiness/edison/actions/runs/34051930097)
and all three Vercel Preview contexts passed. The actual protected calibration
deployments below remain **f5776ad**, not this newer homepage source. No apex rollout
has occurred.

The first normal-browser guest was created at 18:24:42 UTC. Its first Synthetic
Biology ideas request `d3e3137d-dbe8-492d-afcf-1ae069c6e113` succeeded at 18:31:46:
four researched ideas, one offered after three source retrieval failures. Actual
recorded Luna usage across research/check was **$0.028652**, with two web searches.
Workflow `wrun_01M1VZSXZ3158SZ20Y0JT481HC` independently reports completed on the
exact protected f5776ad API deployment. CoS accepts the offered idea's bounded,
explicitly modeled premise, not a completed article.

Selected article request `5c6a9a09-b017-4b46-b222-b2552b691f99` failed safely at
18:33:04 with `provider_invalid`, after one accounted Terra writer response costing
**$0.024820**. No article was published and no checker/repair ran. The Workflow
`wrun_01M1VZX4D9Q0R0BDMF016W5533` completed on the same deployment because the
application handled the failure; Workflow completion is not article acceptance.
New calibration cost to this point is **$0.053472** (ledger estimates, not invoice
reconciliation). These requests, original responses and charges remain immutable.
Private exact packets are retained outside the repository and supplied to CoS.

Reproduction found a real contract mismatch: one independently retrieved source
could establish an eligible idea, but the legacy writer schema required two. The
writer duplicated that source and runtime validation rejected it. It also omitted
ending claim locations and emitted incomplete inline citation fragments. The
retained abstract/clipped introduction did not support the complete explanation.

The current bounded correction implements prompt version **edison-demand-v1.3**:

- Separate on-demand one-or-more **unique** source schemas; legacy two-source
  contracts remain unchanged. Count alone never establishes evidence sufficiency.
- A parseable initial written draft can carry bounded deterministic findings to
  the same **sole** repair slot, followed by complete structural/factual/payoff
  recheck. No fabricated checker verdict, additional repair loop, uncertain replay,
  failed-record rewrite, model/price change, or admission/usage bypass.
- Full-body-array claim indices include headings. Necessary terms need explanation
  at the reader's declared level; citation labels must be complete and structured.
- Discovery-guided selection now scans the whole independently fetched page for
  up to three distinct actual contextual windows, with hashes/locators/time and
  the same fail-closed **40,000-byte** whole-evidence-packet ceiling. Model excerpts
  remain leads, never relabeled evidence. A fresh read-only primary-paper check
  retains the mechanism and half-life definition; the exact later equal-initial-
  output result is still not retained and must not be asserted without support.
- Current exact-URL diagnosis reproduced `evidence_content_too_large` for all
  three previously unavailable sources. Raw HTML is now capped at **2 MiB** rather
  than 512,000 bytes, with an early declared-size check and streaming byte-count
  cancellation, never partial evidence. All three exact public URLs then retrieved
  successfully (80,593–120,161 normalized characters, 1.3–1.8 seconds). HTTPS,
  hostname verification, public-address checks, DNS pinning, per-hop checks,
  compression restrictions and the 15-second timeout are unchanged.

The final local correction passes **324 web + 143 API tests**, both typechecks,
repository lint and both production builds (API: 13 steps/three workflows).
An independent bounded safety review found no blocking regression in transport,
source validation, sole repair or durable replay/accounting, with 96 focused tests.
CoS directly matched/reviewed the exact v1.3 prompt and retained passages and closed
that source/evidence scope, explicitly excluding real article acceptance. The
Profile correction preserves the exact authenticated `/?view=profile` route and
passes a server-selected return flag: home/logo/back use full navigation to `/`
instead of selecting the legacy client homepage. Five actual isolated callback/
popstate tests supplement the 11 actual-page branch tests; this is not mounted
browser evidence. Final CI, independent Profile closure and corrected protected
deployments are still pending. No new real article has been accepted.

### Corrected calibration origin and remaining allowance

The initial website used an immutable unique Vercel deployment URL, not a movable
alias. Its host-only HttpOnly guest cookie cannot follow a new deployment origin;
Edison does not implement cross-origin guest transfer. No credential export,
injection, new transfer feature or special routing rule is permitted or needed.

CoS explicitly corrected its sampling rule: use **one replacement guest** on a
fresh, stable, protected alias in the existing `edison-app` project. Stop using the
original guest for new paid work. Keep all original records/charges, with exactly
**two ideas batches and three article requests remaining across the correction**
(aggregate original window at most three ideas/four article requests), and existing
feedback/question/global dollar ceilings. This is not a quota reset or new budget.
Verify protection and exact Ready deployment identity before commissioning; retain
the same stable origin for reload/return and any later candidate revisions.

The corrected fresh Synthetic Biology baseline consumes ideas slot two; the adapted
case consumes slot three. Architecture, Health, History and Crypto are explicitly
unrun follow-up benchmarks. Successful baseline/adapted output, real feedback,
connected/rendered continuity and Editorial/Design acceptance still precede rollout.

## Earlier execution update — 18:23 UTC

The earlier preparation/approval holds below are historical. Michael directly
answered **Yes** in the CTO task to the exact Production website-to-API trust
question. The single `edison-api` Trusted Sources PATCH succeeded; independent
read-back confirms only `edison-app` Production → `edison-api` Production, with
Standard Protection (`all_except_custom_domains`) and team OIDC unchanged.

The clean, committed/pushed candidate is now
`f5776ad3b610b959ed1549277ed8dd7417c2e87b`. Exact
[CI 34050221734](https://github.com/michaelmcguiness/edison/actions/runs/34050221734)
passed: 292 web + 125 API tests, both typechecks/builds, lint, all 16 migrations,
234 pgTAP assertions and strict schema lint. All three feature-off Vercel Preview
statuses passed. The detached deployment copy remains porcelain-clean at f5776ad.

After another dry run listing only the reviewed new migration, normal linked
Supabase CLI applied `20260906000100_on_demand_reading.sql`; no seeds or role
files were applied. Independent hosted PostgreSQL 17.6 verification found exactly
16 ledger entries, all eight demand tables with enabled/forced RLS, 20 expected
policies, 27 expected valid indexes and 73 validated constraints. The two demand
roles remain NOLOGIN/NOINHERIT with no elevated attributes or unsafe inherited
memberships; all seven security-definer helpers retain `search_path=pg_catalog`.
The previously verified encrypted backup and restore rehearsal remain the
recovery checkpoint. No historical publication/correction operator was rerun.

The protected API candidate built successfully in the existing project:
`dpl_6KwD5JV9CZv8uiNHNTQJaeJyEu5x`,
`https://edison-l9i8daac3-mike-michaelmcguis-projects.vercel.app`.
It carries exact source metadata f5776ad, Production identity and the per-deployment
on-demand flag. Its build registered 13 steps/three workflows. Anonymous health
receives the protection redirect (HTTP 302), not application health.

### Observed staged-deployment side effect and recovery

**`--prod --skip-domain` is not cron-isolated.** It preserved the public API alias
`project-fjr95.vercel.app` and `targets.production` on old `dpl_JCoE2yh9oxwA56wcjJu1JULq4hC6`,
but moved the automatic API system alias and all three cron hosts to the staged
candidate. Execution paused before any guest/provider request. Feature-on cron
code intentionally skips legacy daily-edition creation and adds demand recovery,
so this was a real operational difference, not merely cosmetic metadata.

The inspected public API/CLI offers no supported direct setter for the cron
deployment ID; documented Instant Rollback does not update active crons. Recovery
therefore used a separate clean copy of exact already-live `a681331673b416d1267cd27a263222399b5285f1`,
deployed with `--prod --skip-domain` and explicit on-demand=false. Successful
recovery deployment `dpl_2ipCwaY1wcg1d14V3GVZQT4zKXsY` uses
`https://edison-1496kct6u-mike-michaelmcguis-projects.vercel.app`.
Fresh read-back confirms all three original schedules enabled on that old-code
deployment, with original enabledAt and disabledAt=null. This restores the old
behavior on a new deployment ID; it does not claim the original cron ID was restored.
No job was manually invoked or disabled, and public domains were not promoted.

The f5776ad API candidate remains retained and uniquely pinned for testing. The
recovery cron host does not contain its on-demand reconciler; connected calibration
must distinguish direct deployment-pinned Workflow success from scheduled recovery.
Final API rollout must explicitly verify the intended cron binding/behavior.
Public web still returns HTTP 200 and the unchanged public API reports configuration,
database and Auth `ok` after the hosted migration/recovery.

The normal browser attempt to open the staged API health URL returned
`net::ERR_BLOCKED_BY_CLIENT` and left about:blank. No authenticated health check,
browser bypass, credential extraction or provider execution followed. The actual
web candidate is separately building in existing `edison-app`, with no public-domain
promotion and its protected upstream pinned to the exact f5776ad API URL.
Web `dpl_5QAFAsqG5Ch1o2NsMtzxy2E9xwCM` subsequently completed successfully at
`https://edison-3ole3xlb9-mike-michaelmcguis-projects.vercel.app/demand`, exact
f5776ad; anonymous requests receive protection302. Its actual browser UI opened
and reached the first-loop dialog after the normal session request. This verifies
the real workspace connection, not article generation. A raw workspace JSON-page
navigation was also blocked by the browser; it was not retried or bypassed.
The same normal UI guest is retained for calibration. Full connected/rendered/provider
acceptance and final homepage rollout remain unverified.

The follow-up source checkpoint adds only a live-mode/exact-server-flag branch in
`app/page.tsx` and seven actual-page branch tests in `tests/home-page.test.ts`.
When enabled in live mode, `/` renders the unchanged DemandReader; otherwise the
existing setup/demo/Pulse guest/auth branches are preserved. `/demand` and its
scoped CSS are unchanged. Independent local checks passed: 299 web tests, root
TypeScript, focused lint, diff checks and production web build. This root mapping
is not in either staged f5776ad deployment; publication still awaits real acceptance.

## Candidate and access

- Source `81ac1362d685114bf7c93a1628cc50b566e687bd` is committed and pushed
  on `codex/production-release-candidate`, PR #1. Exact
  [CI 34047355450](https://github.com/michaelmcguiness/edison/actions/runs/34047355450)
  passed: 285 web and 125 API tests, types/lint/both production builds,
  all 16 migrations on disposable Supabase PostgreSQL 17, 234 pgTAP assertions,
  publication/correction replay checks and strict schema lint. Three Vercel
  Preview builds passed. These are not real-provider or hosted acceptance.
- Vercel CLI 59.11.7 sign-in succeeded and `whoami` independently returned
  `mike-9085`. The consumed/expired device-code screen is not an access blocker;
  do not start another login. Existing GitHub and Supabase CLI access works.
- Current live web remains `dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt` (`a08c6a1`),
  API remains `dpl_JCoE2yh9oxwA56wcjJu1JULq4hC6` (`a681331`). Existing apex,
  temporary aliases, `www` redirect, authentication and CORS are unchanged.

## Database recovery checkpoint — verified logical scope

At 17:32–17:48 UTC, the normal authenticated Supabase CLI independently reported:

- Project `bcxxnntastmnormcmxbq`, latest physical backup `1591076979`,
  `COMPLETED`, `2026-09-06T04:37:37.117Z`; PITR disabled.
- A fresh linked dry run found exactly
  `20260906000100_on_demand_reading.sql` pending. No hosted migration applied.
- The new migration's reviewed SHA-256 remains
  `908ad32d67b7f45ce7127559ebf9bcc57f36bf3301a31972d74099053a861cad`.

The standard CLI dump needed unavailable Docker. A bounded native alternative
used the official CLI's temporary `cli_login_postgres` connection in memory,
direct port 5432, and PostgreSQL 18.6 `pg_dump` custom format. No saved Vercel or
Supabase password was read, and no credential or private row was logged.
An initial `verify-full` connection failed without the Supabase CA and was not
downgraded. The public CA URL was independently verified in Supabase's official
dashboard source; the CA fingerprint is
`807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`.
The successful connection used that CA with certificate and hostname verification.

Checkpoint at `2026-09-06T17:42:37.184Z` includes `public`, `private`, `auth`,
`storage` and `supabase_migrations`. Its 377,266-byte custom archive was encrypted
in memory with AES-256-GCM; encrypted size 377,308 bytes and SHA-256
`cb5f5c5f23492525497ff97fd52e7ebdd5fe200a8e0dd4f2c4f96692ed071375`.

Decryption/authentication and a single-transaction restore passed in 123 ms on a
fresh PostgreSQL 18.6 server using only a private mode-0700 Unix socket, no TCP
listener. The bootstrap supplied platform role names plus pgcrypto/uuid-ossp,
not Edison tables/functions or fixture content. All 59 restored tables and
190 rows matched current production counts and ordered content digests.
The exact new migration also applied successfully to that restored current-data
copy: eight new tables have forced RLS, with zero invalid indexes/constraints.

The encrypted archive and verification metadata are retained outside the cloud
account at the owner's private Mac folder:
`~/Library/Application Support/Edison Reader/Backups/2026-09-06T174237Z`.
The newly generated recovery key is stored separately in macOS Keychain; exact
new-item access was verified without displaying it, and its temporary plaintext
file was removed. The disposable restored database was stopped and deleted,
and the read-only PostgreSQL tools were unmounted. No database backup or key is
committed. Temporary scripts and non-secret evidence are under
`/private/tmp/edison-backup.h5VE2S`. A subsequent live check returned web HTTP 200
and API health with configuration, database and Auth all `ok`.

Limits: this verifies logical data/schema recovery and a current-data migration
rehearsal, not a hosted physical/PITR restore, PostgreSQL-17-specific restore,
Supabase service restart, or the operational four-hour end-to-end RTO. Platform
configuration and role passwords are not in this checkpoint. Storage object
bytes are not included; Edison has not enabled reader uploads. The Mac is
off-site relative to Supabase but not an independently replicated backup service.

## Protected candidate access — prepared, not activated

Read-only Vercel metadata confirms the existing Pro team
`team_0xvYbZHBkFF23haxovoQT8KC` (`mike-michaelmcguis-projects`) is unblocked:

- Web `edison-app`: `prj_TLrYocZ2r6okKwPr59ht2XQo8bmp`.
- API `edison-api`: `prj_BDlcI2KFhFawilRiMDvloXcOLnsd`, root `apps/api`,
  source files outside root included, Node 22, region `iad1`, frozen install
  and existing production preflight retained.
- Both use Standard Deployment Protection (`all_except_custom_domains`) and
  already have OIDC enabled with the team issuer. API `trustedSources` is null.
- The API's three existing crons remain enabled on the old live deployment.
  Their deployment binding must be rechecked immediately after any staged
  Production deployment; `--skip-domain` is not documented as cron-inert.
- The on-demand flag is not saved in the API project and remains off live.

The existing browser proxy enforces browser same-origin and sends that origin
to the API. It does not forward Vercel deployment-authentication credentials.
Therefore two protected staged deployments cannot currently complete the real
browser reading flow just by changing configuration. CLI-created guest state
also does not automatically share the browser's HttpOnly session cookie.

A bounded default-off connector is implemented locally for Vercel Trusted Sources:
short-lived server OIDC, explicit pinned protected API target, existing browser
same-origin enforcement, no client-supplied trusted token, and no upstream Origin
on this authenticated server-to-server leg. Normal production proxy behavior
stays unchanged. The proposed trust rule is solely existing web **Production**
to existing API **Production**; it is project/environment-wide, not bound to
one deployment. No static secret export, CORS expansion or paid protection
upgrade is proposed.

It directly pins existing locked `@vercel/oidc` 3.8.5. The actual route uses only
the SDK's synchronous `getContext()` request identity, never the async token
refresh helper, local credential storage/CLI or environment-token fallback.
Missing, malformed or expired context fails closed with a generic 503. Thirteen
focused tests cover the actual route, forged browser headers, fake environment
fallback, pin mismatch, body/cookie/origin rejection, normal-mode behavior and
response-header isolation. Root also reran 292 web and 125 API tests, both
typechecks, repository lint and both production builds successfully. The API
build registered 13 steps and three workflows. Exact committed-candidate CI
follows separately; the frozen connector has not been hosted or activated.

Frozen connector file hashes:

| File | SHA-256 |
| --- | --- |
| `lib/demand-proxy.ts` | `9734bed749b6a767f031cffd3396c9c13a3f2a5da3403f284c5a104f2dff5cc5` |
| `app/api/demand/[...path]/route.ts` | `b6f0e4256cb438d26d3913ce0bc07cb4a3b3d2a9484a5854217edc6365ad9f38` |
| `tests/demand-proxy.test.ts` | `ba90a7f7abb5e23b18bb90742b2672e08118609740b220d4f4e8937e52cb052a` |
| `package.json` | `635a0493d1e35de422df71ff8377c546d236a2b4cfd6cd6a2c47e8600e2939ec` |
| `pnpm-lock.yaml` | `84778cbd5b8caa9edea5874a94f0465064b519a506b80d0a700291f742ed9f7d` |

Automatic approval review in Chief of Staff rejected activating this protected
access-boundary change without Michael's explicit approval of the exact target
and scope. No trust setting or authentication path has been enabled. Finish the
reversible code/tests and reviewable configuration proposal, but do not activate
or work around the rejection. Chief of Staff coordinates the necessary owner
approval. Existing unrelated release authority remains intact.

## Earlier preparation sequence — historical, superseded by current checkpoints

1. Close/review the opt-in connector tests and exact scoped access decision.
2. Recheck the single pending migration and apply under preserved release
   authority once the protected execution path is available; verify hosted roles,
   RLS, schema and enabled health on the new candidate.
3. Stage existing API/web without domain promotion, verify anonymous protection,
   exact deployment identity and unchanged crons/live aliases.
4. Use one normal browser guest session for real Synthetic Biology baseline and
   adapted reading and the shared Design checks. Retain prompts, evidence,
   drafts/checks/sole repair, outcomes, latency and observed accounting for CoS.
   Preserve rolling per-reader/global limits; no quota resets or extra principals
   to bypass them. CoS selected the baseline/adapted pair plus one genuinely
   unrelated fresh topic (Architecture is suitable) for the first three-batch
   window and initial release evidence. The broader Health/History/Cryptocurrency
   before/after matrix remains an explicitly unrun follow-up editorial benchmark,
   not an artificial 24-hour release hold. Actual observed failures still block.
5. Complete connected/rendered and real-output acceptance, then the requested
   apex rollout, post-deploy checks and documented application recovery path.

At that earlier preparation checkpoint, no real on-demand provider call, hosted
migration, explicit new deployment, domain change, invitation, purchase or quota
change had occurred. The current execution sections above supersede that status.
