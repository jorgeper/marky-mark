# SPEC46: Marky Mark v46 — performance pass (same behavior, less work)

Delta spec on top of SPEC.md–SPEC45.md as implemented. This file wins on
conflict; nothing may regress. Unlike every prior delta, SPEC46 ships **no
user-visible change at all**: it is a work-reduction contract. Every feature,
byte of output, file format, and timing guarantee is frozen; what changes is
how much computation each of them costs.

**What ships:** the verified findings of the 2026-07-19 whole-codebase
performance review, as five tiers of fixes — the typing hot path, React
rendering, scroll sync, startup/IPC, and bundle/binary — each provably
behavior-preserving, gated by the full existing test suite plus new
work-counting tests (E129–E133, U77–U80) that assert the *absence of work*,
never wall-clock time.

## §0 The invariant (governs every item below)

1. **Byte identity.** Rendered HTML, canonical/collapsed text, saved files,
   sidecars, drafts, `settings.json` and friends, and the comment-anchor
   coordinate space are byte-identical to v45 for every input.
2. **Contract identity.** Every debounce interval, ordering guarantee, and
   tolerance in SPEC1–SPEC45 holds unchanged — including SPEC15 §1.2–1.4,
   SPEC44's one-innermost-container invariant, SPEC45's cue-window fallback,
   the SPEC30 boot order (explicit opens always win), and the SPEC38 §3.5
   canonical-text rule.
3. **Green gate.** `npm run validate` passes with every existing U/E/W test
   unmodified. No existing test may be weakened to land a tier.
4. **Cache honesty.** Every cache introduced here is keyed on the identity of
   an immutable input (a CodeMirror `Text`, a `GridSet`, the `buffer` string,
   an injection generation) and holds a value that is a pure function of that
   key. A cache that could ever serve a stale value is a spec violation, not
   a perf trade-off.

## §1 Instrumentation seam

`src/lib/perfCount.ts` (pure, tiny): named monotonic counters with a
module-level enabled flag. In production builds the flag is never set and
`bump(name)` is a single boolean test. The dev/e2e shim (`browser.ts`)
enables it and exposes the counters as `window.__mmPerf` — the same seam
pattern as `__mmMenu`/`__mmTrash`/`__mmClipboard`. Counted sites (at
minimum): full-document string materialization in the table layer
(`tableScan`), `parseDisplay` (`parseDisplay`), `layoutTable`
(`layoutTable`), `canonicalizeAll` real computations vs. cache hits
(`canonMiss`/`canonHit`), scroll-sync table builds (`syncTable`), preview
cue DOM sweeps (`cueSweep`), margin-card layout passes (`cardLayout`),
`positions.json` writes (`posWrite`), and `setAppMenu` installs
(`menuInstall`). Counters are observability only — no app logic may read
them.

## §2 Tier 1 — the typing hot path

- **2.1 Scoped table detection.** `tableModeWatcher` (tableMode.ts) stops
  scanning the whole document per keystroke. (a) A tracked span whose bytes
  no change touched (`u.changes.touchesRange`) is never re-verified — its
  round-trip verdict is a pure function of its unchanged text. (b) Candidate
  detection (`allTableRegions`) runs only over the changed neighborhood:
  each changed range expanded to its enclosing contiguous run of
  `|`-containing lines plus one line each side. A table can only appear or
  break where text changed, so the locally-computed candidate/broken sets
  equal the global ones. The deferred `setTimeout(0)` re-verify + `gridifyAll`
  pass is unchanged in timing and effect.
- **2.2 Shared one-slot caches.** Three caches, each one slot, identity-keyed:
  `Text → string` (the full-doc materialization), `(string, GridSet) →
  canonical string` (serving `canonHeadOf`, `canonicalText`/App `dirty`, the
  diff/draft/render effects, and the Editor unmount report), and `buffer →
  line-starts table` (serving `applyActiveCues`, the selection mirror,
  preview-click placement, and `handleEditState`). `canonicalizeAll` itself
  becomes a single-pass ascending splice (parts + one join) instead of one
  full-document copy per span — same output, O(doc + Σspans).
- **2.3 `alignFilter` ordering.** The selection-clamp branch computes
  `spanAt` and takes its both-endpoints-outside early return *before*
  materializing the document; the docChanged branch reuses one parsed
  display (`displayRoundTrips` grown to return its parse) instead of
  parsing the same region three times and laying it out twice.
- **2.4 `parseDisplay` separators.** Membership via `Set`, not
  `Array.includes` — removes the O(rows²) term for large tables.
- **2.5 Front matter early-out.** `parseFrontMatter` returns null on
  `!text.startsWith('---')` before any split; when front matter exists it
  splits only through the closing fence. (`FENCE_OPEN` can only match a
  document whose first bytes are `---`, so the early return is exact.)
- **2.6 Editor value-sync echo skip.** The editor records the exact string
  it emitted through `onChange`; the `[value]` effect returns immediately on
  reference equality with that string instead of materializing and comparing
  the whole document. External values (watcher reload, discard, doc switch)
  are by construction never the emitted object, so the converge path is
  untouched.
- **2.7 Decoration caching.** `diffDecorations` returns its cached set while
  `view.state.doc` is identity-unchanged (the `diff` is fixed per closure);
  `imageView`'s `buildDecos` caches `allImageRefs` keyed on doc identity so
  caret-only transactions reuse it; `computeChips` reads
  `sliceDoc(span.from, span.to)` (offsets shifted symmetrically) and caches
  its parse keyed on `(doc, head span)` so scroll frames redo only geometry.
- **2.8 Hotkey pre-parse.** The hotkey map compiles to parsed combos once
  per `settings.hotkeys` identity; the per-keydown chain matches against the
  compiled form, and the format-command id table is a module constant. Match
  order is preserved exactly.
- **2.9 Word count honesty.** The chip effect early-returns when
  `settings.showWordCount` is off (the setting joins the deps, so enabling
  it recomputes immediately); the edit-mode path no longer re-fires on
  `html`; counting iterates matches without materializing a token array.

## §3 Tier 2 — React rendering

- **3.1 Margin-card layout.** The SPEC6 layout `useLayoutEffect` gains (a) a
  highlight index — the injection pass that creates `mark.hl` elements also
  records a `cid → element` map, killing the per-card `querySelector` — and
  (b) a dependency array covering every React-flowing input (`html`,
  `comments`, `positions`, `activeId`, `pending`, `draft`, `showComments`,
  `settings.showResolved`, `settings.commentsEnabled`, `mode`, `chip`) plus
  a ResizeObserver on the panel so card-height changes from text reflow
  (composer/reply edits, panel width) still trigger a pass. Card positions
  after any sequence of events are pixel-identical to v45.
- **3.2 Selection equality bail.** The preview `selectionchange` handler
  bails (`prev` returned) when `{start,end,x,y}` are unchanged; the
  type-to-comment effect depends on the fields it reads, not the object.
- **3.3 Dirty fast path.** `buffer === savedText` short-circuits `dirty` to
  false without invoking `canonicalText` (`savedText` is canonical by
  construction and canonicalization is idempotent — SPEC38 §3.5); otherwise
  the 2.2 cache serves the canonical string.
- **3.4 Derived comment lists.** `byPosition`/`open`/`resolved`/`items`
  memoize on `[comments, positions, settings.showResolved, pending]`.
- **3.5 FolderPanel.** `React.memo`, with the `caps` object memoized on
  `[platform]` and the eight inline handlers made stable (they already read
  live state through `stateRef`, so stable identity is safe). Typing no
  longer re-renders the tree.
- **3.6 Theme apply guard.** `applyThemeCss` returns when the element
  already holds the same text — one line, fixes the aux-window
  restyle-per-settings-keystroke and idle theme reloads everywhere.
- **3.7 Cue/mirror caches.** `applyActiveCues` and the selection mirror run
  off the 2.2 line-starts cache, a per-injection stamped-element list, and a
  per-injection pane `getDocText` cache (mark wrap/unwrap preserves
  concatenated text — the domtext invariant — so the cache survives mark
  churn); `rangeToOffsets` walks to its boundary instead of materializing
  `Range.toString()` twice.
- **3.8 Small hygiene.** `ACTIVE_CONTAINERS` to module scope; the auto-hide
  toolbar `mousemove` handler exits immediately under a native menu and
  stops re-scheduling timers when hover state is already settled;
  `onInsertImage` gets a stable identity.

## §4 Tier 3 — scroll sync

- **4.1 Precomputed sync table.** `scrollSync.ts` gains `buildTable(anchors,
  contentHeight)` plus table-taking mapping variants; the SPEC15 controller
  builds the table once per `rebuild()` and maps per frame against it.
  `lineAtOffset`/`offsetForLine` remain as thin wrappers (U27 unchanged).
- **4.2 Cue element cache.** The per-frame `mark.mm-active-word` /
  `.mm-active-block` sweeps are replaced by a ref written by the code that
  owns cue lifecycle (`applyActiveCues`/`clearActiveCues`/injection); the
  cue's rect is still read live each frame, so alignment is never stale.
  The lookup also moves after the end-clamp early-outs.
- **4.3 Follower no-op guards.** `previewLeads` skips the CodeMirror
  dispatch when the editor is already within tolerance of the target
  (mirroring `editorLeads`' existing 1px guard), and stamps its quiet
  window only when it actually writes. E57/E58/E128 tolerances are
  unaffected; settle behavior only gets stabler.
- **4.4 rAF coalescing.** The two scroll handlers keep one pending frame
  callback apiece (the `scheduleChips` pattern); the surviving callback
  reads the freshest scrollTop, preserving SPEC15 §1.4's
  within-one-frame guarantee.

## §5 Tier 4 — startup & IPC

- **5.1 Parallel boot.** After `configDir()`, the five independent loads
  (settings, themes, positions, recent, foldertree) run under
  `Promise.all`, as do the per-user-theme reads inside `loadAllThemes` and
  the three listener registrations. State lands via the same setters in the
  same code order; the reopen decision still waits for listener
  registration and the pending-open drain (SPEC30 §2 explicit-opens-win is
  untouched).
- **5.2 No exists-preflight.** Every `exists → read` pair becomes a direct
  read with the rejection handled as "missing" (all sites already carry the
  try/catch); `readDirEntries`/`readDirNames` catch instead of pre-check;
  `mkdirp` drops its check (`create_dir_all` is idempotent). Halves
  config/sidecar/tree IPC.
- **5.3 Reopen delay.** The fixed 250 ms reopen timer shrinks to a short
  post-drain delay (≤50 ms), and the dormant open-set liveness checks run
  concurrently. Gate: manual macOS double-click-launch verification that a
  file-association open still beats the reopen (the synchronous
  explicit-open flag already decides the race before the timer starts).
- **5.4 Reading-position writes.** A scroll pause whose top line equals the
  stored line for that path writes nothing (the in-memory timestamp is
  unobservable); the stamped-block anchor sweep is cached per rendered
  `html` and invalidated on zoom/font-size/margin changes.
- **5.5 Menu efficiency.** `setAppMenu` constructs the menu from plain
  option objects in one `Menu.new({items})` tree instead of one IPC per
  item (preserving the CheckMenuItem and accelerator-fallback handling);
  the App effect drops the unused `fmOverride` dep (keying on the derived
  `showFrontmatter` instead) and skips installation entirely when the
  serialized spec is byte-identical to the last installed one. Every
  visible menu change still installs atomically.
- **5.6 Async trash.** `trash_entry` becomes `#[tauri::command(async)]` so
  Trash I/O leaves the main thread. Same result and error surface;
  `print_view` stays sync (webview print is a main-thread API).

## §6 Tier 5 — bundle & binary

- **6.1 Window-role code split.** `main.tsx` lazy-loads `App` and
  `AuxWindow` behind the existing `windowRole` switch (with a trivial
  Suspense fallback), so Settings/About windows stop evaluating the App
  module graph. The SPEC13 handshake is effect-driven and unaffected.
- **6.2 Highlighter off the critical path.** `markdown.ts` loads
  `rehype-highlight` via dynamic import on first render (`renderMarkdown`
  is already async at every call site). The grammar set is **not**
  subsetted — output stays identical for every language.
- **6.3 Fixture weight.** `welcome.md` ships as a direct raw import; the
  full `FIXTURES` glob moves into the shim's chunk (its only production
  consumer); the THEMES guide loads lazily at first-run seeding.
- **6.4 Rust profile.** `panic = "abort"` in the release profile (no
  command relies on unwind recovery); `crate-type` drops the mobile-only
  `staticlib`/`cdylib` (release link time only).
- **6.5 Web config writes.** The web platform skips `saveConfig`
  serialization when the written value is unchanged. (Key-per-path storage
  is explicitly deferred — it needs a migration.)

## §7 Deferred — named non-goals (SPEC47 candidates)

Real findings, excluded here because their blast radius exceeds this spec's
appetite: **incremental block-level diffing of the split preview** (the
dominant split-typing cost: full `innerHTML` + image re-decode per 200 ms
render); **splitting the preview injection effect** so comment-metadata
changes stop rebuilding the DOM (the effect is the hub for find marks,
selection restore, and cues); **FindBar-local query state**; **a batched
`list_dirs` Rust command**. None may be smuggled in under this spec.

## §8 Tests

New, all work-counting via §1 counters (no wall-clock assertions anywhere):

- **E129** — grid view on, large table-free document: a 20-keystroke burst
  performs zero `parseDisplay`/`layoutTable` calls and zero full-document
  table scans (v45 performed one full scan per keystroke; the assertion
  pins the zero).
- **E130** — document with one grid table, caret editing outside it: a
  keystroke burst never re-verifies the untouched span (zero
  `parseDisplay` for its region) and `canonMiss` grows at most once per
  doc change, never on caret-only moves.
- **E131** — split mode, steady scroll far from the cue: zero `syncTable`
  builds and zero `cueSweep`s after the initial rebuild; E57/E58/E128
  still pass unmodified.
- **E132** — preview scroll pause at an unchanged top line: `posWrite`
  does not grow; scrolling to a new line writes exactly once.
- **E133** — an action that leaves the menu spec byte-identical installs
  no menu (`menuInstall` flat, via `__mmMenu`); any label/state change
  still reinstalls.
- **U77** — single-pass `canonicalizeAll` ≡ the v45 per-span splice on
  generated multi-table documents (byte identity).
- **U78** — `buildTable` + table-taking mappers ≡ `lineAtOffset`/
  `offsetForLine` across random anchor sets (including non-monotonic and
  empty).
- **U79** — bounded `parseFrontMatter` ≡ v45 output over fixtures with no
  fence, unclosed fence, and fenced documents.
- **U80** — compiled hotkey matching ≡ `eventMatches` over the full
  default map and adversarial combos (strict-Ctrl, Alt/Shift code
  matching preserved).

**Gate to declare SPEC46 done:** `npm run validate` fully green (every
existing test unmodified) + E129–E133/U77–U80 green + the §5.3 manual macOS
check + the ARCHITECTURE.md measured-performance table re-measured and
updated, with cold launch, large-file open, and toggle numbers at or below
their v45 values.
