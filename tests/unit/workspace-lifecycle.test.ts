import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVERYONE_ROLE,
  buildNewWorkspaceManifest,
  createWorkspaceManifest,
  isKnownRoleName,
  resolvePermissions,
  workspaceOwnerIds,
  type WorkspaceManifest,
} from '../../src/lib/hostedWorkspace';
import type { MemberEntry } from '../../src/lib/membership';
import { UNIQUE_NAME_MAX_LENGTH, uniqueNameProblem } from '../../src/lib/workspaceNames';
import {
  OPEN_WORKSPACE_ROW_CAP,
  URL_PREVIEW_PLACEHOLDER,
  deleteConfirmationMatches,
  deleteOffered,
  emptyNewWorkspaceForm,
  filterWorkspaces,
  formatOwnerNames,
  isUniqueNameError,
  noAccessMessage,
  normalizeUrlNameTyping,
  orderByRecentUse,
  settleUrlName,
  urlNamePreview,
  validateNewWorkspaceForm,
  visibleWorkspaces,
  workspaceRowBadge,
  type WorkspaceListing,
} from '../../src/lib/workspaceLifecycle';

const NOW = '2026-08-06T10:00:00.000Z';

const listing = (over: Partial<WorkspaceListing> & { id: string; name: string }): WorkspaceListing => ({
  created: NOW,
  modified: NOW,
  owners: [],
  access: true,
  // PRD 024 Req 5: every row carries the former-name history, empty by default.
  formerNames: [],
  ...over,
});

const member = (id: string, displayName: string, resolved = true): MemberEntry => ({
  id,
  displayName,
  username: displayName.toLowerCase(),
  resolved,
});

describe('PRD 007 Req 10: the create-workspace request', () => {
  it('U277: a name-only body still creates the creator-as-sole-Owner manifest', () => {
    const built = buildNewWorkspaceManifest({ name: '  Design docs  ' }, 'mock-ada', NOW);
    expect(built.ok).toBe(true);
    const manifest = (built as { manifest: WorkspaceManifest }).manifest;
    // The name is trimmed and the legacy shape is byte-for-byte what
    // createWorkspaceManifest already produced — existing callers unchanged.
    expect(manifest).toEqual(createWorkspaceManifest('Design docs', 'mock-ada', NOW));
  });

  it('U278: an empty or whitespace-only name is rejected, and so is a non-object body', () => {
    for (const body of [{ name: '' }, { name: '   ' }, { name: 42 }, {}]) {
      const built = buildNewWorkspaceManifest(body, 'mock-ada', NOW);
      expect(built).toEqual({ ok: false, error: 'name must be a non-empty string' });
    }
    expect(buildNewWorkspaceManifest('nope', 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'request body must be a JSON object',
    });
  });

  it('U279: initial members are granted their roles, with the creator retained as Owner', () => {
    const built = buildNewWorkspaceManifest(
      {
        name: 'Shared',
        members: [
          { id: 'mock-grace', role: 'Editor' },
          { id: 'mock-alan', role: 'Viewer' },
        ],
      },
      'mock-ada',
      NOW,
    );
    expect(built.ok).toBe(true);
    expect((built as { manifest: WorkspaceManifest }).manifest.members).toEqual([
      { id: 'mock-ada', role: 'Owner' },
      { id: 'mock-grace', role: 'Editor' },
      { id: 'mock-alan', role: 'Viewer' },
    ]);
  });

  it('U280: a body that tries to demote the creator (or list them twice) cannot', () => {
    const built = buildNewWorkspaceManifest(
      { name: 'Shared', members: [{ id: 'mock-ada', role: 'Viewer' }] },
      'mock-ada',
      NOW,
    );
    const manifest = (built as { manifest: WorkspaceManifest }).manifest;
    expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner' }]);
    expect(resolvePermissions(manifest, 'mock-ada').has('workspace.delete')).toBe(true);
  });

  it('U281: an unknown role name is an error, on a member and on everyone-access alike', () => {
    expect(
      buildNewWorkspaceManifest({ name: 'W', members: [{ id: 'x', role: 'Superuser' }] }, 'mock-ada', NOW),
    ).toEqual({ ok: false, error: 'unknown role "Superuser"' });
    expect(
      buildNewWorkspaceManifest({ name: 'W', everyone: { enabled: true, role: 'Superuser' } }, 'mock-ada', NOW),
    ).toEqual({ ok: false, error: 'unknown role "Superuser"' });
    // Malformed member/everyone shapes are named too, never coerced.
    expect(buildNewWorkspaceManifest({ name: 'W', members: 'grace' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'members must be an array',
    });
    expect(buildNewWorkspaceManifest({ name: 'W', everyone: { enabled: 'yes' } }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'everyone must be {enabled: boolean, role?: string}',
    });
  });

  it('U282: everyone-access defaults to Viewer (PRD 007 Req 16) and honours an explicit role', () => {
    const dflt = buildNewWorkspaceManifest({ name: 'W', everyone: { enabled: true } }, 'mock-ada', NOW);
    expect((dflt as { manifest: WorkspaceManifest }).manifest.everyone).toEqual({ enabled: true, role: 'Viewer' });
    const explicit = buildNewWorkspaceManifest(
      { name: 'W', everyone: { enabled: true, role: 'Commenter' } },
      'mock-ada',
      NOW,
    );
    expect((explicit as { manifest: WorkspaceManifest }).manifest.everyone).toEqual({
      enabled: true,
      role: 'Commenter',
    });
  });

  it('U283: role validation spans built-ins and the manifest own custom roles', () => {
    const manifest: WorkspaceManifest = {
      ...createWorkspaceManifest('W', 'mock-ada', NOW),
      roles: [{ name: 'Reviewer', permissions: ['doc.read'] }],
    };
    expect(isKnownRoleName(manifest, 'Owner')).toBe(true);
    expect(isKnownRoleName(manifest, 'Reviewer')).toBe(true);
    expect(isKnownRoleName(manifest, 'Auditor')).toBe(false);
  });
});

describe('PRD 007 Req 10 + PRD 020 Req 2 (amended by PRD 026 Req 4+6): the New Workspace form', () => {
  it('U284: a missing or malformed unique name blocks submission with a message naming the problem', () => {
    // PRD 026 Req 6: with a display name present, an empty URL name is the
    // stop — phrased in the dialog's own words, not the shared rule's.
    expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name: 'Design docs' })).toEqual({
      ok: false,
      error: 'A URL name is required.',
    });
    // Whitespace is outside the charset (never silently trimmed away). PRD 026
    // Req 1: the message is the strict lowercase-dash rule's own. (The dialog
    // normalises typing so this state is unreachable from the keyboard, but
    // the pure rule still refuses it for any caller that bypasses the field.)
    const spaced = validateNewWorkspaceForm({
      ...emptyNewWorkspaceForm(),
      name: 'Design docs',
      uniqueName: 'design docs',
    });
    expect(spaced).toEqual({
      ok: false,
      error: 'A unique name may only use lowercase letters, numbers and single dashes between them.',
    });
    // PRD 026 Req 1: PRD 020's wider charset no longer submits from the form.
    const cased = validateNewWorkspaceForm({
      ...emptyNewWorkspaceForm(),
      name: 'Design docs',
      uniqueName: 'Design_Docs',
    });
    expect(cased).toEqual({
      ok: false,
      error: 'A unique name may only use lowercase letters, numbers and single dashes between them.',
    });
  });

  it('U285: a valid form becomes the POST body — unique name, trimmed friendly name, members, everyone-access', () => {
    const result = validateNewWorkspaceForm({
      uniqueName: 'design-docs',
      name: '  Design docs ',
      members: [{ id: 'mock-grace', role: 'Editor' }],
      everyoneEnabled: true,
      everyoneRole: 'Commenter',
    });
    expect(result).toEqual({
      ok: true,
      request: {
        uniqueName: 'design-docs',
        name: 'Design docs',
        members: [{ id: 'mock-grace', role: 'Editor' }],
        everyone: { enabled: true, role: 'Commenter' },
      },
    });
    // A fresh form defaults everyone-access to off at Viewer (PRD 007 Req 16).
    expect(emptyNewWorkspaceForm()).toEqual({
      uniqueName: '',
      name: '',
      members: [],
      everyoneEnabled: false,
      everyoneRole: DEFAULT_EVERYONE_ROLE,
    });
  });

  it('U1043: a blank display name is refused even beside a valid URL name, and reserved names are refused before submit', () => {
    // PRD 026 Req 4: the display name is required — the PRD 020 "blank means
    // the URL name is the display" fallback is gone from the form. Whitespace
    // alone is blank.
    expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), uniqueName: 'design-docs' })).toEqual({
      ok: false,
      error: 'A display name is required.',
    });
    expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name: '   ', uniqueName: 'design-docs' })).toEqual({
      ok: false,
      error: 'A display name is required.',
    });
    // PRD 020 Req 1: reserved words are refused client-side with the same
    // message the server would answer. (PRD 026 Req 1: a capitalised
    // `Scratchpad` now trips the charset rule first, so the reserved refusal
    // is reached with the lowercase form.)
    expect(
      validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name: 'Scratch', uniqueName: 'scratchpad' }),
    ).toEqual({
      ok: false,
      error: '"scratchpad" is a reserved name.',
    });
  });

  it('U1323: PRD 026 Req 4+6 — validation stops at the first failure in dialog order: an empty display name wins over an empty URL name', () => {
    expect(validateNewWorkspaceForm(emptyNewWorkspaceForm())).toEqual({
      ok: false,
      error: 'A display name is required.',
    });
    // And an empty URL name wins over what the reserved/charset rule would
    // have said about it: the shared rule is only consulted on a non-empty
    // settled value.
    expect(validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name: 'Docs', uniqueName: '-' })).toEqual({
      ok: false,
      error: 'A URL name is required.',
    });
  });

  it('U1324: PRD 026 Req 6 — the one trailing dash typing keeps is stripped at submit, so `foo-` submits as `foo`', () => {
    const result = validateNewWorkspaceForm({ ...emptyNewWorkspaceForm(), name: 'Foo', uniqueName: 'foo-' });
    expect(result).toEqual({
      ok: true,
      request: { uniqueName: 'foo', name: 'Foo', members: [], everyone: { enabled: false, role: DEFAULT_EVERYONE_ROLE } },
    });
    expect(settleUrlName('foo-')).toBe('foo');
    expect(settleUrlName('foo')).toBe('foo');
    expect(settleUrlName('')).toBe('');
  });

  it('U1325: PRD 026 Req 6 — the typing normaliser is the slugifier plus one trailing dash while a separator is being typed', () => {
    const table: Array<[string, string]> = [
      ['Foo Bar', 'foo-bar'],
      ['foo--bar', 'foo-bar'],
      ['Team_Docs', 'team-docs'],
      // The mid-typing states: one dash kept when the raw text ended in a
      // separator, whatever the separator was.
      ['foo-', 'foo-'],
      ['foo ', 'foo-'],
      ['foo--', 'foo-'],
      ['foo!', 'foo-'],
      // Nothing to hang a dash on: leading separators go, and a value that is
      // only separators is empty.
      ['-foo', 'foo'],
      ['-', ''],
      ['!!!', ''],
      ['', ''],
      ['日本語', ''],
    ];
    for (const [raw, expected] of table) {
      expect(normalizeUrlNameTyping(raw), JSON.stringify(raw)).toBe(expected);
    }
    // Every non-empty result settles into a name the shared rule accepts.
    for (const [raw] of table) {
      const settled = settleUrlName(normalizeUrlNameTyping(raw));
      if (settled !== '') expect(uniqueNameProblem(settled), JSON.stringify(raw)).toBeNull();
    }
  });

  it('U1326: PRD 026 Req 6 — the trailing dash is not kept once the slug has reached the length limit', () => {
    const full = 'x'.repeat(UNIQUE_NAME_MAX_LENGTH);
    // A separator after a full-length slug: the slug is clamped and the dash
    // has no room, so the field never exceeds the limit.
    expect(normalizeUrlNameTyping(`${full}-`)).toBe(full);
    expect(normalizeUrlNameTyping(`${full}xyz `)).toBe(full);
    // One short of the limit still has room for the dash.
    const almost = 'x'.repeat(UNIQUE_NAME_MAX_LENGTH - 1);
    expect(normalizeUrlNameTyping(`${almost}-`)).toBe(`${almost}-`);
    expect(normalizeUrlNameTyping(`${almost}-`)).toHaveLength(UNIQUE_NAME_MAX_LENGTH);
  });

  it('U1327: PRD 026 Req 7 — the address preview is the origin plus the share-link path, or an ellipsis placeholder while the name is empty', () => {
    expect(urlNamePreview('https://docs.example', 'team-docs')).toBe('https://docs.example/team-docs');
    expect(urlNamePreview('https://docs.example', '')).toBe('https://docs.example/…');
    expect(URL_PREVIEW_PLACEHOLDER).toBe('…');
    // The same helper the share-link primitive uses: segments are
    // percent-encoded the same way (a stored grandfathered name can carry
    // characters the strict rule no longer admits).
    expect(urlNamePreview('http://localhost:4173', 'a b')).toBe('http://localhost:4173/a%20b');
  });
});

describe('PRD 007 Req 11: the Open Workspace list', () => {
  const items = [
    listing({ id: 'a', name: 'Design docs', modified: '2026-08-01T00:00:00.000Z' }),
    listing({ id: 'b', name: 'Release notes', modified: '2026-08-05T00:00:00.000Z' }),
    listing({ id: 'c', name: 'Design system', modified: '2026-08-03T00:00:00.000Z', access: false }),
  ];

  it('U286: an empty query lists everything, most recently modified first', () => {
    expect(filterWorkspaces('', items).map((w) => w.id)).toEqual(['b', 'c', 'a']);
    expect(filterWorkspaces('   ', items).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('U287: the query is a fuzzy subsequence match over the name, inaccessible ones included', () => {
    // Every workspace in the deployment is listable — access decides what
    // choosing one does, never whether it appears.
    expect(filterWorkspaces('desgn', items).map((w) => w.id).sort()).toEqual(['a', 'c']);
    expect(filterWorkspaces('rel', items).map((w) => w.id)).toEqual(['b']);
    expect(filterWorkspaces('zzz', items)).toEqual([]);
  });

  it('U288: the access flag on the row is what distinguishes open from ask-for-access', () => {
    expect(items.filter((w) => w.access).map((w) => w.id)).toEqual(['a', 'b']);
    expect(items.filter((w) => !w.access).map((w) => w.id)).toEqual(['c']);
  });
});

// PRD 007 Req 10/11 (issue #252): the dialog's list area is a fixed height
// sized for OPEN_WORKSPACE_ROW_CAP rows, so what it renders is capped ahead of
// the JSX. `filterWorkspaces` still answers the whole filtered listing (U286 /
// U287); the cap is the separate seam layered over it.
describe('PRD 007 Req 11 (issue #252): the Open Workspace list is capped at the newest few', () => {
  const at = (id: string, day: number): WorkspaceListing =>
    listing({ id, name: `Workspace ${id}`, modified: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z` });
  // Eight workspaces, deliberately out of order, so truncation cannot pass by
  // accident on an already-sorted input.
  const many = [at('a', 1), at('h', 8), at('c', 3), at('f', 6), at('b', 2), at('g', 7), at('d', 4), at('e', 5)];

  it('U1196: an over-cap listing truncates to the cap, most recently modified first', () => {
    expect(OPEN_WORKSPACE_ROW_CAP).toBe(5);
    expect(visibleWorkspaces('', many).map((w) => w.id)).toEqual(['h', 'g', 'f', 'e', 'd']);
    expect(visibleWorkspaces('   ', many)).toHaveLength(OPEN_WORKSPACE_ROW_CAP);
    // The unfiltered seam still answers everything — the cap is layered over it.
    expect(filterWorkspaces('', many)).toHaveLength(many.length);
  });

  it('U1197: an under-cap listing is returned whole, still newest first', () => {
    expect(visibleWorkspaces('', many.slice(0, 3)).map((w) => w.id)).toEqual(['h', 'c', 'a']);
    expect(visibleWorkspaces('', [])).toEqual([]);
  });

  it('U1198: a query matches across the whole listing and still truncates to the cap', () => {
    // Every name matches "wor", so the query narrows nothing: the cap is what
    // bounds the rows, and a search can never grow the dialog.
    expect(visibleWorkspaces('wor', many)).toHaveLength(OPEN_WORKSPACE_ROW_CAP);
    // A query that matches fewer than the cap keeps them all, best first.
    expect(visibleWorkspaces('workspace b', many).map((w) => w.id)).toEqual(['b']);
  });
});

describe('PRD 007 Req 11: naming the Owners of an inaccessible workspace', () => {
  it('U289: owner ids come from the Owner-role members', () => {
    const manifest: WorkspaceManifest = {
      ...createWorkspaceManifest('W', 'mock-ada', NOW),
      members: [
        { id: 'mock-ada', role: 'Owner' },
        { id: 'mock-grace', role: 'Editor' },
        { id: 'mock-alan', role: 'Owner' },
      ],
    };
    expect(workspaceOwnerIds(manifest)).toEqual(['mock-ada', 'mock-alan']);
  });

  it('U290: with no Owner-role member, anyone who can grant membership is named instead', () => {
    const manifest: WorkspaceManifest = {
      ...createWorkspaceManifest('W', 'mock-ada', NOW),
      members: [
        { id: 'mock-grace', role: 'Steward' },
        { id: 'mock-alan', role: 'Editor' },
      ],
      roles: [{ name: 'Steward', permissions: ['doc.read', 'workspace.members'] }],
    };
    expect(workspaceOwnerIds(manifest)).toEqual(['mock-grace']);
  });

  it('U291: display names join naturally, and an unresolvable owner falls back to its identifier', () => {
    expect(formatOwnerNames([])).toBe('');
    expect(formatOwnerNames([member('a', 'Ada Lovelace')])).toBe('Ada Lovelace');
    expect(formatOwnerNames([member('a', 'Ada Lovelace'), member('g', 'Grace Hopper')])).toBe(
      'Ada Lovelace and Grace Hopper',
    );
    expect(
      formatOwnerNames([member('a', 'Ada Lovelace'), member('g', 'Grace Hopper'), member('t', 'Alan Turing')]),
    ).toBe('Ada Lovelace, Grace Hopper and Alan Turing');
    // resolved: false ⇒ the plain identifier, exactly as resolveMembers left it.
    expect(formatOwnerNames([{ id: 'mock-gone', displayName: 'mock-gone', username: '', resolved: false }])).toBe(
      'mock-gone',
    );
  });

  it('U292: the no-access message names the workspace and who to ask', () => {
    expect(noAccessMessage('Design docs', [member('a', 'Ada Lovelace')])).toBe(
      'You don\'t have access to "Design docs". Ask Ada Lovelace for access.',
    );
    expect(noAccessMessage('Orphan', [])).toBe(
      'You don\'t have access to "Orphan", and it has no owner to ask.',
    );
  });
});

describe('PRD 007 Req 12: the delete confirmation gate', () => {
  it('U293: only the exact workspace name arms the action', () => {
    expect(deleteConfirmationMatches('Design docs', 'Design docs')).toBe(true);
    expect(deleteConfirmationMatches('', 'Design docs')).toBe(false);
    expect(deleteConfirmationMatches('design docs', 'Design docs')).toBe(false);
    expect(deleteConfirmationMatches('Design doc', 'Design docs')).toBe(false);
  });

  it('U294: whitespace is NOT trimmed away — a near-miss stays a near-miss', () => {
    expect(deleteConfirmationMatches(' Design docs', 'Design docs')).toBe(false);
    expect(deleteConfirmationMatches('Design docs ', 'Design docs')).toBe(false);
    // …and a name that genuinely has surrounding space matches only itself.
    expect(deleteConfirmationMatches(' spaced ', ' spaced ')).toBe(true);
    expect(deleteConfirmationMatches('spaced', ' spaced ')).toBe(false);
  });
});

describe('PRD 019 Reqs 8–9: the scratchpad row in the lifecycle UI', () => {
  it('U1033: only the flagged scratchpad row reads "My scratchpad"; every other row gets no badge', () => {
    // PRD 020 Req 10 as amended by issue #244: the badge carries the
    // feature's friendly name, and that name is "My scratchpad".
    expect(workspaceRowBadge(listing({ id: 'sp', name: 'My scratchpad', scratchpad: true }))).toBe('My scratchpad');
    expect(workspaceRowBadge(listing({ id: 'w', name: 'Docs' }))).toBeNull();
  });

  it('U1034: the delete section needs workspace.delete AND a non-scratchpad workspace', () => {
    const canDelete = ['doc.read', 'workspace.delete'];
    // A regular workspace with the verb: offered, exactly as before.
    expect(deleteOffered(listing({ id: 'w', name: 'Docs' }), canDelete)).toBe(true);
    // The caller's own scratchpad: withheld even though its Owner holds the
    // verb — the server refuses that delete anyway (PRD 019 Req 9).
    expect(deleteOffered(listing({ id: 'sp', name: 'Scratchpad', scratchpad: true }), canDelete)).toBe(false);
    // Without the verb nothing changes: never offered.
    expect(deleteOffered(listing({ id: 'w', name: 'Docs' }), ['doc.read'])).toBe(false);
  });
});

describe('PRD 020 Req 1+2: buildNewWorkspaceManifest and the unique name', () => {
  const NOW = '2026-09-03T00:00:00.000Z';

  it('U1051: a create body carries both names into the manifest; omitting the friendly name makes the unique name the display', () => {
    const both = buildNewWorkspaceManifest({ uniqueName: 'design-docs', name: 'Design Docs' }, 'mock-ada', NOW);
    expect(both.ok && both.manifest.uniqueName).toBe('design-docs');
    expect(both.ok && both.manifest.name).toBe('Design Docs');
    // No friendly name → the unique name is the display (PRD 020 Req 2).
    const bare = buildNewWorkspaceManifest({ uniqueName: 'design-docs' }, 'mock-ada', NOW);
    expect(bare.ok && bare.manifest.name).toBe('design-docs');
    // No unique name at all is still the pre-#219 API — old callers keep
    // working and the Req 3 migration names their workspaces later.
    const legacy = buildNewWorkspaceManifest({ name: 'Old style' }, 'mock-ada', NOW);
    expect(legacy.ok && 'uniqueName' in legacy.manifest).toBe(false);
  });

  it('U1052: an invalid or reserved unique name is refused with the message the dialog shows verbatim', () => {
    expect(buildNewWorkspaceManifest({ uniqueName: 'has spaces', name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'A unique name may only use lowercase letters, numbers and single dashes between them.',
    });
    // PRD 026 Req 1+3: a name legal under PRD 020's charset but not the
    // lowercase-dash rule is refused with the same message the dialog shows.
    expect(buildNewWorkspaceManifest({ uniqueName: 'Design-Docs', name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'A unique name may only use lowercase letters, numbers and single dashes between them.',
    });
    expect(buildNewWorkspaceManifest({ uniqueName: 'scratch', name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: '"scratch" is a reserved name.',
    });
    expect(buildNewWorkspaceManifest({ uniqueName: 42, name: 'W' }, 'mock-ada', NOW)).toEqual({
      ok: false,
      error: 'uniqueName must be a string',
    });
  });
});

describe('Issue #245: which create failures the unique name earned', () => {
  it('U1186: the collision refusal and every unique-name rule refusal are the name\'s fault', () => {
    // The server's 409 template (server/workspaces.ts `uniqueNameTakenError`),
    // asserted verbatim in tests/unit/server-workspaces.test.ts.
    expect(isUniqueNameError('The unique name "design-docs" is already taken.')).toBe(true);
    // Every phrasing the shared rule module produces, fed in as real output
    // so a reworded rule fails here instead of silently stopping matching.
    for (const bad of ['', 'has spaces', 'x'.repeat(UNIQUE_NAME_MAX_LENGTH + 1), 'scratch']) {
      const problem = uniqueNameProblem(bad);
      expect(problem, `uniqueNameProblem(${JSON.stringify(bad)})`).not.toBeNull();
      expect(isUniqueNameError(problem!), problem!).toBe(true);
    }
    // PRD 026 Req 6+8: the form's own empty-URL-name refusal is the URL
    // name's fault too; Req 4's display-name refusal is not — that field
    // paints itself.
    expect(isUniqueNameError('A URL name is required.')).toBe(true);
    expect(isUniqueNameError('A display name is required.')).toBe(false);
  });

  it('U1183: a failure that is not about the name leaves the name field alone', () => {
    // These still show their message; they just must not paint the field red.
    expect(isUniqueNameError('forbidden')).toBe(false);
    expect(isUniqueNameError('Network request failed')).toBe(false);
    expect(isUniqueNameError('malformed JSON body')).toBe(false);
    expect(isUniqueNameError('')).toBe(false);
    // A name in the text is not enough — the refusal has to be about it.
    expect(isUniqueNameError('The unique name service is unavailable.')).toBe(false);
  });
});

// PRD 007 Req 11 (issue #312): the dialog used to order by the server's
// `modified` stamp alone — who last edited, not who last opened. The seam now
// puts the caller's recently used workspaces first (the per-user MRU list's
// order), then the rest newest-modified; without ids it is byte-for-byte the
// old order, which U286 / U287 / U1196 keep pinning.
describe('PRD 007 Req 11 (issue #312): recently used workspaces lead the Open Workspace list', () => {
  const at = (id: string, day: number): WorkspaceListing =>
    listing({ id, name: `Workspace ${id}`, modified: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z` });
  const many = [at('a', 1), at('h', 8), at('c', 3), at('f', 6), at('b', 2), at('g', 7), at('d', 4), at('e', 5)];

  it('U1272: recently used ids come first in the given order, then the rest most recently modified', () => {
    expect(orderByRecentUse(many, ['c', 'a']).map((w) => w.id)).toEqual(['c', 'a', 'h', 'g', 'f', 'e', 'd', 'b']);
    expect(filterWorkspaces('', many, ['c', 'a']).map((w) => w.id)).toEqual(['c', 'a', 'h', 'g', 'f', 'e', 'd', 'b']);
    // A repeated id counts at its first (most recent) position, once.
    expect(orderByRecentUse(many, ['b', 'c', 'b']).map((w) => w.id)).toEqual(['b', 'c', 'h', 'g', 'f', 'e', 'd', 'a']);
    // No recency data: exactly today's newest-modified order, and the input is untouched.
    const before = many.map((w) => w.id);
    expect(orderByRecentUse(many).map((w) => w.id)).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']);
    expect(orderByRecentUse(many, [])).toEqual(filterWorkspaces('', many));
    expect(many.map((w) => w.id)).toEqual(before);
  });

  it('U1273: a recent id the listing does not contain is skipped without a row or a gap', () => {
    expect(orderByRecentUse(many, ['zzz', 'd', 'deleted']).map((w) => w.id)).toEqual([
      'd', 'h', 'g', 'f', 'e', 'c', 'b', 'a',
    ]);
    expect(visibleWorkspaces('', many, ['gone']).map((w) => w.id)).toEqual(['h', 'g', 'f', 'e', 'd']);
    expect(orderByRecentUse([], ['a'])).toEqual([]);
  });

  it('U1274: recency-first ordering is applied before the row cap, so a used-but-old workspace stays visible', () => {
    // 'a' (oldest modified) was opened most recently; 'b' after it. Both make
    // the five rows, pushing the merely newest-modified 'e' and 'd' off.
    expect(visibleWorkspaces('', many, ['a', 'b']).map((w) => w.id)).toEqual(['a', 'b', 'h', 'g', 'f']);
    expect(visibleWorkspaces('', many, ['a', 'b'])).toHaveLength(OPEN_WORKSPACE_ROW_CAP);
    expect(visibleWorkspaces('', many, ['a', 'b']).map((w) => w.id)).not.toContain('e');
  });

  it('U1275: with a query the match set is unchanged and, among equal scores, recent use precedes modified', () => {
    const named = [
      listing({ id: 'a', name: 'Design docs', modified: '2026-08-01T00:00:00.000Z' }),
      listing({ id: 'b', name: 'Release notes', modified: '2026-08-05T00:00:00.000Z' }),
      listing({ id: 'c', name: 'Design system', modified: '2026-08-03T00:00:00.000Z', access: false }),
    ];
    // Same matches as U287, whatever the recency data says.
    expect(filterWorkspaces('desgn', named, ['a']).map((w) => w.id).sort()).toEqual(['a', 'c']);
    expect(filterWorkspaces('rel', named, ['a', 'c']).map((w) => w.id)).toEqual(['b']);
    expect(filterWorkspaces('zzz', named, ['a', 'b', 'c'])).toEqual([]);
    // "Design" scores the same on both; today 'c' (newer) leads, a recent
    // open of 'a' puts it first; and a score difference still wins over use.
    expect(filterWorkspaces('design', named).map((w) => w.id)).toEqual(['c', 'a']);
    expect(filterWorkspaces('design', named, ['a']).map((w) => w.id)).toEqual(['a', 'c']);
    expect(visibleWorkspaces('design', named, ['a']).map((w) => w.id)).toEqual(['a', 'c']);
    expect(filterWorkspaces('design docs', named, ['c']).map((w) => w.id)).toEqual(['a']);
  });
});
