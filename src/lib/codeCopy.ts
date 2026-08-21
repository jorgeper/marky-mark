/**
 * Issue #122: the preview's per-code-block copy control.
 *
 * The button is deliberately NOT part of the markdown pipeline
 * (`lib/markdown.ts`): that pipeline's rendered text is the coordinate space
 * comment anchors are offsets into, and the same HTML is what Export
 * (`lib/exportDoc.ts`) and print reuse. Chrome belongs in none of those, so it
 * is grafted onto the live preview DOM after injection instead.
 *
 * Two properties make the graft invisible to anchoring: the wrapper and the
 * button contribute no text nodes at all (the button's "Copy"/"Copied" label
 * is a `::after` pseudo-element in styles.css), so `getDocText()` over the
 * preview root returns byte-identical text with the buttons present.
 *
 * Issue #163 gave the edit pane's fenced-code cards the same control
 * (`components/codeBlockView.ts` mounts one in a CodeMirror widget), so the
 * button itself is built by `createCopyButton` here and the two panes differ
 * only in where they hang it and how they read the block's text.
 */

/** Wrapper added around each `<pre>` — the positioning context for the button. */
export const CODE_BLOCK_CLASS = 'mm-codeblock';
/** The copy button itself; also its `data-testid`. */
export const COPY_BUTTON_CLASS = 'mm-copy-code';
/** Confirmation class, carried for CONFIRM_MS after a successful copy. */
export const COPIED_CLASS = 'is-copied';
/** How long the button says "Copied" before reverting. */
export const CONFIRM_MS = 1200;
/** The button's accessible name — its only one, at rest and while confirming. */
const REST_LABEL = 'Copy code';
const COPIED_LABEL = 'Copied';

/**
 * Issue #122: the exact source text of a fenced block, given the `<code>`
 * element's text. `renderMarkdown` ends a fence body with the newline the
 * fence's closing delimiter implies; the clipboard should carry the lines the
 * reader sees and nothing more, so exactly one trailing newline comes off.
 * Interior and leading blank lines are the block's own and are kept.
 */
export function codeBlockText(raw: string): string {
  return raw.replace(/\n$/, '');
}

/**
 * Issue #122, extended by issue #163: one copy button, wired once, for both
 * panes — so the confirmation contract (the `is-copied` class and the "Copied"
 * accessible name, both for CONFIRM_MS, and nothing at all after a rejected
 * write) cannot drift between them.
 *
 * `className` doubles as the `data-testid`: the two panes pass different ones
 * so a split view's ids stay one-to-one. `readRaw` runs at click time — the
 * edit pane's block moves under edits — and its result goes through
 * `codeBlockText`, which stays the single trailing-newline rule. `copy`
 * reports whether the write landed; a rejected one leaves the button at rest
 * rather than stuck confirming. The label is a `::after` pseudo-element in
 * styles.css, so the button holds no text node (see the module header).
 */
export function createCopyButton(
  doc: Document,
  className: string,
  readRaw: () => string,
  copy: (text: string) => Promise<boolean> | boolean
): HTMLButtonElement {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset.testid = className;
  btn.setAttribute('aria-label', REST_LABEL);
  let timer: ReturnType<typeof setTimeout> | undefined;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation(); // the .doc click delegate / CodeMirror place the caret otherwise
    void (async () => {
      const ok = await copy(codeBlockText(readRaw()));
      if (!ok) return; // a failed write says nothing rather than lying
      btn.classList.add(COPIED_CLASS);
      btn.setAttribute('aria-label', COPIED_LABEL);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove(COPIED_CLASS);
        btn.setAttribute('aria-label', REST_LABEL);
      }, CONFIRM_MS);
    })();
  });
  return btn;
}

/**
 * Issue #122: wrap every `<pre>` under `root` and give it a copy button.
 * Idempotent — a `<pre>` already inside a wrapper is skipped, so a re-run over
 * a partially decorated tree adds nothing twice. Inline `<code>` spans are
 * untouched: only fenced blocks render as `<pre>`.
 */
export function decorateCodeBlocks(root: HTMLElement, copy: (text: string) => Promise<boolean> | boolean): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains(CODE_BLOCK_CLASS)) continue;
    const wrap = root.ownerDocument.createElement('div');
    wrap.className = CODE_BLOCK_CLASS;
    pre.replaceWith(wrap);
    wrap.appendChild(pre);

    // The rendered block's own text: the highlighter's markup contributes no
    // characters of its own, so `<code>`'s textContent is the source body.
    const readRaw = () => (pre.querySelector('code') ?? pre).textContent ?? '';
    wrap.appendChild(createCopyButton(root.ownerDocument, COPY_BUTTON_CLASS, readRaw, copy));
  }
}
