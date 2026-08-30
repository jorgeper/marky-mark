// PRD 007 Req 1: the production entry point. Starts under plain `node
// server/index.ts` on current Node LTS (≥22.18 strips types natively) with
// every setting supplied by environment variables, so the same code deploys
// unchanged to Azure App Service (Linux) — see server/README.md for the env
// var reference and both modes' start commands.

import http from 'node:http';
import process from 'node:process';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createLlmApi } from './llm.ts';
import { createProviders } from './providers/index.ts';

const config = loadConfig(process.env);
const providers = createProviders(config);
try {
  // Storage proves itself (the backing container exists) before the listener
  // accepts anything, so a misconfigured deployment exits with the reason
  // rather than serving 500s.
  await providers.storage.init?.();
} catch (err) {
  console.error(`marky-mark server: storage is unusable — ${(err as Error).message}`);
  process.exit(1);
}

// PRD 011 Req 8+13: the LLM routes, built from the optional LLM section. No
// section ⇒ an api that answers "not configured" and contacts nothing.
const llm = createLlmApi({ ...(config.llm ? { config: config.llm } : {}) });
const server = http.createServer(createApp(config.staticDir, providers, config.mode, llm));
server.listen(config.port, () => {
  console.log(
    `marky-mark server: mode=${config.mode} port=${config.port} static=${config.staticDir} ` +
      `(auth=${providers.auth.kind}, storage=${providers.storage.kind}, directory=${providers.directory.kind}, ` +
      // PRD 011 Req 7: the provider kind and model are operator-visible facts;
      // the key is not, and no log line here or anywhere in server/ carries it.
      `llm=${config.llm ? `${config.llm.kind}:${config.llm.model}` : 'none'})`,
  );
});
