# PRD 021: Embeddable editor package

**Status:** Draft
**Date:** 2026-09-03

Issue: #224.

## Problem

The markdown editor is Marky Mark's crown jewel, and nothing else can use
it. `src/components/Editor.tsx` is already nearly pure — it imports zero
app modules; every app dependency arrives as a prop or seam callback —
but that discipline is convention, not contract: its props interface is
unexported, the preview half of the experience exists only as inline JSX
in `App.tsx` (a `renderMarkdown()` injection plus app-side glue), the
editor's styling lives inside the app's 4,400-line `styles.css`, and two
imports quietly couple the editor subtree to the app (`headingLinks →
shareLinks → hostedPaths`, and `imageView → markdown.ts`, which drags the
whole unified pipeline in for two URL helpers).

The owner wants the editor to be a component other apps — specifically
web apps — can take a dependency on: same repo, but with contracts and
interfaces clean enough that the separation is real, self-documenting,
and safe from being eroded by future coding agents.

## Goals

- One workspace package, **`/editor`** at the repo root
  (`@marky-mark/editor`), that is the markdown editor + preview + split
  view as an embeddable React component — its own project in every way
  (README, tests, samples, build) while living in this repo.
- A published contract: exported prop types, seam callbacks for
  everything app-flavored, a decoration hook for overlays like comments,
  and a documented CSS-variable theming interface.
- A hello-world any web developer can open: one HTML file, no install,
  no build step.
- Decoupling that cannot silently regress — enforced by the validation
  gate and spelled out in agent directives, not left to convention.
- Marky Mark itself consumes the package with zero behavior change.

## Non-goals

- **Publishing to npm.** The package stays private/unpublished; external
  consumers use a git/GitHub reference. Publishing (and the semver
  ceremony it brings) is a later decision.
- **A separate repository.** Deliberately same-repo: the app is the only
  consumer today, the Sandcastle machinery lives here, and atomic
  editor+app changes matter more than a repo wall. Because the boundary
  is gate-enforced, promotion later is a mechanical `git subtree split`.
- **Comments, TOC, tabs, file I/O, workspace anything.** The package is
  the document editing/preview experience only. Comments remain app-side,
  layered through the decoration hook (Req 8); the app keeps its own
  anchoring/sidecar logic unchanged.
- **Framework-agnostic packaging.** It is a React component; React and
  ReactDOM are peer dependencies of the library build. (The standalone
  bundle of Req 14 exists precisely so the hello page needs none of
  that.)
- **Porting the app's 27 themes into the package.** The package ships
  one minimal default theme and the `--mm-*` contract; Marky Mark's
  theme collection stays where it is.
- **New editor features.** This is a refactor: behavior-preserving by
  requirement (Req 17).

## Requirements

### The package

1. **Workspace conversion.** The root `package.json` gains npm
   `workspaces` including `editor/`; the app consumes
   `@marky-mark/editor` as a workspace dependency. `npm install` at the
   root wires everything; no separate install steps.
2. **`/editor` is self-contained.** It has its own `package.json` (name
   `@marky-mark/editor`, private), its own build producing a library
   (ESM, `react`/`react-dom` as peer dependencies, CodeMirror as regular
   dependencies) and its own vitest setup running the package's unit
   tests in isolation (`npm test` inside `editor/`).
3. **The component boundary is editor + preview + split.** The package
   exports: the editing surface (today's `Editor.tsx` and its companion
   modules — livePreview, tableMode, imageView, codeBlockView,
   diagramView, SmartEditMenu — and their pure libs), a **new Preview
   component** authored from the `.split-preview` subtree currently
   inline in `App.tsx` (markdown rendering via the existing pipeline,
   `data-mm-line` scroll anchors, code-copy affordances, mermaid and
   image behaviors), and a **SplitView** composing the two with the
   existing divider and sync-scroll behavior (`scrollSync.ts`,
   PRD 001's visual seam preserved).
4. **The contract is exported.** Every prop interface and seam type is
   exported and documented — including today's unexported `Props`, the
   imperative handles (`EditorSyncHandle`, `SmartEditHandle`,
   `EditorSearchHandle`, …), and the seam callbacks (`HeadingLinkSeam`,
   clipboard, `resolveImageSrc`, `onOpenExternal`, `onPasteImages`).
   Consumers can express everything Marky Mark does through public API.

### Severed couplings and hooks

5. **No hosted URLs in the package.** The `headingLinks → shareLinks →
   hostedPaths` edge is cut: heading-link URL construction arrives
   through the `HeadingLinkSeam` callback; the app supplies the PRD 020
   URL shapes from outside.
6. **No app markdown module in the editor bundle.** `imageView`'s
   `isRemoteSrc`/`remoteHost` helpers move into the package (or a shared
   pure module inside it); the unified/remark pipeline is imported only
   by the Preview component, never by the editing surface.
7. **Styles move in.** The editor/preview/split CSS (~the `.cm-*`,
   `.editor-wrap`, `.mm-md-*`, `.doc*`, split-divider, smart-edit,
   table-grid, code-card, image-chip blocks of `src/styles.css`) is
   extracted into package-owned stylesheets the library exports; the
   app imports them from the package. No visual change (Req 17).
8. **Decoration hook.** The Preview exposes a documented post-render
   hook (DOM-decoration seam) sufficient for Marky Mark's comment
   marks (`domtext.ts`'s `<mark class="hl">` wrapping) and click
   routing to keep working from the app side, and for other consumers
   to layer their own overlays.
9. **Theming is a CSS-variable contract.** The package documents the
   `--mm-*` variables it consumes (fonts, `--mm-syn-*`, `--mm-code-*`,
   selection, content width) and ships a minimal default theme
   stylesheet so a bare embed looks presentable; Marky Mark keeps
   injecting its own themes exactly as today (`themeRuntime.ts`).

### Enforcement and directives

10. **The gate enforces the boundary.** `scripts/validate.mjs` (quick
    tier) fails if any module under `editor/` imports from `src/`,
    `server/`, or `src-tauri/` — by static import scan. The app may
    import the package only through its exported entry points (no
    deep-path imports).
11. **`editor/AGENTS.md` carries the directives.** A short agent-facing
    file inside the package states: what the package is, what it may
    never import, that new app-flavored needs become seams/props (never
    reverse imports), that its styles/tests/docs live in-package, and
    that the gate of Req 10 enforces all of this. Root `AGENTS.md` adds
    a one-line pointer to it (within the documented size budget).
12. **Citations survive.** Moved files keep their `SPEC<n>`/PRD
    citation comments; `docs/MAP.md` is regenerated (`npm run map`) and
    the validation gate stays green on the new paths.

### Its own project: README and sample

13. **`editor/README.md`.** Written for an outside web developer:
    what the component is, a quickstart (the hello sample), the full
    props/seams/handles API, the theming contract of Req 9, the
    decoration hook, how to run tests and build, and the boundary
    statement (what this package deliberately does not do).
14. **Standalone bundle.** The package build additionally emits one
    self-contained browser bundle (React included, no externals) with a
    tiny imperative mount API, for script-tag/ESM-file consumption.
15. **`editor/samples/hello-editor/`.** One `index.html` (plus at most
    a few lines of inline script) that mounts the editor+preview from
    the standalone bundle with starter markdown — no npm install, no
    build step, no network: build the package once, open the file, it
    works. The README's quickstart is this sample.
16. **The sample is provably independent.** An automated check (unit or
    e2e tier) loads hello-editor against the built bundle and asserts
    the editor mounts and accepts input — with no Marky Mark app code
    involved.

### Behavior preservation

17. **Marky Mark is unchanged.** After the app consumes the package:
    all existing e2e suites (editor, split-view, tables, live-preview,
    smart-edit, images, mermaid, search, toc) pass unmodified except
    for mechanical import-path updates; no visual or behavioral
    differences in the editor, preview, or split view; the single-file
    web build and Tauri build still produce working artifacts
    (`npm run validate`).

## Open questions

None — everything deferred is recorded under Non-goals.
