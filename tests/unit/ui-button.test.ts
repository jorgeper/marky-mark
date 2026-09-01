// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { createElement as h } from 'react';
import { Button } from '../../src/components/ui/Button';
import { mount, unmountAll, withTestId } from './ui-dom';

afterEach(unmountAll);

describe('PRD 018 §B9–B11 Button wrapper', () => {
  test('U1003: neutral default emits exactly "btn" and type="button"', () => {
    const el = mount(h(Button, null, 'Go')) as HTMLButtonElement;
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toBe('btn');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.textContent).toBe('Go');
  });

  test('U1004: each variant emits its exact primitive class string', () => {
    expect(mount(h(Button, { variant: 'neutral' })).className).toBe('btn');
    expect(mount(h(Button, { variant: 'primary' })).className).toBe('btn btn-primary');
    expect(mount(h(Button, { variant: 'quiet' })).className).toBe('btn btn-quiet');
    expect(mount(h(Button, { variant: 'danger' })).className).toBe('btn btn-danger');
  });

  test('U1005: size and pill modifiers compose in a stable order', () => {
    expect(mount(h(Button, { size: 'sm' })).className).toBe('btn btn-sm');
    expect(mount(h(Button, { pill: true })).className).toBe('btn btn-pill');
    expect(mount(h(Button, { variant: 'primary', size: 'sm', pill: true })).className).toBe(
      'btn btn-primary btn-sm btn-pill',
    );
  });

  // PRD 018 §B11: the appended className is a layout hook, never a
  // replacement for the primitives.
  test('U1006: className is appended after the primitive classes, never replacing them', () => {
    expect(mount(h(Button, { className: 'sync-edge' })).className).toBe('btn sync-edge');
    expect(mount(h(Button, { variant: 'danger', className: 'tab-btn' })).className).toBe('btn btn-danger tab-btn');
  });

  test('U1007: arbitrary props reach the DOM element and an explicit type wins the default', () => {
    let clicks = 0;
    const el = mount(
      h(
        Button,
        withTestId(
          {
            'aria-pressed': true,
            type: 'submit' as const,
            onClick: () => {
              clicks += 1;
            },
          },
          'b7',
        ),
      ),
    ) as HTMLButtonElement;
    expect(el.getAttribute('data-testid')).toBe('b7');
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(el.getAttribute('type')).toBe('submit');
    el.click();
    expect(clicks).toBe(1);
    const off = mount(h(Button, { disabled: true })) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
  });
});
