import { useEffect, useRef } from 'react';

/**
 * SPEC30 §1: the one find bar for both modes. Pure UI — the engines live
 * in the owner (preview: doc-text marks; edit: the CodeMirror search
 * handle). Replace controls render only in edit mode.
 */
export function FindBar({
  mode,
  query,
  replace,
  count,
  current,
  focusTick,
  onQuery,
  onReplace,
  onNext,
  onPrev,
  onReplaceOne,
  onReplaceAll,
  onClose,
}: {
  mode: 'preview' | 'edit';
  query: string;
  replace: string;
  count: number;
  current: number;
  /** Bumped by the owner to refocus the input (⌘F while already open). */
  focusTick: number;
  onQuery(q: string): void;
  onReplace(r: string): void;
  onNext(): void;
  onPrev(): void;
  onReplaceOne(): void;
  onReplaceAll(): void;
  onClose(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const countText = query === '' ? '' : count === 0 ? 'No matches' : `${Math.max(current, 1)} of ${count}`;

  return (
    <div className="find-bar" data-testid="find-bar">
      <div className="find-row">
        <input
          ref={inputRef}
          data-testid="find-input"
          type="text"
          placeholder="Find"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <span className="find-count" data-testid="find-count">
          {countText}
        </span>
        <button data-testid="find-prev" title="Previous match (⇧↩)" onClick={onPrev} disabled={count === 0}>
          ‹
        </button>
        <button data-testid="find-next" title="Next match (↩)" onClick={onNext} disabled={count === 0}>
          ›
        </button>
        <button data-testid="find-close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </div>
      {mode === 'edit' && (
        <div className="find-row">
          <input
            data-testid="find-replace-input"
            type="text"
            placeholder="Replace"
            value={replace}
            onChange={(e) => onReplace(e.target.value)}
            onKeyDown={onKey}
          />
          <button data-testid="find-replace-one" onClick={onReplaceOne} disabled={count === 0}>
            Replace
          </button>
          <button data-testid="find-replace-all" onClick={onReplaceAll} disabled={count === 0}>
            All
          </button>
        </div>
      )}
    </div>
  );
}
