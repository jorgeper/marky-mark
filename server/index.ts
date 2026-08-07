// PRD 007 Req 1: the production entry point. Starts under plain `node
// server/index.ts` on current Node LTS (≥22.18 strips types natively) with
// every setting supplied by environment variables, so the same code deploys
// unchanged to Azure App Service (Linux) — see server/README.md for the env
// var reference and both modes' start commands.

import http from 'node:http';
import process from 'node:process';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createProviders } from './providers/index.ts';

const config = loadConfig(process.env);
const providers = createProviders(config);
try {
  // PRD 010 Req 6: the storage backend proves itself BEFORE the listener
  // accepts anything — on the github backend that is the default repo being
  // reachable with contents read/write. A deployment that cannot write where
  // it was pointed exits here with the reason, rather than serving 500s.
  await providers.storage.init?.();
} catch (err) {
  console.error(`marky-mark server: storage is unusable — ${(err as Error).message}`);
  process.exit(1);
}

const server = http.createServer(createApp(config.staticDir, providers, config.mode));
server.listen(config.port, () => {
  console.log(
    `marky-mark server: mode=${config.mode} port=${config.port} static=${config.staticDir} ` +
      `(auth=${providers.auth.kind}, storage=${providers.storage.kind}, directory=${providers.directory.kind})`,
  );
});
