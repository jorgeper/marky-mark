/**
 * @marky-mark/editor — the embeddable markdown editing experience (PRD 021):
 * the Editor (CodeMirror editing surface with live preview, table grids,
 * inline images, code cards, diagrams and Smart Edit), the Preview (rendered
 * markdown through the unified pipeline, with `data-mm-line` anchors and a
 * host decoration hook), and the SplitView composing the two with divider and
 * synchronized scrolling.
 *
 * PRD 021 Req 4: this entry point is the package's public contract — every
 * component, prop interface, imperative handle and seam type a consumer
 * needs is exported here, and hosts import ONLY from here (deep paths into
 * src/ are not API). Everything app-flavored (filesystems, clipboards, URLs,
 * themes, overlays such as comments) arrives through the documented seams;
 * the package never imports from a host.
 */

// --- The components -----------------------------------------------------------
/** The editing surface. Its prop contract is `EditorProps`. */
export { default as Editor } from './components/Editor';
/** PRD 021 Req 3: the rendered-markdown reading surface. */
export { Preview } from './components/Preview';
export type { PreviewProps } from './components/Preview';
/** PRD 021 Req 3: editor + divider + preview with synchronized scrolling. */
export { SplitView } from './components/SplitView';
export type { SplitViewProps } from './components/SplitView';

// --- The Editor contract (PRD 021 Req 4) --------------------------------------
// EditorProps (every prop, documented inline), the imperative handles
// (EditorSyncHandle for scroll sync, SmartEditHandle for formatting and the
// canonical-text view, EditorSearchHandle for find/replace), and the seam
// types (HeadingLinkSeam, SmartFormatOp) — all declared with doc comments in
// components/Editor.tsx.
export * from './components/Editor';

// --- The editing surface's companion modules ----------------------------------
export * from './components/SmartEditMenu';
export * from './components/anchoredMenu';
export * from './components/codeBlockView';
export * from './components/diagramView';
export * from './components/imageView';
export * from './components/livePreview';
export * from './components/tableMode';

// --- The pure libraries the surfaces are built on -----------------------------
// Exported wholesale: hosts (Marky Mark's app first) reuse these directly —
// e.g. renderMarkdown, the search core, hotkey combos, scroll-sync mapping.
export * from './lib/activePosition';
export * from './lib/codeBlockSpans';
export * from './lib/codeCopy';
export * from './lib/codeSelection';
export * from './lib/copyLink';
export * from './lib/diagramSpans';
export * from './lib/diffLines';
export * from './lib/fenceDiagrams';
export * from './lib/fenceRenderers';
export * from './lib/fenceWidth';
export * from './lib/headingLinks';
export * from './lib/hotkeys';
export * from './lib/imageResize';
export * from './lib/livePreview';
export * from './lib/markdown';
export * from './lib/mermaidRenderer';
export * from './lib/remoteSrc';
export * from './lib/scrollSync';
export * from './lib/searchCore';
export * from './lib/selectionMap';
export * from './lib/smartEdit';
export * from './lib/tableEdit';
export * from './lib/vimnav';
