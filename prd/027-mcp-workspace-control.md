# PRD 027: MCP workspace control (agent bridge)

**Status:** Draft
**Date:** 2026-09-10

## Problem

The hosted (cloud) Marky Mark has no way for an agent to act on a
workspace. The owner wants Claude Code and Marky Mark open side by side
and to drive the visible session conversationally: "create a file in my
workspace", "scroll down a page", "summarize the current selection and
replace it". Today nothing outside the browser tab can create workspace
files, and nothing at all can read or steer the live editor — there is no
API credential besides the user's short-lived Entra access token, no
real-time channel between client and server, and no external surface over
the editor's capabilities.

The pieces on the inside already exist: the editor package exposes
imperative handles for formatting, scrolling, selection, and an
`onEditState` stream (PRD 021), the app funnels every action through a
command registry, and the server already speaks authenticated REST over
workspace files with ETag + three-way-merge concurrency (PRD 016). What
is missing is a safe, non-hacky bridge from an MCP client to those
pieces.

This is a proof of concept by posture — but one built on clean seams so
it can be hardened incrementally, not a throwaway. The two elements that
must be production-shaped from day one are **auth** (no shared or
hardcoded secrets against a live workspace) and **layering** (typed
protocol, no dev-shim-style globals in production paths).

## Goals

- An MCP client (Claude Code is the reference) can create and update
  files in a designated cloud workspace with no browser involvement.
- With a Marky Mark tab opted in, the MCP client can read the live
  session — full buffer content, open file, cursor, selection, scroll
  position — and act on it: scroll, select, replace the selection, apply
  formatting, save. Changes appear in the visible tab immediately.
- The three anchor demos work end to end (see Requirement 15).
- The whole feature is invisible and inert unless an experimental
  setting is turned on; the agent credential is workspace-scoped and
  revocable.
- The seams introduced (MCP endpoint, agent tokens, live control
  channel, editor control surface) are ones later work can extend
  without rework.

## Non-goals

- **Deleting, renaming, or moving** files or folders via the agent. A
  misfiring agent must not be able to destroy workspace content; v1 is
  create/read/update only.
- **Desktop (Tauri) and the static single-file web build.** Cloud/hosted
  mode only; the single-file build's CSP forbids network access by
  design.
- **Real-time multi-user co-editing, presence, cursors, CRDT/OT.** The
  live channel built here carries one agent's control traffic for one
  tab; it is not a sync protocol, and the co-editing non-goal of PRDs
  007/010/016 stands.
- **Pairing-code or OAuth/device-code flows** for connecting the agent.
  V1 pairing is a token pasted into MCP client config.
- **A stable, versioned public API for third-party MCP clients.** The
  tool surface may change between releases; Claude Code side-by-side is
  the supported client.
- **Scratchpad access.** Workspaces only.
- **More than one controlled tab at a time** per workspace, and any
  agent-initiated tab/window management beyond opening a file in the
  already-controlled tab.
- **Autonomous agent behavior.** The bridge only answers MCP calls; it
  never initiates actions, and Marky Mark never calls the agent.

## Requirements

Numbered, testable statements. Each becomes acceptance criteria on an
issue.

### Gating

1. A new experimental setting (settings UI section "Experimental",
   e.g. `agentBridge`), **default off**, gates the entire feature. With
   it off: no control channel is opened, no agent-control UI is
   rendered, and the client behaves byte-for-byte as today. Turning it
   on requires no reload beyond the existing settings-apply behavior.
2. Server-side the MCP endpoint and token routes exist only when the
   deployment enables them (env flag, e.g. `MM_AGENT_BRIDGE=1`);
   otherwise those routes 404 and no bridge code runs. Local mode
   (`MM_MODE=local`) supports the flag so the feature is developable and
   e2e-testable against mock auth + Azurite.

### Auth: workspace-scoped agent tokens

3. A workspace member whose role carries workspace administration can
   mint an **agent token** for that workspace from the workspace UI. The
   plaintext token is shown exactly once at mint time; the server stores
   only a hash. Tokens are listed (label, created date) and revocable in
   the same UI; revocation takes effect on the next request that
   presents the token.
4. An agent token authorizes only its workspace: file tools operate only
   under that workspace's prefix, and control tools only on a tab
   showing that workspace. Any request outside that scope, or with a
   revoked/unknown token, fails with an explicit authorization error.
   Tokens never appear in server logs or API responses after mint.

### MCP endpoint

5. The existing server hosts a remote MCP endpoint (streamable HTTP,
   e.g. `/api/mcp`) implementing the Model Context Protocol so that
   `claude mcp add --transport http` plus the agent token (auth header)
   connects with no local server install. The token identifies the
   workspace — no workspace parameter appears in any tool.
6. **File tools** (work with no browser tab): `get_workspace` (name and
   basic metadata), `list_files`, `read_file`, `create_file` (fails if
   the path exists), `write_file` (update an existing file; carries the
   read ETag and inherits the server's existing If-Match + three-way
   merge semantics from PRD 016). Binary upload via the existing upload
   route shape is in scope for `create_file` so an agent can add
   non-Markdown assets.
7. **Session tools** (require a controlled tab; error with a clear
   "no controlled session" message otherwise):
   - `get_editor_state` — open file path, full buffer content (unsaved
     edits included), dirty flag, cursor, selection range and selected
     text, scroll position (top visible line / total lines), and a
     buffer **revision** id.
   - `open_file` — navigate the controlled tab to a workspace file.
   - `scroll` — by lines or pages, or to a line/heading.
   - `set_selection` — set the selection without stealing focus.
   - `replace_selection` — replace the current selection with given
     text.
   - `insert_text` — insert at the cursor.
   - `replace_range` — the low-level escape hatch: replace an explicit
     range.
   - `apply_format` — apply a formatting op from the editor's existing
     `SmartFormatOp` set (bold, italic, headings, lists, quote, code,
     …) to the current selection.
   - `save` — persist the buffer through the app's existing save path.
8. Every session tool that mutates the buffer (`replace_selection`,
   `insert_text`, `replace_range`, `apply_format`) requires the revision
   from a prior `get_editor_state`. If the buffer has changed since (the
   user typed), the call fails with a stale-revision error carrying the
   fresh state so the agent re-reads and retries; agent edits never
   silently clobber user keystrokes. `get_editor_state` after any
   mutation returns the new revision.

### Live control channel

9. With the experimental setting on, a Marky Mark tab shows an
   **agent-control toggle**. Opting in opens an authenticated
   bidirectional channel (WebSocket upgrade on the existing server;
   Azure App Service WebSocket support documented in the hosting guide)
   over which the server bridges session-tool calls to that tab and
   receives state/results back. The channel authenticates with the
   user's existing session and is bound server-side to one workspace.
10. Exactly **one controlled tab per workspace** at a time: opting in
    from a second tab takes over control and the first tab's toggle
    visibly turns off. While opted in, the tab shows a persistent,
    clearly visible indicator that an agent can read and edit the
    session; toggling off (or closing the tab) tears down the channel
    and session tools start failing with "no controlled session". File
    tools are unaffected by tab state.
11. Session-tool round-trips are interactive-fast: a scroll or
    replace-selection call against an idle tab completes well under a
    second in the local e2e environment (asserted loosely, not
    micro-benchmarked).

### Editing semantics

12. Agent buffer edits behave like typing: each mutating tool call lands
    as a single undo unit (one Ctrl+Z reverts one tool call), marks the
    document dirty, and triggers no autosave. Persistence happens only
    via the `save` tool or the user saving; `save` goes through the
    existing hosted save path, so ETag/If-Match, server three-way merge,
    and the 412 conflict dialog semantics of PRD 016 apply unchanged.

### Architecture (the anti-hack clause)

13. The client half of the bridge drives the editor exclusively through
    the `@marky-mark/editor` public handles (`SmartEditHandle`,
    `EditorSyncHandle`, selection/focus handles, `onEditState`) and the
    app command registry — no new `window.*` globals, no reaching into
    CodeMirror internals from bridge code, no reuse of the dev-shim
    `__mm*` seams in production builds. Any editor capability the bridge
    needs that the package doesn't expose is added to the package's
    public API first.
14. The protocol between server and controlled tab (tool requests,
    results, state snapshots) is a TypeScript-typed message contract in
    one shared module, unit-tested independently of transport, so that
    transport, tool inventory, and auth can each evolve separately. The
    server bridge module sits behind the existing provider seams and
    adds no coupling to Azure specifics beyond them.

### Acceptance demos and coverage

15. The three anchor demos pass as e2e tests in local mode, driving the
    real MCP endpoint with an MCP client (or raw streamable-HTTP calls)
    against a real browser tab:
    a. **Create:** the agent creates a new Markdown file with given
       content; it appears in the controlled tab's file tree, opens,
       and renders.
    b. **Navigate:** with a long document open, the agent reads scroll
       state and scrolls down a page; the visible viewport moves
       accordingly.
    c. **Transform selection:** the user selects a passage; the agent
       reads the selection via `get_editor_state`, replaces it via
       `replace_selection`, and applies a format op; the tab shows the
       replaced, formatted text, one undo step per tool call, document
       dirty until `save`.
16. Setup documentation (a short docs page) covers: enabling the
    experimental setting and server flag, minting a token, and the
    exact `claude mcp add` invocation — enough for the owner to run the
    side-by-side demo from a clean deployment.

## Open questions

- None. Deferred choices (pairing flows, delete/rename, third-party
  client support, multi-tab control) are recorded as Non-goals.
