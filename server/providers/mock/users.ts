// PRD 007 Req 4: the seeded test users the local dev mode's mock auth and
// directory providers share. Deterministic and offline — the e2e suite and
// a developer's browser sign in as these.

import type { DirectoryUser } from '../types.ts';

export const SEEDED_USERS: readonly DirectoryUser[] = [
  { id: 'mock-ada', username: 'ada', displayName: 'Ada Lovelace' },
  { id: 'mock-grace', username: 'grace', displayName: 'Grace Hopper' },
  { id: 'mock-alan', username: 'alan', displayName: 'Alan Turing' },
  { id: 'mock-katherine', username: 'katherine', displayName: 'Katherine Johnson' },
  // PRD 017 Req 25: the seeded guest, so external-collaborator flows are
  // testable offline. The four above are unchanged and remain non-admins
  // (local mode's default admin is mock-katherine via MM_ADMINS, not here).
  { id: 'mock-mary', username: 'mary', displayName: 'Mary Jackson', isGuest: true },
];
