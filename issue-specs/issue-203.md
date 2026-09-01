# Spec: Primitive classes and thin src/components/ui wrappers with unit tests (PRD 018 Reqs 7–11) (#203)

## Goal

All acceptance criteria in issue-specs/issue-203.md are satisfied for issue #203, with evidence visible in the session: src/styles.css defines the primitive class vocabulary (`.btn` family, `.icon-btn`, `.field`, `.menu*`, `.dialog*`) each in one place using only chrome/contract tokens with disabled/hover/active/focus-visible states defined once on the primitive; src/components/ui/ holds thin Button, IconButton, Menu/MenuItem/MenuSeparator and Dialog wrappers that emit exactly those classes with `className` appended rather than replaced; each wrapper has unit tests (next unused `U<n>` ids, starting at U1003) asserting emitted class strings per variant and that arbitrary props reach the DOM element; and `npm run validate:quick` has been run in the implementer's session and prints `QUICK VALIDATION: ALL PASSED`.

## Acceptance criteria

- (Req 7) `src/styles.css` defines a primitive class vocabulary, each rule in exactly one place, each citing PRD 018 (`/* PRD 018 §B7: … */` per `.sandcastle/CODING_STANDARDS.md`):
  - `.btn` — the neutral button, the `.start-action` look (src/styles.css ~1795): 1px `var(--mm-border)`, medium radius, `var(--mm-bg-elevated)`, `var(--mm-hover)` wash on hover, body UI size (`--mm-text-body`);
  - `.btn-primary` — accent fill with an accent-contrast foreground token, no hard-coded `#ffffff` (the existing convention is `color: var(--mm-bg)` on accent fills; a `--mm-accent-fg`-style token in the chrome token block is acceptable);
  - `.btn-quiet` — borderless/transparent until hover;
  - `.btn-danger` — `var(--mm-danger)` foreground on the neutral shape, plus `.btn-danger.btn-primary` for a destructive fill (using `--mm-danger-fg`);
  - `.btn-sm` and `.btn-pill` size/shape modifiers (pill = the radius scale's pill step);
  - `.icon-btn` — the square icon-only button, defined once;
  - `.field` — text input / select / textarea, one rule;
  - `.menu`, `.menu-item`, `.menu-sep`, `.menu-hotkey` — floating panel with rows, separator, hover wash, hotkey column;
  - `.dialog`, `.dialog-header`, `.dialog-body`, `.dialog-actions` — the modal shell.
- (Req 7, tokens-only) Every declaration in those primitive rules uses chrome tokens (the `CHROME TOKENS` block at src/styles.css ~50–131, merged in issue #202) or theme contract tokens; none contains a raw colour, radius, shadow, or font-size literal.
- (Req 8) Disabled, hover, active, and keyboard-focus (`:focus-visible` using `var(--mm-focus-ring)`) states are defined once on the primitives and not restated anywhere else.
- (Req 9) A new directory `src/components/ui/` holds thin React wrappers emitting exactly those classes and nothing else: `Button` (props `variant: 'neutral' | 'primary' | 'quiet' | 'danger'`, `size`, `pill`, native button props forwarded, `type` defaulting to `"button"`), `IconButton` (its type requires an `aria-label` or `title`), `Menu` / `MenuItem` / `MenuSeparator`, and `Dialog` (header / body / actions slots). No behaviour beyond class composition and prop forwarding — no state, no portals, no positioning (`src/components/anchoredMenu.ts` keeps that job).
- (Req 10) Each wrapper has unit tests under `tests/unit/`, titled with the next unused `U<n>` ids (highest existing is U1002, so start at U1003), asserting the exact class string emitted for each variant/modifier and that arbitrary props (`data-testid`, `onClick`, `disabled`, `aria-*`) reach the DOM element. Note the vitest config only includes `tests/unit/**/*.test.ts` — either write the tests as `.test.ts` (e.g. via `React.createElement`/`react-dom/client` with the `// @vitest-environment happy-dom` pragma the suite already uses) or extend the vitest `include` to cover `.test.tsx` as well.
- (Req 11) `className` passed to any wrapper is appended to the primitive classes, never replaced, and a unit test asserts it.
- Scope guard: no existing call sites are migrated onto the new primitives or wrappers in this issue — migration is PRD 018 Reqs 12–21, owned by sibling sub-issues. Existing rules, `data-testid`s and e2e tests are untouched.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code) after each change; the full gate was NOT run per-change or as a starting baseline.
- `npm run validate:quick` was run once in the implementer's session, right before declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #203.

## Context

PRD: `prd/018-consistent-ui-styling.md` (§B, Reqs 7–11; read Non-goals — no redesign, no CSS framework, markdown/document rendering untouched). Parent: #198. Blocker #202 (chrome token layer + THEMES.md docs) is already merged on this branch (d9b2c7f), so the tokens (`--mm-space-*`, `--mm-radius-*`/pill, `--mm-shadow-*`, `--mm-text-*`, `--mm-danger`, `--mm-danger-fg`, `--mm-hover`, `--mm-muted`, `--mm-focus-ring`) exist in the delimited block at the top of `src/styles.css`. Reference looks in the current stylesheet: `.start-action` (neutral), `.edge-cluster`/`.folder-header` button rules (icon button), `.card .row button`/`.find-bar button` (quiet), the `.modal`/`.theme-menu` trees (dialog/menu shapes) — copy the look onto tokens; do not delete or modify those existing rules here. `src/components/ui/` components import React only (fine — the "pure logic" rule applies to `src/lib/`, not `src/components/`). `happy-dom` is already a devDependency; existing DOM-touching unit tests (e.g. `tests/unit/code-copy.test.ts`) show the per-file pragma pattern.
