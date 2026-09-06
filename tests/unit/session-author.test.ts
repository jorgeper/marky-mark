import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings, sessionAuthorOverride } from '../../src/lib/settings';

// Issue #274: the hosted flavor derives the default comment author from the
// signed-in session (/api/me) instead of the stock 'Reviewer' — display name
// first, username when blank, and never over a stored `author` value.
describe('issue #274 session-derived comment author', () => {
  const ada = { displayName: 'Ada Lovelace', username: 'ada' };

  test('U1115: a session with a display name derives that name when no layer supplies author', () => {
    expect(sessionAuthorOverride({}, ada)).toBe('Ada Lovelace');
  });

  test('U1116: a blank or whitespace-only display name falls back to the username', () => {
    expect(sessionAuthorOverride({}, { displayName: '', username: 'ada' })).toBe('ada');
    expect(sessionAuthorOverride({}, { displayName: '   ', username: 'ada' })).toBe('ada');
    // A fully blank identity derives nothing — resolution keeps the default.
    expect(sessionAuthorOverride({}, { displayName: ' ', username: '' })).toBeUndefined();
  });

  test('U1117: no session derives nothing and layered resolution keeps the Reviewer default', () => {
    expect(sessionAuthorOverride({}, null)).toBeUndefined();
    expect(DEFAULT_SETTINGS.author).toBe('Reviewer');
    expect(resolveSettings({}).author).toBe('Reviewer');
  });

  test('U1118: a stored user-layer author wins over the derived default', () => {
    const layers = { user: { author: 'Custom Pen Name' } };
    expect(sessionAuthorOverride(layers, ada)).toBeUndefined();
    expect(resolveSettings(layers).author).toBe('Custom Pen Name');
  });

  test('U1119: an invalid stored author (empty string) does not block derivation', () => {
    expect(sessionAuthorOverride({ user: { author: '' } }, ada)).toBe('Ada Lovelace');
  });
});
