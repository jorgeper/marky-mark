import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { AZURITE_CONNECTION_STRING, GITHUB_BACKEND_REQUIRED, loadConfig } from '../../server/config.ts';

// PRD 010 Req 20: the drift guard for the operator hosting guide, in the style
// of U147 (docs/COMMENT-FORMAT.md) — every claim below is read out of the
// document and checked against the code, so the guide cannot rot while the
// configuration moves. Reading a repo file from a unit test follows
// tests/unit/licenses.test.ts (vitest runs in the node env).

const GUIDE_PATH = fileURLToPath(new URL('../../docs/HOSTING-GITHUB.md', import.meta.url));
const guide = existsSync(GUIDE_PATH) ? readFileSync(GUIDE_PATH, 'utf8') : '';

/** Every `MM_GITHUB_*` / `MM_STORAGE_*` variable `server/config.ts` reads. */
const configSource = readFileSync(
  fileURLToPath(new URL('../../server/config.ts', import.meta.url)),
  'utf8',
);
const variablesInCode = [...new Set(configSource.match(/\bMM_[A-Z_]*[A-Z]\b/g) ?? [])].sort();

/** Those the guide names, from its own text. */
const variablesInGuide = [...new Set(guide.match(/\bMM_[A-Z_]*[A-Z]\b/g) ?? [])].sort();

/** `loadConfig` really parses the PEM, so a placeholder string cannot stand in. */
const { privateKey: TEST_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('the operator hosting guide for the github backend (docs/HOSTING-GITHUB.md)', () => {
  test('U478: the guide exists, names every required variable, and invents none', () => {
    expect(existsSync(GUIDE_PATH), 'docs/HOSTING-GITHUB.md').toBe(true);

    // The minimum the guide has to carry: what the backend cannot start
    // without, straight from the constant `loadConfig` enforces.
    for (const name of GITHUB_BACKEND_REQUIRED) {
      expect(guide, name).toContain(name);
    }
    // …and it marks them required, in the same sentence shape loadConfig
    // refuses with, so an operator can match the log line to the guide.
    expect(guide).toContain(
      `MM_STORAGE_BACKEND=github requires environment variables: ${GITHUB_BACKEND_REQUIRED.slice(1).join(', ')}`,
    );

    // No variable that does not exist: every MM_* the guide names is one the
    // config loader really reads.
    for (const name of variablesInGuide) {
      expect(variablesInCode, `${name} is named in the guide but read nowhere in server/config.ts`).toContain(name);
    }
    // …and the optional GitHub ones are all covered, so a new knob cannot be
    // added to the loader without the guide gaining a row.
    for (const name of variablesInCode.filter((v) => v.startsWith('MM_GITHUB_'))) {
      expect(guide, `${name} is read by server/config.ts but missing from the guide`).toContain(name);
    }
  });

  test('U479: the defaults and the orthogonality the guide states are the ones the loader applies', () => {
    // The documented defaults, asserted against loadConfig rather than trusted.
    const base = {
      MM_STORAGE_BACKEND: 'github',
      MM_GITHUB_APP_ID: '123456',
      MM_GITHUB_PRIVATE_KEY: TEST_PEM,
      MM_GITHUB_DEFAULT_REPO: 'example-org/marky-mark-storage',
    };
    const config = loadConfig(base);
    expect(config.github?.defaultRepo).toEqual({
      owner: 'example-org',
      repo: 'marky-mark-storage',
      branch: 'main', // the guide's documented MM_GITHUB_DEFAULT_BRANCH default
    });
    expect(guide).toMatch(/`MM_GITHUB_DEFAULT_BRANCH`[^|]*\|[^|]*\|\s*`main`\s*\|/);
    // MM_GITHUB_DEFAULT_ROOT defaults to the repo root: no root at all.
    expect(config.github?.defaultRepo?.root).toBeUndefined();
    // The App slug really is optional, and really is what the wizard needs.
    expect(config.github?.appSlug).toBeUndefined();

    // § 5's claim: a github-backend deployment reads no Azure storage account,
    // and MM_MODE=azure no longer requires one.
    expect(config.storage.connectionString).toBeUndefined();
    expect(config.storage.connectionString).not.toBe(AZURITE_CONNECTION_STRING);
    const azure = loadConfig({
      ...base,
      MM_MODE: 'azure',
      ENTRA_TENANT_ID: 'tenant',
      ENTRA_CLIENT_ID: 'client',
    });
    expect(azure.storageBackend).toBe('github');
    expect(azure.storage.connectionString).toBeUndefined();
    // …but Entra stays required whatever the backend, which the guide says.
    expect(() => loadConfig({ ...base, MM_MODE: 'azure' })).toThrow(
      /MM_MODE=azure requires environment variables: ENTRA_TENANT_ID, ENTRA_CLIENT_ID/,
    );
    expect(guide).toContain('AZURE_STORAGE_CONNECTION_STRING');
    expect(guide).toContain('ENTRA_TENANT_ID');

    // And the guide is discoverable from every index that points at docs.
    for (const [file, needle] of [
      ['../../README.md', 'docs/HOSTING-GITHUB.md'],
      ['../../docs/DEVELOPING.md', 'HOSTING-GITHUB.md'],
      ['../../docs/HOSTING-AZURE.md', 'HOSTING-GITHUB.md'],
      ['../../AGENTS.md', 'HOSTING-GITHUB'],
    ] as const) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).toContain(needle);
    }
  });
});

