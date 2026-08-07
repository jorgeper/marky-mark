/**
 * PRD 011 Req 29: the hosted flavor's summary cache — the browser half of the
 * workspace-scoped routes in `server/summaryCache.ts`. It presents the SAME
 * `SummaryCacheStore` interface the desktop file store does, so #118 and #120
 * are written once against the capability instead of branching per flavor.
 *
 * Like `createHostedLlm`, it declares NO new network call site: every request
 * goes through the `api(...)` wrapper `platform/hosted.ts` owns (same-origin,
 * bearer-authenticated), which is the one call site the bundle scan counts.
 *
 * Nothing is cached in the browser. The point of the hosted store is that the
 * WORKSPACE holds the summaries and every member reuses them, so a per-tab
 * copy would only be a way for two members to disagree about what is cached.
 */

import type {
  SummaryCacheEntry,
  SummaryCacheSize,
  SummaryCacheStore,
} from '../lib/summaryCacheStore';
import type { HostedApi } from './hostedLlm';

const EMPTY_SIZE: SummaryCacheSize = { bytes: 0, entries: 0 };

/**
 * PRD 011 Req 29: bound to ONE workspace id — the id is the scope, so a store
 * built for workspace A cannot address workspace B's entries even by mistake.
 */
export function createHostedSummaryCache(api: HostedApi, workspaceId: string): SummaryCacheStore {
  const root = `/api/workspaces/${encodeURIComponent(workspaceId)}/summary-cache`;

  return {
    async get(key) {
      try {
        const res = await api(`${root}/entry?key=${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        const body = (await res.json()) as { entry?: SummaryCacheEntry | null };
        return body.entry ?? null;
      } catch {
        // PRD 011 Req 28: an unreachable cache is a MISS. The caller
        // summarizes again — slower, never broken.
        return null;
      }
    },

    async put(entry) {
      try {
        await api(`${root}/entry`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
      } catch {
        // A summary that could not be stored is a summary that will be
        // regenerated. Nothing the user asked for has failed.
      }
    },

    async size() {
      try {
        const res = await api(root);
        if (!res.ok) return EMPTY_SIZE;
        return (await res.json()) as SummaryCacheSize;
      } catch {
        return EMPTY_SIZE;
      }
    },

    async clear() {
      // Deliberately NOT swallowed: Clear is a user's explicit act (PRD 011
      // Req 30), and #120 has to be able to tell them it did not happen.
      const res = await api(root, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The summary cache could not be cleared (HTTP ${res.status}).`);
      }
    },
  };
}
