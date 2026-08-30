// PRD 007 Req 3+4: provider selection — the one switch that turns config into
// a wired provider set. 'azure' composes Entra ID + Blob Storage + Graph;
// 'local' composes the seeded mocks for auth + directory and the SAME Azure
// Blob Storage implementation pointed at Azurite's dev endpoint, so the real
// storage code path is exercised offline.

import type { ServerConfig } from '../config.ts';
import { createBlobStorageProvider } from './azure/blob.ts';
import { createEntraAuthProvider } from './azure/entra.ts';
import { createGraphDirectoryProvider } from './azure/graph.ts';
import { createOboTokenSource } from './azure/obo.ts';
import { createMockAuthProvider } from './mock/auth.ts';
import { createMockDirectoryProvider } from './mock/directory.ts';
import type { Providers } from './types.ts';

export function createProviders(config: ServerConfig): Providers {
  // loadConfig guarantees a connection string (azure mode requires it, local
  // mode defaults to Azurite's), so blob storage always wires.
  const storage = createBlobStorageProvider(config.storage.connectionString, config.storage.container);
  if (config.mode === 'azure') {
    const { tenantId, clientId, clientSecret } = config.azure!;
    return {
      auth: createEntraAuthProvider(tenantId, clientId),
      storage,
      // PRD 007 Req 6 (issue #180): Graph acts as the caller via the
      // on-behalf-of exchange — never with the session id_token itself.
      directory: createGraphDirectoryProvider(
        fetch,
        createOboTokenSource({ tenantId, clientId, clientSecret }),
      ),
    };
  }
  return {
    auth: createMockAuthProvider(),
    storage,
    directory: createMockDirectoryProvider(),
  };
}
