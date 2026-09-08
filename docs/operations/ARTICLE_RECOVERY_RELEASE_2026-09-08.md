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
- Exact final revision, complete checks, final review, and hosted verification
  will be appended when the candidate is frozen. This file alone does not claim
  a production release or resolution of the later provider-validation failure.
