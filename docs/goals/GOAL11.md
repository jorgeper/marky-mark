# Launching the Marky Mark v11 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/security/assessment.md` and `docs/specs/SPEC11.md` first — the goal
implements exactly what they prescribe.

```
/goal Implement docs/specs/SPEC11.md in full (delta on SPEC.md–SPEC10.md as implemented; SPEC11 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out of scope: OS-level platform traffic, signing/notarization, sandboxing the Rust process). The deliverable is the network-isolation guarantee: no outbound request from app code, dependencies, documents, or themes — enforced by sanitize-layer stripping AND a strict CSP, and proven by adversarial tests. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U18, desktop e2e E1–E41 plus E45 and E46, web e2e W1–W5, the single-file check, the static bundle scan line (no XMLHttpRequest/WebSocket/sendBeacon/EventSource call sites; fetch( count matches the committed allowlist, expected 0), and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND grep shows a non-null "csp" in src-tauri/tauri.conf.json containing no http:/https: source other than asset.localhost, AND a fresh 'npm run build:web' produces dist-web/index.html containing a Content-Security-Policy meta tag with connect-src 'none', AND fixtures/adversarial.md exists (remote image, protocol-relative image, remote link, local image, fragment link) and E46/W5 assert zero non-localhost requests while rendering it and that clicking its remote link never navigates the app, AND rendering a remote image yields a visible inert placeholder naming the blocked origin, AND themes containing '@import "https://…"' or url(//…) are rejected (U17) while all built-in themes still parse and URLs inside CSS comments stay allowed, AND src-tauri/capabilities/default.json grants opener:allow-open-url restricted to http/https and the About repo link plus document links open through the managed path (OS browser on desktop, noopener new tab on web), AND 'npm run tauri build' (macOS) exits 0 with the app path and size printed, AND .github/workflows/release.yml parses cleanly and its test job runs 'npm audit --omit=dev --audit-level=high' and a cargo audit step, AND docs/security/assessment.md has a Status column marking N1–N5 fixed and L1/L2 accepted, README's privacy bullet links to it, and ARCHITECTURE.md gains the "Security model & network isolation" section, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test additions are U17, U18, E46, W5 (E13/E45 and all existing tests unchanged); the comment sidecar/trailer formats, theme metadata format, and all existing user-visible behavior except the three closed network paths must be unchanged; no new runtime dependencies for the fixes; the version files stay at their current version. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship the hardening
# optionally cut 0.2.0-alpha.2 per docs/RELEASING.md to get hardened builds out
```

Manual checks: open a markdown file containing `![](https://example.com/x.png)`
— you should see the 🚫 placeholder and (via Little Snitch/Proxyman if you
like) zero traffic; click an external link — your browser opens, the app
stays put; drop a theme with `@import "https://evil.example/x.css"` into the
themes folder — it is rejected on reload.
