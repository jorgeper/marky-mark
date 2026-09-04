# PRD 022: Highlights

**Status:** Draft
**Date:** 2026-09-03

Issue: #228. (Numbered 022 because PRD 021 is open on PR #225.)

## Problem

Marky Mark can paint text today only as a side effect of commenting: every
painted range is a comment, every comment demands a note, and there is one
fixed tint. The owner wants the classic marker experience — select text,
pick pink/blue/green/yellow, done — with a note being optional, not the
price of admission. And the two systems must not diverge: a highlight and
a comment are the same anchored-range machinery, so they should be one
concept in the UI and one schema on disk. Finally, highlights should be
linkable the way headings are (PRD 020): click a highlight, copy a link,
send it, and the recipient lands on that exact painted range.

The format doc already anticipated this: `docs/COMMENT-FORMAT.md` names
"adding an optional `colour` to a comment (a highlight tint)" as its
canonical MINOR example — this PRD is that example, plus the UX around it.

## Goals

- One mental model: a **highlight** is a colored anchored range; a
  **comment is an optional note on a highlight**. No second system.
- Marker-fast creation: select → one click on a swatch. Last-used color
  is one click away every time.
- Existing comments keep working with **zero data migration** — they are
  simply highlights-with-notes in the legacy tint.
- Every highlight is linkable by stable id, with the PRD 020 copy-link
  primitive and landing behavior.
- Highlights visible in both panes — the rendered preview and, new, the
  CodeMirror editor.

## Non-goals

- **`==markdown==` highlight syntax.** Highlights live in the sidecar
  /embedded comment store, never in document text; the markdown pipeline
  and sanitize schema are untouched.
- **A MAJOR format bump.** Everything here fits the 1.1.0 MINOR shape
  (optional fields old readers ignore and preserve, per PRD 004).
- **Custom colors.** Four classic marker colors; no color wheel, no
  per-user palettes.
- **Pinned-favorite modes.** "Pinnable" resolved to last-used-is-default
  (Req 4); explicit pins or one-click pinned modes are future options.
- **Authoring from a raw editor selection.** Creating a highlight keeps
  the existing comment flow (the plain-edit affordance flips to preview
  via the SPEC25 carry); the editor pane gains display, not authoring.
- **Guaranteed editor-pane fidelity.** Editor decorations are
  best-effort mapped (Req 12); a range that cannot be confidently
  located in source is skipped there, never mispainted.

## Requirements

### The model and creation UX

1. **Swatches replace the pill.** The selection affordance (today's
   "💬 Add comment" pill, `src/App.tsx` + `commentAffordance.ts` gate)
   becomes a compact popup of four marker swatches — **yellow, green,
   blue, pink** — plus an "add note" action. Clicking a swatch creates a
   highlight in that color and closes the popup; nothing else opens.
   Clicking "add note" creates a highlight (in the armed color, Req 4)
   and opens today's composer attached to it. The `commentAffordance`
   gate predicate keeps governing when the popup may appear, under its
   existing name-adjusted tests.
2. **A comment is a note on a highlight.** Submitting the composer
   yields one object: a colored highlight whose entry carries the note,
   author, thread — exactly today's comment plus a color. Type-to-
   comment (printable key over a selection) still opens the composer
   and now produces a highlight-with-note.
3. **Existing comments are highlights-with-notes.** An entry without a
   `color` field renders in the legacy default tint
   (`--mm-comment-tint`) and behaves as a noted highlight. No sidecar
   rewrite, no migration pass.
4. **Last-used color is armed.** The most recently used marker color is
   a user-scoped setting (`U` layer, `src/lib/settings.ts`); the popup
   shows it first/pre-armed so repeat highlighting is one click. It
   also seeds "add note" and type-to-comment.

### Storage: comment format 1.1.0

5. **MINOR bump per the format doc's own example.** The comment format
   gains an optional `color` field (one of `"yellow" | "green" | "blue"
   | "pink"`; absent = legacy tint) — format version **1.1.0**, with
   the Min-version column, changelog entry, and fixed key-order updates
   `docs/COMMENT-FORMAT.md` and `commentFormat.ts` require. The writer
   stamps the lowest version representing the data (PRD 004): a file
   whose entries all lack `color` and have notes still stamps 1.0.0.
6. **Note-less highlights fit the shape.** A highlight without a note
   is an entry with an empty `body` and no thread; 1.0.0 readers
   preserve it untouched (PRD 004 round-trip rule) and may show it as
   an empty comment — documented as the accepted degradation. Reply,
   and resolve remain available only once a note exists.
7. **Both storage modes.** `color` round-trips identically in sidecar
   and embedded modes (`sidecar.ts`, `embedded.ts`), byte-stable key
   order included.

### Cards and lifecycle

8. **The card follows the highlight.** Clicking any highlight activates
   its card: four swatches to recolor, the note (add/edit), the
   copy-link affordance (Req 10), and remove. Noted highlights keep the
   full existing lifecycle — replies, resolve (ghost tint), delete —
   via `CommentCard.tsx`.
9. **Note-less highlights don't clutter the panel.** They show no
   standing card in the margin panel; their card appears only while
   active (clicked) and leaves when deactivated. Noted highlights keep
   today's always-present panel cards and comment-nav behavior.

### Links

10. **Copy link to highlight.** An active highlight reveals the
    PRD 020 copy-link primitive (Req 14 behavior: copy, "Link
    copied" ~2s, aria-announced) placed at the left margin beside the
    highlight's first line — mirroring the heading affordance — with
    tooltip **"Copy link to highlight"**. Hosted-only (PRD 020
    Req 15); absent for untitled buffers.
11. **`#hl-<id>` fragments.** The copied URL is the file's PRD 020 URL
    plus `#hl-<comment id>`; the `hl-` prefix is a reserved fragment
    namespace parsed before heading slugs. Landing on one opens the
    file, scrolls the highlight into view, and flashes it (the
    existing mark-flash affordance); an id that no longer resolves
    (deleted or orphaned) shows the dismissible notice pattern
    ("That highlight wasn't found — it may have been removed").

### Rendering

12. **Editor-pane decorations (new).** Highlight ranges paint in the
    CodeMirror editor (plain edit and split edit) as background
    decorations in the highlight's color. Mapping from rendered-text
    anchors to source ranges is best-effort — exact-quote match against
    the source, skipped when absent or ambiguous, never mispainted.
    In split edit, clicking a painted range activates the card in the
    preview pane's panel; plain edit is paint-only.
13. **Marker palette tokens.** The four colors are theme-independent
    defaults defined as CSS tokens in the document-rendering region of
    `styles.css` (PRD 018 Req 17 fences), with optional per-theme
    override tokens. Active/flash states, resolved `.ghost` dimming,
    and print suppression follow the existing comment-tint rules.
    Contrast: body text over every marker color meets WCAG AA in the
    default light and dark themes.
14. **Anchoring is unchanged.** Highlights reuse the existing anchor
    schema and re-anchoring pipeline (`anchoring.ts`: exact → context →
    fuzzy) and the `mark.hl`/`data-cid` painting path (`domtext.ts`);
    rendered plain text remains byte-identical (no new text-affecting
    pipeline stages).

### Verification

15. **Coverage.** Unit tests for the format bump (stamping, round-trip,
    note-less entries), the affordance gate, color setting, and
    fragment parsing; e2e for: swatch-create (no composer), add-note
    flow, recolor, note-less card behavior (Req 9), copy-link +
    landing + not-found notice, editor-pane painting in both edit
    modes, and legacy sidecar files rendering unchanged. Existing
    comment e2e suites pass with only mechanical updates for the new
    affordance.

## Open questions

None — everything deferred is recorded under Non-goals.
