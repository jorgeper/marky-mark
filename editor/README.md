# @marky-mark/editor

An embeddable markdown editing experience for the web: a CodeMirror-based
**Editor** with live inline preview (tables as grids, inline images, code
cards, diagrams, Smart Edit formatting), a rendered-markdown **Preview**
(GitHub-flavored markdown through the unified pipeline, sanitized, with
syntax-highlighted code and mermaid diagrams), and a **SplitView** that
composes the two with a draggable divider and synchronized scrolling.

It is the editing surface of [Marky Mark](../README.md), packaged so any web
app can embed it — Marky Mark is one consumer of this package, not its owner.

## Quickstart: hello-editor

The fastest way to see it working is the bundled sample —
[`samples/hello-editor/index.html`](samples/hello-editor/index.html). From
the repository root:

```sh
npm install                          # once, for the repo
npm run build:standalone -w editor   # emits editor/dist/standalone/
```

Then **open `editor/samples/hello-editor/index.html` in a browser** — double
click it, no server needed. The sample is the entire integration:

```html
<link rel="stylesheet" href="../../dist/standalone/marky-mark-editor.css" />
<div id="editor"></div>
<script src="../../dist/standalone/marky-mark-editor.js"></script>
<script>
  MarkyMarkEditor.mountEditor(document.getElementById('editor'), {
    markdown: '# Hello, editor\n',
  });
</script>
```

The standalone bundle is a classic script (IIFE) with React and every
runtime dependency compiled in — no npm install for the consuming page, no
build step, no network, and it loads from `file://` (where Chromium blocks
cross-file ES-module loads; a classic script is what makes "open the file"
work). It exposes one global, `MarkyMarkEditor`:

```ts
mountEditor(element: HTMLElement, options?: MountOptions): MountHandle

interface MountOptions {
  markdown?: string;                  // initial document
  themeVariant?: 'light' | 'dark';    // default 'light'
  onChange?(markdown: string): void;  // fires after every edit
}
interface MountHandle {
  getMarkdown(): string;              // the document as currently edited
  unmount(): void;                    // tear down, release the element
}
```

Give the mount element a size (e.g. `display: flex; height: 100%`) — the
editor fills whatever box it is given.

## Using it from React

The package's library build is the opposite of the standalone bundle: an ESM
library with `react`/`react-dom` as peer dependencies and every runtime
dependency external (`npm run build -w editor`, config in
[`vite.config.ts`](vite.config.ts)). Inside this repository it is consumed
as the workspace package `@marky-mark/editor`; everything a consumer may
touch is exported from the single entry point
[`src/index.ts`](src/index.ts) — deep paths into `src/` are not API.

```tsx
import { Editor, Preview, SplitView, DEFAULT_HOTKEYS } from '@marky-mark/editor';
import '@marky-mark/editor/styles.css';         // structural styles (required)
import '@marky-mark/editor/default-theme.css';  // presentable defaults (optional — see Theming)
```

### Components

- **`Editor` / `EditorProps`** — the editing surface. Core props:
  `value`, `onChange(next)`, and `historyRef` (parks serialized undo history
  across unmounts, so mode toggles never lose undo). Feature switches:
  `lineNumbers`, `syntax` (markdown highlighting), `codeSyntax` (fenced-code
  highlighting), `livePreview`, `tableGridView`, `inlineImages`,
  `codeBlockView`, `diagramView`, `vimNav`, `readOnly`. Environment:
  `hotkeys` (a `HotkeyMap` — start from `DEFAULT_HOTKEYS`), `isMac`,
  `canPaste`, `themeVariant`. Every prop is documented inline on the
  `EditorProps` interface in
  [`src/components/Editor.tsx`](src/components/Editor.tsx).
- **`Preview` / `PreviewProps`** — the rendered document. Give it
  `markdown`; it renders (debounced, `renderDebounceMs`) into a
  `.split-preview > .docwrap > .doc` tree with `data-mm-line` anchors on
  block elements. `docKey` identifies the document so swapping documents
  resets instantly; the `header` slot hosts chrome above the doc (the `aside`
  slot was retired with the in-preview comment panel, PRD 023 §16).
- **`SplitView` / `SplitViewProps`** — editor + divider + preview with
  synchronized scrolling. Pass the editor element as the `editor` node, the
  preview's props as `preview`, and the same ref you gave the Editor's
  `syncRef` as `editorSyncRef`. Render it inside a `display: flex` container
  you own; `split={false}` keeps the editor mounted and drops the other pane.

### Imperative handles

Populated via refs, for hosts that drive the surface:

- **`EditorSyncHandle`** (`syncRef`) — scroll geometry: `topLine()`,
  `scrollToLine(line)`, `goToLine(line)` (scroll **and** place the caret),
  `scrollInfo()`, `headTop()`, `setScrollTop(top)`, plus a user-scroll
  subscription. SplitView consumes this for sync scrolling.
- **`SmartEditHandle`** (`smartRef`) — formatting: `applyFormat(op)` with a
  `SmartFormatOp` (`'bold' | 'italic' | … | 'hr'`), `openSmartMenu()`, and
  `canonicalText(text)` (the buffer with table-grid display whitespace
  mapped out — route any text that escapes the editor through this).
- **`EditorSearchHandle`** (`searchRef`) — find/replace:
  `setQuery(compiledPattern, replace)`, `next()`, `prev()`, `replaceOne()`,
  `replaceAllMatches()`, `clear()`. Queries arrive as compiled patterns from
  the exported `searchCore` module, so editor and preview search identically.

### Seams

App-flavored behavior never lives in the package — it arrives through
documented props ("seams"), all typed on `EditorProps` / `PreviewProps`:
`onPasteImages` (paste-an-image → markdown to insert), `resolveImageSrc`
(source `src` → displayable URL), `onOpenExternal`, `onCopyText` /
`onReadClipboard` / `onCopyCode` (clipboard), `HeadingLinkSeam`
(`getUrl(line)` + `copy(text)` behind the heading link buttons),
`onEditState` (cursor/selection reports), and the decoration hook below.
Diagrams are a seam too: call the exported `registerMermaidRenderer()` once
per session (the standalone bundle does this itself), or register your own
renderer for any fence tag with `registerFenceRenderer(tag, renderer)`.

### The decoration hook

`PreviewProps.onRendered(root)` is called synchronously (before paint) with
the rendered `.doc` root after every injection pass. Wrap text ranges, graft
buttons, or paint overlays there — Marky Mark layers its comment
highlighting through exactly this hook. A change of callback identity
re-injects the HTML first, so decorations always start from a clean
pipeline-produced tree.

### Fluid mode

`EditorProps.fluid` (PRD 025) turns on an opt-in mode in which editor
operations are animated. It takes a `FluidEffectMap` — one entry per
action, naming an effect or `'none'` — and `null`/absent means the mode is
**off**: the editor then loads no effect extension, renders no overlay
element, registers no listener, and the editor root carries no `data-fluid`
attribute. With a mapping, the root carries
`data-fluid="cursor=…;selection=…;deletion=…;insertion=…"` and an inert,
`pointer-events: none`, `aria-hidden` overlay layer (`fluid-overlay`) is
mounted inside the scroller for effects to draw into.

The four actions and their defaults (`DEFAULT_FLUID_EFFECTS`):

| Action (`FluidAction`) | Default   |
|------------------------|-----------|
| `cursor` (movement)    | `glide`   |
| `selection` (change)   | `elastic` |
| `deletion`             | `fade`    |
| `insertion`            | `pop`     |

The five-effect catalogue (`FluidEffect`) and where each applies
(`FLUID_APPLICABILITY`, or `fluidEffectsFor(action)` read by column):

| Effect    | Meaning                                              | Applies to            |
|-----------|------------------------------------------------------|-----------------------|
| `fade`    | opacity in (insert) / out (delete)                   | deletion, insertion   |
| `glide`   | eased position tween, no overshoot                   | cursor, selection     |
| `elastic` | spring toward the target with a small overshoot      | cursor, selection     |
| `pop`     | scale in from ~0.8 (insert) / out to ~0.8 (delete)   | deletion, insertion   |
| `burst`   | small particles scattering from the removed span     | deletion              |

Durations are per-effect constants (`FLUID_DURATIONS_MS`), not options.
A single change touching more than `FLUID_LARGE_OPERATION_CHARS` (2000)
characters or more than `FLUID_LARGE_OPERATION_LINES` (50) lines gets no
deletion or insertion effect, and a selection change spanning more than that
snaps; `isFluidLargeOperation(chars, lines)` is that rule as a pure
predicate (strictly greater than either threshold).

**Never-delay guarantee.** The document, the real selection and the caret
position CodeMirror reports change synchronously, exactly as with the mode
off. An effect is an overlay drawn *afterwards*; no effect defers, debounces
or batches an edit or a selection update, and overlays never touch layout.
The mode is inert under `prefers-reduced-motion: reduce`.

**Cursor movement.** Only *navigation* moves animate — arrow and Home/End
keys, mouse clicks, find-hit and heading-palette jumps, vim nav, undo/redo
landing the caret, and a host `selectRange`. A caret move caused by typing
or deleting never does: the caret keeps pace with the keys. The effect is a
ghost caret drawn in the overlay that tweens from the old position to the
new one — **Glide** eases there with no overshoot (160 ms), **Elastic**
springs past the target by a few percent and settles (320 ms) — while the
real caret is already at its destination. A scroll, resize, edit or theme
change mid-flight removes the ghost at once. `isFluidNavigationMove`,
`glideAt` and `elasticAt` are the pure decision and curves behind it. Under
`prefers-reduced-motion: reduce` (read on every move, never cached) no ghost
is created at all: the mode stays selectable and inert.

**Selection change.** Any change that leaves a *range* animates — Shift+arrow
and Shift+Home/End, select-all, shift-click, a host `selectRange`, a
find-hit, vim visual moves, undo/redo landing a range, and each step of a
mouse drag: a further change while the ghost is in flight re-targets it from
its current geometry, so the band chases the pointer instead of restarting.
The ghost is up to three translucent rectangles (first line's tail, middle
block, last line's head) in the overlay, tinted with the theme's selection
colour, tweening from the previous painted shape to the new one — **Glide**
eases into place (160 ms), **Elastic** stretches the band a little past its
new end and settles (320 ms) — while the real selection is already at its
destination. A change that leaves a caret is the cursor effect's territory,
and typing, pasting or deleting over a selection never animates it. A change
whose previous or new range spans more than `FLUID_LARGE_OPERATION_CHARS`
characters or `FLUID_LARGE_OPERATION_LINES` lines snaps: no ghost, and any
in flight is removed. `fluidSelectionDecision` and `fluidSelectionRects` are
the pure decision and geometry behind it.

**Deletion.** Any change that purely *removes* text animates, whatever caused
it — Backspace and Delete, deleting a selection, cut, delete-line, undo/redo
that removes text, a drop's removal, a host `applyEdit` or vim `x`/`dd`. A
*replacement* — typing or pasting over a selection, a completion, an IME
composition, a smart-edit rewrite — never does: that change removes and
inserts at once and belongs to the insertion effect. The ghost is a
re-rendered copy of the removed text (its base font and the theme's
foreground, without Markdown styling) drawn in the overlay at the text's last
painted position, after the document has already changed. **Fade** dissolves
it (180 ms); **Pop** scales it out to ~0.8 about the removed span's start
while dissolving (160 ms); **Burst** dissolves it as Fade does and scatters
`FLUID_BURST_PARTICLES` small accent particles outward from its first line,
each living no longer than 380 ms. A change removing more than
`FLUID_LARGE_OPERATION_CHARS` characters or `FLUID_LARGE_OPERATION_LINES`
lines draws nothing. A scroll, resize, further edit or theme change removes a
ghost at once; a caret move or selection change leaves it to finish.
`fluidDeletionSpans`, `fluidDeletionBox` and `fluidBurstParticles` are the
pure decision, box and particle geometry behind it.

**Insertion.** Any change that *inserts* text animates, whatever caused it —
typing, paste, drop, Enter and auto-indent, undo/redo that reinserts text, a
host `applyEdit` or vim `p` — and a replacement's new text counts: typing or
pasting over a selection, a completion, a smart-edit or table-edit rewrite
are insertions of what they put in place. A pure removal never animates
here, nor does an IME composition step (its text is still being decided and
stays readable). Because the real, Markdown-styled text is already painted
and the content DOM is never restyled, the effect is a page-coloured mask
drawn in the overlay over the inserted range's painted rectangles: **Fade**
dissolves the mask (180 ms) so the real text appears to fade in; **Pop**
holds the mask while a re-rendered copy of the inserted text (base font,
theme foreground, no Markdown styling) scales in from ~0.8 about the span's
start (160 ms), then the copy and mask vanish together. With all four
actions now live, the caret still keeps pace with typing: the insertion is
never deferred and a caret move caused by typing is not animated. A change
inserting or removing more than `FLUID_LARGE_OPERATION_CHARS` characters or
`FLUID_LARGE_OPERATION_LINES` lines (counting what the change inserted or
removed, so select-all + type on a long document) draws nothing. A scroll,
resize, further edit or theme change removes the mask at once; a caret move
or selection change leaves it to finish. `fluidInsertionSpans` is the pure
decision behind it; the mask and copy reuse `fluidSelectionRects` and
`fluidDeletionBox`.

```tsx
<Editor value={text} onChange={setText} lineNumbers
        fluid={{ cursor: 'glide', selection: 'elastic', deletion: 'fade', insertion: 'pop' }} />
```

## Theming

Every color, font and size in the package stylesheet rides CSS variables
prefixed `--mm-*` (`--mm-bg`, `--mm-fg`, `--mm-accent`, `--mm-font-size`,
`--mm-syn-*`, …). Define them on any ancestor of the editor to theme it;
[`default-theme.css`](default-theme.css) supplies presentable defaults for
every variable in the contract, and the full variable catalog is documented
in [`THEMING.md`](THEMING.md). The standalone bundle compiles both sheets
into `marky-mark-editor.css`; page-level `--mm-*` definitions still win.

## Tests and builds

```sh
npm test -w editor                   # unit suite (vitest + happy-dom, editor/tests/)
npm run typecheck -w editor          # tsc --noEmit
npm run build -w editor              # ESM library → editor/dist/ (externals only)
npm run build:standalone -w editor   # self-contained IIFE → editor/dist/standalone/
```

The sample + standalone bundle are covered end-to-end by test E415
(`tests/e2e/hello-editor.spec.ts` at the repo root), which builds the bundle
and drives the sample over `file://`.

## What this package deliberately does not do

The package is self-contained and host-agnostic (the rules live in
[`AGENTS.md`](AGENTS.md), and the repo's validation gate enforces them):

- **No file access** — it edits a string; opening, saving and watching files
  are the host's job (`value`/`onChange`, `onPasteImages`, `resolveImageSrc`).
- **No app settings** — every behavior is a prop; persistence is the host's.
- **No comment overlays or app chrome** — hosts draw overlays through
  `onRendered` and the `header` slot.
- **No theme collection** — one variable contract, no bundled theme picker;
  hosts inject whatever `--mm-*` values they like.
- **No imports from any host** — app-flavored needs become new seams, never
  reverse imports.
