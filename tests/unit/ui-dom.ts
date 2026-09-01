// Shared DOM harness for the src/components/ui wrapper tests (PRD 018
// §B10). Not a test file itself — vitest's include only picks *.test.ts.
// flushSync makes the render commit synchronously so assertions can read
// the DOM immediately; unmountAll restores the document because the unit
// suite shares worker contexts (isolate: false).
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const live: { root: Root; host: HTMLElement }[] = [];

/** Renders `el` into a fresh host and returns the rendered DOM element. */
export function mount(el: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(el));
  live.push({ root, host });
  return host.firstElementChild as HTMLElement;
}

/** JSX exempts hyphenated attributes (data-*) from excess-property checks;
    createElement does not. This identity merges a data-testid into an
    otherwise fully type-checked props literal — React still forwards the
    attribute to the DOM, which the tests assert. */
export function withTestId<P extends object>(props: P, id: string): P {
  return { ...props, 'data-testid': id };
}

/** afterEach hook: unmounts every mount() of the test and empties the body. */
export function unmountAll(): void {
  for (const { root, host } of live.splice(0)) {
    root.unmount();
    host.remove();
  }
}
