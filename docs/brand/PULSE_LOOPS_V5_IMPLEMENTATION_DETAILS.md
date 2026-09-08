# Pulse + loops v5 — implementation details

September 5, 2026 · Head of Design → CTO

This is implementation precision for the [approved release handoff](APPROVED_PULSE_LOOPS_CTO_HANDOFF_2026-09-05.md), not a new design proposal. Michael approved v5 for implementation and production. CTO owns application integration and release; Design reviews the implemented reading path. No additional routine design approval is needed.

Source of truth: `/Users/michael/.codex/visualizations/2026/09/03/01a064a7-05fc-7f63-9e3f-6b75cba310a8/edison-pulse-loops-v5.html` · 531,998 bytes · SHA-256 `e8ee37092a9846a8195caae8097c536e30dac19e5ef35a495c25ca6313e95dfc`.

## Keep the visual hierarchy

1. Edison home at top-left; Library then Profile icon buttons at top-right.
2. Visible For You, topic tabs and an adjacent add-loop control.
3. Today, a short introduction, then a finite image-led feed.
4. One labeled Curate FAB at the viewport's lower-right, on the feed only.

Do not add bottom navigation, a second Curate CTA, streak decoration, an obligatory onboarding modal, a permanent chat dock or a new theme. Preserve working reader capabilities when integrating the selected hierarchy.

## Exact visual values

| Element | Approved value |
| --- | --- |
| Page / primary ink | `#FFFFFF` / `#202123` |
| Muted text / subtle fill / rule | `#65676A` / `#F5F5F5` / `#E8E8E8` |
| Primary action | `#171819` with white text |
| Active topic | `#EFEFEF` fill, `#161718` text; inactive `#606166` |
| Interface and discovery type | Inter 400 / 500 / 600; Arial and system sans fallback |
| Wordmark | Newsreader 700, 30px/1, tracking −.03em; lowercase `edison`, no period |
| Feed heading | Inter 500, 36px/1.2, tracking −.045em; 30px on phone |
| Feed intro | Inter 400, 16px/1.6; muted, 28px space below |
| Card headline | Inter 500, 23px/1.25, tracking −.035em |
| Card deck / metadata | 14px/1.55 / 12px/1.5; white |
| Article title | Inter 500, 40px/1.16; 33px on phone |
| Article deck | 18px/1.65, `#5F6166` |
| Article prose | Libre Caslon Text 400, 18px/1.8, `#36383A` |
| Article section heading | Inter 500, 25px/1.35 |

This is intentionally sans-serif discovery with book-serif reading. Do not inherit the older newspaper's large Caslon feed headlines or substitute Libre Franklin for the approved Inter without identifying the deviation.

Repository mapping: Newsreader is already self-hosted with its OFL notice at `app/fonts/licenses/NEWSREADER-OFL.txt`; Libre Caslon Text is already loaded through `next/font/google`. Inter is available in the installed Next font catalog but is not yet loaded by `app/layout.tsx`. Use the framework font loader rather than copying the prototype's remote stylesheet link. If vendoring new font files, include their OFL notices; no checked-in Inter or Libre Caslon notice was found in this source check.

### Logo and header

Reuse `EdisonMark` / `EdisonLogo` in `components/edison/brand.tsx`. Their two-rule bulb geometry already matches v5: 24×24 viewBox, 1.75 stroke, rounded caps and joins. Do not redraw it or substitute an older cup-base mark from an asset directory. Display the mark at 29×29 next to the wordmark with a 7px gap.

`public/brand/edison-mark.svg` and `edison-mark-v2.svg` also match that geometry. Do not select `edison-bulb-refinement.svg`, `edison-bulb-micro.svg`, or ignored `* 2.svg` alternatives. The existing component's masthead context currently uses a 31px mark; size it to the approved 29px here.

Header actions are Lucide `library` and `circle-user-round`, visually 22×22 inside 44×44 targets, with a 4px gap. Resting background is transparent; hover is `#F2F2F2`. Provide accessible names and visible keyboard focus. Tooltips are supplementary, never the only label. If these navigate to views rather than open dialogs, use corresponding navigation semantics rather than copying the prototype's `aria-haspopup="dialog"`.

Connect to the real existing saved-reading and account/preferences flows (`LibraryView`, `ProfileView`, and shell open handlers are present). Preserve the user's article/loop and return position. An anonymous Profile can offer the existing legitimate sign-in path; never invent an identity or require sign-in merely to read prepared first-value content. Library entries must open their actual saved article, not just list a title.

### Page, cards and phone adaptation

- Normal page/viewport scrolling. Center an approximately 1040px outer container with 44px horizontal desktop padding; phone padding 20px. The prototype's `height:760px`, contained `.ep-shell` scroller, `.ep-phone` toggle and review controls are not production requirements.
- Two equal card columns with 22px gaps; one column at 600px and below. Cards have 26px radius, no heavy outline, and uninterrupted image/caption surfaces.
- Image aspect ratio 1.48 on desktop and 1.2 on phone, `object-fit:cover`. Use explicit image dimensions/aspect ratio to avoid content jumping. Caption padding is 23px 25px 16px; phone 22px.
- Preserve the two visible topic slots plus More overflow while keeping the active topic exposed. For You stays visible even with one loop. Long names must not push controls outside the viewport. Below 400px the adjacent New loop control may show only its plus icon with a full accessible name and 44px target.
- Use an actual accessible article link/open control and a separate 44px bookmark control; avoid nested interactive targets. Saving should update in place without rebuilding or recentering the feed.

### Curate FAB and direction

- Use a **fixed viewport** FAB, not an absolutely positioned button at the end of the document. Rounded pill, black `#171819`, white pencil and visible **Curate** label. Minimum height 52px; padding 14px 22px desktop, 14px 20px phone; shadow `0 4px 18px rgba(0,0,0,.17)`.
- Offset right/bottom by 24px desktop and 16px phone, plus the corresponding safe-area inset. Reserve at least 104–112px trailing content/scroll clearance plus bottom safe area so the final content can clear the button.
- Feed only: hide it during article reading and when outside the feed. Modal top layers take precedence. Do not let it sit over Ask or the mobile keyboard. Keep logical keyboard order without positive tabindex.
- Dialog: white, maximum width 560px, 28px radius, 28px padding desktop/22px phone. Recognizable chat-like composer with `#F4F4F4` fill, 24px radius and text at least 16px. Adjust height to the real visible mobile viewport and allow necessary dialog scrolling.
- On a topic, preselect that loop. On For You, require an explicit target loop before applying direction. Keep drafts per loop; show the actual saved direction, a confirmation naming its target and a usable reversal. Saving direction shapes future selections; it does not reorder the current edition or silently rewrite an article.
- An article question is not persistent direction. Preserve Ask as its own scoped flow and retain the draft when dismissing/reopening it.

### Article continuity

Use a centered 650px reading column. The sticky reading toolbar replaces topic navigation while reading. Retain contextual Back and accessible Ask/Save/Length controls without stacking multiple competing bars. Length for this article and default length for future pieces must remain distinct; preserve existing working behavior rather than exposing simulated rewrites.

The ending previews the **actual next readable article** and its source loop, with **Next article** and a secondary **Back to [origin]**. When no next exists, make return primary. Do not substitute an unwritten concept, silently change destination or require Finish, feedback or Curate before continuing. Preserve identity, saved state, question drafts and useful reading position through Next, Back, Library, browser history and reload. Keep sources readable and unobscured.

## Artwork and truthful inventory

All reference artwork is in the same absolute directory as the v5 HTML. Use real app assets, not a 500KB embedded prototype HTML or external preview-resource dependency. Original art is conceptual AI-created illustration, not scientific evidence or historical reconstruction.

| Content / readiness | Original / compact reference | Caption |
| --- | --- | --- |
| Sleep-attention — accepted full source | `edison-sleep-attention-v2.png` / `edison-v3-sleep-thumb.jpg` | `#435A68` |
| Longitude — accepted full source, History only | `edison-v3-longitude.png` / `edison-v3-longitude-thumb.jpg` | `#375D68` |
| Dreaming — concept only | `edison-v3-dreaming.png` / `edison-v3-dreaming-thumb.jpg` | `#605777` |
| First night — concept only | `edison-v3-first-night.png` / `edison-v3-first-night-thumb.jpg` | `#4E6457` |
| Caffeine — concept only | `edison-v3-caffeine.png` / `edison-v3-caffeine-thumb.jpg` | `#795346` |
| Puzzle memory — concept only | `edison-v3-puzzle-memory.png` / `edison-v3-puzzle-memory-thumb.jpg` | `#456354` |
| Rocking sleep — concept only | `edison-v3-rocking-sleep.png` / `edison-v3-rocking-sleep-thumb.jpg` | `#565F79` |

Use the original images for appropriate responsive output; compact copies establish the exact prototype crops/treatment but can be too small for high-density desktop presentation. Pair images with meaningful alt text and approved matching readable content. Do not publish the five concepts as complete articles, reuse Sleep artwork on unrelated stories, invent source counts/read times, or pad a six-card feed. The main handoff identifies the two accepted source documents and editorial holds.

Source check found a material integration gap: `StoryCard` currently selects legacy collage art by color and suppresses art on live cards, while `ArticleCard` in `packages/contracts/src/articles.ts` has no image fields. Connect approved imagery to stable article identity with URL, meaningful alt and provenance, not card order or tone. A narrow stable-ID mapping is acceptable for accepted prepared inventory; future generated inventory needs its own truthful image mapping or an intentional no-image fallback. Do not show unrelated decorative art merely to fill the layout. A suitable asset namespace is `public/brand/pulse-loops/`, owned by CTO for application integration.

Exact v5 alt text for the two accepted stories: Sleep — “A pillow and peach blanket beside a moonlit window.” Longitude — “A sailboat and an abstract marine clock.” The source metadata is respectively 3 min / 6 sources and 5 min / 5 sources; recompute if the actual accepted published text or sources change. Record the artwork's provenance as original AI-created Edison illustration, not research evidence. The compact reference JPEGs were source-verified byte-for-byte against v5's embedded images.

An unprepared topic needs an honest readiness/empty state plus a route to readable content. Prepared anonymous reading must not claim it was generated for that person or imply an actual daily refresh until that capability is connected. Keep review-only fixture disclosures out of production, while preserving real capability and AI-content disclosures where relevant.

## Review gates — actual implementation, not mock proof

| Reader path | Acceptance evidence |
| --- | --- |
| First visit → read | Prepared reading accessible without an onboarding form/account gate; only genuinely readable cards open articles |
| Loops / For You | Real subject-scoped inventory; active loop visible; combined view deduplicates; additions persist in the appropriate account/guest scope |
| Feed → article → Next / Back | Previewed destination matches; exact origin and useful position restored; no forced feedback step |
| Save → Library → article | Actual saved state survives the supported persistence boundary; saved entries open; navigation preserves context |
| Profile → return | Real account/preferences path, no mock identity; current reading and drafts retained |
| Curate / Ask | One feed FAB; correct loop target, persistent direction and reversal; Ask does not silently become direction; failures leave reading/drafts usable |
| Responsive / keyboard | 320, 390, 760, 1024 and 1440px; 200% zoom; keyboard-only; focus, overlays, safe areas and mobile keyboard clearance checked |

CTO should provide the implemented revision, an accessible real application HTTPS deployment and core states at a meaningful checkpoint. Design will distinguish rendered observations, source-inferred issues and unverified behavior. The earlier local-prototype browser restriction remains in force: no localhost/headless/proxy workaround. Source and mocked-state tests are not visual, browser-history, persistence or accessibility proof. Production closure needs the exact deployed version and core-path verification, not only a passing build.
