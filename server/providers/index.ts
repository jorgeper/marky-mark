// PRD 007 Req 3+4: provider selection — the one switch that turns config into
// a wired provider set. 'azure' composes Entra ID + Blob Storage + Graph;
// 'local' composes the seeded mocks for auth + directory and the SAME Azure
// Blob Storage implementation pointed at Azurite's dev endpoint, so the real
// storage code path is exercised offline.
//
// PRD 010 Req 1+5: storage is selected by its OWN knob, orthogonally — the
// mode still picks auth and directory and nothing else, so all four
// combinations wire.

import type { WorkspaceBackendsOptions } from '../backends.ts';
import type { ServerConfig } from '../config.ts';
import { createGitHubByo, type GitHubByo } from '../githubByo.ts';
import { createBlobStorageProvider } from './azure/blob.ts';
import { createEntraAuthProvider } from './azure/entra.ts';
import { createGraphDirectoryProvider } from './azure/graph.ts';
import { createGitHubAppAuth, type FetchLike, type GitHubAppAuth } from './github/auth.ts';
import { createWorkspaceRepoView, normalizeRoot, repoConnectionKey } from './github/byo.ts';
import { createGitHubStorageProvider } from './github/storage.ts';
import { createMockAuthProvider } from './mock/auth.ts';
import { createMockDirectoryProvider } from './mock/directory.ts';
import type { Providers, StorageProvider } from './types.ts';

export interface ProviderOptions {
  /** Injected for tests — the GitHub fake, never the network. */
  fetchImpl?: FetchLike;
}

/**
 * PRD 010 Req 5+17: the deployment's GitHub App credentials as one auth
 * client. The App section is the deployment's, never a record's or a
 * request's, so both the default repo and every BYO connection are built from
 * exactly this.
 */
function appAuthFor(github: NonNullable<ServerConfig['github']>, options: ProviderOptions): GitHubAppAuth {
  const { appId, privateKey, apiBase } = github;
  const { fetchImpl } = options;
  return createGitHubAppAuth({ appId, privateKey, apiBase, ...(fetchImpl ? { fetchImpl } : {}) });
}

/**
 * PRD 010 Req 1+5: the storage half of the switch. On the github backend NO
 * blob client is constructed at all — a deployment with no storage account
 * must not fail here on a connection string it was never given.
 */
function createStorage(config: ServerConfig, options: ProviderOptions): StorageProvider {
  if (config.storageBackend === 'blob') {
    // loadConfig guarantees a connection string whenever the backend is blob.
    return createBlobStorageProvider(config.storage.connectionString!, config.storage.container);
  }
  // …and loadConfig guarantees the App section and the default repo whenever
  // it is github, naming every missing variable at once if it cannot.
  const github = config.github!;
  const { owner, repo, branch, root } = github.defaultRepo!;
  return createGitHubStorageProvider({
    owner,
    repo,
    branch,
    ...(root ? { root } : {}),
    // PRD 010 Req 5: today's layout, unchanged — `workspaces/<uuid>/…` and
    // `users/…` at those repo-relative paths, on one branch. #100's provider
    // used as-is: no per-workspace branch, no path mangling, no id
    // translation.
    auth: appAuthFor(github, options),
  });
}

/**
 * PRD 010 Req 17: how a `{kind: 'repo', …}` record becomes a live provider —
 * the `connect` hook `server/backends.ts` left unset, supplied here where the
 * App credentials already are.
 *
 * BYO is independent of the deployment default: this is built from
 * `config.github` alone, so a `blob`-default deployment with the App section
 * configured serves repo-backed workspaces alongside blob ones. Undefined
 * when there is no App section at all — a deployment that genuinely cannot
 * connect, which `createWorkspaceBackends` then reports by name rather than
 * falling back to the default store.
 *
 * The record supplies owner/repo/branch/root and NOTHING else: the credential
 * is the deployment's App, never anything a record or a request carried.
 *
 * Connections are reused rather than rebuilt per request. One provider per
 * repo+branch+root, so #100's installation token and branch-snapshot cache
 * are shared by every workspace on it and repeated resolutions do not grow
 * the GitHub request count. Reuse cannot weaken Req 10: #100 still reads the
 * sha a write conditions on fresh, whatever the cache holds.
 */
export function createRepoConnector(
  config: ServerConfig,
  options: ProviderOptions = {},
): WorkspaceBackendsOptions['connect'] | undefined {
  const { github } = config;
  if (!github) return undefined;
  const auth = appAuthFor(github, options);
  const connections = new Map<string, StorageProvider>();
  return (record, id) => {
    if (record.kind !== 'repo') throw new Error(`workspace ${id} has no repo connection to build`);
    const key = repoConnectionKey(record);
    let connected = connections.get(key);
    if (!connected) {
      const root = normalizeRoot(record.root);
      connected = createGitHubStorageProvider({
        owner: record.owner,
        repo: record.repo,
        branch: record.branch,
        ...(root ? { root } : {}),
        auth,
      });
      connections.set(key, connected);
    }
    // PRD 010 Req 17: the human-readable layout is this wrapper, not the
    // provider — the repo holds plain markdown at the connected root.
    return createWorkspaceRepoView(connected, id);
  };
}

/**
 * PRD 010 Req 15+16: the connect-your-GitHub-repo wizard's server side, built
 * from the deployment's App section alone — the same credentials the storage
 * connector uses, and the App's web-side slug for the install URL. Answers an
 * unconfigured deployment too: `createGitHubByo` with no auth reports the
 * choice unavailable by name rather than being absent and 404-ing.
 */
export function createGitHubByoApi(config: ServerConfig, options: ProviderOptions = {}): GitHubByo {
  const { github } = config;
  if (!github) return createGitHubByo();
  return createGitHubByo({
    auth: appAuthFor(github, options),
    ...(github.appSlug ? { appSlug: github.appSlug } : {}),
    webBase: github.webBase,
  });
}

export function createProviders(config: ServerConfig, options: ProviderOptions = {}): Providers {
  const storage = createStorage(config, options);
  if (config.mode === 'azure') {
    const { tenantId, clientId } = config.azure!;
    return {
      auth: createEntraAuthProvider(tenantId, clientId),
      storage,
      directory: createGraphDirectoryProvider(),
    };
  }
  return {
    auth: createMockAuthProvider(),
    storage,
    directory: createMockDirectoryProvider(),
  };
}
