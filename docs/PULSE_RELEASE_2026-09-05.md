# Pulse + loops production release evidence

## Scope and current gate

Michael approved implementing the selected v5 and releasing it to the existing
production web/API projects. See the approved brand handoff. The apex demo and
domain configuration remain unchanged. No additional reader, paid service,
provider batch, or quota reset belongs to this release.

Candidate `f6b7bb1cb49244c28f37f70519b97184510708a9` is pushed on
`codex/production-release-candidate`, draft PR #1. Node 22 CI run
[33995500057](https://github.com/michaelmcguiness/edison/actions/runs/33995500057)
is green, including application tests, both typechecks/builds, lint, disposable
database migrations, 165 pgTAP assertions, strict schema lint, and real
publication/correction apply/replay/fail-closed rehearsals. `main` remains
`e559a6b5bb9811ea603e28ab976f3ca18d86dbc3`, unmerged.

The prior candidate `c354092` passed the application builds and migration/pgTAP
checks. Its new public-publication rehearsal failed before writing: the native
Supabase query command accepts one prepared statement, not multiple commands.
The corrected operators use one atomic `DO` statement and a separate read.
No live data was affected by that failed CI rehearsal. A second local-CLI
write-output parsing mismatch was corrected in `4080fc7`; write commands and
row-returning queries are now handled separately. The complete CI gate passed
before the hosted mutations below.

## Data and recovery checks

Read-only production precheck on the linked project `bcxxnntastmnormcmxbq`:

- 13 existing migrations; only the new loop and correction migrations pending.
- 0 existing learning loops and 0 public starter editions.
- 0 share records and 0 conversations for the owner article to be corrected.
- Dry run lists only `20260905201500_learning_loops.sql` and
  `20260905223000_article_correction_audit.sql`.
- Supabase scheduled-backup UI still shows September 5 at 04:35:02 UTC and
  September 4 at 19:54:12 UTC. Recovery from backup has not been rehearsed;
  the latest listed backup predates the owner article.

The loop migration is additive and guards owner membership, immutable curiosity,
revisioned direction/undo history, published public-article references and
retained-loop capacity. Generation retains the existing owner quota and stale
context guard, with exact loop revision and bounded prior article context.

The correction migration keeps before/after snapshots in a private audit table.
Application roles cannot read the raw audit. Only an active owner can obtain
the note/date for a published article through the narrow disclosure function.
Existing shares, conversations or unexpected original drift block this specific
operator correction. It never rewrites share history or calls the provider.

## Approved publication identities

The accepted public JSON fixture remains SHA-256
`befacbb9de80a33f10df45f9d44f057e67307d42f72dd1cb24dc3182bc83a932`.
The revised single-statement publication SQL is
`77f5d9848f55d8eb2705bf32e8c6f790b2dba65aaa0f3ffdecb0d7dc2077d50a`.
Only the accepted Sleep and History articles are present. Publication completed
at `2026-09-05T22:15:29.572Z` with edition
`dfe2cd80-07f0-4428-bc95-3d61c0701aed`:

- Sleep: `d7b98e46-21a1-49f0-a205-f73320a0631d`, snapshot SHA-256
  `38050ea2a01b61f8345a6bb14aaf463ae7475b98a1b6d774ec7d2f55a936f3b5`.
- History: `fb3d3f0a-5a3c-4fc2-a3be-cc68330b4900`, snapshot SHA-256
  `724b751c18776faa6d9009ee65e189881466d4d6235852eecc2190bd0b50495c`.

The real unauthenticated API current-edition response was compared in full
against the accepted fixture, including snapshots, order, reasons and date.
Chief of Staff independently confirmed the hosted snapshots. The verified
binding is committed in `content/public-starters/published-sleep-history-v1.json`
and `lib/prepared-catalog.ts`; the two approved artworks use these exact IDs.

The accepted private correction artifact remains outside Git. Its operator v3
SQL hash is `1ab2c296daa9b493d10a6be207e3fd3f6204c9a42fdcdc4a250aa2a96049d88d`;
the separate result-read SQL hash is
`0f5d8c6deb449f62c48f030fac760aaaff1a641beb7e0f08fd8bb772e5d6f95a`.
Earlier prepared operator v1/v2 files are obsolete and must not be executed.

The private correction applied at `2026-09-05T22:15:35.312786+00:00` to owner
article `e8c579c1-5908-4a10-a88b-e9740da8e9fb`, now titled “Electricity Is
Becoming a Bottleneck for AI.” Its accepted artifact SHA-256 is
`4f30c1ce0338e00259bbb7310e99be2cc7b9ba0fc4e9e837143895c40667152c`.
The original is retained outside Git and in the protected audit. This was an
accepted manual editorial correction, not a new provider generation or proof
of an improved automated writing process.

Post-write read-only audit: 15 applied migrations, 2 public articles, 1 published
public edition, 1 correction audit, 0 invalid constraints. The API can execute
the narrow disclosure function but cannot read the raw audit table. Generation
jobs remain 4, usage rows remain 1, recorded cost remains 62,654 micro-USD.
No quota reset, new generation, provider spending or invitation occurred.

## Interface review and remaining verification

Design's bounded source review found and reconciled contrast/reset specificity,
full-card opening, explicit Curate target, narrow-screen menu containment,
truthful finite inventory, Library/Profile typography, actual browser-history
returns, restored card focus and frozen Next source labels. CoS's two guest
truthfulness/data-retention corrections are included in `36c16d9`: device-only
direction disclosure and rejection of differing-curiosity title collisions.

Source and static-markup tests are not rendered evidence. Actual HTTPS testing
of f6 at 1280×720 confirmed two matching image cards and accessible full-card
buttons, Save/Library with explicit device-local scope, article → Library → Back
→ article → Back → original feed/card focus, actual Sleep → History Next and
finite ending, Sleep/History loop matching, deduplicated two-card For You,
explicit Curate target, saved direction after reload, real undo, public Ask's
unavailable-live-answer disclosure and retained per-tab draft. Article scroll
was 720px before and after a full reload after hydration; frozen Next retained
the History source label. Profile honestly disables account-only controls.

Design's separate actual 320/390px checks confirmed no horizontal overflow,
legible cards, a contained new-loop dialog and reachable fixed Curate. Actual
QA identified dialog-close focus returning to BODY and several styling
leftovers. A bounded web-only follow-up restores exact opener focus for Curate,
new loop and Ask, uses heading-first route focus without hiding control rings,
removes the Pulse-only legacy body border, restores Inter dialog descriptions,
and leaves one composer focus ring. Hosted verification of that follow-up is
still pending at this checkpoint. Local prototype/headless/proxy rendering
remains prohibited.

The controlled browser does not contain the owner's signed-in session; do not
extract credentials or claim authenticated rendered acceptance from database
metadata. Owner reading/Q&A/share/direction and correction-note rendering,
provider-dashboard reconciliation, backup restoration, and any unsupported
zoom/native-mobile-keyboard checks remain distinct from guest acceptance.

The existing production targets remain `https://project-qlqve.vercel.app`
(web) and `https://project-fjr95.vercel.app` (API). Explicit Production rebuilds
with existing Production variables are required; never promote the
credential-free Preview build.

## Hosted deployments and negative security checks

Both explicit cache-free Production rebuilds of exact f6 were Ready:

- API: `dpl_4SBpQxDpes2wrnpGFpJ1z2AWEyHf`, 22:23:54 UTC,
  `edison-mzg3h5nfg-mike-michaelmcguis-projects.vercel.app`.
- Web: `dpl_ArHbfeAQeHmREgBQjkN91ivL977h`, 22:29:22 UTC,
  `edison-kp3is9p19-mike-michaelmcguis-projects.vercel.app`.

Independent read-only API smoke window 22:29:03–22:30:44 UTC:

- Health 200, configuration/database/Auth all ok; request
  `69bfb5ea-0775-44dd-bae9-acbce5f6c982`.
- Unauthenticated loops and private owner article both 401; requests
  `8c6fea13-f52c-4c99-9aac-f73f0668eddb` and
  `4238bb76-64fa-4f48-9c0e-23efa9020ce0`.
- Exact web origin OPTIONS 204, request
  `11416ba7-61a5-434a-ae34-b7f466f10296`; unapproved origin 403 with no
  reflection, request `b3067829-45fa-42ae-877d-6fa353108882`.
- All six missing/deliberately fake-token checks across the three cron routes
  rejected with 401. No valid cron invocation was made.
- Current public edition and both public details returned 200. API responses
  retain no-store, strict CSP/HSTS/nosniff/frame-deny headers.
- Apex homepage returned 200 and its equivalent API path returned static 404;
  it is not serving the new API.

Retain prior web `dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` and API
`dpl_12vWp1rShga96hTQ1yJzu8VTiRYh`, plus both f6 deployments, as rollback
checkpoints. Do not roll back additive schema or accepted immutable content as
part of a UI rollback. No domain configuration or `main` change occurred.
