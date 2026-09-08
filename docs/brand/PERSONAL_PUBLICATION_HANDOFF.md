# Edison Personal Publication — design and engineering handoff

**Status:** Historical v1 behavior specification; visual scope superseded by the approved [Sidebar and AI Composer handoff](./SIDEBAR_CHAT_HANDOFF.md).

Read that handoff first. It replaces the News-only visual scope, old navigation,
one-line steering field, and pasteable implementation prompt below. The detailed
persistence, revision, recovery, guest-continuity, and immutable-reading
contracts remain applicable. Design approval is not production verification.

**Date:** September 4, 2026

**Audience:** The engineer implementing Edison Reader's first-value and edition-steering experience

> A publication written entirely for you, every day.

The daily publication is the product. Readers receive something worth reading
before they supply preferences. A short conversation with their editor changes
what the publication becomes; it is not a setup requirement.

## Source of truth and scope

- Interactive desktop/mobile reference: [Personal Publication prototype](./edison-personal-publication.html).
- Readable inline source: [Personal Publication HTML fragment](./edison-personal-publication.fragment.html).
- Static syntax/state validator: [verify-personal-publication.mjs](./verify-personal-publication.mjs).
- Canonical identity: [White Edition handoff](./WHITE_EDITION_HANDOFF.md).
- Canonical machine-readable values: [White Edition tokens](./white-edition.tokens.json).

This proposal changes the first-visit experience, edition steering, and the
relationship between editorial direction and one-off creation. It explicitly
supersedes the earlier modal onboarding, question-first home, and steering
available only inside a hidden drawer. It does **not** replace the approved v1
branding, mark, typefaces, color system, or the existing Books and Podcasts
library layouts.

Implement the new composition in **News first**. News, Books, and Podcasts
share the behavior described here, but a new book library, podcast library,
player, recommendation engine, and generation backend are not designed by
this handoff. Preserve existing routes, authentication, content contracts, and
unrelated functionality unless a documented behavior below requires a scoped
change. Surface an implementation dependency rather than inventing support.

The reference HTML is a design artifact. Its headlines and article passages
are authored samples, not output from a working personalized publishing
engine. Its state transitions demonstrate behavior; they do not prove that
production persistence, research, writing, audio generation, or account merge
exists. Production should open real, ready, pre-generated content with valid
provenance. Never present the prototype's sample content as live personalized
reporting.

This design handoff does not itself change production. Reference verification
is limited to static syntax and state tests; no browser layout or visual
signoff is claimed. Production responsive/browser integration checks are
required before shipping. There is no claim here about the exact current
mechanics of ChatGPT Pulse or another product.

The HTML's small scenario-selection controls are external design-reference
tools, not proposed production UI. They let a reviewer inspect returning,
guest, applying/save-pending, writing-ready, queued, save-failed, and
generation-failed examples. **Try an editorial note** inserts the explicit
sample direction. Do not ship these controls or imply that a reader can toggle
a fabricated personal identity.

## 1. Product contract

### A publication, not an infinite recommendation feed

Each edition has a date, a finite set of pieces, an editorial lead, useful
variety, and an ending. Personalization can change the questions investigated,
angle, context, assumed knowledge, and depth of the writing. It is not merely
a rearrangement of the same articles for everyone.

Maintain readable provenance, sources, publication/research dates, and honest
authorship labeling in the existing article experience. A requested angle or
preference must not override factual accuracy or remove material evidence.
Do not invent sources, quotations, supporting studies, or personalization
reasons to fill a design.

### Value before configuration

On a first visit, open a real, ready-to-read starter edition. No modal, profile
form, topic picker, length selector, prompt submission, or account creation
is required to begin reading. The first content should already be present;
generating a whole edition must not block the page.

Cold start is honest: **A place to begin**. Do not claim that a new guest's
edition was already written for their known tastes. Returning readers with
an established personal edition see **Edited for Michael** (substitute the
actual display name; do not hard-code it in production).

Reading supplies cautious evidence. Explicit editorial direction is stronger
than a click, dwell time, or a single one-off request. Keep discovery and
variety; do not turn one article into a permanent interest or equate reading
with endorsement.

## 2. Home composition

The News study is composed in this order:

1. Canonical Edison masthead, understated north-star copy, and edge utilities.
2. Date/edition line, honest personalization label, and finite piece count.
3. A visible, quiet **Shape your edition** field near the masthead, with an
   adjacent **Editorial direction** link. This is inline editorial furniture,
   not a large landing-page hero or a gate.
4. One decisive lead: subject label, headline, informative standfirst,
   reading metadata, and intentional editorial art where available.
5. A restrained sequence of supporting pieces, separated by whitespace and
   rules rather than rounded cards.
6. A clear end to the edition and a relevant next action.

The study is cropped to the News masthead and does not preview cross-section
navigation. Production must retain the existing News / Books / Podcasts
navigation with its restrained active state; this is not permission to
remove those destinations.

The lead must be useful on arrival: its standfirst conveys a concrete idea,
not only a teaser about what a reader might learn. The first viewport should
contain the beginning of the publication. Never fill it entirely with chrome
or instructions, especially on mobile.

**Shape your edition** remains available on the home without opening a
profile or the `+` drawer. Opening the field's scope controls may reveal one
compact line; it must not push the first story several screens away.
The textarea begins at one line and grows with its contents. **Enter** applies;
**Shift+Enter** adds a newline. Never submit while IME composition is active.

## 3. Two different reader actions

| Action | Entry point | Result | Persistence |
| --- | --- | --- | --- |
| Shape the publication | Inline **Shape your edition** | Change editorial direction and relevant unread edition contents | Explicit **From now on** or **This edition only**, within the visible active section |
| Commission a single work | `+` / **Create something** | Create one article, book, or podcast | One request; does not become an editorial instruction |

The `+` action stays a one-off composer. It must not become the only place to
steer the home. It defaults to the active section: an article in News, a book
in Books, and a podcast in Podcasts. **No new format picker is required.**
Preserve the existing contextual creation structure rather than making
readers choose a format again. The study demonstrates the News/article
composer only; it does not preview book or podcast creation.

Example steering request:

> More economic history, less startup news. Go deeper.

Example one-off request:

> Write me an article about why cities stopped building grand train stations.

If the inline steering field receives an unambiguous one-off request, open
the contextual one-off composer with that text prefilled and its active
section/format clear. Do not submit a job or change the editorial brief during
this handoff. The reader reviews and submits the one-off request there. Explain:
**“This looks like a one-off piece. Your editorial direction is unchanged.”**

Do not ask a clarification for ordinary, actionable direction. Ask one concise
question only if ambiguity creates a material conflict, such as whether a
request changes future editions or commissions a single work. Preserve the
draft and current edition while asking. Never guess in a way that silently
creates recurring work or expands persistent scope.

## 4. Scope and memory

### Persistent direction is section-specific

News, Books, and Podcasts may share learned topics, but explicit editorial
instructions belong to the active section. The UI must show the target before
submission and repeat it in the confirmation.

Examples:

- **News · From now on** — affects later News editions and the eligible unread
  portion of the current News edition; does not rewrite Books or Podcasts.
- **Books · From now on** — changes the Books editorial direction; does not
  silently lengthen News articles.
- **News · This edition only** — applies to this specific News edition and
  does not become a durable preference.

Default the visible persistence choice to **From now on**. Offer **This
edition only** before Apply and in a successful confirmation's edit path.
Use text/radio/select controls; do not hide the choice in a tooltip. A long
instruction may wrap naturally rather than being truncated beyond review.

An edition-only instruction is bound to the edition's stable identity, not
the device's midnight or a loose “24 hours” timer. It stops influencing work
for a different edition. Keep it inspectable as part of the older edition's
history. Switching device time zones must not unexpectedly extend or expire
it.

### Learned topics are not commands

Learned interests may provide shared evidence across formats. They do not
carry a News-specific directive, such as “less startup news,” into every
format as a permanent prohibition. Explicit instructions take precedence
within their section. Keep inferred interests visibly distinguishable from
reader-authored instructions in editorial-direction review.

### Guest continuity

Guests can read, steer, and review their local direction before creating an
account. Persist accepted guest direction, its scope, and edition-only
identity across reloads where storage is available. State the boundary:
**“Saved on this device.”** Do not imply cross-device persistence.

If guest storage is unavailable or saving fails, keep the draft/usable edition
and show the limitation. Do not display “saved” merely because the UI changed.
Maintain clear separation between users on a shared device and use the
application's existing privacy/storage conventions.

On account creation or sign-in, preserve guest work and reconcile it with any
existing account direction. Do not silently overwrite account instructions
or duplicate active generation jobs. Material conflicts require a small,
specific choice at that moment; they do not justify front-loaded onboarding.
If the current backend requires authentication for writing, disclose that
dependency at the requested writing action without gating ready reading.

## 5. Apply, writing, and immutable reading

### Apply is a real transaction

On Apply, validate the request and resolve its section and persistence scope.
Record the direction change against the current brief revision. Only report
that the direction is saved after persistence has actually succeeded.

Eligible already-ready content may be selected, replaced, or reordered in the
unread portion of the edition. Update only what the direction affects; do not
unnecessarily regenerate the entire publication or replace useful content
with loading placeholders. New writing may be queued separately and must have
honest, observable status.

These are behavior requirements, not a prescribed API schema, database
design, queue provider, or model choice. Use existing architecture where
possible and document any missing capability.

### Never rewrite something being read or kept

An article's active/open, read, or saved version is stable. Applying a new
direction must not change its body, headline, citations, or identity beneath
the reader. Saved and read versions remain accessible even if the unread
edition changes. An explicit future revision can be a new version with clear
provenance, not an invisible overwrite.

Recheck eligibility when a queued result becomes ready: a story that was
unread when the request started may now be active, read, or saved. Do not
apply a stale replacement based on the earlier snapshot. Preserve reading
position and keyboard focus; an edition update must not jump the viewport.

### Honest state machine

Direction persistence and content writing are separate states. A successful
brief save is not proof that a new piece has been written.

| State | Meaning and visible response | Available action |
| --- | --- | --- |
| Idle | Current edition is usable; no pending instruction | Type direction or read |
| Draft | Text and visible scope are editable; nothing has changed yet | Apply, clear, change scope |
| Applying | Direction save is pending; current content remains usable | Read; prevent duplicate submission of the same request |
| Updated / ready | Direction is saved and any reported ready-item changes are real | Undo this transaction; review direction; read |
| Writing queued | Direction may already be saved; named new work has been accepted but is not ready | Keep reading; inspect status; cancel where supported |
| Writing ready | New work is actually available and its eligibility has been checked | Read the new piece; update only eligible unread positions |
| Failed to apply | The brief change was not committed; no false success | Keep/edit the draft; retry |
| Writing failed | Direction remains saved, but the promised new work failed | Retry that writing job; keep reading existing content |

Maintain queued/ready/failed status across navigation and reloads using the
available durable job state. A network timeout with unknown outcome is not a
confirmed failure or success: reconcile status before retrying so the same
logical request cannot duplicate direction changes or writing jobs.

When a tab or section changes while a request is pending, its result stays
attached to the original section/edition/revision. It must not update whichever
section happens to be open when the response arrives. Suppress stale results
after Undo or a superseding direction rather than silently reapplying them.

### Confirmation copy

Use only the portions that describe actual completed work. Counts below are
examples, not values to hard-code.

- Direction saved: **“News direction updated. More economic history, less
  startup news, with more depth. From now on.”**
- Ready changes, when real: **“2 unread stories updated.”**
- New writing: **“A new economic-history piece is queued. Keep reading while
  it is written.”**
- Edition-only: **“This News edition updated. Your future direction is
  unchanged.”**
- Failed save: **“Your direction wasn't saved. Your edition is unchanged.”**
- Failed writing after saved direction: **“Your direction is saved. The new
  piece couldn't be written.”** Add **Retry generation**. The existing edition
  stays readable; retry only the failed generation work.

Do not show a confident “Your edition is updated” when only a request was
received. Avoid fictional progress percentages, artificial timed success,
claiming research that was not performed, or silently substituting an
unrelated sample piece for a custom request.

## 6. Undo and editorial-direction review

### Undo is tied to one revision

Expose **Undo** on the confirmation for the specific transaction. It reverses
that transaction's still-reversible direction and unread-content changes;
it is not “restore the whole account to an old snapshot.”

Bind Undo to the originating revision and check subsequent changes. If later
edits conflict, do not clobber them. Explain **“Your direction has changed
since this edit. Review it to make another change.”** and open review. A safe
selective reversal is acceptable if the implementation can establish that it
preserves subsequent work.

Cancel queued work where supported, and prevent late results from an undone
transaction from entering the active edition. Undo must not erase a piece
already read or saved. Clearly state any remaining effects that are no longer
reversible. Persist the undo result; do not make it a cosmetic client-only
reversion.

### Review, edit, and delete

Provide an **Editorial direction** entry from the profile/menu and a **Review
direction** link beside steering feedback. The reference previews a News
profile/dialog with individual instruction editing/removal and separately
removable learned interests. The following full cross-section behavior is a
production requirement, not a demonstrated navigation capability:

- Identify the current section and allow switching News / Books / Podcasts.
- Separate **Your instructions** from **Learned interests**.
- Show each instruction, its section, and **From now on** or the associated
  edition for one-edition guidance.
- Let readers edit or delete individual instructions, including temporary
  guidance while that edition remains applicable.
- Offer a clear way to remove/reset inferred interests without deleting
  authored instructions or the reading library.
- Distinguish device-local guest state from account-synced state.
- Use confirmation and honest failure handling for mutations; deleting a
  direction must not delete saved works or rewrite active/read versions.

Deletion/reset copy must name the exact scope. Do not use a generic “Reset
everything” action that could erase unrelated work. Editing follows the same
revision, state, and immutable-reading rules as a new instruction.

## 7. Screen and state inventory

The reference previews the following sample News states. UI state examples
are not evidence of backend persistence, actual generation, durable revisions,
or race-safe integration.

| Screen/state | Preview coverage |
| --- | --- |
| Guest News home | Sample edition, **A place to begin**, visible steering, immediate sample reading |
| Returning News home | **Edited for Michael**, sample direction, finite sample edition |
| Steering draft | Growing textarea, optional example insertion, **News**, **From now on / This edition only**, Apply |
| Applying / save pending | Preserved draft and readable existing edition while save is pending |
| Updated / writing ready | Example effect summary, scope, Undo, Review direction, ready sample content |
| Writing queued | Distinct queued state while existing sample content stays readable |
| Save failed | No brief/edition mutation; recoverable input |
| Generation failed | Saved direction remains; prior content readable; Retry generation |
| Editorial direction / profile dialog | News scope; individual instruction edit/remove; learned interests separately removable |
| Article | Sample reading surface and return to edition; no invented source counts |
| One-off composer | Contextual News/article request; no format picker; no persistent brief change |
| One-off detected in steering | Prefilled contextual composer; no brief mutation or job before submission |

Full cross-section navigation/review switching, Books/Podcasts creation,
durable guest/account persistence, backend revision handling, concurrency,
and immutable production article versions are specified requirements, not
previewed integration. Books and Podcasts retain their previous library
composition; no new library or player is designed here. Responsive styles in
the reference remain subject to browser/layout verification.

## 8. Copy inventory

| Element | Proposed v1 copy |
| --- | --- |
| Product north star | A publication written entirely for you, every day. |
| Cold-start edition | A place to begin |
| Returning edition | Edited for Michael |
| Steering label | Shape your edition |
| Steering placeholder | More of this. Less of that… |
| External reference example control | Try an editorial note |
| Active section label | News |
| Persistent scope | From now on |
| Temporary scope | This edition only |
| Steering submit | Apply |
| Direction management | Editorial direction |
| Reader-authored section | Your instructions |
| Inferred section | Learned interests |
| Guest persistence | Saved on this device |
| One-off entry | Create something |
| One-off accessible icon name | Create an article (News); Create a book (Books); Create a podcast (Podcasts) |
| One-off explanation | One piece. Your editorial direction stays the same. |
| Post-Apply controls | Undo · Review direction |

The north star is a positioning line, not a second required headline above
the publication. It can appear as understated masthead/supporting copy where
space permits. Do not sacrifice first-story visibility to fit it on mobile.

## 9. Visual and component specification

The [canonical White Edition specification](./WHITE_EDITION_HANDOFF.md) wins
for identity values. New dimensions below are proposed v1 layout targets;
adapt them to content and accessibility without introducing another visual
system. Do not turn this into a new branding pass.

### Identity remains exact

| Role | Canonical value |
| --- | --- |
| Publication canvas | Edition White `#FCFBF8` |
| Functional surface | Pure White `#FFFFFF` |
| Primary text / logo | True Ink `#0B0B0B` |
| Reading / supporting text | Soft Ink `#30302E` |
| Metadata | Caption `#6D6B67` |
| Decorative separator | Rule `#D9D7D2` |
| Accent / focus | Edison Red `#D12F32` |
| Rare selected wash | Red Wash `#F2E5E3` |
| Signature | Newsreader 700; frozen lowercase `edison`, no period |
| Display | Libre Caslon Display 400 |
| Reading | Libre Caslon Text 400, italic 400, and 700 |
| Utility | Libre Franklin 400, 500, and 600 |

Use the exact approved shouldered circular globe, two stepped flat rules,
and 1.75 optical stroke from the canonical handoff/tokens. Do not redraw the
mark, substitute the retired curved socket, recolor the default logo red,
or change the wordmark lettering to Caslon.

Red is punctuation, not a drawer background. No gradients, tinted card grids,
soft shadows, glows, decorative AI icons, or pill navigation. Default corners
remain square; functional controls/sheets may use the canonical 2px radius.
Do not add repeated bordered boxes where a line of type and whitespace suffice.

### Layout targets

| Component | Desktop / tablet | Mobile |
| --- | --- | --- |
| Page frame | 1280px maximum; 12-column desktop / 6-column tablet grid; 24px gap | 4-column foundation, single-column stories |
| Page gutters | Up to 50px desktop; 32–36px tablet | 24px; preserve usable width at 320px |
| Masthead | Approximately 96px high, content-driven | Approximately 76px, content-driven; wrap utilities without overlap |
| Lockup | 31px mark, 30.4px wordmark, 7px gap | 27px mark, 27.2px wordmark, 6px gap |
| Steering field | Up to 640px wide; growing one-line textarea, 48px minimum height; adjacent Editorial direction link | Fluid available width; label and scope may wrap; text input at least 16px |
| Scope line | 12–14px Franklin; every actionable target at least 44px | Wrap below input if needed; never hide the selected scope |
| Edition line | 1px True Ink bottom rule; readable date, label, count | Two columns or stacked label; never truncate personalization |
| Lead | Editorial text/art split; generous 38–88px responsive gap where space permits | Single column; keep headline and useful standfirst early |
| Lead headline | Canonical Caslon Display scale; up to 82px | 44–47px, allowed to wrap naturally |
| Supporting story | 21–24px vertical padding between 1px rules | Stacked and readable; no tiny forced thumbnail columns |
| Reading body | 19px / 1.66; maximum 40rem measure | 18px / 1.62 |
| Editorial-direction sheet | Maximum 420px wide; Pure White, minimal boundary | Full available width; viewport-safe vertical scrolling |
| One-off composer | Maximum 560px wide; existing creation structure retained | Fluid width; viewport-safe scrolling and visible submit |
| Icon action | 44 × 44px minimum target; 18–20px icon | Same minimum; safe-area clearance where fixed |
| Focus | 2px Edison Red outline with 2px offset | Same; never clipped by overflow |

Preserve the previous Books and Podcasts layouts. On those surfaces apply
only the shared steering/one-off distinction and visible section scope, with
minimal adaptation needed for their existing mastheads.

## 10. Responsive and accessibility requirements

- Validate at **320, 390, 768, 1024, and 1440 CSS px**, plus 200% browser zoom.
  No page-level horizontal scrolling, clipped headlines, missing controls,
  overlapping masthead utilities, or unreachable navigation.
- Mobile input focus and the on-screen keyboard must not cover the active
  field or submission/recovery controls. Sheets use the available viewport
  height, permit content scrolling, and respect safe areas.
- Keep controls at least 44px in both target dimensions where applicable.
  Never reduce label size or target size to force a one-line layout.
- Maintain landmarks, one page `h1`, ordered headings, meaningful links,
  semantic dates/lists, image alternatives, and existing source link access.
- Inputs have visible labels and programmatic associations. Placeholder text
  is not the accessible label. Scope choices have names and current values.
- Tab order follows the reading/visual order. Buttons are real buttons;
  articles are navigable links. In steering, Enter applies and Shift+Enter
  adds a newline; grow the textarea with its contents. Never submit during
  IME composition or consume the composition-confirmation Enter as Apply.
- When a modal sheet opens, name it, focus an appropriate control, contain
  focus, support Escape where dismissal is safe, and return focus to its
  trigger on close. Preserve an unsent draft across an accidental dismissal.
- Announce status changes through a polite live region without moving focus
  away from reading. Associate errors with the affected field; provide clear
  retry and review controls. Do not announce every streamed character.
- Focus must remain visible after Apply, Undo, content refresh, and return
  from an article. Do not remount the whole edition in a way that loses it.
- Use color plus text/underline/icon for state. Rule is decorative and cannot
  alone define an input boundary, selection, error, or focus state.
- Retain WCAG AA contrast, reduced-motion support, and the canonical
  120–180ms functional transitions. No animated thinking logo or forced
  scroll-to-top when content changes.

## 11. Engineering acceptance tests

These are production acceptance requirements. The HTML's sample transitions
do not establish that persistence, revisions, races, integration, accessibility,
or responsive behavior has passed these tests.

### First value and section scope

1. With no guest/account state, the first page contains ready content and
   **A place to begin**. A story opens with one action and no onboarding or
   account requirement. The initial edition does not wait for generation.
2. A returning reader with a personal edition sees the correct name; an
   unknown guest does not see a fabricated personalized label or fake streak.
3. Steering is visible from News home without using `+` or profile. At every
   tested width its section and persistence scope can be inspected before Apply.
4. Applying the example to **News · From now on** changes only News direction.
   Books/Podcasts explicit instructions and existing layouts remain unchanged.
5. **This edition only** applies to the targeted edition identity, survives a
   reload while that edition is active, and does not affect a later edition
   or unexpectedly change because of the device's time zone.
6. Shared learned topics never silently copy a section-specific explicit
   instruction into another section. A single click does not become a
   reader-authored instruction.

### Correctness, concurrency, and persistence

7. The Apply control prevents duplicate submission of one logical request.
   Simulate a delayed/unknown network outcome and verify reconciliation before
   retry; one request cannot create duplicate jobs or repeated rules.
8. Failed direction persistence preserves the draft and prior edition and
   shows failure, not an “updated” confirmation. Guest storage denial does
   not show “Saved on this device.”
9. After a successful direction save with queued writing, show both facts
   separately. Existing content remains readable. Ready status appears only
   after actual content exists; writing failure offers a retry without
   pretending the direction save failed.
10. Read, save, and open stories before Apply. Verify their exact versions,
    citations, and reading position stay intact after ready-item changes.
    Repeat by opening/saving a candidate while its replacement is queued.
11. Switch News to Books while Apply/writing is pending. The result updates
    only its original target. A stale response cannot change the new section
    or overwrite a newer revision.
12. Undo reverses its own reversible transaction and persists the result.
    After a later conflicting edit, it does not restore an old global
    snapshot or delete subsequent work. Late queued output from the undone
    request cannot reapply itself. Already read/saved output remains available.
13. Guest accepted direction survives reload where storage works. Sign-in
    preserves guest work and handles conflicting account direction explicitly
    rather than silently replacing either side or duplicating jobs.

### Control and recovery

14. Editorial direction lists reader-authored instructions separately from
    inferred interests, with section and persistence scope visible. Individual
    edit/delete succeeds or reports failure accurately; unrelated sections,
    saved content, and the reading library are unaffected.
15. An unambiguous one-off entered into steering opens the prefilled composer
    in the appropriate existing section context, leaves the brief unchanged,
    and starts no job until the reader submits there. No new format picker
    is required. Dismissing it leaves a recoverable draft.
16. A normal editorial instruction applies without a setup dialogue. A
    materially ambiguous scope request asks one concise clarification and
    makes no mutation until resolved.
17. `+` defaults to an article in News, a book in Books, and a podcast in
    Podcasts, using the existing contextual structure without requiring
    another format choice. Its text does not become persistent direction.

### Visual, accessibility, and regression checks

18. Test every inventory state at 320/390/768/1024/1440px, keyboard-only, and
    200% zoom. Verify focus restoration, live announcements, Escape behavior,
    IME entry, adequate targets, and mobile keyboard clearance.
19. Compare logo geometry, font roles, colors, reading measure, and control
    treatment with the canonical tokens. No new red drawer background,
    card-grid chrome, substituted fonts, or retired logo may appear.
20. Verify existing Books/Podcasts browsing, playback where supported,
    saved/library behavior, source links, sign-in, sharing, and other
    unaffected routes remain functional. Run applicable automated tests and
    the production build; report any unimplemented engine dependency plainly.

## 12. Verification boundary

Use [verify-personal-publication.mjs](./verify-personal-publication.mjs) for
the reference's static syntax and sample-state tests. These checks can find
script or modeled-state regressions; they are not a browser rendering test,
source-veracity check, or production engine test. Refer to the validator's
actual output for executed checks rather than treating this document as a
passing test report.

Reference validation record, September 4: **22 source-level interaction
checks passed** using Deno with read permission. Canonical-token checks and
source/export integrity checks also passed. These results do not include
manual/browser layout checks or live API verification.

No browser layout/visual signoff or screenshot export is claimed in this
handoff. Before shipping, run the production responsive/browser integration
checks above, including actual keyboard/focus behavior, mobile input,
generation/persistence failures, cross-section navigation, revisions, and
concurrent updates. Preserve the distinction between simulated sample
behavior and verified product behavior in the engineering handoff.

## 13. Suggested implementation sequence

1. Read repository instructions, inspect the existing implementation and dirty
   worktree, and read relevant local Next.js docs before framework edits.
2. Establish the guest/returning home states with real ready content; remove
   the blocking onboarding entry point without deleting unrelated account UI.
3. Add the quiet masthead-adjacent steering field and explicit scope controls.
4. Connect direction persistence and revision handling; implement honest
   pending, confirmed, failed, and Undo states before generating new work.
5. Reconcile ready unread contents and queued writing with immutable reading
   versions and current eligibility checks.
6. Add editorial-direction review/edit/delete and guest/account continuity.
7. Preserve `+` one-off creation; implement the non-mutating handoff when a
   one-off request is entered into steering.
8. Apply shared scope behavior to Books/Podcasts without redesigning their
   libraries, then complete the acceptance and responsive regression checks.

Do not introduce a new service, API contract, storage vendor, or model solely
because the reference uses a particular visual state. State the production
integration gap and propose the smallest compatible implementation.

## Pasteable implementation prompt

> Implement the proposed v1 Edison Personal Publication experience described
> in `docs/brand/PERSONAL_PUBLICATION_HANDOFF.md`, using
> `docs/brand/edison-personal-publication.html` as the interactive visual
> reference. Read `AGENTS.md`, inspect and preserve unrelated work, and read
> the relevant local Next.js documentation before framework changes. Preserve
> the exact approved identity in `docs/brand/WHITE_EDITION_HANDOFF.md` and
> `docs/brand/white-edition.tokens.json`.
>
> News should open directly into a real, ready edition with no onboarding
> gate. Use “A place to begin” for a new guest and the true returning-reader
> label where personalization exists. Add a visible, quiet “Shape your
> edition” field after the edition/date/name/count bar, with active section scope and
> explicit “From now on” / “This edition only” controls. Persistent
> instructions are section-specific; learned topics may be shared. Preserve
> existing News/Books/Podcasts navigation and library layouts; the study is
> cropped to News. Use the placeholder “More of this. Less of that…”. The
> textarea grows from one line: Enter applies, Shift+Enter adds a newline,
> and IME composition must not submit.
>
> Apply must persist direction honestly, revise only eligible unread ready
> content, and show separately when new writing is queued, ready, or failed.
> Never mutate active/read/saved versions. Implement revision-bound Undo,
> edition-identity expiry for temporary guidance, review/edit/delete,
> guest continuity, safe retries, and stale-result handling. Preserve `+`
> as contextual one-off creation: article in News, book in Books, podcast in
> Podcasts, with no new format picker. Route an obvious one-off in steering
> into the contextual composer prefilled, without changing direction or
> starting a job until submission. Clarify only materially ambiguous scope.
>
> The reference uses authored samples and simulated engine states: do not
> ship them as real personalized output or fake persistence/generation
> success. Reuse existing architecture; do not invent a backend/API mandate.
> The source-level validator is not browser/layout or production signoff.
> Report missing production capabilities and integration choices. Run the
> handoff's acceptance tests, preserve unrelated functionality, and validate
> 320/390/768/1024/1440px, 200% zoom, keyboard operation, and mobile keyboard
> behavior. Report completed work, verification, and remaining dependencies.
