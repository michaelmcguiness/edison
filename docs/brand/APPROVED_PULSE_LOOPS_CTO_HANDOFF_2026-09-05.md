# Approved Pulse + loops: implementation and production handoff

September 5, 2026 · Chief of Staff → CTO, with Head of Design

## Outcome and authority

Implement Michael's approved Edison reading experience in the real application and deploy it to the existing production web/API projects. CTO owns integration, verification and release; Design stays involved through implementation review. Chief of Staff supplies editorial acceptance and resolves cross-functional scope questions.

Michael's direct instruction in Chief of Staff task `01a07236-4341-76d1-a0e0-430bd5881f26` is: **“This looks great let's pass off to CTO and get live in production.”** This approves the latest presented v5 design and authorizes its engineering handoff and production release. D16's design prerequisite is satisfied for this version and scope. Do not ask for another generic design, handoff or deployment approval.

Use the existing production application target, currently `https://project-qlqve.vercel.app`, and its existing API project, reconciling newer CTO release evidence before acting. The earlier separate apex/demo and domain restrictions remain relevant because this instruction does not name a domain change. Preserve existing budget, access controls, account/data boundaries and authorized reader scope. Necessary reviewed implementation, migrations, tests, commit/push and promotion belong to this release; no extra paid service or broader reader invitation is added.

## Exact selected design

- [Approved v5](</Users/michael/.codex/visualizations/2026/09/03/01a064a7-05fc-7f63-9e3f-6b75cba310a8/edison-pulse-loops-v5.html>): 531,998 bytes; SHA-256 `e8ee37092a9846a8195caae8097c536e30dac19e5ef35a495c25ca6313e95dfc`.
- [Latest header delta and evidence](</Users/michael/.codex/visualizations/2026/09/03/01a064a7-05fc-7f63-9e3f-6b75cba310a8/EDISON_HEADER_ICONS_V5_REVIEW.md>), [floating Curate behavior](</Users/michael/.codex/visualizations/2026/09/03/01a064a7-05fc-7f63-9e3f-6b75cba310a8/EDISON_CURATE_FAB_V4_REVIEW.md>), and [underlying reading flow/reference evidence](</Users/michael/.codex/visualizations/2026/09/03/01a064a7-05fc-7f63-9e3f-6b75cba310a8/EDISON_PULSE_LOOPS_V3_REVIEW.md>).
- v5 retains v3.1's reading flow and image-led Pulse treatment, v4's floating Curate, and adds Library/Profile header icons. Earlier rejected v1 and intermediate versions are historical; do not implement them instead.
- Design's [implementation details](PULSE_LOOPS_V5_IMPLEMENTATION_DETAILS.md) supply measured tokens, assets, responsive behavior and review criteria. In particular, replace legacy suppression/tone-based illustration selection with appropriate article-identity artwork and provenance; unrelated art must not imply an article match.

## Reader behavior to deliver

1. **Choose reading:** a finite image-led feed; visible For You and subject/loop navigation with easy topic addition. For You combines the reader's loops without duplicate stories. About six choices is a useful target, never a reason to fabricate or pad ready content.
2. **Read and continue:** opening a card leads to its complete article. The ending offers **Next article** with the actual next readable headline and a contextual **Back to [loop or For You]**. With no next article, return is prominent. Preserve originating selection and return position; no forced Finish step or auto-advance.
3. **Shape future reading:** one labeled floating **Curate** button at bottom-right on the feed, with usable phone targets, safe-area clearance and sufficient content clearance. It opens the clearly scoped direction flow. For You requires an explicit target loop. Persistent direction is inspectable/reversible; asking about one article does not silently change it.
4. **Return and manage:** Library/Profile icon buttons at top-right connect to the existing legitimate saved-reading and account/preferences behavior. Keep article questions, saved state and reader context across navigation. Complete the narrow route integration needed; the mock dialogs are demonstrations, not acceptable production account or Library implementations.
5. **Retain the approved appearance:** Pulse-style illustrated cards and caption surfaces, clean interface typography, comfortable article prose, existing Edison bulb/wordmark and the accepted spacing/hierarchy. Design resolves routine responsive and interaction details within this selection; do not start another theme exploration.

The broader product remains general purpose: Michael's AI/synthetic biology/crypto learning and his dad's sports/politics reading both fit. Existing curiosity entry remains lightweight, with the question “What's something you want to learn more about?”, optional subject suggestions and honest topic interpretation/readiness. Preserve prepared no-account first value separately from authenticated personalized generation. Do not infer expertise, mastery or political preference from clicks.

## Prototype limits to replace with real behavior

The prototype is a visual/interaction reference. Its in-memory loops/bookmarks, empty topic examples, disconnected Ask/Profile/Library behavior, prepared sample cards and review-only disclosures do not establish a production implementation. Inspect current capabilities first and connect the selected interface to real data and existing authentication. Report material capability gaps early with the smallest viable implementation, while continuing independent work. A generic feed with renamed tabs is insufficient to establish subject-scoped loops.

The 760px contained scrolling surface is only a demonstration of the floating button. The production design uses the normal application/page viewport; do not copy a fixed height, nested scrolling shell or preview controls into production. Browser Back, reload, actual focus/scroll restoration and mobile keyboard behavior need real implementation checks.

The fixture has two accepted full articles and five unwritten concepts. **Do not publish concept cards as readable articles, invent read times or display a daily edition claim that production cannot fulfill.** Use actual readable inventory and appropriate empty/readiness states. No six-article generation batch or quota reset is required by this design approval.

## Content and existing release work

- Accepted Sleep source: [HEALTH_ARTICLE.md](../editorial/audience-research-2026-09-05/HEALTH_ARTICLE.md), SHA-256 `9ced5cc067151e4f31406b6fa5bcf078d386af11969b85605b64583a0643e8f1`.
- Accepted History source: [ARTICLE.md](../editorial/starter/ARTICLE.md), SHA-256 `b7a8b5674625f2d694998b4497d9c1049f6d4387721f12a09896c8a6ed42dbae`; [recovery provenance](../editorial/starter/RECOVERY.md). The older `aa26d225...` fingerprint identifies the lost original request JSON, not this recovered Markdown. Reuse accepted content through the real reviewed ingestion path as needed; preserve article/source identity.
- The original private production AI article remains **withheld**. CoS has now independently **accepted a separate corrected version** after the bounded headline, source-date/label and prose fixes and sent its exact private draft/acceptance record directly to CTO. Keep original and correction provenance distinguishable; ingest through the real correction/version path and verify the actual live result. This manual correction does not establish improved generation quality. Do not mistake user design approval for editorial acceptance of other output.
- Reconcile the current [technical handoff](../../CODEX_HANDOFF.md) and [release runbook](../PRODUCTION_RELEASE.md): saved credentials, healthy production projects, owner sign-in, generation quotas/history, outstanding reader-flow checks, billing reconciliation and recovery evidence. Do not repeat completed setup or reset consumed quotas.

## Completion evidence and coordination

CTO should return an initial capability/scope checkpoint and implement toward release, using independent specialists where helpful. Coordinate application edits in the shared checkout; Chief of Staff owns this approval/status record and Design owns its reference artifacts and implementation review. Follow relevant local framework guidance before application edits.

Validate the actual chosen path across desktop and phone: feed/loop selection, article/Next/Back, Curate scope/undo, Ask, Save/Library and account navigation, plus relevant loading/error/empty states. Cover real persistence, browser navigation, keyboard/focus and overlays without treating mocked tests as rendered proof. Design reviews the implemented result where permitted. Honor existing browser restrictions; report any verification requiring unavailable access precisely.

Deploy the tested implementation to the existing production target under Michael's authorization, then verify the deployed version and core reader path. Return the live URL, exact revision/deployment, meaningful checks and any residual limitations. Preserve rollback/recovery options appropriate to the actual changes. A passing build or forwarded design alone is not completion; do not say the approved experience is live until its production deployment is verified.
