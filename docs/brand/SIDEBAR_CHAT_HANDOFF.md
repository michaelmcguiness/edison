# Edison — approved sidebar and AI composer handoff

**Status:** User-approved design; authorized for implementation, not shipped software.

**Date:** September 4, 2026.
**Implementing task:** Engineer.

> A publication written entirely for you, every day.

Build the approved three-format publication with the latest **Ask Edison**
chat-style composer. Give the reader worthwhile content immediately; let a
short message change what their publication becomes. No onboarding gate,
required prompt, preference form, or account requirement before the first read.

## Source of truth and precedence

1. This handoff governs the approved navigation, three home layouts, and AI
   composer. Visual reference: [approved interactive design](./edison-sidebar-edition.html).
2. [Editable reference fragment](./edison-sidebar-edition.fragment.html) contains
   the exact approved composition, CSS, and illustrative interactions. It is
   a design reference, not production application code to paste wholesale.
3. [Personal Publication behavior specification](./PERSONAL_PUBLICATION_HANDOFF.md)
   remains the detailed contract for first value, scoped editorial direction,
   persistence, revisions, Undo, protected reading versions, guest continuity,
   safe retries, and queued/failed generation.
4. [White Edition identity](./WHITE_EDITION_HANDOFF.md) and
   [tokens](./white-edition.tokens.json) remain canonical for the logo, colors,
   typography, and editorial restraint.

This approval explicitly supersedes the older handoff's **News-first-only
implementation scope**, cropped navigation study, instruction to keep older
Books/Podcasts compositions, **Shape your edition** visible label, **More of
this. Less of that…** placeholder, one-line rectangular input, and
focus-revealed persistence selector. Its old pasteable prompt is historical;
do not execute it instead of this brief.

The rounded AI composer and circular send button are deliberate, narrowly
scoped exceptions to the earlier square-control styling. They do not authorize
rounded news cards, filled navigation pills, red drawers, gradients, glows,
sparkles, or a wholesale identity change.

## Shared application shell

- Desktop: a **184px left sidebar**, containing exactly **News**, **Books**,
  and **Podcasts**, in that order. Default to icons plus visible labels as
  shown. Same Edition White surface as the publication; one quiet vertical
  separator. No filled selection boxes or dashboard furniture.
- Active destination: stronger ink text with a short **2px red rule**. Icons
  are restrained 18px outlines. Keep navigation targets at least 44px high.
- Use semantic navigation and the correct current-page state. Preserve
  existing routes, deep links, browser Back, and saved reading positions.
- Keep the canonical Edison lockup centered above the publication, with
  profile/settings access in the upper right. Do not turn the profile action
  into an editorial-direction-only settings dead end as the sample does.
- Date, honest personal label, edition/library context, and item count precede
  the composer. Returning names and counts must come from actual state.
  First-time readers see **A place to begin**, not invented personalization.
- Below **960px available shell width**, replace the sidebar with bottom
  navigation. This is the reference's container breakpoint, not a mandatory
  device classification; preserve reading width and verify real layouts.
- Production mobile navigation should remain reachable at the bottom of the
  viewport. Keep the contextual `+` at the lower right above navigation and
  the safe area. Desktop `+` occupies the corresponding lower-right area.
  Account for any existing mini-player. Reserve space so controls obscure no
  story, last row, status message, or action, including at 200% zoom.
- The exported reference puts the mobile bar and `+` in document flow to suit
  its preview surface. **Do not copy that limitation into the app.** Verify
  keyboard-open layout, safe-area clearance, focus, and scroll behavior.

## Ask Edison: recognizable AI input, publication-specific purpose

Keep this control immediately after the edition bar on all three homes.
It must remain subordinate to the publication: compact, no giant prompt hero,
chat-history landing screen, modal gate, or empty-home setup sequence.

Approved appearance:

- Visible label **Ask Edison**; the quiet **Editorial direction** link remains
  alongside it for reviewing and editing what the publication remembers.
- White multiline composer, fine neutral boundary, **22px desktop / 20px
  mobile corner radius**, no shadow. It spans the available editorial width.
- Start at two lines (approximately 52px text area), with 16px Libre Franklin
  input text. Grow as the user types. Keep long drafts readable and the send
  action reachable when the on-screen keyboard is open.
- Footer inside the composer: active section and a persistence selector on
  the left; a **44px circular up-arrow send button** on the right. These are
  visible **before focus**, not hidden in a settings menu.
- Send is True Ink with a white arrow when actionable; muted when empty,
  whitespace-only, composing text, or already submitting. Prevent duplicate
  submission and preserve native, visible keyboard focus.
- Below: **Your AI editor. Tell it what you’d like more or less of.**
- No unsupported attachment, microphone, model picker, or decorative AI badge.

| Section | Placeholder | Persistent scope |
| --- | --- | --- |
| News | More economic history, less startup news… | News · From now on |
| Books | Short books on history and architecture… | Books · From now on |
| Podcasts | More science. Episodes under 30 minutes… | Podcasts · From now on |

Offer **This edition only** before sending. Its lifetime is the targeted
edition identity, not an arbitrary device-midnight timeout. Default to
**From now on** within the active section; never silently propagate explicit
News instructions into Books or Podcasts.

**Enter** sends; **Shift+Enter** inserts a newline. IME composition and its
confirmation keystroke must not submit. Provide accessible labels, error
association, live status, and compliant boundary/focus contrast. The reference's
fine border is not evidence that production accessibility has been verified.

A message changes editorial direction; the acknowledgment must explain that
change, its section, and scope, with review and appropriate Undo. It must not
pretend to have answered a question or generated an article. Preserve the
old handoff's distinction between direction saved, new writing queued, ready
content, persistence failure, and generation failure.

For an unmistakable one-off request, open the contextual creation composer
prefilled without changing direction or starting a job until the reader
submits there. If requested format conflicts with the current destination,
resolve that intent explicitly instead of silently generating the wrong format.
Ask clarification only for materially ambiguous intent or scope.

## Three distinct content experiences

**News:** a finite daily edition, one decisive editorial lead and supporting
stories, useful standfirsts, sources, restrained reading metadata, and a clear
ending. Whitespace and rules separate pieces; no card grid or infinite feed.
Readers can open actual ready content in one action before configuring Edison.

**Books:** a reading library, with a continue-reading feature and progress,
then typographic covers under **Added to your library today**. Use the approved
cover-led layout, real titles, and genuine reading progress. Keep retained
books available across editions; daily additions must not replace the library.
The sample's book-preview disclosure is not the production book reader.

**Podcasts:** a listening queue, with a featured next episode and **New
episodes** rows. Artwork, episode title, show, duration, date, and actual
playback/progress state do the work. Preserve functioning playback and
mini-player behavior where supported; do not implement fake play/progress or
ship the sample's no-recording notification as the real experience.

Books and Podcasts should receive daily ready recommendations based on the
reader's interests where existing generation/recommendation services support
them. Cold starts get an honestly labeled varied selection. Reuse actual
services and content contracts; report missing capabilities and implement the
safe available experience without inventing personalized output or a new
infrastructure mandate.

Switching sections preserves each section's unsent editorial and creation
drafts, accepted instructions, Undo context, pending work, and reading/listening
state. Late responses always reconcile against their original section and
revision, never whichever tab is currently visible.

## Contextual one-off creation

Keep `+` separate from edition steering. It opens a quiet white composer/dialog
or existing accessible sheet, contextual to the selected destination:

- News: one article, on any topic.
- Books: one book, on any topic.
- Podcasts: one podcast, on any topic.

No extra format picker is needed. Preserve drafts on dismissal, label the
format clearly, support keyboard/Escape/focus restoration, and leave ongoing
editorial instructions unchanged. Connect real creation jobs where available;
otherwise expose the missing dependency accurately. Never silently turn a
one-off request into recurring generation or a permanent interest.

## Implementation and verification

Read repository instructions and the relevant local Next.js documentation
before framework edits. Inspect and preserve the current dirty worktree.
Implement reusable navigation and composer components inside the existing
architecture; consolidate CSS rather than append a second competing theme.
Keep existing authentication, content contracts, reading/library behavior,
source provenance, sharing, and unrelated functionality intact.

Do not ship the preview's hard-coded Michael identity, date, sample counts,
progress, authored stories, exact-example-only prompt validation, in-memory
state maps, Tweak options, hidden scenario toolbar, **Try an example** test
control, or simulated success as product logic. Support real free-form
directions through the existing service rather than recognizing one string.

The reference passes **39 source-level interaction checks**. Run them with:

```sh
deno run --allow-read docs/brand/verify-sidebar-edition.mjs
```

These are DOM-stub checks, not browser rendering, accessibility, real API, or
production verification. No screenshot or browser visual signoff is claimed.

Before shipping, complete the production acceptance checks in the older
behavior specification with the new visual requirements above. In particular:

1. Verify all three homes at 320/390/768/1024/1440px and 200% zoom, including
   mobile keyboard, safe areas, navigation/FAB/mini-player clearance, long
   titles, large input drafts, and fallback/loaded typography.
2. Check recognizable composer styling, pre-focus scope visibility, disabled
   Send, Enter/Shift+Enter/IME, keyboard navigation, dialog focus, and live errors.
3. Test guest-first content, accurate personalization labels, cross-section
   draft continuity, persistence/reload, guest/account continuity, safe retry,
   stale-result rejection, revision-aware Undo, and protected read/saved versions.
4. Verify real book reading, podcast playback where supported, contextual
   creation, and separate direction-save/generation outcomes. Do not claim an
   unsupported engine capability works merely because the UI is implemented.
5. Run relevant automated tests and production build. Report completed work,
   screenshots or visual checks where available, remaining dependencies, and
   any verification that could not be performed.

This handoff authorizes implementation in the existing project. It does not
request deployment, production migrations, purchases, or unrelated rewrites.
