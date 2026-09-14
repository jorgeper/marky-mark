# Agent bridge — connecting Claude Code to a workspace

**Experimental.** The agent bridge (PRD 027) lets an MCP client such as
Claude Code read and write a hosted workspace's files and, when a member
opts a browser tab in, drive that tab's editor. This page is the setup
walkthrough from a clean deployment to the three anchor demos. The route
table and the tool reference live in
[`server/README.md` § Agent bridge (PRD 027)](../server/README.md#agent-bridge-prd-027).

## 1. Turn the server flag on

The bridge ships off. Set `MM_AGENT_BRIDGE=1` on the App Service (the
`MM_AGENT_BRIDGE` row in [HOSTING-AZURE.md](HOSTING-AZURE.md) or
[HOSTING-AZURE-PORTAL.md](HOSTING-AZURE-PORTAL.md)) and switch **Web
sockets** on — the control channel is a WebSocket, and App Service refuses
upgrades until that switch is on. Startup logs `agent-bridge=on`.

For local development, the same flag on the local server:

```sh
MM_AGENT_BRIDGE=1 npm run server:local
```

and open `http://localhost:4924`.

## 2. Turn the experimental setting on

In the app: **Settings → Experimental → Agent bridge** (default off), then
**Save**. No reload: the Agent tokens section appears in the workspace
settings and the agent-control toggle appears in the workspace. The
setting is per user and roams with your other settings.

## 3. Mint a token

In the workspace: **Settings → Manage** (the workspace scope) → **Agent tokens**. Type a
label (which client this is for), click **Mint**, and copy the plaintext
token — it is shown exactly once and never again; the server stores only
a hash. To revoke, click **Revoke** on the token's row: the very next
request with it is refused.

Scope guards to know:

- A token is scoped to the one workspace it was minted in and to the
  minting user's permissions there. It is never logged.
- The bridge is create, read and update only — no delete, no rename.
- Deleting the workspace deletes its tokens.

## 4. Connect Claude Code

The same line `server/README.md` states — one command, no local install:

```sh
claude mcp add --transport http marky-mark https://<origin>/api/mcp \
  --header "Authorization: Bearer <token>"
```

For the local server, use `http://localhost:4924/api/mcp` as the URL.
The token names the workspace, so no tool takes one. `claude mcp list`
should show `marky-mark` connected; the five **file tools** (`get_workspace`,
`list_files`, `read_file`, `create_file`, `write_file`) work from here
with no browser tab at all.

## 5. Opt a tab in

The nine **session tools** (`get_editor_state`, `open_file`, `scroll`,
`set_selection`, `replace_selection`, `insert_text`, `replace_range`,
`apply_format`, `save`) act on ONE controlled tab per workspace. In the
tab you want the agent to drive, flip the **Agent control** toggle. A
persistent indicator — "An agent can read and edit this session" — stays
visible in preview and edit mode while the tab is controlled; flip the
toggle again to opt out. A second tab opting in takes over and the first
tab's toggle turns itself off. With no opted-in tab, a session tool
answers `no_controlled_session`; file tools are unaffected.

Every edit the agent makes is one undo step in the tab, and nothing is
saved until the agent calls `save` (or you do).

## 6. The three demos

Type these into Claude Code with the connected server and an opted-in tab:

| Demo | Prompt | Tools exercised |
| --- | --- | --- |
| **a — Create** | "Create `agent-note.md` in my workspace with a heading and a short paragraph, then open it in my tab." | `create_file`, `open_file` — the file appears in the folder tree, opens and renders. |
| **b — Navigate** | With a long document open in edit mode: "Where am I in this document? Scroll down one page." | `get_editor_state`, `scroll` — the reply names the top line; the viewport moves. |
| **c — Transform** | Select a passage in the tab yourself, then: "Rewrite what I have selected in plain English, make it bold, and save." | `get_editor_state`, `replace_selection`, `apply_format`, `save` — the tab shows the new bold text; one undo per tool call; the dirty dot clears on save. |

The hosted e2e suite runs the same three demos over the real endpoint
(`tests/e2e/hosted.spec.ts`, E659–E661).
