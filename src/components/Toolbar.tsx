import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { AppMenuGroup, AppMenuRow } from '../lib/appMenu';
import type { CommandId } from '../lib/commands';
import { displayCombo, type HotkeyMap } from '@marky-mark/editor';

interface Props {
  docName: string | null;
  /**
   * PRD 009 Req 11: the open workspace's name, shown here now that the
   * bottom-right switcher chip is gone. Null outside workspace mode, where
   * this affordance stays exactly the filename it has always been.
   */
  workspaceName?: string | null;
  /** Full on-disk path, shown as the filename's hover tooltip (SPEC2 FR-U.3). */
  docPath: string | null;
  dirty: boolean;
  mode: 'preview' | 'edit';
  showComments: boolean;
  /** Comments master switch (SPEC7 §2): off hides the toggle entirely. */
  commentsEnabled: boolean;
  commentCount: number;
  hotkeys: HotkeyMap;
  isMac: boolean;
  /**
   * PRD 007 Req 17: whether this user may change the open document. Absent ⇒
   * no permission model (desktop, the shim, the web build) — the Edit toggle
   * stays exactly as it was. False hides it, matching the native menu's
   * grayed items. The menu's own Save rows ride the same flag through
   * lib/appMenu.ts.
   */
  canEdit?: boolean;
  /**
   * PRD 009 Req 8: the menu's item set, already gated — this component
   * renders it and decides nothing about order, membership or gating
   * (lib/appMenu.ts).
   */
  menu: AppMenuGroup[];
  onToggleMode(): void;
  onToggleComments(): void;
  /** PRD 009 Req 8: every row dispatches through this one seam. */
  onCommand(id: CommandId): void;
  /** Reports the menu popover state so the auto-hiding shell can stay pinned. */
  onMenuOpenChange(open: boolean): void;
}

/** Hamburger: three horizontal bars (SPEC3 §4). */
function MenuIcon() {
  return (
    <svg data-testid="menu-icon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="2.5" y1="4" x2="13.5" y2="4" />
        <line x1="2.5" y1="8" x2="13.5" y2="8" />
        <line x1="2.5" y1="12" x2="13.5" y2="12" />
      </g>
    </svg>
  );
}

/** SPEC27 §2: the full tile — terracotta gradient square + the glyph. */
export function AppBadge({ size = 20, testId = 'app-badge' }: { size?: number; testId?: string }) {
  const uid = useId();
  return (
    <svg data-testid={testId} width={size} height={size} viewBox="0 0 240 240" aria-label="Marky Mark">
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#DA8560" />
          <stop offset="100%" stopColor="#B95A3D" />
        </linearGradient>
        <linearGradient id={`tg-${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="34" x2="0" y2="206">
          <stop offset="0%" stopColor="#FFFBF4" />
          <stop offset="60%" stopColor="#F9EDDC" />
          <stop offset="100%" stopColor="#EFD9BC" />
        </linearGradient>
      </defs>
      <rect width="240" height="240" rx="54" fill={`url(#bg-${uid})`} />
      {/* No drop-shadow filter at chip sizes — crisper, cheaper. */}
      <g>
        <rect x="74" y="38" width="32" height="164" rx="16" fill={`url(#tg-${uid})`} />
        <rect x="134" y="38" width="32" height="164" rx="16" fill={`url(#tg-${uid})`} />
        <rect x="36" y="74" width="168" height="32" rx="16" fill={`url(#tg-${uid})`} transform="rotate(-9 120 90)" />
        <rect x="36" y="134" width="168" height="32" rx="16" fill={`url(#tg-${uid})`} />
        <circle cx="90" cy="120" r="9.5" fill="#BE5E3F" />
        <circle cx="150" cy="120" r="9.5" fill="#BE5E3F" />
        <path d="M102,148 Q120,162 138,146" stroke="#BE5E3F" strokeWidth="8.5" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

/** Outline speech balloon (stroke only, inherits theme color). */
function CommentsIcon() {
  return (
    <svg data-testid="comments-icon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2.5 h10 a1.8 1.8 0 0 1 1.8 1.8 v5.4 a1.8 1.8 0 0 1 -1.8 1.8 H7.2 L4 14.2 v-2.7 H3 a1.8 1.8 0 0 1 -1.8 -1.8 V4.3 A1.8 1.8 0 0 1 3 2.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * v2 toolbar (SPEC2 FR-U.1): one overflow menu · filename · Edit/Preview ·
 * comments toggle. Nothing else. PRD 009 Req 7/8: the menu leads the toolbar
 * on the left, and its rows are the data lib/appMenu.ts derives — this
 * component renders them and dispatches, nothing more.
 */
export function Toolbar(p: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  // PRD 009 Req 12: the View ▸ flyout, open only over an open menu.
  const [subOpen, setSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const onMenuOpenChange = p.onMenuOpenChange;

  // Report popover state to the auto-hiding shell AFTER commit — calling the
  // parent's setState from inside an updater would be a render-phase update.
  useEffect(() => {
    onMenuOpenChange(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // PRD 009 Req 12: the flyout closes with the menu it hangs off — however the
  // menu closed (a row, the hamburger, a click outside).
  useEffect(() => {
    if (!menuOpen) setSubOpen(false);
  }, [menuOpen]);

  // PRD 007 Req 17: absent ⇒ no permission model ⇒ the Edit toggle stays.
  const canEdit = p.canEdit !== false;
  // PRD 009 Req 12: the one submenu parent's rows (View ▸), already grouped.
  const submenuRows = p.menu.flatMap((g) => g.rows).find((r) => r.submenu)?.submenu;

  /**
   * PRD 009 Req 8/12: one row renderer for both panels — this component still
   * decides nothing about membership, order, checked or disabled state.
   * `checkGutter` reserves the ✓ column on every row of a panel that holds any
   * checkbox rows, so its labels line up whatever is currently on.
   */
  const renderRow = (r: AppMenuRow, checkGutter = false) => {
    const combo = r.hotkey ? p.hotkeys[r.hotkey] : r.accel;
    return (
      <button
        key={r.testId}
        className="menu-item"
        data-testid={r.testId}
        disabled={r.disabled}
        role={r.checked !== undefined ? 'menuitemcheckbox' : undefined}
        aria-checked={r.checked}
        aria-haspopup={r.submenu ? 'menu' : undefined}
        aria-expanded={r.submenu ? subOpen : undefined}
        onClick={() => {
          // Req 8/12: a submenu parent dispatches nothing — it opens its
          // flyout and leaves the menu open behind it.
          if (r.submenu) {
            setSubOpen((o) => !o);
            return;
          }
          if (!r.command) return;
          setMenuOpen(false);
          p.onCommand(r.command);
        }}
      >
        {/* Req 12: a checkbox row shows whether it is currently on. */}
        {(checkGutter || r.checked !== undefined) && (
          <span className="menu-check" data-testid={`${r.testId}-check`} aria-hidden="true">
            {r.checked ? '✓' : ''}
          </span>
        )}
        <span style={{ flex: 1 }}>{r.label}</span>
        {combo && <kbd>{displayCombo(combo, p.isMac)}</kbd>}
        {r.submenu && (
          <span className="submenu-arrow" aria-hidden="true">
            ▸
          </span>
        )}
      </button>
    );
  };
  return (
    <header className="toolbar">
      {/* PRD 009 Req 7: the hamburger is the toolbar's FIRST element, and its
          popover is anchored to it — .anchor-left, so the folder, smart-edit
          and theme popovers sharing .theme-menu stay right-anchored. */}
      <div className="theme-picker" ref={menuRef}>
        <button className="btn btn-quiet btn-sm" data-testid="menu-btn" title="Menu" onClick={() => setMenuOpen((o) => !o)}>
          <MenuIcon />
        </button>
        {menuOpen && (
          <div className="menu theme-menu anchor-left" data-testid="app-menu">
            {p.menu.map((group, gi) => (
              <Fragment key={group.id}>
                {/* Req 8: one separator BETWEEN groups — a menu that starts or
                    ends with one is never rendered because empty groups are
                    already gone (lib/appMenu.ts). */}
                {gi > 0 && <div className="menu-sep" data-testid="menu-sep" role="separator" />}
                {group.rows.map((r) => renderRow(r))}
              </Fragment>
            ))}
          </div>
        )}
        {/* PRD 009 Req 12: the View ▸ flyout — a panel of its own, so the
            menu's frozen item set (E13/E201/W13 read `app-menu`'s buttons)
            keeps reading exactly the top-level rows. It lives inside the
            menu's subtree, so the outside-click handler above closes both. */}
        {menuOpen && subOpen && submenuRows && (
          <div className="menu theme-menu anchor-left submenu-panel" data-testid="app-menu-view" role="menu">
            {submenuRows.map((rows, gi) => (
              <Fragment key={rows[0].testId}>
                {gi > 0 && <div className="menu-sep" data-testid="menu-sep" role="separator" />}
                {rows.map((r) => renderRow(r, true))}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      <span className="docname" data-testid="docname" title={p.docPath ?? undefined}>
        {/* PRD 009 Req 11: with a workspace open its name lives here — the
            switcher chip that used to carry it is gone. */}
        {p.workspaceName && (
          <>
            <span className="ws-name" data-testid="docname-workspace">
              {p.workspaceName}
            </span>
            {p.docName && <span className="ws-sep"> / </span>}
          </>
        )}
        {p.docName}
        {/* SPEC5 §1 (amended, issue #197): the badge never fills the title
            slot — it stays empty when nothing is named there. */}
        {p.dirty && (
          <span className="dirty-dot" data-testid="dirty-dot" title="Unsaved changes">
            ●
          </span>
        )}
      </span>

      {canEdit && (
        <button
          className={`btn btn-quiet btn-sm${p.mode === 'edit' ? ' on' : ''}`}
          data-testid="edit-toggle"
          title={`Toggle edit / preview (${displayCombo(p.hotkeys.toggleEdit, p.isMac)})`}
          onClick={p.onToggleMode}
        >
          {p.mode === 'edit' ? 'Preview' : 'Edit'}
          <kbd>{displayCombo(p.hotkeys.toggleEdit, p.isMac)}</kbd>
        </button>
      )}

      {p.commentsEnabled && (
        <button
          className={`btn btn-quiet btn-sm${p.showComments ? ' on' : ''}`}
          data-testid="comments-toggle"
          title={`Show / hide comments (${displayCombo(p.hotkeys.toggleComments, p.isMac)})`}
          onClick={p.onToggleComments}
        >
          <CommentsIcon />
          {p.commentCount > 0 ? ` ${p.commentCount}` : ''}
        </button>
      )}
    </header>
  );
}
