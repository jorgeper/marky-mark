# SPEC19: Marky Mark v19 — Check for Updates (GitHub-releases updater)

Delta spec on top of SPEC.md–SPEC18.md as implemented (all green: U1–U40,
E1–E41 + E45–E68, W1–W7; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §8 is the goal condition.

**What ships:** **Check for Updates…** in the app menu, backed by the
official `tauri-plugin-updater` with **GitHub Releases as the update
server**: a manual, user-initiated check against a rolling `updater`
release manifest, then one-click download → signature verification →
install → relaunch. The viewer's zero-network guarantee is untouched — all
network happens Rust-side, only when the user asks, and the docs say so
precisely.

Out of scope: automatic/scheduled checks (strictly manual in v19), delta
updates, downgrade UI, Linux, changelog rendering beyond the release note
text, in-place update of the *currently installed* pre-SPEC19 build (the
first hop is always a manual download).

---

## 1. Trust & endpoint model (FR-T)

1. **Signing:** a minisign keypair generated once (`tauri signer
   generate`). The **public key** lives in `tauri.conf.json`'s updater
   config (committed); the **private key + password live only in GitHub
   Actions secrets** (`TAURI_SIGNING_PRIVATE_KEY`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and in a local untracked backup
   the human is told to store safely. **No private-key material may ever
   be committed** (§8.4 greps for it).
2. **Endpoint:** `https://github.com/jorgeper/marky-mark/releases/download/updater/latest.json`
   — a **rolling release tagged `updater`** (GitHub's `releases/latest`
   skips pre-releases, so alphas need this indirection). Draft releases
   remain invisible: the rolling manifest only advances on *publish* (§3).
3. Version comparison, download, signature verification, install, and
   relaunch are all the plugin's stock behavior — no hand-rolled crypto or
   installer logic.

## 2. App UX (FR-U)

1. Command **`checkUpdates`**; menu item **"Check for Updates…"** — macOS:
   app menu directly after About; Windows: Help menu after About. Always
   present on desktop; the web build is untouched (no hamburger change).
2. Invoking opens an in-app modal (`update-dialog`) that walks the states:
   **checking** (`update-checking`) → **up to date** (`update-none`, shows
   the current version) or **available** (`update-available`: new version
   + release-note text, buttons `update-install` / `update-later`) →
   **downloading** (`update-progress`, live byte progress) → **ready**
   (`update-restart` button relaunches). Errors (offline, malformed
   manifest, bad signature) land in a friendly `update-error` state with
   the reason — never a crash, never a partial install.
3. **Platform seam** (SPEC FR-6 discipline — app code never imports plugin
   APIs): `Platform.updates?: { check(): Promise<{ version: string; notes:
   string } | null>; downloadAndInstall(onProgress: (pct: number) => void):
   Promise<void>; restart(): Promise<void> }`. `tauri.ts` implements it
   with `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`;
   `web.ts` leaves it undefined; the shim implements a mock driven by a
   `window.__mmUpdate` test hook (next-check result: null / a version /
   an error; records installs and restarts) — the e2e seam.

## 3. Release pipeline (FR-C)

1. `tauri.conf.json`: updater plugin config (pubkey, the §1.2 endpoint)
   and `bundle.createUpdaterArtifacts: true` — release builds emit
   `.app.tar.gz` + `.sig` (macOS) and NSIS `.exe` + `.sig` (Windows)
   alongside today's assets. These are the *only* tauri.conf changes; CSP
   untouched.
2. `release.yml`: signing env vars from secrets; the updater artifacts and
   a generated **`latest.json`** (per-platform URLs into that release's
   assets, signatures, version, notes, pub_date) join the draft release's
   assets. The manifest is composed by a pure script
   (`scripts/updater-manifest.mjs`) — unit-testable core (U42).
3. **New workflow `updater-manifest.yml`** — `on: release: types:
   [published]`: copies the published release's `latest.json` (+ any
   assets it references stay where they are — the manifest points at the
   versioned release's URLs) onto the rolling `updater` release, creating
   that release (marked as a plain, non-pre-release, clearly described
   pointer) if absent. Publishing stays the human act it is today;
   updates start flowing the moment they flip the draft.
4. Rust: `tauri_plugin_updater` + `tauri_plugin_process` registered in
   `lib.rs`; main-window capability gains `updater:default` and
   `process:default` (aux capability unchanged — still no extra grants).

## 4. Dependencies (deliberately granted)

Exactly four, the ecosystem-standard updater pair: cargo
`tauri-plugin-updater` + `tauri-plugin-process`; npm
`@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`.
`npm run licenses` regenerated; the allowlist gate must stay green.

## 5. Privacy story (FR-P)

1. README's privacy bullet and `docs/security/assessment.md` are amended
   precisely: the document viewer still never touches the network (CSP,
   sanitize, bundle scan, W4/W5 — all unchanged and still enforced); the
   ONLY network the app performs is the **user-initiated** update check
   and download, Rust-side, exclusively to the two GitHub endpoints, with
   responses verified against the baked-in public key. No telemetry, no
   auto-checks.
2. The static bundle scan and web e2e network assertions must pass
   byte-for-byte unchanged — the webview gains no fetch call sites.

## 6. Tests (added: U41–U42, E69–E70)

1. **U41** — menu: "Check for Updates…" after About (app menu on macOS,
   Help on Windows), no accelerator, present regardless of other state.
2. **U42** — the manifest composer: given artifact names/signatures/notes
   → valid updater schema (platforms keyed `darwin-universal` /
   `windows-x86_64`, URLs, signatures, version, notes, pub_date);
   malformed inputs throw rather than emit a broken manifest.
3. **E69** — the dialog flow (shim mock): menu → checking → available
   (version + notes shown) → install (progress reaches 100%) → restart
   recorded on `__mmUpdate`; and the up-to-date path shows `update-none`
   with the current version.
4. **E70** — failure honesty: mock error ⇒ `update-error` with the
   message, dialog dismissable, app fully functional after; a second
   check can succeed (state resets).
5. No other existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved; W1–W7 unchanged.

## 7. Docs

1. README: a short "Updates" note (manual check, GitHub-hosted, signed) +
   the amended privacy bullet. RELEASING.md: the new artifacts, the
   rolling `updater` release, and the publish flow (unchanged human act).

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U42, E1–E41 +
   E45–E70, W1–W7**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) with the signing key in env exits 0 and
   the bundle dir contains `Marky Mark.app.tar.gz` + `.sig`; the manifest
   script run against those artifacts emits a schema-valid `latest.json`.
3. `gh secret list` shows `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the private key exists in an
   untracked local file whose path is reported to the human.
4. No private-key material in the repo:
   `git grep -l "minisign encrypted secret key"` prints nothing; the
   reserved-name scan prints nothing; `git diff` for tauri.conf.json shows
   only the §3.1 additions (CSP byte-identical); aux capability unchanged.
5. `npm run licenses` green with the four new packages;
   `git diff --stat docs/specs/` empty; no `.skip/.only/.todo` in tests/;
   version files untouched (0.2.0-alpha.4).
6. README, security assessment, and RELEASING.md updated per §5/§7; both
   workflows valid (`gh workflow list` shows updater-manifest).
