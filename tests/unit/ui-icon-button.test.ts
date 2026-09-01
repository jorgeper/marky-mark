// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { createElement as h } from 'react';
import { IconButton } from '../../src/components/ui/IconButton';
import { mount, unmountAll, withTestId } from './ui-dom';

afterEach(unmountAll);

describe('PRD 018 §B9–B11 IconButton wrapper', () => {
  test('U1008: emits exactly "icon-btn", defaults type="button", and the accessible name reaches the DOM', () => {
    const el = mount(h(IconButton, { 'aria-label': 'Close' }, '×')) as HTMLButtonElement;
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toBe('icon-btn');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('Close');
    // The title flavour of the required accessible name (PRD 018 §B9).
    const titled = mount(h(IconButton, { title: 'Pin' }, '➤'));
    expect(titled.getAttribute('title')).toBe('Pin');
  });

  test('U1009: className is appended, never replaced, and arbitrary props reach the DOM element', () => {
    let clicks = 0;
    const el = mount(
      h(
        IconButton,
        withTestId(
          {
            'aria-label': 'Sync',
            className: 'sync-edge',
            onClick: () => {
              clicks += 1;
            },
          },
          'i9',
        ),
      ),
    ) as HTMLButtonElement;
    expect(el.className).toBe('icon-btn sync-edge');
    expect(el.getAttribute('data-testid')).toBe('i9');
    el.click();
    expect(clicks).toBe(1);
    const off = mount(h(IconButton, { title: 'Off', disabled: true })) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
  });
});
