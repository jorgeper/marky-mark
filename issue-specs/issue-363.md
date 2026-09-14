# Spec: Agent bridge protocol: typed server↔tab message contract and transport-agnostic session broker (#363)

## Goal

All acceptance criteria in issue-specs/issue-363.md are satisfied for issue
#363, with evidence visible in the session: one pure shared module
`src/lib/agentBridgeProtocol.ts` defines the server↔controlled-tab contract
(a request type per PRD 027 Req 7 session tool, typed results, an error union
including `no_controlled_session` and `stale_revision`, the editor state
snapshot with a buffer revision, and encode/decode helpers that reject
malformed input without throwing); a server module `server/agentBridge.ts`
implements a session broker that holds at most one controlled session per
workspace, dispatches typed requests over an injected transport and resolves
typed results or timeout/no-session errors, and on re-registration replaces
the previous session and notifies it via `session_replaced`; both are covered
by new `U<n>` unit tests with a fake transport and no WebSocket/HTTP/Azure
code; nothing user-visible changes (no routes, no UI, no settings);
`npm run validate:quick` passes in the implementer's session; and a summary
comment from the implementer exists on issue #363.

## Acceptance criteria

### Shared protocol module (`src/lib/agentBridgeProtocol.ts`)

- **One pure module holds the whole contract.** It follows the `src/lib`
  rules (no `react`, no `@tauri-apps/*`, no `src/components/`, no DOM, no
  `console.*`) and, because `server/` imports it under plain `node`
  type-stripping, every relative import carries an explicit `.ts` extension
  and any editor type is pulled with `import type … from '@marky-mark/editor'`
  only (erased at runtime; `SmartFormatOp` is reused this way, never
  re-declared). It exports `BRIDGE_PROTOCOL_VERSION` (a number, `1`).
- **Tool inventory = PRD 027 Req 7.** `BridgeToolName` is exactly the nine
  session tools `get_editor_state`, `open_file`, `scroll`, `set_selection`,
  `replace_selection`, `insert_text`, `replace_range`, `apply_format`, `save`,
  mirrored by a readonly `BRIDGE_TOOL_NAMES` array; `MUTATING_TOOLS` /
  `isMutatingTool()` name exactly `replace_selection`, `insert_text`,
  `replace_range`, `apply_format` (PRD Req 8). A `Record<BridgeToolName, …>`
  (or `satisfies`) assertion ties the decoder to the union so adding a tool
  without handling it fails `npm run typecheck`.
- **Editor state snapshot.** `EditorStateSnapshot` carries: `path`
  (workspace-relative string, or `null` for no open file), `content` (full
  buffer, unsaved edits included), `dirty: boolean`, `cursor` (0-based
  canonical text offset plus 1-based line), `selection` (`from`/`to`
  ordered canonical offsets and the selected `text`), `scroll`
  (`topLine` / `totalLines`, 1-based), and `revision: string`. Coordinates
  are documented as the editor package's CANONICAL ones (`EditStateReport.
  canonHead/selFrom/selTo`, `EditorSyncHandle.topLine()`), so issue #366 can
  fill it straight from the public handles.
- **Requests.** `BridgeToolRequest` is a discriminated union on `tool`, each
  member carrying a correlation `id: string` and its typed params:
  `open_file { path }`, `scroll` (by `lines`/`pages` with a signed amount, or
  to a line, or to a heading text), `set_selection { from, to }`,
  `replace_selection { text }`, `insert_text { text }`, `replace_range
  { from, to, text }`, `apply_format { op: SmartFormatOp }`,
  `get_editor_state {}`, `save {}`. Every mutating request additionally
  carries the required `revision: string` (PRD Req 8) — enforced by the type
  and by the decoder.
- **Results and errors.** `BridgeToolResult` is `{ ok: true, id, state:
  EditorStateSnapshot, … }` (the post-call snapshot rides along so mutating
  calls hand back the new revision without a second round trip; tool-specific
  payload fields are allowed) or `{ ok: false, id, error: BridgeError }`.
  `BridgeError` is a discriminated union on `code` covering at least
  `no_controlled_session` (message = exported constant
  `NO_CONTROLLED_SESSION_MESSAGE` = `'no controlled session'`),
  `stale_revision` (carries the fresh `state`), `timeout`, `invalid_request`
  and `tool_failed` (free-text `message`).
- **Wire envelopes and codec.** `ServerToTabMessage` is
  `{ kind: 'tool_request', request }` or `{ kind: 'session_replaced' }` (the
  PRD Req 10 takeover notice); `TabToServerMessage` is `{ kind:
  'tool_result', result }` or `{ kind: 'state', state }`. Every envelope
  carries `v: BRIDGE_PROTOCOL_VERSION`. `encodeBridgeMessage(msg): string`
  and `decodeBridgeMessage(text)` exist; decode returns a typed message or a
  typed failure (`null` or `{ ok: false, reason }`) — it never throws — for
  non-JSON text, a missing/unknown `kind`, an unknown `tool`, a mismatched
  `v`, a mutating request without a string `revision`, or wrong field types.
- **Citations.** Module head and each exported group carry
  `// PRD 027 Req 14 (issue #363): …` (plus `Req 7`/`Req 8`/`Req 10` where
  the shape comes from those requirements). No new `SPEC<n>` is created, so
  `docs/MAP.md` is unchanged unless a SPEC citation was added (then
  `npm run map` output is committed — the quick gate diffs it).

### Server session broker (`server/agentBridge.ts`)

- **Transport-agnostic.** The module imports only the protocol module, node
  built-ins and its own types. It contains no `WebSocket`, `ws`, `node:http`,
  `@azure/*` or `server/providers/azure/*` import and no network call site;
  the tab side is reached exclusively through an injected
  `SessionTransport { send(message: ServerToTabMessage): void; close(): void }`.
  It reads nothing from `Providers` (it needs no vendor service) and sits
  beside `workspaces.ts` / `admin.ts` as the future WebSocket route's
  dependency — `createApp`'s signature, route table and `server/index.ts`
  are unchanged (no route is mounted; nothing user-visible changes).
- **API.** `createSessionBroker({ timeoutMs? })` returns a broker with at
  least: `register(workspaceId, transport)` → a session handle exposing
  `deliver(message: TabToServerMessage)` (the transport feeds inbound
  messages here) and `close()`; `has(workspaceId): boolean`;
  `dispatch(workspaceId, request): Promise<BridgeToolResult>`. Errors are
  returned AS DATA in the `{ ok: false }` shape (never rejections).
- **One session per workspace (PRD Req 10 groundwork).** Registering a
  second session for a workspace that already has one replaces it: the old
  transport receives `{ kind: 'session_replaced' }` then `close()`, its
  pending dispatches settle with `no_controlled_session`, and messages the
  stale handle later delivers are ignored (they never resolve the new
  session's requests). Different workspaces are fully independent.
- **Dispatch semantics.** `dispatch` with no registered session settles
  immediately with `no_controlled_session`; with one, the transport receives
  exactly one `tool_request` whose `id` is unique per call, and the promise
  settles with the `tool_result` whose `id` matches; results with unknown
  ids and `state` pushes do not settle anything (state pushes may update a
  last-known snapshot the broker exposes, optional). An unanswered request
  settles with `timeout` after `timeoutMs` (default a few seconds) and a
  result arriving afterwards is ignored. `close()` on the handle (tab gone /
  toggle off) makes `has()` false, settles pending calls with
  `no_controlled_session`, and later dispatches error the same way.
- **Citations.** `// PRD 027 Req 14 (issue #363): …` at the module head and
  `Req 10` at the replacement logic.

### Unit tests (`tests/unit/`)

- **Files and IDs.** `tests/unit/agent-bridge-protocol.test.ts`
  (`describe('PRD 027 Req 14 (issue #363) agent bridge protocol')`) and
  `tests/unit/server-agent-bridge.test.ts` (`describe('PRD 027 Req 14
  (issue #363) session broker')`), tests numbered from the next unused
  `U<n>` (U1383 as of this spec; re-check with
  `grep -rhoE "'U[0-9]+:" tests editor | sed "s/'U//;s/://" | sort -n | tail -1`).
  No existing test is changed, weakened or renumbered.
- **Protocol coverage:** every name in `BRIDGE_TOOL_NAMES` (asserted to be
  the nine of PRD Req 7, unique) builds a request whose envelope
  encodes→decodes to a deep-equal value; success results, `stale_revision`
  (with its `state`) and `no_controlled_session` (message constant)
  round-trip; `MUTATING_TOOLS` is exactly the four; decode returns the
  failure shape (no throw) for non-JSON, missing `kind`, unknown `kind`,
  unknown `tool`, wrong `v`, and a mutating request lacking `revision`.
- **Broker coverage (fake transport = an in-memory object recording
  `send`/`close` calls):** no-session dispatch; register + dispatch +
  matching result resolves; unknown-id result ignored; second registration
  replaces (old transport got `session_replaced` + `close`, old pending call
  settled with `no_controlled_session`, stale handle's `deliver` is inert,
  new session receives subsequent dispatches); two workspaces independent;
  handle `close()` teardown semantics; timeout via `vi.useFakeTimers()` with
  `vi.useRealTimers()` restored in `afterEach` (the suite shares worker
  contexts — `isolate: false`).

### Docs

- `server/README.md` gains a short section (e.g. `## Agent bridge (PRD 027)`)
  naming the two modules, stating the broker is transport-agnostic and that
  no route/WebSocket is mounted yet (issues #365/#367 do that).

### Verification (test economy)

- Iterate with `npm run typecheck` and `npm run test:unit` (or the two new
  files via `npx vitest run tests/unit/agent-bridge-protocol.test.ts
  tests/unit/server-agent-bridge.test.ts`); no e2e runs are needed for this
  issue and no full-gate baseline at the start (baseline with the quick tier
  only).
- `npm run validate:quick` has been run ONCE in the implementer's session,
  right before declaring the goal met, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #363 (what landed,
  the exported names later sub-issues will import, the new test IDs, the
  gate result).

## Context

- **Parent / siblings:** #361 (parent), PRD `prd/027-mcp-workspace-control.md`
  Reqs 7, 8, 10, 14. Consumers of this seam: #365 (MCP endpoint, file
  tools), #366 (client executes `BridgeToolRequest`s through the editor
  handles), #367 (WebSocket transport + session tools), #368 (demos). Design
  the exports as the import surface those issues will use.
- **Sharing precedent:** `server/*.ts` already imports pure modules from
  `../src/lib/*.ts` with explicit extensions (`llmSeam.ts`,
  `hostedWorkspace.ts`, `deploymentSettings.ts`); U798
  (`tests/unit/server-plain-node.test.ts`) is why extensions matter.
  `src/lib/auxProtocol.ts` (SPEC13 §3) is the in-repo model of a typed,
  transport-free message protocol; `src/lib/llmSeam.ts` /
  `llmDesktopTransport.ts` show the injected-transport pattern.
- **Editor types to mirror, not reach into:** `editor/src/components/
  Editor.tsx` — `SmartFormatOp` (~158), `SmartEditHandle` (~164),
  `EditorSyncHandle` (~217, `topLine()`/`scrollToLine`/`goToLine`/
  `goToHeading`), `EditStateReport` (~319: `canonHead`, `headLine`,
  `selFrom`/`selTo`, `selText`). `src/lib/settings.ts` and `appMenu.ts`
  already `import type` from `@marky-mark/editor`.
- **Server layout:** `server/providers/types.ts` (`Providers`, `RequestAuth`
  — workspace ids are the server-generated UUID prefix keys), `server/app.ts`
  `createApp(staticDir, providers, mode, llm?, admins?)`; existing server
  unit tests are `tests/unit/server-*.test.ts` and build fakes in memory.
- **Rules:** `.sandcastle/CODING_STANDARDS.md` (citations, `src/lib` purity,
  no `console.*` in `src/`, test-ID discipline, shared-worker unit tests,
  no new network call sites — the bundle scan pins `fetch(` and forbids
  `WebSocket` in shipped code, which this issue must not touch).
