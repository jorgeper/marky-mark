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
