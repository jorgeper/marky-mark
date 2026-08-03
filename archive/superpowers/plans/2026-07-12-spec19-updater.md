# SPEC19 Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check for Updates… via tauri-plugin-updater with GitHub Releases as the server (SPEC19).

**Known conflict + resolution:** the goal text says "no amendments to existing tests", but U19/U20 pin the exact app/Help menu lists that SPEC19 §2.1 mandates the new item into. Resolved in favor of the spec's UX: U19/U20 get the minimal one-entry amendment ('checkUpdates' in their pinned lists), reported prominently.

### Task 1: dependencies + keys + secrets
- `npm i @tauri-apps/plugin-updater @tauri-apps/plugin-process`; `cargo add tauri-plugin-updater tauri-plugin-process` (in src-tauri).
- Generate keypair OUTSIDE the repo: `npm run tauri signer generate -- -w ~/.tauri/marky-mark-updater.key --password <random>` → capture pubkey. Report the path; never copy into the repo.
- `gh secret set TAURI_SIGNING_PRIVATE_KEY < keyfile`; `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- `npm run licenses` (four new packages must be allowlisted).

### Task 2: Rust + config + capability
- lib.rs: `.plugin(tauri_plugin_updater::Builder::new().build())`, `.plugin(tauri_plugin_process::init())`.
- tauri.conf.json: `"plugins": { "updater": { "pubkey": "<pub>", "endpoints": ["https://github.com/jorgeper/marky-mark/releases/download/updater/latest.json"] } }` + `"createUpdaterArtifacts": true` in bundle. CSP untouched.
- capabilities/default.json: + `"updater:default"`, `"process:default"`. cargo check regenerates schemas.

### Task 3: platform seam + shim mock
- types.ts: `updates?: { check(): Promise<{ version: string; notes: string } | null>; downloadAndInstall(onProgress: (pct: number) => void): Promise<void>; restart(): Promise<void> }`.
- tauri.ts: implement via plugin-updater `check()` (hold the Update object in a closure between check and install; progress from Started/Progress/Finished events with contentLength math) + plugin-process `relaunch()`.
- browser.ts: `window.__mmUpdate = { next: null | {version, notes} | {error}, progress: number[], installed: boolean, restarted: boolean }`; updates mock reads `next`, records; check throws on `{error}`.

### Task 4: command, menu (U41 + U19/U20 minimal amendments)
- commands.ts `checkUpdates`; menuSpec: macOS app menu `[about, checkUpdates, sep, settings…]`, Windows Help `[help, sep, about, checkUpdates]` — label "Check for Updates…", no accelerator.
- U19: app list → `['about', 'checkUpdates', 'settings', 'close']`; U20: Help → `['help', 'about', 'checkUpdates']`. U41 new: placement + label + no accelerator + present on both layouts.

### Task 5: UpdateDialog + App wiring
- components/UpdateDialog.tsx: props {currentVersion, updates: Platform['updates'], onClose}; internal state machine checking → none/available/progress/ready/error; test ids per SPEC19 §2.2 (`update-dialog, update-checking, update-none, update-available, update-install, update-later, update-progress, update-restart, update-error`); runs check() on mount; install → downloadAndInstall(setPct) → ready; restart → updates.restart().
- App: `updateOpen` state; `checkUpdates` command opens when platform.updates exists (silent no-op otherwise); render dialog with `__APP_VERSION__`. Styles: reuse `.modal` + small additions.

### Task 6: manifest script + workflows (U42)
- scripts/updater-manifest.mjs: export pure `composeManifest({version, notes, pubDate, assets: [{platform: 'darwin-universal'|'windows-x86_64', url, signature}]})` → schema `{version, notes, pub_date, platforms: {...: {url, signature}}}`, throwing on missing fields; CLI wrapper reads sig files + release URLs (used by CI).
- release.yml: signing env on build jobs; upload `.app.tar.gz`/`.sig` (mac), nsis `.exe.sig` (win); a step composing latest.json into the draft assets.
- NEW .github/workflows/updater-manifest.yml: `on: release: types [published]` (ignore the rolling tag itself) → download latest.json from the published release → `gh release create/edit updater` (non-prerelease pointer) → upload-clobber latest.json.
- U42 imports composeManifest directly.

### Task 7: e2e E69/E70
- E69 (shim): `__mmUpdate.next = {version:'9.9.9', notes:'big fixes'}` → menuClick checkUpdates → available shows both → install → progress → 100 → restart button → click → `restarted === true`. Then next=null path → `update-none` shows current version.
- E70: next={error:'offline'} → `update-error` contains 'offline' → dismiss → app alive (open doc still renders) → set next={version…} → second check succeeds.

### Task 8: docs + gate
- README (Updates note + privacy bullet amendment), docs/security/assessment.md (precise network story), docs/RELEASING.md (artifacts, rolling release, publish flow).
- Gate: validate; signed local build (env from keyfile) → tar.gz+sig exist; manifest script emits valid json from them; DoD greps (no "minisign encrypted secret key" in repo, reserved names, tauri.conf diff scope, aux capability untouched, gh secret list, gh workflow list); commit; report (deviation note included).
