# Security assessment — Marky Mark 0.2.0-alpha.1

*Reviewed 2026-07-08 against commit `bc07eee`. Focus: the network-isolation
guarantee ("the app never makes an outbound call"), plus general posture.
Fixes land via [SPEC11](../specs/SPEC11.md).*

## Verdict

The app is **almost** fully local. Application code contains **zero network
calls** (no fetch/XHR/WebSocket/beacon anywhere in `src/`), the Rust host has
**no network-capable dependencies** (no HTTP plugin, no updater, no
telemetry), and the web build is proven zero-request after load (test W4).
But the guarantee does not hold against **document and theme content**: three
render-side paths can make the OS webview issue outbound requests today, and
there is no CSP backstop. All three are closable — after SPEC11 the guarantee
becomes: *no outbound traffic ever, regardless of what file you open, enforced
by CSP and proven by tests*.

## Findings

| ID | Sev | Finding | Fix (SPEC11) |
| --- | --- | --- | --- |
| **N1** | **High** | **Remote images auto-fetch.** A document containing `![](https://…)` makes the webview fetch it on render — silent outbound, no user action. The sanitizer's GitHub schema allows `http(s)` image URLs and `src/platform/tauri.ts:123` passes them through untouched. Classic tracking-pixel vector. | §1: sanitize-strip remote image protocols, render an inert placeholder; §3: CSP blocks as backstop |
| **N2** | **High** | **No CSP at all** (`"csp": null` in tauri.conf.json; none in the web build). Nothing at the platform layer prevents any request if a render-side hole (known or future) is found. | §3: strict CSP — no remote origins — for desktop and web builds |
| **N3** | Med | **Theme guard misses `@import "https://…"`.** `hasRemoteUrls` only matches `url(...)` forms; a theme CSS using the string form of `@import` fetches remote CSS. | §2: theme guard v2 (comment-strip, then reject every remote-reference form) |
| **N4** | Med | **Link clicks are unmanaged.** Anchors in rendered documents are live; clicking one navigates the webview/page to the internet (turning the app into a browser). Exact desktop behavior unverified — pinned down and fixed by E46. | §4: intercept all clicks; external links open in the OS browser only (explicit, user-initiated), never in-app |
| **N5** | Low | About dialog's repo link relies on `target="_blank"` with no `opener:allow-open-url` permission granted — behavior undefined; should go through the same managed link path as N4. | §4/§5 |
| **L1** | Med (accepted) | **`fs:scope` is effectively full-disk** (`**` + `$HOME/**`). Product necessity for an open-anything file editor; consequence: a renderer compromise = disk access. Mitigation is exactly N1–N4 (no script execution + no exfil channel). *Decision for owner: keep (recommended, documented) or narrow at the cost of breaking files outside `$HOME`.* | §5 documents; optional tightening |
| **L2** | Low | `assetProtocol` scope `**`: any local file is readable as an image/asset URL inside a document. Local disclosure only — harmless while N1–N4 close the exfil channel; noted for awareness. | §5 documents |
| **S1** | Low | No continuous dependency-vulnerability gate (today: `npm audit` = 0 vulns, prod tree; cargo-audit not run). | §6: audit step in CI |

## What is already solid

- **App code**: the only URL in `src/` is the About dialog's GitHub link. No
  network APIs anywhere. React/CodeMirror/remark stack is local-only.
- **Rust host**: `tauri`, `plugin-fs`, `plugin-dialog`, `plugin-window-state`,
  `plugin-opener`, `serde` — nothing that can open a socket on its own. No
  auto-updater, no crash reporting, no telemetry.
- **Rendering**: `rehype-sanitize` (GitHub schema) strips scripts and event
  handlers — documents cannot execute code.
- **Web build**: single self-contained file; W4 asserts zero network requests
  after load. `index.html` has no external references (data: favicon).
- **Supply chain**: both lockfiles committed; license allowlist guard;
  `npm audit --omit=dev` clean today.

## Scope and assumptions

- OS-level traffic (macOS/WebView2 platform services, e.g. certificate or
  font services) is outside the app's control and this assessment's scope.
- "Open link in system browser" (SPEC11 §4) is user-initiated and happens in
  the *browser*, not the app; it is considered compatible with the guarantee.
- The guarantee is enforced in the app (sanitize + CSP) and **proven by CI**:
  adversarial-document tests (E46/W5) assert zero non-localhost requests, and
  a static scan of the built bundles asserts no network call sites ship.
