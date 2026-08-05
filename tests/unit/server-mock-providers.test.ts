import { describe, expect, it } from 'vitest';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { SEEDED_USERS } from '../../server/providers/mock/users';

// PRD 007 Req 4: the seeded mock auth + directory providers that back the
// offline local dev mode (and the hosted e2e suite).
describe('PRD 007 Req 4 mock auth provider', () => {
  const auth = createMockAuthProvider();

  it('U220: sign-in as a seeded user yields a token and the user; unknown or absent usernames yield null', async () => {
    const result = await auth.signIn({ username: 'ada' });
    expect(result).toMatchObject({
      kind: 'token',
      user: { id: 'mock-ada', username: 'ada', displayName: 'Ada Lovelace' },
    });
    expect(await auth.signIn({ username: 'mallory' })).toBeNull();
    expect(await auth.signIn({})).toBeNull();
  });

  it('U221: a signed-in token validates back to the same user — and survives a provider restart; garbage does not', async () => {
    const result = await auth.signIn({ username: 'grace' });
    if (result?.kind !== 'token') throw new Error('expected a token sign-in');
    expect(await auth.validateToken(result.token)).toEqual(result.user);
    // Stateless by design: a fresh provider (server restart) still accepts it.
    expect(await createMockAuthProvider().validateToken(result.token)).toEqual(result.user);
    expect(await auth.validateToken('garbage')).toBeNull();
    expect(await auth.validateToken('mock:mallory')).toBeNull();
    expect(await auth.validateToken('')).toBeNull();
  });
});

describe('PRD 007 Req 4 mock directory provider', () => {
  const directory = createMockDirectoryProvider();
  const auth = { token: 'mock:ada', user: { id: 'mock-ada', username: 'ada', displayName: 'Ada Lovelace' } };

  it('U222: search matches case-insensitive substrings of display name or username; blank query matches nothing', async () => {
    expect(await directory.search('LOVE', auth)).toEqual([
      expect.objectContaining({ displayName: 'Ada Lovelace' }),
    ]);
    expect(await directory.search('gra', auth)).toEqual([
      expect.objectContaining({ username: 'grace' }),
    ]);
    expect(await directory.search('a', auth)).toHaveLength(
      SEEDED_USERS.filter((u) => u.displayName.toLowerCase().includes('a') || u.username.includes('a')).length,
    );
    expect(await directory.search('  ', auth)).toEqual([]);
    expect(await directory.search('nobody-here', auth)).toEqual([]);
  });

  it('U223: getUser resolves a seeded id and returns null for an unknown one', async () => {
    expect(await directory.getUser('mock-alan', auth)).toMatchObject({ displayName: 'Alan Turing' });
    expect(await directory.getUser('mock-nobody', auth)).toBeNull();
  });

  it('U245: seeded users carry the same-origin avatar URL and a deterministic SVG photo', async () => {
    // PRD 007 Req 6: local dev and e2e render real pictures with zero
    // network — same bytes on every call, media type included.
    expect(await directory.getUser('mock-ada', auth)).toMatchObject({
      avatarUrl: '/api/directory/users/mock-ada/photo',
    });
    expect(await directory.search('hopper', auth)).toEqual([
      expect.objectContaining({ avatarUrl: '/api/directory/users/mock-grace/photo' }),
    ]);
    const photo = await directory.getUserPhoto('mock-ada', auth);
    expect(photo?.contentType).toBe('image/svg+xml');
    const svg = new TextDecoder().decode(photo!.data);
    expect(svg).toContain('<svg');
    expect(svg).toContain('AL'); // Ada Lovelace's initials are baked into the picture
    const again = await directory.getUserPhoto('mock-ada', auth);
    expect(again!.data).toEqual(photo!.data);
  });

  it('U246: the photo-less seeded user and unknown ids answer null photos (and no avatarUrl)', async () => {
    // PRD 007 Req 6: katherine deliberately has no photo, so the offline
    // suite exercises the 404 → initials-fallback path a Graph user without
    // a picture takes.
    expect(await directory.getUser('mock-katherine', auth)).toEqual({
      id: 'mock-katherine',
      username: 'katherine',
      displayName: 'Katherine Johnson',
    });
    expect(await directory.getUserPhoto('mock-katherine', auth)).toBeNull();
    expect(await directory.getUserPhoto('mock-nobody', auth)).toBeNull();
  });
});
