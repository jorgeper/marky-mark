import { describe, expect, it } from 'vitest';
import {
  attentionReason,
  describeConnection,
  INSTALLED_AND_WRITABLE,
  mayManageConnection,
} from '../../src/lib/workspaceConnection';
import type { WorkspaceListing } from '../../src/lib/workspaceLifecycle';

// PRD 010 Req 18: the pure half of the connection surface — what a repo-backed
// workspace's connection reads as, when the section is silent, and what a
// broken row says. No I/O and no component: the decisions are all here.

const healthy = {
  connected: true as const,
  owner: 'ada',
  repo: 'handbook',
  branch: 'main',
  health: { state: 'ok' as const },
};

const listing = (over: Partial<WorkspaceListing> = {}): WorkspaceListing => ({
  id: 'ws-1',
  name: 'Handbook',
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-02T00:00:00.000Z',
  owners: ['u-ada'],
  access: true,
  ...over,
});

describe('PRD 010 Req 18 the connection in Workspace settings', () => {
  it('U455: a repo-backed connection reads as repo, branch and root — the repo root said in words', () => {
    expect(describeConnection(healthy)).toEqual({
      repo: 'ada/handbook',
      branch: 'main',
      location: 'the repository root',
      status: INSTALLED_AND_WRITABLE,
      healthy: true,
    });
    // A chosen subdirectory is shown as the prefix it is, not as "the root".
    expect(describeConnection({ ...healthy, root: 'docs' })?.location).toBe('docs/');
    // The status is a state plus a sentence — never a response dump.
    expect(describeConnection(healthy)?.status).not.toMatch(/token|ghs_|Bearer|\{/);
  });

  it('U456: a workspace that is not repo-backed shows nothing at all — no section, no empty state', () => {
    // Req 3 stands: nothing in the client reveals which backend a
    // default-storage workspace uses, so this is silence, not a label.
    expect(describeConnection({ connected: false })).toBeNull();
    // …and so is "the payload has not arrived yet".
    expect(describeConnection(null)).toBeNull();
  });

  it('U457: an unhealthy connection is the named reason, and the split between refused and unavailable survives', () => {
    const blocked = describeConnection({
      ...healthy,
      health: { state: 'blocked', message: 'The App is not installed on ada/handbook.' },
    });
    expect(blocked).toMatchObject({ healthy: false, status: 'The App is not installed on ada/handbook.' });
    const down = describeConnection({
      ...healthy,
      health: { state: 'unavailable', message: 'GitHub is unavailable.' },
    });
    expect(down).toMatchObject({ healthy: false, status: 'GitHub is unavailable.' });
    // Repo, branch and root still read — a broken connection is still shown.
    expect(down?.repo).toBe('ada/handbook');
  });

  it('U458: the section is the workspace.settings holder’s and nobody else’s', () => {
    expect(mayManageConnection(['workspace.settings'])).toBe(true);
    expect(mayManageConnection(['workspace.members', 'workspace.roles', 'doc.edit'])).toBe(false);
    expect(mayManageConnection([])).toBe(false);
  });

  it('U459: a listing row needing attention names the reason; a healthy one adds nothing', () => {
    expect(attentionReason(listing())).toBeNull();
    expect(attentionReason(listing({ attention: 'The App is not installed there.' }))).toBe(
      'The App is not installed there.',
    );
  });
});
