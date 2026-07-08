import { useEffect, useRef, useState } from 'react';
import { displayCombo, type HotkeyMap } from '../lib/hotkeys';

interface Props {
  docName: string | null;
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
  onToggleMode(): void;
  onToggleComments(): void;
  onOpenFile(): void;
  onSave(): void;
  onSaveAs(): void;
  onHelp(): void;
  onOpenSettings(): void;
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

/** The app icon in miniature: white "M" on the terracotta rounded square. */
function AppBadge() {
  return (
    <svg data-testid="app-badge" width="20" height="20" viewBox="0 0 32 32" aria-label="Marky Mark">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#d97757" />
      <g stroke="#faf9f5" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 9.5 22.5 V 10 L 16 18 L 22.5 10 V 22.5" />
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
 * v2 toolbar (SPEC2 FR-U.1): filename · Edit/Preview · comments toggle · one
 * overflow menu (Open… / Save / Settings…). Nothing else.
 */
export function Toolbar(p: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
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

  const item = (testid: string, label: string, hint: string | null, onClick: () => void) => (
    <button
      className="theme-option"
      data-testid={testid}
      onClick={() => {
        setMenuOpen(false);
        onClick();
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );

  return (
    <header className="toolbar">
      <span className="docname" data-testid="docname" title={p.docPath ?? undefined}>
        {p.docName ?? <AppBadge />}
        {p.dirty && (
          <span className="dirty-dot" data-testid="dirty-dot" title="Unsaved changes">
            ●
          </span>
        )}
      </span>

      <button
        className={`tbtn${p.mode === 'edit' ? ' on' : ''}`}
        data-testid="edit-toggle"
        title={`Toggle edit / preview (${displayCombo(p.hotkeys.toggleEdit, p.isMac)})`}
        onClick={p.onToggleMode}
      >
        {p.mode === 'edit' ? 'Preview' : 'Edit'}
        <kbd>{displayCombo(p.hotkeys.toggleEdit, p.isMac)}</kbd>
      </button>

      {p.commentsEnabled && (
        <button
          className={`tbtn${p.showComments ? ' on' : ''}`}
          data-testid="comments-toggle"
          title={`Show / hide comments (${displayCombo(p.hotkeys.toggleComments, p.isMac)})`}
          onClick={p.onToggleComments}
        >
          <CommentsIcon />
          {p.commentCount > 0 ? ` ${p.commentCount}` : ''}
        </button>
      )}

      <div className="theme-picker" ref={menuRef}>
        <button className="tbtn" data-testid="menu-btn" title="Menu" onClick={() => setMenuOpen((o) => !o)}>
          <MenuIcon />
        </button>
        {menuOpen && (
          <div className="theme-menu" data-testid="app-menu">
            {item('menu-open', 'Open…', displayCombo(p.hotkeys.openFile, p.isMac), p.onOpenFile)}
            {item('menu-save', 'Save', displayCombo(p.hotkeys.save, p.isMac), p.onSave)}
            {item('menu-save-as', 'Save As…', null, p.onSaveAs)}
            {item('menu-help', 'Help', null, p.onHelp)}
            <div className="menu-footer">{item('menu-settings', 'Settings…', null, p.onOpenSettings)}</div>
          </div>
        )}
      </div>
    </header>
  );
}
