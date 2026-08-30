// PRD 007 Req 1+4: the single-command local dev mode — `npm run server:local`
// arranges everything the server depends on with no manual steps: builds the
// SPA when dist/ is missing, boots Azurite (the offline Blob Storage
// emulator) from node_modules unless one is already listening, then starts
// the server in local mode (mock auth/directory + Azurite-backed storage).
// The e2e suite uses this same script as its Playwright webServer command.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { ensureSpaBuilt } from './devSpa.ts';

const root = path.resolve(import.meta.dirname, '..');
const AZURITE_PORT = 10000; // the well-known dev-storage blob port

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`);
}

// 1. A built SPA to serve — the shared step of server/devSpa.ts.
ensureSpaBuilt(root);

// 2. Azurite on the well-known dev endpoint, reused when already running
// (e.g. a second `server:local` or a developer's own emulator).
if (await portOpen(AZURITE_PORT)) {
  console.log(`server:local — reusing the Azurite already listening on :${AZURITE_PORT}`);
} else {
  // Issue #179: the e2e lane (playwright.config.ts sets MM_AZURITE_IN_MEMORY=1)
  // keeps Azurite's store in RAM, so nothing — a killed test's crash-safe
  // draft, a previous gate run's workspaces — survives into the next run or
  // rides along when node_modules is copied into a fresh worktree. Hand-run
  // `server:local` keeps persisting under node_modules/.cache/azurite; delete
  // that directory to wipe local hosted state (server/README.md § Local
  // development).
  const inMemory = process.env.MM_AZURITE_IN_MEMORY === '1';
  const location = path.join(root, 'node_modules', '.cache', 'azurite');
  if (!inMemory) mkdirSync(location, { recursive: true });
  const azurite = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules', 'azurite', 'dist', 'src', 'blob', 'main.js'),
      '--silent',
      ...(inMemory ? ['--inMemoryPersistence'] : ['--location', location]),
      '--blobHost', '127.0.0.1',
      '--blobPort', String(AZURITE_PORT),
      // The SDK's service API version usually runs ahead of the emulator's
      // supported list; the endpoints this server uses are all long-stable.
      '--skipApiVersionCheck',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  const stop = () => {
    azurite.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  azurite.on('exit', (code) => {
    console.error(`server:local — Azurite exited (${code}); storage is gone, stopping`);
    process.exit(1);
  });
  await waitForPort(AZURITE_PORT, 30_000);
  console.log(`server:local — Azurite (blob) listening on :${AZURITE_PORT}`);
}

// 3. The server itself, in local mode, in this process.
process.env.MM_MODE ??= 'local';
process.env.PORT ??= '4924';
process.env.MM_STATIC_DIR ??= path.join(root, 'dist');
await import('./index.ts');
