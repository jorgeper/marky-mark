/**
 * PRD 021 Req 14 (issue #240): the standalone-bundle entry — a tiny
 * imperative mount API (`mountEditor(element, options)`) over the package's
 * public components, built by `npm run build:standalone -w editor` into a
 * self-contained classic-script (IIFE) bundle with React and every runtime
 * dependency included. A plain HTML page loads the bundle with one
 * `<script src=…>` tag (works from `file://` — see
 * samples/hello-editor/index.html) and calls
 * `MarkyMarkEditor.mountEditor(el, { markdown })`; no npm, no build step,
 * no network. This entry is bundle-only: the ESM library build
 * (vite.config.ts) neither includes nor exports it.
 */
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
// The standalone surface goes through the same public contract React
// consumers get — nothing bundle-only reaches into deep modules.
import { DEFAULT_HOTKEYS, Editor, SplitView, registerMermaidRenderer, type EditorSyncHandle } from './index';
// The package stylesheet + the default theme, emitted as one CSS asset
// beside the bundle (the sample links it; PRD 021 Req 9's --mm-* contract
// still applies — a host page can override any variable).
import '../styles.css';
import '../default-theme.css';

// PRD 013 Req 1 shape, standalone flavor: with no host to do it, the bundle
// itself puts mermaid on the fence-renderer registry (the dynamic
// `import('mermaid')` is inlined here — self-contained means diagrams too).
registerMermaidRenderer();

/** Options for `mountEditor`. */
export interface MountOptions {
  /** Initial markdown for the editor (default: empty document). */
  markdown?: string;
  /** Theme side passed to editor + preview renderers (default 'light'). */
  themeVariant?: 'light' | 'dark';
  /** Called with the full markdown after every edit. */
  onChange?(markdown: string): void;
}

/** What `mountEditor` returns — the handle the host page keeps. */
export interface MountHandle {
  /** The markdown as currently edited. */
  getMarkdown(): string;
  /** Tear the editor down and release the element. */
  unmount(): void;
}

/**
 * The whole embed as one component: Editor + Preview in a SplitView, with
 * the split-layout flex container SplitView expects its host to provide and
 * presentable defaults for every required Editor prop (no seams wired — the
 * standalone surface is deliberately host-less).
 */
function StandaloneEditor({
  initial,
  themeVariant,
  onChange,
}: {
  initial: string;
  themeVariant: 'light' | 'dark';
  onChange(markdown: string): void;
}) {
  const [value, setValue] = useState(initial);
  const historyRef = useRef<unknown>(null);
  const syncRef = useRef<EditorSyncHandle | null>(null);
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--mm-bg, #ffffff)' }}>
      <SplitView
        split
        editorSyncRef={syncRef}
        editor={
          <Editor
            value={value}
            onChange={(next) => {
              setValue(next);
              onChange(next);
            }}
            historyRef={historyRef}
            syncRef={syncRef}
            lineNumbers
            syntax
            codeSyntax
            livePreview={false}
            vimNav={false}
            hotkeys={DEFAULT_HOTKEYS}
            isMac={typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)}
            canPaste={false}
            tableGridView
            inlineImages
            codeBlockView
            diagramView
            themeVariant={themeVariant}
          />
        }
        preview={{ markdown: value, themeVariant, codeSyntax: true }}
      />
    </div>
  );
}

/**
 * PRD 021 Req 14 (issue #240): mount the editor + preview into `element`.
 * The one function a standalone page needs.
 */
export function mountEditor(element: HTMLElement, options: MountOptions = {}): MountHandle {
  let current = options.markdown ?? '';
  const root = createRoot(element);
  root.render(
    <StandaloneEditor
      initial={current}
      themeVariant={options.themeVariant ?? 'light'}
      onChange={(md) => {
        current = md;
        options.onChange?.(md);
      }}
    />
  );
  return {
    getMarkdown: () => current,
    unmount: () => root.unmount(),
  };
}
