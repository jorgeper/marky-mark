// PRD 007 Req 3+4: provider selection — the one switch that turns config into
// a wired provider set. 'azure' composes Entra ID + Blob Storage + Graph;
// 'local' composes the seeded mocks for auth + directory and the SAME Azure
// Blob Storage implementation pointed at Azurite's dev endpoint, so the real
// storage code path is exercised offline.
//
// PRD 010 Req 1+5: storage is selected by its OWN knob, orthogonally — the
// mode still picks auth and directory and nothing else, so all four
// combinations wire.

import type { ServerConfig } from '../config.ts';
import { createBlobStorageProvider } from './azure/blob.ts';
import { createEntraAuthProvider } from './azure/entra.ts';
import { createGraphDirectoryProvider } from './azure/graph.ts';
import { createGitHubAppAuth, type FetchLike } from './github/auth.ts';
import { createGitHubStorageProvider } from './github/storage.ts';
import { createMockAuthProvider } from './mock/auth.ts';
import { createMockDirectoryProvider } from './mock/directory.ts';
import type { Providers, StorageProvider } from './types.ts';

export interface ProviderOptions {
  /** Injected for tests — the GitHub fake, never the network. */
  fetchImpl?: FetchLike;
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
  const { appId, privateKey, apiBase, defaultRepo } = config.github!;
  const { owner, repo, branch, root } = defaultRepo!;
  const { fetchImpl } = options;
  return createGitHubStorageProvider({
    owner,
    repo,
    branch,
    ...(root ? { root } : {}),
    // PRD 010 Req 5: today's layout, unchanged — `workspaces/<uuid>/…` and
    // `users/…` at those repo-relative paths, on one branch. #100's provider
    // used as-is: no per-workspace branch, no path mangling, no id
    // translation.
    auth: createGitHubAppAuth({ appId, privateKey, apiBase, ...(fetchImpl ? { fetchImpl } : {}) }),
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
