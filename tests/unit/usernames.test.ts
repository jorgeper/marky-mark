import { describe, expect, it } from 'vitest';
import { deriveUsername, identityLocalPart, slugifyUsername } from '../../src/lib/usernames';

// PRD 020 Req 12: the pure username-derivation rules — the server stores one
// result per user forever (server/usernames.ts), so everything decidable
// without storage is proven here.

describe('PRD 020 Req 12 username derivation', () => {
  it('U1064: the derivation source is the identity local part — AAD alias for members, email local part for guests', () => {
    // A member's UPN: the alias before the @.
    expect(identityLocalPart({ username: 'Ada.Lovelace@contoso.com' })).toBe('Ada.Lovelace');
    // A seeded local dev identity has no @ at all — already a local part.
    expect(identityLocalPart({ username: 'ada' })).toBe('ada');
    // A guest's UPN is Entra's mangled #EXT# form: their email wins.
    expect(
      identityLocalPart({
        username: 'jane_gmail.com#EXT#@contoso.onmicrosoft.com',
        email: 'jane@gmail.com',
      }),
    ).toBe('jane');
    // A guest whose provider surfaced no email falls back to the UPN's local
    // part — still deterministic, still slugifiable.
    expect(identityLocalPart({ username: 'jane_gmail.com#EXT#@contoso.onmicrosoft.com' })).toBe(
      'jane_gmail.com#EXT#',
    );
  });

  it('U1065: slugifyUsername lowercases and collapses runs outside the Req 1 charset, with a fallback for nothing usable', () => {
    expect(slugifyUsername('Ada.Lovelace')).toBe('ada.lovelace');
    expect(slugifyUsername('jane_gmail.com#EXT#')).toBe('jane_gmail.com-ext-');
    expect(slugifyUsername('grace hopper (guest)')).toBe('grace-hopper-guest-');
    // Nothing usable at all still yields a charset-legal base for dedupe.
    expect(slugifyUsername('数学')).toBe('-');
    expect(slugifyUsername('')).toBe('user');
  });

  it('U1066: deriveUsername dedupes deployment-wide with -2, -3… and never lands on a reserved route word', () => {
    expect(deriveUsername({ username: 'ada@contoso.com' }, new Set())).toBe('ada');
    expect(deriveUsername({ username: 'ada@contoso.com' }, new Set(['ada']))).toBe('ada-2');
    expect(deriveUsername({ username: 'ada@contoso.com' }, new Set(['ada', 'ada-2']))).toBe('ada-3');
    // Reserved words count as taken — a user whose alias IS a route word can
    // never shadow /api/… or the scratch routes.
    for (const alias of ['scratch', 'Scratchpad', 'api', 'assets']) {
      expect(deriveUsername({ username: `${alias}@contoso.com` }, new Set())).toBe(
        `${alias.toLowerCase()}-2`,
      );
    }
    // A guest-style identity derives from the email end to end.
    expect(
      deriveUsername(
        { username: 'Jane_gmail.com#EXT#@contoso.onmicrosoft.com', email: 'Jane@Gmail.com' },
        new Set(['jane']),
      ),
    ).toBe('jane-2');
  });
});
