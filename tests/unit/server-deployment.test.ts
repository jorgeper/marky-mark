import { describe, expect, it } from 'vitest';
import {
  CALLER_GUEST_TTL_MS,
  createCallerGuestLookup,
  createDeploymentPolicy,
} from '../../server/deployment';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { DirectoryProvider, DirectoryUser, RequestAuth } from '../../server/providers/types';
import { serializeDeploymentSettings } from '../../src/lib/deploymentSettings';
import { createMemoryStorage } from './storage-contract';

// PRD 017 Reqs 9+15: the server side of the deployment policies — the
// caller-guest lookup's cache and fail-closed fallback with an injected
// directory and clock, and the per-request settings read, all offline.

const authFor = (id: string, username = id): RequestAuth => ({
  token: `token-${id}`,
  user: { id, username, displayName: username },
});

/** A directory whose getUser is scripted per call, counting the calls. */
function scriptedDirectory(answer: (id: string) => Promise<DirectoryUser | null>): {
  directory: DirectoryProvider;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    directory: {
      kind: 'scripted',
      async search() {
        return [];
      },
      getUser(id: string) {
        calls.push(id);
        return answer(id);
      },
      async getUserPhoto() {
        return null;
      },
    },
  };
}

describe('PRD 017 §9 caller-guest lookup', () => {
  it('U968: the directory answer is cached per user for the OBO-like window, then re-fetched', async () => {
    let clock = 0;
    const { directory, calls } = scriptedDirectory(async (id) => ({
      id,
      username: 'mary',
      displayName: 'Mary Jackson',
      isGuest: id === 'mock-mary',
    }));
    const isGuest = createCallerGuestLookup(directory, () => clock);
    // Guest and member answers come from the directory's own entry.
    expect(await isGuest(authFor('mock-mary'))).toBe(true);
    expect(await isGuest(authFor('mock-ada'))).toBe(false);
    expect(calls).toEqual(['mock-mary', 'mock-ada']);
    // Within the validity window the cached answer is reused — no new call.
    clock = CALLER_GUEST_TTL_MS - 1;
    expect(await isGuest(authFor('mock-mary'))).toBe(true);
    expect(calls).toEqual(['mock-mary', 'mock-ada']);
    // Past the window the entry is stale and the directory is asked again.
    clock = CALLER_GUEST_TTL_MS + 1;
    expect(await isGuest(authFor('mock-mary'))).toBe(true);
    expect(calls).toEqual(['mock-mary', 'mock-ada', 'mock-mary']);
  });

  it('U969: a directory that cannot answer means guest (fail closed) — and the failure is never cached', async () => {
    let fail = true;
    const { directory, calls } = scriptedDirectory(async (id) => {
      if (fail) throw new Error('directory down');
      return { id, username: 'ada', displayName: 'Ada Lovelace' };
    });
    const isGuest = createCallerGuestLookup(directory, () => 0);
    expect(await isGuest(authFor('mock-ada'))).toBe(true);
    // The failure was evicted: the very next call retries the directory and
    // gets the real (member) answer, with no window to wait out.
    fail = false;
    expect(await isGuest(authFor('mock-ada'))).toBe(false);
    expect(calls).toEqual(['mock-ada', 'mock-ada']);
    // An id the directory does not know is a guest too (Req 9 fails closed).
    const unknown = scriptedDirectory(async () => null);
    expect(await createCallerGuestLookup(unknown.directory, () => 0)(authFor('mock-x'))).toBe(true);
  });
});

describe('PRD 017 §8+15 per-request policy reads', () => {
  it('U970: creationFor re-reads deployment/settings.json on every call — a rewrite takes effect immediately, a corrupt blob fails closed', async () => {
    const { provider, blobs } = createMemoryStorage();
    const policy = createDeploymentPolicy(provider, createMockDirectoryProvider(), () => 0);
    const mary = authFor('mock-mary', 'mary'); // the seeded guest
    const ada = authFor('mock-ada', 'ada');
    // Absent blob: the defaults — everyone may create, guests included.
    expect(await policy.creationFor(mary)).toEqual({ allowed: true });
    // members: the mock directory answers from SEEDED_USERS — mary is the
    // seeded guest and is refused; ada is a member and is not. No restart,
    // no invalidation: the blob write alone changes the answer (Req 15).
    await provider.write(
      'deployment/settings.json',
      serializeDeploymentSettings({
        version: 1,
        creation: { policy: 'members', allow: [] },
        listing: { policy: 'everyone' },
      }),
    );
    expect(await policy.creationFor(mary)).toEqual({ allowed: false, refusal: 'guest' });
    expect(await policy.creationFor(ada)).toEqual({ allowed: true });
    // An admin is admitted under the same policy without a directory answer.
    expect(await policy.creationFor({ ...authFor('mock-katherine'), isAdmin: true })).toEqual({ allowed: true });
    // A corrupt record fails closed: restricted + empty allow, error carried.
    await provider.write('deployment/settings.json', 'not json{');
    expect(await policy.creationFor(ada)).toEqual({ allowed: false, refusal: 'restricted' });
    const effective = await policy.read();
    expect(effective.settings.listing.policy).toBe('members');
    expect(effective.error).toBeTruthy();
    blobs.clear();
    // Blob gone again: back to the defaults on the very next read.
    expect(await policy.creationFor(ada)).toEqual({ allowed: true });
  });
});
