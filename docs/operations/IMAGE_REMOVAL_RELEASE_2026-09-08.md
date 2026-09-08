# Editorial image removal — web release

September 8, 2026 · Owner: CTO · D52 selected by Michael

## Scope and source

Runtime `5aadd665964aecfe8395d5fa8f5f7d9e58e82fc0` in
[PR8](https://github.com/michaelmcguiness/edison/pull/8) is based directly on the
prior live web source `905793eccd9b6957e5143a734841150d01d555b8`.

The bounded web change removes editorial card imagery from the demand feed and
Pulse feed: no native article-art SVG or Next Image is rendered, and image-only
demand-card styling is removed. Text cards use the existing no-art layout without
empty image slots. Headline/deck text, article identity, reading/open and Save
controls, branding and icons remain. Artwork assets, stored descriptors and
contracts are retained; this is presentation removal, not a data deletion.

The reviewed commit changes exactly five files:

- `components/edison/demand-v11/feed.tsx`
- `components/edison/pulse-feed.tsx`
- `app/demand.css`
- `tests/demand-v11-ui.test.ts`
- `tests/pulse-components.test.ts`

No API, model, provider, Auth, migration, service-budget or daily-delivery
architecture change is included. D53 internal-only QA remains selected; the
daily-body alternative is under reconsideration. Neither new delivery behavior
nor improved generation speed or result quality is claimed by this image removal.

## Verification

CTO reviewed all five changed files. The CoS implementation specialist reports
32 focused tests, typechecks and lint passing, plus rendered actual components
with their CSS at 390×844 and 1280×900. The agent reports no image DOM, blank image
slots or horizontal overflow. These are synthetic component previews, not an
actual signed-in production feed. The retained local HTML artifacts are
`/private/tmp/edison-image-preview/index.html` and
`/private/tmp/edison-image-preview/legacy.html`; screenshots were shown inline
only and no PNG was retained. The HTML files are temporary local artifacts, not
committed release assets. CoS root source-reviewed but did not independently
render them; CTO root did not render them either. These visual results are
attributed to the specialist, not root-verified browser evidence.

[CI34267827868](https://github.com/michaelmcguiness/edison/actions/runs/34267827868)
succeeded for exact source `5aadd665964aecfe8395d5fa8f5f7d9e58e82fc0`:
785 web + 295 API = 1,080 application tests, zero failures or skips;
320 pgTAP assertions across 12 files; all seven disposable-Postgres proofs;
both builds, standalone types, lint and schema checks. Both jobs and all 29 steps
succeeded, none skipped. Application completed at 19:18:36 UTC and database
at 19:18:35 UTC on September 8. This is evidence for the exact web candidate,
not a combined deployment of its older API tree.

## Production deployment and bounded smoke

CTO verified READY Production at **19:20:50.605 UTC** on September 8
(Vercel ready epoch `1788895250605`) in the existing web project:

- Project: `prj_TLrYocZ2r6okKwPr59ht2XQo8bmp`.
- Deployment: `dpl_5zcRkL1gUtf6qBGP4hGDhfpXwbxm`.
- Host: `edison-lysxm1o5g-mike-michaelmcguis-projects.vercel.app`.

Both deployment source fields match exact runtime
`5aadd665964aecfe8395d5fa8f5f7d9e58e82fc0`. The Production target, correct web
project and retained `edisonreader.com`, `www.edisonreader.com` and
`project-qlqve.vercel.app` aliases are verified.

CTO's read-only public smoke at **19:21:45.011 UTC** returned login 200 with
nonce-based CSP and private/no-store caching; apex 307 to login; www 308 to apex;
and API health 200 with configuration, database and Auth checks OK. These are
CTO-supplied hosted receipts, not checks rerun by the documentation agent.

Current status: **web release live at the exact source above**. Root has not
inspected the actual signed-in production feed; this is a verification limit,
not an outstanding deployment step. This docs closeout made no hosted calls, runtime changes or
deployment actions.

The API remains at `82ab41239f70b1d4f7a7a29c72fc2ad58e1fa5e3` /
`dpl_DjMLcg4iZXLfxjQ4CJhLmwngEnYE`, retaining the separately released Nobel
source-provenance correction. All three enabled API crons retain the same host,
deployment and cadences. Do not deploy the older API tree from this web-only
checkout. No new generation, email, Auth action or paid probe is part of this release.

## Rollback and remaining limits

A web-only rollback to the prior deployed web source would restore its editorial
images; it must not roll back the separately corrected API or alter saved reading.
No data migration, backfill or asset restoration is needed because data/contracts
and artwork files remain intact. Root owns any actual rollback decision.

The bounded release is complete with the source, CI and deployment receipts
above; no further rollout action is pending. A rendered fixture or public health
check does not establish actual generation speed, factual quality or a completed
authenticated reader journey.

Prepared with the engineering-delivery workflow; no runtime or hosted action
was performed during this documentation task.
