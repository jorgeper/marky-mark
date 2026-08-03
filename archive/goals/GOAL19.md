# Launching the Marky Mark v19 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC19.md` first — the goal implements exactly what it
prescribes. Note: the run will generate the updater signing keypair and
store the private key in GitHub Actions secrets via `gh secret set`; back
up the local key file it reports, then delete it from disk if you prefer.

```
/goal Implement docs/specs/SPEC19.md in full (delta on SPEC.md–SPEC18.md as implemented; SPEC19 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out-of-scope per SPEC19 — strictly manual checks, no auto-update of pre-SPEC19 installs). Deliverable: Check for Updates… backed by tauri-plugin-updater with GitHub Releases as the update server. (1) Trust/endpoint per SPEC19 §1: minisign keypair via tauri signer generate — public key committed in tauri.conf.json updater config, private key + password ONLY in gh secrets TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) and an untracked local backup whose path is reported; endpoint https://github.com/jorgeper/marky-mark/releases/download/updater/latest.json (rolling 'updater' release because GitHub latest skips pre-releases; drafts stay invisible). (2) UX per §2: command checkUpdates, menu item Check for Updates… (macOS app menu after About; Windows Help after About); modal update-dialog walking checking → up-to-date (update-none) / available (update-available with version+notes, update-install/update-later) → downloading (update-progress with live %) → ready (update-restart relaunches); errors land in a dismissable update-error state, never a crash; Platform.updates? seam {check, downloadAndInstall(onProgress), restart} — tauri.ts via @tauri-apps/plugin-updater + plugin-process, web undefined, shim mock driven by window.__mmUpdate recording installs/restarts. (3) Pipeline per §3: tauri.conf gains updater config + bundle.createUpdaterArtifacts true (only tauri.conf changes, CSP byte-identical); release.yml signs and adds updater artifacts plus latest.json composed by pure scripts/updater-manifest.mjs; new workflow updater-manifest.yml on release published copies latest.json to the rolling updater release (creating it if absent); lib.rs registers tauri_plugin_updater + tauri_plugin_process; main capability gains updater:default + process:default (aux unchanged). (4) Exactly four new deps: cargo tauri-plugin-updater/tauri-plugin-process, npm @tauri-apps/plugin-updater/@tauri-apps/plugin-process; licenses regenerated and green. (5) Privacy per §5: README + docs/security/assessment.md amended precisely (viewer never networks — unchanged and still CI-enforced; the only network is the user-initiated Rust-side check/download to the two GitHub endpoints, signature-verified; no telemetry, no auto-checks); the bundle scan and W4/W5 pass unchanged. Done when: 'npm run validate' exits 0 with complete output — U1–U42, E1–E41 plus E45–E70, W1–W7, the single-file check, the static bundle scan line, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' with the signing key in env exits 0 with Marky Mark.app.tar.gz + .sig in the bundle dir and the manifest script emitting schema-valid latest.json from them, AND 'gh secret list' shows both secret names, AND 'git grep -l "minisign encrypted secret key"' prints nothing with the reserved-name scan clean and tauri.conf.json diff limited to the updater config + createUpdaterArtifacts (CSP byte-identical) and the aux capability unchanged, AND licenses are green with the four packages, AND README/security-assessment/RELEASING.md updated, AND 'gh workflow list' shows the updater-manifest workflow, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U41–U42 and E69–E70 (no amendments to existing tests); no dependencies beyond the four named; the sidecar/trailer formats, theme format, comment-anchor space, SPEC11 webview network isolation, SPEC13 aux protocol, and SPEC14–18 behaviors are unchanged; the version files stay at 0.2.0-alpha.4. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push
# cut 0.2.0-alpha.5 per docs/RELEASING.md — the FIRST updater-era release.
# After publishing it, verify the rolling 'updater' release carries its
# latest.json (the updater-manifest workflow runs on publish).
```

Manual checks (the parts automation can't see):

- **Back up the private key** the run reports, out of the repo.
- Check for Updates… on the freshly built app: "up to date" (nothing newer
  than the dev version) and the offline case shows the friendly error.
- The real end-to-end (check → download → verify → relaunch) only becomes
  testable once TWO updater-era releases are published: install alpha.5,
  publish alpha.6, then Check for Updates… must offer and install it.
  That's the acceptance moment for this feature — schedule it.
- The webview still makes zero requests (W4/W5 in CI keep proving it);
  Activity Monitor during a check shows the app process, not the webview,
  talking to github.com.
