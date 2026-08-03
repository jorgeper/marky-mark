import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { readmeVersion, setReadmeVersion } from '../../scripts/release-prepare.mjs';

/** A repo file read from disk (follows tests/unit/licenses.test.ts and U147). */
const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('the README advertises the shipping version (issue #22)', () => {
  test('U148: the README banner is in lock-step with package.json, and nothing else in the file is mistaken for it', () => {
    const readme = repoFile('README.md');
    const { version } = JSON.parse(repoFile('package.json')) as { version: string };

    // The drift guard proper: the same extraction the gate runs, against the
    // real files. This is what went stale for four releases before #22.
    expect(readmeVersion(readme)).toBe(version);

    // A stale banner is rejected — the whole point of the check.
    const stale = readme.replace(`(\`${version}\`)`, '(`0.4.0-alpha.4`)');
    expect(stale).not.toBe(readme);
    expect(readmeVersion(stale)).toBe('0.4.0-alpha.4');
    expect(readmeVersion(stale)).not.toBe(version);

    // The false-positive surface the issue calls out. Neither the shields.io
    // badge URL nor the `<version>` placeholder rows of the download table may
    // produce a match — with the banner removed there is nothing left to find,
    // and a null extraction must never read as "in lock-step".
    const banner = /^> \*\*⚠️ Alpha\*\*.*$/m.exec(readme)?.[0];
    expect(banner).toBeTruthy();
    const bannerless = readme.replace(`${banner}\n`, '');
    expect(bannerless).toContain('img.shields.io/github/v/release'); // badge still there
    expect(bannerless).toContain('Marky Mark_<version>_x64-setup.exe'); // table still there
    expect(readmeVersion(bannerless)).toBeNull();

    // `0.2.0-alpha.2`-style example versions elsewhere in the repo's docs are
    // not banners either.
    const releasing = repoFile('docs/RELEASING.md');
    expect(releasing).toContain('0.2.0-alpha.2');
    expect(readmeVersion(releasing)).toBeNull();

    // Neither does either line on its own, nor an empty file.
    expect(
      readmeVersion(
        '[![Release](https://img.shields.io/github/v/release/jorgeper/marky-mark?include_prereleases&label=release)](https://github.com/jorgeper/marky-mark/releases/latest)',
      ),
    ).toBeNull();
    expect(readmeVersion('| **Web** | `marky-mark-web-<version>.html` | one file |')).toBeNull();
    expect(readmeVersion('')).toBeNull();
  });

  test('U149: release:prepare rewrites only the banner version, and rerunning it is a no-op', () => {
    const readme = repoFile('README.md');
    const bumped = setReadmeVersion(readme, '9.9.9-alpha.1');

    expect(readmeVersion(bumped)).toBe('9.9.9-alpha.1');
    // The pre-release identifier survives verbatim; the rest of the file does too.
    expect(setReadmeVersion(bumped, '9.9.9')).toContain('pre-release software (`9.9.9`)');
    const before = readme.split('\n');
    expect(bumped.split('\n').filter((line, i) => line !== before[i])).toHaveLength(1);
    expect(bumped).toContain('Marky Mark_<version>_x64-setup.exe');
    expect(bumped).toContain('/releases/latest');

    // Rerun with the version already in place: byte-identical, so the
    // release-prepare no-op path stays a no-op.
    expect(setReadmeVersion(readme, readmeVersion(readme)!)).toBe(readme);
  });
});
