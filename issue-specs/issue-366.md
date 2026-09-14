# Spec: Client editor control surface: execute bridge tool requests through @marky-mark/editor public handles with revision guard and typing-like edits (#366)

## Goal

All acceptance criteria in issue-specs/issue-366.md are satisfied for issue
#366, with evidence visible in the session: a pure, transport-free client
module (e.g. `src/lib/agentBridgeClient.ts`) executes every one of the nine
`BridgeToolRequest`s from `src/lib/agentBridgeProtocol.ts` against injected
`@marky-mark/editor` public handles and injected command-registry callbacks
and answers a typed `BridgeToolResult` whose snapshot carries a buffer
revision; the four mutating tools refuse a request whose revision no longer
matches the live buffer with `stale_revision` carrying the fresh state, and
otherwise land as one undo unit that marks the document dirty and triggers no
autosave; every editor capability the executor needs that the package did not
expose is added to the package's public API with in-package tests and listed
in `editor/AGENTS.md`; bridge code reaches the editor only through those
handles and the registry (no new `window.*` globals, no CodeMirror internals,
no `__mm*` seams); unit tests with fake handles cover every tool and the
guard, and an e2e test drives the executor through typed envelopes (not
`__mm*` globals) to prove undo grouping, the dirty flag and no autosave;
nothing user-visible changes (no transport, no toggle); `npm run
validate:quick` passes in the implementer's session; and a summary comment
from the implementer exists on issue #366.

## Acceptance criteria

### The executor module (PRD 027 Req 13)

- **One pure module** (e.g. `src/lib/agentBridgeClient.ts`, unit-tested by the
  matching `tests/unit/agent-bridge-client.test.ts`) exports a factory (e.g.
  `createBridgeExecutor(deps)`) and an executor with at least
  `execute(request: BridgeToolRequest): Promise<BridgeToolResult>` and
  `snapshot(): EditorStateSnapshot`. It follows the `src/lib` rules (no
  `react`, no `@tauri-apps/*`, no `src/components/`, no DOM access, no
  `console.*`) and imports editor types with `import type … from
  '@marky-mark/editor'` only. It never imports `src/App.tsx` or CodeMirror
  packages (`@codemirror/*`), and it contains no `window.` reference.
- **Every capability arrives injected.** `deps` carries: getters for the live
  handles (`SmartEditHandle | null`, `EditorSyncHandle | null`,
  `SelectSourceRange | null`, and, if needed, `FocusEditor | null`), a getter
  for the document (`{ path: string | null; content: string; dirty: boolean }`
  — the content is the CANONICAL buffer, as `SmartEditHandle.canonicalText`
  defines it), a feed for `EditStateReport`s (the executor is handed every
  `onEditState` report the app receives), and command callbacks
  `openFile(path): Promise<void>` and `save(): Promise<boolean>` whose app
  wiring goes through `src/lib/commands.ts` (`dispatchRecent(path, 'file')`
  and `dispatchCommand('save', …)` or the registry's own handlers) — never a
  second open/save implementation.
- **Tool coverage is total.** A `Record<BridgeToolName, …>` (or `satisfies`)
  ties the executor's handlers to the protocol's union, so a tool added to
  `BRIDGE_TOOL_NAMES` without a handler here fails `npm run typecheck`.
  Semantics per tool:
  - `get_editor_state` → `{ ok: true, state }`, no side effect.
  - `open_file` → `openFile(path)` through the registry; the result snapshot
    reports the newly open `path`.
  - `scroll` → `EditorSyncHandle.scrollToLine` for `{ to: 'line' }`; by
    `lines` scrolls relative to the current `topLine()`; by `pages` scrolls
    by the viewport's visible line count (a new package capability, below);
    `{ to: 'heading' }` resolves the heading text to its 1-based canonical
    line with `parseSections` from `src/lib/sectionModel.ts` (exact title
    match after trimming; case-insensitive is acceptable) and scrolls there;
    an unknown heading answers `tool_failed`. Scrolling never moves the caret
    or selection.
  - `set_selection` → the `SelectSourceRange` seam (canonical offsets, no
    focus steal, `reveal: true`); the result snapshot shows the new range.
  - `replace_selection`, `insert_text` (at the caret / over the current
    range), `replace_range` (explicit canonical `[from, to)`), `apply_format`
    (`SmartEditHandle.applyFormat(op)`) → the revision guard first (next
    section), then the edit; the result snapshot already reflects the edit
    (content, cursor, revision) — not a stale React render.
  - `save` → `save()` through the registry; on success the result snapshot
    has `dirty: false`; a refused/failed save (including PRD 016's 412 path,
    whose dialog and semantics are untouched) answers `tool_failed` or a
    still-dirty snapshot — it never bypasses the hosted save path.
- **Missing handle ⇒ typed failure.** When the needed handle is `null` (no
  document open, preview mode) the tool answers `{ ok: false, error: { code:
  'tool_failed', message } }` with a message naming the reason (e.g. "editor
  is not in edit mode"); `get_editor_state` still answers with `path: null`
  or the preview-mode buffer. Nothing throws out of `execute`.

### Revision guard (PRD 027 Req 8)

- `EditorStateSnapshot.revision` is derived from the buffer identity: it
  changes whenever `path` or canonical `content` changes and is stable while
  they do not (a deterministic hash of both, or a counter bumped from the
  document feed — the implementer's choice, documented at the definition).
  It is recomputed at execution time, never cached across calls.
- Every mutating request (`isMutatingTool`) whose `revision` differs from the
  current one answers `{ ok: false, error: { code: 'stale_revision', message,
  state } }` where `state` is the fresh snapshot, and performs NO edit. A
  matching revision proceeds; the success result's `state.revision` is the
  new one, and a following `get_editor_state` returns that same new revision.
- Non-mutating tools never check a revision.

### Typing-like edits (PRD 027 Req 12)

- Each mutating call lands as exactly ONE CodeMirror history step: a single
  undo (`Mod+Z`) reverts the whole tool call and nothing else. The document
  becomes dirty through the app's ordinary edit path (the same `onChange` →
  buffer update typing uses), so the dirty dot appears and `Mod+S` saves as
  for a typed edit. No autosave is triggered: the on-disk file is unchanged
  after any mutating tool until `save` or a user save.
- After a text edit the caret sits at the end of the inserted text (typing
  semantics); `apply_format` keeps the package's existing post-format
  selection.

### Editor package additions (PRD 027 Req 13, editor/AGENTS.md rules)

- Capabilities the executor needs but the package lacks are added to the
  public handles in `editor/src/components/Editor.tsx` and exported through
  `@marky-mark/editor` — at minimum: a programmatic replace on
  `SmartEditHandle` (e.g. `replaceRange(from, to, text)`) that takes CANONICAL
  offsets, clamps them to the document, dispatches ONE transaction annotated
  `isolateHistory.of('full')` (the `applySplice` precedent) so it is one undo
  step, and does not call `focus()`; a synchronous way to read the current
  canonical document text (if the app's React-state buffer is not yet updated
  when the result is built); and a viewport measure on `EditorSyncHandle`
  (e.g. `viewportLines()` or `scrollByPages(n)`) for page scrolling. The
  existing `insertRef` (raw offsets, focuses, no history isolation) is NOT
  reused for bridge edits.
- Each new method carries a doc comment and a `// PRD 027 Req 12/13 (issue
  #366): …` citation, and `editor/AGENTS.md` gains a short seam list (a
  bullet section naming the bridge-facing handle methods and what they
  guarantee: canonical coordinates, single undo unit, no focus steal).
- In-package tests (`editor/tests/<kebab>.test.ts`, `U<n>:` ids; use
  `// @vitest-environment happy-dom` when an `EditorView` is needed, the
  `code-copy.test.ts` precedent) prove: the replace is one undo step (apply,
  `undo` once, original text restored), offsets are clamped, focus is not
  taken, and the viewport measure returns a positive line count. `npm test -w
  editor` and `npm run typecheck -w editor` pass.
- The editor-package-boundary check stays green: no `editor/` file imports
  from `src/`, and app code imports only `@marky-mark/editor`.

### App wiring (no transport, no toggle)

- The app builds the executor from its existing refs (`smartEditRef`,
  `editorSyncRef`, `editorSelectRef`, `editorFocusRef`, the `handleEditState`
  feed) and registry callbacks, in a small hook/module outside `App.tsx`'s
  body where practical, and hands it to ONE optional `Platform` seam (e.g.
  `attachAgentBridge?(executor): () => void` in `src/platform/types.ts`).
  `src/platform/hosted.ts`, `tauri.ts` and `web.ts` do not implement the seam
  in this issue (issue #367 adds the WebSocket transport behind the
  `agentBridge` setting and the toggle), so the hosted, desktop and static
  builds behave byte-for-byte as today: no channel, no UI, no network call
  site (the `FETCH_ALLOWLIST` count and the forbidden-API scan are unchanged).
- The dev/e2e shim host (`src/platform/browser.ts`) implements the seam with
  a typed in-page test transport that uses the protocol codec — e.g. it
  listens for `window` `message` events whose data is an encoded
  `ServerToTabMessage`, runs `executor.execute`, and posts back the encoded
  `TabToServerMessage` — so the e2e drives the executor with standard DOM
  messaging and `encodeBridgeMessage`/`decodeBridgeMessage`, not through any
  new `window.__mm*` global. No file under `src/lib/`, `src/components/`,
  `src/App.tsx` or `src/platform/hosted.ts` gains a `window.__mm*` or other
  new `window.*` assignment.

### Tests

- **Unit** (`tests/unit/agent-bridge-client.test.ts`, `describe('PRD 027 Req
  8/12/13 (issue #366) agent bridge client')`, ids from the next unused
  `U<n>` — U1407 at spec time; re-check with `grep -rhoE "'U[0-9]+:" tests
  editor | sed "s/'U//;s/://" | sort -n | tail -1`): fake handles (plain
  objects recording calls, a string buffer, a fake `EditStateReport` feed)
  prove every tool in `BRIDGE_TOOL_NAMES` answers a typed result; the
  snapshot fields (`path`, `content`, `dirty`, `cursor`, `selection`,
  `scroll.topLine`/`totalLines`, `revision`) come from the injected sources;
  the revision is stable across cursor-only reports and changes on content
  change; each mutating tool with a stale revision answers `stale_revision`
  with the fresh state and performs no edit, and with a matching one edits
  and returns the new revision; heading scroll resolves and unknown headings
  fail; page scroll uses the viewport measure; null handles answer
  `tool_failed`; `open_file`/`save` call the injected registry callbacks.
- **E2E** (new `tests/e2e/agent-bridge.spec.ts` in the desktop-shim lane,
  `E<n>:` ids from the next unused — E650 at spec time; re-check the same
  way), driving the executor through the shim's typed message transport:
  with a fixture document open in edit mode, `get_editor_state` returns a
  revision; `replace_selection` (after a `set_selection`) lands the text, the
  `dirty-dot` appears, one `ControlOrMeta+z` restores the original, and the
  on-disk file read through the existing `fsRead` helper is unchanged
  (no autosave); `apply_format` is one undo step; typing a character after a
  `get_editor_state` makes the next mutating call fail with `stale_revision`
  whose `state.content` includes the typed character; `save` writes the file
  and clears the dirty dot; `get_editor_state` after a mutation returns a new
  revision. Existing helpers (`freshApp`, `fsRead`, `fsWrite`, `openSettings`)
  are reused, `getByTestId` is the selector, and no existing test is changed,
  weakened, skipped or renumbered.
- Citations: new behaviour carries `// PRD 027 Req 8|12|13 (issue #366): …`.
  No new `SPEC<n>` is created, so `docs/MAP.md` is unchanged unless a SPEC
  citation moved (then `npm run map` output is committed).

### Verification (test economy)

- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx vitest run tests/unit/agent-bridge-client.test.ts`, `npm test -w
  editor`, `npx playwright test -g '<title>'` for the one e2e); baseline at
  the start with the quick pair only, no full-gate baseline.
- `npm run validate:quick` has been run ONCE in the implementer's session,
  right before declaring the goal met, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #366 (what landed,
  the executor's exported names and the platform seam #367 will implement,
  the new package handle methods, the new test ids, the gate result).

## Context

- **Parent / siblings:** #361 (parent); PRD `prd/027-mcp-workspace-control.md`
  Reqs 7, 8, 12, 13 are this issue. #363 landed the protocol
  (`src/lib/agentBridgeProtocol.ts`: `BRIDGE_TOOL_NAMES`, `MUTATING_TOOLS`,
  `isMutatingTool`, `BridgeToolRequest`/`Result`, `EditorStateSnapshot`,
  `encode/decodeBridgeMessage`) and the server broker
  (`server/agentBridge.ts`). #364 landed the `agentBridge` setting and
  `Platform.agentBridge?: boolean` capability (hosted only). #367 (WebSocket
  transport + toggle) and #368 (demos) consume this executor — do not build
  them here.
- **Editor handles to drive:** `editor/src/components/Editor.tsx` —
  `SmartEditHandle` (~164: `applyFormat`, `canonicalText`), `EditorSyncHandle`
  (~217: `topLine()`, `scrollToLine`, `scrollInfo`), `SelectSourceRange`
  (~296, canonical, no focus, implemented by `selectSourceRange` ~1188),
  `FocusEditor` (~307), `EditStateReport` (~319: `canonHead`, `headLine`,
  `selFrom`/`selTo`, `selText`; fired for selection AND `docChanged` updates,
  ~2391). `applySplice` (~1827) shows the single-undo-step transaction
  (`isolateHistory.of('full')`); `insertRef` (~2462) is the seam NOT to
  reuse. Handles are populated at mount and nulled on unmount (~2715).
- **App side:** the refs are passed to `<Editor>` at `src/App.tsx` ~8878–8913;
  `editorChanged` (~1194) is the typed-edit path that sets the buffer;
  `saveDoc` (~4020) is the save handler behind the `save` command;
  `registerRecentHandler` (~5299) is how a path opens through the registry
  (`openDocGuarded`). Autosave exists only as `autosaveOnToggle` (~4173) and
  the debounced comment autosave (~7152); bridge edits must trigger neither.
  `stateRef.current.buffer` lags a CodeMirror dispatch until React commits —
  hence the synchronous doc read on the handle.
- **Heading resolution:** `parseSections` / `flattenSections` in
  `src/lib/sectionModel.ts` (`DocumentHeading { title, line }`).
- **Platform / shim:** `src/platform/index.ts` picks `browser.ts` under
  `import.meta.env.DEV` or `?shim` (the e2e lane); `browser.ts` already hosts
  the `__mmfs`/`__mmDispatch` seams the suite uses for setup — fine for
  fixture files, not for driving the executor. `src/platform/types.ts` is
  where optional seams are declared (`agentBridge?`, `setAppMenu?`).
- **Tests precedent:** `tests/unit/agent-bridge-protocol.test.ts`,
  `tests/unit/server-agent-bridge.test.ts` (fake transports);
  `tests/e2e/smart-edit.spec.ts` E106 (one undo step per action,
  `dirty-dot`); `editor/tests/code-copy.test.ts` (happy-dom per file).
  Unit suites share worker contexts (`isolate: false`): restore any global
  state.
- **Rules:** `.sandcastle/CODING_STANDARDS.md` (citations, `src/lib` purity,
  no `console.*`, test-ID discipline, no new network call sites),
  `editor/AGENTS.md` (package boundary; the gate enforces it).
