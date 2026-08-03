# SPEC16 Five Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review-bundle export, diff-since-save, reading-position memory, ⌘K heading palette, and a word-count chip (SPEC16 §1–§5).

**Architecture:** Each feature sits behind a pure lib (`reviewBundle`, `diffLines`, `readingPositions`, `fuzzy`, `wordCount`) unit-tested first; App wires them through the existing command registry / menu spec / platform seams. The only platform additions: `reviewTemplate?()` and the web review-boot path.

**Tech Stack:** existing only — React 19, CodeMirror 6, diff-match-patch, unified. No new dependencies.

## Global Constraints

- Only new tests U29–U34, E60–E63, W6; sole amendment: U19/U20 File lists gain `exportReview`.
- tauri.conf.json: only `beforeBuildCommand` changes; CSP + sanitize untouched; versions stay 0.2.0-alpha.3; reserved-name scan clean.

---

### Task 1: five pure libs (U29–U33), TDD each

**Files:** Create `src/lib/reviewBundle.ts`, `src/lib/diffLines.ts`, `src/lib/readingPositions.ts`, `src/lib/fuzzy.ts`, `src/lib/wordCount.ts`; Tests `tests/unit/{review-bundle,diff-lines,reading-positions,fuzzy,word-count}.test.ts`.

**Interfaces (consumed by Tasks 2–6):**

```ts
// reviewBundle.ts
export interface ReviewPayload { name: string; markdown: string }
export function buildReviewBundle(templateHtml: string, payload: ReviewPayload): string; // throws if no </head>
export function extractReviewPayload(doc: Document): ReviewPayload | null;
export const REVIEW_PAYLOAD_ID = 'mm-review-doc';
// JSON.stringify output must escape `<` as < so `</script>`/`<!--` can't break out.

// diffLines.ts
export interface DiffLineSets { changed: number[]; deletedAfter: number[] } // 1-based buffer lines
export function diffLineSets(saved: string, current: string): DiffLineSets;
// diff-match-patch diff_linesToChars_ / diff_main / diff_charsToLines_; walk diffs tracking
// the current-buffer line; EQUAL advances, INSERT marks its lines changed, DELETE marks
// deletedAfter = the last current line before the deletion (0 allowed for start-of-file).

// readingPositions.ts
export interface PositionStore { version: 1; entries: Array<{ path: string; line: number; at: string }> }
export function parsePositions(json: string): PositionStore;         // corrupt → {version:1, entries:[]}
export function serializePositions(s: PositionStore): string;
export function rememberPosition(s: PositionStore, path: string, line: number, at: string): PositionStore; // front, dedupe, cap 200
export function positionFor(s: PositionStore, path: string): number | null;

// fuzzy.ts
export function fuzzyFilter<T>(query: string, items: T[], text: (t: T) => string): T[];
// case-insensitive subsequence; score: consecutive-run and word-start bonuses; empty query → items as-is.

// wordCount.ts
export function countWords(text: string): { words: number; minutes: number };
// tokens matching /[\p{L}\p{N}]/u count; minutes = words ? Math.max(1, Math.ceil(words/220)) : 0.
```

- [ ] For each lib: write the U-test (failing) → implement → pass. Test essentials:
  - **U29:** round-trip name+markdown byte-identical incl. a doc containing `</script>`, `<!--`, and a comment trailer; injected exactly once before `</head>`; template without `</head>` throws. Use `new DOMParser().parseFromString(bundle, 'text/html')` for extract (vitest env must be capable — see note below).
  - **U30:** identical → both empty; append two lines → changed [n+1, n+2]; delete middle line → deletedAfter [k]; replace line → changed [k]; edits at start (deletedAfter [0]) and end.
  - **U31:** parse/serialize round-trip; corrupt → empty; remember bumps/dedupes/caps at 200 (201st evicts the oldest).
  - **U32:** 'wc' matches 'Word Count' (word starts) and ranks it above 'awkward chorus'; case-insensitive; no-match excluded; '' preserves order.
  - **U33:** 'one two three' → 3; unicode words count; '--- ***' → 0 words 0 min; 221 words → 2 min; 1 word → 1 min.
- [ ] **Vitest env note:** unit tests run in node (no DOM). For U29's extract, run that one file under jsdom via a `// @vitest-environment jsdom` pragma comment at the top of `review-bundle.test.ts` (jsdom is NOT a dependency — check `npx vitest --help`/config first; if jsdom is unavailable, make `extractReviewPayload` accept a minimal `{ getElementById(id): { textContent } | null }` interface instead of full Document and test with a stub object — choose this signature from the start, it's what web.ts has anyway).
- [ ] `npx vitest run tests/unit` → all green (33 tests total); typecheck; commit `feat: SPEC16 pure seams — reviewBundle, diffLines, readingPositions, fuzzy, wordCount (U29-U33)`.

### Task 2: commands, hotkeys, menu (U34 + U19/U20 amendment)

**Files:** Modify `src/lib/commands.ts` (`exportReview`, `toggleDiff`, `headingPalette`), `src/lib/hotkeys.ts` (`headingPalette: 'Mod+K'`), `src/lib/menuSpec.ts`, `src/components/SettingsPanel.tsx` (`headingPalette: 'Go to heading'`), `tests/unit/menu-spec.test.ts`.

- [ ] `MenuState` gains `canExportReview: boolean; showDiff: boolean`. File menus: `cmd('exportReview', 'Export Review Bundle…')` after saveAs iff `canExportReview` (both layouts). View, after `prevComment`: `...(s.mode === 'edit' ? [cmd('toggleDiff', 'Changes Since Save', undefined, s.showDiff)] : [])`, then `cmd('headingPalette', 'Go to Heading…', s.hotkeys.headingPalette)`.
- [ ] Amend U19/U20 File expectations to include `exportReview` (base menu state in the test gets `canExportReview: true, showDiff: false`; add both fields to the `base` fixture). Add U34 asserting: exportReview present iff canExportReview; toggleDiff only when mode==='edit' with checked tracking showDiff; headingPalette accelerator follows rebinds.
- [ ] Existing-suite check: U25's slice stays contiguous (new items after prevComment). All units green; typecheck. App.tsx won't compile until Task 5 registers handlers — if so, fold the commit into Task 5's or add stub handlers now (`exportReview: () => {}` etc. is NOT acceptable to leave — wire real ones in Task 5 and commit together if needed).

### Task 3: platform — reviewTemplate + web review boot + build order

**Files:** Modify `src/platform/types.ts`, `src/platform/tauri.ts`, `src/platform/browser.ts`, `src/platform/web.ts`, `src-tauri/tauri.conf.json`.

- [ ] `types.ts`: `reviewTemplate?(): Promise<string | null>;` (JSDoc: SPEC16 §1.5).
- [ ] `tauri.ts`:

```ts
  // SPEC16 §1.5: the single-file web viewer embedded at build time. glob
  // (not a bare import) so a dev tree without dist-web still compiles.
  const templates = import.meta.glob('/dist-web/index.html', { query: '?raw', import: 'default' });
  // in the platform object:
    async reviewTemplate() {
      const load = templates['/dist-web/index.html'];
      if (!load) return null;
      return (await load()) as string;
    },
```

- [ ] `browser.ts` (unconditional, like busEmit): `async reviewTemplate() { return '<!doctype html><html><head><meta charset="utf-8"><title>stub</title></head><body>mm-stub-template</body></html>'; }`
- [ ] `web.ts`: `reviewTemplate` stays undefined. Review boot: at the top of `createWebPlatform`, after seeding welcome:

```ts
  // SPEC16 §1.3: a review bundle embeds its document — open it on boot.
  const review = extractReviewPayload(document);
  if (review) docs.set(docPathFor(review.name), { content: review.markdown, handle: null });
```

and `onOpenFile(cb)` delivers it: `if (review) cb(docPathFor(review.name));`

- [ ] `tauri.conf.json`: `"beforeDevCommand"` unchanged; `"beforeBuildCommand": "npm run build:web && npm run build"`.
- [ ] Typecheck; commit `feat: SPEC16 review template seam, web review boot, build order`.

### Task 4: Editor diff decorations

**Files:** Modify `src/components/Editor.tsx`.

- [ ] New prop `diff?: DiffLineSets | null`. Implementation: a `Compartment` holding a `StateField`-free approach — simplest is `EditorView.decorations.of(...)` rebuilt via `compartment.reconfigure` in a `useEffect([diff])`:

```ts
import { Decoration, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const changedLine = Decoration.line({ class: 'mm-diff-changed' });
const deletedLine = Decoration.line({ class: 'mm-diff-deleted-after' });

function diffDecorations(view: EditorView, diff: DiffLineSets): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lines = view.state.doc.lines;
  const marks = new Map<number, Decoration>();
  for (const n of diff.changed) if (n >= 1 && n <= lines) marks.set(n, changedLine);
  for (const n of diff.deletedAfter) {
    const at = Math.min(Math.max(n, 1), lines); // deletion at start clamps to line 1
    if (!marks.has(at)) marks.set(at, deletedLine);
  }
  for (const n of [...marks.keys()].sort((a, b) => a - b)) {
    builder.add(view.state.doc.line(n).from, view.state.doc.line(n).from, marks.get(n)!);
  }
  return builder.finish();
}
```

Reconfigure on prop change; `[]` when null/off. CSS (styles.css):

```css
/* SPEC16: changes-since-save tints (theme-overridable) */
.cm-line.mm-diff-changed { background: var(--mm-diff-changed-bg, rgba(46, 160, 67, 0.14)); }
.cm-line.mm-diff-deleted-after { box-shadow: inset 3px 0 0 var(--mm-diff-removed, #d1242f); }
```

- [ ] Typecheck; commit with Task 5 if App must compile first.

### Task 5: App wiring — all five features

**Files:** Modify `src/App.tsx`, `src/styles.css`; Create `src/components/HeadingPalette.tsx`.

- [ ] **Export:** command handler — template → compose → save dialog → write:

```ts
      exportReview: () => {
        void (async () => {
          const s = stateRef.current;
          const p = s.platform;
          if (!p?.reviewTemplate || !p.saveFileDialog || !s.docPath) return;
          const template = await p.reviewTemplate();
          if (!template) return;
          const name = p.basename(s.docPath);
          const target = await p.saveFileDialog(`${name.replace(/\.(md|markdown)$/i, '')}.review.html`);
          if (!target) return;
          const markdown = attachEmbedded(s.buffer, s.comments);
          await p.writeTextFile(target, buildReviewBundle(template, { name, markdown }));
        })();
      },
```

`canExportReview`: App state resolved once after platform load (`platform.reviewTemplate ? (await platform.reviewTemplate()) !== null : false`) — store in a `useState(false)`; feed the menu-spec effect (add to deps).
- [ ] **Diff:** `const [showDiff, setShowDiff] = useState(false);` reset in `openDoc`; command `toggleDiff: () => setShowDiff(v => !v)` (edit modes only need apply — menu hides it in preview; hotkey none). Debounced compute:

```ts
  const [diff, setDiff] = useState<DiffLineSets | null>(null);
  useEffect(() => {
    if (!showDiff || mode !== 'edit') { setDiff(null); return; }
    const t = setTimeout(() => setDiff(diffLineSets(savedText, buffer)), 200);
    return () => clearTimeout(t);
  }, [showDiff, mode, buffer, savedText]);
```

Pass `diff={diff}` to both Editor instances. Menu-spec effect gains `showDiff` + deps.
- [ ] **Positions:** load store after platform boot (alongside settings); helpers:

```ts
  const positionsRef = useRef<PositionStore>({ version: 1, entries: [] });
  const savePositions = ... // write-through to configDir/positions.json (fire and forget)
  const recordPosition = useCallback((line: number) => {
    const path = stateRef.current.docPath;
    if (!path) return;
    positionsRef.current = rememberPosition(positionsRef.current, path, line, new Date().toISOString());
    void savePositions();
  }, []);
```

Capture: (a) preview workspace scroll listener (debounced 500 ms) computing `lineAtOffset(collectAnchors(ws, doc), …)`; (b) in `toggleMode`, record the carried line; (c) in `openDoc`, before switching docs, record the current line (compute per current mode — reuse the toggleMode capture logic as a small `currentTopLine()` helper). Restore: in `openDoc`, set `pendingScrollLineRef.current = positionFor(store, path)` — the existing SPEC15 restore effects already scroll preview/editor to `pendingScrollLineRef` (keyed [mode, html]); opening sets mode 'preview', so the preview restore effect handles it once html lands. Guard: openDoc currently doesn't touch pendingScrollLineRef — setting it there is the entire restore hook.
- [ ] **Palette:** `HeadingPalette.tsx` — props `{ headings: Array<{ line: number; depth: number; text: string }>, onJump(line: number, text: string): void, onClose(): void }`; internal query state, `fuzzyFilter`, ↑/↓ index, Enter/click → onJump, Esc/scrim-click → onClose; test ids per spec. App: `paletteOpen` state; command `headingPalette: () => setPaletteOpen(v => !v)` (no doc → headings []); headings from the CURRENT doc html: parse via the rendered DOM (`docRef.current ?? splitDocRef.current` query `h1..h6[data-mm-line]`) at open time. Jump: preview → find el by data-mm-line & scroll `ws.scrollTop` so it tops (reuse offset math), flash optional; edit → `editorSyncRef.current?.scrollToLine(line)`. Hotkey listener chain gains `headingPalette`. Render overlay near the modals. Palette styles in styles.css (reuse `.overlay`-like scrim but lighter: its own `.palette-scrim` that closes on mousedown).
- [ ] **Chip:** derived state, debounced like diff:

```ts
  const [chip, setChip] = useState('');
  useEffect(() => {
    if (!docPath) { setChip(''); return; }
    const t = setTimeout(() => {
      const text = mode === 'preview' ? docTextRef.current : buffer;
      const sel = mode === 'preview' && selInfo ? docTextRef.current.slice(selInfo.start, selInfo.end) : '';
      const { words, minutes } = countWords(sel || text);
      setChip(`${words.toLocaleString('en-US')} words · ${minutes} min`);
    }, 200);
    return () => clearTimeout(t);
  }, [docPath, mode, buffer, html, selInfo]);
```

Render `{chip && <div className="word-chip" data-testid="word-chip">{chip}</div>}`; CSS: fixed, left 14px, bottom 14px, small muted themed pill (mirror `.comment-nav` styling, no buttons).
- [ ] `npm run typecheck && npm run test:unit && npm run test:e2e` — all existing green. Commit (with Tasks 2/4 files if held back) `feat: SPEC16 app wiring — export, diff toggle, reading memory, palette, word chip`.

### Task 6: e2e E60–E63 + W6

**Files:** Modify `tests/e2e/app.spec.ts`, `tests/e2e/web.spec.ts`.

- [ ] **E60** (reading memory): `splitApp(page, false)`-style long doc but stay in preview (open via hash, don't enter edit). Scroll `.workspace` to ~40%; poll that `/config/positions.json` (fsRead) records `/docs/long.md` with line > 10. `page.reload()`; doc reopens? (reload → empty state; reopen via hash goto) → poll workspace scrollTop within a tolerance of the pre-reload value (or assert top bracketing anchors contain the remembered line — reuse `previewTopAnchorLines(page, '.workspace')`).
- [ ] **E61** (palette): welcome doc; `Control+k` → `heading-palette` visible; type `themes` → first `heading-palette-item` contains 'Themes'; Enter → the Themes h2 tops the workspace (bounding-box near pane top ±120px); palette gone. Split mode: `Control+k`, jump to a marker → `editorTopGutterLine` ≈ marker line ±5. Esc closes without jumping.
- [ ] **E62** (chip): welcome doc → `word-chip` visible matching `/^\d[\d,]* words · \d+ min$/`; record it; `selectPhrase(page, PHRASE)` → poll chip changed (smaller count); click away → back to full count; `Control+e`, type words → count grows.
- [ ] **E63** (export): welcome + 2 comments (`addComment` ×2); `nextSavePath = '/docs/welcome.review.html'`; dispatch export via hotkey? No — menu/`dispatchCommand`: use `freshNativeMenuApp` + `menuClick(page, 'exportReview')` (shim canExportReview true via stub template). Poll `fsRead('/docs/welcome.review.html')`: contains `mm-stub-template`, contains `id="mm-review-doc"`, and the JSON parses with markdown containing both comment bodies and the trailer marker. (Add comments before export; comments require preview mode ✓.)
- [ ] **W6** (real bundle, zero network): in web.spec.ts — read `dist-web/index.html` via node `fs` at test time, compose with `buildReviewBundle` (import from `../../src/lib/reviewBundle`) with a payload containing one embedded comment; `page.route('**/review.html', fulfill html)`; track non-localhost requests like W4 does (copy its listener pattern); `page.goto('/review.html')` → doc renders (`getByTestId('doc')` shows the payload heading), comment card visible; `expect(external).toEqual([])`.
- [ ] Run all suites; commit `test: SPEC16 e2e — memory, palette, chip, export, real-bundle boot (E60-E63, W6)`.

### Task 7: README + full gate

- [ ] README: add a headline bullet for review bundles under "What you get" (first among the five), extend edit bullet with diff-since-save, add reading-memory + ⌘K + word-count mentions compactly (one bullet can carry palette+memory+chip: "Creature comforts — …"). Check the built .app size; if it left "~6 MB", update the size text (likely "~8 MB").
- [ ] `npm run validate` (U1–U34, E1–E63 minus 42–44, W1–W6, ALL PASSED); `npm run tauri build` (verify dist-web embedded: exported grep for `mm-review-doc` support — manual smoke via install:app later); DoD greps: reserved-name scan, tauri.conf diff shows only beforeBuildCommand, specs diff empty, no skip/only/todo.
- [ ] Commit docs + plan; report with evidence.
