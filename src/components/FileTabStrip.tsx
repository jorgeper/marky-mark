/**
 * PRD 013 Reqs 1–4: the file tab strip — a pure view of the SPEC36 §1 open
 * set, in the FolderPanel mold: props in, callbacks out, no platform access
 * beyond the passed `basename` seam. The owner (App) holds the open list,
 * the active path and all activation I/O; this component renders one tab per
 * open file (plus the ephemeral untitled tab) and forwards clicks. It holds
 * no list of its own — `openFiles` IS the SPEC36 state, already tree-ordered.
 * Its only state is transient UI: the Req 7 context menu's anchor.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  fileTabContextMenu,
  railArrowState,
  railRevealTarget,
  railStepTarget,
  railWheelTarget,
  type RailArrowState,
} from '../lib/fileTabs';
import { untitledDisplayName } from '../lib/docName';
import { useAnchoredMenu } from '@marky-mark/editor';
import { IconButton } from './ui/IconButton';

export interface FileTabStripProps {
  /** SPEC36 §1: the open set, tree-ordered — exactly one tab each. */
  openFiles: string[];
  /** The active document's path (its tab renders active); null = none. */
  activePath: string | null;
  /**
   * PRD 013 Req 8: an untitled buffer is open — it renders as an active tab
   * labeled "Untitled" after the open set's tabs, carrying the same trailing
   * ●/✕ slot (its ✕ and middle-click close through `onCloseUntitled`). On
   * Save As the owner clears this flag and opens the saved file, so the
   * ephemeral tab is replaced by the real one (SPEC36, via openDoc's addOpen).
   */
  untitled: boolean;
  /**
   * PRD 023 Reqs 6–8 (issue #291): the untitled buffer is the scratch
   * boot's buffer — its tab reads "Scratch file" in the token-driven
   * accent/italic treatment instead of "Untitled". False for every other
   * untitled buffer (⌘N stays "Untitled", normally styled).
   */
  untitledScratch: boolean;
  /**
   * PRD 013 Req 8 (SPEC36 §2.6): the untitled buffer's unsaved-changes flag —
   * App's own `dirty`, because an untitled buffer sits outside the open set
   * and therefore outside `dirtyFiles`. Drives the untitled tab's ●.
   */
  untitledDirty: boolean;
  /** PRD 013 Req 5 (SPEC36 §3.6): open files with unsaved changes — their
   *  tabs carry the dirty ●. The very set the sidebar's rows read. */
  dirtyFiles: ReadonlySet<string>;
  basename(path: string): string;
  /**
   * PRD 013 Req 3: activate through the owner's existing SPEC36 path — the
   * very call the sidebar's open row makes (openDocGuarded), so park/restore,
   * dirty flags, scroll, undo history and mode behave identically. Only ever
   * called for an INACTIVE tab; the active-tab no-op guard lives here.
   */
  onActivate(path: string): void;
  /**
   * PRD 013 Reqs 5–7: close ONE file through the owner's existing SPEC36
   * §3.4 path — the very callback the sidebar's row ✕ gets (closeOpenFile),
   * so clean-remove, dirty-activate-and-prompt and §3.5 nextActive behave
   * identically. The ✕, middle-click and the menu's Close all call this.
   */
  onClose(path: string): void;
  /** PRD 013 Req 7: Close Others — the owner walks every OTHER open file. */
  onCloseOthers(path: string): void;
  /** PRD 013 Req 7: Close All — the owner walks the whole open set. */
  onCloseAll(): void;
  /**
   * PRD 013 Req 8: close the untitled buffer through the owner's EXISTING
   * dirty-untitled guard — the very call File → Close File makes (App's
   * `closeFile` command: dirty ⇒ the close-untitled prompt, clean ⇒ splash).
   * The untitled tab's ✕ and middle-click both call this; no second path.
   */
  onCloseUntitled(): void;
  /**
   * The strip's end slots: with the strip up, the workspace's corner
   * controls ride IN it — `leading` the closed pane's reopen chevron + view
   * switch (so the chevron keeps the spot the open pane's header gives it),
   * `trailing` the edit/preview switch + preview chevron. The tabs flow
   * between them; with the strip hidden the owner overlays the same
   * controls at the workspace's corners instead.
   */
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** One tab: a real keyboard-reachable button, ellipsis-clipped, tooltipped. */
function Tab({ active, label, title, path, dirty, scratch, onClick, onClose, onMenu }: {
  active: boolean;
  label: string;
  title: string;
  path: string;
  dirty?: boolean;
  /** PRD 023 Req 7: the scratch placeholder label — token-styled + hooked. */
  scratch?: boolean;
  /** Absent (the ACTIVE tab, and the untitled one) ⇒ clicking it is inert. */
  onClick?: () => void;
  /** Every tab closes — open-set tabs via SPEC36 §3.4, the untitled tab via
   *  the owner's dirty-untitled guard (PRD 013 Req 8). Behind the ✕ and the
   *  middle-click alike. */
  onClose: () => void;
  /** Absent (the untitled tab) ⇒ no context menu: Close Others / Close All
   *  are SPEC36 open-set walks, which the untitled buffer sits outside
   *  (§2.6), so its close affordances are the ✕ and middle-click only. */
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={`file-tab btn-quiet${active ? ' active' : ''}`}
      data-testid="file-tab"
      // `data-tab`, deliberately NOT the sidebar's `data-path`: e2e drives
      // rows through page-level `[data-path=…]` locators, and a second
      // element carrying the attribute would break their strict resolution.
      data-tab={path}
      // PRD 013 Req 3: a state a test can assert, beside the class and
      // aria-selected — the basic active/inactive distinction (the full
      // plane-and-shadow treatment is issue #148).
      data-active={active ? 'true' : 'false'}
      role="tab"
      aria-selected={active}
      // PRD 013 Req 4: the tooltip carries the full path, so duplicate
      // basenames across folders stay tellable apart.
      title={title}
      onClick={onClick}
      // PRD 013 Req 6: middle-click closes through the same SPEC36 §3.4 call
      // as the ✕ — never activates, and never autoscrolls/pastes (the
      // default is suppressed on the middle mousedown AND the auxclick).
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose();
      }}
      // PRD 013 Req 7: right-click opens the tab menu (owner-suppressed OS
      // menu, no activation — activation rides onClick, main button only).
      onContextMenu={onMenu}
    >
      {/* PRD 023 Req 7: the scratch placeholder rides the .scratch-name
          token treatment (accent + italic), with data-scratch as the stable
          hook for the hosted e2e slice (issue #293). */}
      <span
        className={`file-tab-label${scratch ? ' scratch-name' : ''}`}
        data-scratch={scratch ? 'true' : undefined}
      >
        {label}
      </span>
      {/* PRD 013 Req 5 (SPEC36 §3.4/§3.6 rotated up): the trailing slot —
          the dirty ● swaps for the ✕ on tab hover (styles.css); the slot
          always renders so the label never reflows when they swap. The ✕
          is a span[role=button], not a nested <button> (the tab is one),
          with its own testids distinct from the sidebar's folder-* ids. */}
      <span className="file-tab-slot">
        {dirty && <span className="file-tab-dirty" data-testid="file-tab-dirty" aria-hidden="true" />}
        <span
          className="file-tab-close"
          data-testid="file-tab-close"
          role="button"
          title="Close file"
          // PRD 013 Req 5: the ✕'s pointer events never reach the tab —
          // an inactive tab's close must not first activate it (a dirty
          // file still activates, but through the §3.4 close path).
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" />
              <line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
            </g>
          </svg>
        </span>
      </span>
    </button>
  );
}

/** PRD 013 Req 9: one scroll-arrow button — a real keyboard-reachable
 *  `button`, disabled (not hidden) at its own end of the range so the pair
 *  keeps a stable footprint while the rail scrolls. Scrolling never touches
 *  the open set: this button only ever moves `scrollLeft`. */
function ScrollArrow({ dir, enabled, onStep }: { dir: -1 | 1; enabled: boolean; onStep: () => void }) {
  const left = dir < 0;
  return (
    <IconButton
      className="file-tab-scroll"
      data-testid={left ? 'file-tab-scroll-left' : 'file-tab-scroll-right'}
      aria-label={left ? 'Scroll tabs left' : 'Scroll tabs right'}
      disabled={!enabled}
      onClick={onStep}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d={left ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </IconButton>
  );
}

export function FileTabStrip(p: FileTabStripProps) {
  // PRD 023 Req 6: the untitled tab's label rides the same resolution the
  // toolbar and the title effect use, so the surfaces cannot drift.
  const untitledName = untitledDisplayName(p.untitledScratch);
  // PRD 013 Req 7: the context menu's anchor — transient UI state only.
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  // SPEC35 §3.2: anchored at the pointer and dismissed by Esc / outside
  // pointer-down / scroll / resize — the very behaviour the sidebar's
  // folder-menu gets, from the one shared hook.
  const menuRef = useAnchoredMenu(menu, () => setMenu(null));

  // PRD 013 Req 9 (issue #147): the scrolling rail and the arrows' state —
  // transient UI, derived from the rail's live geometry, never persisted.
  const stripRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<RailArrowState>({
    overflow: false,
    leftEnabled: false,
    rightEnabled: false,
  });

  // Re-read the rail and keep the arrows honest; identical readings keep the
  // previous state object so scroll events don't re-render for nothing.
  const measure = () => {
    const rail = railRef.current;
    if (!rail) return;
    const next = railArrowState(rail);
    setArrows((prev) =>
      prev.overflow === next.overflow &&
      prev.leftEnabled === next.leftEnabled &&
      prev.rightEnabled === next.rightEnabled
        ? prev
        : next
    );
  };

  // PRD 013 Req 9: true once the user scrolls the rail by wheel or arrow;
  // an activation reveal clears it. While set, nothing may move the rail
  // out from under the user (the reveal-on-resize below stands down).
  const userParkedRef = useRef(false);

  // PRD 013 Req 9: bring the active tab fully into the rail's window —
  // minimal (nearest edge; already visible ⇒ no movement, railRevealTarget)
  // and horizontal-only: writing scrollLeft directly instead of
  // scrollIntoView means no ancestor's scroll can be disturbed. offsetLeft
  // is rail-relative: the rail is the tabs' offsetParent (position: relative
  // in styles.css). The rail's left padding (shadow headroom for the first
  // tab) goes along so a left-edge reveal keeps it in view.
  const revealActive = () => {
    const rail = railRef.current;
    if (!rail) return;
    const el = rail.querySelector<HTMLElement>('.file-tab[data-active="true"]');
    if (!el) return;
    const paddingLeft = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
    rail.scrollLeft = railRevealTarget(
      { scrollLeft: rail.scrollLeft, clientWidth: rail.clientWidth, scrollWidth: rail.scrollWidth, paddingLeft },
      el.offsetLeft,
      el.offsetWidth,
    );
  };

  // PRD 013 Req 9: arrows track the tab list — adds, removes and renames all
  // arrive as a new openFiles (or untitled) value. Layout effect, so the
  // first paint already shows the right arrows.
  useLayoutEffect(measure, [p.openFiles, p.untitled]);

  // PRD 013 Req 9: the rail's WIDTH changes without the strip owning any of
  // those events — window resizes, the folder pane's open/close slide and
  // width drag, split/preview layout changes. Each one re-reads the arrows
  // (a resize that removes the overflow removes them), and — unless the
  // user has parked the rail somewhere deliberate — keeps the active tab
  // revealed, so a boot restore whose reveal ran mid pane-slide still ends
  // with the tab in view once the layout settles.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const ro = new ResizeObserver(() => {
      if (!userParkedRef.current) revealActive();
      measure();
    });
    ro.observe(rail);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PRD 013 Req 9: wheel/trackpad scrolling over the strip drives the rail —
  // the dominant-axis mapping (railWheelTarget) so a plain vertical wheel
  // reaches hidden tabs too. A native non-passive listener, NOT React's
  // onWheel: root-delegated wheel listeners are passive, so preventDefault —
  // the thing that keeps the document/preview from also scrolling or
  // bouncing — would be ignored. The event is consumed ONLY when the rail
  // actually moves; at an end of the range it falls through untouched, so
  // surrounding scroll behaviour keeps working.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      const rail = railRef.current;
      if (!rail) return;
      const target = railWheelTarget(rail, e.deltaX, e.deltaY);
      if (target === rail.scrollLeft) return;
      e.preventDefault();
      userParkedRef.current = true;
      rail.scrollLeft = target;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  // PRD 013 Req 9: reveal-on-activation — whenever the active document
  // changes (sidebar row, tab click, Ctrl+Tab, boot restore, File → New's
  // untitled), its tab ends up fully in view: FolderPanel's selectedPath
  // reveal rotated to the horizontal axis. Keyed on the ACTIVE path alone,
  // so user scrolling by arrow or wheel never snaps back — no dependency
  // re-runs it, and it clears the parked flag: a fresh activation is the
  // one thing that legitimately outranks where the user left the rail.
  useLayoutEffect(() => {
    userParkedRef.current = false;
    revealActive();
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.activePath, p.untitled]);

  const step = (dir: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    userParkedRef.current = true;
    rail.scrollLeft = railStepTarget(rail, dir);
  };

  return (
    <div className="file-tab-strip" data-testid="file-tab-strip" ref={stripRef}>
      {p.leading && <div className="file-tab-strip-lead">{p.leading}</div>}
      {/* PRD 013 Req 9: the arrows sit OUTSIDE the rail at the strip's ends,
          so they stay put while it scrolls; when the tabs fit they are not
          rendered at all and a one- or two-tab strip is untouched. Plain
          theme-variable styling — the plane/shadow treatment is issue #148. */}
      {arrows.overflow && <ScrollArrow dir={-1} enabled={arrows.leftEnabled} onStep={() => step(-1)} />}
      <div
        className="file-tab-rail"
        data-testid="file-tab-rail"
        role="tablist"
        ref={railRef}
        onScroll={measure}
      >
        {p.openFiles.map((path) => {
          const active = path === p.activePath;
          return (
            <Tab
              key={path}
              active={active}
              label={p.basename(path)}
              title={path}
              path={path}
              dirty={p.dirtyFiles.has(path)}
              // PRD 013 Req 3: clicking the ACTIVE tab is a no-op — no re-open,
              // no re-read from disk, no park/restore churn. The guard sits
              // here so the owner's handler stays exactly the sidebar's call.
              onClick={active ? undefined : () => p.onActivate(path)}
              onClose={() => p.onClose(path)}
              onMenu={(e) => {
                e.preventDefault();
                setMenu({ path, x: e.clientX, y: e.clientY });
              }}
            />
          );
        })}
        {p.untitled && (
          // PRD 013 Req 8: the untitled buffer sits outside the SPEC36 set
          // (§2.6), so its tab is appended here rather than derived from
          // openFiles, and it is always the active one (docPath is null while
          // untitled). No onMenu: the menu's walks are open-set walks this
          // buffer sits outside, so right-click opens nothing here.
          // PRD 023 Req 6: the label comes from the shared resolution — the
          // scratch buffer's tab reads "Scratch file", any other "Untitled".
          <Tab
            active
            label={untitledName.name}
            title={untitledName.name}
            path=""
            dirty={p.untitledDirty}
            scratch={untitledName.scratch}
            onClose={p.onCloseUntitled}
          />
        )}
      </div>
      {arrows.overflow && <ScrollArrow dir={1} enabled={arrows.rightEnabled} onStep={() => step(1)} />}
      {p.trailing && <div className="file-tab-strip-trail">{p.trailing}</div>}
      {menu && (
        // PRD 013 Req 7: the tab menu — theme-menu chrome, pointer-anchored
        // and dismissed per SPEC35 §3.2 like the sidebar's folder-menu, with
        // its own testids so the folder-menu* locators never match twice.
        <div
          className="menu theme-menu file-tab-menu"
          data-testid="file-tab-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
        >
          {fileTabContextMenu().map((it) => (
            <button
              key={it.id}
              className="menu-item"
              data-testid={`file-tab-menu-${it.id}`}
              onClick={() => {
                const target = menu.path;
                setMenu(null);
                switch (it.id) {
                  case 'close':
                    p.onClose(target);
                    break;
                  case 'close-others':
                    p.onCloseOthers(target);
                    break;
                  case 'close-all':
                    p.onCloseAll();
                    break;
                }
              }}
            >
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
