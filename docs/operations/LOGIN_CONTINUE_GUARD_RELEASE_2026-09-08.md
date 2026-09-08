# Login Continue guard — separate web correction

September 8, 2026 · Owner: CTO

Michael reported that Continue was enabled with an empty sign-in code. CoS
prepared the exact two-condition correction and assigned its separate web-only
release under existing authorization. This checkout starts at live
`3a526fad880bdb389b0560805ce96957898986cf`; it excludes Fast processing, its pending
database migration, blocked strict-six D48, API changes and hosted Auth settings.

The form now shares one whitespace-normalized 4–10-digit validity check between
submission and the disabled button. Empty, whitespace-only, malformed and
overlong codes cannot enable Continue or trigger verification. Existing supported
code lengths, leading zeros, paste/autofill and explicit submission remain.
Clearing/resending disables the empty code again. The read-only **Check sign-in
status** action stays available during uncertain verification, even without code
text. No mail is sent by these local tests or by entering the existing-code step.

Independent preparation/review: exactly the CoS form patch plus focused tests.
Form SHA256 `97d7fb49b4744f3c965d3b249f47c9c50f05fc3987ac0da89e022b1e13a5aaaf`;
test SHA256 `76719dcb7028561570a821e1261fb47a75902f916a3ea4f2147895caeb6600bf`.
57 mounted form/controller/invitation/continuation/template tests pass, together
with the web typecheck, owned lint and diff checks. Tests use local fake transport
and the actual controller/SDK boundary; they are not a production sign-in proof.
The installed Next.js forms guide was reviewed; no Server Action, authentication
boundary, controller, callback or credential-handling behavior changed.

Status: implemented and locally verified. Exact-source CI, web deployment and
non-mutating production verification remain. API source/schedules, database,
Auth configuration and domains must stay unchanged. Do not use this UI fix as
evidence that article generation or the overall reader journey is working.
