import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings, sessionAuthorDefault } from '../../src/lib/settings';

// Issue #274: the hosted flavor derives the default comment author from the
// signed-in session (/api/me) instead of the stock 'Reviewer' — display name
// first, username when blank, and never over a stored `author` value.
describe('issue #274 session-derived comment author', () => {
  const ada = { displayName: 'Ada Lovelace', username: 'ada' };

  test('U1148: a session with a display name derives that name when no layer supplies author', () => {
    expect(sessionAuthorDefault({}, ada)).toBe('Ada Lovelace');
  });

  test('U1149: a blank or whitespace-only display name falls back to the username', () => {
    expect(sessionAuthorDefault({}, { displayName: '', username: 'ada' })).toBe('ada');
    expect(sessionAuthorDefault({}, { displayName: '   ', username: 'ada' })).toBe('ada');
    // A fully blank identity derives nothing — resolution keeps the default.
    expect(sessionAuthorDefault({}, { displayName: ' ', username: '' })).toBeUndefined();
  });

  test('U1150: no session derives nothing and layered resolution keeps the Reviewer default', () => {
    expect(sessionAuthorDefault({}, null)).toBeUndefined();
    expect(DEFAULT_SETTINGS.author).toBe('Reviewer');
    expect(resolveSettings({}).author).toBe('Reviewer');
  });

  test('U1151: a stored user-layer author wins over the derived default', () => {
    const layers = { user: { author: 'Custom Pen Name' } };
    expect(sessionAuthorDefault(layers, ada)).toBeUndefined();
    expect(resolveSettings(layers).author).toBe('Custom Pen Name');
  });

  test('U1152: an invalid stored author (empty string) does not block derivation', () => {
    expect(sessionAuthorDefault({ user: { author: '' } }, ada)).toBe('Ada Lovelace');
  });
});
