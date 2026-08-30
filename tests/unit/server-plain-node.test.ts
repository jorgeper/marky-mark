import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// PRD 007 Req 1: the production entry starts under plain `node
// server/index.ts` (Node ≥22.18 strips types natively). The historical break
// was extensionless relative imports in the shared src/lib modules, which
// Node's ESM loader rejects with ERR_MODULE_NOT_FOUND before any code runs.
// This test boots the real entry under the real loader, so a regression in
// any import reachable from server/index.ts fails here, not on App Service.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('PRD 007 Req 1 plain-node start of server/index.ts', () => {
  test('U798: MM_MODE=azure under plain node reaches the config check, never ERR_MODULE_NOT_FOUND', () => {
    // An otherwise-clean env: PATH so node can run, MM_MODE=azure with none
    // of the variables azure mode requires, so a successful boot stops at
    // loadConfig's named refusal — the documented failure, not a loader one.
    const result = spawnSync(process.execPath, ['server/index.ts'], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? '', MM_MODE: 'azure' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain('MM_MODE=azure requires environment variables:');
    expect(result.status).not.toBe(0);
  });
});
