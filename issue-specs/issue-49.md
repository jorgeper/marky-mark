# Spec: Live preview task-list checkboxes with source-toggling clicks (#49)

## Goal

All acceptance criteria in issue-specs/issue-49.md are satisfied for issue
#49, with evidence visible in the session: task-list items render as real
checkboxes whose checked state mirrors the `[ ]`/`[x]` source marker,
clicking a checkbox toggles that marker in the source as a single undoable
edit while clicking any other rendered construct only places the cursor,
the #47/#48 reveal and presentation-only/viewport-only invariants hold
unchanged with unit-test coverage and no user-visible exposure in the
shipped app; `npm run validate:quick` passes in the implementer's session
and a summary comment from the implementer exists on issue #49.

## Acceptance criteria

- (PRD 006 §7) With the extension active, a task-list item's `[ ]`/`[x]`
  marker (Lezer `TaskMarker`, uppercase `[X]` included) renders as a real
  checkbox whose checked state matches the source; the item's list bullet
  does not also draw as a bullet glyph, matching the preview pane, which
  shows task lists as checkboxes without bullets.
- (PRD 006 §7) Clicking a rendered checkbox — plain click, no modifier —
  toggles the source marker between `[ ]` and `[x]` (and `[X]` → `[ ]`)
  as a single undoable edit: one transaction, one undo restores the prior
  text exactly, and nothing else in the document changes.
- (PRD 006 §7) This is the only widget interaction besides link
  cmd/ctrl-click (#48): clicking any other rendered construct simply
  places the cursor with no document change, and the existing link
  hand-off behaviour is unchanged.
- (PRD 006 §8) The reveal rule holds: when the cursor or a selection
  touches a task line, that line shows raw markdown (no checkbox widget);
  other task lines stay rendered.
- (PRD 006 §9/§13) Invariants hold: rendering never modifies the document
  (only an explicit checkbox click dispatches a change), and decoration
  work stays bounded to the visible ranges — extend the existing viewport
  unit test to cover task items.
- Layering: the pure decision logic (which span becomes a checkbox,
  checked state, and the change-spec for a toggle at a given marker)
  lives in `src/lib/livePreview.ts` with no react/tauri/platform imports;
  DOM widget and click wiring live in `src/components/livePreview.ts`.
- The work remains library-level: no reference from `SettingsPanel.tsx`,
  no persisted setting, zero user-visible change in the shipped app (the
  extension is still reachable only via the `livePreviewExtension()`
  internal factory), and the existing e2e suite passes unchanged inside
  `npm run validate:quick`.
- Unit tests exist in `tests/unit/live-preview.test.ts` (extend the
  existing file), titles `U<n>:` using the next unused numbers (U184 is
  the highest today), `describe` block naming the contract (PRD 006 §7),
  covering: checkbox deco emission for `[ ]`, `[x]`, and `[X]` with the
  right checked state; toggle in both directions writing the correct
  3-character replacement to the source; a single undo restoring the
  pre-click text; reveal on the cursor's task line while another task
  line stays rendered; a plain click on a non-checkbox construct causing
  no document change; and the viewport bound including a task item.
- New behaviour carries citation comments (`// PRD 006 §7: …`) per
  `.sandcastle/CODING_STANDARDS.md`; no `console.*` in `src/`.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) after each change; the full gate
  `npm run validate:quick` was run ONCE, right before declaring the goal
  met — not after every small change and not as a starting baseline.
- `npm run validate:quick` passes in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #49.

## Context

Parent #41 / `prd/006-live-preview.md` (req 7); blocked-by #48 is merged.
Extend, don't replace: `src/lib/livePreview.ts` computes plain deco specs
(`LivePreviewDeco` union — grow it with a checkbox variant carrying
checked state) and `src/components/livePreview.ts` maps specs onto
CodeMirror decorations; bullets/rules already use `Decoration.replace`
with a `WidgetType`, so a checkbox widget follows the same shape. Lezer
GFM (the `markdownLanguage` the tests already parse with) emits `Task`
leaf blocks with a 3-char `TaskMarker` child; the item's `ListMark` sits
just before it — suppress the bullet deco for task items. For the click:
the widget's DOM can dispatch the toggle itself (`toDOM` receives the
`EditorView`) or the existing `domEventHandlers` mousedown can — either
way keep the pure "marker range + current text → change spec" logic in
`src/lib/` so tests assert it without a browser. Unit tests run with
`pool: 'threads'`, `isolate: false` — restore any global state you touch.
