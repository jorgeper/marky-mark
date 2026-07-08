import { describe, expect, test } from 'vitest';
import { licenseAllowed } from '../../scripts/licenses.mjs';

describe('license allowlist guard (SPEC10 §5)', () => {
  test('U16: the checker passes the permissive ecosystem set and demonstrably fails copyleft or missing licenses', () => {
    // Everything the real dependency tree carries today.
    for (const ok of [
      'MIT',
      'ISC',
      'Apache-2.0',
      'Apache-2.0 WITH LLVM-exception',
      'BSD-3-Clause',
      'Zlib',
      'CC0-1.0',
      '0BSD',
      'Unlicense',
      'MPL-2.0', // transitive-only in the Rust tree; imposes nothing on MIT app code (license.md)
      'MIT OR Apache-2.0',
      '(MIT OR Apache-2.0) AND Unicode-3.0',
      'Apache-2.0 OR BSL-1.0',
    ]) {
      expect(licenseAllowed(ok), ok).toBe(true);
    }

    // The fake copyleft entry: a future dep that sneaks in GPL must fail the run.
    for (const bad of [
      'GPL-3.0-only',
      'GPL-2.0-or-later',
      'AGPL-3.0-only',
      'LGPL-3.0-only',
      'MIT AND GPL-3.0-only', // AND: every branch must be allowed
      'SSPL-1.0',
      'SEE-LICENSE-FILE:LICENSE.txt', // license-file-only crates need a human decision
      '',
      null,
      undefined,
    ]) {
      expect(licenseAllowed(bad as never), String(bad)).toBe(false);
    }

    // OR lets a dual-licensed package through on its permissive branch.
    expect(licenseAllowed('GPL-2.0-only OR MIT')).toBe(true);
    // But an unknown/garbage expression never passes.
    expect(licenseAllowed('Custom-Proprietary-1.0')).toBe(false);
  });
});
