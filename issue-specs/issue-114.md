# Spec: Amend the no-network guarantee: SPEC11 rewrite, docs, re-pinned gate counters, static-web no-LLM guard (#114)

## Goal

All acceptance criteria in issue-specs/issue-114.md are satisfied for issue
#114, with evidence visible in the session: SPEC11 carries an in-place
amendment making the guarantee conditional and precise (no outbound request
from documents, themes or dependencies ever; none at all unless a user or
operator configured an LLM provider and invoked a feature that uses it), the
README, `docs/ARCHITECTURE.md` and `docs/security/assessment.md` state the
same amended guarantee, `scripts/validate.mjs`'s committed counters
(`FETCH_ALLOWLIST`, `E2E_TEST_FLOOR`) are re-pinned with written
justification and verified against real built bundles, a guard exists that
fails if the static web bundle ever grows an LLM path, `docs/MAP.md` is
regenerated, `npm run validate:quick` passes in the implementer's session,
and a summary comment from the implementer exists on issue #114.

## Acceptance criteria

- **SPEC11 is amended, not contradicted.** `docs/specs/SPEC11.md` carries an
  in-place amendment in this repo's existing convention (a
  `> **Amendment (issue #114, 2026-08-07):** …` block, cf. SPEC30 §2 and
  SPEC11's own SPEC19 precedent in the assessment), leaving the original text
  in place. The amended guarantee states, precisely:
  - no outbound request from **documents, themes, or dependencies, ever** —
    the sanitize layer, the CSP on both targets and the adversarial proof
    suite (U17/U18/E46/W5) are unchanged and still enforced;
  - no outbound request **at all** unless the user (desktop) or the operator
    (hosted) has configured an LLM provider **and** invoked a feature that
    uses it — PRD 011 Req 16: every request is attributable to a user action,
    none at startup, in the background, or speculatively;
  - where a request originates per flavor: desktop from the Rust shell, the
    webview CSP unwidened (PRD 011 Req 12); hosted from the browser to the
    app's **own origin**, never to a provider host (Req 13); **static web:
    no LLM path at all** (Req 14);
  - the user-initiated updater exception (SPEC19) still stands and is not
    re-litigated;
  - §6.6's "fetch( occurrences must match a committed allowlist (expected:
    0)" is restated to the number the gate actually pins today, so the spec
    stops asserting a count the gate no longer enforces.
- **The three documents match the amended text.** README's *Private by
  design* bullet, `docs/ARCHITECTURE.md` § "Security model & network
  isolation (SPEC11)", and `docs/security/assessment.md` each state the
  conditional guarantee: what is unconditional, what the opt-in exception is,
  who configures it per flavor, and that the static web build has no LLM
  path. `assessment.md` gains a **PRD 011 amendment** paragraph in the same
  shape as its existing SPEC19 amendment, and its now-stale claim that `src/`
  contains zero network calls (`no fetch/XHR/WebSocket/beacon anywhere in
  src/`) is corrected rather than left standing. No document promises the
  unconditional version anywhere it is still reachable by a reader.
- **The gate's committed counters are re-pinned with justification.** In
  `scripts/validate.mjs`, the comment above `FETCH_ALLOWLIST` explains why
  PRD 011 added no new call site — the desktop request leaves through the
  Tauri IPC command, and the hosted LLM client plus summary cache reuse the
  existing same-origin `api(...)` wrapper — and the comment above
  `E2E_TEST_FLOOR` is brought up to date the same way. Each number is either
  unchanged with a stated reason, or changed with a stated reason; neither is
  left with a justification that only mentions PRD 007.
- **The counters are verified against real builds, not read off the source.**
  The session shows `npm run build` and `npm run build:web` succeeding and
  the actual `fetch(` count across `dist-web/index.html` + `dist/assets/*.js`
  (the exact set the bundle scan reads) matching `FETCH_ALLOWLIST`, and
  `npx playwright test --list` reporting a collected total at or above
  `E2E_TEST_FLOOR`. (The bundle scan only runs in the full `npm run
  validate`, which needs Rust on PATH — reproduce the count directly instead
  of running the full gate.)
- **A static-web no-LLM guard exists and bites.** A committed check fails if
  the static web bundle grows an LLM path. It asserts at least: the
  static-web `Platform` (`src/platform/web.ts`) declares neither `llm` nor
  `llmTransport`; the web build's CSP in `vite.web.config.ts` still carries
  `connect-src 'none'` and no remote origin; and no provider endpoint
  constant from `src/lib/llmProviders.ts` (`api.openai.com`,
  `api.anthropic.com`, `openrouter.ai`, `generativelanguage.googleapis.com`)
  and no desktop `llm_request` command name reaches `dist-web/index.html`.
  It lives where the fast tier runs it (a unit test under `tests/unit/`,
  next free U number — 555 is taken; precedent:
  `tests/unit/zoom-purity.test.ts`, `tests/unit/docs-hosting-llm.test.ts`),
  with any dist-level assertion arranged so it cannot pass vacuously when the
  artifact is absent. The session shows the guard failing when the property
  is temporarily broken, and passing again after the break is reverted.
- **Nothing else about the static web build moved (Req 14).** Its CSP is
  byte-unchanged, `dist-web/index.html` is still a single self-contained
  file, W4/W5 still pass, and the fetch-allowlist count covering that bundle
  is unchanged.
- **Citations and the map.** New or changed code, tests and spec text carry
  `SPEC11 §x` / PRD 011 Req 14–15 citation comments per
  `docs/COMMENT-FORMAT.md` and `.sandcastle/CODING_STANDARDS.md`, and
  `npm run map` has been re-run so `docs/MAP.md` reflects the amended
  citations (validate:quick's "docs/MAP.md up to date" step passes).
- **No behaviour change and no weakening.** This issue changes spec text,
  docs, gate comments/counters and adds a guard; app runtime behaviour is
  untouched and existing suites stay green.
  `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
- **Test economy.** Iterate with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at what changed). Do not run the full gate as a
  baseline; run `npm run validate:quick` **once**, right before declaring the
  goal met.
- **The quick gate passes.** `npm run validate:quick` has been run in the
  implementer's session and printed `QUICK VALIDATION: ALL PASSED`.
- **A summary comment from the implementer exists on issue #114**, naming the
  branch, what changed in each document, the counter justifications, the
  guard and its proof-of-bite, and the quick-gate evidence.

## Context

Parent: #108. PRD: `prd/011-semantic-zoom-and-llm-providers.md` — Reqs 14 and
15 are this issue; Reqs 12/13 landed as #112 (desktop, Rust-side transport)
and #113 (hosted, same-origin proxy in `server/llm.ts` +
`src/platform/hostedLlm.ts`), both closed and merged into this branch's
history.

Files that matter: `docs/specs/SPEC11.md` (the guarantee, §3 CSP, §6.6 the
bundle scan, §7 the doc list), `scripts/validate.mjs` (`E2E_TEST_FLOOR` and
`FETCH_ALLOWLIST` with their justification comments, and the static bundle
scan itself), `README.md` (*Private by design*), `docs/ARCHITECTURE.md`
(§ "Security model & network isolation (SPEC11)" and the updater privacy
invariant restatement), `docs/security/assessment.md` (verdict + the SPEC19
amendment paragraph as the style precedent), `vite.web.config.ts` (`WEB_CSP`
and the `stubTauriPlatform` plugin), `src/platform/web.ts`,
`src/platform/index.ts` (flavor resolution via the hosted marker),
`src/platform/hostedLlm.ts`, `src/lib/llmProviders.ts`.

Facts already established on this branch, worth not re-deriving: the current
counters are `FETCH_ALLOWLIST = 4` and `E2E_TEST_FLOOR = 226`, and
`npx playwright test --list` collects exactly 226. A fresh `npm run build:web`
produces a `dist-web/index.html` with **zero** occurrences of any provider
endpoint host and zero of `llm_request` (the web config stubs out
`platform/tauri.ts`), and two occurrences of `/api/llm` — the hosted client
ships in the bundle but is unreachable without the injected hosted marker,
exactly like the four counted `fetch(` sites. Say that plainly in the
justification rather than claiming the code is absent.

Grep before opening files: `rg 'SPEC11' src tests docs`. Never read
`src/App.tsx` end to end.
