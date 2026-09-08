# Pulse + loops production release evidence

## Scope and current gate

Michael approved implementing the selected v5 and releasing it to the existing
production web/API projects. See the approved brand handoff. Michael subsequently
authorized putting the live app at `edisonreader.com` too; the completed
configuration-only cutover is recorded below. No additional reader, paid service,
provider batch, or quota reset belongs to this release.

The initial API/content/web release is
`f6b7bb1cb49244c28f37f70519b97184510708a9`, pushed on
`codex/production-release-candidate`, draft PR #1. Node 22 CI run
[33995500057](https://github.com/michaelmcguiness/edison/actions/runs/33995500057)
is green, including 234 application tests (151 web + 83 API), both typechecks/builds, lint, disposable
database migrations, 165 pgTAP assertions, strict schema lint, and real
publication/correction apply/replay/fail-closed rehearsals. `main` remains
`e559a6b5bb9811ea603e28ab976f3ca18d86dbc3`, unmerged.

The final web-only follow-up is
`a08c6a1a346f281182f23214500bc93e72075243`. Full Node 22 CI
[33996724371](https://github.com/michaelmcguiness/edison/actions/runs/33996724371)
passed at 22:46:24 UTC: 236 application tests (153 web + 83 API), both
typechecks/builds, lint, 165 pgTAP assertions in 7 files, real publication/
correction apply/replay/history guards and strict schema lint. Only web code,
focused web tests and documentation changed from f6; no API or database source
changed. The later API rebuild uses the same runtime source with the approved
domain configuration; it does not require another migration or publication.

## Completed apex cutover

Michael's explicit request, “can we deploy it at edisonreader.com too plese,”
was verified in Chief of Staff's original user message
`01a073c8-52bc-7f90-adc8-0447fa602586`. This superseded apex-demo preservation
for the existing named domain and its existing www redirect. No new service,
purchase, source-code change, invitation, provider call or database write was
needed. `main` remains unmerged; both temporary service URLs remain available.

- Live web: `https://edisonreader.com` and
  `https://project-qlqve.vercel.app`, both the already verified a08 Production
  deployment `dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt`.
- `www.edisonreader.com` retains its 308 redirect to the apex. Vercel's **Move
  2 domains** moved the apex and its redirect together from `edison` to
  `edison-app`. A fresh settings reload confirms all three domains Valid
  Configuration, apex/temporary alias connected to Production, www redirecting.
  The old credential-free demo is retained on `edison-lake-phi.vercel.app`;
  no demo environment or DNS/mail record was edited.
- API: `https://project-fjr95.vercel.app`, explicit cache-free Production
  rebuild of `a681331673b416d1267cd27a263222399b5285f1`,
  `dpl_JCoE2yh9oxwA56wcjJu1JULq4hC6`, Ready **23:10:44 UTC**.
  Deployment URL: `edison-aoo0v1irc-mike-michaelmcguis-projects.vercel.app`.
  The source is the docs-only closeout after a08; its full CI
  [33997300441](https://github.com/michaelmcguiness/edison/actions/runs/33997300441)
  is green. This rebuild was necessary to activate changed Production Config,
  not to release the documentation. It was not a Preview promotion.
- API `WEB_APP_URL=https://edisonreader.com` and
  `CORS_ALLOWED_ORIGINS=https://edisonreader.com,https://project-qlqve.vercel.app`.
  Web API URL remains `https://project-fjr95.vercel.app/v1`. All credentials,
  owner-only email allowlists, models, quotas and budgets are unchanged.
- Supabase Site URL is `https://edisonreader.com`; fresh-reload verification
  shows exactly four allowed URLs: `/auth/callback` and `/auth/confirm` on
  each of the apex and temporary web origins. No wildcard, additional user,
  email-template change, invitation or sign-in email was added.

Independent API smoke window **23:10:58–23:11:21 UTC**:

- Health 200: `0b6c1cc7-4907-458d-8f4e-5b7aa43004c6`.
- Apex preflight 204 with exact reflection:
  `38908204-24b4-49c7-87f6-6466238d2250`; temporary web preflight 204:
  `a0ffac35-a5e0-4e74-8537-490eadb1bddd`.
- Unapproved origin 403 without reflection:
  `21b94026-d9e5-4a3f-8b60-26f0d6fa2cbd`.
- Unauthenticated loops and private owner article 401:
  `3205cc32-a970-475f-bcc1-61cd061fd453` and
  `a2879b80-63a8-40f6-bef2-4b112766655b`.
- All six missing/deliberately fake-secret checks across the three cron routes
  return 401. No valid cron invocation was made. Requests:
  `00a00f96-bbc6-4af7-9ee2-d8aaabb64be7`,
  `2652fd4c-f36d-4f64-8ef8-3610276e8d54`,
  `de125ac8-91d3-4d8d-b026-d19e37a806d4`,
  `d509fa33-bf47-4a9a-bbcf-735bc7cf0ee7`,
  `3f9b7864-6d9a-4ea1-bee3-25b1aac6ab55`,
  `ccf5e3a4-4c08-45f5-8ddf-2de0bff77818`.

Independent DNS/TLS/HTTP smoke window **23:14:28–23:15:54 UTC**:

- Apex and retained temporary web return HTTPS 200, private/no-store and
  nonce CSP, with the exact a08 deployment marker and Pulse shell, not the
  sample/demo. HTTP redirects to HTTPS. Normal TLS verification passes on
  all tested surfaces (`ssl_verify_result=0`, no bypass).
- www 308 preserves `/reader/path-check?cutover=1&retain=yes` through both
  HTTPS and HTTP-to-HTTPS chains to the apex. The deliberately nonexistent
  test path ends in the expected 404; it is not an application failure.
- Missing-code `/auth/callback` returns 307 to `/login?error=missing_code`;
  missing-token `/auth/confirm` returns 307 to `/login?error=invalid_invite`.
  Each stays on its requested origin, for both apex and temporary web.
- API HTTP redirects to HTTPS health 200 with configuration/database/Auth
  all ok. Its public root exposes the exact new API deployment marker.
- Mail SPF, MX and public DKIM match on system resolver and 1.1.1.1;
  nameservers remain ns1/ns2.vercel-dns.com. Vercel edge A records rotate;
  do not pin the observed edge IPs or edit mail DNS for this cutover.

Root's actual HTTPS browser shows the two accepted artwork cards on the apex,
opens the complete Sleep article and its six sources, and follows Next to
History with the correct finite ending. Script URLs carry the exact a08 web
deployment marker. Profile still reports this controlled browser signed out;
no authenticated rendered acceptance is inferred. Guest storage and existing
sessions are origin-local, so using the apex may require ordinary fresh sign-in
without a repeat invitation. No guest-data migration was attempted.

Rollback remains available by moving the two domain bindings back to `edison`
and restoring the prior exact non-secret origin configuration if a genuine
incident requires it. Preserve all prior deployments and accepted data; domain
rollback does not authorize undoing schema/content or exposing credentials.

## Initial release build history

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

Design's separate actual 320/390/760/1024/1280/1440px checks confirmed no
horizontal overflow, legible cards, contained dialogs and a reachable fixed
Curate. A three-loop, long-active-title menu remained within the 320px viewport,
and Library/Profile and the sticky article toolbar were verified. Actual
QA identified dialog-close focus returning to BODY and several styling
leftovers. A bounded web-only follow-up restores exact opener focus for Curate,
new loop and Ask, uses heading-first route focus without hiding control rings,
removes the Pulse-only legacy body border, restores Inter dialog descriptions,
and leaves one composer focus ring. The follow-up is now live. Root verified
the actual successor's deployment marker, 0px Pulse body border, H1 route focus
without the whole-main outline, Ask's corrected punctuation, and both Escape
and the close button returning focus to the article Ask button. The button
retained its visible 2px focus ring. A test question draft was cleared through
ordinary keyboard editing and stayed empty after reload; article Back still
returned focus to the original Sleep card. Design's focused successor recheck
is recorded separately in its implementation review. Local prototype/headless/
proxy rendering remains prohibited.

Design's focused actual-a08 recheck closed all five findings: desktop
heading-first focus and white canvas, Curate/Add-loop exact trigger focus on
Escape and close-button activation, Inter descriptions, and a single outer
composer focus ring at 320/390px. The 320px dialog stayed at x16–304 with no
overflow; Profile also retained the white canvas and heading focus. See
`docs/brand/PULSE_LOOPS_IMPLEMENTATION_REVIEW_2026-09-05.md` for separately owned
measurements, chronology and evidence limits. No further application change was
required after a08. Documentation-only closeout is not another app release.

The controlled browser does not contain the owner's signed-in session; do not
extract credentials or claim authenticated rendered acceptance from database
metadata. Owner reading/Q&A/share/direction and correction-note rendering,
provider-dashboard reconciliation, backup restoration, and any unsupported
zoom/native-mobile-keyboard checks remain distinct from guest acceptance.

The bounded approved Pulse release is live and guest-tested, not a certification
for broader external readers. Chief of Staff owns prioritizing the remaining
owner/operational acceptance. No generic release approval, secret edit or
repeat sign-in invitation is pending. Test-only guest data stays on this
controlled browser: Sleep/History loops, the restored-empty Sleep direction,
and Design's clearly named long-label QA loop. No account loop was created by
these guest checks.

The production targets are `https://edisonreader.com` and retained
`https://project-qlqve.vercel.app` (web), plus `https://project-fjr95.vercel.app`
(API). Explicit Production rebuilds
with existing Production variables are required; never promote the
credential-free Preview build.

## Hosted deployments and negative security checks

Both explicit cache-free Production rebuilds of exact f6 were Ready:

- API: `dpl_4SBpQxDpes2wrnpGFpJ1z2AWEyHf`, 22:23:54 UTC,
  `edison-mzg3h5nfg-mike-michaelmcguis-projects.vercel.app`.
- Web: `dpl_ArHbfeAQeHmREgBQjkN91ivL977h`, 22:29:22 UTC,
  `edison-kp3is9p19-mike-michaelmcguis-projects.vercel.app`.

Final web-only a08 Production rebuild was Ready at **22:49:02 UTC**:
`dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt`,
`edison-6k95wqcyc-mike-michaelmcguis-projects.vercel.app`.
At that checkpoint the stable web URL was `https://project-qlqve.vercel.app`;
the later cutover retained it alongside the apex. It was rebuilt
explicitly with saved Production variables and build cache unchecked, not
promoted from credential-free Preview. Root observed this exact deployment
marker in the actual site's script URLs.

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

Independent f6 web inspection at 22:43:34 UTC returned 200 with private/no-cache/
no-store and a nonce CSP; all 13 script tags carried the matching nonce. Both
approved PNGs returned 200 as image/png. At 22:43:51 UTC the apex returned the
explicit sample/demo notice and four-story sample edition, with no Pulse shell,
Curate or new artwork paths. The subsequent a08 rebuild affected only edison-app.

Retain prior web `dpl_Eqed7bwPxcNaEACSj2Nxx8WtzRwZ` and API
`dpl_12vWp1rShga96hTQ1yJzu8VTiRYh`, plus both f6 deployments, as rollback
checkpoints. Do not roll back additive schema or accepted immutable content as
part of a UI rollback. No `main` change occurred. Domain configuration was
unchanged during this initial release; the later authorized cutover above
supersedes that routing state.
