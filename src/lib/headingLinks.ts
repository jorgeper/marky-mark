/**
 * PRD 020 Req 18 (issue #223): the preview's per-heading copy-link control.
 *
 * Grafted onto the live preview DOM after injection, exactly like the
 * code-block copy button (`lib/codeCopy.ts`) and for the same reasons: the
 * markdown pipeline's HTML is reused by Export and print, and its rendered
 * text is the comment-anchor coordinate space, so chrome belongs in neither.
 * The button contributes NO text nodes — the glyph is inline SVG and the
 * "Link copied" confirmation is a `::after` pseudo-element in styles.css —
 * so `getDocText()` over the preview root stays byte-identical with the
 * buttons present. The one `aria-live` region lives OUTSIDE the preview
 * root (on its parent) so the announcement never enters the anchor space.
 *
 * The confirmation contract itself (copy at click time, confirm only on a
 * landed write, ~2s, then revert) is `createCopyLinkController` in
 * `lib/shareLinks.ts` — the same controller the Req 16/17 placements use.
 * The editor gutter placement (`components/Editor.tsx`) builds its marker
 * from the same `createHeadingLinkButton` factory below.
 */
import { COPY_LINK_HEADING_LABEL, LINK_COPIED_LABEL, createCopyLinkController } from './shareLinks';

/** The per-heading button; also its `data-testid`. */
export const HEADING_LINK_CLASS = 'mm-heading-link';
/** The shared off-root live region; also its `data-testid`. */
export const HEADING_LINK_LIVE_CLASS = 'mm-heading-link-live';

/** The CopyLinkButton link glyph, duplicated as markup (no React here). */
const LINK_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" data-icon="link">' +
  '<g stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6.7 9.3l2.6-2.6" />' +
  '<path d="M7.5 4.6l1.4-1.4a2.55 2.55 0 0 1 3.6 3.6l-1.4 1.4" />' +
  '<path d="M8.5 11.4l-1.4 1.4a2.55 2.55 0 0 1-3.6-3.6l1.4-1.4" />' +
  '</g></svg>';

/**
 * PRD 020 Req 18: the plain-DOM heading copy-link button both placements
 * share — the preview graft below and the editor gutter marker
 * (`components/Editor.tsx`). One factory so the glyph and the confirmation's
 * DOM contract (the `is-copied` class, the aria-label swap, the live-region
 * text) cannot drift between placements; each caller adds only its own
 * click/focus wiring and where the announcement text lands.
 */
export function createHeadingLinkButton(
  doc: Document,
  opts: {
    className: string;
    testid: string;
    getUrl: () => string | null;
    copy: (text: string) => Promise<boolean> | boolean;
    setLiveText: (text: string) => void;
  }
): { btn: HTMLButtonElement; ctrl: { click(): Promise<void>; dispose(): void } } {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = opts.className;
  btn.dataset.testid = opts.testid;
  // Issue #227: the rest label names the target, so hover distinguishes the
  // heading control from the workspace/file placements.
  btn.title = COPY_LINK_HEADING_LABEL;
  btn.setAttribute('aria-label', COPY_LINK_HEADING_LABEL);
  btn.innerHTML = LINK_SVG;
  const ctrl = createCopyLinkController(opts.getUrl, opts.copy, (on) => {
    btn.classList.toggle('is-copied', on);
    btn.setAttribute('aria-label', on ? LINK_COPIED_LABEL : COPY_LINK_HEADING_LABEL);
    opts.setLiveText(on ? LINK_COPIED_LABEL : '');
  });
  return { btn, ctrl };
}

/**
 * PRD 020 Req 18: give every rendered heading that carries a source-line
 * stamp a hover-revealed copy-link button (CSS owns the reveal). Root-level
 * headings carry `data-mm-line` (SPEC15); container-nested ones — inside a
 * blockquote or list item — carry `data-mm-hline` instead (issue #226), so
 * both are honoured here. Idempotent over a partially decorated tree, like
 * `decorateCodeBlocks`. `getUrlForLine` runs at click time — the slug is
 * derived from the section model of that moment's buffer — and a null URL
 * copies nothing (the controller's rule).
 */
export function decorateHeadingLinks(
  root: HTMLElement,
  getUrlForLine: (line: number) => string | null,
  copy: (text: string) => Promise<boolean> | boolean
): void {
  const doc = root.ownerDocument;
  // One polite live region for all of this root's buttons, parked outside
  // the anchor text space; re-decoration reuses it.
  let live = root.parentElement?.querySelector<HTMLElement>(`.${HEADING_LINK_LIVE_CLASS}`) ?? null;
  if (!live && root.parentElement) {
    live = doc.createElement('span');
    live.className = HEADING_LINK_LIVE_CLASS;
    live.dataset.testid = HEADING_LINK_LIVE_CLASS;
    live.setAttribute('aria-live', 'polite');
    root.parentElement.appendChild(live);
  }

  for (const h of Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))) {
    const line = Number(h.dataset.mmLine ?? h.dataset.mmHline);
    if (!Number.isInteger(line) || line < 1) continue;
    if (h.querySelector(`.${HEADING_LINK_CLASS}`)) continue;
    const { btn, ctrl } = createHeadingLinkButton(doc, {
      className: HEADING_LINK_CLASS,
      testid: HEADING_LINK_CLASS,
      getUrl: () => getUrlForLine(line),
      copy,
      setLiveText: (text) => {
        if (live) live.textContent = text;
      },
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // the .doc click delegate places the caret otherwise
      void ctrl.click();
    });
    h.appendChild(btn);
  }
}
