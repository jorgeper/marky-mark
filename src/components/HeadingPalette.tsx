import { useEffect, useRef, useState } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';

/** SPEC16 §4: one jumpable heading, harvested from the rendered document. */
export interface PaletteHeading {
  line: number;
  depth: number; // 1–6
  text: string;
}

/**
 * The ⌘K heading palette (SPEC16 §4): a centered overlay with a fuzzy filter
 * over the document's headings. ↑/↓ move, Enter/click jumps, Esc or a scrim
 * click closes. Rendering only — the owner supplies headings and performs
 * the jump.
 */
export function HeadingPalette({
  headings,
  onJump,
  onClose,
}: {
  headings: PaletteHeading[];
  onJump(h: PaletteHeading): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = fuzzyFilter(query, headings, (h) => h.text);
  const clamped = Math.min(index, Math.max(filtered.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-palette-index="${clamped}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [clamped, query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = filtered[clamped];
      if (h) {
        onJump(h);
        onClose();
      }
    }
  };

  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" data-testid="heading-palette">
        <input
          data-testid="heading-palette-input"
          autoFocus
          placeholder="Go to heading…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKey}
        />
        <ul ref={listRef}>
          {filtered.map((h, i) => (
            <li key={`${h.line}-${h.text}`}>
              <button
                data-testid="heading-palette-item"
                data-palette-index={i}
                className={i === clamped ? 'active' : ''}
                style={{ paddingLeft: 10 + (h.depth - 1) * 14 }}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  onJump(h);
                  onClose();
                }}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
