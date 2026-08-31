// PRD 017 Reqs 6–9+15: the server side of the deployment policies. The
// decisions themselves are the pure functions in
// src/lib/deploymentSettings.ts (shared with the client); this module owns
// the two per-request resolutions — reading the stored record, and asking
// the directory whether the caller is a guest — and hands routes one small
// interface so app.ts (/api/me) and workspaces.ts (create/list) cannot
// evaluate the policy two different ways.

import {
  decideWorkspaceCreation,
  DEPLOYMENT_SETTINGS_BLOB,
  effectiveDeploymentSettings,
  type CreationDecision,
  type EffectiveDeploymentSettings,
} from '../src/lib/deploymentSettings.ts';
import { OBO_EXPIRY_MARGIN_SECONDS } from './providers/azure/obo.ts';
import type { DirectoryProvider, RequestAuth, StorageProvider } from './providers/types.ts';

/**
 * PRD 017 Req 9: how long one caller's guest answer is reused — the same
 * validity window the OBO cache works to (an hour-long Entra token minus
 * obo.ts's safety margin), so the Graph lookup behind it costs one exchange
 * window, not one call per create attempt.
 */
export const CALLER_GUEST_TTL_MS = (3600 - OBO_EXPIRY_MARGIN_SECONDS) * 1000;

/** Resolves whether the calling user is a guest of the tenant. */
export type CallerGuestLookup = (auth: RequestAuth) => Promise<boolean>;

/**
 * PRD 017 Req 9: the caller's guest status from the directory's own entry
 * for them — `getUser(caller.id, auth)` (Graph `userType` over the existing
 * OBO token; the mock answers from SEEDED_USERS). Cached per user id for the
 * OBO-like window above, in the obo.ts pattern: concurrent first calls share
 * one lookup, and a lookup that FAILS answers guest (fail closed) without
 * being cached, so a directory blip never locks a member out for the window.
 */
export function createCallerGuestLookup(
  directory: DirectoryProvider,
  now: () => number = Date.now,
): CallerGuestLookup {
  const cache = new Map<string, { value: Promise<boolean>; freshUntil: number }>();
  return (auth: RequestAuth): Promise<boolean> => {
    const key = auth.user.id;
    const cached = cache.get(key);
    if (cached && cached.freshUntil > now()) return cached.value;
    const entry = {
      value: directory.getUser(key, auth).then(
        // An id the directory does not know is treated as a guest too: the
        // tenant cannot vouch for them, and Req 9 fails closed.
        (user) => (user ? user.isGuest === true : true),
        () => {
          if (cache.get(key) === entry) cache.delete(key);
          return true;
        },
      ),
      freshUntil: now() + CALLER_GUEST_TTL_MS,
    };
    cache.set(key, entry);
    return entry.value;
  };
}

/** The per-request policy reads the routes share. */
export interface DeploymentPolicy {
  /**
   * PRD 017 Req 15: the stored record, read PER CALL (one small blob read)
   * — no cache to invalidate, so an admin's save takes effect immediately.
   */
  read(): Promise<EffectiveDeploymentSettings>;
  /** PRD 017 Req 8: may this caller create a workspace, and if not, why. */
  creationFor(auth: RequestAuth): Promise<CreationDecision>;
}

export function createDeploymentPolicy(
  storage: StorageProvider,
  directory: DirectoryProvider,
  now: () => number = Date.now,
): DeploymentPolicy {
  const isGuest = createCallerGuestLookup(directory, now);
  const read = async (): Promise<EffectiveDeploymentSettings> => {
    const blob = await storage.read(DEPLOYMENT_SETTINGS_BLOB);
    return effectiveDeploymentSettings(blob?.content ?? null);
  };
  return {
    read,
    async creationFor(auth: RequestAuth): Promise<CreationDecision> {
      const { settings } = await read();
      const admin = auth.isAdmin === true;
      // PRD 017 Req 9: the directory round trip happens only when the answer
      // can matter — the `members` policy for a non-admin caller.
      const guest =
        !admin && settings.creation.policy === 'members' ? await isGuest(auth) : false;
      return decideWorkspaceCreation(settings, { id: auth.user.id, admin, guest });
    },
  };
}
