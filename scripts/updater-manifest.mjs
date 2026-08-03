#!/usr/bin/env node
/**
 * SPEC19 §3.2: compose the tauri-updater `latest.json` manifest from the
 * release's signed artifacts. Pure core (composeManifest, unit-tested by
 * U42) + a small CLI used by the release workflow. Signatures are the
 * CONTENT of the .sig files (the manifest embeds them; they are not
 * separate downloads).
 *
 * CLI (compose — used by release.yml):
 *   node scripts/updater-manifest.mjs --version 0.2.0-alpha.5 \
 *     --notes "..." --mac-url URL --mac-sig-file PATH \
 *     --win-url URL --win-sig-file PATH --out latest.json
 *
 * CLI (decide — used by updater-manifest.yml, issue #19): print `advance …`
 * or `skip …` for a candidate version against the one the rolling `updater`
 * release currently serves, so the pointer cannot walk backwards:
 *   node scripts/updater-manifest.mjs --candidate 0.4.0-alpha.5 \
 *     --current-file current/latest.json [--force true]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** @typedef {{ platform: 'darwin-universal' | 'windows-x86_64', url: string, signature: string }} ManifestAsset */

/**
 * @param {{ version: string, notes: string, pubDate: string, assets: ManifestAsset[] }} input
 */
export function composeManifest({ version, notes, pubDate, assets }) {
  if (!version || typeof version !== 'string') throw new Error('composeManifest: version is required');
  if (typeof notes !== 'string') throw new Error('composeManifest: notes must be a string');
  if (!pubDate || Number.isNaN(Date.parse(pubDate))) throw new Error('composeManifest: pubDate must be a date');
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('composeManifest: at least one asset');

  const platforms = {};
  for (const a of assets) {
    if (a.platform !== 'darwin-universal' && a.platform !== 'windows-x86_64') {
      throw new Error(`composeManifest: unknown platform ${a.platform}`);
    }
    if (!a.url || !/^https:\/\//.test(a.url)) throw new Error(`composeManifest: bad url for ${a.platform}`);
    if (!a.signature || !a.signature.trim()) throw new Error(`composeManifest: missing signature for ${a.platform}`);
    // The darwin key doubles for both arches of a universal build.
    const keys =
      a.platform === 'darwin-universal' ? ['darwin-universal', 'darwin-aarch64', 'darwin-x86_64'] : ['windows-x86_64'];
    for (const key of keys) platforms[key] = { url: a.url, signature: a.signature.trim() };
  }

  return { version, notes, pub_date: new Date(pubDate).toISOString(), platforms };
}

// ---- Monotonic pointer guard (issue #19) --------------------------------
// Publishing an OLDER tag used to drag the updater endpoint backwards
// (publishing v0.4.0-alpha.4 after alpha.5 pointed every client at alpha.4).
// Ordering lives here, as a pure function, not in shell.

/**
 * Parse a semver string into its comparable parts. Returns null — never
 * throws — for anything unparseable, because "I cannot read the version the
 * endpoint currently serves" is a normal input on the recovery path.
 * @param {unknown} version
 */
export function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    // `undefined` = a full release, which outranks all of its pre-releases.
    prerelease: m[4] === undefined ? undefined : m[4].split('.'),
  };
}

/**
 * Semver precedence: -1 if a < b, 0 if equal, 1 if a > b. Throws on input
 * that does not parse (callers that tolerate junk use parseVersion first).
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa) throw new Error(`compareVersions: unparseable version ${JSON.stringify(a)}`);
  if (!pb) throw new Error(`compareVersions: unparseable version ${JSON.stringify(b)}`);

  for (const part of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (pa[part] !== pb[part]) return pa[part] < pb[part] ? -1 : 1;
  }
  // 0.4.0 > 0.4.0-alpha.5: a release outranks its own pre-releases.
  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;

  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    // A shorter set of identifiers loses: alpha < alpha.1.
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    if (ia === ib) continue;
    const na = /^\d+$/.test(ia);
    const nb = /^\d+$/.test(ib);
    // Numeric identifiers compare numerically (alpha.10 > alpha.9, not '10' < '9')
    // and always rank below alphanumeric ones.
    if (na && nb) return Number(ia) < Number(ib) ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    return ia < ib ? -1 : 1;
  }
  return 0;
}

/**
 * Decide whether the rolling `updater` release should be advanced to
 * `candidate` given the version it serves today. Pure; the workflow reads the
 * first word of `.decision` and the reason goes to the Actions log.
 *
 * Escape hatches are deliberate — the guard must never make the broken state
 * of issue #19 unrecoverable:
 *   - a missing/empty/unparseable current version advances (that IS the
 *     incident's end state: `gh release view updater --json assets` → `[]`);
 *   - `force` (a workflow_dispatch input) advances regardless, so a bad
 *     release can be rolled back by hand.
 * @param {{ candidate: string, current?: string | null, force?: boolean }} input
 * @returns {{ decision: 'advance' | 'skip', reason: string }}
 */
export function decideAdvance({ candidate, current, force = false }) {
  const cand = parseVersion(candidate);
  if (!cand) throw new Error(`decideAdvance: unparseable candidate version ${JSON.stringify(candidate)}`);
  const normalizedCandidate = String(candidate).trim().replace(/^v/, '');

  if (force) {
    return { decision: 'advance', reason: `forced: pointing the updater at ${normalizedCandidate} regardless of order` };
  }
  if (!parseVersion(current)) {
    return {
      decision: 'advance',
      reason: `the updater endpoint serves no readable version (${JSON.stringify(current ?? null)}) — advancing to ${normalizedCandidate}`,
    };
  }
  const order = compareVersions(candidate, /** @type {string} */ (current));
  if (order > 0) {
    return { decision: 'advance', reason: `${normalizedCandidate} is newer than the served ${current}` };
  }
  return {
    decision: 'skip',
    reason:
      order === 0
        ? `the updater endpoint already serves ${current} — nothing to advance`
        : `${normalizedCandidate} is older than the served ${current} — refusing to move the pointer backwards (re-run with force=true to override)`,
  };
}

/** Read a manifest's `version` off disk, tolerating missing/zero-byte/garbage files. */
function versionFromManifestFile(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

// ---- CLI ----------------------------------------------------------------
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const isCli = Boolean(process.argv[1] && process.argv[1].endsWith('updater-manifest.mjs'));

if (isCli && arg('candidate')) {
  // Decide mode: `advance <reason>` / `skip <reason>` on stdout. Exit 0 either
  // way — skipping is a normal outcome, not a failure; exit 1 only for input
  // the guard cannot reason about at all.
  const current = arg('current') ?? versionFromManifestFile(arg('current-file'));
  const force = /^(1|true|yes)$/i.test(arg('force') ?? '');
  try {
    const { decision, reason } = decideAdvance({ candidate: arg('candidate'), current, force });
    console.log(`${decision} ${reason}`);
  } catch (err) {
    console.error(`updater-manifest: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else if (isCli && arg('version')) {
  const assets = [];
  if (arg('mac-url')) {
    assets.push({
      platform: 'darwin-universal',
      url: arg('mac-url'),
      signature: readFileSync(arg('mac-sig-file'), 'utf8'),
    });
  }
  if (arg('win-url')) {
    assets.push({
      platform: 'windows-x86_64',
      url: arg('win-url'),
      signature: readFileSync(arg('win-sig-file'), 'utf8'),
    });
  }
  const manifest = composeManifest({
    version: arg('version'),
    notes: arg('notes') ?? '',
    pubDate: arg('pub-date') ?? new Date().toISOString(),
    assets,
  });
  writeFileSync(arg('out') ?? 'latest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`updater-manifest: wrote ${arg('out') ?? 'latest.json'} for v${manifest.version}`);
}
