// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CONFIRM_MS, codeBlockText, createCopyButton, decorateCodeBlocks } from '../src/lib/codeCopy';

afterEach(() => {
  vi.useRealTimers(); // the suite shares workers: never leave fake timers installed
});

describe('Issue #122 code-block copy control', () => {
  // Intent: the clipboard carries the block's exact source characters. The
  // rendered fence body ends with the newline its closing delimiter implies —
  // that one, and only that one, is dropped, so a two-line block copies as two
  // lines while the block's own blank lines survive verbatim.
  test('U677: exactly one trailing newline is dropped; interior and leading blanks survive', () => {
    expect(codeBlockText('const a = 1;\nconst b = 2;\n')).toBe('const a = 1;\nconst b = 2;');
    expect(codeBlockText('const a = 1;\nconst b = 2;')).toBe('const a = 1;\nconst b = 2;');
    // The block's own trailing blank line is content: only the fence's newline goes.
    expect(codeBlockText('a\n\n')).toBe('a\n');
    expect(codeBlockText('\nleading blank\n')).toBe('\nleading blank');
    expect(codeBlockText('  indented\n\tand tabbed\n')).toBe('  indented\n\tand tabbed');
    expect(codeBlockText('')).toBe('');
    expect(codeBlockText('\n')).toBe('');
  });

  // Intent: issue #163 gave the edit-pane card the preview's button, so both
  // panes share createCopyButton — the confirmation contract is asserted once,
  // here, on the shared unit rather than per pane.
  test('U951: issue #163 — the shared copy button reads its text at click time, confirms for CONFIRM_MS, and stays at rest after a rejected write', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let landed = true;
    let raw = 'first\n';
    const btn = createCopyButton(
      document,
      'mm-copy-code-test',
      () => raw,
      (text) => {
        writes.push(text);
        return landed;
      }
    );
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    // The class doubles as the test id, and the label is the accessible name —
    // no text node, so a grafted button never shifts the text around it.
    expect(btn.className).toBe('mm-copy-code-test');
    expect(btn.dataset.testid).toBe('mm-copy-code-test');
    expect(btn.getAttribute('aria-label')).toBe('Copy code');
    expect(btn.textContent).toBe('');

    btn.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(['first']); // readRaw ran now, and codeBlockText trimmed it
    expect(btn.classList.contains('is-copied')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Copied');

    // Brief confirmation, then back to resting state — never stuck.
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(btn.classList.contains('is-copied')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Copy code');

    // The text comes from the live source on every click, not from mount time.
    raw = 'second\n';
    landed = false;
    btn.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(['first', 'second']);
    // A rejected write says nothing rather than lying.
    expect(btn.classList.contains('is-copied')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Copy code');
  });

  // Intent: the graft stays idempotent and text-free — a re-injection of the
  // preview re-runs it over an already decorated tree.
  test('U952: issue #122 — decorateCodeBlocks wraps each pre once and adds no characters', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>prose <code>inline</code></p><pre><code>const a = 1;\n</code></pre>';
    const before = root.textContent;
    decorateCodeBlocks(root, () => true);
    decorateCodeBlocks(root, () => true);
    expect(root.querySelectorAll('.mm-codeblock')).toHaveLength(1);
    expect(root.querySelectorAll('.mm-copy-code')).toHaveLength(1);
    // Inline `code` is not a fenced block: it gets no button.
    expect(root.querySelectorAll('p button')).toHaveLength(0);
    expect(root.textContent).toBe(before);
  });
});
