// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { createElement as h } from 'react';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { mount, unmountAll, withTestId } from './ui-dom';

afterEach(unmountAll);

describe('PRD 018 §B9–B11 (issue #249) SectionHeader wrapper', () => {
  test('U1227: emits exactly "section-header" on an <h3> — never an <h2>, which `.dialog h2` styles as a dialog title', () => {
    const el = mount(h(SectionHeader, null, 'People'));
    expect(el.tagName).toBe('H3');
    expect(el.className).toBe('section-header');
    expect(el.textContent).toBe('People');
  });

  test('U1228: className is appended, never replaced, so a layout hook composes with the primitive', () => {
    const el = mount(
      h(SectionHeader, withTestId({ className: 'hotkey-group' }, 'hotkey-group-smart-edit'), 'Smart Edit'),
    );
    expect(el.className).toBe('section-header hotkey-group');
    expect(el.getAttribute('data-testid')).toBe('hotkey-group-smart-edit');
  });
});
