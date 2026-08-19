# PRD 013: Mermaid Support

**Status:** Draft
**Date:** 2026-08-19

## Problem

Markdown documents full of architecture notes, flows, and sequence sketches
carry ```mermaid fences that every other viewer (GitHub, Obsidian, VS Code)
draws as diagrams — Marky Mark shows them as highlighted code. Readers get
the source of a picture instead of the picture. The owner wants the simplest
thing that fixes this now, without committing to a plugin ecosystem, but
also without wiring mermaid in so directly that the next fence language
(katex, graphviz) means re-plumbing the render path.

## Goals

- ```mermaid fences render as diagrams: automatically in the preview pane,
  and as in-place widgets in the edit pane under the same toggle mechanism
  tables and images already use.
- Mermaid arrives through a minimal internal renderer seam, so a future
  fence language is a registration, not a rearchitecture.
- Documents without diagrams pay nothing: desktop startup and render cost
  are unchanged unless a mermaid fence is actually on screen.
- Diagrams look native: they follow the app's light/dark theme, and a broken
  diagram degrades to the code block, never to a hole in the document.

## Non-goals

- **No user-facing plugin system.** No plugin loading, distribution,
  sandboxing, or settings UI. The renderer seam is internal to the codebase.
- **No other fence languages in this PRD.** Katex, graphviz, etc. are future
  registrations against the seam, each its own effort.
- **No diagram editing UI.** The fence text is the only way to author a
  diagram; no visual editor, no drag handles, no node inspector.
- **No export integration.** Exported/printed documents keep mermaid fences
  as code blocks; changing export is out of scope.
- **No remote anything.** Mermaid renders fully locally; no CDN loading, no
  external images/links/scripts in or out of diagrams (consistent with the
  app's local-only image policy, SPEC11).
- **No mermaid version/config surface.** The bundled mermaid version and its
  configuration are fixed by the app; no per-document or per-user mermaid
  config in v1.

## Requirements

Numbered, testable statements. Each becomes acceptance criteria on an issue.

1. A fence-renderer seam exists as a pure `src/lib/` module: a registry
   mapping a fence language tag to a renderer, consulted by the preview
   pipeline and the edit-pane widget layer. Mermaid is its only v1
   registration; registering a second language requires no change to the
   consuming pipeline code. Fence languages with no registration render
   exactly as today (rehype-highlight code blocks).
2. In the preview pane, a ```mermaid fence renders as its diagram
   automatically — no per-block affordance, matching how tables and images
   already render there.
3. Diagram rendering must not perturb the comment-anchor coordinate space:
   anchor offsets into the rendered plain text (the pipeline contract in
   `src/lib/markdown.ts`) compute identically whether a mermaid fence is
   drawn as a diagram or as code. Existing sidecar comments in documents
   containing mermaid fences keep resolving to the same targets.
4. The diagram's SVG never passes through a widened sanitize schema: the
   sanitize step's schema is unchanged, and mermaid output is injected as a
   post-sanitize enhancement equivalent in trust posture to the existing
   image widgets. Mermaid runs at its strictest security level: no script
   execution, no external resource loads, no clickable external links from
   diagram nodes.
5. In the edit pane, mermaid fences render as in-place diagram widgets under
   a new persisted user setting (the `tableGridView`/`inlineImages`
   pattern), default **on**. The fence source re-appears for editing the way
   the table grid and image widgets already yield to the caret.
6. The edit-pane diagram view is toggleable from the same menu surface as
   the Table ▸ and Image ▸ toggles (a Diagram ▸ entry) and from a Settings
   checkbox, both flipping the same setting (the SPEC40 §1.2 / SPEC41 §1.2
   shape).
7. On desktop, mermaid is a lazily loaded separate chunk: it is fetched and
   evaluated only when a mermaid fence first needs rendering. A session that
   never meets a mermaid fence never loads it, and app startup time is
   unaffected. The main-bundle size does not grow by mermaid's weight.
8. The single-file web build inlines mermaid so the feature has full parity
   on web; the build still passes the validate gate's single-file check
   (dist-web = exactly one self-contained index.html).
9. Diagrams follow the app's active theme: light themes get a light diagram
   theme, dark themes a dark one, switching live when the app theme changes.
   Diagrams never overflow the pane horizontally — wide diagrams scale or
   scroll within their block.
10. A fence that fails to parse or render shows the highlighted code block
    (exactly today's rendering) plus a visible, unobtrusive error indicator
    with mermaid's message. A render failure never blanks the block, throws
    to the app shell, or breaks the rest of the document.
11. While a fence's diagram is being rendered (including the first-use lazy
    load of mermaid on desktop), the block shows the code (or a placeholder
    of equivalent height) rather than collapsing — no layout jump when the
    diagram arrives.
12. Rendering is deterministic and offline: the same fence text renders the
    same diagram with no network access, on desktop and web alike. Unit
    tests cover the seam's pure logic (registry lookup, fence detection,
    error fallback shape); an e2e test covers a document with a valid and an
    invalid mermaid fence in both preview and edit panes.

## Open questions

- None.
