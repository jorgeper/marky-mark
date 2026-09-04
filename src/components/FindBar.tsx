import { useEffect, useRef } from 'react';
import type { SearchOptions } from '@marky-mark/editor';
import { SearchOptionsBar } from './SearchPanel';
import { Button } from './ui/Button';

/**
 * SPEC30 §1: the one find bar for both modes. Pure UI — the engines live
 * in the owner (preview: doc-text marks; edit: the CodeMirror search
 * handle). Replace controls render only in edit mode.
 *
 * PRD 014 Req 10 (issue #154): the bar mounts the Search view's
 * `SearchOptionsBar` — the same three toggles, the same option state shape —
 * and renders `compileQuery`'s invalid-regex message inline. No matching
 * logic here: options in, flips and query text out.
 */
export function FindBar({
  mode,
  query,
  replace,
  count,
  current,
  options,
  error,
  focusTick,
  onQuery,
  onOptions,
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
  options: SearchOptions;
  /** compileQuery's own invalid-regex message, or null when the query compiles. */
  error: string | null;
  /** Bumped by the owner to refocus the input (⌘F while already open). */
  focusTick: number;
  onQuery(q: string): void;
  onOptions(next: SearchOptions): void;
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
  // PRD 014 Req 11 (issue #154): the loud no-match state rides the bar itself
  // (styles.css keys on it), not just the muted count text.
  const noMatch = query !== '' && count === 0;

  return (
    <div className="find-bar" data-testid="find-bar" data-state={noMatch ? 'no-match' : 'ok'}>
      <div className="find-row">
        <input
          ref={inputRef}
          className="field"
          data-testid="find-input"
          type="text"
          placeholder="Find"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <SearchOptionsBar options={options} onChange={onOptions} />
        <span className="find-count" data-testid="find-count">
          {countText}
        </span>
        <Button variant="quiet" size="sm" data-testid="find-prev" title="Previous match (⇧↩)" onClick={onPrev} disabled={count === 0}>
          ‹
        </Button>
        <Button variant="quiet" size="sm" data-testid="find-next" title="Next match (↩)" onClick={onNext} disabled={count === 0}>
          ›
        </Button>
        <Button variant="quiet" size="sm" data-testid="find-close" title="Close (Esc)" onClick={onClose}>
          ×
        </Button>
      </div>
      {error !== null && (
        <div className="find-error" data-testid="find-error" role="alert">
          {error}
        </div>
      )}
      {mode === 'edit' && (
        <div className="find-row">
          <input
            className="field"
            data-testid="find-replace-input"
            type="text"
            placeholder="Replace"
            value={replace}
            onChange={(e) => onReplace(e.target.value)}
            onKeyDown={onKey}
          />
          <Button variant="quiet" size="sm" data-testid="find-replace-one" onClick={onReplaceOne} disabled={count === 0}>
            Replace
          </Button>
          <Button variant="quiet" size="sm" data-testid="find-replace-all" onClick={onReplaceAll} disabled={count === 0}>
            All
          </Button>
        </div>
      )}
    </div>
  );
}
