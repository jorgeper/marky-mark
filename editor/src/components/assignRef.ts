import type { MutableRefObject, Ref } from 'react';

/**
 * Write a value into a caller-supplied ref, whichever form it takes. Preview
 * and SplitView both forward the host's scroller/doc refs while also keeping
 * their own; this is the internal helper they share (not package API).
 */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}
