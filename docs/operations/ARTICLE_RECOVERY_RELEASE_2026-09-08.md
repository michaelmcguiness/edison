# Article connection recovery release — 2026-09-08

Owner: CTO. Scope: the reported article connection error, two server transaction
wrappers, bounded client recovery, and sanitized proxy diagnostics. D49 invitation
redesign remains queued. D48 strict-six-digit Auth rollout is excluded.

## Observed incident, not inferred editorial failure

- At 14:19:46 UTC the article web request returned 502 and its matching API request
  returned 504. The API runtime reports a 300-second timeout. An invitations read
  and both five-minute reconciliation routes also timed out at 300 seconds.
- The web proxy has a 25-second upstream timeout. Its old logs did not retain the
  caught error or elapsed time, so the specific web timeout remains an inference.
- A narrowly scoped, read-only database lookup found no saved article admission
  from that original attempt. The same idea had one later saved article request,
  created at 14:56:56.498 UTC and failed at 14:58:06.045 UTC with `provider_invalid`.
  These are separate events; the later job must not be attributed to the original
  connection timeout.
- The later job retained four successful provider-stage receipts: writing 26.697s,
  first check 14.190s, repair 13.444s, final check 11.198s. Admission to first stage
  was 1.628s; total request lifetime was 69.546s. A successful provider-stage
  receipt does not establish editorial acceptance. No first-token timing is saved.
- The final saved checker says `pass`, with matching artifact fingerprint and two
  nonmaterial findings. A read-only Boolean comparison proves its deck finding
  does not quote that deck, even ignoring case, and has no exact body match. The
  existing allowed normalizations cannot fix this binding error. This establishes
  a checker-output validation defect, not a factual rejection of the article.
  The article and checker text were not exported; no policy change was made.
- A subsequent public health check returned 200 with configuration/database/Auth
  healthy in 0.74s. A read-only aggregate connection check showed five idle client
  connections and no active or idle-in-transaction work at that later observation.
  This is a snapshot, not proof that the incident cannot recur.

No article text, email addresses, credentials, provider payloads, or reader IDs
are included in this public receipt. No generation, email, quota reset, live
migration, provider setting, or budget change was used for diagnosis.

## Corrections

1. The cached database pool has one connection. Two membership-only wrappers
   held its transaction while awaiting a service that opened another transaction
   on that same pool. The invitations and member-public-read wrappers now finish
   the entry membership check before invoking independently transactional work.
   The 32 callers that actually consume the membership transaction are unchanged.
   Invitation services still recheck active membership inside their worker
   transaction. Pool size, database roles, and authorization checks are unchanged.
2. Ambiguous article admission persists the same owner/idea/idempotency attempt.
   Bounded exact-idea reads rediscover the canonical request and result; they do
   not automatically commission another article. Navigation, reload, stale
   responses, foreground/online events, and unrelated workspace refreshes retain
   exact identity. A transient ready-body read also has bounded recovery.
   If authoritative exact reads find no admitted job, an explicit reader action
   can retry with the retained key. Outage-only reads do not enable that action.
3. Proxy failure diagnostics record only route templates, method, elapsed time,
   phase, an allowlisted failure class, and upstream status. They never log raw
   errors, resource UUIDs, headers, queries, credentials, or bodies. Logging cannot
   alter the response and the existing upstream deadline is unchanged.
4. The non-failed loading paragraph telling readers to keep browsing is removed,
   per Michael's direct correction. No replacement wait-time promise is added.

## Verification and limits

- Deterministic one-connection ownership regressions fail on the old wrappers and
  pass on the correction. They are not a live PostgreSQL deadlock reproduction.
- Real local Next app at 390×844, using the existing synthetic member/API fixture:
  a deliberately lost article response recovered the same queued job and opened
  its completed article without another commissioning action. Fixture counters:
  one lost response, one admission, one completion, zero replays. No real Auth,
  email, provider, database, or content-generation service was exercised.
- A second real local browser check simulated failure before admission: the
  reader stayed on its selected title, exhausted bounded status reads, and only
  then offered the explicit `Try again` action. Clicking it admitted one job for
  that same idea. Automated regressions separately verify exact key reuse,
  double-click exclusion, stale callbacks, and a late original admission.
- The final no-job retry logic and copy passed independent review and 19 focused
  hook-level regressions. Browser review also caught adjacent recovery actions;
  the final presentation adds a wrapping 20px gap, retaining 44px targets.
- The final action-spacing change was verified in source and its regression,
  not by another browser rendering. The second retry journey was not verified
  at phone width; the first lost-response journey was observed at 390×844.

## Final candidate and release

Application source: `c71af50de829eef6f236991972332a8b7be81066`, one commit above
the previous live web `f3cde89bdf7ae57a691b70a183fc3432559acdd3`. The production
increment is 11 files, 814 additions and 37 deletions. [PR 2](https://github.com/michaelmcguiness/edison/pull/2)
targets an older main, so its full comparison also contains earlier already-live
ancestry; it must not be described as the incident-only delta. The branch name
`codex/v13-invitations` does not mean D49 invitation redesign is included.

The first publishing review rejected suspected blocked Auth/invitation ancestry.
Permitted read-only checks established the exact hosted/public live base, one
incident commit, no D48 ancestry and unchanged Auth/migration/invitation-service
paths. Normal review accepted resubmission of the same push/PR action, then the
two exact-source deployments. No alternate credential or execution path was used.

[Exact-source CI 34245705648](https://github.com/michaelmcguiness/edison/actions/runs/34245705648)
passed every step of both jobs: 757 web tests plus 269 API tests (1,026 total),
320 pgTAP assertions across 12 files, seven disposable-database service proofs,
lint, types, both production builds and schema lint. Both jobs completed by
15:39:15 UTC. Independent review found no remaining P1/P2 issue. The same full
local application checks passed; the web build needed a network-approved retry
for the existing Google Fonts fetch, without source or dependency changes.

| Target | Production deployment | Ready September 8, UTC |
| --- | --- | --- |
| API | `dpl_4FnWzhobqu6WwE94csCJ6xyMt9Z1` | 15:44:52.521 |
| Web | `dpl_HsSPfWLbJeZrtJWPe7yPYNcSFrBC` | 15:47:06.755 |

Both deployment readbacks match the exact application source above and READY /
Production. Web retains edisonreader.com, www.edisonreader.com and
project-qlqve.vercel.app; API retains project-fjr95.vercel.app. All three enabled
API schedules now bind to `edison-1e2dju2a3-mike-michaelmcguis-projects.vercel.app`:
both reconciliation paths remain every five minutes, daily-edition scheduling
remains minute 5 each hour. No project, alias, schedule-cadence, environment,
secret, Auth/template, migration, allowance, provider or budget edit accompanied
this release. Existing dollar limits are unchanged; encrypted setting metadata
alone is not a new value-level verification.

Credential-free live checks started at 15:47:43.874 UTC, all passing:

- API health 200 with configuration/database/Auth OK (1.095s for this sample).
- Login 200, nonce/strict-dynamic CSP and private/no-store; apex/private article/
  demand-share/legacy-share routes safely redirect to login, preserving exact
  safe return paths where applicable. www still redirects 308 to apex.
- API access/invitations and web invitation boundaries return 401 missing_token;
  web workspace returns 401 invitation_required. These establish anonymous
  access protection and the web/API connection, not successful member service work.
- Exact-apex CORS preflight 204; disallowed-origin preflight 403 without an
  allow-origin header. All three unauthenticated cron reads return 401
  invalid_cron_secret and do not invoke work.
- The existing browser tab was refreshed after rollout: normal sign-in renders
  with its prior article-return path intact. No email or code request was sent.

## Remaining limits and next owner

CTO owns the separate checker-output correction and compatibility verification,
then the single real first-session acceptance journey agreed with Chief of Staff.
The later failed article is unchanged. No hosted signed-in recovery, fresh
article/Ask acceptance, provider-quality improvement or email delivery is claimed
by these release checks; the available browser is signed out. No paid generation,
quota reset, invitation or reader-content mutation was used for this release.
D49 remains queued. D48 strict-six-digit source and hosted OTP-length changes
remain blocked and excluded; current compatible email-code behavior is retained.

Release work remains isolated from the canonical checkout containing the prepared
D48 patch. Do not deploy that checkout or treat its HEAD as the live revision.
This document's later receipt-only commit is not a new deployed application build.
