#!/usr/bin/env node
/**
 * release:prepare (SPEC10 §1): move the app version in lock-step across
 * package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml, refresh
 * both lockfiles, print a scoped diffstat, and commit — or, with --no-commit,
 * leave the tree for inspection. A rerun with the version already in place is
 * a no-op. The pre-release identifier is preserved verbatim, never stripped.
 *
 * The version-apply helpers are exported pure string transforms so the unit
 * suite (U16) exercises exactly the code that rewrites the release files.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Strict semver (semver.org's official pattern): pre-release and build
// metadata allowed, leading zeros and partial versions rejected.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isValidSemver(v) {
  return typeof v === 'string' && SEMVER_RE.test(v);
}

/** Rewrite only the top-level "version" field of a package.json-style file. */
export function setJsonVersion(content, version) {
  return content.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
}

/** Rewrite only the [package] version line of a Cargo.toml. */
export function setCargoVersion(content, version) {
  return content.replace(/^version = "[^"]*"/m, `version = "${version}"`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  PATH: `${path.join(homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}`,
};

const VERSION_FILES = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'];
const LOCK_FILES = ['package-lock.json', 'src-tauri/Cargo.lock'];

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    console.error(`release:prepare: \`${cmd} ${args.join(' ')}\` failed`);
    process.exit(res.status ?? 1);
  }
  return res;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const noCommit = args.includes('--no-commit');
  const version = args.filter((a) => a !== '--no-commit')[0];

  if (!version || !isValidSemver(version)) {
    console.error(
      `release:prepare: ${version ? `"${version}" is not valid semver` : 'missing version'}.\n` +
        'Usage: npm run release:prepare -- <semver> [--no-commit]   (e.g. 0.2.0-alpha.2)',
    );
    process.exit(1);
  }

  const contents = VERSION_FILES.map((f) => readFileSync(path.join(root, f), 'utf8'));
  const current = [
    JSON.parse(contents[0]).version,
    JSON.parse(contents[1]).version,
    /^version = "([^"]*)"/m.exec(contents[2])?.[1],
  ];
  if (current.every((v) => v === version)) {
    console.log(`release:prepare: all three version files already at ${version} — no-op.`);
    return;
  }

  writeFileSync(path.join(root, VERSION_FILES[0]), setJsonVersion(contents[0], version));
  writeFileSync(path.join(root, VERSION_FILES[1]), setJsonVersion(contents[1], version));
  writeFileSync(path.join(root, VERSION_FILES[2]), setCargoVersion(contents[2], version));

  console.log(`release:prepare: version → ${version}; refreshing lockfiles…`);
  run('npm', ['install', '--package-lock-only']);
  run('cargo', ['metadata', '--format-version', '1'], {
    cwd: path.join(root, 'src-tauri'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  console.log('\nrelease:prepare: diffstat (version files + lockfiles):');
  run('git', ['diff', '--stat', '--', ...VERSION_FILES, ...LOCK_FILES]);

  if (noCommit) {
    console.log('release:prepare: --no-commit — working tree left for inspection.');
    return;
  }
  run('git', ['commit', '-m', `chore: release v${version}`, '--', ...VERSION_FILES, ...LOCK_FILES]);
  console.log(`release:prepare: committed chore: release v${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
