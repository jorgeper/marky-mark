# SPEC15: Marky Mark v15 — synchronized scrolling in split edit

Delta spec on top of SPEC.md–SPEC14.md as implemented (all green: U1–U26,
E1–E41 + E45–E56, W1–W5; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §7 is the goal condition.

**What ships:** in split-edit mode the editor and preview panes **scroll
together, both directions**: scroll either pane and the other follows so the
same part of the document stays in view. The mapping is **block-anchored**,
not proportional — rendered blocks know their markdown source line, so code
blocks, tables, and images don't make the panes drift apart. Sync is always
on in split mode; it has no setting. Desktop and web behave identically.

Out of scope: a sync on/off setting, sync in full-screen edit mode (the
existing scroll-ratio restore on mode toggle is unchanged), horizontal sync,
sync during divider drags beyond what scrolling already gives, smooth-scroll
animation of the follower, per-keystroke re-sync while typing (§1.6).

---

## 1. Sync behavior (FR-Y)

1. **Bidirectional:** a user scroll in the editor pane repositions the
   preview pane, and a user scroll in the preview repositions the editor.
   The pane the user is scrolling is the **leader**; the other is the
   **follower**. Follower motion must never re-trigger sync (no feedback
   loop, no jitter): programmatic scrolls are marked and ignored as leads.
2. **Alignment contract:** the markdown **source line at the top of the
   leader's viewport** is brought to the top of the follower's viewport,
   interpolating proportionally *between* block anchors (§2) for smooth
   motion within long blocks. Accuracy target: after the leader settles,
   the follower shows the same block at its top edge (±ONE block).
3. **Edges clamp:** leader at document start → follower at start; leader at
   end → follower at end (both panes' ends are reachable regardless of
   differing pane heights).
4. **Responsiveness:** the follower updates within one animation frame of
   the leader's scroll event — live tracking, not settle-then-jump.
5. **Editing:** typing that changes content does not itself trigger a
   re-sync (the editor is already where the user is working); the next
   scroll re-synchronizes against the freshly rendered preview.
6. **Interplay:** comment navigation (SPEC14) scrolling the split preview
   counts as a preview lead — the editor follows. The unsaved-changes
   guard, divider drag, and the mode-toggle scroll-ratio restore are
   untouched.

## 2. Source-line anchors in the rendered document (FR-R)

1. A rehype step in the existing pipeline (`src/lib/markdown.ts`) stamps
   every **top-level block element** (direct child of the document root:
   headings, paragraphs, lists, pre, table, blockquote, hr) with
   `data-mm-line` = its markdown **source start line** (1-based), taken
   from the position data remark already carries. No new dependencies —
   it's an inline plugin like `blockRemoteImages`.
2. **Sanitize stays the gate:** the schema admits exactly one new
   attribute — `dataMmLine` — and nothing else. It is inert data (no URL,
   no script surface); the SPEC11 network-isolation guarantee, CSP, and
   the render-isolation tests are unchanged. The anchor must never alter
   rendered *text* (the comment-anchor coordinate space is untouched —
   sidecar interop preserved).
3. Anchors are best-effort: nodes without position data are simply left
   unstamped; sync interpolates across gaps.

## 3. Seams and pure logic (FR-A)

1. **`src/lib/scrollSync.ts`** (new, pure — no DOM): given an ordered
   anchor table `Array<{ line: number; top: number }>` (top = pixel offset
   in that pane) plus the pane's content height:
   - `lineAtOffset(anchors, contentHeight, scrollTop): number` — fractional
     source line at a pixel offset (interpolated between anchors, clamped,
     proportional before the first / after the last anchor).
   - `offsetForLine(anchors, contentHeight, line): number` — the inverse.
   Round-tripping through both is stable (within a pixel/line epsilon).
   Unit-tested directly (U27).
2. **Editor seam:** `Editor` exposes an optional imperative handle
   (`syncRef`) with exactly what sync needs — read the fractional top line,
   scroll to a fractional line, and subscribe to user scrolls — implemented
   with CodeMirror's line-block geometry (real line heights, wrapped lines
   included; never `line × lineHeight` estimates).
3. **Preview side:** anchor table read from the `[data-mm-line]` elements'
   `offsetTop` in the split preview, rebuilt on render (html change),
   resize, and divider drag — never queried per scroll frame.
4. `App.tsx` owns the small controller wiring leader/follower over these
   seams, active only when the split view is mounted.

## 4. Web build & shim (FR-W)

1. Split edit exists on web and the shim identically; sync ships everywhere
   with no platform seam. W1–W5 unchanged.

## 5. Tests (all suites stay green; only these are added)

1. **U27** — `scrollSync` math: interpolation between anchors, clamping at
   both ends, proportional behavior before/after the anchor range, empty
   table (identity/proportional fallback), round-trip stability.
2. **U28** — anchor stamping: `renderMarkdown` output carries `data-mm-line`
   on top-level blocks with correct 1-based source lines for a fixture
   containing a heading, paragraph, fenced code block, list, and table;
   the attribute survives sanitize; rendered text content is byte-identical
   to the same render without stamping (comment coordinate space intact).
3. **E57** — editor leads: in split mode on a long document, scrolling the
   editor to a marker heading's line brings that heading to the top of the
   preview (element top within 120px of the pane top); scrolling the editor
   to the end bottoms out the preview; scrolling back to the top zeroes it.
4. **E58** — preview leads + no feedback loop: scrolling the preview to a
   marker heading brings the editor's viewport to that source line (top
   visible line within 5 lines of the heading's); after the leader stops,
   both panes' scrollTops are stable across two consecutive animation
   frames (no oscillation).
5. E42–E44 stay reserved for SPEC8. No existing test may be modified,
   weakened, skipped, or deleted.

## 6. Docs

1. README: the edit-mode bullet mentions synchronized scrolling in
   side-by-side mode. No screenshot refresh required in v15.

## 7. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U28, E1–E41 +
   E45–E58, W1–W5**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed.
3. No Windows-reserved path components:
   `git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]'`
   prints nothing.
4. `git diff src-tauri/tauri.conf.json` shows no CSP change; the sanitize
   schema diff admits only `dataMmLine`; `git diff --stat docs/specs/` is
   empty (SPEC15 lands in its own docs commit);
   `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. README updated per §6; version files untouched (they stay at
   0.2.0-alpha.3); no new runtime dependencies.
