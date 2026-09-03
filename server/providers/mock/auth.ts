// PRD 007 Req 4: local dev mode's auth provider — sign-in as a seeded test
// user with no secret, entirely offline. Tokens are stateless (`mock:<name>`)
// so they survive a server restart mid-e2e-run; this is a dev convenience,
// never a production credential (mode selection is explicit via MM_MODE).

import type { AuthProvider, AuthUser, SignInResult } from '../types.ts';
import { SEEDED_USERS } from './users.ts';

const TOKEN_PREFIX = 'mock:';

function toAuthUser(username: string): AuthUser | null {
  const u = SEEDED_USERS.find((s) => s.username === username);
  // PRD 020 Req 12: a seeded email rides through for username derivation.
  return u
    ? { id: u.id, username: u.username, displayName: u.displayName, ...(u.email ? { email: u.email } : {}) }
    : null;
}

export function createMockAuthProvider(): AuthProvider {
  return {
    kind: 'mock',
    async signIn(request: { username?: string }): Promise<SignInResult | null> {
      const user = request.username ? toAuthUser(request.username) : null;
      if (!user) return null;
      return { kind: 'token', token: `${TOKEN_PREFIX}${user.username}`, user };
    },
    async validateToken(token: string): Promise<AuthUser | null> {
      if (!token.startsWith(TOKEN_PREFIX)) return null;
      return toAuthUser(token.slice(TOKEN_PREFIX.length));
    },
  };
}
