// PRD 007 Req 1: the production entry point. Starts under plain `node
// server/index.ts` on current Node LTS (≥22.18 strips types natively) with
// every setting supplied by environment variables, so the same code deploys
// unchanged to Azure App Service (Linux) — see server/README.md for the env
// var reference and both modes' start commands.

import http from 'node:http';
import process from 'node:process';
import { createApp } from './app.ts';
import { createWorkspaceBackends } from './backends.ts';
import { loadConfig } from './config.ts';
import { createGitHubByoApi, createProviders, createRepoConnector } from './providers/index.ts';

const config = loadConfig(process.env);
const providers = createProviders(config);
// PRD 010 Req 17: where the backends are wired — a workspace whose record
// names a repo is served from it, through the deployment's GitHub App. Absent
// App section, absent connector: such a workspace then reports the named
// refusal from `backends.ts` rather than being served from the wrong store.
const connect = createRepoConnector(config);
const backends = createWorkspaceBackends({
  deploymentDefault: providers.storage,
  ...(connect ? { connect } : {}),
});
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

// PRD 010 Req 15+16: the wizard's routes, built from the same App section.
const byo = createGitHubByoApi(config);
const server = http.createServer(createApp(config.staticDir, providers, config.mode, backends, byo));
server.listen(config.port, () => {
  console.log(
    `marky-mark server: mode=${config.mode} port=${config.port} static=${config.staticDir} ` +
      `(auth=${providers.auth.kind}, storage=${providers.storage.kind}, directory=${providers.directory.kind})`,
  );
});
