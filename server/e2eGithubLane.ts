// PRD 010 Req 22: what the GitHub-backed e2e lane is made of, in one place
// both halves read — `server/e2eGithub.ts` boots a real server against this
// seed, and `tests/e2e/github-storage.spec.ts` drives the running app against
// the same names. Sharing the module is what keeps the two from drifting: a
// renamed repo or a moved seed file is a typecheck error, not a red suite.
//
// Everything here is loopback: the seed is the state of the local fake of the
// GitHub API (`server/providers/github/fake.ts`), which is the only "GitHub"
// the lane has. No credential, no network, no manual step.

import type { FakeInstallationSeed } from './providers/github/fake.ts';

/** The App the lane's server authenticates as — the fake's own default id. */
export const LANE_APP_ID = '424242';

/** The App's URL slug, so the wizard's install URL has one to name. */
export const LANE_APP_SLUG = 'marky-mark-e2e';

/** The single installation the seeded App has; the wizard returns from it. */
export const LANE_INSTALLATION_ID = 4242;

/** The account it is installed on. */
export const LANE_ACCOUNT = 'marky-org';

/**
 * PRD 010 Req 5: the deployment default repo — `MM_STORAGE_BACKEND=github`
 * points the whole deployment's storage at it, so the lane needs no Azurite
 * and no storage account at all. `MM_GITHUB_DEFAULT_REPO` takes the
 * `owner/repo` spelling; the seed below takes the two halves.
 */
const DEFAULT_REPO_NAME = 'deployment';
export const LANE_DEFAULT_REPO = `${LANE_ACCOUNT}/${DEFAULT_REPO_NAME}`;

/**
 * PRD 010 Req 17: the repo an admin connects in the wizard — a repo that
 * already has documents in it, which is the whole point of bring-your-own.
 */
export const LANE_BYO_REPO = { owner: LANE_ACCOUNT, repo: 'handbooks' } as const;

/** The lane's ports: the server, and the fake it reads GitHub through. */
export const LANE_SERVER_PORT = 4925;
export const LANE_FAKE_PORT = 4926;

/**
 * Each test that connects a repo gets its OWN subdirectory of the BYO repo,
 * addressed by worker index and purpose, so workers running in parallel never
 * write each other's `.marky-mark/manifest.json`. Playwright's worker count
 * scales with the machine; this covers well past the config's cap of 6.
 */
const LANE_WORKERS = 12;
const LANE_PURPOSES = ['happy', 'merge', 'conflict'] as const;

/** The connected root a test uses — the subdirectory typed into the wizard. */
export function laneRoot(purpose: (typeof LANE_PURPOSES)[number], workerIndex: number): string {
  return `spaces/w${workerIndex}-${purpose}`;
}

/** The seeded document every lane root already holds, and its content. */
export const LANE_SEEDED_DOC = 'handbook.md';
export const LANE_SEEDED_TEXT = '# Handbook\n\nThis file was committed to the repo before the app ever saw it.\n';

/** The seeded files of the BYO repo: one document under every lane root. */
function byoFiles(): Record<string, string> {
  const files: Record<string, string> = {
    // A file OUTSIDE every connected root: a workspace connected to a
    // subdirectory must never list the rest of the repo.
    'README.md': '# Handbooks\n\nThe repo an admin brings.\n',
  };
  for (let worker = 0; worker < LANE_WORKERS; worker += 1) {
    for (const purpose of LANE_PURPOSES) {
      files[`${laneRoot(purpose, worker)}/${LANE_SEEDED_DOC}`] = LANE_SEEDED_TEXT;
    }
  }
  return files;
}

/** The fake's whole world: one installation, the two repos the lane uses. */
export function laneInstallations(): FakeInstallationSeed[] {
  return [
    {
      id: LANE_INSTALLATION_ID,
      account: LANE_ACCOUNT,
      repos: [
        {
          owner: LANE_ACCOUNT,
          repo: DEFAULT_REPO_NAME,
          branch: 'main',
          // PRD 010 Req 6: the startup check reads the default repo before the
          // listener accepts anything, so it exists here with a commit in it.
          files: { 'README.md': '# Deployment store\n\nApp storage — not meant to be read by hand.\n' },
        },
        { owner: LANE_BYO_REPO.owner, repo: LANE_BYO_REPO.repo, branch: 'main', files: byoFiles() },
      ],
    },
  ];
}
