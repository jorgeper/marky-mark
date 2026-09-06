import { describe, expect, test } from 'vitest';
import { classifyManagedLink } from '../../src/lib/managedLinks';
import { DEFAULT_SETTINGS, SETTINGS_SCOPES, resolveSettings } from '../../src/lib/settings';

describe('SPEC43 §11 (issue #270): the shared managed-link rule and the linkView setting', () => {
  test('U1160: classifyManagedLink — http(s) external, #anchor jumps (decoded), anything else inert; one rule for preview and editor', () => {
    expect(classifyManagedLink('https://example.com/a?b=1')).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b=1',
    });
    expect(classifyManagedLink('HTTP://EXAMPLE.COM')).toEqual({ kind: 'external', url: 'HTTP://EXAMPLE.COM' });
    expect(classifyManagedLink('#getting-started')).toEqual({ kind: 'anchor', id: 'getting-started' });
    // Percent-encoded anchors decode like the preview always did; a broken
    // encoding degrades to the raw slice rather than throwing.
    expect(classifyManagedLink('#a%20b')).toEqual({ kind: 'anchor', id: 'a b' });
    expect(classifyManagedLink('#%E0%A4%A')).toEqual({ kind: 'anchor', id: '%E0%A4%A' });
    // The parity contract: relative files, mail and bare protocols are inert
    // in BOTH panes — this issue adds no file-opening behaviour to either.
    for (const inert of ['./other.md', '../up.md', 'mailto:a@b.c', 'ftp://x', 'javascript:alert(1)', '']) {
      expect(classifyManagedLink(inert)).toEqual({ kind: 'inert' });
    }
  });

  test('U1161: linkView — ships rendered (true), user-scoped like its four view siblings, and a hand-edited non-boolean falls back', () => {
    expect(DEFAULT_SETTINGS.linkView).toBe(true);
    expect(SETTINGS_SCOPES.linkView).toBe('U');
    expect(resolveSettings({ user: { linkView: false } }).linkView).toBe(false);
    expect(resolveSettings({ user: { linkView: 'raw' } }).linkView).toBe(true); // invalid → default
  });
});
