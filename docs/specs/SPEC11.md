# SPEC11: Marky Mark v11 — network isolation guarantee & security hardening

Delta spec on top of SPEC.md–SPEC10.md as implemented (SPEC8 still pending,
E42–E44 reserved). Driven by the findings in
[docs/security/assessment.md](../security/assessment.md) (N1–N5, L1–L2, S1) —
read it first; this spec is the fix list. §8 is the goal condition.

**The guarantee being shipped:** Marky Mark never makes an outbound network
request — not from app code, not from dependencies, and *not from anything a
document or theme can contain*. Fully local, enforced in two independent
layers (content sanitization + Content-Security-Policy) and **proven by
tests** that render adversarial content and assert zero non-local traffic.

> **Amendment (issue #114, 2026-08-07):** the guarantee above is **kept, but
> stated conditionally**, because PRD 011 gave the app an opt-in LLM path.
> Precisely, and in this order of strength:
>
> 1. **Unconditional, unchanged:** *no outbound request ever originates from a
>    **document**, a **theme**, or a **dependency*** — whatever file you open,
>    whatever theme you load. §1 (sanitize), §2 (theme guard), §3 (CSP on both
>    targets) and the adversarial proof suite (U17/U18/E46/W5) are untouched
>    and still enforced. This is the promise a reader of a Markdown viewer
>    cares about, and it did not weaken.
> 2. **Conditional, new:** beyond that, the app makes **no outbound request at
>    all unless** the user (desktop) or the operator (hosted) has **configured
>    an LLM provider** *and* **invoked a feature that uses it**. PRD 011 Req
>    16: every request is attributable to a user action — none at startup,
>    none in the background, none speculative. Configure nothing and the app
>    is exactly as silent as it was before PRD 011.
> 3. **Where a request originates, per flavor:**
>    - **Desktop** — from the **Rust shell**, via the `llm_request` command
>      (PRD 011 Req 12), the same shape as SPEC19's updater. The webview's CSP
>      is **not widened**: `connect-src` still allows only `ipc:` /
>      `http://ipc.localhost`, so the webview itself still opens nothing.
>    - **Hosted** — from the browser to the **app's own origin**
>      (`/api/llm…`), never to a provider host (PRD 011 Req 13). The key is
>      the operator's, held server-side; no provider host string exists in
>      `src/`.
>    - **Static web** (the single-file build) — **no LLM path at all** (PRD
>      011 Req 14). Its CSP keeps `connect-src 'none'`, so its zero-outbound
>      property stays *unconditional*. Guarded in the fast tier by U556–U558
>      (`tests/unit/static-web-no-llm.test.ts`).
> 4. **The updater exception (SPEC19) still stands** and is not re-litigated:
>    strictly user-initiated, Rust-side, signature-verified, GitHub Releases
>    only.
>
> One sentence, for the docs that restate this: *Marky Mark makes no outbound
> request from documents, themes or dependencies, ever — and none at all
> unless you (or, on a hosted deployment, your operator) configured an LLM
> provider and used a feature that needs it.*

Out of scope: OS-level platform traffic (Apple/WebView2 services); signing/
notarization (future SPEC); sandboxing the Rust process.

---

## 1. Remote images never load (fixes N1)

1. The sanitize schema restricts `img src` to **local protocols only**:
   relative paths, `data:`, `blob:`, `asset:` (and Windows'
   `https://asset.localhost` rewrite, which CSP §3 whitelists). `http:`/
   `https:`/protocol-relative image URLs are stripped at sanitize time — the
   DOM never contains a remote URL to fetch.
2. A stripped image renders as an inert placeholder (alt text + the blocked
   origin, e.g. `🚫 remote image (example.com) — Marky Mark is local-only`),
   so users understand why. No setting to re-enable in v11 — the guarantee is
   unconditional.
3. `src/platform/tauri.ts`'s image-src rewriter no longer passes
   `http(s):` through (only `data:`/`blob:`/`asset:` pass; everything else
   resolves as a local path or is dropped).

## 2. Theme guard v2 (fixes N3)

1. `parseTheme` rejection upgraded: strip CSS comments first, then reject the
   theme if the remaining text contains **any** remote-reference form —
   `url(http…)`, `url(//…)`, `@import` with a quoted `http(s)`/`//` target,
   or a protocol-relative external reference. Local `@import` is also
   rejected (themes are single-file by contract, THEMES.md already says so).
2. Comment text may freely contain URLs (author credits) — only effective CSS
   is scanned. Existing built-in themes must all still parse.

## 3. CSP on both targets (fixes N2, backstops everything)

1. **Desktop** (`tauri.conf.json`): replace `"csp": null` with a strict
   policy — no remote origins anywhere. Shape (exact directives tuned during
   implementation, but the invariant is *no `http:`/`https:` source except
   the platform's own `asset.localhost`*):
   `default-src 'self'; img-src 'self' asset: https://asset.localhost data: blob:;
   style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost;
   font-src 'self' asset: data:; object-src 'none'; frame-src 'none'`.
   (`style-src 'unsafe-inline'` is required — themes are injected `<style>`
   text; acceptable because themes pass §2 and documents can't inject style.)
2. **Web** (single-file build): an equivalent `<meta http-equiv=
   "Content-Security-Policy">` baked into `dist-web/index.html` (the inlined
   bundle needs `'unsafe-inline'` for script/style; the load-bearing
   directives are `connect-src 'none'` and local-only `img-src`). W4 (zero
   requests) must still pass.
3. CSP violations are a backstop, not the primary defense — §1/§2 should make
   the CSP never fire. E46/W5 prove the stack end to end.

## 4. Managed links (fixes N4, N5)

1. All anchor clicks inside the rendered document are intercepted.
   In-document fragment anchors scroll locally. External `http(s)` links
   **never navigate the webview/page**: on desktop they open in the OS
   default browser (explicit, user-initiated hand-off via the opener plugin);
   on web they open in a new tab (`noopener`). Any other protocol is inert.
2. The About dialog's repo link goes through the same managed path (no bare
   `target="_blank"` reliance).
3. Hovering an external link shows the destination (title attribute) so the
   hand-off is never a surprise.

## 5. Capability & config hygiene (addresses N5, documents L1/L2)

1. `src-tauri/capabilities/default.json` gains `opener:allow-open-url`
   restricted to `http:`/`https:` URLs (for §4); nothing else widens.
2. The fs scope (`**`) and assetProtocol scope (`**`) stay as-is **by
   documented decision** (open-anything file editor; see assessment L1/L2) —
   ARCHITECTURE.md gets a "Security model" section stating the trade-off and
   the compensating controls (§1–§3, sanitizer).
3. `devUrl`/dev-server remain dev-only; release builds contain no localhost
   origins beyond Tauri's own `ipc`/`asset` endpoints.

## 6. Proof: tests and gates (fixes S1, makes the guarantee checkable)

1. **`fixtures/adversarial.md`** (new): remote image, protocol-relative
   image, remote link, local image, fragment link — the attack corpus.
2. **U17** — theme guard v2 unit coverage: every remote form of §2 rejected
   (url, @import string form, protocol-relative), URLs inside comments
   accepted, all built-in themes still parse.
3. **U18** — renderer isolation unit coverage: rendering `adversarial.md`
   yields HTML with no `http(s)` in any `src`; placeholder present; local
   image and fragment link survive.
4. **E46** (desktop shim; E42–E44 stay reserved) — open `adversarial.md`,
   assert via Playwright request interception that **zero requests leave
   localhost**; the image placeholder is visible; clicking the remote link
   does not navigate the app (URL unchanged, external-open hook observed).
5. **W5** (web, dist-web) — same adversarial corpus against the single-file
   build: zero non-localhost requests, no page navigation on link click.
6. **Static bundle scan** (new validate step after the single-file check):
   the built `dist-web/index.html` and `dist/assets/*.js` contain **no
   network call sites** — `XMLHttpRequest(`, `new WebSocket`, `sendBeacon`,
   `new EventSource` forbidden outright; `fetch(` occurrences must match a
   committed allowlist (expected: 0) with any entry justified in a comment.
   Prints a summary line; fails on drift.
7. **CI dependency audit** (release workflow `test` job, not local validate —
   audits phone home): `npm audit --omit=dev --audit-level=high` and
   `cargo audit` (via `rustsec/audit-check` or installed binary) must pass.
8. No other test changes; nothing may be weakened. Existing suites stay
   green (U1–U16, E1–E41 + E45, W1–W4).

> **Amendment (issue #114, 2026-08-07):** §6.6's "`fetch(` occurrences must
> match a committed allowlist (**expected: 0**)" is restated to what the gate
> pins today: **`FETCH_ALLOWLIST = 6`** in `scripts/validate.mjs` — three
> same-origin wrapper functions (`HostedSignIn.tsx`, `platform/hosted.ts`,
> `platform/hostedWorkspaces.ts`), counted once each in `dist/assets/*.js` and
> once each in `dist-web/index.html`. All three are hosted-flavor code,
> reachable only when the served HTML carries the hosted marker; the static
> web build reaches none of them. The forbidden list (`XMLHttpRequest(`,
> `new WebSocket`, `sendBeacon`, `new EventSource`) is unchanged and still
> zero. The number is a count of *audited* call sites with a written
> justification each, not a claim that none ship — PRD 011 added none of them
> (desktop leaves through the Rust `llm_request` command; the hosted LLM
> client and summary cache reuse `platform/hosted.ts`'s `api(...)`).

## 7. Docs

1. `docs/security/assessment.md`: findings table gains a **Status** column
   (fixed-by-§ / accepted); verdict paragraph updated to state the guarantee
   now holds. No other rewriting of the original assessment.
2. README: the "Private by design" bullet links to the assessment and states
   the enforced guarantee.
3. ARCHITECTURE.md: new "Security model & network isolation" section — the
   two enforcement layers, the managed-link policy, the fs-scope trade-off,
   and the proof suite.

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U18, E1–E41 + E45
   + E46, W1–W5**, the single-file check, the **static bundle scan line**,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `grep -n '"csp"' src-tauri/tauri.conf.json` shows a non-null policy with
   no `http:`/`https:` source other than `asset.localhost`, and
   `grep -c 'Content-Security-Policy' dist-web/index.html` ≥ 1 after a fresh
   `npm run build:web`.
3. E46 and W5 transcripts show the zero-non-localhost-requests assertions
   passing against `fixtures/adversarial.md`.
4. `npm run tauri build` (macOS) exits 0 — the hardened config must not
   break packaging; app path + size printed.
5. `.github/workflows/release.yml` parses cleanly and its `test` job
   contains the two audit steps (§6.7).
6. `git diff --stat docs/specs/` is empty; `grep -rEn '\.(skip|only|todo)\('
   tests/` prints nothing; sidecar/trailer formats and all existing behavior
   unchanged.
7. Assessment, README, and ARCHITECTURE updated per §7.
