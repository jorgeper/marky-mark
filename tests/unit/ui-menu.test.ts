// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { createElement as h } from 'react';
import { Menu, MenuItem, MenuSeparator } from '../../src/components/ui/Menu';
import { mount, unmountAll, withTestId } from './ui-dom';

afterEach(unmountAll);

describe('PRD 018 §B9–B11 Menu wrappers', () => {
  test('U1010: Menu emits exactly "menu" on a div; className appended; arbitrary props reach the DOM', () => {
    const el = mount(h(Menu, null, 'rows'));
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('menu');
    expect(el.textContent).toBe('rows');
    const hooked = mount(h(Menu, withTestId({ className: 'anchor-left', role: 'menu' }, 'm10')));
    expect(hooked.className).toBe('menu anchor-left');
    expect(hooked.getAttribute('data-testid')).toBe('m10');
    expect(hooked.getAttribute('role')).toBe('menu');
  });

  test('U1011: MenuItem is a type="button" row emitting exactly "menu-item"; arbitrary props reach the element', () => {
    let clicks = 0;
    const el = mount(
      h(
        MenuItem,
        withTestId(
          {
            'aria-checked': true,
            onClick: () => {
              clicks += 1;
            },
          },
          'mi11',
        ),
        'Open',
      ),
    ) as HTMLButtonElement;
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toBe('menu-item');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.getAttribute('data-testid')).toBe('mi11');
    expect(el.getAttribute('aria-checked')).toBe('true');
    el.click();
    expect(clicks).toBe(1);
    const off = mount(h(MenuItem, { disabled: true, className: 'theme-option' })) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.className).toBe('menu-item theme-option');
  });

  test('U1012: MenuSeparator emits exactly "menu-sep"; className appended; arbitrary props reach the DOM', () => {
    const el = mount(h(MenuSeparator, null));
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('menu-sep');
    const hooked = mount(h(MenuSeparator, withTestId({ className: 'group-gap', role: 'separator' }, 'ms12')));
    expect(hooked.className).toBe('menu-sep group-gap');
    expect(hooked.getAttribute('role')).toBe('separator');
    expect(hooked.getAttribute('data-testid')).toBe('ms12');
  });
});
