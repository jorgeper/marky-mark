import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
// @ts-expect-error — plain .mjs script module (the release pipeline's composer)
import { compareVersions, composeManifest, decideAdvance } from '../../scripts/updater-manifest.mjs';

/** A repo file read from disk (follows tests/unit/licenses.test.ts and U148). */
const repoFile = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('SPEC19 updater manifest', () => {
  test('U42: composes the tauri-updater schema; malformed inputs throw rather than emit a broken manifest', () => {
    const manifest = composeManifest({
      version: '0.2.0-alpha.5',
      notes: 'Fixes and features.',
      pubDate: '2026-07-12T00:00:00Z',
      assets: [
        {
          platform: 'darwin-universal',
          url: 'https://github.com/jorgeper/marky-mark/releases/download/v0.2.0-alpha.5/Marky.Mark_0.2.0-alpha.5_universal.app.tar.gz',
          signature: 'sig-mac\n',
        },
        {
          platform: 'windows-x86_64',
          url: 'https://github.com/jorgeper/marky-mark/releases/download/v0.2.0-alpha.5/Marky.Mark_0.2.0-alpha.5_x64-setup.exe',
          signature: 'sig-win',
        },
      ],
    });

    expect(manifest.version).toBe('0.2.0-alpha.5');
    expect(manifest.notes).toBe('Fixes and features.');
    expect(manifest.pub_date).toBe('2026-07-12T00:00:00.000Z');
    // A universal mac build serves all three darwin keys; signatures are trimmed content.
    for (const key of ['darwin-universal', 'darwin-aarch64', 'darwin-x86_64']) {
      expect(manifest.platforms[key].url).toContain('universal.app.tar.gz');
      expect(manifest.platforms[key].signature).toBe('sig-mac');
    }
    expect(manifest.platforms['windows-x86_64'].signature).toBe('sig-win');

    // Malformed inputs throw.
    expect(() => composeManifest({ version: '', notes: '', pubDate: '2026-01-01', assets: [] })).toThrow();
    expect(() =>
      composeManifest({
        version: '1.0.0',
        notes: '',
        pubDate: 'not a date',
        assets: [{ platform: 'darwin-universal', url: 'https://x', signature: 's' }],
      })
    ).toThrow();
    expect(() =>
      composeManifest({
        version: '1.0.0',
        notes: '',
        pubDate: '2026-01-01',
        assets: [{ platform: 'linux', url: 'https://x', signature: 's' }],
      })
    ).toThrow();
    expect(() =>
      composeManifest({
        version: '1.0.0',
        notes: '',
        pubDate: '2026-01-01',
        assets: [{ platform: 'darwin-universal', url: 'http://insecure', signature: 's' }],
      })
    ).toThrow();
    expect(() =>
      composeManifest({
        version: '1.0.0',
        notes: '',
        pubDate: '2026-01-01',
        assets: [{ platform: 'darwin-universal', url: 'https://x', signature: '   ' }],
      })
    ).toThrow();
  });
});

describe('the updater pointer only moves forwards (issue #19)', () => {
  test('U150: semver precedence follows this repo’s real version shapes', () => {
    // The incident: alpha.4 was published after alpha.5 and won.
    expect(compareVersions('0.4.0-alpha.5', '0.4.0-alpha.4')).toBe(1);
    expect(compareVersions('0.4.0-alpha.4', '0.4.0-alpha.5')).toBe(-1);
    // Numeric, not lexicographic — '10' < '9' as strings.
    expect(compareVersions('0.4.0-alpha.10', '0.4.0-alpha.9')).toBe(1);
    expect(compareVersions('0.4.0-alpha.9', '0.4.0-alpha.10')).toBe(-1);
    // A release outranks its own pre-releases; beta outranks alpha.
    expect(compareVersions('0.4.0', '0.4.0-alpha.5')).toBe(1);
    expect(compareVersions('0.4.0-alpha.5', '0.4.0')).toBe(-1);
    expect(compareVersions('0.4.0-beta.1', '0.4.0-alpha.9')).toBe(1);
    expect(compareVersions('0.4.0-alpha', '0.4.0-alpha.1')).toBe(-1);
    // Equal is not newer — in either direction, and a leading `v` is noise.
    expect(compareVersions('0.4.0-alpha.5', '0.4.0-alpha.5')).toBe(0);
    expect(compareVersions('v0.4.0-alpha.5', '0.4.0-alpha.5')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    // The ordinary triple.
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.5.0-alpha.1', '0.4.9')).toBe(1);
    expect(compareVersions('0.4.1', '0.4.0-alpha.99')).toBe(1);

    expect(() => compareVersions('nonsense', '0.4.0')).toThrow();
    expect(() => compareVersions('0.4.0', '')).toThrow();
  });

  test('U151: an older or equal candidate is skipped, but an empty endpoint and an explicit force still advance', () => {
    const skip = decideAdvance({ candidate: '0.4.0-alpha.4', current: '0.4.0-alpha.5' });
    expect(skip.decision).toBe('skip');
    expect(skip.reason).toMatch(/backwards/);
    expect(decideAdvance({ candidate: '0.4.0-alpha.5', current: '0.4.0-alpha.5' }).decision).toBe('skip');
    expect(decideAdvance({ candidate: '0.4.0-alpha.5', current: '0.4.0-alpha.4' }).decision).toBe('advance');

    // Escape hatch 1 — the state issue #19 describes: no release, no asset, a
    // zero-byte or unparseable manifest, a manifest with no version field. The
    // guard must never make that unrecoverable.
    for (const current of [null, undefined, '', '   ', 'not a version', '{}']) {
      const decided = decideAdvance({ candidate: '0.4.0-alpha.5', current });
      expect(decided.decision).toBe('advance');
      expect(decided.reason).toMatch(/no readable version/);
    }

    // Escape hatch 2 — the manual rollback lever (workflow_dispatch force).
    const forced = decideAdvance({ candidate: '0.4.0-alpha.4', current: '0.4.0-alpha.5', force: true });
    expect(forced.decision).toBe('advance');
    expect(forced.reason).toMatch(/forced/);
    // Force defaults off: the same inputs without it are the skip above.
    expect(decideAdvance({ candidate: '0.4.0-alpha.4', current: '0.4.0-alpha.5', force: false }).decision).toBe('skip');

    // A candidate the guard cannot read at all is a bug upstream, not a skip.
    expect(() => decideAdvance({ candidate: '', current: '0.4.0' })).toThrow();
  });

  test('U152: the workflow serialises itself with a fixed, non-cancelling concurrency group', () => {
    // Text/regex based on purpose: no YAML parser ships offline, and this
    // guard is not worth a dependency.
    const wf = repoFile('.github/workflows/updater-manifest.yml');

    const block = /^concurrency:\n((?:[ \t]+.*\n)+)/m.exec(wf);
    expect(block, 'updater-manifest.yml must have a top-level concurrency: block').toBeTruthy();
    const body = block![1];

    // A FIXED group. Keying by tag/ref/event re-opens the race: the duplicate
    // publish events share a tag, and a manual dispatch must queue too.
    const group = /^[ \t]+group:[ \t]*(.+)$/m.exec(body)?.[1].trim();
    expect(group).toBeTruthy();
    expect(group).not.toMatch(/\$\{\{/);
    expect(group).toBe('updater-manifest');

    // Cancelling between `--clobber`'s delete and upload is what loses the asset.
    expect(/^[ \t]+cancel-in-progress:[ \t]*false[ \t]*$/m.test(body)).toBe(true);
    expect(body).not.toMatch(/cancel-in-progress:[ \t]*(true|\$\{\{)/);

    // The stale "the job is idempotent — clobber upload" justification is gone;
    // the trigger comment now points at the concurrency block instead.
    expect(wf).not.toMatch(/the job is idempotent/);
    expect(wf).toMatch(/concurrency/);
  });

  test('U153: the job fails red when the endpoint does not end up serving the published version', () => {
    const wf = repoFile('.github/workflows/updater-manifest.yml');

    // Post-upload verification: re-download from the rolling release and
    // compare versions, erroring (not exiting 0) on either failure.
    const afterUpload = wf.slice(wf.indexOf('gh release upload updater'));
    expect(afterUpload).toMatch(/gh release download updater/);
    expect(afterUpload).toMatch(/::error::/);
    expect(afterUpload).toMatch(/exit 1/);
    // The failure names the tag so the log says what to re-dispatch.
    expect(afterUpload).toMatch(/\$TAG/);
    expect(afterUpload).toMatch(/gh workflow run updater-manifest\.yml -f tag=/);

    // The pointer guard runs before the upload, through the script's CLI —
    // no semver ordering in shell.
    const beforeUpload = wf.slice(0, wf.indexOf('gh release upload updater'));
    expect(beforeUpload).toMatch(/node scripts\/updater-manifest\.mjs[\s\S]*--candidate/);
    expect(beforeUpload).toMatch(/--force "\$FORCE"/);
    expect(wf).toMatch(/^ {6}force:$/m); // the documented workflow_dispatch rollback input

    // The pre-SPEC19 early exit survives: no latest.json on the tag still
    // warns and exits 0 without touching the endpoint.
    expect(wf).toMatch(/::warning::\$TAG has no latest\.json[\s\S]{0,120}?exit 0/);
  });
});
