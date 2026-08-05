// PRD 007 Req 4: the seeded test users the local dev mode's mock auth and
// directory providers share. Deterministic and offline — the e2e suite and
// a developer's browser sign in as these.

import type { DirectoryUser } from '../types.ts';

export const SEEDED_USERS: readonly DirectoryUser[] = [
  { id: 'mock-ada', username: 'ada', displayName: 'Ada Lovelace' },
  { id: 'mock-grace', username: 'grace', displayName: 'Grace Hopper' },
  { id: 'mock-alan', username: 'alan', displayName: 'Alan Turing' },
  { id: 'mock-katherine', username: 'katherine', displayName: 'Katherine Johnson' },
];
