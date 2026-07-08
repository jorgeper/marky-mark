# SPEC6: Marky Mark v6 — aligned editor, Word-style comment flow, 20 new themes

Delta spec on top of SPEC.md–SPEC5.md (all green: U1–U13, E1–E30, W1–W4). This file
wins on conflict; nothing else may regress. §7 is the goal condition. Explicitly out
of scope (author's call): vim mode in the editor — do NOT build it.

---

## 1. Edit-mode indentation matches preview (FR-E)

1. The editor's text column must sit exactly where preview's text column sits: same
   centered column, same `--mm-content-width`, same 32 px inner padding — including
   when the margins setting changes and when a theme sets its own width.
2. With line numbers OFF, the first character of a `.cm-line` must align with the
   preview `.doc` content-box left edge within ±2 px (E31 asserts both default and
   `wide` margins). With line numbers ON, the gutter should live in the left margin
   so the text column stays put; if that proves impractical, the text may shift by at
   most the gutter width (E31's lenient branch).

## 2. Word-style comment flow (FR-W)

1. Rework the margin layout from flow margins to **absolutely-positioned cards with
   animated `top`** (CSS transition ~180 ms ease; the panel keeps its height via a
   spacer or min-height so scrolling still works).
2. Default state (no active comment): cards sit level with their highlights, pushing
   later cards down — same visual result as today.
3. **Active comment (Word behavior)**: when a card or its highlight is clicked, the
   active card animates to sit exactly level with its (first) highlight; cards ABOVE
   it in document order get pushed UP (stacked bottom-to-top above the active card),
   cards below stack downward. The active card is never buried at the bottom of a
   long stack.
4. **Faint card shadow**: comment cards get a subtle drop shadow
   (`--mm-card-shadow` variable, default e.g. `0 1px 6px rgba(0,0,0,0.09)`); the
   active card may deepen it slightly.
5. E32 asserts: three comments anchored within one paragraph; activating the LAST
   card brings its top level with its highlight top (±10 px) while the others move
   aside; cards' computed `box-shadow` is not `none`.

## 3. Resolved comments: ghosted in place (FR-R)

1. Resolving is not deleting. Add a **"Show resolved" toggle** in the comments panel
   header (`data-testid="show-resolved"`, only rendered when resolved comments
   exist; state persists in settings as `showResolved: boolean`, default `false`).
2. Toggle OFF (default): exactly today's behavior — collapsed "Resolved (N)" section
   (E9 must keep passing unchanged).
3. Toggle ON: resolved cards render **in the flow at their anchor position,
   ghosted** (reduced opacity ~0.55, `resolved-ghost` class), with a faint ghost
   highlight in the document (comment tint at reduced alpha, `mark.hl.ghost`), and
   Reopen/Delete still available on the card. Reopening restores the normal card and
   highlight.
4. E33 asserts the ON behavior (ghost card + ghost highlight + reopen works) and
   that turning it OFF restores the collapsed section.
5. U13 extended (additively): `showResolved` parses, default false.

## 4. Twenty new themes (FR-T)

1. Ship **20 additional** built-in themes (27 total). Use canonical palettes for the
   classics (research/verify hex values; WebSearch allowed but well-known values may
   be used directly). Required set — names may be polished but keep these ids:
   - **Crisp/typographic**: `crisp-mono` (pure white, monospace body — ui-monospace/
     Menlo/Courier stack), `typewriter` (warm white, Courier-family, generous
     leading), `manuscript` (white, classic serif book typography), `newsprint`
     (off-white, condensed serif headlines, justified feel), `sepia` (reading-mode
     warm sepia).
   - **Programming classics**: `solarized-dark`, `gruvbox-dark` (#282828 family),
     `gruvbox-light`, `tokyo-night`, `catppuccin-mocha`, `catppuccin-latte`,
     `github-dark` (#0d1117), `rose-pine`, `everforest-dark`, `night-owl`,
     `zenburn`, `ayu-light`.
   - **Terminal/quirky**: `phosphor` (black CRT + green glow mono), `amber-terminal`
     (black + amber mono), `vaporwave` (dusk purples/pinks/cyans, playful).
2. Every theme: full `--mm-*` contract, correct `@name`/`@variant` metadata, no
   remote resources, distinct `--mm-bg` values, syntax colors harmonious with the
   palette. Quirky themes may use extra scoped CSS (that's the feature).
3. **U14 (new unit test)**: reads `themes/*.css` from disk; asserts ≥ 27 files, all
   parse via `parseTheme` with unique ids and valid variants, none rejected, and all
   define `--mm-bg` with no two identical values.
4. **E34 (new e2e)**: the light-theme select lists ≥ 27 options; spot-check three new
   themes apply their canonical backgrounds (gruvbox-dark `rgb(40, 40, 40)`,
   github-dark `rgb(13, 17, 23)`, and phosphor's near-black).
5. THEMES.md gets a one-line catalog of all built-ins.

## 5. Sanctioned test changes

Only: new **E31–E34**, **U14**, the additive **U13** extension, and — if the comment
layout rework requires it — updating E7/E8/E15's *positioning-independent* selectors
only if they break (assertions unchanged; expected: none break). Everything else
stays untouched.

## 6. Notes

- Card layout math stays in the existing layout pass (rects → tops); keep it cheap.
- The ghost highlight must not break anchoring/orphan logic or the sidecar format.
- New themes are bundled exactly like the old ones (Vite raw import — no code
  changes beyond the files, except U14/E34).

## 7. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U14, E1–E34, W1–W4**, the
   single-file check, `VALIDATION: ALL PASSED` — printed in the transcript.
2. macOS build exits 0 with `Marky Mark.app` path + size (< 25 MB) printed; Windows
   NSIS cross-build exits 0 with installer path + size (or BLOCKERS.md documents an
   honest new failure).
3. `ls dist-web/` shows exactly `index.html`, size printed.
4. `ls themes/ | wc -l` prints ≥ 27; `grep -rn "\.skip\|\.only\|\.todo" tests/`
   prints nothing; `git diff --stat SPEC*.md` empty.
5. `ARCHITECTURE.md` documents the editor-column alignment, the Word-style comment
   flow (and why absolute positioning replaced flow margins), the resolved-ghost
   mode, and the theme catalog expansion.
