/**
 * PRD 013 Reqs 1–4: the file tab strip — a pure view of the SPEC36 §1 open
 * set, in the FolderPanel mold: props in, callbacks out, no platform access
 * beyond the passed `basename` seam. The owner (App) holds the open list,
 * the active path and all activation I/O; this component renders one tab per
 * open file (plus the ephemeral untitled tab) and forwards clicks. It holds
 * no list of its own — `openFiles` IS the SPEC36 state, already tree-ordered.
 * Its only state is transient UI: the Req 7 context menu's anchor.
 */

import { useState } from 'react';
import { fileTabContextMenu } from '../lib/fileTabs';
import { useAnchoredMenu } from './anchoredMenu';

export interface FileTabStripProps {
  /** SPEC36 §1: the open set, tree-ordered — exactly one tab each. */
  openFiles: string[];
  /** The active document's path (its tab renders active); null = none. */
  activePath: string | null;
  /**
   * PRD 013 Req 8 (scoped to #144): an untitled buffer is open — it renders
   * as an active tab labeled "Untitled" after the open set's tabs. Its close
   * affordance and Save As replacement land in issue #146.
   */
  untitled: boolean;
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
}

/** One tab: a real keyboard-reachable button, ellipsis-clipped, tooltipped. */
function Tab({ active, label, title, path, dirty, onClick, onClose, onMenu }: {
  active: boolean;
  label: string;
  title: string;
  path: string;
  dirty?: boolean;
  onClick?: () => void;
  /** Absent (the untitled tab, #146) ⇒ no slot, no middle-click, no menu. */
  onClose?: () => void;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={`file-tab${active ? ' active' : ''}`}
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
      onMouseDown={onClose ? (e) => { if (e.button === 1) e.preventDefault(); } : undefined}
      onAuxClick={
        onClose
          ? (e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onClose();
            }
          : undefined
      }
      // PRD 013 Req 7: right-click opens the tab menu (owner-suppressed OS
      // menu, no activation — activation rides onClick, main button only).
      onContextMenu={onMenu}
    >
      <span className="file-tab-label">{label}</span>
      {onClose && (
        // PRD 013 Req 5 (SPEC36 §3.4/§3.6 rotated up): the trailing slot —
        // the dirty ● swaps for the ✕ on tab hover (styles.css); the slot
        // always renders so the label never reflows when they swap. The ✕
        // is a span[role=button], not a nested <button> (the tab is one),
        // with its own testids distinct from the sidebar's folder-* ids.
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
      )}
    </button>
  );
}

export function FileTabStrip(p: FileTabStripProps) {
  // PRD 013 Req 7: the context menu's anchor — transient UI state only.
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  // SPEC35 §3.2: anchored at the pointer and dismissed by Esc / outside
  // pointer-down / scroll / resize — the very behaviour the sidebar's
  // folder-menu gets, from the one shared hook.
  const menuRef = useAnchoredMenu(menu, () => setMenu(null));

  return (
    <div className="file-tab-strip" data-testid="file-tab-strip" role="tablist">
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
        // PRD 013 Req 8 (scoped to #144): the untitled buffer sits outside
        // the SPEC36 set (§2.6), so its tab is appended here rather than
        // derived from openFiles; it is always the active one (docPath is
        // null while untitled), and clicking it is inert — no close slot,
        // no middle-click, no context menu until issue #146.
        <Tab active label="Untitled" title="Untitled" path="" />
      )}
      {menu && (
        // PRD 013 Req 7: the tab menu — theme-menu chrome, pointer-anchored
        // and dismissed per SPEC35 §3.2 like the sidebar's folder-menu, with
        // its own testids so the folder-menu* locators never match twice.
        <div
          className="theme-menu file-tab-menu"
          data-testid="file-tab-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
        >
          {fileTabContextMenu().map((it) => (
            <button
              key={it.id}
              className="theme-option"
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
