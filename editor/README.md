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
  resets instantly; `header` / `aside` slot host chrome around the doc.
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
  `onRendered` and the `header`/`aside` slots.
- **No theme collection** — one variable contract, no bundled theme picker;
  hosts inject whatever `--mm-*` values they like.
- **No imports from any host** — app-flavored needs become new seams, never
  reverse imports.
