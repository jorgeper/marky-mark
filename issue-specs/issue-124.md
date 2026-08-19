# Spec: Implement print (#124)

## Goal

All acceptance criteria in issue-specs/issue-124.md are satisfied for issue
#124, with evidence visible in the session: File → Print… (⌘P) puts the
rendered document on paper — the same content the Export dialog's static page
carries — from every view mode (preview, edit, split), complete across all
pages instead of clipped to the visible viewport, with no app chrome
(toolbar, folder sidebar, comments panel, editor) and no dark page slab; the
screen DOM is unchanged once printing is done, a browser-initiated print
(no app print command) still yields a chrome-free page rather than a blank
one, new U- and E-numbered tests cover it; `npm run validate:quick` passes;
and a summary comment from the implementer exists on issue #124.

## Acceptance criteria

### 1. Print puts the document on paper, not the app

- Invoking `printDoc` (File → Print…, ⌘P, `src/App.tsx` command registry,
  `src/lib/menuSpec.ts`) prints the **rendered markdown of the open buffer** —
  the same body the Export dialog builds (`renderMarkdown` →
  `buildStaticHtml` in `src/lib/exportDoc.ts`) — not a screenshot of the live
  app window.
- The printed output is **identical in all three view modes**: preview, edit
  (CodeMirror only) and split. Printing from edit mode today prints the raw
  editor; after the change it prints the rendered document, and no
  `.editor-wrap` / CodeMirror content reaches the paper.
- The printed output is **the whole document**, not the visible screenful.
  `.workspace` is `overflow-y: auto` (`src/styles.css:273`), which is why the
  live-window print clips to one page today; the print output must flow across
  as many pages as the document needs.
- **No app chrome on paper**: toolbar (`.toolbar-shell`, `.toolbar-hotzone`),
  folder sidebar (`.folder-panel`, and any open folder slide), comments panel
  (`.panel`), comment navigator, word chip, split divider, edge tabs, dialogs
  and the front-matter metadata card (`.fm-card` — app UI per SPEC26 §2) are
  all absent. The current `@media print` block (`src/styles.css:1701`) misses
  `.folder-panel` and `.editor-wrap`; whatever replaces it must not.
- **Paper stays readable in dark mode**: with a dark theme active, the printed
  page has a light background and dark text (e.g. the print path uses
  `settings.themeLight`'s CSS, or forces a white page), never a dark slab. In
  light themes the document keeps its normal typography (`--mm-*` contract).
- Comment highlights, numbered comment refs, the Comments section and the
  word-count stats line are **not** on the printed page — Print… has no
  options dialog; Export… stays the route for those. (Say so in a citation
  comment so the choice is discoverable.)
- Print with **no document open stays a silent no-op** (E67's first assertion
  keeps passing).

### 2. How it is built — constraints, not a fixed design

- The desktop print invocation stays the native one that works: the Rust
  `print_view` command via `Platform.printCurrent` (`src/platform/tauri.ts`,
  `src-tauri/src/lib.rs:25`). SPEC18 §2 moved off `window.print()` because it
  is a WKWebView no-op, and off a throwaway print window because its teardown
  can kill the OS dialog — do not reintroduce either. The recommended shape is
  therefore: mount a **print-only root** (rendered document + theme CSS) into
  the current window, let `@media print` show only that root, invoke
  `printCurrent`, then tear the root down.
- The print root is **only in the DOM around the print invocation** and leaves
  the screen untouched: no visible flash, no layout shift, no leftover node,
  and no duplicate element `id`s while it is mounted (the rendered markdown
  carries heading anchors — strip or namespace them) so in-app anchor links
  and testid queries never resolve into the print copy.
- The `@media print` rules must **fail safe**: with no print root mounted (a
  browser-initiated ⌘P on the web build, or the desktop webview printing on
  its own), the page still prints as today's chrome-free document — never a
  blank page. State this in a comment; a test pins it.
- Rendering/normalizing logic goes in a pure module under `src/lib/` (extend
  `src/lib/exportDoc.ts` or add a sibling) so it is unit-testable without a
  browser; `src/App.tsx` only wires it. Reuse `buildStaticHtml` rather than
  duplicating its style block.
- A testability seam records what would have been printed: the browser/desktop
  shim (`src/platform/browser.ts:251`) keeps pushing `'print-current'` onto
  `window.__mmPrints` **unchanged** (E67 asserts the exact string) and
  additionally exposes the print body — e.g. `window.__mmPrintHtml` — for e2e
  assertions.
- Web behaviour is unchanged in scope: `printCurrent` may stay undefined on
  web (the browser's own ⌘P covers it) — but per the fail-safe rule that ⌘P
  must still produce the document, not a blank sheet. Wiring `window.print()`
  into the web `printDoc` is optional; if done, it must not hang the web e2e
  suite.

### 3. Tests, docs and the gate

- New unit coverage in `tests/unit/`, numbered from **U666** (U665 is the
  current high water mark): the pure print-document builder — document body
  present, no app-chrome markup, no comments/stats section, light theme
  substituted when the active theme is dark, and no duplicate-id leak.
- New Playwright coverage in `tests/e2e/`, numbered from **E249** (E248 is the
  current high water mark), in `tests/e2e/reading-and-export.spec.ts` beside
  E67. Cover at least: (a) printing from **edit** mode yields the rendered
  document (a fixture heading's text) and no CodeMirror text; (b) under
  `page.emulateMedia({ media: 'print' })` the toolbar, folder panel, comments
  panel and editor are not visible while the document is; (c) the screen DOM
  is back to normal after printing (print root gone, `[data-testid="doc"]`
  still unique).
- **E67 and E68 keep passing unmodified**, and no existing test is weakened,
  skipped or deleted.
- New or changed behaviour carries a citation comment in the repo's format
  (`.sandcastle/CODING_STANDARDS.md`, `docs/COMMENT-FORMAT.md`): `SPEC18 §2`
  where the native print path is touched, `issue #124` for the new behaviour.
- README's Export & Print bullet (`README.md:56–60`) still describes what the
  app does — update the print sentence if the behaviour it claims changed.
- `docs/MAP.md` matches what `scripts/map.mjs` derives — run `npm run map` and
  commit the result if any `SPEC<n>` citation moved or was added; the quick
  gate fails on a stale map.
- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx playwright test -g '<title>'` for one e2e), NOT the full suite after
  every change; any baseline at the start of the attempt was the quick tier
  only.
- `npm run validate:quick` has been run ONCE, at the end, right before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #124, naming what
  changed and quoting the quick-gate result line.

## Context

The issue body is one line — "print functionality should print the content of
the current page, instead of the current thing which prints the app
incorrectly" — with no comments, no PRD and no parent issue.

Today's path: `printDoc` (`src/App.tsx:3694`) calls
`platform.printCurrent()`; desktop invokes the Rust `print_view` command
(`src/platform/tauri.ts:388`, `src-tauri/src/lib.rs:21`) which natively prints
**the live window**, and a small `@media print` block
(`src/styles.css:1701–1719`) tries to hide chrome. That block hides
`.toolbar-shell`, `.comment-nav`, `.word-chip`, `.split-divider` and `.panel`
only — so the folder sidebar and the CodeMirror editor still print — and it
cannot undo `.workspace`'s scroll clipping, which is why long documents come
out as a single page of whatever was on screen.

The export path already builds exactly the artifact this issue wants:
`runExport` (`src/App.tsx:3568`) renders the buffer, then
`buildStaticHtml({ title, bodyHtml, themeCss, … })` (`src/lib/exportDoc.ts:58`)
emits a self-contained themed reading page whose own `@media print` rule
already flattens padding. SPEC18 (`docs/specs/SPEC18.md` §1–§2) is the
contract behind both export and the native print command; read it before
changing the print invocation.

Grep before opening files: `rg 'SPEC18' src src-tauri tests` for the print and
export contract, `rg 'printCurrent|printDoc|__mmPrints' src tests` for the
wiring and the e2e seam. Never read `src/App.tsx` end-to-end.
