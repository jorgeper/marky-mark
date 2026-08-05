// PRD 007 Req 4: local dev mode's user directory — case-insensitive substring
// search over the seeded test users, mirroring how the Graph implementation
// answers member pickers, with zero network.

import type { DirectoryProvider, DirectoryUser } from '../types.ts';
import { SEEDED_USERS } from './users.ts';

export function createMockDirectoryProvider(): DirectoryProvider {
  return {
    kind: 'mock',
    async search(query: string): Promise<DirectoryUser[]> {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return SEEDED_USERS.filter(
        (u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
      );
    },
    async getUser(id: string): Promise<DirectoryUser | null> {
      return SEEDED_USERS.find((u) => u.id === id) ?? null;
    },
  };
}
