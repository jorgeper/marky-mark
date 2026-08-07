import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORAGE_CHOICE,
  WIZARD_STATE_KEY,
  WIZARD_STEPS,
  buildConnectedCreateRequest,
  connectionFor,
  decideWizardEntry,
  parseSavedWizardState,
  pickRepo,
  readGitHubReturn,
  serializeWizardState,
  stepAfter,
  stepBefore,
  summarize,
  validateSubdirectory,
  type SavedWizardState,
} from '../../src/lib/githubConnectWizard';
import { emptyNewWorkspaceForm, validateNewWorkspaceForm } from '../../src/lib/workspaceLifecycle';

// PRD 010 Req 15+16: the pure half of the connect-your-GitHub-repo wizard —
// the two storage choices and the create body each produces, the four steps
// and the branch default, the subdirectory rule, and the resume-vs-restart
// decision that keeps the flow restartable across the navigation out to
// GitHub's consent page.

const form = { ...emptyNewWorkspaceForm(), name: 'Docs' };

function savedAt(step: SavedWizardState['step'], extra: Partial<SavedWizardState> = {}): SavedWizardState {
  return { version: 1, session: 'sess-1', step, form, ...extra };
}

describe('PRD 010 Req 15+16 connect-your-GitHub-repo wizard: choices, steps, restart', () => {
  it('U435: default storage is preselected and its create body carries no storage field', () => {
    expect(DEFAULT_STORAGE_CHOICE).toBe('default');
    // The default choice stays on the dialog's existing validation, untouched
    // by this issue — which is exactly why its body cannot grow a field.
    const built = validateNewWorkspaceForm(form);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Byte identical to today's body: `storage` is not even present as a key.
    expect(Object.keys(built.request).sort()).toEqual(['everyone', 'members', 'name']);
    expect(JSON.stringify(built.request)).toBe(
      JSON.stringify({ name: 'Docs', members: [], everyone: { enabled: false, role: 'Viewer' } }),
    );
  });

  it('U436: the GitHub choice creates with a {kind:"repo"} storage record, root omitted at the repo root', () => {
    const rooted = buildConnectedCreateRequest(
      savedAt('confirm', { owner: 'marky-org', repo: 'docs', branch: 'main', root: 'notes' }),
    );
    expect(rooted.ok).toBe(true);
    if (!rooted.ok) return;
    expect(rooted.request.storage).toEqual({
      kind: 'repo',
      owner: 'marky-org',
      repo: 'docs',
      branch: 'main',
      root: 'notes',
    });
    // The same workspace fields ride along — the connection adds, never replaces.
    expect(rooted.request.name).toBe('Docs');
    expect(rooted.request.everyone).toEqual({ enabled: false, role: 'Viewer' });

    const atRoot = buildConnectedCreateRequest(
      savedAt('confirm', { owner: 'marky-org', repo: 'docs', branch: 'trunk' }),
    );
    expect(atRoot.ok).toBe(true);
    if (!atRoot.ok) return;
    expect(atRoot.request.storage).toEqual({ kind: 'repo', owner: 'marky-org', repo: 'docs', branch: 'trunk' });
    expect('root' in atRoot.request.storage!).toBe(false);
  });

  it('U437: an incomplete pick refuses to build a create body, and a blank name still fails first', () => {
    expect(buildConnectedCreateRequest(savedAt('branch', { owner: 'marky-org', repo: 'docs' }))).toEqual({
      ok: false,
      error: 'Pick a repository and a branch before creating the workspace.',
    });
    expect(connectionFor(savedAt('branch', { owner: 'marky-org' }))).toBeNull();
    const unnamed = buildConnectedCreateRequest({
      ...savedAt('confirm', { owner: 'o', repo: 'r', branch: 'main' }),
      form: emptyNewWorkspaceForm(),
    });
    expect(unnamed).toEqual({ ok: false, error: 'Enter a name for the workspace.' });
  });

  it('U438: the subdirectory accepts a plain repo-relative prefix and names each rejected shape', () => {
    expect(validateSubdirectory('')).toEqual({ ok: true });
    expect(validateSubdirectory('   ')).toEqual({ ok: true });
    expect(validateSubdirectory('docs/handbook')).toEqual({ ok: true, root: 'docs/handbook' });
    expect(validateSubdirectory('/docs').ok).toBe(false);
    expect(validateSubdirectory('/docs')).toMatchObject({ error: expect.stringContaining('cannot start with') });
    expect(validateSubdirectory('docs/')).toMatchObject({ error: expect.stringContaining('trailing') });
    expect(validateSubdirectory('../secrets')).toMatchObject({ error: expect.stringContaining('“.” or “..”') });
    expect(validateSubdirectory('docs/../..')).toMatchObject({ error: expect.stringContaining('“.” or “..”') });
    expect(validateSubdirectory('docs//notes')).toMatchObject({ error: expect.stringContaining('empty path segment') });
    expect(validateSubdirectory('C:\\docs')).toMatchObject({ error: expect.stringContaining('forward slashes') });
  });

  it('U439: the steps run install → repo → branch → confirm, and picking a repo defaults the branch', () => {
    expect(WIZARD_STEPS).toEqual(['install', 'repo', 'branch', 'confirm']);
    expect(stepAfter('install')).toBe('repo');
    expect(stepAfter('repo')).toBe('branch');
    expect(stepAfter('branch')).toBe('confirm');
    expect(stepAfter('confirm')).toBe('confirm');
    expect(stepBefore('branch')).toBe('repo');
    expect(stepBefore('install')).toBe('install');

    const picked = pickRepo(savedAt('repo', { installationId: 7, root: 'stale' }), {
      owner: 'marky-org',
      repo: 'docs',
      fullName: 'marky-org/docs',
      defaultBranch: 'trunk',
    });
    expect(picked.step).toBe('branch');
    expect(picked.branch).toBe('trunk');
    expect(picked.defaultBranch).toBe('trunk');
    // A repo picked again starts at the repo root, not the last repo's prefix.
    expect(picked.root).toBeUndefined();
    expect(picked.installationId).toBe(7);
  });

  it('U440: the confirm step shows owner/repo, branch and root back before anything is created', () => {
    expect(summarize({ kind: 'repo', owner: 'marky-org', repo: 'docs', branch: 'main', root: 'notes' })).toEqual({
      repo: 'marky-org/docs',
      branch: 'main',
      location: 'notes/',
    });
    expect(summarize({ kind: 'repo', owner: 'marky-org', repo: 'docs', branch: 'main' }).location).toBe(
      'the repository root',
    );
  });

  it('U441: GitHub\'s return parameters are read off the app\'s own URL', () => {
    expect(readGitHubReturn('?installation_id=42&setup_action=install&state=sess-1')).toEqual({
      present: true,
      installationId: 42,
      setupAction: 'install',
      session: 'sess-1',
    });
    expect(readGitHubReturn('?workspace=abc').present).toBe(false);
    expect(readGitHubReturn('?installation_id=nope&setup_action=install&state=s').installationId).toBeNull();
  });

  it('U442: saved state survives the round trip and resumes at pick-repo with the returned installation', () => {
    const saved = savedAt('install');
    const raw = serializeWizardState(saved);
    expect(parseSavedWizardState(raw)).toEqual(saved);
    // Nothing GitHub-issued beyond the installation id is ever persisted.
    expect(raw).not.toMatch(/token|secret|ghs_/i);

    const entry = decideWizardEntry(raw, readGitHubReturn('?installation_id=7&setup_action=install&state=sess-1'));
    expect(entry.kind).toBe('resume');
    if (entry.kind !== 'resume') return;
    expect(entry.state.step).toBe('repo');
    expect(entry.state.installationId).toBe(7);
    expect(entry.state.form.name).toBe('Docs');
  });

  it('U443: abandoning mid-flow offers to continue, and nothing saved is simply a fresh dialog', () => {
    const entry = decideWizardEntry(serializeWizardState(savedAt('branch', { owner: 'o', repo: 'r' })), {
      present: false,
      installationId: null,
      setupAction: null,
      session: null,
    });
    expect(entry.kind).toBe('continue');
    if (entry.kind !== 'continue') return;
    expect(entry.state.step).toBe('branch');
    expect(decideWizardEntry(null, readGitHubReturn('')).kind).toBe('fresh');
    // Corrupt or foreign saved state is not resumable, and not an error either.
    expect(decideWizardEntry('{ not json', readGitHubReturn('')).kind).toBe('fresh');
    expect(decideWizardEntry(JSON.stringify({ version: 9 }), readGitHubReturn('')).kind).toBe('fresh');
  });

  it('U444: a return that cannot be matched resolves to a named restart, never a stuck step', () => {
    const saved = serializeWizardState(savedAt('install'));
    const unknown = decideWizardEntry(null, readGitHubReturn('?installation_id=7&setup_action=install&state=x'));
    expect(unknown.kind).toBe('restart');
    if (unknown.kind === 'restart') expect(unknown.reason).toMatch(/no record of the connection/i);

    const mismatched = decideWizardEntry(saved, readGitHubReturn('?installation_id=7&setup_action=install&state=other'));
    expect(mismatched).toEqual({
      kind: 'restart',
      reason: 'GitHub returned from a different connection than the one this browser started. Start again.',
    });

    const cancelled = decideWizardEntry(saved, readGitHubReturn('?setup_action=cancel&state=sess-1'));
    expect(cancelled.kind).toBe('restart');
    if (cancelled.kind === 'restart') expect(cancelled.reason).toMatch(/did not complete/i);
  });

  it('U445: the saved-state key is one stable string the dialog and the return leg agree on', () => {
    expect(WIZARD_STATE_KEY).toBe('marky-mark.new-workspace.github-connect');
  });
});
