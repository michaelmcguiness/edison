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

## Exact-source CI and live verification

Source `905793eccd9b6957e5143a734841150d01d555b8` is in
[PR6](https://github.com/michaelmcguiness/edison/pull/6).
[CI34265004055](https://github.com/michaelmcguiness/edison/actions/runs/34265004055)
passed both jobs and all29 steps, none skipped:785 web +295 API =1,080 tests,
320 pgTAP assertions across12 files, all seven disposable-database service proofs,
both types/builds, lint and schema lint. Application completed18:49:23 UTC;
database18:49:55 UTC. CoS independently matched the exact source/form hash and
closed source review before rollout.

Web production deployment `dpl_3pKmNEBhwS4rg7ZbHnMCqx3DYmVc` is READY at
18:52:17.843 UTC, with both git source fields matching exact905793e. Project
`prj_TLrYocZ2r6okKwPr59ht2XQo8bmp` retains edisonreader.com, www.edisonreader.com
and project-qlqve.vercel.app. Its deployment host is
`edison-k36n895l7-mike-michaelmcguis-projects.vercel.app`.

At18:53:54.684 UTC, public non-mutating checks confirmed login200 with nonce CSP
and private/no-store caching, unauthenticated apex307 to login, www308 to apex,
and API health200 with configuration/database/Auth all OK. API remains
`dpl_D1uSkD5rV3Cu5snw5u6RYX1f26qV` at source3a526fa; all three enabled cron
definitions retain their host and schedules. No API deployment, database change,
Auth setting, domain configuration, email, credential or provider operation was
performed for this release. The user's existing browser was not touched.

Status: live and verified at source/CI/deployment/route scope. Empty-code behavior
was exercised in mounted tests, not a new production sign-in. This UI fix is not
evidence that article generation or the overall reader journey is working.
