// PRD 007 Req 3+4: provider selection — the one switch that turns config into
// a wired provider set. 'azure' composes Entra ID + Blob Storage + Graph;
// 'local' composes the seeded mocks for auth + directory and the SAME Azure
// Blob Storage implementation pointed at Azurite's dev endpoint, so the real
// storage code path is exercised offline.

import type { ServerConfig } from '../config.ts';
import { createBlobStorageProvider } from './azure/blob.ts';
import { createEntraAuthProvider } from './azure/entra.ts';
import { createGraphDirectoryProvider } from './azure/graph.ts';
import { createMockAuthProvider } from './mock/auth.ts';
import { createMockDirectoryProvider } from './mock/directory.ts';
import type { Providers } from './types.ts';

export function createProviders(config: ServerConfig): Providers {
  const storage = createBlobStorageProvider(config.storage.connectionString, config.storage.container);
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
