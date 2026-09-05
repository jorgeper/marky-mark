# UI style guide — app chrome

The contract for styling Marky Mark's *chrome* — toolbar, buttons, inputs,
menus, dialogs, panels (PRD 018). Document rendering (`.doc` typography,
tables, code blocks) is the theme contract's job and is out of scope here;
those rules live in delimited `DOCUMENT RENDERING — BEGIN/END` sections of
`src/styles.css` that the style lint skips.

The short version: **every colour, radius, shadow, and font size in a
chrome rule resolves through a token, and every control is a primitive.**
The gate enforces the load-bearing rules (the style lint in
`scripts/validate.mjs`, quick tier included); the Do / Don't list at the
end says which.

## The chrome token layer

Declared once in `src/styles.css` inside the `CHROME TOKENS — BEGIN/END`
block, on `.theme-root` — the same scope as the theme contract, so themes
can override any of them (see "Themes" below). Colour tokens derive from
the contract (`color-mix()` on `--mm-accent`, `--mm-fg`, …), so all 27
bundled themes restyle the chrome without defining a single chrome token.

| Token | Default | Use |
|---|---|---|
| `--mm-space-1` … `--mm-space-6` | `4px`, `6px`, `8px`, `10px`, `12px`, `16px` | Spacing scale for chrome gaps and padding |
| `--mm-radius-small` | `6px` | Corner radius for inputs and buttons |
| `--mm-radius-medium` | `10px` | Corner radius for cards, modals, and menus |
| `--mm-radius-pill` | `999px` | Fully rounded badges, pills, and toggles |
| `--mm-card-shadow` | `0 1px 6px rgba(0, 0, 0, 0.09)` | Resting shadow on cards and badges |
| `--mm-panel-shadow` | `0 0 24px 2px rgba(0, 0, 0, 0.14)` | Shadow on floating panels |
| `--mm-text-caption` | `11px` | Smallest chrome text (labels, hints) |
| `--mm-text-small` | `12.5px` | Secondary chrome text |
| `--mm-text-body` | `13px` | Default chrome text |
| `--mm-text-heading` | `14px` | Chrome headings (dialog titles) |
| `--mm-text-icon` | `16px` | Glyph size in square icon buttons |
| `--mm-danger` | `color-mix(in srgb, #cf222e 90%, var(--mm-fg) 10%)` | Destructive text, borders, and fills |
| `--mm-danger-fg` | `var(--mm-bg)` | Text on a danger-filled control |
| `--mm-accent-fg` | `var(--mm-bg)` | Text on an accent-filled control |
| `--mm-hover` | `color-mix(in srgb, var(--mm-accent) 8%, transparent)` | Hover wash on rows and buttons |
| `--mm-muted` | `var(--mm-fg-muted)` | De-emphasised chrome text |
| `--mm-focus-ring` | `color-mix(in srgb, var(--mm-accent) 35%, transparent)` | Keyboard-focus ring |
| `--mm-scratch-name` / `--mm-scratch-name-style` | `var(--mm-accent)` / `italic` | The scratch buffer's "Scratch file" placeholder name in the toolbar and its file tab (PRD 023 Req 7) |
| `--mm-find` / `--mm-find-active` / `--mm-find-fg` | `#ffdf5d` / `#f0883e` / `#1f2328` | Find-match highlights (deliberately theme-independent so matches stay legible anywhere) |
| `--mm-fence-ring` | `var(--mm-border)` | Hairline ring around code-fence cards in edit mode |
| `--mm-split` / `--mm-folders` | `50%` / `240px` | JS-driven layout defaults before the user drags |

A second, *internal* token family sits just below the chrome block (also on
`.theme-root`, e.g. `--mm-toolbar-shadow`, `--mm-lift-tab`,
`--mm-overlay-scrim`, `--mm-orphan-fg`): declared one-off values that are
not part of any scale and not offered to themes as a vocabulary — but they
follow the same law: **a colour literal lives in a token definition, never
inline in a style rule.** Genuinely new one-off colours go there, with a
comment saying what they are.

## The primitive vocabulary

Every rule lives once in the `PRIMITIVES — BEGIN/END` block of
`src/styles.css`; states (hover, active, disabled, `:focus-visible`, the
toggled `.on` / `.active` / `.selected`) are defined there on the
primitive, never per call site.

- **`.btn`** — the neutral button: 1px contract border, elevated
  background, medium radius, body text size. The default for any chrome
  action ("Save", "Cancel", "Reload"). Start here; add a variant only when
  the control means something more.
- **`.btn-primary`** — the accent fill for a dialog's one main action.
  At most one per surface; its text colour is `--mm-accent-fg`, never a
  hard-coded white.
- **`.btn-quiet`** — borderless and transparent until hovered. For inline
  and secondary actions living inside busy chrome (toolbar buttons, card
  rows, tab rails) where a bordered box would shout.
- **`.btn-danger`** — the destructive foreground on the neutral shape
  ("Remove", "Delete"). Combine as `.btn-danger.btn-primary` when the
  destructive action is the surface's main action (a confirm dialog's red
  fill).
- **`.btn-sm`**, **`.btn-pill`** — size/shape modifiers: `.btn-sm` is the
  chip row size, `.btn-pill` the fully rounded shape. Compose freely with
  the variants.
- **`.icon-btn`** — the square icon-only button (✕, ⋯, chevrons):
  borderless, `--mm-text-icon` glyph, small radius. Needs an accessible
  name (`aria-label` or `title`).
- **`.field`** — text input / select / textarea: one look, one focus
  treatment (accent border). Element-qualified (`input.field`, …) because
  dialogs use `div.field` as a label+control row wrapper.
- **`.menu`**, **`.menu-item`**, **`.menu-sep`**, **`.menu-hotkey`** — the
  floating panel: visual shell, rows (rows are `<button>`s), separator,
  right-aligned hotkey column. Positioning stays with the call site and
  `anchoredMenu.ts`.
- **`.dialog`**, **`.dialog-header`**, **`.dialog-body`**,
  **`.dialog-actions`** — the modal shell. Backdrop (`.overlay`), portal
  and dismiss behaviour stay with the call site.

The one sanctioned exception to "every button is a primitive variant" is
the Microsoft-branded sign-in button (PRD 018 Req 20): a
`Button variant="neutral"` plus a class carrying only the brand logo
layout.

## The wrappers — `src/components/ui/`

Thin React wrappers that emit exactly the primitive classes — no state, no
portals, no positioning. Prefer them in TSX; a raw `<button>` carrying the
primitive class directly is acceptable where a wrapper import is
disproportionate (the lint accepts either).

- **`Button`** — props `variant: 'neutral' | 'primary' | 'quiet' |
  'danger'` (default `neutral`), `size?: 'sm'`, `pill?: boolean`, plus all
  native button props forwarded. `type` defaults to `"button"` so a Button
  inside a form never submits it by accident.
- **`IconButton`** — all native button props; the type *requires*
  `aria-label` or `title`. Emits `.icon-btn`; `type` defaults to
  `"button"`.
- **`Menu` / `MenuItem` / `MenuSeparator`** — `Menu` and `MenuSeparator`
  are `<div>`s taking native div props; `MenuItem` is a `<button>` (rows
  are actions) with `type` defaulting to `"button"`.
- **`Dialog`** — a `<div className="dialog">` with `header?: ReactNode`
  and `actions?: ReactNode` slot props; `children` fill `.dialog-body`.
  Absent slots render no element.

`className` passed to any wrapper is **appended** after the primitive
classes, never replaced — so a call site can add a layout hook
(`.tab-btn`, `.sync-edge`) without restating visuals.

## App-specific classes (PRD 018 Req 13)

A class of your own next to a primitive may declare **layout only**:
position, flex/grid, sizing, margins within its parent — or exist purely
as a test locator. It may **not** declare colour, radius, shadow,
font-size, or control padding; those belong to the primitive and the
tokens. A class that is "genuinely different" (the palette's flush search
input, the branded sign-in logo) carries the difference and nothing more,
with a comment saying why.

## Themes (PRD 018 Req 6)

Chrome tokens are declared on `.theme-root`, and a theme's `<style>` is
appended after the app stylesheet — so a theme may override any chrome
token and need not define any (`THEMES.md` "Chrome tokens (optional)" is
the user-facing story). The required contract of 34 variables is
unchanged; chrome tokens are extras, not obligations. This is why chrome
rules never hard-code a colour: a literal is invisible to themes, a token
is themable for free.

## Do / Don't

Entries marked **[lint]** are enforced by the style lint
(`scripts/style-lint.mjs`, run by `npm run validate:quick` and the full
gate); the lint enforces exactly these and nothing that is not written
here. It scans `src/styles.css` outside the `CHROME TOKENS` and `DOCUMENT
RENDERING` blocks, and every `.tsx` under `src/` except
`src/components/ui/`.

- **Don't** write a raw colour literal (hex, `rgb()`/`rgba()`, `hsl()`) in
  a chrome rule. **Do** use a chrome or contract token; a genuinely new
  one-off colour becomes an internal token definition first. Literals are
  allowed only inside custom-property definitions and as `var()` fallbacks
  for *contract* variables. **[lint]**
- **Don't** reference an undefined variable: every `var(--mm-…)` must name
  a property defined in `src/styles.css` or listed in `THEMES.md` (the
  `--mm-bg-elev` typo class of bug). **[lint]**
- **Don't** put `var()` fallbacks on defined (non-contract) tokens —
  per-site fallbacks drift and disagree; the definition is the single
  source of truth. Colour fallbacks on non-contract tokens are caught by
  the colour-literal rule. **[lint — colour fallbacks]** Contract-variable
  fallbacks are fine and carry the `THEMES.md`-documented default.
- **Don't** end a selector in a bare descendant ` button`, ` input`,
  ` select`, or ` textarea` (the ancestor-rule pattern that styled half
  the app's buttons by accident). **Do** style a primitive class, or
  element-qualify a specific class (`input.palette-input`). **[lint]**
- **Don't** write literal `font-size`, `border-radius`, or `box-shadow`
  values in a chrome rule. **Do** use the type/radius/shadow scale tokens
  (keywords like `none`/`inherit`/`0` are fine). **[lint]**
- **Don't** ship a `<button>` in TSX without a primitive: use the
  `Button`/`IconButton`/`MenuItem` wrappers or carry a `.btn*`,
  `.icon-btn`, or `.menu-item` class (a static class string, so the lint
  can see it). **[lint]**
- **Don't** set `fontSize`, `color`, `background`, or `borderRadius` to
  literals in inline `style={{ }}` objects. Inline styles are for
  *computed geometry* (widths, transforms, indents, `--mm-*` custom
  properties); type and colour come from classes and tokens. **[lint]**
- **Don't** invent a new one-off button class that restates visual
  properties — that is how the 25 pre-PRD-018 button classes happened.
  **Do** compose primitives plus, if needed, a layout-only hook class
  (see "App-specific classes" above).
- **Don't** restate hover/disabled/focus states at a call site; they are
  defined once on the primitive. Toggled controls carry `.on` (buttons) or
  `.active`/`.selected` (menu rows).
