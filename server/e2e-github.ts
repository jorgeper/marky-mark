// PRD 010 Req 22: the GitHub-backed e2e lane's single command — the sibling
// of `server/local.ts` for the storage backend of PRD 010. It arranges
// everything itself and offline: builds the SPA when dist/ is stale, generates
// a throwaway App keypair, starts the local fake of the GitHub API
// (`server/providers/github/fake.ts`, seeded by `server/e2eGithubLane.ts`) on
// its own loopback port, points the server at it through MM_GITHUB_API_BASE /
// MM_GITHUB_WEB_BASE, and starts the server in this process with
// MM_STORAGE_BACKEND=github.
//
// The App keypair is generated at boot and lives only in this process: there
// is no credential to configure, and nothing to leak. A clean checkout runs
// the lane with `npm run server:github` — no account, no token, no network.

import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { ensureSpaBuilt } from './devSpa.ts';
import {
  LANE_APP_ID,
  LANE_APP_SLUG,
  LANE_DEFAULT_REPO,
  LANE_FAKE_PORT,
  LANE_SERVER_PORT,
  laneInstallations,
} from './e2eGithubLane.ts';
import { createGitHubFake } from './providers/github/fake.ts';

const root = path.resolve(import.meta.dirname, '..');

// 1. A built SPA to serve — the same step server/local.ts takes.
ensureSpaBuilt(root);

// 2. A GitHub App keypair, made here and never written down. The fake
// verifies App JWTs against the public half, so the lane exercises the real
// signing path of PRD 010 Req 4 rather than a stubbed-out one.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

// 3. The fake of the GitHub API, on its own loopback port.
const fake = createGitHubFake({
  appId: LANE_APP_ID,
  publicKey: createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })),
  installations: laneInstallations(),
});
const listener = await fake.listen(LANE_FAKE_PORT);
console.log(`server:github — the GitHub API fake is listening on ${listener.url}`);
const stop = () => {
  void listener.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// 4. The server, in local mode (mock auth + directory, PRD 007 Req 4) with
// the github storage backend — so every byte this lane stores, per-user files
// and workspace manifests included, is a commit in the fake's repos.
process.env.MM_MODE ??= 'local';
process.env.PORT ??= String(LANE_SERVER_PORT);
process.env.MM_STATIC_DIR ??= path.join(root, 'dist');
process.env.MM_STORAGE_BACKEND ??= 'github';
process.env.MM_GITHUB_APP_ID ??= LANE_APP_ID;
process.env.MM_GITHUB_PRIVATE_KEY ??= privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
process.env.MM_GITHUB_DEFAULT_REPO ??= LANE_DEFAULT_REPO;
process.env.MM_GITHUB_APP_SLUG ??= LANE_APP_SLUG;
// PRD 010 Req 16: the wizard's install URL is a browser page, so the lane
// points the web base at the fake too — leaving for "GitHub" lands on the
// fake's own origin, and the return leg is a navigation back to this app.
process.env.MM_GITHUB_API_BASE ??= listener.url;
process.env.MM_GITHUB_WEB_BASE ??= listener.url;
await import('./index.ts');
