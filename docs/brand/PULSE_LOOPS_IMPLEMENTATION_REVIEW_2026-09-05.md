# Pulse + loops — bounded implementation review

September 5, 2026 · Head of Design → CTO / Chief of Staff

## Scope and evidence boundary

Review against the approved [v5 implementation details](PULSE_LOOPS_V5_IMPLEMENTATION_DETAILS.md) and [authorized release handoff](APPROVED_PULSE_LOOPS_CTO_HANDOFF_2026-09-05.md). No new design direction or approval gate. CTO owns all application fixes and release.

The initial source inspection was of uncommitted integration on HEAD `ab0b763ea3518f81f3ac305bd3569f33872e63e7`. CTO subsequently committed base candidate `c3540929fa05d112e352d6334145a63d735eb833`. **Source-reconciled candidate: `36c16d9e45b629735c8b2db8b91dae55800b142a`.** At that checkpoint root verified that all reviewed application files exactly matched that commit, with no working diff. Every material Design source finding below had its correction included. The table retains that source-review chronology; subsequent actual production rendering at `f6b7bb1cb49244c28f37f70519b97184510708a9` is recorded separately below.

Inspected: `components/edison/{pulse-shell,pulse-feed,pulse-controls,reader-app,article-view,library-profile}.tsx`, `app/{pulse,globals}.css`, font/brand setup, prepared-catalog mapping and the reading-continuity/history hooks/helpers. Independent reviewer inspected the continuity slice. No application files changed by Design.

## Material findings and reconciliation

| Finding / reader impact | Required correction | Source state at the 36c checkpoint |
| --- | --- | --- |
| **Primary-action foreground overridden.** The `.pulse-app :is(button,…)` / dialog reset has higher specificity than single-class button rules, causing inherited dark ink on the black Curate and primary dialog buttons and overriding intended button typography. | Lower reset specificity; verify actual computed foreground and typography. | CTO's source now uses `:where(…)`; source correction confirmed. Rendered contrast pending. |
| **Card image/headline do not open reading.** Only the small Read article button is interactive, unlike the approved full card target. | Card-wide accessible open target with separate Save target; no nested controls. | Source now has a named full-card button at z-index 1, separate Save at 2, and focused-card styling. Source correction confirmed; real click/touch/focus pending. |
| **For You Curate discards typing before loop selection.** The textarea is editable but its controlled change callback returns when no target is selected. | Make target selection explicit before typing, or preserve an unassigned draft without applying it implicitly. | Source now disables the composer until selection and labels it “Choose a loop to start.” Source correction confirmed. |
| **More menu can fall outside narrow viewports.** Its 240px popup was anchored to a small relatively positioned More control; wrapping that control to the left can put the menu offscreen. | Anchor to the whole loop navigation and constrain width; check 320px with 3+ long loop labels. | Source removes the small relative anchor and constrains popup to the navigation width. Actual wrapped layout pending. |
| **Prepared content presented as Today without a finite ending.** A static collection can imply a fulfilled daily edition. | “The collection” for prepared browsing, “Your reading” for undated loop reading; reserve Today for a real current edition. Add a quiet finite ending, not another Curate CTA. | Source now supplies truthful heading and “That’s all for now.” Source correction confirmed. |
| **Article → Library → Back corrupts the article's original return.** Returning to an article is treated as opening a Library item, producing an article/Library cycle instead of return to the original feed. | Distinguish a resume-return from a fresh Library-item open; preserve the prior article origin through detours. Add feed → A → Library → Back → A → Back → original feed regression, plus nested Profile/Library checks. | Root reproduced the original defect. Source now uses bounded history-return steps to resume the actual entry; new detour/nesting and multi-Next helper tests pass. Real browser history remains pending. |
| **Feed return does not restore the opened card's focus/semantic position.** Capture recognizes article blocks only; `returnArticleId` is written but unused. Return focuses the heading and restores raw scrollY. | Use the originating card identity and offset for feed restoration/focus, with a useful scroll fallback if unavailable. Preserve current article position for article detours. | Source now consumes returnArticleId, focuses the actual card open button and restores position with a nearest-card fallback if outside the viewport. Follow-up fix preserves native button tab order rather than assigning tabindex −1. Actual layout/scroll/focus pending. |
| **For You Next omits its source loop.** Actual next headline is present, but the user cannot see whether it is from Sleep, History or another loop. | Resolve/freeze correct source membership with the next destination and render the source label. Do not change the promised destination. | Frozen per-item source labels are now carried by the journey and rendered with Next; pure-state and static-markup assertions pass. |
| **Library/Profile retain the old typography and double page padding.** Their existing `.subpage` still inherits newspaper Caslon headlines/serif rows and inner page gutters inside PulseShell. | Scope existing destinations to the approved Inter interface hierarchy and single page gutter; preserve real account/settings features and non-Pulse routes. | Source now has Pulse-scoped Inter headings/rows/control treatments and removes inner horizontal page padding. Actual desktop/phone rendering pending. |

The last five rows are not proposals for another product/theme audit. They are specific continuity and visual-coherence checks of the newly connected approved path.

## Reproduction of the return-origin defect

Using the actual `readerHistoryState` helper from the original inspected source (before the correction):

1. For You → article A creates no Library return override, correctly.
2. A → Library stores A as Library's return route.
3. Library's in-app Back passes A to navigation.
4. The helper sees `current.view === "library"` and `next.view === "article"`, sets A's article-return route to Library and its parent to A.
5. A's next in-app Back therefore returns to Library, instead of its original For You feed.

Root observed the returned metadata directly with a pure state trace. The implicated helper SHA-256 was `f7cd7418e15ad93da8221cc7d51a8a5c3afca2dee81e04ec87a4009003148421`. No browser or user account was involved in that reproduction.

## Checks completed / still required

Root ran 17 focused component static-markup and pure-state tests across `pulse-components`, `article-view`, `reader-continuity` and `reader-navigation-history`: all passed on bundled Node **24.19.0**. This is not the release's Node 22 gate, a full suite rerun, or browser proof. It also illustrates why the missing article-detour regression matters: existing green tests did not cover that path. The initial attempt using a plain `node` command did not run because the shell had no Node on PATH; only the explicit bundled-runtime result is counted.

After CTO's targeted fixes, root reran the same four files: **21 tests passed**, including new article-detour/nesting, multi-Next, frozen source-label and long-active-loop assertions. At that checkpoint, these were working changes atop c354092, not a released version. SHA-256 fingerprints: `app/pulse.css` `61bb72644ba6f838b2cf4f410e7c2e58f13d2db8c041a738f3db1f4440990b77`; `components/edison/reader-app.tsx` `3a9143088a6d1b9675271259eab259161e4cbc478603239f71ab36e9aa7cc003`; `lib/reader-navigation-history.ts` `88ea1989d87638ccca6270b86ab3577c15a660fc627f31b07434fc38e14e529f`; `lib/reader-continuity.ts` `a487c8cf8487ebf8b3f604b85fc357431dc7a6f18927cbbbb915c3f95d39ce07`.

Chief of Staff separately owns the two final truthfulness fixes sent to CTO: mode-aware pre-submit Curate scope for guests, and preserving a differing original curiosity on a same-title loop conflict. These do not reopen design or require a new merge-management interface. Their implementation/retest is not established by the 21-test Design run above.

### Pushed-candidate reconciliation

At exact `36c16d9e45b629735c8b2db8b91dae55800b142a`, root ran **25 focused tests**, adding `pulse-workspace` to the four files above; all passed on the same bundled Node 24.19.0. Independent source reconciliation also confirmed both CoS fixes: guest pre-submit copy explicitly denies article-selection adaptation, and a same-title/different-curiosity conflict throws before mutation while the UI preserves its draft and shows no success receipt. The collision test covers normalized titles and truncation collisions. UI draft preservation is supported by inspected control flow, not a browser-level assertion.

The candidate's CSS, feed, article view and history/continuity helper fingerprints match the previously inspected corrections. The final Curate/source-copy delta changes `pulse-controls.tsx` to SHA-256 `fe6be20fba98f71d6ac9a5c66b76ed098393206aad4fc8a5022d4360f2580083` and `reader-app.tsx` to `9866a990d18a388e6d9867464f9163fe67a455bb4c8dcef7d7ba0e001e673fe6`. No further material source defect was found in this assigned slice. CTO's broader 232-test/Node 22/build/database gates are separate evidence, not rerun or independently certified by Design.

Confirmed source alignment: exact two-rule bulb; Inter UI and Newsreader wordmark; header Library/Profile connected to real views; viewport-fixed feed-only Curate; two-column/single-column card treatment; 650px article reading column; actual next readable headline rather than a concept; article-scoped questions separate from loop direction; per-identity reader remount and declared guest/account data boundaries.

At the source checkpoint above, prepared image/subject mapping was intentionally empty pending actual publication UUIDs. This dependency is now resolved in `f6b7bb1cb49244c28f37f70519b97184510708a9`: an independent Design source reviewer confirmed exactly two accepted Sleep/History entries, matching their published manifest identities/snapshot hashes, and no concept entries. Committed Sleep/longitude PNGs are byte-identical to the approved originals (both 1254×1254 RGB). Actual loading of both correct images was also observed on production below. This does not make the five unwritten concepts published content.

## Actual production rendered review — f6b7bb1

**URL:** https://project-qlqve.vercel.app  
**Version:** `f6b7bb1cb49244c28f37f70519b97184510708a9`  
**Web deployment:** `dpl_ArHbfeAQeHmREgBQjkN91ivL977h`, Ready at 22:29:22 UTC on September 5, as reported by CTO. Deployment identity/readiness is CTO evidence; the following screenshots, interactions and DOM measurements are Design's own observations of that live URL before the follow-up deployment.

Used the permitted actual HTTPS app in Design's own CUA tab 7; did not touch CTO's tab 50. Read the browser's advertised viewport-capability documentation and used its supported layout override. Earlier uncertainty about exact viewport availability is resolved: the capability works. The override was reset after this pass. No local-prototype, localhost, proxy, headless or other browser workaround was used. Screenshot evidence was displayed inline in the Design task; no local screenshot artifacts are claimed.

| Actual viewport | Directly observed result |
| --- | --- |
| 320×740 | Single 280px card column with 20px gutters; no horizontal overflow. Library/Profile each have a 44×44px header target. Both destinations use Inter 32px headings and one 20px gutter; a long loop title wraps without overflow. |
| 390×844 | Single 350px card column, 20px gutters; no horizontal overflow. Correct artwork/caption treatment. Curate is fixed, 52.5px high, 16px from right/bottom. New-loop dialog is 358px wide with 16px side clearance; input font is 16px. |
| 760×900 | Two 325px cards with 22px gap; no horizontal overflow. Correct header, tabs, art, captions and fixed Curate. |
| 1024×900 | Two 457px cards; no horizontal overflow. Header, topic navigation and fixed Curate stay coherent. |
| 1280×720 | Two 465px cards; no horizontal overflow. Inter feed heading 36px/500, card title 23px/500; Newsreader wordmark 30px/700. Curate is white on #171819 with 24px right/bottom clearance. |
| 1440×1000 | Centered maximum-width layout with two 465px cards; no horizontal overflow. Finite ending visible, with no duplicate Curate action. |

### Interaction and content checks

- **Long topics and More:** with three loops and the active `Design QA: history of science and technology` label truncated to 120px at 320×740, the navigation wraps without page overflow. The open More menu measured x60–300, width 240px, y216–278: fully inside the viewport. Selecting History closed it, exposed the correct active tab and showed the longitude article.
- **Header destinations:** both Library and Profile opened their real views via the header icons. These are not decorative placeholder actions. Library showed the existing device-local saved article; Profile kept the real controls and truthful guest restrictions. No account setting was changed.
- **Feed ending / FAB:** at the 320px feed's maximum scroll, “That’s all for now.” occupied y581–614 while Curate occupied y671.5–724. The final card, Save control and collection link could all clear the floating action. No repeated Curate CTA was present.
- **Article reading:** the actual History article opened through its named full-card target. At 390px its headline was Inter 33px and body Libre Caslon Text 18px/32.4px within a 350px column. At 320px and scrollY 1480, the sticky toolbar stayed at top 0, left 20, width 280px; Back measured 146×44px and Save/Ask/Share each 44×44px. No horizontal overflow. The feed Curate FAB was absent in the article.
- **Accessible card names:** the native accessibility bridge displayed unnamed card rows, but the DOM accessibility snapshot exposed both exact article titles, and exact named locators opened them. This bridge discrepancy is not recorded as an app defect.
- **Curate scope:** For You required a target before editing, with the composer visibly disabled and “Choose a loop to start.” Guest/device-only limitations were present before submission. At 320px the dialog stayed 16px inside both horizontal edges and allowed its longer content to scroll. Design did not submit any editorial direction.
- **Contrast:** the independent source calculation gives white on Sleep #435A68 a 7.239:1 ratio, white on History #375D68 7.172:1, and white on action #171819 17.780:1. These pairs exceed AAA normal-text contrast. Actual screenshots/computed styles confirmed the expected rendered foreground/background; this is not a blanket contrast certification for every state.

CTO separately owns and reported hosted guest Save, Next/Back, Library/history, Curate persistence, Ask-draft reload and article-position reload tests. Design's screenshots/source checks do not stand in for those interaction results or re-certify them.

### Five bounded findings for one follow-up release

| Severity / state | Actual evidence | Required correction and focused acceptance |
| --- | --- | --- |
| **P2 — keyboard dialog dismissal loses focus** | Activating Curate with Enter focused its target select; Escape closed it and left `document.activeElement` as BODY, not the invoking FAB. New-loop dismissal showed the same loss. | Restore the exact opening control after dismissal, for Curate and Add loop. Recheck keyboard Enter → dialog → Escape/close → original visible trigger focus. |
| **P3 — whole-feed focus perimeter** | Initial focused element was MAIN `.pulse-feed`, with computed blue `auto 1px` outline. Source `querySelector("main h1, main")` resolves the ancestor main first. | Prefer heading-first programmatic focus and appropriate heading styling, retaining visible control focus. Recheck initial/route-transition feed rendering and keyboard navigation. |
| **P3 — legacy red page stripe** | Body top border measured 5px solid rgb(209,47,50), visible above the selected Pulse shell. | Remove it for the Pulse surface only; verify feed and secondary views start with the approved white canvas. |
| **P3 — serif dialog description** | Curate description computed Libre Caslon Text and visibly differed from its Inter interface controls. | Scope dialog description to Inter; preserve the serif article body. |
| **P3 — doubled composer focus ring** | Both textarea and its surrounding composer measured 2px solid rgb(209,47,50); screenshot showed an inner rectangle plus outer rounded ring. | Use one visible composer focus treatment, without suppressing accessible focus on other controls. Recheck focused composer at 320/390px. |

All five were sent to CTO and accepted for one scoped patch. The initial checkpoint preceded that patch's deployment; the exact successor's completed focused recheck is recorded below. No additional material layout/readability blocker was found in the tested widths, and no new theme/product audit is requested.

### Remaining limits and test-data boundary

- Exact **200% browser zoom** is unverified; the documented browser capabilities expose viewport and visibility, not a zoom control. Width reflow tests are not equivalent to browser zoom.
- A **physical phone's keyboard and notch/safe-area behavior** are unverified; a responsive desktop browser is not a real phone.
- An **authenticated owner session** is unavailable to this review. Guest correctness is not proof of account-only functionality.
- Browser tabs share guest storage. With CTO's coordination, Design created only the device-local QA loop `Design QA: history of science and technology` (`6860501e-f38e-4f72-a596-ebe4698f1112`) for the long-label test. It remains on the device. Existing Sleep/History loops, saved articles and directions were not changed; no local-data clear or account operation was performed.
- No application source files were edited by Design. CTO owns the patch and deployment. The approved v5 remains the baseline; no new Michael approval is required for these corrections.

**f6 checkpoint:** the selected layout, actual accepted imagery, header destinations and responsive reading surfaces were validated in the tested states on f6, subject to the five follow-up findings above. At that checkpoint the five-item follow-up was not yet rendered-accepted. The following successor review closes those findings; zoom/physical-phone/authenticated limits remain explicit.

## Final focused live recheck — a08c6a1

**Actual HTTPS app:** https://project-qlqve.vercel.app  
**Exact web version:** `a08c6a1a346f281182f23214500bc93e72075243`  
**Web deployment:** `dpl_3pzB3bKXiX7qFUVpits8QxP3CFpt`, Ready at 22:49:02 UTC on September 5. CTO supplied the exact revision/deployment binding and reported an explicit cache-free Production build with CI 236 + 165 green. Those release/CI facts are CTO evidence, not a Design rerun. Design reloaded the actual production URL in its own tab 7 and inspected the settled, hydrated implementation.

This was only the agreed five-finding recheck, not a repeat of every f6 reader journey or a new product review. Desktop was 1280×720; phone layout overrides were 390×844 and 320×740. Screenshots immediately within opening/closing animations or the first viewport repaint were not used as settled-state evidence: each result below was confirmed with a subsequent state/DOM observation.

| Finding | Actual deployed result | Status |
| --- | --- | --- |
| Dialog dismissal loses keyboard focus | Curate activated with Enter focused the target select. Escape and keyboard activation of Close Curate each dismissed the dialog and returned focus to the `Curate your reading` button. New loop activated with Enter focused its textarea; Escape and Close new loop each returned focus to `Add a learning loop`. Settled DOM contained zero dialogs. Both restored controls retained a visible 2px focus outline. Topic-scoped Curate also returned to the FAB after Escape at 320px. | Closed in these tested entry/dismissal paths. |
| Whole-feed blue focus perimeter | After hydration at 1280px, `document.activeElement` was the `Your reading` H1 with `.pulse-route-focus-target`, outline none/0px; main was not focused and had outline-style none. History and Profile route transitions likewise focused their headings, not a large page perimeter. Native control focus remained visible in the dialog-return checks. | Closed. |
| Legacy red page stripe | Computed body border-top was 0px/none. The desktop feed and 320px Profile screenshot both began with the approved white canvas and retained the header icons. | Closed. |
| Serif dialog description | Both Curate and new-loop descriptions computed Inter. Actual settled screenshots show the consistent interface hierarchy. This patch is scoped to dialog copy; the prior verified serif article reading style is not being replaced. | Closed. |
| Doubled composer ring | At 390px and 320px, the focused new-loop composer had one 2px outer ring; its textarea outline was none/0px, with 16px Inter input text. Topic-scoped Curate at 320px showed the same single-ring treatment. The 320px new-loop dialog measured x16–304, width288px, y44–696, with zero page horizontal overflow. | Closed. |

No new loop, saved article, direction or account setting was created/changed during this focused recheck; only UI navigation/opening/dismissal occurred. The earlier long-label QA loop remains as already disclosed. Design restored the normal browser viewport after checking. No application files were edited by Design.

**Final bounded Design disposition:** the approved Pulse + loops/header/FAB slice is rendered-accepted for the tested states, with all five observed follow-up findings closed on the actual deployed a08c6a1 version. CTO owns separate release, reader-persistence and Ask regression evidence. Exact 200% zoom, a physical phone keyboard/notch and authenticated owner-only behavior remain unverified—not implied by this acceptance. No further design change or Michael approval gate is requested for this release.
