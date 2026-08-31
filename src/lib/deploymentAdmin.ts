/**
 * PRD 017 Reqs 14+16+19: the pure logic behind the Management view — the row
 * shapes the /api/admin routes answer, the one-listing statistics
 * aggregation, and the sorting / filtering / totals the Workspaces and
 * People tabs render. No I/O and no DOM (the hostedWorkspace.ts pattern):
 * the server aggregates and the client renders with the SAME functions, so
 * the figures a test pins here are the figures the tab shows.
 */

import { fuzzyFilter } from './fuzzy.ts';

/** One listed blob as the storage seam reports it (server FileStat-shaped). */
export interface ListedBlobStat {
  path: string;
  size: number;
  /** ISO 8601 last-modified timestamp. */
  lastModified: string;
}

/** PRD 017 Req 16: what one workspace's blobs add up to. */
export interface WorkspaceBlobStats {
  /** Blobs under the workspace's `files/` prefix — its documents and assets. */
  fileCount: number;
  /** Every blob under the workspace prefix: manifest, sidecars, caches too. */
  totalBytes: number;
  /** The newest blob write, standing in for `modified` on a corrupt row. */
  newestModified: string | null;
}

/**
 * PRD 017 Req 16: the statistics aggregation — ONE `storage.list` of the
 * workspaces prefix, grouped by workspace id. *File count* is the number of
 * blobs under `files/`; *size* is the sum of every blob under the prefix
 * (manifest, comment sidecars, pasted images and the summary cache alike).
 * A workspace whose manifest is corrupt is just another id here — its blob
 * figures aggregate the same way, which is what lets its row still appear.
 */
export function aggregateWorkspaceBlobStats(
  blobs: readonly ListedBlobStat[],
  prefix = 'workspaces/',
): Map<string, WorkspaceBlobStats> {
  const stats = new Map<string, WorkspaceBlobStats>();
  for (const blob of blobs) {
    if (!blob.path.startsWith(prefix)) continue;
    const rest = blob.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) continue; // a stray blob directly under the prefix names no workspace
    const id = rest.slice(0, slash);
    const rel = rest.slice(slash + 1);
    const entry = stats.get(id) ?? { fileCount: 0, totalBytes: 0, newestModified: null };
    if (rel.startsWith('files/')) entry.fileCount += 1;
    entry.totalBytes += blob.size;
    // ISO 8601 timestamps compare chronologically as plain strings.
    if (entry.newestModified === null || blob.lastModified > entry.newestModified) {
      entry.newestModified = blob.lastModified;
    }
    stats.set(id, entry);
  }
  return stats;
}

/**
 * PRD 017 Req 16: one row of `GET /api/admin/workspaces` — every workspace
 * in the deployment, whether or not the caller is a member. The manifest
 * fields are null on a corrupt row (`error` says why), while the blob
 * figures are always present: Management is where an operator finds broken
 * things, so a workspace that stopped parsing still shows its footprint.
 */
export interface AdminWorkspaceRow {
  id: string;
  name: string | null;
  created: string | null;
  /** Manifest `modified`; a corrupt row carries its newest blob write instead. */
  modified: string | null;
  /** Owner refs with their manifest display-name snapshots, for `resolveMembers`. */
  owners: Array<{ id: string; displayName?: string }>;
  /** Explicit member ids — the People tab derives per-user counts from these. */
  memberIds: string[];
  everyone: { enabled: boolean; role: string } | null;
  fileCount: number;
  totalBytes: number;
  /** Present exactly when the manifest is corrupt or missing (Req 16 flag). */
  error?: string;
}

/**
 * PRD 017 Req 16: the Workspaces tab's order and filter — modified-newest-
 * first (a row with no timestamp at all sorts last), then the existing fuzzy
 * matcher over the name (a corrupt row matches on its id, the only name it
 * has). An empty query keeps every row.
 */
export function filterAdminWorkspaces(
  query: string,
  rows: readonly AdminWorkspaceRow[],
): AdminWorkspaceRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.modified === b.modified) return 0;
    if (a.modified === null) return 1;
    if (b.modified === null) return -1;
    return a.modified > b.modified ? -1 : 1;
  });
  return fuzzyFilter(query, sorted, (w) => w.name ?? w.id);
}

/** PRD 017 Req 16: the totals header — workspaces, files, bytes. */
export interface AdminWorkspaceTotals {
  workspaces: number;
  files: number;
  bytes: number;
}

export function adminWorkspaceTotals(rows: readonly AdminWorkspaceRow[]): AdminWorkspaceTotals {
  return {
    workspaces: rows.length,
    files: rows.reduce((sum, row) => sum + row.fileCount, 0),
    bytes: rows.reduce((sum, row) => sum + row.totalBytes, 0),
  };
}

/**
 * PRD 017 Req 16: byte figures phrased for the table and the totals header.
 * Exact bytes below 1 KB (a small workspace must not read as "0 KB"), whole
 * KB below 1 MB, one-decimal MB beyond — the summary-cache label's scale,
 * restated here so tests pin the exact strings the tab renders.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * PRD 017 Req 19: one row of `GET /api/admin/users` — the directory's entry
 * plus whether the id is in `MM_ADMINS` (the Admin badge; the Guest badge
 * rides the existing `isGuest` flag).
 */
export interface AdminUserRow {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  isGuest?: boolean;
  admin: boolean;
}

/**
 * PRD 017 Req 19: each user's explicit-membership workspace count, derived
 * from the manifests the Workspaces tab already loads — never a second
 * listing. Everyone-access grants count for nobody: the column reports
 * explicit membership alone.
 */
export function explicitMembershipCounts(
  rows: readonly AdminWorkspaceRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const id of row.memberIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * PRD 017 Req 19: the People tab's order and filter — display name (the
 * username breaking ties), then the same fuzzy matcher the Workspaces tab
 * uses, over the display name.
 */
export function filterAdminUsers(query: string, users: readonly AdminUserRow[]): AdminUserRow[] {
  const sorted = [...users].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username),
  );
  return fuzzyFilter(query, sorted, (u) => u.displayName);
}
