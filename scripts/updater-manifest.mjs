#!/usr/bin/env node
/**
 * SPEC19 §3.2: compose the tauri-updater `latest.json` manifest from the
 * release's signed artifacts. Pure core (composeManifest, unit-tested by
 * U42) + a small CLI used by the release workflow. Signatures are the
 * CONTENT of the .sig files (the manifest embeds them; they are not
 * separate downloads).
 *
 * CLI:
 *   node scripts/updater-manifest.mjs --version 0.2.0-alpha.5 \
 *     --notes "..." --mac-url URL --mac-sig-file PATH \
 *     --win-url URL --win-sig-file PATH --out latest.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

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

// ---- CLI ----------------------------------------------------------------
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && process.argv[1].endsWith('updater-manifest.mjs') && arg('version')) {
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
