# Markimark — Architecture

## Overview

Markimark is a Tauri 2 desktop app: a minimal Rust host (window, file
associations, fs/dialog plugins) with all application logic in a Vite + React +
TypeScript frontend running in the OS-native webview (WKWebView on macOS,
WebView2 on Windows). There is no server and no network access; documents are
plain files on disk, comments live in pretty-printed sidecar JSON next to them,
and themes/settings live in the app config directory.

```
OS (double-click .md / CLI arg) ──▶ Rust host (src-tauri/src/lib.rs)
                                        │ queues opens, emits mm://open-file
        ┌───────────────────────────────┴──────────────────────────────┐
        │ webview: React app                                           │
        │   src/platform/   ← THE seam: tauri.ts / web.ts / browser.ts │
        │   src/lib/        ← pure logic: markdown, anchoring, themes… │
        │   src/components/ ← toolbar, editor, comment cards, settings │
        └───────────────────────────────────────────────────────────────┘
              documents/*.md + *.md.comments.json      <configDir>/themes/*.css
                                                        <configDir>/settings.json
```

## The platform seam (SPEC FR-6, SPEC2 §3)

Every filesystem, path, dialog, window, and event access goes through the
`Platform` interface (`src/platform/types.ts`). Three implementations:

- **`tauri.ts`** — the desktop backend, macOS and Windows (plugin-fs,
  plugin-dialog, window APIs, asset protocol for local images,
  `RunEvent::Opened` + CLI-arg drain for file associations).
- **`browser.ts`** — a virtual filesystem persisted to `localStorage`, used by
  `vite dev` and the desktop-shim Playwright suite (exposed to tests as
  `window.__mmfs`). Selected only in dev mode or with `?shim=1`.
- **`web.ts`** — the static-web production platform behind the single-file
  build. Open uses `showOpenFilePicker` with an `<input type=file>` fallback;
  drag-and-drop grabs a writable handle via `getAsFileSystemHandle()` when the
  browser offers one; Save writes through the handle or, handle-less, triggers
  a download via the optional `Platform.commitFile()` hook — which only fires
  on explicit Save, so comment autosaves never spam downloads. Settings, the
  selected theme, and imported user themes (`importTheme()`) live in
  `localStorage`; documents live in memory.

App code never imports host APIs directly and never assumes an OS; hotkeys
use a "Mod" abstraction (⌘ or Ctrl).

## Native menus & the command registry (SPEC12)

On desktop there is no in-app header at all: the platform's native menu bar
(system menu bar on macOS, in-window menu bar on Windows) and the window
title carry everything the toolbar used to. Three pieces make that work:

- **`src/lib/commands.ts`** — a named-command registry, the single dispatch
  point for every user action. The DOM toolbar (web), the native menu
  (desktop), and the hotkey listener all call `dispatchCommand(id, source)`;
  `App.tsx` registers the handlers once. A small cross-source window makes a
  combo that is both a native accelerator and an in-app hotkey fire exactly
  once per keypress, whichever path the OS delivers first.
- **`src/lib/menuSpec.ts`** — pure `buildMenuSpec(state)` → plain data (no
  Tauri imports): submenu layout per OS, checkbox state, the live comment
  count, and accelerators that track the user's rebindable hotkeys. Unit
  tests (U19–U21) assert on it directly.
- **`Platform.setAppMenu?(spec)`** — the seam. `tauri.ts` converts the spec
  to real `@tauri-apps/api/menu` objects and installs it (rebuilt on state
  change; each install replaces the previous menu atomically). `web.ts`
  never defines it. `browser.ts` defines it only under `?nativeMenu=1`,
  recording the spec on `window.__mmMenu` with a `click(command)` hook — the
  e2e seam (E47–E50), since Playwright cannot click real native menus.

**The render rule:** the header renders iff `platform.setAppMenu` is
undefined. Quit/Exit/Close Window are custom items routed through the same
unsaved-changes guard as the window close button — never predefined Quit,
which would bypass it. Menus are local UI: no new network surface, and the
SPEC11 isolation guarantee (CSP, sanitize layer, bundle scan) is unchanged.

## Aux windows: Settings & About (SPEC13)

On desktop, Settings (⌘,) and About open as real windows (Tauri labels
`settings`/`about`), not in-page overlays. One owner, dumb views: the main
window keeps sole ownership of settings state, `settings.json`, themes, and
command handlers; aux windows render only what they're sent. The protocol
(`src/lib/auxProtocol.ts`, pure) rides the platform event bus:
`mm://aux-ready` → `mm://aux-init` (handshake), `mm://settings-edit` (whole
Settings up), `mm://aux-request` (reload/reveal/open-external side effects
run by main), `mm://settings-changed` / `mm://themes-changed` (canonical
echo down — applying a broadcast never re-emits, and edits merge through the
latest canonical state so panel-unedited keys like `splitRatio` are never
clobbered). `src/lib/windowRole.ts` routes `?window=` to the right React
root. Render rule: the overlays render iff `platform.openAuxWindow` is
undefined — web keeps them, desktop never shows them, the dev shim provides
aux windows under `?nativeMenu=1` via `window.open` + BroadcastChannel so
Playwright drives the real two-window protocol (E51–E53). Security posture:
aux windows run under their own capability
(`src-tauri/capabilities/auxiliary.json` — not `aux.json`; `AUX` is a
reserved filename on Windows and would break checkout there) with events
and self-close only — no
fs, dialog, or opener permissions.

## Updates: Check for Updates… (SPEC19)

The desktop app updates itself from **GitHub Releases** via the official
`tauri-plugin-updater` — no server of ours, strictly user-initiated.

**The flow, end to end.** The menu item (app menu on macOS, Help on
Windows) dispatches the `checkUpdates` command → `UpdateDialog` opens and
calls through the `Platform.updates` seam (`check` /
`downloadAndInstall(onProgress)` / `restart`). On desktop that seam wraps
the updater and process plugins: the **Rust side** fetches the manifest,
compares versions, downloads the platform bundle, **verifies it against
the minisign public key baked into `tauri.conf.json`**, swaps the
installed app, and relaunches. A tampered, corrupted, or wrong asset fails
closed — GitHub is the host, but the signature is the trust anchor. The
dialog walks checking → up-to-date / available (version + notes) →
progress → restart, with dismissable error states (offline, bad manifest,
bad signature) — never a crash, never a partial install.

**The endpoint: a rolling release.** The app polls exactly one URL,
`releases/download/updater/latest.json` on this repo — a release tagged
`updater` that exists only as a machine-consumed pointer. The indirection
exists because GitHub's `releases/latest` convenience skips pre-releases,
which every alpha is. The pointer only ever advances on **publish**: the
`updater-manifest` workflow (`on: release published/prereleased/released`,
plus a manual `workflow_dispatch` recovery lever) copies the published
release's `latest.json` onto the rolling release. Draft releases are
therefore invisible to the updater, exactly like they're invisible to
downloads — the human publish flip remains the single gate.

**The pipeline half.** Release builds run with the signing key
(`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` from Actions secrets;
`bundle.createUpdaterArtifacts` in tauri.conf) and emit
`Marky.Mark_<version>_universal.app.tar.gz` + `.sig` (macOS) and a signed
NSIS installer (Windows). `scripts/updater-manifest.mjs` (pure, U42)
composes `latest.json` — per-platform URLs into the versioned release's
assets with the signature *contents* embedded. Key management: the private
key lives only in Actions secrets and an out-of-repo backup; losing both
means future updates can't be signed (users fall back to manual
downloads). No private-key material may ever be committed.

**The privacy invariant, restated.** The *webview* still makes zero
network requests — its CSP, the sanitize layer, the static bundle scan,
and the W4/W5 adversarial tests are unchanged and still enforced. The
updater's network lives entirely in Rust, fires only on the user's
explicit menu click, and speaks only to the two GitHub endpoints. No
scheduled checks, no telemetry. `docs/security/assessment.md` carries the
formal amendment.

**Testing.** The shim implements `Platform.updates` as a mock driven by
`window.__mmUpdate` (next result, recorded progress/installs/restarts) —
E69 walks the full dialog flow, E70 proves failures are honest and
recoverable; U41 pins the menu placement, U42 the manifest schema. The
real network path is intentionally untestable in CI and is verified live:
install release N, publish N+1, Check for Updates… must offer and install
it.

## Images: paste & resize (SPEC20)

**Paste, through the seam.** A CodeMirror `paste` handler intercepts any
clipboard payload carrying image items (mixed clipboards: the image wins;
text-only pastes take the default path). App code expands the configurable
name pattern (`{doc} {n}` by default; Settings → Editor → Images) against a
one-shot `readDirNames` snapshot of the target folder, sanitizes the result
(reserved Windows basenames get `-img`, forbidden characters stripped), and
writes the bytes via the one new platform method, `writeBinaryFile(path,
bytes)` — parent directories created, images landing in a folder *next to
the document*. The editor then inserts a percent-encoded `![name](folder/…)`
at the cursor, flowing through the normal dirty/undo/save path (the file
write itself is not undoable; the text is). Desktop implements the seam
with plugin-fs; the dev shim stores a `data:` URI in its virtual fs and
serves it back through `resolveAssetSrc`, so pasted images render for real
in e2e (E71–E72); the web build leaves the method undefined and paste shows
a quiet needs-desktop notice (W8). An unsaved buffer has no "next to" —
paste there asks for a save first and writes nothing.

**Resize, by source span.** The render pipeline stamps every doc-originated
`<img>` with `data-mm-src-start/end` — 0-based offsets into the markdown
source, taken from the parser's own positions in the same pass that stamps
`data-mm-line` (attribute-only, so the SPEC6 comment-anchor space is
untouched). Clicking an image in preview shows corner handles and a size
badge; releasing a drag splices exactly that span in the buffer, rewriting
the image reference to `<img src alt width="N">` — portable HTML that
GitHub renders. To make that round-trip, the pipeline grants passage to
exactly one raw-HTML shape: an mdast `html` node whose entire value is a
single `<img …>` tag becomes a real img element with a whitelisted
attribute set (src/alt/title/width/height); all other raw HTML stays
dropped as ever (no rehype-raw, no dangerous mode), and sanitize still runs
after (the schema widens by `width`/`height` and the two span attributes on
`img`, nothing else). Double-click removes the width; a tag once HTML stays
HTML. U45/U46 pin the stamping and the splice; E74/E75 drive the handles.

## Windows build story

The app code was Windows-portable from v1 (this seam, `Mod` hotkeys,
`appConfigDir()`-relative paths, CLI-arg file-association handling in
`lib.rs`). Two build paths:

1. **CI (canonical)** — `.github/workflows/release.yml` (the SPEC10 release
   pipeline, below) builds the NSIS installer natively on `windows-latest`
   (plus the universal macOS `.dmg` and the single-file web page) on `v*`
   tag push or manual dispatch.
2. **Cross-compile from macOS (experimental Tauri path)** —
   `rustup target add x86_64-pc-windows-msvc`, `cargo install cargo-xwin`,
   `brew install nsis llvm`, then
   `npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`.
   cargo-xwin downloads the MSVC CRT/SDK; NSIS bundling runs via Homebrew's
   `makensis`. Output lands under
   `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

`WINDOWS.md` documents the details.

## Anchor coordinate space (the key decision)

**Comment anchors are character offsets into the rendered plain text of the
document** — the concatenation of every DOM text node under the document
container, in tree order (exactly what `Range.toString()` yields). They are
*not* offsets into the markdown source.

This is the same decision as the sibling `md-with-comments` project, kept
deliberately: the sidecar schema (`exact` / 32-char `prefix`/`suffix` /
`start`/`end`) **and** the coordinate space match, so a `foo.md.comments.json`
written by either app anchors correctly in the other (verified by unit test
U8 against a real sidecar fixture from that repo). To keep the coordinate
space identical, the rendering pipeline is pinned to the same unified chain:

`remark-parse → remark-gfm → remark-rehype → rehype-sanitize (GitHub schema +
task-list checkboxes) → rehype-highlight → rehype-stringify`

`rehype-highlight` only wraps code text in `<span>`s — it never changes text
content, so it does not perturb offsets. Sanitization means documents can
never execute script.

Re-anchoring cascade on every load (`src/lib/anchoring.ts`, pure, DOM-free):

1. **Exact-at-offset** — `text.slice(start, end) === exact`.
2. **Quote search** — unique occurrence wins; among duplicates, the occurrence
   whose surroundings best match the stored prefix/suffix wins (ties → nearest
   to the stored offset).
3. **Fuzzy** — diff-match-patch `match_main`, threshold 0.4, distance 5000;
   selections longer than bitap's 32-char limit match head and tail
   independently and stitch (0.5×–2× length sanity check).
4. **Orphaned** — card kept with a badge and the original quote; no highlight;
   nothing deleted. Successful re-anchors refresh the stored anchor and
   autosave (debounced 800 ms; sidecar is deleted when the last comment goes).

## Comment storage: sidecar or embedded (SPEC2 §5)

`commentStorage` in Settings picks where comments persist:

- **Sidecar** (desktop default): `foo.md.comments.json` next to the file —
  the v1 behavior, interoperable with md-with-comments.
- **Embedded** (forced on web): an invisible trailer at the end of the file:

  ```
  <!-- markimark-comments
  {"version":1,"comments":[ …sidecar schema… ]}
  -->
  ```

  HTML comments are stripped by Markimark's sanitizer and hidden by GitHub
  and every mainstream renderer. `src/lib/embedded.ts` (pure) owns the
  format: `splitEmbedded` strips the trailer on load — it never appears in
  preview or the edit buffer — and `attachEmbedded` re-appends it on save,
  byte-preserving the content and never double-attaching.

  **The `-->` escape**: a comment body containing `-->` would close the HTML
  comment early, so serialization rewrites every `-->` in the JSON text as
  `-\u002d>` — a standard JSON string escape (`\u002d` is `-`) that
  `JSON.parse` restores losslessly. (`-->` can only occur inside JSON string
  literals, so the blanket replace is safe.)

  **Autosave semantics**: comment changes rewrite the file as *last-saved
  text + new trailer* — unsaved text edits are never flushed by a comment
  autosave; an explicit save writes buffer + trailer together.

  **Migration**: on load, comments come from the trailer if present, else the
  sidecar; if both exist they merge by id with trailer entries winning.
  Switching to embedded deletes the sidecar after the first embedded write;
  switching to sidecar strips the trailer on the next file save and writes
  the sidecar. Nothing is lost in either direction.

## Appearance settings (SPEC3 §2)

Typora-style controls, all persisted in `settings.json` (legacy `theme` key
migrates to `themeLight`):

- **Font size** — Auto uses the theme's `--mm-font-size`; Customized (10–32 px)
  sets that variable inline on the app root, which wins over any theme and
  also scales the editor (its font-size derives from the same variable).
- **Zoom** — preset percentages applied as CSS `zoom` on the app root, with
  Reset to Default. No wheel zoom by design. Selection-button placement and
  margin-card alignment divide by the zoom factor (rects are measured in
  zoomed viewport px; style offsets apply pre-zoom).
- **Light/Dark theme pair** — `themeLight` + `themeDark` selects plus "Use
  separate theme in dark mode". A live `matchMedia('(prefers-color-scheme:
  dark)')` listener picks the active theme; unchecking pins the light theme
  in every scheme. **Open Theme Folder** reveals `<configDir>/themes` via
  `tauri-plugin-opener` (desktop only; the e2e shim records the call).
- **Text margins** — presets override `--mm-content-width` (narrow 60rem /
  medium 48rem / wide 38rem; Default leaves the theme's value).
- **Show line numbers** — a CodeMirror `Compartment` reconfigures the gutter
  live without recreating the editor.

## v7 (SPEC7)

- **Fixed-size settings dialog**: `.settings-modal` is a fixed box —
  `min(560px, 94vw)` × `min(480px, 85vh)` — so switching tabs never resizes
  or shifts the dialog; a tab taller than the box scrolls inside
  `.tab-content` while the rail and chrome stay put.
- **Comments master switch**: `commentsEnabled` (default on) gates every
  comment affordance — highlight injection, the margin panel, the floating
  selection button, type-to-comment, the toolbar toggle, and its hotkey.
  It is strictly non-destructive: stored comments (sidecar or trailer) are
  never rewritten by the switch; disabling only stops *rendering* them, and
  saves keep attaching the untouched comment set as before.
- **Type-to-comment**: `typeToComment` (default on). While the floating
  button is showing (non-collapsed preview selection), a printable keydown
  with no Cmd/Ctrl/Alt opens the composer seeded with that character (caret
  after it, via a focus-time `setSelectionRange`). App hotkeys and inputs
  are excluded by the same guards as elsewhere; vim-nav now ignores keys
  whenever a selection is live, so the two features can't fight.
- **Resolved ghosts, settings-owned**: the "Show resolved" switch moved from
  the panel header into Settings → General → Comments, and its default
  flipped to **on** — resolving now ghosts the card in place immediately.
  Ghosts faded from 0.55 to **0.40** opacity (highlight tint 40% → 25%), and
  resolving clears the card's active state so the brighter `.active` styling
  never masks the fade.
- **Split edit** (`splitEdit`, default off): edit mode becomes editor |
  divider | live preview instead of the full-screen swap. The right pane is
  a plain reading pane (same sanitized pipeline + asset-src resolution, no
  comment UI — reading preview stays the comments surface) re-rendered on a
  200 ms debounce. The 5 px divider drags with pointer capture, writing the
  `--mm-split` CSS variable directly during the drag (no React re-render per
  mousemove) and persisting `splitRatio` (clamped 0.2–0.8) on release;
  double-click resets to 0.5.
- **Undo history survives mode toggles**: CodeMirror's `history()` +
  `historyKeymap` already provide ⌘Z/⇧⌘Z, but the editor unmounts on every
  toggle. On unmount the editor now serializes its state
  (`EditorState.toJSON({ history: historyField })`) into an App-held ref and
  revives it on the next mount (`fromJSON` with fresh extensions), so
  undo/redo — and the caret — survive preview↔edit round-trips. Opening a
  different document resets the parked state; a buffer that moved on while
  in preview (file watcher) is converged as one undoable change.

## v6 (SPEC6)

- **Editor column alignment**: the CodeMirror scroller centers its content
  (`justify-content: center`) with the content element capped at
  `--mm-content-width` (border-box, 32px side padding) — the same geometry as
  preview's `.doc`, so toggling modes never shifts the text column. With the
  line-number gutter on, the gutter+content pair is centered, shifting text
  by at most half the gutter width.
- **Word-style comment flow**: margin cards are absolutely positioned with
  animated `top`s (180 ms). Flow margins were replaced because they can only
  push cards DOWN — the Word behavior needs the active card anchored level
  with its highlight while earlier cards stack upward above it. Idle layout
  is unchanged visually. Cards wear a faint shadow (`--mm-card-shadow`),
  deeper when active; the panel's min-height is set from the computed layout
  so scrolling still reaches everything.
- **Resolved ghosts**: "Show resolved" (panel header, persisted as
  `showResolved`, default off) renders resolved comments ghosted in place
  (55% opacity cards, faint `mark.hl.ghost` highlights) with Reopen/Delete
  live; off keeps the collapsed Resolved (N) section. Resolving never touches
  the stored comment beyond its `resolved` flag — the sidecar/trailer formats
  are unchanged.
- **Theme catalog ×27**: 20 new built-ins generated from canonical palettes —
  typographic lights (Crisp Mono, Typewriter, Manuscript, Newsprint, Sepia),
  programming classics (Solarized Dark, Gruvbox ×2, Tokyo Night, Catppuccin
  ×2, GitHub Dark, Rosé Pine, Everforest, Night Owl, Zenburn, Ayu Light), and
  terminal/quirky (Phosphor and Amber Terminal with CRT glow, Vaporwave with
  a gradient h1). U14 machine-checks the catalog: unique ids, valid metadata,
  distinct backgrounds, no rejected files.

## v5 polish (SPEC5)

- **Rename**: the product is **"Marky Mark"** everywhere users see it (window
  titles, bundle `productName` → `Marky Mark.app`, welcome doc, docs, web
  `<title>`). The bundle **identifier stays `com.markimark.app`** on purpose:
  changing it would relocate the config dir and orphan existing settings,
  themes, and the welcome doc. Internal names (npm package, crate, test ids,
  the `markimark-comments` trailer marker — a file format!) are unchanged.
- **App badge**: with no document open, the toolbar title slot shows an
  inline-SVG replica of the app icon (white M on the terracotta rounded
  square) instead of the app name.
- **Auto-hide is opt-in now** (`autoHideToolbar`, default false). Off = the
  bar is permanent and the workspace gets matching top padding
  (`.toolbar-static`); on = the SPEC4 hide/reveal behavior. Hover and focus
  pins are derived from window/document-level events (mousemove, focusin,
  mousedown) rather than enter/leave/blur pairs alone — Chromium drops those
  boundary events when the hovered/focused node (a closing menu item) is
  unmounted, which otherwise wedges the bar visible.
- The empty-state hint is absolutely centered in the window.

## v4 chrome (SPEC4)

- **Auto-hiding toolbar**: the bar is an absolutely-positioned overlay
  (`.toolbar-shell`, translateY transition, faint bottom shadow via
  `--mm-toolbar-shadow`). Visible for `TOOLBAR_GRACE_MS` (2.5 s) after launch,
  then hidden; a 20 px top hot zone reveals it on hover, and it re-hides
  `TOOLBAR_HIDE_DELAY_MS` (400 ms) after the pointer leaves. It stays pinned
  while the menu popover or any modal is open, or focus is inside the bar.
  The workspace owns the full window height, so hiding never reflows content;
  the editor's top padding clears the bar so a revealed overlay never covers
  the first line.
- **Tabbed settings**: the modal is a left tab rail (Appearance / General /
  Hotkeys) + content pane, max 70vh. Appearance = font size, zoom, theme
  pair, theme folder actions, margins; General = editor, comments,
  navigation; Hotkeys = recorders. Inactive tabs are unmounted.
- **Text-only zoom**: zoom is a `--mm-zoom` font multiplier consumed by the
  document and editor font-size calcs — CSS `zoom` (v3) scaled the whole UI
  including dialogs, so it was dropped, along with its coordinate
  compensation in comment positioning.
- **Clean start + Help**: no auto-opened welcome; an empty state shows a
  drag-a-file hint (with the user's actual open hotkey). The menu's Help item
  opens the welcome doc through the normal open path.
- **Open guard**: every user-initiated open (dialog, Help, drag-drop,
  association events) routes through one guard that shows a
  Save / Don't save / Cancel prompt when the buffer is dirty (same-path
  reopens and watcher reloads are exempt).
- **Margins**: presets super-narrow 76rem / narrow 60rem / medium 48rem /
  wide 38rem; all seven built-in themes now ship a 60rem column (Claude's
  752px Typora column was superseded by this).

## Vim-style navigation (SPEC3 §5)

Opt-in setting. `src/lib/vimnav.ts` is a pure key-sequence resolver
(`j`/`k` line scroll, `Ctrl+d`/`Ctrl+u` half viewport, `gg` top within a
500 ms pair window, `G` bottom) with pending-`g` state, unit-tested without a
DOM. The App wires it to a window keydown listener active only in preview
mode, and it stands down whenever focus is in an input/textarea/
contenteditable or any modal overlay is open — typing "j" in the comment
composer types a j.

## Editor vim navigation mode (SPEC23 §2)

The same `vimNav` setting also arms a modal layer inside the CodeMirror
editor: `VimEditResolver` (in `vimnav.ts`, pure, beside the untouched
preview resolver) tracks typing/nav mode — Esc enters nav, `i`/`a` exit,
and in nav mode the keyset `h j k l`, `w b`, `0 $`, `gg`/`G`, `Ctrl+d/u`
resolves to cursor motions while every other editing key resolves to
`inert` (consumed, buffer byte-identical). The Editor mounts it as a
`Prec.highest` keydown handler ahead of all keymaps, gated on the setting,
skipping IME composition, and leaving ⌘/Alt (and non-d/u Ctrl) combos to
the accelerator layers. A NAV pill pinned to the editor pane reflects the
mode; a remount (mode toggle, document switch) always re-enters typing.

## Mirrored split selection (SPEC23 §1)

Selecting in the split preview selects the corresponding **source** in the
editor. The rendered text differs from the source, so `selectionMap.ts`
(pure) rebuilds each source line's visible form with a per-character map
back to source offsets (`stripInline`: block prefixes, emphasis/strong,
strikethrough, inline code, links, images, escapes), then locates the
selection's text — whitespace-normalized — inside the line range bounded
by the blocks' `data-mm-line` stamps (`mapSelectionToSource`). An exact,
unambiguous hit selects precise source offsets; anything else falls back
to the covering line range — never a wrong guess. The App listens to
`selectionchange` (debounced, split-edit only, non-collapsed selections
anchored in the preview pane) and dispatches into CM without focusing it;
`drawSelection()` renders the unfocused selection. One wrinkle: a focused
CM re-asserts its own DOM selection, so a `pointerdown` in the preview
releases the editor's focus before the drag-selection begins.

## Editor markdown highlighting (SPEC23 §3)

`@codemirror/lang-markdown` always parsed the buffer; SPEC23 attaches a
`HighlightStyle` that maps Lezer tags to `mm-md-*` CSS classes (headings
per level, emphasis, strong, code, links/URLs, quotes, strikethrough, HR,
and the punctuation marks dimmed as `mm-md-mark`). Colors and weights live
in `styles.css` on theme CSS variables, so every theme — built-in or
custom — drives the editor palette with no theme-format change. The
extension rides a compartment: the `editorSyntax` setting (default on)
reconfigures live with undo history intact. `@lezer/highlight` (the tag
vocabulary) was already vendored transitively and is now an explicit
dependency.

## Save As (SPEC3 §3)

`Platform.saveFileDialog(suggestedName)` — native save dialog on Tauri,
`showSaveFilePicker`/download fallback on web, a test hook in the shim. The
App writes the buffer (plus the embedded trailer in embedded mode) to the
chosen path, writes a sidecar next to the new file in sidecar mode, then
switches the session to the new document — comments always travel.

## Theming

A theme is one `.css` file setting the `--mm-*` custom-property contract on
`.theme-root` (documented in `THEMES.md`), with `@name/@author/@variant`
metadata in its first comment block. `parseTheme()` (`src/lib/themes.ts`,
pure) handles metadata with filename fallbacks and **rejects any theme
referencing remote `url(http…)`** — the app promises zero network traffic.

The **Claude** built-in (v3) is a direct port of the user's Typora Claude
theme (`abnerworks.Typora/themes/claude.css`), with its values pinned in
SPEC3 §7: `#faf9f5` paper, `#141413` ink, terracotta `#D97757` for
caret/selection/link-hover, a **serif body** ("Anthropic Serif Web Text"
first in the stack — used when locally installed — with Georgia fallback; no
fonts are bundled since themes may not reference remote resources), a 752px
column, Typora's tight headings (h1 1.375rem / h2 1.125rem / h3 1rem, bold,
compact margins), muted-red inline code on a faint warm wash, and bottom-only
hairline table borders. Everything beyond the variable contract lives as
extra CSS scoped under `.theme-root` in the same file.

Built-in themes are ordinary theme files bundled via Vite raw imports
(`src/bundled.ts`); user themes are read from `<configDir>/themes/`, which is
created on first run along with a copy of `THEMES.md` as `README.md`.
Switching themes swaps the text of one `<style>` element — no reload. The
structural stylesheet (`src/styles.css`) consumes only the variables (with
Crisp-value fallbacks), so partial themes degrade gracefully; the CodeMirror
editor inherits the same variables, so dark themes get a dark editor for free.

## Edit mode

A full-screen swap (never side-by-side): preview unmounts, CodeMirror 6
mounts, and vice versa. The CodeMirror chunk is `React.lazy`-loaded so it
costs nothing until first use (~500 KB stays out of the startup path).
`Cmd+S` saves; a dirty dot tracks unsaved changes; window close with unsaved
changes is intercepted (Tauri `onCloseRequested` / `beforeunload`) and routed
to an in-app Save / Don't save / Cancel modal. Hotkeys are user-remappable in
Settings (captured on a recorder field, conflict-checked, persisted to
`settings.json`), matched by a window-level capture-phase listener so e.g.
Cmd+S never falls through to the webview.

## File watching and external edits

The open document is watched (plugin-fs `watch`, 400 ms debounce; a
change-listener on the virtual fs in the browser shim). External changes
reload content and re-run the cascade — unless the buffer is dirty or edit
mode is active, in which case local work is never clobbered.

## Testing

- **Vitest** (`tests/unit/`): the pure cascade (U1 exact, U2 quote-after-
  insert, U3 prefix/suffix disambiguation among 3+ duplicates, U4 fuzzy after
  in-anchor typos, U5 orphaning), theme metadata/rejection (U6, U7), and
  sidecar round-trip + md-with-comments interop fixture (U8).
- **Playwright** (`tests/e2e/app.spec.ts`): drives the real UI through the
  browser shim (E1–E16): rendering, theme picking/persistence via Settings,
  drop-in user themes, the edit/preview swap, save, hotkey remapping, the
  overflow menu, the full-path tooltip, the full comment lifecycle including
  edit-survival and orphaning via simulated on-disk edits, and both comment
  storage modes with their autosave/dirty-buffer semantics. A shared fixture
  fails any test that produces a browser console error. (`tauri-driver` does
  not support macOS, which is why e2e runs against the shim; the Tauri host
  is covered by `cargo check` in validate plus the packaged-app smoke run
  below.)
- **Playwright web suite** (`tests/e2e/web.spec.ts`, W1–W4): runs against the
  built `dist-web/index.html` served statically, with `showOpenFilePicker`
  deleted to exercise the portable fallbacks — drag-drop open, file-input
  open, download save with the embedded trailer, round-trip reopen, and a
  zero-network-requests assertion proving self-containment at runtime.
- `npm run validate` = typecheck → unit → desktop e2e → web build → web e2e →
  `cargo check` → single-file check → `VALIDATION: ALL PASSED`.

## Measured performance (Apple Silicon, this machine)

| Metric (SPEC §4 budget) | Measured |
| --- | --- |
| Cold launch of packaged .app → first-run bootstrap complete (< 1 s) | **789 ms** |
| Boot + render welcome.md, production bundle in shim | **55 ms** |
| Open + render a 5,202-line markdown file (< 300 ms) | **209 ms** |
| Theme switch applied (< 50 ms) | **38–51 ms**¹ |
| Preview ⇄ edit toggle, warm (< 100 ms) | **6–8 ms** |
| First toggle into edit (one-time lazy CodeMirror load) | ~800 ms |
| Packaged Markimark.app size (< 25 MB) | see build output (≈ 10 MB) |

¹ Measured through Playwright round-trips (click → polled computed style), so
these numbers include harness overhead; the in-page style swap itself is a
single `<style>` text assignment. Cold launch is measured from process spawn
to the app's first-run config bootstrap (which happens during first render).

## Tradeoffs

- Anchors are coupled to the renderer's text output; changing the markdown
  pipeline could shift offsets. Accepted: the quote/fuzzy steps recover, the
  pipeline is pinned, and it buys sidecar interop with md-with-comments.
- The browser shim's virtual fs lives in `localStorage` (~5 MB). Fine for
  tests and dev; the real app has no such limit.
- `bundle.targets` builds `.app` + `.dmg` only; Windows targets are a config
  change documented in `WINDOWS.md`.

## Release engineering (SPEC10)

### `__APP_VERSION__` plumbing

`package.json` is the single source of truth for the app version at build
time. All three bundler configs — `vite.config.ts` (desktop),
`vite.web.config.ts` (single-file web), and `vitest.config.ts` (so the unit
suite sees the identical constant) — import `package.json` and `define`
**`__APP_VERSION__`** as `JSON.stringify(pkg.version)`; `src/vite-env.d.ts`
declares it for TypeScript. App code (the About dialog) reads the version
only through this constant — there is no runtime fetch or re-parse of
`package.json`, and the pre-release identifier (`0.2.0-alpha.1`) survives
verbatim into the UI.

The version is duplicated by necessity into `src-tauri/tauri.conf.json`
(bundle metadata) and `src-tauri/Cargo.toml` (crate version). The three files
move in lock-step only via `npm run release:prepare -- <version>`
(`scripts/release-prepare.mjs`: strict-semver validation, surgical
version-line rewrites, lockfile refresh, scoped diffstat, a
`chore: release v<version>` commit — `--no-commit` to inspect; rerunning
with the current version is a no-op), and `npm run validate` fails fast if
they ever drift. Tags mirror the files (`v` + version), never the reverse.

### Release pipeline topology

`.github/workflows/release.yml`:

```
tag push v* ────────┐            ┌─ build-macos  (macos-latest, universal .dmg) ─┐
                    ├─▶ test ────┼─ build-windows (windows-latest, NSIS x64) ────┼─▶ release
workflow_dispatch ──┘  (macos)   └─ build-web    (ubuntu, single .html) ─────────┘   (draft)
```

- **test** gates everything: `npm run validate` (the full local gate) plus a
  version check — tag suffix / dispatch input must equal all three version
  files, failure names the stale file.
- The three builds run in parallel; the web asset is renamed
  `marky-mark-web-<version>.html` so it is self-describing when downloaded.
- **release** guards the assets (exactly dmg + setup.exe + html, none over
  25 MB), writes `SHA256SUMS.txt`, and creates a **draft** release (dispatch
  dry-runs: draft **prerelease**) whose notes header documents the
  unsigned-build escape hatches. Publishing is always a human action
  (`gh release edit --draft=false`, see RELEASING.md). `contents: write` is
  granted to the release job only; a concurrency group cancels stale runs of
  the same ref.

Out of scope, with seams reserved: signing/notarization (secrets into the two
build jobs), Linux (one more matrix leg), auto-updater (needs signing first),
hosted web (a `release: published` follow-up workflow).

### License allowlist guard

`npm run licenses` (`scripts/licenses.mjs`) regenerates
`THIRD-PARTY-NOTICES.md` from the real dependency graphs: production npm
packages resolved from `package-lock.json` (dev deps excluded) and the full
Rust crate graph from `cargo metadata`. Output is deterministic — sorted by
name@version, no timestamps — so a rerun with unchanged deps is a zero-diff.
Every license expression must evaluate permissively against an explicit SPDX
allowlist (`OR`: any branch suffices; `AND`: every branch must pass; `WITH`
exceptions matched as a unit; license-file-only crates are flagged for a
human decision). A disallowed, unknown, or missing license fails the run
naming the offenders — copyleft can never slip into the bundle silently.
Unit test U16 exercises the checker's core against fake copyleft entries;
`license.md` records the MIT decision and the dependency audit behind the
allowlist.

## Security model & network isolation (SPEC11)

**The guarantee: Marky Mark never makes an outbound network request** — not
from app code, not from dependencies, and not from anything a document or
theme contains. Two independent enforcement layers, so a hole in one is
caught by the other:

1. **Content layer.** The render pipeline swaps every remote image
   (`http:`, `https:`, protocol-relative) for an inert placeholder naming
   the blocked origin *before* sanitization; the sanitize schema then only
   admits `data:`/`blob:`/`asset:` image protocols at all. Theme CSS is
   rejected if its effective (comment-stripped) text contains any remote
   reference form — `url(...)`, `@import` (both forms; local `@import` too),
   or a quoted protocol-relative URL.
2. **Platform layer (CSP).** The desktop webview runs under a strict CSP
   (`tauri.conf.json`) whose only permitted hosts are Tauri's own loopback
   pseudo-origins (`asset.localhost` for local files, `ipc.localhost` for
   the command bridge on Windows); `devCsp` stays open for Vite HMR in dev
   only. The single-file web build carries an equivalent
   `<meta http-equiv="Content-Security-Policy">` with `connect-src 'none'`.

**Managed links:** clicks on document anchors never navigate the webview.
Fragment links scroll locally; `http(s)` links are handed to the OS default
browser (desktop, via `opener:allow-open-url` scoped to http/https) or a
`noopener` tab (web); everything else is inert. Hover shows the destination.

**Accepted scope trade-off:** `fs:scope` and the asset protocol remain broad
(`**`) — Marky Mark is an open-anything file editor, so the webview can read
and write user files by design. The compensating controls are exactly the
layers above: documents can't execute script (rehype-sanitize), and even a
hypothetical renderer compromise has no network exfiltration channel.

**Proof, continuously:** `fixtures/adversarial.md` (remote/protocol-relative
images, remote link) is rendered under Playwright request interception in
E46 (desktop shim) and W5 (built web page), asserting zero non-localhost
requests and no app navigation; U17/U18 pin the theme guard and renderer;
`npm run validate` ends with a static scan proving the shipped bundles
contain no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`EventSource`
call sites; CI runs `npm audit` (production, high+) and `cargo audit` on
every release. Full findings history: `docs/security/assessment.md`.
