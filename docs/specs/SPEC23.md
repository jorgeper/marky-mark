# SPEC23: Marky Mark v23 — editing trio: mirrored selection, vim nav mode, markdown highlighting

Delta spec on top of SPEC.md–SPEC22.md as implemented (all green: U1–U48,
E1–E41 + E45–E79, W1–W9; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §7 is the goal condition.

**What ships:**
1. **Mirrored selection (split edit):** selecting text in the split
   preview also selects the corresponding **source text** in the editor
   pane and scrolls it into view.
2. **Vim navigation mode in the editor:** with the existing Vim setting
   on, **Esc** puts the editor in a navigation-only modal state (h j k l,
   w b, 0 $, gg G, Ctrl+d/u — **no editing verbs, typing is inert**),
   with a visible **NAV badge**; **i** or **a** returns to typing.
3. **Markdown syntax highlighting in the editor:** headings, emphasis,
   code, links etc. colored from the active theme's variables. New
   setting, **on by default**, toggleable live (Settings → Editor).

Out of scope: editor→preview selection mirroring (one direction only),
vim editing commands (x, dd, visual mode, `/` search, counts, marks),
vim mode in the full-screen editor's *preview* (SPEC3 §5 already covers
preview), per-theme custom highlight palettes beyond the CSS variables,
mirroring selections that start or end inside images/tables' non-text
content (fallback below covers them).

---

## 1. Mirrored selection, preview → editor (FR-SEL)

1. Scope: **split edit only**, selections made in the split preview
   pane. Non-collapsed selections only — clicks/caret placement never
   steal the editor selection. One-directional (preview → editor).
2. Mapping runs through a **pure module `src/lib/selectionMap.ts`**:
   - `stripInline(line: string): { visible: string; map: number[] }` —
     the line's rendered-visible text plus a visible-index → source-
     offset map. Handles: heading `#`+space prefixes, blockquote `>`
     prefixes, list markers (`-`/`*`/`+`/`1.` + space), emphasis/strong
     markers (`*`, `**`, `_`, `__`), strikethrough `~~`, inline code
     backticks, links `[text](url)` → `text`, images `![alt](url)` → ``
     (images render as no selectable text).
   - `mapSelectionToSource(source: string, fromLine: number,
     toLine: number, selectedText: string): { from: number; to: number }
     | null` — locates the selection's visible text within the stripped
     form of source lines `fromLine..toLine` (whitespace-normalized
     match) and returns exact **source** offsets; `null` when it cannot
     (tables, raw HTML, text split by the renderer, ambiguity).
3. The app wires it with existing anchors: the selection's start/end
   blocks' nearest `data-mm-line` stamps bound the source line range
   (end bound: the next stamped block's line, else the buffer end).
   On `selectionchange` (debounced ≤ 200 ms, selection anchored inside
   the split preview only) the mapped range is dispatched to CodeMirror
   as its selection plus `scrollIntoView` — **without focusing the
   editor** (the preview selection must survive).
4. **Fallback:** a `null` mapping selects the whole covered source line
   range (line start of `fromLine` to line end of `toLine`). Never
   throw, never move the selection to a wrong-guess offset.
5. The editor shows its selection while unfocused: add CodeMirror's
   `drawSelection()` extension and style `.cm-selectionBackground`
   (focused and unfocused) from theme variables.
6. No new setting — the behavior is on whenever split edit is.

## 2. Vim navigation mode in the editor (FR-VIM)

1. Gated on the existing **`vimNav`** setting (default off, unchanged).
   Setting off ⇒ Esc keeps doing nothing in the editor; zero new
   behavior.
2. Modal state, **per editor mount, starts in typing mode**: **Esc** →
   nav mode; **i** or **a** → typing mode. Esc in nav mode stays in nav.
   Toggling edit↔preview or switching documents resets to typing mode.
3. Nav mode is **navigation-only**: the full keyset is
   - `h` `j` `k` `l` — char left/right, line down/up (cursor motion),
   - `w` / `b` — word forward/back (CodeMirror group semantics),
   - `0` / `$` — line start / line end,
   - `gg` / `G` — document top / bottom (same 500 ms `gg` window as
     preview vim-nav),
   - `Ctrl+d` / `Ctrl+u` — half viewport down/up (cursor moves, view
     follows, centered).
   Every motion moves the **cursor** and scrolls it into view. All
   other printable keys (and Enter/Backspace/Delete/Tab) are **inert**
   in nav mode — consumed, no buffer change, no beep-like side effects.
   OS/app accelerators (⌘-combos, the hotkey layer) are untouched; IME
   composition is never intercepted; arrow keys keep working.
4. The resolver is pure and unit-tested: extend `src/lib/vimnav.ts`
   with a `VimEditResolver` (mode transitions + keyset → action) —
   same style as the existing `VimNavResolver`, which is unchanged.
5. **Visual indication:** while in nav mode a **`NAV`** pill (test id
   `vim-badge`) is pinned to the editor pane's bottom-right corner
   (full edit and split edit alike), styled from theme variables.
   Leaving nav mode (i/a, mode switch, remount) removes it.
6. Settings → General: the existing Vim checkbox copy grows to cover
   both surfaces: "Vim-style navigation (preview: j/k, Ctrl+d/u, gg/G;
   edit: Esc for nav mode, i to type)".

## 3. Markdown syntax highlighting in the editor (FR-HL)

1. New setting **`editorSyntax: boolean`, default `true`**; parse
   accepts only booleans (else default), serializes as usual; old
   settings files parse to `true`. Checkbox in **Settings → Editor**
   (test id `editor-syntax`, label "Markdown syntax highlighting"),
   live-reconfigured through a CodeMirror compartment — no editor
   remount, undo history intact.
2. Implementation: `syntaxHighlighting(HighlightStyle.define([...]))`
   over the already-present `markdown()` language, mapping Lezer tags
   to **CSS classes** (prefix `mm-md-`): headings (per-level weight,
   `mm-md-h1`…`mm-md-h6` allowed to share a class beyond h2),
   emphasis (italic), strong (bold), inline code + fenced code,
   links/URLs, blockquote, list marks, and the markdown punctuation
   marks themselves (`#`, `*`, `` ` `` …) rendered dimmed. Colors and
   weights come **only from theme CSS variables** in `styles.css`
   (with sensible fallbacks), so every theme — built-in or custom —
   drives the palette without changes to the theme format.
3. Dependency note: the tag set imports from **`@lezer/highlight`**,
   which already ships in the dependency tree (transitively via the
   CodeMirror packages). Promoting it to an explicit `package.json`
   dependency (same version range as the vendored one) is permitted —
   this is the **only** allowed dependency change; the bundle gains no
   new code.
4. Off ⇒ exactly today's plain rendering (no `mm-md-*` classes in the
   editor DOM).

## 4. Test seam (dev shim only)

When the platform is the dev shim (`kind === 'browser'`), the app
maintains `window.__mmEdit = { head: number, headLine: number,
selFrom: number, selTo: number, selText: string, nav: boolean }`,
updated from the editor's update listener and the nav-mode state.
The desktop and web builds never set it (same gating style as
`__mmMenu`/`__mmPrints`).

## 5. Tests (added: U49–U51, E80–E82, W10)

1. **U49** — `VimEditResolver`: starts in typing mode; Esc/i/a
   transitions; in nav mode the full keyset resolves to the right
   actions (including `gg` timing window, `$`/`0`, Ctrl+d/u) and
   non-keyset printable keys resolve to `inert`; in typing mode every
   key resolves to `passthrough`; modified keys (⌘/Alt) pass through
   in both modes. Existing `VimNavResolver` tests untouched.
2. **U50** — `selectionMap`: `stripInline` visible text + offset maps
   for heading/list/quote prefixes, strong/emphasis/code/strike,
   links and images; `mapSelectionToSource` returns exact source
   offsets for a phrase spanning a `**bold**` boundary, whitespace-
   normalized matches, and `null` for unlocatable text (e.g. inside a
   table row).
3. **U51** — settings: `editorSyntax` defaults true, `{"editorSyntax":
   false}` honored, malformed values fall back true, round-trips.
4. **E80** — split edit: select a phrase that crosses bold markers in
   the split preview → `__mmEdit.selText` equals the **source**
   spelling (markers included), the editor scrolled to it, and the
   preview selection survived; a click (collapsed) leaves the editor
   selection unchanged; a selection inside a table falls back to the
   covering line range.
5. **E81** — vim nav: with the setting off, Esc in the editor does
   nothing (no badge, typing still edits). Turn it on: Esc → `vim-badge`
   visible; `j`/`k`/`w`/`0`/`$`/`gg`/`G` move `__mmEdit.headLine`/`head`
   as prescribed; typing letters/Backspace in nav mode leaves the
   buffer byte-identical; `i` → badge gone, typing edits again;
   toggling to preview and back re-enters typing mode.
6. **E82** — highlighting: a doc with a heading, bold text, and inline
   code shows `mm-md-*` classes on those tokens in the editor;
   Settings → Editor unchecking `editor-syntax` removes them live
   (buffer and undo intact — type before/after and undo once);
   setting survives reload.
7. **W10** — web build: heading tokens carry `mm-md-*` classes in edit
   mode by default; with Vim enabled in settings, Esc shows the NAV
   badge and `G` jumps to the last line.
8. No existing test may be modified, weakened, skipped, or deleted
   (none needs amendment — vim is opt-in, highlighting adds classes
   only, mirroring needs a non-collapsed split-preview selection);
   E42–E44 stay reserved.

## 6. Docs

ARCHITECTURE.md gains short sections on: the visible-text → source
offset mapping (and its line-anchor bounds + fallback), the editor's
modal nav state, and how `mm-md-*` classes bind themes to the
highlighter. README: one bullet under Edit mode covering the trio.

## 7. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U51, E1–E41 +
   E45–E82, W1–W10 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; docs/specs untouched by the build;
   `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing;
   Windows-reserved-name scan prints nothing.
3. The only permitted `package.json` change is the optional explicit
   `@lezer/highlight` entry (§3.3); `src-tauri/Cargo.toml` unchanged;
   version files untouched.
4. README + ARCHITECTURE.md updated per §6.
