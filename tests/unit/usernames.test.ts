import { describe, expect, it } from 'vitest';
import { deriveUsername, identityLocalPart, slugifyUsername } from '../../src/lib/usernames';
import { UNIQUE_NAME_MAX_LENGTH, uniqueNameFormatProblem } from '../../src/lib/workspaceNames';

// PRD 020 Req 12 (slugify amended by PRD 026 Req 11): the pure
// username-derivation rules — the server stores one result per user forever
// (server/usernames.ts), so everything decidable without storage is proven
// here.

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

  it('U1065: slugifyUsername is the shared PRD 026 Req 2 slugifier — lowercase-dash output, dashes trimmed, `user` for nothing usable (PRD 026 Req 11)', () => {
    expect(slugifyUsername('Ada.Lovelace')).toBe('ada-lovelace');
    // No trailing dash survives a run that ends the local part.
    expect(slugifyUsername('jane_gmail.com#EXT#')).toBe('jane-gmail-com-ext');
    expect(slugifyUsername('grace hopper (guest)')).toBe('grace-hopper-guest');
    // Nothing usable at all yields the `user` fallback, never a bare dash.
    expect(slugifyUsername('数学')).toBe('user');
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

  it('U1323: PRD 026 Req 11 — a first-seen dotted or underscored local part derives a lowercase-dash username', () => {
    expect(slugifyUsername('jane.doe')).toBe('jane-doe');
    expect(slugifyUsername('j_smith')).toBe('j-smith');
    // End to end from the identity: jane.doe@contoso.com is jane-doe.
    expect(deriveUsername({ username: 'jane.doe@contoso.com' }, new Set())).toBe('jane-doe');
    expect(deriveUsername({ username: 'J_Smith@contoso.com' }, new Set())).toBe('j-smith');
  });

  it('U1324: PRD 026 Req 11 — a local part with nothing usable derives `user`, and `user` dedupes like any other name', () => {
    for (const localPart of ['数学', '!!!', '']) {
      expect(slugifyUsername(localPart)).toBe('user');
    }
    expect(deriveUsername({ username: '日本語@contoso.com' }, new Set())).toBe('user');
    expect(deriveUsername({ username: '!!!@contoso.com' }, new Set(['user']))).toBe('user-2');
  });

  it('U1325: PRD 026 Req 11 — dedupe and the reserved route words are unchanged under the shared slugifier', () => {
    expect(deriveUsername({ username: 'jane.doe@contoso.com' }, new Set(['jane-doe']))).toBe('jane-doe-2');
    expect(deriveUsername({ username: 'jane.doe@contoso.com' }, new Set(['jane-doe', 'jane-doe-2']))).toBe(
      'jane-doe-3',
    );
    for (const alias of ['api', 'assets', 'scratch', 'scratchpad']) {
      expect(deriveUsername({ username: `${alias}@contoso.com` }, new Set())).toBe(`${alias}-2`);
    }
  });

  it('U1326: PRD 026 Req 11 — every username the derivation mints satisfies Req 1, including a clamped long local part', () => {
    const longLocalPart = `${'a'.repeat(99)}.${'b'.repeat(20)}`;
    const clamped = slugifyUsername(longLocalPart);
    // The cut lands right after the dash that replaced the dot; it goes too.
    expect(clamped).toBe('a'.repeat(99));
    expect(clamped.length).toBeLessThanOrEqual(UNIQUE_NAME_MAX_LENGTH);
    expect(slugifyUsername('a'.repeat(150)).length).toBe(UNIQUE_NAME_MAX_LENGTH);
    const identities = [
      'jane.doe@contoso.com',
      'j_smith@contoso.com',
      'Ada.Lovelace@contoso.com',
      'grace hopper (guest)@contoso.com',
      'jane_gmail.com#EXT#@contoso.onmicrosoft.com',
      '数学@contoso.com',
      '!!!@contoso.com',
      `${longLocalPart}@contoso.com`,
      'scratch@contoso.com',
    ];
    for (const username of identities) {
      for (const taken of [new Set<string>(), new Set(['jane-doe', 'j-smith', 'user', 'ada-lovelace'])]) {
        const derived = deriveUsername({ username }, taken);
        expect(uniqueNameFormatProblem(derived), `${username} → ${derived}`).toBeNull();
      }
    }
  });
});
