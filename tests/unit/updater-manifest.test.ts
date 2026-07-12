import { describe, expect, test } from 'vitest';
// @ts-expect-error — plain .mjs script module (the release pipeline's composer)
import { composeManifest } from '../../scripts/updater-manifest.mjs';

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
