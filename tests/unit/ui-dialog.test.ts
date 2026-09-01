// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { createElement as h } from 'react';
import { Dialog } from '../../src/components/ui/Dialog';
import { mount, unmountAll, withTestId } from './ui-dom';

afterEach(unmountAll);

describe('PRD 018 §B9–B11 Dialog wrapper', () => {
  test('U1013: renders the "dialog" shell with header/body/actions slot classes in order', () => {
    const el = mount(h(Dialog, { header: 'Title', actions: h('button', null, 'OK') }, 'body text'));
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('dialog');
    expect(Array.from(el.children).map((c) => c.className)).toEqual([
      'dialog-header',
      'dialog-body',
      'dialog-actions',
    ]);
    expect(el.querySelector('.dialog-header')!.textContent).toBe('Title');
    expect(el.querySelector('.dialog-body')!.textContent).toBe('body text');
    expect(el.querySelector('.dialog-actions')!.textContent).toBe('OK');
  });

  test('U1014: omitted slots render no element; className appended and arbitrary props reach the root', () => {
    const el = mount(
      h(Dialog, withTestId({ className: 'settings-modal', 'aria-modal': true, role: 'dialog' }, 'd14'), 'just body'),
    );
    expect(el.className).toBe('dialog settings-modal');
    expect(el.getAttribute('data-testid')).toBe('d14');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('role')).toBe('dialog');
    expect(Array.from(el.children).map((c) => c.className)).toEqual(['dialog-body']);
  });
});
