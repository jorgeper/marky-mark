# PRD 018: Consistent UI styling — chrome tokens, primitive classes and components, and a style guide

**Status:** Draft
**Date:** 2026-09-01

Issue: #198.

## Problem

Issue #196 was a symptom: the hosted sign-in page had drifted from the
splash page it was meant to match — a different button fill, different
fonts, a card nobody asked for. The fix copied the splash's `.start-action`
declarations into `.hosted-signin-form button, .hosted-signin-ms`
(`src/styles.css` ~3560) so the two would "match". They match by
coincidence, not by construction, and the copy already differs from the
original: `.start-action` reads `var(--mm-bg-elev, #ffffff)` — a variable
that does not exist (the contract name is `--mm-bg-elevated`, used 29×
elsewhere) — so the splash's own buttons paint white on every dark theme.

A survey of the app's styling (2026-09-01) shows that pattern is the norm,
not the exception:

- `src/styles.css` is one 4,177-line file and the only stylesheet. There
  are no CSS modules, no utility framework, no CSS-in-JS — and **no shared
  UI primitives**: no `Button` component, no `.btn` class. 149 `<button>`
  elements are styled by ~25 one-off classes (`primary`, `linklike`,
  `tbtn`, `scope-btn`, `table-chip`, `hotkey-reset`, `membership-remove`,
  `sync-edge`, …) plus nine *descendant* rules (`.modal .actions button`,
  `.card .row button`, `.find-bar button`, `.folder-header button`,
  `.edge-cluster button`, `.palette li button`, …). About half the buttons
  carry no class and get whatever their ancestor rule says.
- The documented theme contract (`THEMES.md`, 34 `--mm-*` variables) covers
  colours and font stacks and nothing else. There are **no spacing, radius,
  shadow or type-scale tokens**. The stylesheet consequently carries 19
  distinct `border-radius` values, 20 distinct `font-size` values
  (12.5px ×25, 13px ×20, 12px ×18, 11.5px ×10, 10.5px ×5, …), 61 distinct
  `padding` values and 35 `box-shadow` declarations.
- The stylesheet uses a second, **undeclared** token layer: `--mm-danger`
  (14 uses), `--mm-hover`, `--mm-muted`, `--mm-find*`, `--mm-panel-shadow`,
  `--mm-card-shadow`, `--mm-split`, `--mm-folders`, `--mm-fence-ring`.
  Nothing defines them — not a theme, not `:root`. They resolve only
  through inline `var(name, literal)` fallbacks, and the fallbacks
  disagree with each other (`--mm-card-shadow` falls back to
  `0 1px 6px rgba(0,0,0,0.09)` at one site and `0 1px 4px rgba(0,0,0,0.2)`
  at two others).
- 76 hex literals and ~33 raw `rgba()` values sit outside any `var()`
  fallback — genuinely unthemed. `.card .row button.danger` and
  `.hosted-signin-error` hard-code `#d1242f` while two other destructive
  rules use `--mm-danger`; `button.primary { color: #ffffff }` is hard
  white on any accent.
- Whole families are duplicated: the icon-button rule exists twice
  (`.edge-cluster… button` and `.folder-header button`, identical), the
  neutral bordered button twice (`.start-action` and the sign-in copy),
  the quiet inline button twice (`.card .row button`, `.find-bar button`),
  destructive buttons four times, modals as three parallel trees
  (`.modal` 30 rules, `.settings-modal` 16, `.management-modal` 13) and
  floating menus as four (`.theme-menu`, `.smart-edit-menu`, `.palette`,
  `.folder-menu`) — four separate takes on "panel with rows, separator,
  hover wash, hotkey column".
- `.sandcastle/CODING_STANDARDS.md` contains no visual or CSS rule at all;
  its `## Style` section is about citation comments and test ids. No spec
  owns the stylesheet's consistency — `src/styles.css` cites 25 SPECs and
  12 PRDs, each owning a slice.

The cost lands on every implementer, human or agent: the next feature has
no primitive to reach for, so it writes a new one-off, and the one-off
drifts. This PRD introduces the missing layer — tokens, a small vocabulary
of primitives, a written guide, and a gate that keeps them honest — and
migrates the existing chrome onto it.

## Goals

- Every interactive control in the app chrome (buttons, icon buttons,
  inputs, dialogs, floating menus) is built from one documented set of
  primitives, so two controls that should look alike look alike by
  construction rather than by copy.
- The app chrome is described by a token layer — spacing, radius, shadow,
  type scale, and state colours — with defaults that follow the active
  theme, so every one of the 27 bundled themes (and any third-party theme
  written against `THEMES.md`) keeps working unchanged and can override
  chrome tokens if it wants to.
- The visible result is the app as it looks today, tidied: controls snap
  to the nearest step of the new scales; nothing is redesigned. The
  splash's `.start-action` button is the reference look for the neutral
  button.
- An implementer — agent or human — can find the rule in under a minute:
  a style guide says which primitive to use and what is forbidden, the
  coding standards point at it, and the quick validation tier fails when
  a change reintroduces the old patterns.
- Consistency is tested, not asserted: e2e tests sample representative
  controls in a light and a dark theme and assert their computed styles
  agree.

## Non-goals

- **Markdown document rendering.** `.doc` typography, tables, code blocks,
  blockquotes, headings, and everything else the theme contract's
  markdown tokens (`--mm-code-*`, `--mm-table-*`, `--mm-blockquote-*`, …)
  govern are untouched. This PRD is about app *chrome*.
- **Export and print CSS.** The CSS strings in `src/lib/exportDoc.ts` and
  `src/lib/printDoc.ts` are not migrated onto the tokens.
- **The control-panel dev tool** (`control-panel/`) and its own
  stylesheet.
- **Editing the theme files.** The 27 files in `themes/` are not modified,
  except that a theme whose *existing* contract variables are provably
  wrong may be fixed as an incidental bug. De-duplicating the copy-pasted
  font stacks across themes is a separate effort.
- **A redesign.** No new visual language, no new colours, no new shapes.
  Where the survey found several values doing one job, the PRD picks one;
  it does not invent a different one.
- **A CSS framework or CSS-in-JS.** Plain CSS classes in `src/styles.css`
  remain the mechanism; no Tailwind, CSS modules, or styled-components
  dependency is added.
- **Renaming test ids.** Every existing `data-testid` survives the
  migration unchanged (per `.sandcastle/CODING_STANDARDS.md`).
- **The Microsoft-branded sign-in button's brand appearance.** Its
  four-square logo and neutral fill follow Microsoft's identity-branding
  guidance (issue #196) and remain as they are; it is the one sanctioned
  exception to "every button is a primitive variant" (Req 20).

## Requirements

### A. Chrome tokens

1. `src/styles.css` defines a **chrome token layer** as custom properties
   on `.theme-root` (the same scope the theme contract uses), in one
   clearly delimited block near the top of the file, with a citation
   comment naming this PRD. It contains at least: a spacing scale
   (`--mm-space-1` … `--mm-space-6` or equivalent), a radius scale
   (small / medium / pill — three values, no more), a shadow scale
   (`--mm-shadow-card`, `--mm-shadow-panel` or equivalent — two values),
   a UI type scale (four sizes at most, e.g. caption / small / body /
   heading), and the state colours `--mm-danger`, `--mm-danger-fg`,
   `--mm-hover`, `--mm-muted`, `--mm-focus-ring`.
2. Every chrome token has a **default derived from the theme contract**
   where a colour is involved — `--mm-hover` from `--mm-accent` or
   `--mm-border` via `color-mix()`, `--mm-muted` from `--mm-fg-muted`, and
   so on — so switching any of the 27 bundled themes changes the chrome
   without any theme defining a chrome token. Non-colour tokens (spacing,
   radius, shadow, type scale) have literal defaults.
3. Every custom property the stylesheet *uses* is **declared**: the tokens
   listed in the Problem section as currently undeclared (`--mm-danger`,
   `--mm-hover`, `--mm-muted`, `--mm-find`, `--mm-find-active`,
   `--mm-find-fg`, `--mm-panel-shadow`, `--mm-card-shadow`, `--mm-split`,
   `--mm-folders`, `--mm-fence-ring`) are either defined in the chrome
   token block or replaced by a token that is. After this PRD, no
   `var(--mm-…)` in `src/styles.css` names a property that has no
   definition anywhere in `src/styles.css` or `THEMES.md`.
4. `var()` **fallbacks are removed** from chrome rules whose token is now
   defined (a fallback that disagrees with the definition is the bug this
   PRD exists to kill). Fallbacks remain only for contract variables a
   third-party theme might omit, and each such fallback is the value
   documented in `THEMES.md`.
5. The typo `--mm-bg-elev` in `.start-action` is fixed to
   `--mm-bg-elevated`; the splash's neutral buttons follow the theme's
   elevated background on every bundled dark theme.
6. `THEMES.md` gains a section **"Chrome tokens (optional)"** listing every
   chrome token, its default, and a one-line description, and states
   that a theme may override any of them and need not define any. The
   existing required contract of 34 variables is unchanged.

### B. Primitive classes and components

7. `src/styles.css` defines a **primitive class vocabulary**, each in one
   place, each citing this PRD:
   - `.btn` — the neutral button (the `.start-action` look: 1px
     `--mm-border`, medium radius, `--mm-bg-elevated`, `--mm-hover` wash
     on hover, body UI size);
   - `.btn-primary` — accent fill, accent-contrast foreground token (no
     hard-coded `#ffffff`);
   - `.btn-quiet` — borderless/transparent until hover (today's
     `.card .row button` / `.find-bar button` / `linklike` job);
   - `.btn-danger` — `--mm-danger` foreground on the neutral shape, and
     `.btn-danger.btn-primary` for a destructive fill;
   - `.btn-sm` and `.btn-pill` size/shape modifiers (the chip and
     `999px` cases);
   - `.icon-btn` — the square icon-only button (today's `.edge-cluster …
     button` / `.folder-header button` rule, once);
   - `.field` — text input / select / textarea styling, one rule;
   - `.menu`, `.menu-item`, `.menu-sep`, `.menu-hotkey` — the floating
     panel with rows, separator, hover wash and hotkey column;
   - `.dialog`, `.dialog-header`, `.dialog-body`, `.dialog-actions` —
     the modal shell.
   Every declaration in these rules uses chrome or contract tokens; none
   contains a raw colour, radius, shadow, or font-size literal.
8. Disabled, hover, active, and keyboard-focus (`:focus-visible` with
   `--mm-focus-ring`) states are defined **once**, on the primitive, and
   are not restated per site.
9. A new directory `src/components/ui/` holds **thin React wrappers** that
   emit exactly those classes and nothing else: `Button` (props:
   `variant: 'neutral' | 'primary' | 'quiet' | 'danger'`, `size`,
   `pill`, plus native button props forwarded, `type` defaulting to
   `"button"`), `IconButton` (requires an `aria-label` or `title`),
   `Menu` / `MenuItem` / `MenuSeparator`, and `Dialog` (header / body /
   actions slots). They contain no behaviour beyond class composition and
   prop forwarding — no state, no portals, no positioning (the existing
   `anchoredMenu.ts` keeps that job).
10. Each wrapper has unit tests (next unused `U<n>` ids) asserting the
    class string it emits for each variant and that arbitrary props
    (`data-testid`, `onClick`, `disabled`, `aria-*`) reach the DOM
    element.
11. `className` passed to a wrapper is appended, never replaced, so a
    site can still carry a layout hook (`.tab-btn`, `.sync-edge`) for
    positioning without restating visual properties.

### C. Migration

12. **Every `<button>` in `src/`** is either a `Button`/`IconButton`
    wrapper or carries a `.btn*` / `.icon-btn` primitive class. Bare
    `<button>` elements styled only by an ancestor rule no longer exist;
    the nine descendant rules named in the Problem section are deleted.
    The one exception is Req 20.
13. The one-off button classes that only restated visual properties
    (`primary`, `linklike`, `destructive`, `table-chip`, `tbtn`,
    `scope-btn`, `hotkey-reset`, `membership-remove`, `folder-expand`,
    `sidebar-switch-btn`, `search-opt`, `fm-close`, `hosted-signin-ms`'s
    duplicated declarations, and the rest found during implementation)
    are removed from `src/styles.css`. A class may survive only if it
    carries **layout** (position, flex, margin within its parent) or a
    test locator that existing e2e tests use — and then it carries no
    colour, radius, shadow, font-size, or padding declarations.
14. The three modal trees (`.modal`, `.settings-modal`,
    `.management-modal` and their `workspace-*` variants) are collapsed
    onto `.dialog*`; per-dialog rules keep only their layout (widths,
    grid of fields) and no shell styling.
15. The four floating-menu trees (`.theme-menu`, `.smart-edit-menu` /
    `.smart-edit-item`, `.palette`, `.folder-menu`) are collapsed onto
    `.menu*`; per-menu rules keep only what is genuinely different (the
    theme swatch, the palette's search input).
16. The four destructive rules are collapsed onto `.btn-danger`; no
    `#d1242f` (or any other hard-coded danger colour) remains in
    `src/styles.css`.
17. All `font-size`, `border-radius`, `box-shadow`, and control `padding`
    declarations in chrome rules use scale tokens. After migration
    `src/styles.css` contains no more than the scale's number of distinct
    values for each of those properties in chrome rules (document
    rendering rules, per Non-goals, are exempt and live in a delimited
    section so the lint can tell them apart).
18. Inline `style={{ fontSize: … }}` literals in TSX (today: two in
    `ErrorBoundary.tsx`) are replaced by classes; inline styles remain
    allowed only for computed geometry (widths, transforms, indents).
19. Migration is **visually conservative**: a control moves to the
    nearest step of the scale. No control changes its variant (a primary
    stays primary, a quiet stays quiet) and no control gains or loses a
    border, fill, or shadow it did not have, other than the drift fixes
    named in Reqs 5 and 16.
20. The Microsoft-branded sign-in button (`hosted-sign-in-microsoft`)
    keeps its branded logo and neutral fill per issue #196. It is
    implemented as `Button variant="neutral"` with an additional class
    carrying only the logo layout; its dimensions, radius, and font come
    from the primitive.
21. Every existing e2e test passes unweakened after the migration, and
    every existing `data-testid` is preserved. Where a test located a
    control by a class this PRD removes, the test is updated to the
    control's test id (adding one if it had none) — never by keeping the
    dead class alive.

### D. Documentation

22. `docs/STYLE-GUIDE.md` exists and contains: the chrome token table
    (name, default, use); the primitive vocabulary with a rendered-in-
    prose description of each variant and when to choose it; the
    wrapper components and their props; the rule for what an app-specific
    class may and may not declare (Req 13); the theme-override story
    (Req 6); and a **Do / Don't** list covering at least: raw colour
    literals, new one-off button classes, descendant `button` rules,
    inline font sizes, and `var()` fallbacks on defined tokens.
23. `.sandcastle/CODING_STANDARDS.md` gains a short **"UI styling"**
    subsection (≤ 15 lines) stating the rules the lint enforces and
    pointing at `docs/STYLE-GUIDE.md` for the rest.
24. `AGENTS.md` gains a single line under "Directory map" (or the most
    fitting existing section) pointing at `docs/STYLE-GUIDE.md`, staying
    within its documented ~150-line budget.
25. `docs/MAP.md` is regenerated (`npm run map`) so the new
    `src/components/ui/` files and the style-guide citation appear under
    this PRD's row.

### E. Enforcement in the gate

26. `scripts/validate.mjs` gains a **spawn-free "style lint"** step that
    runs in the quick tier (`--quick`) and the full tier, and fails
    with a file:line message when, in `src/styles.css` outside the
    delimited token-definition block and outside the delimited document-
    rendering section:
    - a hex, `rgb()`, `rgba()`, `hsl()` colour literal appears other than
      as a `var()` fallback for a *contract* variable;
    - a `var(--mm-…)` names a property not defined in `src/styles.css`
      or listed in `THEMES.md`;
    - a selector ends in a bare ` button`, ` input`, ` select`, or
      ` textarea` descendant (the pattern that produced the nine
      ancestor rules);
    - a `font-size`, `border-radius`, or `box-shadow` declaration in a
      chrome rule uses a literal rather than a token.
27. The same step scans `src/**/*.tsx` and fails on `<button` elements
    that carry neither a `.btn*` / `.icon-btn` class nor come from
    `src/components/ui/`, and on inline `style={{` objects containing
    `fontSize`, `color`, `background`, or `borderRadius` keys with
    literal values.
28. The lint has unit tests (next unused `U<n>` ids) exercising each rule
    with a passing and a failing fixture, so a future change to the lint
    cannot silently stop catching a pattern.
29. The lint's rules are the ones written in `docs/STYLE-GUIDE.md`'s
    Do / Don't list — the two are kept in step, and a rule that is
    lint-enforced says so in the guide.

### F. Verification

30. New e2e tests (next unused `E<n>` ids, in a new
    `tests/e2e/styling.spec.ts`) load the app and assert, via computed
    styles, that representative controls agree: the splash's neutral
    action, the hosted sign-in's local-mode submit button, a dialog's
    primary action, a toolbar icon button, and a destructive button
    from a workspace settings surface. For each pair that shares a
    variant the test asserts equal `border-radius`, `font-family`,
    `font-size`, and `padding`; for the neutral variant it asserts the
    background equals the theme's `--mm-bg-elevated`.
31. The same assertions run under one light and one dark bundled theme
    (e.g. `crisp` and `github-dark`), proving the chrome follows the
    theme with no chrome token defined by the theme.
32. One e2e test asserts that a theme *overriding* a chrome token (a
    fixture theme, or a `.theme-root` style injected by the test) changes
    the affected primitive — proving Req 6 is real, not documentation.
33. If the collected desktop-shim e2e count grows, `E2E_TEST_FLOOR` in
    `scripts/validate.mjs` is re-pinned to the new count.

### G. Hygiene

34. Changed behaviour carries citation comments per
    `.sandcastle/CODING_STANDARDS.md`, citing `PRD 018 Req <n>`; the
    chrome token block and each primitive rule cite the requirement that
    defines them.
35. No new runtime dependency is added; `package.json` `dependencies`
    are unchanged by this PRD.
36. `npm run validate:quick` passes at the end of each sub-issue and
    prints `QUICK VALIDATION: ALL PASSED`.

## Open questions

- None. Decisions taken during the interview (2026-09-01): full migration
  rather than duplicates-only; CSS classes plus thin wrappers rather than
  classes-only or components-only; chrome tokens as app defaults with
  optional theme override rather than a contract extension; deliberate
  normalization rather than a pixel-identical refactor; guide in
  `docs/STYLE-GUIDE.md` with a quick-tier lint; computed-style e2e
  assertions rather than screenshot baselines; the four non-goals above
  confirmed as out of scope.
