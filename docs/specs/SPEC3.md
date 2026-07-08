# SPEC3: Markimark v3 — Typora-grade settings, vim nav, tighter Claude theme

Delta spec on top of `SPEC.md` + `SPEC2.md` (all shipped and green: U1–U11, E1–E16,
W1–W4). Where this file conflicts with earlier specs, this file wins; nothing else may
regress. Written for autonomous execution via `/goal`; read all three specs before
coding. The Definition of Done in §9 is the goal condition.

---

## 1. What v3 adds

1. **Typora-style Appearance settings**: font size (Auto / Customized px), zoom
   (percent + Reset to Default), light theme + dark theme pair with "Use separate
   theme in dark mode", and an **Open Theme Folder** button. Explicitly **excluded**
   (per product decision): mouse-wheel zoom, word count, and "Get Themes".
2. **Save As…** in the menu.
3. **Icon polish**: the menu button becomes a hamburger (three horizontal bars); the
   comments toggle becomes an outline speech-balloon icon (no color emoji).
4. **Text margins** option and **Show line numbers** option.
5. **Vim-style navigation** (simplified, opt-in): `gg`, `G`/`GG`, `Ctrl+u`, `Ctrl+d`,
   `j`, `k`.
6. **New Claude theme**, replacing the current one, modeled on the user's Typora
   `claude.css` (values pinned in §7 — the Typora file itself is NOT available at
   build time; this spec is self-contained).

## 2. Settings model (FR-S)

Extend `Settings` (with `parseSettings` fallbacks; unknown/invalid values → defaults):

```ts
fontSize: 'auto' | number   // default 'auto'; custom range 10–32 (px)
zoom: number                // percent, default 100; menu of 50,75,90,100,110,125,150,175,200
themeLight: string          // default 'crisp'   (replaces the old `theme` key)
themeDark: string           // default 'one-dark'
useDarkTheme: boolean       // default true — "Use separate theme in dark mode"
margins: 'default' | 'narrow' | 'medium' | 'wide'   // default 'default'
lineNumbers: boolean        // default true (edit mode gutter)
vimNav: boolean             // default false
```

**Migration**: a legacy `settings.json` containing `theme: X` loads as
`themeLight: X` (and keeps working untouched otherwise). Unit-test this (U13).

### Behaviors

- **Font size** (Typora's "Auto (Recommended) / Customized N px"): radio pair + number
  input. Auto uses the theme's `--mm-font-size`; Customized overrides it (inline style
  on the app root so it beats any theme). Applies to preview AND the editor.
- **Zoom**: `<select>` of the percentages above + a "Reset to Default" button (→ 100).
  Implement via CSS `zoom` on the app root. **No mouse-wheel/⌘-wheel zoom.**
- **Themes**: two selects — Light Theme and Dark Theme — each listing all themes, plus
  the "Use separate theme in dark mode" checkbox. The active theme follows the OS via
  `matchMedia('(prefers-color-scheme: dark)')` (live listener, not just at startup):
  dark mode + checkbox on → `themeDark`; otherwise `themeLight`. The old single
  `settings-theme` select is replaced by these two (`settings-theme-light`,
  `settings-theme-dark` testids); Reload themes / Import theme… stay.
- **Open Theme Folder**: desktop-only button; reveals `<configDir>/themes` in
  Finder/Explorer via a new optional `Platform.revealThemesDir?()` (Tauri:
  `tauri-plugin-opener`; add the plugin + capability). Hidden on web (Import theme…
  remains). The browser shim records the call on `window.__mmfs.revealedThemesDir =
  true` so E-tests can assert the wiring without an OS file manager.
- **Text margins**: select {Default (theme), Narrow, Medium, Wide} — margin around the
  text, i.e. progressively narrower columns: Narrow → `--mm-content-width: 60rem`,
  Medium → `48rem`, Wide → `38rem`, Default → whatever the theme sets. Applies to
  preview and the editor line padding (which already derives from the same variable).
- **Show line numbers**: toggles the CodeMirror `lineNumbers()` gutter.
- Settings panel grows sections in this order: **Appearance** (font size, zoom,
  themes, margins), **Editor** (line numbers, autosave-on-toggle), **Comments**
  (author, storage), **Navigation** (vim keys), **Hotkeys**. Keep it one scrollable
  modal; don't rebuild it as tabs.

## 3. Save As… (FR-A)

1. Menu gains **Save As…** between Save and Settings…. It prompts for a destination
   (`Platform.saveFileDialog(suggestedName): Promise<string | null>` — Tauri:
   `dialog.save` with `.md` filter; browser shim: returns
   `window.__mmfs.nextSavePath` if a test set it, else prompt(); web: FSAA
   `showSaveFilePicker` when available, else download with the suggested name).
2. Save As writes the current buffer (plus embedded trailer when in embedded mode),
   switches the open document to the new path (title, watcher, sidecar path all follow),
   and in sidecar mode also writes the sidecar next to the NEW file. Comments travel
   with the document.
3. **Sanctioned test rewrite**: E13's "exactly Open/Save/Settings" assertion updates to
   "exactly Open…/Save/Save As…/Settings…" (4 items). No other v1/v2 test may change.

## 4. Icons (FR-I)

1. `menu-btn` renders an inline SVG hamburger — three horizontal bars (e.g. three
   `<rect>`/`<line>` strokes) — not the "⋯" glyph and not an emoji.
2. `comments-toggle` renders an inline SVG **outline** speech balloon (rounded-rect
   bubble + tail, `stroke: currentColor`, `fill: none`) so it inherits theme color;
   the comment count stays as text next to it. No 💬 emoji anywhere in the toolbar.
3. Both SVGs get `data-testid` (`menu-icon`, `comments-icon`) so tests can assert
   `svg` presence and emoji absence.

## 5. Vim-style navigation (FR-V)

1. Off by default; enabled by the `vimNav` setting (Navigation section).
2. **Preview mode only**, and only when focus is not in an input/textarea/
   contenteditable and no modal is open. Never intercepts configured app hotkeys.
3. Keys (scroll container = the workspace):
   - `j` / `k` — scroll down / up by ~60 px
   - `Ctrl+d` / `Ctrl+u` — half viewport down / up
   - `gg` — jump to top (two `g` presses within 500 ms)
   - `G` (Shift+g; a second consecutive `G` is harmless) — jump to bottom
4. The sequence logic lives in a pure module `src/lib/vimnav.ts` — a resolver that
   takes key events + a monotonic timestamp and returns
   `'up'|'down'|'halfUp'|'halfDown'|'top'|'bottom'|null` with internal pending-`g`
   state. Unit-test it without DOM (U12).

## 6. Project structure additions

```
  SPEC3.md               (this file — do not modify)
  src/lib/vimnav.ts      (pure key-sequence resolver)
  themes/claude.css      (REPLACED — see §7)
```

## 7. The new Claude theme (FR-T)

Replace `themes/claude.css` (same id `claude`, `@variant: light`) with a faithful
Markimark port of the user's Typora Claude theme. Pinned values (extracted from that
file; do not invent different ones):

| Aspect | Value |
| --- | --- |
| Background / hover surface | `#faf9f5` / `#f0eee6` |
| Ink / secondary ink | `#141413` / `#3d3d3a` |
| Accent (links-hover, caret, selection, blockquote accents) | `#D97757` |
| Body font | **serif body**: `"Anthropic Serif Web Text", Georgia, "Times New Roman", serif` |
| UI/sans + mono stacks | `"Anthropic Sans Web Text", system-ui, …` / `"Anthropic Mono Variable", ui-monospace, monospace` |
| Base size / line height | `16px` / `1.5` (tighter than the old Claude theme's 16.5px/1.75) |
| Content width | `752px` (`--mm-content-width: 47rem`) |
| Headings (tight!) | h1 `1.375rem`, h2 `1.125rem`, h3 `1rem`, all `700`, compact margins (≈`0.75rem 0 0.25rem`) |
| Inline code | `#8a2424` on `rgba(61,61,58,0.05)`, hairline border `rgba(31,30,29,0.15)` |
| Code block surface | `rgba(255,255,255,0.5)` with border `rgba(31,30,29,0.15)` |
| Blockquote | 4px left border `rgba(31,30,29,0.10)`, text `#3d3d3a` |
| Tables | **bottom-only** hairline borders: th `rgba(31,30,29,0.6)`, td `rgba(31,30,29,0.3)` (extra CSS under `.theme-root`, overriding the default grid) |
| hr | `rgba(31,30,29,0.3)` |
| Selection | terracotta-tinted (`#D97757` at ~35% alpha) |
| Comment tint | terracotta family, idle ≈0.20 alpha / active ≈0.38 |

Notes: no `@font-face`/remote fonts (the loader rejects remote URLs; the Anthropic
family names lead the stacks so they're used if locally installed, otherwise the
fallbacks apply). Syntax colors: keep a muted, warm set harmonious with the palette
(keyword `#ab2b65`-family, string `#576f3f`, number/meta `#b0592e`, comment `#9c9a92`).
Since heading sizes/margins and table borders exceed the variable contract, use extra
CSS scoped under `.theme-root` — that capability exists precisely for this.

Default `themeLight` stays `crisp` — do not change defaults to claude.

## 8. Validation harness (extends v2)

Same `npm run validate` pipeline; new tests:

Unit:
- **U12**: vimnav resolver — `j`/`k`/`Ctrl+d`/`Ctrl+u` map correctly; `g` then `g`
  within the window → `top`; `g` then timeout then `g` → null (no jump); `G` →
  `bottom`; unrelated keys reset pending state; disabled resolver never fires.
- **U13**: settings v3 — new fields parse with defaults; out-of-range font size and
  unknown margins fall back; legacy `{"theme":"monokai"}` migrates to
  `themeLight: 'monokai'`.

Desktop e2e (rewritten per §3.3: **E13** now asserts 4 menu items incl. Save As…):
- **E17**: `menu-btn` contains an `svg` (`menu-icon`) and no "⋯" text;
  `comments-toggle` contains an `svg` (`comments-icon`) and its text contains no 💬.
- **E18**: Save As — set `__mmfs.nextSavePath = '/docs/copy.md'`, menu → Save As… →
  the new file exists with the buffer content, `docname` shows `copy.md` with
  `title="/docs/copy.md"`, and (sidecar mode) comments were written next to the new
  path.
- **E19**: font size — Customized 20 → `.doc` computed `font-size: 20px`; back to
  Auto → the theme default (16px for Crisp).
- **E20**: zoom — select 150% → app root's computed `zoom` is `1.5`; Reset to
  Default → back to 1. (Assert via `getComputedStyle(...).zoom`.)
- **E21**: light/dark pair — set Light=crisp, Dark=one-dark, checkbox on;
  `page.emulateMedia({colorScheme:'dark'})` → background `rgb(40, 44, 52)`;
  back to light → white; uncheck "Use separate theme in dark mode" → dark scheme now
  keeps the light theme (white).
- **E22**: margins Wide → `.doc` computed max-width `608px` (38rem); line numbers —
  editor shows a `.cm-lineNumbers` gutter by default, and none after disabling the
  setting.
- **E23**: vim nav — disabled: `j` does not scroll; enabled: `j` scrolls down, `k`
  back up, `Ctrl+d` jumps ~half a viewport, `G` reaches the bottom, `gg` returns to
  `scrollTop === 0`; typing `j` into the comment composer inserts a "j" and does NOT
  scroll.
- **E24**: new Claude theme — select claude as Light Theme → background
  `rgb(250, 249, 245)`; `.doc` computed font-family starts with a serif stack
  (contains `Georgia`); h1 computed font-size `22px` (1.375rem); `.doc` max-width
  `752px` (margins Default).

Web suite W1–W4 must stay green unchanged.

**Anti-gaming constraints (binding)**: as before — no skipped/weakened tests, no
hardcoded outputs, blockers to `BLOCKERS.md`, SPEC.md/SPEC2.md/SPEC3.md and the goal
condition unmodified. The ONLY sanctioned rewrite is E13 (4 menu items).

## 9. Definition of Done (the /goal condition verifies exactly this)

All demonstrated in the transcript, in the completion turn:
1. `npm run validate` exits 0 with complete output — **U1–U13, E1–E24, W1–W4**, the
   single-file check, and final `VALIDATION: ALL PASSED` — printed.
2. `npm run tauri build` (macOS) exits 0; `.app` path + size printed (< 25 MB). The
   Windows NSIS cross-build re-run exits 0 with its artifact path + size printed
   (toolchain already installed; if it now fails, BLOCKERS.md documents it honestly).
3. `ls dist-web/` shows exactly `index.html`, size printed.
4. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing;
   `git diff --stat SPEC.md SPEC2.md SPEC3.md` empty.
5. `ARCHITECTURE.md` updated: appearance settings (font size/zoom/margins/light-dark
   pair), vim navigation module, Save As flow, and the new Claude theme's provenance.

## 10. Build order

1. Settings model + migration (U13), vimnav.ts (U12) — TDD.
2. Appearance/Editor/Navigation settings UI + behaviors (E19–E22).
3. Light/dark pair + matchMedia switching (E21); Open Theme Folder plumbing.
4. Save As (E18) + menu/icon changes (E13 rewrite, E17).
5. Vim navigation wiring (E23).
6. New claude.css (E24).
7. Full validate; mac + windows builds; ARCHITECTURE.md; DoD evidence.
