// PRD 007 Req 1+4: the single-command local dev mode — `npm run server:local`
// arranges everything the server depends on with no manual steps: builds the
// SPA when dist/ is missing, boots Azurite (the offline Blob Storage
// emulator) from node_modules unless one is already listening, then starts
// the server in local mode (mock auth/directory + Azurite-backed storage).
// The e2e suite uses this same script as its Playwright webServer command.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

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

/** Newest mtime under a path (recursively for directories). */
function newestMtimeMs(p: string): number {
  const stat = statSync(p);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(p)) newest = Math.max(newest, newestMtimeMs(path.join(p, entry)));
  return newest;
}

// 1. A built SPA to serve — build when dist/ is absent OR older than the SPA
// sources. PRD 007 Req 5: the served bundle carries the hosted sign-in gate,
// so the e2e suite booting through this script must never test a stale dist.
const distIndex = path.join(root, 'dist', 'index.html');
const sources = ['src', 'index.html', 'vite.config.ts', 'package.json'].map((s) => path.join(root, s));
const stale =
  !existsSync(distIndex) ||
  statSync(distIndex).mtimeMs < Math.max(...sources.filter(existsSync).map(newestMtimeMs));
if (stale) {
  console.log('server:local — dist/ is missing or older than src/, building the SPA (npm run build)…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// 2. Azurite on the well-known dev endpoint, reused when already running
// (e.g. a second `server:local` or a developer's own emulator).
if (await portOpen(AZURITE_PORT)) {
  console.log(`server:local — reusing the Azurite already listening on :${AZURITE_PORT}`);
} else {
  const location = path.join(root, 'node_modules', '.cache', 'azurite');
  mkdirSync(location, { recursive: true });
  const azurite = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules', 'azurite', 'dist', 'src', 'blob', 'main.js'),
      '--silent',
      '--location', location,
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
