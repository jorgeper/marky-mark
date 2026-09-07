# PRD 025: Delightful editing — animated editor operations, off by default

**Status:** Draft
**Date:** 2026-09-07

Issue: #322 (parent). Supersedes #142 "super flowy ux", whose editor half
this PRD covers; its app-chrome half (pane and scroll motion outside the
editor) is a follow-up, not part of this PRD.

## Problem

Every editor operation in Marky Mark lands instantly: the cursor jumps, the
selection snaps to its new range, deleted text vanishes, typed text simply
appears. That is correct, and it is the only behaviour most editors offer.
The owner wants an opt-in mode where the editor feels alive instead: the
cursor glides to where it is going, a growing selection stretches toward its
new end like a rubber band and overshoots a little, removed text leaves with
an effect, inserted text arrives with one.

Two things make this a PRD rather than a styling tweak. First, it must never
change what the editor *does*: the document, the real selection and typing
latency stay exactly as they are, and only the paint is animated. Second,
the owner wants a mapping — different actions to different effects, chosen
by the user — which means a settings page, a catalogue of effects with rules
for which applies where, and a seam through the editor package that any
embedder can use.

The SPEC46 performance pass was discarded after a green gate because it was
never used in anger before the whole thing landed. This PRD therefore
delivers one operation at a time, each dogfooded before the next starts.

## Goals

- An **Experimental** switch, off by default, that turns the mode on for the
  editor pane only.
- A nested settings page where each of four editor actions is mapped to one
  effect from a small catalogue, or to none.
- The mode is a public, configurable capability of `@marky-mark/editor`;
  the app is one consumer of it.
- Effects are purely visual overlays. Document state, selection state and
  input latency are unchanged with the mode on.
- The mode honours the OS reduced-motion preference by doing nothing.
- No new runtime dependency.
- Tests are few, fast and never timing-dependent.
- Delivered as ordered increments, one per action, each dogfooded in the
  desktop build before the next begins.

## Non-goals

- **The Preview pane.** It has no cursor or selection of its own; nothing
  there animates. Live-preview mode is in scope only because it is the same
  CodeMirror view as the edit pane.
- **Scrolling.** CodeMirror's scrolling stays native; no smoothing, no
  scroll-linked effects.
- **Line reflow / layout animation.** Text wrapping and height changes are
  not animated. Effects never move real content.
- **App-chrome motion** (folder pane, comments pane, toolbar, dialogs,
  tab strip). That is the remainder of #142 and a separate PRD if wanted.
- **Parallax** (#141) — a different experiment.
- **A speed or intensity control.** Durations are fixed constants in v1.
- **Sparkle / particles on insertion**, sound, haptics, or any effect
  beyond the five-item catalogue below.
- **Workspace-scoped configuration.** Like every experiment (PRD 011
  Req 1), the switch and its mapping are user-personal; a workspace layer
  cannot turn the mode on for someone else.
- **Per-theme effects.** Effects read the theme's existing colour variables
  (cursor, selection, foreground); themes gain no new tokens.
- **A capability gate.** The mode is available on desktop, hosted and the
  static web build alike.
- **Animation-in-flight tests.** No test waits for, measures or screenshots
  an animation.
- **Mobile / touch-specific behaviour.** Touch selection handles are
  whatever the platform provides; #277 owns mobile.

## Requirements

### The switch

1. Settings › Experimental gains a row **Delightful editing**, off by
   default, with the one-line description: *"Animates the editor — the
   cursor glides, selections stretch, and text fades in and out. Does
   nothing when your system asks for reduced motion."* The row follows the
   Experimental registry pattern (PRD 011 Req 1): a data entry, not
   bespoke markup.
2. The switch and its mapping are user-scoped settings keys, listed among
   the experimental keys so they are excluded from workspace layers exactly
   as `semanticZoom` is.
3. With the switch **off**, the feature is absent, not disabled: the editor
   loads no effect extension, renders no overlay element, and adds no
   listener. The editor root carries no delight configuration attribute.

### The settings page

4. The row carries a **Settings…** button that opens a nested page in the
   Semantic zoom / LLM providers pattern: it takes the whole dialog body,
   shows the breadcrumb *Experimental › Delightful editing* with a Back
   button, and the dialog's pinned Save / Cancel footer governs it (Save
   commits the mapping with the rest of the settings; Cancel discards).
5. The page lists exactly four actions, in this order, each with a picker:
   **Cursor movement**, **Selection change**, **Deletion**, **Insertion**.
   Every picker offers **None** plus the effects applicable to that action
   (Req 7).
6. Defaults on first enable: Cursor movement → Glide, Selection change →
   Elastic, Deletion → Fade, Insertion → Pop. A stored mapping naming an
   unknown effect, or an effect not applicable to its action, loads as that
   action's default; a missing action loads as its default.

### The catalogue

7. Five effects exist, with fixed applicability:

   | Effect  | Meaning                                                | Cursor | Selection | Deletion | Insertion |
   |---------|--------------------------------------------------------|:------:|:---------:|:--------:|:---------:|
   | Fade    | opacity in (insert) / out (delete)                     |        |           | ✓        | ✓         |
   | Glide   | position tween to the new spot, eased, no overshoot    | ✓      | ✓         |          |           |
   | Elastic | spring toward the target with a small overshoot        | ✓      | ✓         |          |           |
   | Pop     | scale in from ~0.8 (insert) / scale out to ~0.8 (delete) |      |           | ✓        | ✓         |
   | Burst   | a handful of small particles scattering from the removed span, then fading | | | ✓ |     |

   The picker for an action lists only the effects ticked in its column.
8. Durations are per-effect constants, not settings: Fade, Glide and Pop
   in the 120–250 ms range; Elastic may run up to ~350 ms to settle its
   overshoot; Burst particles live no longer than 400 ms.

### Behaviour with the switch on

9. **Never-delay.** The document, the real selection and the caret position
   CodeMirror reports change synchronously, exactly as with the mode off.
   An effect is an overlay drawn *after* the change; no effect defers,
   debounces or batches an edit or a selection update. The only synchronous
   work an effect adds to a keystroke is scheduling the overlay.
10. **Cursor movement** effects apply only to navigation moves — arrow and
    Home/End keys, mouse clicks, find-hit and heading-palette jumps, vim
    nav, undo/redo landing the cursor, programmatic `selectRange`. A cursor
    move caused by inserting or deleting text (typing, backspace) is never
    animated: the caret keeps pace with typing.
11. **Selection change** effects animate the painted selection rectangles
    from their previous shape toward the new range. During a mouse drag the
    animation's target follows the pointer continuously (a spring chasing a
    moving target for Elastic; a re-targeted tween for Glide) rather than
    waiting for the drag to end.
12. **Deletion** effects animate a ghost of the removed text at its last
    painted position (a snapshot overlay, not the text itself, which is
    already gone from the document), then remove the ghost.
13. **Insertion** effects apply to every inserted span — typed characters,
    paste, undo, redo, smart-edit and table-edit rewrites — scoped to the
    inserted range only.
14. **Large operations.** A single change touching more than 2,000
    characters or more than 50 lines gets no deletion or insertion effect,
    and a selection change spanning more than that snaps to its new range
    without animation. Both numbers are constants exported from the editor
    package, not settings.
15. **Overlays never touch layout.** Effects paint into an absolutely
    positioned layer inside the editor's scroller, behind or above
    `.cm-content` as each effect needs, and never insert into, resize or
    reflow the content DOM. A scroll, resize, document change or theme
    change mid-flight cancels every in-flight overlay immediately; overlay
    elements are removed from the DOM the moment they finish.
16. **Reduced motion.** When `prefers-reduced-motion: reduce` is set the
    mode is inert: no overlay is created and no effect runs, regardless of
    the switch or the mapping. The switch stays visible and editable so the
    user's choice survives a change of OS preference.
17. **Focus and readability.** Overlays are `pointer-events: none`, carry
    `aria-hidden`, and never obscure the caret's true position for longer
    than the effect's duration.

### The package seam

18. `@marky-mark/editor` exports the mode as a public, documented option
    (a prop carrying the action→effect mapping, `null`/absent meaning off),
    plus the effect and action name types, the applicability table and the
    large-operation constants. The package imports nothing from `src/`;
    the app passes the mapping in from its settings. An embedder can enable
    the mode with the same prop.
19. The package README documents the option, the catalogue and the
    never-delay guarantee in one section.
20. No new runtime dependency is added to the editor package or the app.
    Springs are computed in-package; transitions use CSS and the Web
    Animations API.

### Tests

21. Unit tests cover the settings keys and defaults, the mapping parser
    (Req 6's fallbacks), the applicability table, and the large-operation
    threshold decision as a pure function.
22. One e2e test, in `tests/e2e/settings-and-themes.spec.ts`: turns the
    switch on, opens the page, checks the four pickers and their options,
    changes one mapping, saves, and asserts the editor root carries the
    resulting configuration attribute; then turns the switch off and asserts
    no overlay layer and no configuration attribute exist. It waits on
    nothing time-based.
23. No test observes, waits for, or measures an animation. The e2e suite's
    existing tests run with the switch off (its default), so no other test
    is affected.

### Delivery

24. The work lands as five ordered increments, each its own sub-issue:
    (1) the switch, settings keys, page, package seam and the inert overlay
    layer (Reqs 1–8, 18–23) with every effect still a no-op; (2) cursor
    movement (Req 10); (3) selection change (Req 11); (4) deletion
    (Req 12); (5) insertion (Req 13). Reqs 9 and 14–17 bind every
    increment from (2) on.
25. Each increment from (2) on is installed and used in the desktop build
    (`/dogfood`) by the owner before the next increment starts; an
    increment that feels wrong in use is reworked before moving on, gate
    or no gate.

## Open questions

- None. Every decision above was settled in the PRD interview on
  2026-09-07; anything not listed is a Non-goal.
