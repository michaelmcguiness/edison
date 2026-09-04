# Edison White Edition — website implementation handoff

**Status:** Approved source of truth  
**Version:** 1.0  
**Approved:** September 3, 2026  
**Audience:** The Codex worker implementing the Edison Reader website

This document supersedes the logo, color, typography, layout, and component
styling in the older `docs/brand/README.md`. Preserve product behavior and
content; update the visual system.

The intended result is a contemporary American publication: intelligent,
editorial, warm, exact, and lightly playful. It must not look like a SaaS
dashboard or a generic AI product.

## Approved reference

The approved White Edition study is retained by the owner as the local
`edison-white-edition-system.html` design reference; it is not included in this
repository. Use this specification and `docs/brand/edison-reader-home.png` as
the shared reference for hierarchy, restraint, whitespace, rules, paper tone,
and red usage. The study is a reference, not code to paste into the app.

Machine-readable tokens are in `docs/brand/white-edition.tokens.json`.

## Implementation brief

1. Read `AGENTS.md` and the relevant local Next.js 16.3 documentation before
   editing framework code.
2. Inspect `git status` and preserve all unrelated uncommitted work. Do not
   reset or replace the current working tree.
3. Consolidate the existing CSS cascade instead of appending another override
   layer. `app/globals.css` currently contains a minified legacy system followed
   by a second editorial system; both contain hard-coded old colors and fonts.
4. Preserve application logic, state, routes, API behavior, authentication,
   content, and data contracts. This handoff authorizes a visual-system update,
   not a product rewrite.
5. Apply the identity consistently across the main reader, article view,
   library/profile, login/onboarding, public share view, admin, favicon, app
   icon, and Supabase invitation email.

## Non-negotiable identity

- Core palette: near-white, true black, and one editorial red.
- Story art and photography supply nearly all other color.
- Default logo is black, never red.
- Approved mark: one circular crown with subtly fuller lower shoulders, plus
  two stepped flat rules, all in one optical stroke.
- Wordmark: lowercase `edison`, with no period.
- Type architecture: signature, display, reading, and utility.
- Flat editorial composition: whitespace, scale, italics, and 1px rules create
  hierarchy.
- No gradients, glows, glass, soft shadows, card soup, pill navigation,
  rounded-everything styling, monospaced AI type, sparkles, circuits, or generic
  “intelligence” imagery.

## Logo master

### Geometry

```svg
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 1.45C16.53 1.45 20.2 5.12 20.2 9.65C20.2 14.9 17.25 17.85 12 17.85C6.75 17.85 3.8 14.9 3.8 9.65C3.8 5.12 7.47 1.45 12 1.45Z" />
  <path d="M7.85 20.55H16.15M9.35 22.85H14.65" />
</svg>
```

Both paths use:

```css
fill: none;
stroke: currentColor;
stroke-width: 1.75;
stroke-linecap: round;
stroke-linejoin: round;
```

The crown should look circular at first glance and custom on second. Do not
turn it into a symmetric rounded square. Only the lower shoulders are fuller.

### Lockup

| Context | Mark | Wordmark | CSS gap |
| --- | ---: | ---: | ---: |
| Primary desktop masthead | 31px | 30.4px | 7px |
| Primary mobile masthead | 27px | 27.2px | 6px |
| Large brand presentation | 43px | 43px | 8px |

- Wordmark fallback: existing self-hosted Newsreader Roman, weight 700,
  optical sizing enabled, `letter-spacing: -0.03em`, `line-height: .82`.
- Treat the fallback as frozen brand lettering. Do not let the page typography
  migration change it, and do not reset it in Caslon.
- There is not yet a true outlined wordmark asset. Do not claim one exists.
  Outlining the approved lettering is a later production-art task.
- Clear space around a signature is at least half the mark width.
- Minimum standard standalone mark is 20px. QA the supplied favicon separately
  at 16px rather than assuming arbitrary scaling will remain crisp.
- Approved treatments: True Ink on Edition White or Pure White; Edition White
  on True Ink.
- For a linked lockup, give the link `aria-label="Edison"` and keep the SVG and
  visible wordmark from being announced twice.

Never add a period, fill the globe, curve the rules, add a third rule, vary
stroke weights, rotate, squash, add rays, or place the mark in a decorative
badge.

### Supplied candidate assets

These are staged as v2 assets so the implementation worker can verify them
before replacing the currently referenced production files:

- `public/brand/edison-mark-v2.svg` — True Ink master
- `public/brand/edison-mark-v2-mono.svg` — `currentColor` inline master
- `public/brand/edison-app-icon-v2.svg` — 512px Edition White app tile
- `public/brand/edison-favicon-v2.svg` — 64px Edition White favicon tile

After visual QA, promote them to the canonical filenames used by
`app/layout.tsx`. Generate and verify a new PNG Apple/app icon from the v2 SVG;
the current layout still references `/brand/edison-app-icon.png`.

Update `components/edison/brand.tsx` from the old perfect circle and curved
socket to the approved two-path geometry. All logo surfaces must change in one
pass so the site does not carry two identities.

## Color system

### Canonical colors

| Token | Hex | Role |
| --- | --- | --- |
| Edition White | `#FCFBF8` | Default publication canvas |
| Pure White | `#FFFFFF` | Inputs and rare inset surfaces |
| True Ink | `#0B0B0B` | Logo, headlines, primary text and controls |
| Soft Ink | `#30302E` | Decks and long-form reading |
| Caption | `#6D6B67` | Metadata, captions and secondary copy |
| Rule | `#D9D7D2` | Decorative separators only |
| Edison Red | `#D12F32` | Editorial punctuation, active state and focus |
| Red Wash | `#F2E5E3` | Rare selected-state wash |

Recommended semantic mapping:

```css
:root {
  color-scheme: light;

  --ed-paper: #fcfbf8;
  --ed-surface: #ffffff;
  --ed-ink: #0b0b0b;
  --ed-ink-soft: #30302e;
  --ed-caption: #6d6b67;
  --ed-rule: #d9d7d2;
  --ed-red: #d12f32;
  --ed-red-wash: #f2e5e3;

  --background: var(--ed-paper);
  --foreground: var(--ed-ink);
  --card: var(--ed-surface);
  --card-foreground: var(--ed-ink);
  --popover: var(--ed-surface);
  --popover-foreground: var(--ed-ink);
  --primary: var(--ed-ink);
  --primary-foreground: var(--ed-paper);
  --secondary: var(--ed-surface);
  --secondary-foreground: var(--ed-ink);
  --muted: var(--ed-red-wash);
  --muted-foreground: var(--ed-caption);
  --accent: var(--ed-red);
  --accent-foreground: #ffffff;
  --border: var(--ed-rule);
  --input: var(--ed-caption);
  --ring: var(--ed-red);
}
```

### Color discipline

- A normal page should be approximately 90% Edition White and True Ink, with
  neutral rules and metadata doing most of the remaining work.
- Red should occupy no more than roughly 3–5% of a normal reading composition.
- Use red for desk labels, a thin masthead rail, active editorial signals,
  source/citation emphasis, a feature drop cap, and visible keyboard focus.
- Do not color the default logo red.
- Do not use Red as the only cue for selection, error, or state. Pair it with
  text, an underline, an icon, or a weight change.
- Do not reintroduce navy, gold, mustard, mint, teal, or colored category tabs
  as permanent product colors.
- Full-color editorial art is allowed and encouraged. Do not force it into a
  corporate tint.

Measured contrast on Edition White:

- True Ink: 19.02:1
- Soft Ink: 12.78:1
- Caption: 5.14:1
- Edison Red: 4.87:1
- Pure White on Edison Red: 5.04:1

Rule is deliberately low-contrast. It may separate content visually, but it
must never carry text, focus, selection, or an interactive boundary by itself.
Keep destructive/error semantics distinct from the brand accent where the
product needs both meanings.

## Typography

The New Yorker lesson is role separation, not imitation: one recognizable
signature, one calm reading family, and one nearly invisible utility sans.

### Font payload

Load only:

- **Signature:** Newsreader 700, only while the live-type wordmark remains.
- **Display:** Libre Caslon Display 400.
- **Reading:** Libre Caslon Text 400 regular, 400 italic, and 700.
- **Utility:** Libre Franklin 400, 500, and 600.

Preferred release packaging is local WOFF2 files plus their OFL licenses in
`app/fonts/`, loaded through `next/font/local`, matching the repository's
existing deterministic font setup. An immediate implementation may use
`next/font/google`; the installed Next.js version supports these families and
self-hosts the resulting assets rather than making browser requests to Google.
Do not use a runtime CSS `@import`.

Verified `next/font/google` configuration for the current Next version:

```tsx
import {
  Libre_Caslon_Display,
  Libre_Caslon_Text,
  Libre_Franklin,
} from "next/font/google";

const caslonDisplay = Libre_Caslon_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caslon-display",
  display: "swap",
});

const caslonText = Libre_Caslon_Text({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-caslon-text",
  display: "swap",
});

const libreFranklin = Libre_Franklin({
  weight: ["400", "500", "600"],
  style: ["normal"],
  subsets: ["latin"],
  variable: "--font-libre-franklin",
  display: "swap",
});
```

Add the three variables to the root layout body alongside Newsreader until the
wordmark is outlined. Then map roles:

```css
:root {
  --font-signature: var(--font-newsreader), Georgia, serif;
  --font-display: var(--font-caslon-display), Georgia, serif;
  --font-reading: var(--font-caslon-text), Georgia, serif;
  --font-ui: var(--font-libre-franklin), Arial, system-ui, sans-serif;
}

body {
  font-family: var(--font-ui);
  font-synthesis: none;
  font-kerning: normal;
  font-feature-settings: "kern" 1, "liga" 1;
}
```

### Type scale

| Role | Face | Size | Line height | Tracking | Use |
| --- | --- | --- | ---: | ---: | --- |
| Display XL | Caslon Display 400 | `clamp(52px, 7.2vw, 82px)` | .94 | -.018em | One lead headline |
| Display L | Caslon Display 400 | `clamp(42px, 5vw, 64px)` | .97 | -.018em | Feature/section headline |
| Headline L | Caslon Text 700 | 36px desktop / 32px mobile | 1.05 | -.012em | Prominent secondary |
| Headline M | Caslon Text 700 | 28px desktop / 26px mobile | 1.08 | -.012em | Story row |
| Headline S | Caslon Text 700 | 22px | 1.08 | -.012em | Compact story |
| Deck | Caslon Text 400 | 20px desktop / 18px mobile | 1.42 | 0 | Standfirst/deck |
| Body | Caslon Text 400 | 19px desktop / 18px mobile | 1.66 / 1.62 | 0 | Article prose |
| Pull quote | Caslon Text 400 italic | 21px | 1.4 | 0 | Authored emphasis |
| Navigation/UI | Franklin 500 | 13–15px | 1.35 | 0 | Controls and nav |
| Button | Franklin 600 | 14px | 1 | 0 | Sentence-case actions |
| Metadata | Franklin 500 | 11–12px | 1.4 | 0 | Time, date, sources |
| Desk label | Franklin 600 | 11px | 1.25 | +.11em | Uppercase department label |
| Caption | Franklin 400 | 12px | 1.45 | 0 | Media captions |

Rules:

- Use Caslon Display only above approximately 38px and never bold it.
- Use Caslon Text for article reading, decks, and secondary headlines.
- Use Franklin for everything interactive.
- Preserve standard ligatures.
- Use old-style proportional figures in prose and lining tabular figures in
  dates, reading times, source counts, and aligned data.
- Balance large headlines, use `text-wrap: pretty` on decks, and keep body copy
  rag-right. Never justify it.
- Italic is editorial and semantic, not decorative filler.
- Do not use Playfair, Cormorant, Fraunces, monospaced AI typography, or faux
  Irvin lettering.

Commercial future upgrade, if licensed: Lyon Display, Lyon Text, and Söhne.
The approved wordmark remains unchanged.

## Foundations

```css
:root {
  --ed-space-1: 4px;
  --ed-space-2: 8px;
  --ed-space-3: 12px;
  --ed-space-4: 16px;
  --ed-space-5: 24px;
  --ed-space-6: 32px;
  --ed-space-7: 48px;
  --ed-space-8: 64px;
  --ed-space-9: 96px;
  --ed-page-gutter: clamp(24px, 4vw, 50px);
  --ed-layout-max: 1280px;
  --ed-reading-max: 40rem;
  --ed-grid-gap: 24px;
  --ed-rule-width: 1px;
  --ed-radius-control: 2px;
  --ed-control-min: 44px;
}
```

- Grid: 12 columns desktop, 6 tablet, 4 mobile.
- Default radius is 0. Controls may use 2px.
- True circles are reserved for avatars and status dots.
- Default shadow is none.
- Layout hierarchy comes from spacing and rules, not containers.

## Component grammar

### Page shell and masthead

- Edition White canvas, optionally with a 5px Edison Red top rail.
- Center the Edison lockup. Put utilities at the edge and navigation below,
  between 1px rules.
- Keep the masthead flat and airy. No floating nav, translucent glass, or
  rounded wrapper.

### Edition bar

- Strong 1px True Ink bottom rule.
- Left: edition label in Franklin.
- Center: personalization in Caslon Text italic.
- Right: story count in Franklin with tabular figures.
- On narrow screens, collapse to two columns. If personalization matters, move
  it below instead of clipping or silently losing it.

### Lead and story rows

- Lead: red desk label → Caslon Display headline → Caslon Text deck → Franklin
  metadata.
- No lead card, radius, border box, or shadow.
- Desktop lead may split approximately `1.8fr / .7fr` with a 38–88px responsive
  gap; stack below tablet.
- Story rows use a 1px rule and 21–24px vertical padding.
- Hover/focus may underline the headline or strengthen a rule. Never lift,
  scale, glow, or shadow the row.

### Reading view

- Article body: Caslon Text at 19/1.66 desktop and 18/1.62 mobile.
- Maximum text measure: 40rem.
- Paragraph rhythm: approximately 1em.
- A red drop cap is reserved for a true feature opening, not every article.
- Pull quotes use real italic and should be rare.
- Images use square corners, intentional editorial crops, and visible captions.

### Controls

- Primary: True Ink fill, Edition White text, rectangular, 44px minimum.
- Secondary: transparent, 1px True Ink border.
- Tertiary: text; underline on hover and focus.
- Red fill is reserved for one exceptional high-priority action. Pure White on
  Edison Red passes AA.
- Inputs: Pure White or Edition White, visible label above, 1px boundary,
  44px minimum height.
- Focus: 2px Edison Red outline with a 2px offset. A subtle Rule boundary is
  never sufficient for focus.
- Icon controls: 44×44px hit target with an 18–20px monoline icon. Use text or
  an accessible label when meaning is not obvious.
- No pills except semantically unavoidable tag/chip controls. Category
  navigation is not a pill set.

### Surfaces

- Editorial feeds, story lists, reading pages, and archives are not cards.
- Dialogs, sheets, inputs, and necessary utility panels may use Pure White as a
  functional surface with minimal 2px corners.
- Avoid alternating tinted panels. Use spacing and rules first.

## Imagery and AI behavior

- Let editorial photography and illustration retain their own color.
- Use one decisive image rather than decorating every story.
- No permanent category rainbow or corporate duotone treatment.
- No fake source documents, charts, quotes, or artifacts that could be mistaken
  for evidence.
- No generic photoreal AI scenes, brains, networks, glowing orbs, circuitry,
  or “magic” metaphors.
- AI-native qualities belong in structure: finite editions, visible reasons for
  selection, numbered sources, inspectable preferences, and precise language.

## Responsive behavior

- Mobile `<640px`: 24px gutter, single-column stories, 27px primary masthead,
  18px reading body, 44–47px lead display, 44px interaction targets.
- Tablet `640–1023px`: 32–36px gutter, 6-column grid, selective two-column
  editorial layouts.
- Desktop `>=1024px`: up to 50px gutter, 12-column grid, lead split, 19px body.
- At 200% zoom and 320 CSS px: no page-level horizontal scrolling, clipped
  headlines, unreachable navigation, or lost actions.
- A horizontal navigation strip must either scroll with an evident affordance
  or collapse into an accessible menu. Never clip unreachable links.
- Test at 390, 768, 1024, and 1440 CSS pixels.

## Accessibility and interaction

- Meet WCAG AA for text and controls.
- Maintain semantic heading order: one `h1`; desk labels are not headings.
- Preserve landmarks, link purpose, keyboard order, alt text, captions, and
  semantic `time`/list structures.
- Pair color with text, underline, icon, shape, or weight.
- Visible `:focus-visible` is mandatory.
- Respect `prefers-reduced-motion`.
- Functional transitions are 120–180ms and limited to color, opacity, and
  underline. No parallax, idle motion, or animated “thinking” logo.
- Do not shrink visible labels below 11px.

## Repository migration map

Primary implementation files:

1. `app/layout.tsx` — add the approved font roles; retain Newsreader only for
   the current wordmark fallback; keep metadata/icon conventions.
2. `app/globals.css` — consolidate the duplicate legacy/current cascade;
   replace tokens and hard-coded navy/paper/oxide/Georgia declarations rather
   than appending a third design system.
3. `components/edison/brand.tsx` — install the v2 mark geometry and 1.75 stroke;
   retain lowercase unpunctuated wordmark behavior.
4. `components/edison/reader-app.tsx` — masthead, navigation, edition folio,
   feed, composer, onboarding, and sheets.
5. `components/edison/story-card.tsx` — remove rounded-card styling assumptions;
   preserve content and story-art data mapping.
6. `components/edison/article-view.tsx` — display headline, deck, reading body,
   byline, rationale, citations, sources, and feedback.
7. `components/edison/library-profile.tsx` — archive, threads, streak, settings,
   and forms.
8. `app/share/[slug]/page.tsx`, `app/login/page.tsx`, and
   `components/edison/admin-jobs.tsx` — secondary/public surfaces.
9. `public/favicon.svg`, canonical `public/brand/edison-*` assets, and generated
   PNG app icon — keep metadata surfaces synchronized.
10. `supabase/templates/invite.html` — translate the system with email-safe
    inline styles and the v2 mark; it cannot inherit web CSS variables.

Files with names such as `* 2.svg` and `README 2.md` are retired experiments.
Do not reference them. Do not delete them as part of the visual migration unless
the user separately authorizes cleanup.

## Recommended implementation order

1. Snapshot current pages and confirm the app still runs.
2. Add fonts and role aliases.
3. Replace raw and semantic color tokens.
4. Replace shared React mark and stage/promote canonical assets.
5. Refactor page shell, masthead, navigation, and edition folio.
6. Refactor lead/story rows and article reading typography.
7. Refactor controls, composer, sheets, auth, share, library, and admin.
8. Update favicon, app icon PNG, and invitation email.
9. Remove or quarantine visible legacy navy/gold/rounded-card styling.
10. Run tests, build, interaction QA, accessibility checks, and responsive
    screenshot comparison.

## Acceptance criteria

- The approved shouldered globe and two flat rules appear consistently in the
  shared React component, header, auth, share view, favicon, app icon, email,
  and relevant empty/loading states.
- The old perfect circle and curved socket are absent from visible product UI.
- Wordmark is lowercase and has no period everywhere.
- Default logo is True Ink on Edition White, or its approved reverse.
- Visible UI contains no legacy navy, gold, mustard, mint, or oxide brand
  styling unless explicitly quarantined for an out-of-scope surface.
- All visible type maps to signature, display, reading, or utility roles.
- Caslon Display is not used in body copy, metadata, or controls.
- Reading body is 18–19px with a maximum 40rem measure.
- Editorial lists rely on whitespace and rules, not rounded cards or shadows.
- Edison Red remains punctuation and never becomes atmosphere.
- Keyboard focus is visible; controls meet minimum target size; contrast passes;
  reduced motion is respected.
- No functional behavior, API contract, authentication flow, or data state is
  regressed.
- Automated tests and production build pass.
- Manual visual QA passes at 390, 768, 1024, and 1440px, plus 200% zoom.

## References

- The New Yorker, [The New Yorker Gets Refreshed](https://www.newyorker.com/video/watch/the-new-yorker-gets-refreshed)
- The New Yorker, [Jonathan Lethem on the New Yorker Font](https://www.newyorker.com/culture/new-yorker-festival/jonathan-lethem-on-the-new-yorker-font)
- Next.js local repository documentation: `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`
- Next.js local repository documentation: `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`
