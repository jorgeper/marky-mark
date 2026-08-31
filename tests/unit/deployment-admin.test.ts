import { describe, expect, it } from 'vitest';
import {
  adminWorkspaceTotals,
  aggregateWorkspaceBlobStats,
  explicitMembershipCounts,
  filterAdminUsers,
  filterAdminWorkspaces,
  formatByteSize,
  type AdminUserRow,
  type AdminWorkspaceRow,
  type ListedBlobStat,
} from '../../src/lib/deploymentAdmin';
import {
  addWorkspaceMember,
  createWorkspaceManifest,
  isViewingAsAdminOnly,
  setEveryoneAccess,
} from '../../src/lib/hostedWorkspace';

// PRD 017 Req 16+19: the Management view's pure logic — the one-listing
// statistics aggregation and the sorting/filtering/totals the Workspaces and
// People tabs render (src/lib/deploymentAdmin.ts).

const blob = (path: string, size: number, lastModified: string): ListedBlobStat => ({
  path,
  size,
  lastModified,
});

const row = (over: Partial<AdminWorkspaceRow> & { id: string }): AdminWorkspaceRow => ({
  name: over.id,
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  owners: [],
  memberIds: [],
  everyone: { enabled: false, role: 'Viewer' },
  fileCount: 0,
  totalBytes: 0,
  ...over,
});

describe('PRD 017 §5 admin banner predicate', () => {
  it('U976: the banner shows exactly when an admin holds no grant of their own — membership or everyone-access ends it, and non-admins never see it', () => {
    const manifest = createWorkspaceManifest('Ops', 'mock-ada', '2026-08-01T00:00:00.000Z');
    const admin = { id: 'mock-katherine', admin: true };
    // A non-member admin of a members-only workspace: viewing purely through
    // the Req 4 implicit union, so the banner shows.
    expect(isViewingAsAdminOnly(manifest, admin)).toBe(true);
    // The same manifest grants a non-admin nothing — but the banner is about
    // being an admin, so it never shows for them.
    expect(isViewingAsAdminOnly(manifest, { id: 'mock-grace', admin: false })).toBe(false);
    // Everyone-access grants the admin a role like anyone else: no banner.
    const open = setEveryoneAccess(manifest, { enabled: true });
    if (!open.ok) throw new Error(open.error);
    expect(isViewingAsAdminOnly(open.manifest, admin)).toBe(false);
    // Explicit membership (adding themselves in People) ends it too.
    const joined = addWorkspaceMember(manifest, { id: 'mock-katherine', role: 'Owner' });
    if (!joined.ok) throw new Error(joined.error);
    expect(isViewingAsAdminOnly(joined.manifest, admin)).toBe(false);
    // An admin who IS a member sees no banner even with everyone-access off.
    expect(isViewingAsAdminOnly(joined.manifest, { id: 'mock-ada', admin: true })).toBe(false);
  });
});

describe('PRD 017 §16 statistics aggregation', () => {
  it('U971: one listing groups by workspace prefix — file count is blobs under files/, size is every blob, and a corrupt-manifest workspace still aggregates', () => {
    const stats = aggregateWorkspaceBlobStats([
      // Workspace a: manifest + two documents + a sidecar + a summary-cache
      // blob. Only the files/ blobs count as files; every byte counts.
      blob('workspaces/a/manifest.json', 100, '2026-08-01T10:00:00.000Z'),
      blob('workspaces/a/files/notes/doc.md', 2000, '2026-08-02T10:00:00.000Z'),
      blob('workspaces/a/files/doc.md.comments.json', 300, '2026-08-03T10:00:00.000Z'),
      blob('workspaces/a/files/img/shot.png', 5000, '2026-08-01T09:00:00.000Z'),
      blob('workspaces/a/summaries/k1.json', 400, '2026-07-30T10:00:00.000Z'),
      // Workspace b: a corrupt manifest is just another id here — its blob
      // figures aggregate the same way (the flagged row is the route's job).
      blob('workspaces/b/manifest.json', 50, '2026-08-05T10:00:00.000Z'),
      blob('workspaces/b/files/only.md', 10, '2026-08-04T10:00:00.000Z'),
      // Blobs outside the prefix (or directly under it) name no workspace.
      blob('users/mock-ada/settings.json', 999, '2026-08-06T10:00:00.000Z'),
      blob('workspaces/stray.json', 7, '2026-08-06T10:00:00.000Z'),
    ]);
    expect([...stats.keys()].sort()).toEqual(['a', 'b']);
    expect(stats.get('a')).toEqual({
      fileCount: 3,
      totalBytes: 7800,
      newestModified: '2026-08-03T10:00:00.000Z',
    });
    expect(stats.get('b')).toEqual({
      fileCount: 1,
      totalBytes: 60,
      newestModified: '2026-08-05T10:00:00.000Z',
    });
    expect(aggregateWorkspaceBlobStats([]).size).toBe(0);
  });

  it('U972: the Workspaces tab sorts modified-newest-first with corrupt rows placed by their timestamp, filters fuzzily, and totals the header', () => {
    const rows = [
      row({ id: 'old', name: 'Old notes', modified: '2026-01-01T00:00:00.000Z', fileCount: 2, totalBytes: 10 }),
      row({ id: 'new', name: 'New plans', modified: '2026-08-01T00:00:00.000Z', fileCount: 3, totalBytes: 20 }),
      // A corrupt row has no manifest name — it matches on its id and sorts
      // by the newest blob write the route stamped into `modified`.
      row({ id: 'broken', name: null, modified: '2026-05-01T00:00:00.000Z', error: 'manifest is not valid JSON', fileCount: 1, totalBytes: 5 }),
      row({ id: 'timeless', name: 'No blobs at all', modified: null }),
    ];
    expect(filterAdminWorkspaces('', rows).map((w) => w.id)).toEqual(['new', 'broken', 'old', 'timeless']);
    expect(filterAdminWorkspaces('notes', rows).map((w) => w.id)).toEqual(['old']);
    expect(filterAdminWorkspaces('broken', rows).map((w) => w.id)).toEqual(['broken']);
    expect(adminWorkspaceTotals(rows)).toEqual({ workspaces: 4, files: 6, bytes: 35 });
    // Req 16: byte figures phrased for the table — exact below 1 KB, so a
    // small workspace never reads as empty.
    expect(formatByteSize(35)).toBe('35 B');
    expect(formatByteSize(2048)).toBe('2 KB');
    expect(formatByteSize(3 * 1024 * 1024 + 512 * 1024)).toBe('3.5 MB');
  });
});

describe('PRD 017 §19 People tab derivations', () => {
  it('U973: explicit-membership counts come from the loaded manifests, and users sort by display name with the fuzzy filter on top', () => {
    const counts = explicitMembershipCounts([
      row({ id: 'a', memberIds: ['mock-ada', 'mock-grace'] }),
      row({ id: 'b', memberIds: ['mock-ada'] }),
      // A corrupt row contributes no memberships — it has none to read.
      row({ id: 'c', memberIds: [], error: 'the workspace has no manifest' }),
    ]);
    expect(counts.get('mock-ada')).toBe(2);
    expect(counts.get('mock-grace')).toBe(1);
    expect(counts.get('mock-alan')).toBeUndefined();

    const user = (id: string, displayName: string, admin = false): AdminUserRow => ({
      id,
      displayName,
      username: id.replace('mock-', ''),
      admin,
    });
    const users = [
      user('mock-mary', 'Mary Jackson'),
      user('mock-ada', 'Ada Lovelace'),
      user('mock-katherine', 'Katherine Johnson', true),
    ];
    expect(filterAdminUsers('', users).map((u) => u.id)).toEqual([
      'mock-ada',
      'mock-katherine',
      'mock-mary',
    ]);
    expect(filterAdminUsers('jack', users).map((u) => u.displayName)).toEqual(['Mary Jackson']);
  });
});
