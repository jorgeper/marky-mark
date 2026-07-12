# SPEC16: Marky Mark v16 — review bundles, diff-since-save, reading memory, heading palette, word count

Delta spec on top of SPEC.md–SPEC15.md as implemented (all green: U1–U28,
E1–E41 + E45–E59, W1–W5; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §9 is the goal condition.

**What ships:** five small features that lean into what makes Marky Mark
different — local-only, review-oriented, themeable, with a single-file web
build:

1. **Export Review Bundle** — bake the open document *and its comments* into
   the self-contained web viewer: one `.html` file anyone opens in a browser.
2. **Changes Since Save** — a toggle that tints edited lines in the editor
   against the last saved state.
3. **Reading position memory** — every document reopens where you left off.
4. **Heading palette** — `⌘K` fuzzy jump-to-heading, preview and edit.
5. **Word count chip** — quiet live `words · min` readout, selection-aware.

Out of scope: exporting from the web build (it only *opens* bundles),
word-level diff colouring, cross-device position sync, palette search over
body text, per-heading word counts, persistence of the diff toggle.

---

## 1. Export Review Bundle (FR-B)

1. **The artifact:** a single self-contained HTML file — the existing
   single-file web viewer (`build:web` output) with the document embedded —
   that opens in any browser with the document rendered and every comment
   present (threads, resolve state), no server, no install, no network.
   The recipient has the full web app: they can read, reply, and Save
   (download) per the web build's existing behavior.
2. **Payload format:** a `<script type="application/json" id="mm-review-doc">`
   element injected before `</head>` carrying `{ "name": string,
   "markdown": string }`, where `markdown` is the current buffer with the
   comments attached as the existing embedded trailer (SPEC2 format,
   whatever the user's storage setting — sidecar users' comments travel
   too). JSON is escaped so `</script>`/`<!--` in documents cannot break
   out (U29).
3. **Web boot path:** on startup, the web platform checks for
   `#mm-review-doc`; if present it opens that payload as an in-memory
   document named `name` instead of the empty state. Everything else about
   the web build is unchanged (W1–W5 stay green; W6 covers this).
4. **Pure seam — `src/lib/reviewBundle.ts`:**
   `buildReviewBundle(templateHtml, payload): string` and
   `extractReviewPayload(html doc): payload | null`, shared by the
   exporter, the web boot, and the tests.
5. **Template acquisition:** `Platform.reviewTemplate?(): Promise<string | null>`.
   `tauri.ts` returns the web viewer embedded at build time via an
   `import.meta.glob('/dist-web/index.html', raw)` that degrades to `null`
   when `dist-web` hasn't been built (dev);
   `src-tauri/tauri.conf.json`'s `beforeBuildCommand` becomes
   `npm run build:web && npm run build` so release builds always embed it
   (the *only* permitted tauri.conf.json change — CSP untouched). The shim
   returns a small stub template containing `</head>` so the flow is
   e2e-testable; `web.ts` leaves it undefined.
6. **UX:** File → **Export Review Bundle…** (after Save As…, no
   accelerator), present iff a template is available (`canExportReview` in
   the menu state — absent on web and in template-less dev). Command id
   `exportReview`: picks a destination via the existing save dialog
   (suggested `<basename>.review.html`), writes the composed bundle. No
   document open → no-op.
7. The app bundle grows by roughly the web viewer's size (~1.2 MB); update
   the README size claim if it drifts past the advertised number.

## 2. Changes Since Save (FR-D)

1. Command `toggleDiff`, View-menu **checkbox** "Changes Since Save" —
   listed only in edit modes (full and split), like mode-dependent items;
   no accelerator; unchecked default; state resets when another document
   opens; never persisted.
2. When on, the editor decorates **lines that differ from the saved file**:
   changed/inserted lines get a background tint, and a deletion marker
   (gutter dot) appears on the line after which saved text was removed.
   Colors ride two new optional theme variables (`--mm-diff-changed-bg`,
   `--mm-diff-removed`) with sensible fallbacks — themes need no changes.
3. **Pure seam — `src/lib/diffLines.ts`:**
   `diffLineSets(saved: string, current: string): { changed: number[];
   deletedAfter: number[] }` (1-based current-buffer lines), built on the
   existing `diff-match-patch` line mode — **no new dependencies** (U30).
   Recompute is debounced (≤250 ms) while typing; toggling off removes all
   decorations. Editor gains an optional `diff` prop rendering the
   decorations via a CodeMirror compartment.
4. Saving while the toggle is on empties both sets (everything now saved).

## 3. Reading position memory (FR-P)

1. Every document reopens with the **source line** that was at the top of
   the viewport when you left it — across doc switches and app restarts.
   Restores land block-anchored (SPEC15 machinery), same ±one-block
   accuracy contract.
2. Position capture: on scroll (debounced ≤500 ms), on switching away, and
   on mode toggles (the carried line, SPEC15). Restore: after the opened
   document first renders in preview. A brand-new (unseen) document starts
   at the top; the welcome doc participates like any other.
3. **Store:** `positions.json` in the config dir —
   `{ "version": 1, "entries": [{ "path": string, "line": number,
   "at": ISO-8601 string }] }`, most-recent first, capped at 200 entries
   (LRU). Corrupt/missing files degrade to empty.
   **Pure seam — `src/lib/readingPositions.ts`:** parse / serialize /
   `rememberPosition(store, path, line, now)` with the cap (U31).
4. Works identically on desktop, shim, and web (config storage already
   abstracts this).

## 4. Heading palette (FR-K)

1. Command `headingPalette`, **rebindable hotkey** (HotkeyMap key
   `headingPalette`, default `Mod+K`, Hotkeys-tab label "Go to heading"),
   View-menu item **"Go to Heading…"** after the comment-navigation items.
   Old settings files parse to the default (existing HotkeyMap mechanics).
2. Opening shows a centered overlay palette: a text input
   (`heading-palette-input`) over the document's headings (h1–h6, indented
   by depth, from the rendered DOM with their `data-mm-line`). Typing
   fuzzy-filters; ↑/↓ move the highlight; Enter (or click) jumps; Esc or
   click-away closes. Test ids: `heading-palette`, `heading-palette-input`,
   `heading-palette-item`.
3. **Jump behavior:** in preview, the heading scrolls to the viewport top;
   in edit modes the editor scrolls that source line to the top (split
   preview follows via SPEC15 sync). No document or no headings → the
   palette opens empty and Enter does nothing.
4. **Pure seam — `src/lib/fuzzy.ts`:** `fuzzyFilter(query, items)` —
   case-insensitive subsequence match, ranked (word-start and consecutive
   bonuses), stable for empty query (document order) (U32).

## 5. Word count chip (FR-W)

1. A quiet fixed chip at the **bottom-left** of the window (`word-chip`),
   visible whenever a document is open, in preview and edit: `1,234 words ·
   6 min` (reading time at 220 wpm, ceiling, minimum "1 min"). Themed via
   existing `--mm-*` variables; never overlaps the SPEC14 pill
   (bottom-right region).
2. **Selection-aware:** while a non-empty text selection exists in the
   preview document, the chip shows that selection's counts instead
   (returning to full-document counts when cleared).
3. Sources: preview counts the rendered plain text (the existing extracted
   doc text); edit modes count the buffer. Updates are live, debounced
   ≤250 ms while typing.
4. **Pure seam — `src/lib/wordCount.ts`:**
   `countWords(text): { words: number; minutes: number }` — unicode-aware
   (tokens containing letters/digits count; bare punctuation doesn't),
   empty text → 0 words / 0 minutes (chip renders "0 words") (U33).

## 6. Menus, hotkeys, settings

1. **File** gains `exportReview` after `saveAs` (both OS layouts, §1.6
   gating). **View** gains, after `prevComment`: "Changes Since Save"
   (checkbox, edit modes only) and "Go to Heading…" (`headingPalette`
   accelerator). `MenuState` gains `canExportReview` and `showDiff`.
2. **Amended, not weakened:** U19/U20's File-menu expectations are
   minimally updated to include `exportReview` — the only permitted
   existing-test amendment. U25's comment-nav triple stays contiguous
   (new View items come after it).
3. HotkeyMap gains only `headingPalette`; settings round-trip as always.

## 7. Web build & shim

1. Web: the §1.3 boot path is the only behavior change; W1–W5 unchanged.
2. Shim: provides the stub review template; everything else (positions,
   palette, chip, diff) is plain app UI and needs no new seams.

## 8. Tests (all suites stay green; only these are added)

1. **U29** — `reviewBundle`: build injects the payload before `</head>`
   exactly once; extract round-trips name and markdown byte-identically,
   including documents containing `</script>`, `<!--`, and the comment
   trailer; template without the marker → build throws or returns null
   (explicit, not silent corruption).
2. **U30** — `diffLineSets`: no edits → both empty; pure insertion, pure
   deletion, replacement, and edits at file start/end produce the right
   1-based line sets.
3. **U31** — `readingPositions`: parse/serialize round-trip; corrupt input →
   empty; remember() bumps to front, updates in place, evicts past 200.
4. **U32** — `fuzzyFilter`: subsequence matching, ranking (word-start beats
   mid-word), case-insensitivity, empty query preserves order, no match →
   excluded.
5. **U33** — `countWords`: plain prose, unicode words, punctuation-only
   tokens, empty text; minutes = ceil(words/220) with the 1-minute floor.
6. **U34 (menu)** — File carries `exportReview` iff `canExportReview`; View
   carries `toggleDiff` (checkbox tracking `showDiff`) only in edit modes
   and `headingPalette` with its rebindable accelerator.
7. **E60** — reading memory: scroll a long doc, open another doc, return →
   position restored (±one block); reload the app → still restored.
8. **E61** — heading palette: `Mod+K` opens; typing filters; Enter jumps
   the preview (heading at viewport top); in split edit the editor jumps to
   the heading's line; Esc closes.
9. **E62** — word chip: shows the welcome doc's counts; selecting a
   paragraph switches to selection counts and back; typing in edit mode
   updates the count.
10. **E63** — export (shim template): with two comments on a doc,
    `exportReview` writes `<name>.review.html` (via the save-dialog hook)
    whose content parses as a valid bundle: stub template marker present,
    payload extractable, markdown carrying the comment trailer.
11. **W6** — a real bundle composed from the actual `dist-web` build (via
    `buildReviewBundle`, served through a Playwright route) boots straight
    into the document with a comment visible and its thread openable —
    and still makes zero non-localhost requests.
12. E42–E44 stay reserved for SPEC8. Beyond the §6.2 U19/U20 amendment, no
    existing test may be modified, weakened, skipped, or deleted.

## 9. Docs

1. README: feature bullets for review bundles (headline it — this is the
   differentiator), diff-since-save, reading memory, `⌘K`, and word count;
   size claim per §1.7.

## 10. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U34, E1–E41 +
   E45–E63, W1–W6**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed; the
   bundle embeds the web viewer (exporting from the built app must work).
3. No Windows-reserved path components (the standard scan prints nothing).
4. `git diff src-tauri/tauri.conf.json` shows **only** the
   `beforeBuildCommand` change (CSP untouched); no sanitize-schema change;
   `git diff --stat docs/specs/` is empty;
   `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. README updated per §9; version files untouched (0.2.0-alpha.3); no new
   runtime dependencies.
