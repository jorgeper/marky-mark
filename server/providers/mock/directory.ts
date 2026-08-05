// PRD 007 Req 4: local dev mode's user directory — case-insensitive substring
// search over the seeded test users, mirroring how the Graph implementation
// answers member pickers, with zero network.

import type { DirectoryProvider, DirectoryUser, UserPhoto } from '../types.ts';
import { userPhotoUrl } from '../types.ts';
import { SEEDED_USERS } from './users.ts';

// PRD 007 Req 6: one seeded user has no photo, so the "no photo → 404 →
// initials fallback" path is exercisable offline, exactly like a Graph user
// who never uploaded a picture.
const PHOTOLESS_IDS = new Set(['mock-katherine']);

// PRD 007 Req 6: deterministic avatars with zero assets and zero network —
// an SVG initials disc whose hue is derived from the user id, so local dev
// and e2e render the same picture on every run.
function avatarSvg(user: DirectoryUser): string {
  let hash = 0;
  for (const ch of user.id) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="hsl(${hash}, 55%, 45%)"/>` +
    `<text x="32" y="41" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fff">${initials}</text>` +
    `</svg>`
  );
}

/** The seeded user decorated with its same-origin avatar URL, when it has a photo. */
function withAvatar(user: DirectoryUser): DirectoryUser {
  return PHOTOLESS_IDS.has(user.id) ? user : { ...user, avatarUrl: userPhotoUrl(user.id) };
}

export function createMockDirectoryProvider(): DirectoryProvider {
  return {
    kind: 'mock',
    async search(query: string): Promise<DirectoryUser[]> {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return SEEDED_USERS.filter(
        (u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
      ).map(withAvatar);
    },
    async getUser(id: string): Promise<DirectoryUser | null> {
      const found = SEEDED_USERS.find((u) => u.id === id);
      return found ? withAvatar(found) : null;
    },
    async getUserPhoto(id: string): Promise<UserPhoto | null> {
      const found = SEEDED_USERS.find((u) => u.id === id);
      if (!found || PHOTOLESS_IDS.has(id)) return null;
      return { contentType: 'image/svg+xml', data: new TextEncoder().encode(avatarSvg(found)) };
    },
  };
}
