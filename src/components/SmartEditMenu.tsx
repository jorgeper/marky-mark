import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SmartMenuEntry } from '../lib/smartEdit';

/**
 * SPEC36 §4: the Smart Edit popup — theme-menu styled, viewport-clamped,
 * flyout submenus (one open at a time, flipping at the viewport edge), full
 * ↑/↓/→/←/Enter/Esc keyboard navigation. Dismissed by Esc, any outside
 * pointerdown, scroll, resize, or invoking a leaf item. The menu holds focus
 * while open; the owner restores editor focus on close.
 */
interface Props {
  x: number;
  y: number;
  entries: SmartMenuEntry[];
  onInvoke(id: string): void;
  onClose(): void;
}

type Item = Exclude<SmartMenuEntry, 'sep'>;

const items = (entries: SmartMenuEntry[]): Item[] =>
  entries.filter((e): e is Item => e !== 'sep' && e.enabled);

export function SmartEditMenu({ x, y, entries, onInvoke, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  // Active item ids at each level; open flyout = the top-level id in `sub`.
  const [active, setActive] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [subActive, setSubActive] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);

  const top = items(entries);
  const subEntries = sub ? (top.find((e) => e.id === sub)?.submenu ?? []) : [];
  const subItems = items(subEntries);

  // Position at the anchor, clamped to the viewport (FolderPanel pattern).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  }, [x, y]);

  // Flip the flyout to the left side when it would leave the viewport.
  useLayoutEffect(() => {
    const el = flyoutRef.current;
    const host = menuRef.current;
    if (!el || !host || !sub) return;
    setFlip(host.getBoundingClientRect().right + el.getBoundingClientRect().width + 8 > window.innerWidth);
  }, [sub]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // Dismissal: outside pointerdown, scroll anywhere, resize (Esc via keydown).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const step = (list: Item[], cur: string | null, dir: 1 | -1): string | null => {
    if (list.length === 0) return null;
    const i = list.findIndex((e) => e.id === cur);
    if (i === -1) return (dir === 1 ? list[0] : list[list.length - 1]).id;
    return list[(i + dir + list.length) % list.length].id;
  };

  const invoke = (item: Item) => {
    if (item.submenu) {
      setSub(item.id);
      setSubActive(items(item.submenu)[0]?.id ?? null);
      return;
    }
    onInvoke(item.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (sub) {
        setSub(null);
        setSubActive(null);
      } else onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (sub) setSubActive((c) => step(subItems, c, dir));
      else setActive((c) => step(top, c, dir));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = top.find((t) => t.id === active);
      if (!sub && item?.submenu) {
        setSub(item.id);
        setSubActive(items(item.submenu)[0]?.id ?? null);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (sub) {
        setSub(null);
        setSubActive(null);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sub) {
        const item = subItems.find((t) => t.id === subActive);
        if (item) invoke(item);
      } else {
        const item = top.find((t) => t.id === active);
        if (item) invoke(item);
      }
    }
  };

  const row = (it: Item, level: 'top' | 'sub') => {
    const isActive = level === 'top' ? active === it.id : subActive === it.id;
    return (
      <button
        key={it.id}
        className={`theme-option smart-edit-item${isActive ? ' active' : ''}`}
        data-testid={`smart-edit-${it.id}`}
        disabled={!it.enabled}
        onPointerEnter={() => {
          if (level === 'top') {
            setActive(it.id);
            if (it.submenu) {
              setSub(it.id);
              setSubActive(null);
            } else setSub(null);
          } else setSubActive(it.id);
        }}
        onClick={() => invoke(it)}
      >
        <span className="smart-edit-label">{it.label}</span>
        {it.hotkey && <span className="menu-hotkey">{it.hotkey}</span>}
        {it.submenu && <span className="smart-edit-arrow">▸</span>}
      </button>
    );
  };

  return (
    <div
      className="theme-menu smart-edit-menu"
      data-testid="smart-edit-menu"
      ref={menuRef}
      tabIndex={-1}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((it, i) =>
        it === 'sep' ? (
          <div key={`sep-${i}`} className="folder-menu-sep" />
        ) : it.submenu ? (
          <div key={it.id} className="smart-edit-subhost">
            {row(it, 'top')}
            {sub === it.id && (
              <div
                className={`theme-menu smart-edit-flyout${flip ? ' flip' : ''}`}
                data-testid={`smart-edit-flyout-${it.id}`}
                ref={flyoutRef}
              >
                {it.submenu.map((s) => (s === 'sep' ? null : row(s, 'sub')))}
              </div>
            )}
          </div>
        ) : (
          row(it, 'top')
        )
      )}
    </div>
  );
}
