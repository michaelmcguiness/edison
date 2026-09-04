# Edison brand guidelines

> **Superseded:** The approved implementation source of truth is now
> [`WHITE_EDITION_HANDOFF.md`](./WHITE_EDITION_HANDOFF.md). The palette,
> typography, mark geometry, and component guidance below describe an earlier
> direction and must not be used for the website refresh.

## Position

**The world, edited for one.**

Edison is a private press for one reader. It reads widely, makes a finite
edition, keeps its sources visible, and learns through editorial choices—not
engagement mechanics. The permanent identity is quiet enough to disappear into
reading. Each edition is allowed to have a point of view.

**Core design rule: a quiet house identity with expressive editions.** The lamp
and masthead endure; color and art direction belong to each day’s edition.

Three principles govern the system:

1. **Edited clarity** — selection and structure are more valuable than volume.
2. **Visible sources** — evidence is part of the publication, not a disclosure.
3. **Personal continuity** — each edition remembers what was worth the time.

## The Edison lamp

The mark is a lightbulb reduced to two monoline forms:

1. one optically round globe;
2. one centered, detached open socket that cups it.

There is no filament, initial, book, sparkle, citation puzzle, screw-thread
illustration, ray, or glow. The open interior lets the surrounding paper become
part of the drawing. Its slight playfulness comes from the elemental circle and
the socket’s softly rising ends—not from added detail. Both forms use the same
1.5-unit optical stroke. The socket centerline spans 48.5% of the globe and has
a short flat floor, so it reads as a bulb fitting rather than a smile or a wide
geometric cradle. The visible gap is one stroke. Both forms resolve to one pixel
at 16px.

Use the same drawing at every size. The primary product lockup uses a 27–31px
mark; 20px is the preferred minimum for a lockup and 16px is the standalone
digital minimum. Display use may scale freely. Clear space on every side is at
least half the socket’s span. The mark is always one color in product: Midnight
Ink on Book Paper or an edition jacket, and Book Paper on Midnight Ink.

The mark behaves as a publishing colophon: beside the masthead, at the end of an
edition, on an app tile, or as a small seal on a daily cover. It is never the
subject of an article screen.

There are only three approved signatures: the horizontal lamp-and-wordmark
lockup, the standalone lamp, and a one-color reverse of either. Do not make a
stacked lockup, badge, container shape, or alternate small-size drawing.

## Wordmark

The wordmark is lowercase and unpunctuated: **edison**. The digital lockup uses
Newsreader Roman at weight 700, optical sizing on, `-.03em` tracking, and `.82`
line height. At desktop masthead size it is 30.4px beside a 31px mark with a
10px gap; on mobile it is 27.2px beside a 27px mark with an 8px gap. The terminal
`n` closes the name; do not append a full stop in logos, app chrome, or email
mastheads. Periods remain normal editorial punctuation in sentences and the
end-of-edition colophon.

Use the shared `EdisonLogo` component in product. The lamp sits like a small
publisher’s colophon beside the name, not a large startup icon. Do not imitate
the New Yorker’s Irvin lettering, Works in Progress’s masthead, or Stripe
Press’s SP monogram.

## Color

The permanent identity has three colors and one structural neutral.

| Name | Hex | Role |
| --- | --- | --- |
| Midnight Ink | `#1C2A38` | Type, primary controls, masthead, and the mark |
| Book Paper | `#F7F1E5` | Default publication ground |
| Oxide | `#B33B2E` | Active desk rule, citations, focus, and rare emphasis |
| Quiet Rule | `#D7CEC0` | Hairlines and non-interactive separation |

Supporting neutrals are Leaf White `#FFFDF8`, Paper Wash `#EEE7DC`, and
Secondary Ink `#665F59`. They are not additional brand colors.

Midnight Ink and Book Paper should occupy at least 92% of a normal reading
viewport. Oxide is punctuation, not atmosphere. It may underline the
current desk, number a source, indicate focus, or mark one editorial decision.
Never use it as a large ambient gradient.

Provenance does not need its own hue. Express it with numbering, labels,
position, and rules. There is no teal “trust” color and no chartreuse “AI is
working” color. Motion and copy communicate state more precisely.

Quiet Rule is decorative and must not be the sole boundary of an interactive
control. Inputs use the darker `#8B8278`; keyboard focus uses Oxide.

### Edition color

The identity is fixed; the publication can vary. Every edition may choose
exactly one jacket color for its lead art, folio dot, or one decisive rule.
This is a periodical device, never category coding.

| Jacket | Hex |
| --- | --- |
| Coral | `#EA6547` |
| Gold | `#EAC763` |
| Powder Blue | `#B7C9D9` |
| Sea Glass | `#C9DEDA` |

Always set Midnight Ink over these light jacket fields. Article prose and
ordinary controls return to the permanent palette. A commissioned illustration
may bring its own art-directed color instead of choosing from this set.

## Typography

Edison uses a role-based editorial system.

- **Editorial:** Newsreader Variable, weights 400–700, optical sizing enabled.
  It carries the masthead, story titles, decks, article prose, pull quotes, and
  brand statements.
- **Apparatus:** Schibsted Grotesk Variable, weights 400–700. It carries dates,
  bylines, desks, source labels, controls, forms, and small utilities.
- **Fallbacks:** Iowan Old Style, Charter, then Georgia for editorial text;
  Helvetica Neue, Arial, then sans-serif for apparatus.

Baseline settings:

- lead and article headline: Newsreader 555, `-.028em`, `.93–1.0` line height;
- secondary headline: Newsreader 590, `-.015em`, `1.04–1.08` line height;
- deck: Newsreader 400, `1.4–1.46` line height;
- article: Newsreader 400, `18–20px / 1.62–1.70`, maximum 42rem measure;
- metadata: Schibsted 520, `12px / 1.35`, tabular numerals;
- desk label: Schibsted 650, `11px / 1`, `.08em`, uppercase.

Avoid heavy display weights, excessive negative tracking, forced font
smoothing, or tiny body text that performs seriousness at the reader’s expense.

## Publication architecture

The product should feel like an edition, not a dashboard.

- Center the masthead and move utilities to the edge.
- Use a date, edition line, named desks, folios, captions, and hairline rules.
- Let one lead establish the edition; follow with a quieter stream.
- Use whitespace and column changes instead of cards, shadows, or tinted boxes.
- Show the active desk with an Oxide rule, not a filled software tab.
- Treat “Why this is here,” research date, and numbered sources as normal
  editorial furniture.
- Keep the composer compact and typographic—an editor’s brief field, not chat.
- Make the library an archive of editions and followed subjects into threads.

An exceptional edition may invert one major cover field to Midnight Ink with
Book Paper type. The exception must be earned by editorial importance.

## Imagery

The permanent interface does not impose a corporate color treatment on every
subject. Photography, illustration, diagrams, and occasional spot drawings may
each retain their own voice when deliberately art-directed.

The current prototype assemblages are rendered in restrained monochrome so
their previous teal/chartreuse palette does not masquerade as a house style.
Future commissioned art may use full color. Use one decisive image rather than
decorative imagery on every card.

Never fabricate a chart, source document, quotation, or historical artifact
that could be mistaken for evidence. Avoid generic photoreal AI scenes, smooth
3-D blobs, and visual metaphors whose only message is “technology.”

Small lamp-derived spot drawings may appear between long sections, one at a
time. They should reward attention without becoming a pattern library.

## AI-native behavior

AI belongs in the structure rather than the styling:

- a finite edition researched around the reader’s interests;
- visible reasons for selection;
- numbered sources attached to claims;
- controls for more depth, less of this, and follow this thread;
- an inspectable, editable model of the reader’s interests;
- clear language for what was read, compared, or updated.

Prefer *read, notice, follow, compare, check, edit, return,* and *understand*.
Avoid *magic, unlock, supercharge, limitless,* and *effortless*. Never claim
certainty Edison does not have.

## Motion

Motion should clarify an editorial action. The detached socket may settle into
place once during a cover-to-edition transition. Do not pulse the lamp, radiate
light, loop an idle animation, or pretend that the mark is thinking. Respect
reduced-motion preferences.

## Guardrails

- Two forms, one optical stroke weight: globe and open socket.
- No filled pedestal, wide cradle, chevron, or triangular base.
- No letter, filament, book, face, source square, rays, glow, or gradient.
- No category rainbow in the permanent interface.
- No complete-logo wallpaper.
- No rounded SaaS cards on reading surfaces.
- No faux paper textures behind prose.
- No expressive art behind controls or article text.
- One delightful detail per screen is enough.

## Asset inventory

Production assets:

- `public/brand/edison-mark.svg` — Midnight Ink primary mark
- `public/brand/edison-mark-mono.svg` — current-color monochrome mark
- `public/brand/edison-mark.png` — raster fallback
- `public/brand/edison-app-icon.svg` and `.png` — Book Paper app tile
- `public/brand/edison-reader-rules.svg` — sparse editorial rule field
- `public/brand/edison-*-assemblage.png` — full-resolution art masters
- `public/brand/edison-*-assemblage.webp` — optimized story art
- `public/favicon.svg` — 64px app/favicon tile
- `app/fonts/` — self-hosted Newsreader and Schibsted Grotesk with OFL files

Reference previews:

- `docs/brand/IMAGE_PROMPTS.md` — reproducible art prompts
- `docs/brand/edison-brand-board.svg` and `.png`
- `docs/brand/edison-product-preview.png`
- `docs/brand/edison-product-mobile.png`
- `docs/brand/edison-article-preview.png`

Assets named `edison-current-pattern`, `edison-footnote-pattern`, or
`edison-reading-light-pattern` belong to retired directions.

## Design references

- Smith & Diction, [Branding Perplexity](https://medium.com/smith-diction/branding-perplexity-ai-70eb2cb2ef48)
- Smith & Diction, [Branding Alma](https://medium.com/smith-diction/branding-alma-25f352285455)
- The New Yorker, [current publication](https://www.newyorker.com/)
- The New Yorker, [The New Yorker Gets Refreshed](https://www.newyorker.com/video/watch/the-new-yorker-gets-refreshed)
- Stripe Press, [Ideas for progress](https://press.stripe.com/)
- Works in Progress, [current publication](https://worksinprogress.co/)
- And—Now, [Works in Progress identity](https://and-now.co.uk/work/works-in-progress)
- Patrick Collison, [What’s the successor to the book?](https://patrickcollison.com/questions)
- Production Type, [Newsreader](https://github.com/productiontype/Newsreader)
- Schibsted, [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk)
