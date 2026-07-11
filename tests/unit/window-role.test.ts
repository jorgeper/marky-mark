import { describe, expect, test } from 'vitest';
import { windowRole } from '../../src/lib/windowRole';

describe('SPEC13 window role', () => {
  test('U22: ?window= routes to settings/about; absent, unknown, or unrelated params → main', () => {
    expect(windowRole('')).toBe('main');
    expect(windowRole('?nativeMenu=1')).toBe('main');
    expect(windowRole('?window=settings')).toBe('settings');
    expect(windowRole('?window=about')).toBe('about');
    expect(windowRole('?window=about&nativeMenu=1')).toBe('about');
    expect(windowRole('?window=bogus')).toBe('main');
    expect(windowRole('?window=')).toBe('main');
  });
});
