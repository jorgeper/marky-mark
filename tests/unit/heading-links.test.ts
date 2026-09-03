// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HEADING_LINK_CLASS, HEADING_LINK_LIVE_CLASS, decorateHeadingLinks } from '../../src/lib/headingLinks';
import { getDocText } from '../../src/lib/domtext';
import { LINK_COPIED_MS } from '../../src/lib/shareLinks';

afterEach(() => {
  vi.useRealTimers(); // the suite shares workers: never leave fake timers installed
});

/** A stand-in preview: a parent (the scroll pane) holding the doc root. */
function mount(html: string): { parent: HTMLElement; root: HTMLElement } {
  const parent = document.createElement('div');
  const root = document.createElement('div');
  root.innerHTML = html;
  parent.appendChild(root);
  document.body.appendChild(parent);
  return { parent, root };
}

describe('PRD 020 Req 18 preview heading copy-link graft', () => {
  // Intent: every stamped heading gets exactly one button — unstamped
  // headings and non-headings get none, a re-run adds nothing twice — and
  // the graft contributes NO text nodes, so getDocText() over the preview
  // root (the comment-anchor coordinate space) is byte-identical.
  test('U1077: buttons land on stamped headings only, idempotently, without touching the anchor text space', () => {
    const { parent, root } = mount(
      '<h1 data-mm-line="1">Alpha</h1><p data-mm-line="3">body</p>' +
        '<h2 data-mm-line="5">Beta</h2><h2>unstamped</h2>'
    );
    const before = getDocText(root);
    decorateHeadingLinks(root, () => 'https://x/#a', () => true);
    decorateHeadingLinks(root, () => 'https://x/#a', () => true); // idempotent
    expect(root.querySelectorAll(`.${HEADING_LINK_CLASS}`).length).toBe(2);
    expect(root.querySelector(`h1 .${HEADING_LINK_CLASS}`)).not.toBeNull();
    expect(root.querySelector(`h2[data-mm-line] .${HEADING_LINK_CLASS}`)).not.toBeNull();
    expect(getDocText(root)).toBe(before);
    // The live region exists once, OUTSIDE the doc root, empty at rest.
    const lives = parent.querySelectorAll(`.${HEADING_LINK_LIVE_CLASS}`);
    expect(lives.length).toBe(1);
    expect(lives[0].parentElement).toBe(parent);
    expect(root.querySelector(`.${HEADING_LINK_LIVE_CLASS}`)).toBeNull();
    parent.remove();
  });

  // Intent: a click copies the URL the heading's SOURCE LINE resolves to at
  // click time, and the Req 14 confirmation runs — is-copied + "Link copied"
  // aria-label and live announcement for ~2s, then rest; a null URL (say, an
  // untitled buffer) copies and announces nothing.
  test('U1078: click copies the line-resolved URL and confirms per the Req 14 contract; null URL stays silent', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const urls: Record<number, string | null> = { 1: 'https://x/doc.md#alpha', 5: null };
    const { parent, root } = mount('<h1 data-mm-line="1">Alpha</h1><h2 data-mm-line="5">Beta</h2>');
    decorateHeadingLinks(
      root,
      (line) => urls[line] ?? null,
      (text) => {
        writes.push(text);
        return true;
      }
    );
    const [alpha, beta] = Array.from(root.querySelectorAll<HTMLButtonElement>(`.${HEADING_LINK_CLASS}`));
    const live = parent.querySelector(`.${HEADING_LINK_LIVE_CLASS}`)!;

    alpha.click();
    await Promise.resolve(); // the controller's copy resolves in a microtask
    expect(writes).toEqual(['https://x/doc.md#alpha']);
    expect(alpha.classList.contains('is-copied')).toBe(true);
    expect(alpha.getAttribute('aria-label')).toBe('Link copied');
    expect(live.textContent).toBe('Link copied');
    vi.advanceTimersByTime(LINK_COPIED_MS);
    expect(alpha.classList.contains('is-copied')).toBe(false);
    expect(alpha.getAttribute('aria-label')).toBe('Copy link');
    expect(live.textContent).toBe('');

    // The null-URL heading: no write, no confirmation, nothing announced.
    beta.click();
    await Promise.resolve();
    expect(writes).toEqual(['https://x/doc.md#alpha']);
    expect(beta.classList.contains('is-copied')).toBe(false);
    expect(live.textContent).toBe('');
    parent.remove();
  });
});
