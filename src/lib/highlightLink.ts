/**
 * PRD 022 Req 10 (issue #233): the active highlight's copy-link control.
 *
 * Grafted onto the live preview DOM like the heading affordance
 * (`headingLinks.ts` in `@marky-mark/editor`) and built from the same
 * button factory, so the glyph, the confirmation contract (`is-copied`,
 * the aria-label swap, the shared live region) and the announcement cannot
 * drift between placements. Like every graft it contributes NO text nodes —
 * the glyph is SVG and the caption a pseudo-element — so `getDocText()`
 * over the root stays byte-identical and every comment anchor resolves.
 *
 * At most one button per preview root: it appears with the active highlight,
 * absolutely positioned in the left margin beside the highlight's first
 * painted `mark.hl` fragment (mirroring the heading affordance's
 * margin-side placement), and leaves when the highlight deactivates or its
 * entry no longer paints a mark. The caller re-runs `updateHighlightLink`
 * whenever activation or the painted marks change — including after a
 * re-injection wiped the doc's children — and gates it hosted-only
 * (PRD 020 Req 15); this module only manages the DOM it is told about.
 */
import { createHeadingLinkButton, ensureCopyLinkLiveRegion } from '@marky-mark/editor';
import { COPY_LINK_HIGHLIGHT_LABEL } from './shareLinks';

/** The active highlight's copy-link button; also its `data-testid`. */
export const HIGHLIGHT_LINK_CLASS = 'mm-hl-link';

interface Graft {
  btn: HTMLButtonElement;
  ctrl: { click(): Promise<void>; dispose(): void };
  id: string;
}

/** Per-root graft state, so re-runs reposition instead of re-creating. */
const grafts = new WeakMap<HTMLElement, Graft>();

/**
 * Make the root's one copy-link button match the active highlight: `id`
 * null — or painting no mark — removes it; otherwise it is (re)created for
 * that entry and positioned level with the first mark fragment's top line.
 */
export function updateHighlightLink(
  root: HTMLElement,
  id: string | null,
  opts: { getUrl(): string | null; copy(text: string): Promise<boolean> | boolean }
): void {
  const prev = grafts.get(root) ?? null;
  const mark =
    id !== null ? root.querySelector<HTMLElement>(`mark.hl[data-cid="${CSS.escape(id)}"]`) : null;
  if (id === null || !mark) {
    if (prev) {
      prev.ctrl.dispose();
      prev.btn.remove();
      grafts.delete(root);
    }
    return;
  }
  let g = prev;
  // A re-injection detaches the old button even when the id is unchanged.
  if (!g || g.id !== id || !root.contains(g.btn)) {
    if (prev) {
      prev.ctrl.dispose();
      prev.btn.remove();
    }
    // The heading graft's one off-root live region announces for this
    // placement too (created here if this button lands first).
    const live = ensureCopyLinkLiveRegion(root);
    const { btn, ctrl } = createHeadingLinkButton(root.ownerDocument, {
      // The heading class carries the shared look and confirmation caption;
      // the placement class hoists it to the margin (styles.css).
      className: `mm-heading-link ${HIGHLIGHT_LINK_CLASS}`,
      testid: HIGHLIGHT_LINK_CLASS,
      label: COPY_LINK_HIGHLIGHT_LABEL,
      getUrl: opts.getUrl,
      copy: opts.copy,
      setLiveText: (text) => {
        if (live) live.textContent = text;
      },
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // the .doc click delegate treats it as click-away otherwise
      placeCaption(btn);
      void ctrl.click();
    });
    root.appendChild(btn);
    g = { btn, ctrl, id };
    grafts.set(root, g);
  }
  // Beside the first painted line: the first mark fragment's top, in the
  // root's coordinate space (the root is the positioning context).
  const rootRect = root.getBoundingClientRect();
  g.btn.style.top = `${mark.getBoundingClientRect().top - rootRect.top}px`;
  // At the left margin (the doc's padding column) — but never clipped out of
  // reach: when the comments panel squeezes the workspace into sideways
  // overflow, the doc's left padding can scroll under the folder pane and
  // its resize divider (which also overhangs the seam by 3px). Clamp to the
  // nearest overflow-clipping ancestor's visible edge so the control stays
  // beside the line AND clickable.
  let clipLeft = -Infinity;
  for (let el = root.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowX !== 'visible') {
      clipLeft = Math.max(clipLeft, el.getBoundingClientRect().left);
    }
  }
  g.btn.style.left = `${Math.max(6, clipLeft + 8 - rootRect.left)}px`;
}

/**
 * Issue #309: the viewport room the "Link copied" pill needs beside the
 * glyph — the caption at `--mm-text-caption` plus its padding, border and
 * gap (styles.css `.mm-hl-link.is-copied::after`), with slack for wider
 * fonts — and the gap between the glyph and the pill.
 */
const CAPTION_ROOM = 100;
const CAPTION_GAP = 4;

/**
 * PRD 022 Req 10 (issue #309): aim the confirmation caption for this click.
 * The pill is position: fixed (it escapes the workspace's sideways clip —
 * the doc has no gutter to grow into at ordinary widths), so the button
 * hands it that moment's viewport coordinates: level with the glyph's
 * centre, hung off the glyph's LEFT edge so the paragraph's text column
 * stays clear — unless the viewport edge is too close for it, when it goes
 * right instead, floating opaque over the words rather than off-screen.
 * Decided per click, against the layout of that moment, since the panes may
 * have moved since the graft landed.
 */
function placeCaption(btn: HTMLElement): void {
  const b = btn.getBoundingClientRect();
  const side = b.left - CAPTION_GAP >= CAPTION_ROOM ? 'left' : 'right';
  btn.dataset.captionSide = side;
  btn.style.setProperty('--mm-hl-caption-y', `${b.top + b.height / 2}px`);
  // The x value is the inset the CSS reads for that side: on the left a
  // `right` inset measured from the viewport's right edge, so the pill ENDS
  // one gap before the glyph; on the right a `left` inset, so it STARTS one
  // gap after it.
  const viewportWidth = btn.ownerDocument.documentElement.clientWidth;
  const inset = side === 'left' ? viewportWidth - b.left + CAPTION_GAP : b.right + CAPTION_GAP;
  btn.style.setProperty('--mm-hl-caption-x', `${inset}px`);
}
