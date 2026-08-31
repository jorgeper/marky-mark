import { describe, expect, it } from 'vitest';
import {
  CREATE_REFUSAL_HINTS,
  DEFAULT_DEPLOYMENT_SETTINGS,
  DEPLOYMENT_PREFIX,
  DEPLOYMENT_SETTINGS_BLOB,
  FAIL_CLOSED_DEPLOYMENT_SETTINGS,
  decideWorkspaceCreation,
  effectiveDeploymentSettings,
  filterListedWorkspaces,
  parseDeploymentSettings,
  serializeDeploymentSettings,
  type DeploymentSettings,
} from '../../src/lib/deploymentSettings';

// PRD 017 Reqs 6–8+10+11: the deployment-settings record and the two policy
// decisions — pure functions shared by server enforcement and client
// affordances, proven here with no I/O.

describe('PRD 017 §6+7 deployment settings record', () => {
  const full: DeploymentSettings = {
    version: 1,
    creation: {
      policy: 'restricted',
      allow: [{ id: 'mock-grace', displayName: 'Grace Hopper' }, { id: 'mock-alan' }],
    },
    listing: { policy: 'members' },
  };

  it('U963: a version-1 record round-trips through serialize → parse unchanged', () => {
    const parsed = parseDeploymentSettings(serializeDeploymentSettings(full));
    expect(parsed).toEqual({ ok: true, settings: full });
    // The blob lives at the one reserved path (Req 6).
    expect(DEPLOYMENT_SETTINGS_BLOB).toBe('deployment/settings.json');
    expect(DEPLOYMENT_SETTINGS_BLOB.startsWith(DEPLOYMENT_PREFIX)).toBe(true);
  });

  it('U964: an absent blob yields the defaults — everyone / empty allow / everyone (today’s behaviour)', () => {
    const effective = effectiveDeploymentSettings(null);
    expect(effective.settings).toEqual(DEFAULT_DEPLOYMENT_SETTINGS);
    expect(effective.settings.creation).toEqual({ policy: 'everyone', allow: [] });
    expect(effective.settings.listing).toEqual({ policy: 'everyone' });
    expect(effective.error).toBeUndefined();
  });

  it('U965: an unreadable blob fails CLOSED — restricted creation, members listing — and carries the parse error', () => {
    const bad = [
      'not json at all{',
      JSON.stringify({ version: 2, creation: full.creation, listing: full.listing }),
      JSON.stringify({ version: 1, creation: { policy: 'anyone', allow: [] }, listing: { policy: 'everyone' } }),
      JSON.stringify({ version: 1, creation: { policy: 'everyone', allow: [] }, listing: { policy: 'admins' } }),
      JSON.stringify({ version: 1, creation: { policy: 'restricted', allow: [{ name: 'no id' }] }, listing: { policy: 'members' } }),
      JSON.stringify([1, 2, 3]),
    ];
    for (const blob of bad) {
      const parsed = parseDeploymentSettings(blob);
      expect(parsed.ok, blob).toBe(false);
      const effective = effectiveDeploymentSettings(blob);
      expect(effective.settings, blob).toEqual(FAIL_CLOSED_DEPLOYMENT_SETTINGS);
      // Req 7: the error rides along so GET /api/admin/settings (the
      // Management sub-issue) can report it later.
      expect(effective.error, blob).toBeTruthy();
    }
    expect(FAIL_CLOSED_DEPLOYMENT_SETTINGS.creation).toEqual({ policy: 'restricted', allow: [] });
    expect(FAIL_CLOSED_DEPLOYMENT_SETTINGS.listing).toEqual({ policy: 'members' });
  });
});

describe('PRD 017 §8 creation-policy decision', () => {
  const settings = (policy: DeploymentSettings['creation']['policy']): DeploymentSettings => ({
    version: 1,
    creation: { policy, allow: [{ id: 'mock-grace', displayName: 'Grace Hopper' }] },
    listing: { policy: 'everyone' },
  });
  const member = { id: 'mock-ada', admin: false, guest: false };
  const guest = { id: 'mock-mary', admin: false, guest: true };
  const admin = { id: 'mock-katherine', admin: true, guest: false };
  const allowListed = { id: 'mock-grace', admin: false, guest: false };

  it('U966: everyone admits any signed-in caller; members refuses guests by name; restricted admits only admins and the allow list', () => {
    // everyone — any signed-in user, guests included (PRD 007 Req 10).
    for (const caller of [member, guest, admin, allowListed]) {
      expect(decideWorkspaceCreation(settings('everyone'), caller)).toEqual({ allowed: true });
    }
    // members — tenant members yes, guests no, with the refusal the client
    // words its hint from (Req 3).
    expect(decideWorkspaceCreation(settings('members'), member)).toEqual({ allowed: true });
    expect(decideWorkspaceCreation(settings('members'), guest)).toEqual({ allowed: false, refusal: 'guest' });
    // restricted — the allow list and admins alone; everyone else hears
    // 'restricted', a guest on the allow list is admitted (the list is the
    // grant, not membership).
    expect(decideWorkspaceCreation(settings('restricted'), allowListed)).toEqual({ allowed: true });
    expect(decideWorkspaceCreation(settings('restricted'), { ...allowListed, guest: true })).toEqual({ allowed: true });
    expect(decideWorkspaceCreation(settings('restricted'), member)).toEqual({ allowed: false, refusal: 'restricted' });
    expect(decideWorkspaceCreation(settings('restricted'), guest)).toEqual({ allowed: false, refusal: 'restricted' });
    // Admins create under EVERY policy (Req 8).
    for (const policy of ['everyone', 'members', 'restricted'] as const) {
      expect(decideWorkspaceCreation(settings(policy), admin)).toEqual({ allowed: true });
      expect(decideWorkspaceCreation(settings(policy), { ...admin, guest: true })).toEqual({ allowed: true });
    }
    // Both refusals have a one-line hint for the start page (Req 10).
    expect(CREATE_REFUSAL_HINTS.guest).toMatch(/guest/i);
    expect(CREATE_REFUSAL_HINTS.restricted).toMatch(/deployment admin/i);
  });
});

describe('PRD 017 §11 listing-policy filter', () => {
  it('U967: members omits exactly the rows the caller cannot open, row shape untouched; everyone returns every row', () => {
    const rows = [
      { id: 'a', name: 'Mine', access: true },
      { id: 'b', name: 'Theirs', access: false },
      { id: 'c', name: 'Shared', access: true },
    ];
    expect(filterListedWorkspaces('everyone', rows)).toEqual(rows);
    // Callers resolve `access` without the Req 4 admin union, so an admin's
    // non-member rows carry access false and this same filter drops them —
    // the admin's ordinary listing is filtered like anyone else's (Req 11).
    expect(filterListedWorkspaces('members', rows)).toEqual([rows[0], rows[2]]);
  });
});
