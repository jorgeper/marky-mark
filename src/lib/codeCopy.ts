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
 */

/** Wrapper added around each `<pre>` — the positioning context for the button. */
export const CODE_BLOCK_CLASS = 'mm-codeblock';
/** The copy button itself; also its `data-testid`. */
export const COPY_BUTTON_CLASS = 'mm-copy-code';
/** Confirmation class, carried for CONFIRM_MS after a successful copy. */
export const COPIED_CLASS = 'is-copied';
/** How long the button says "Copied" before reverting. */
export const CONFIRM_MS = 1200;

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
 * Issue #122: wrap every `<pre>` under `root` and give it a copy button.
 * Idempotent — a `<pre>` already inside a wrapper is skipped, so a re-run over
 * a partially decorated tree adds nothing twice. Inline `<code>` spans are
 * untouched: only fenced blocks render as `<pre>`.
 *
 * `copy` reports whether the write landed; a rejected write leaves the button
 * in its resting state rather than stuck confirming.
 */
export function decorateCodeBlocks(root: HTMLElement, copy: (text: string) => Promise<boolean> | boolean): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains(CODE_BLOCK_CLASS)) continue;
    const wrap = root.ownerDocument.createElement('div');
    wrap.className = CODE_BLOCK_CLASS;
    pre.replaceWith(wrap);
    wrap.appendChild(pre);

    const btn = root.ownerDocument.createElement('button');
    btn.type = 'button';
    btn.className = COPY_BUTTON_CLASS;
    btn.dataset.testid = COPY_BUTTON_CLASS;
    btn.setAttribute('aria-label', 'Copy code');
    // Not focus-stealing chrome: the label lives in CSS so the button holds no
    // text node (see the module header).
    let timer: ReturnType<typeof setTimeout> | undefined;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // the .doc click delegate places the caret otherwise
      const code = pre.querySelector('code') ?? pre;
      void (async () => {
        const ok = await copy(codeBlockText(code.textContent ?? ''));
        if (!ok) return; // a failed write says nothing rather than lying
        btn.classList.add(COPIED_CLASS);
        btn.setAttribute('aria-label', 'Copied');
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.classList.remove(COPIED_CLASS);
          btn.setAttribute('aria-label', 'Copy code');
        }, CONFIRM_MS);
      })();
    });
    wrap.appendChild(btn);
  }
}
