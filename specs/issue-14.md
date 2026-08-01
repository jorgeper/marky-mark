# Spec: Layered configuration resolver, scope tags & settings inventory (#14)

## Goal

All acceptance criteria in specs/issue-14.md are satisfied for issue #14, with
evidence visible in the session: every persisted setting resolves through a
pure, deterministic four-layer resolver (Global → Team → Workspace → User,
highest layer providing a valid value wins) with exactly one scope tag
(U / U! / W / M) assigned to every `Settings` key per PRD 002 §B5, unit tests
cover each scope tag's precedence including the W and U! exclusion rules, the
app computes its effective settings through the resolver with Global =
`DEFAULT_SETTINGS` plus an optional `<configDir>/global-settings.json`, a
reserved Team slot, and User = the existing `<configDir>/settings.json`
(behavior unchanged when the optional files are absent), `npm run
validate:quick` passes in the implementer's session, and a summary comment
from the implementer exists on issue #14.

## Acceptance criteria

- A pure resolver function exists (in `src/lib/` — e.g. alongside or extending
  `src/lib/settings.ts`) that, given the four ordered layer inputs
  **Global → Team → Workspace → User** (each an untrusted/partial object, any
  of which may be absent), returns a complete effective `Settings`. For
  default-precedence settings the highest layer that provides a valid value
  wins (PRD §A1). The function performs no I/O and is deterministic: the same
  four inputs always produce the same output (§A3).
- An exported scope-tag inventory assigns exactly one tag to every key of the
  `Settings` interface, matching PRD §B5:
  - **U:** `themeLight`, `themeDark`, `useDarkTheme`, `fontSize`, `zoom`,
    `margins`, `paneMinWidth`, `lineNumbers`, `editorSyntax`, `tableGridView`,
    `inlineImages`, `showFrontmatter`, `showWordCount`, `showResolved`,
    `vimNav`, `typeToComment`, `autosaveOnToggle`, `autoHideToolbar`,
    `exportTheme`, `hotkeys`, `commentsEnabled`, `reopenLastDoc`,
    `restoreOpenFiles`.
  - **U!:** `author`.
  - **W:** `commentStorage`, `imageFolder`, `imageNamePattern`.
  - **M:** `splitEdit`, `splitRatio`, `showFolders`, `folderWidth`.

  The inventory is exhaustive by construction (e.g. typed as
  `Record<keyof Settings, Scope>`) so adding a `Settings` key without
  classifying it fails the typecheck.
- Scope semantics are enforced by the resolver (§A2):
  - **U** — settable at any layer as a default; a valid User value wins.
  - **U!** — only the User layer's value is honored; values for `author` in
    Global/Team/Workspace layers are ignored.
  - **W** — Global/Team/Workspace may set it (highest of those wins); a User
    value is ignored so the workspace stays authoritative.
  - **M** — never part of the layered merge: values for M-scoped keys in the
    Global/Team/Workspace inputs are ignored, and effective M values continue
    to come from the existing machine-local store exactly as today (they still
    live in `settings.json` for now; no storage migration in this issue).
- Unknown/malformed values are tolerated per layer, matching today's
  `parseSettings` behavior (§A4): an invalid value for a key in one layer
  falls back to the next layer down that has a valid value, and ultimately to
  the baked `DEFAULT_SETTINGS`; unrecognized keys are ignored; existing
  per-key validation and clamping (fontSize range, zoom levels, margins enum,
  splitRatio/folderWidth/paneMinWidth clamps, `isValidImageFolder`, hotkeys
  shape) still applies to whichever layer's value is considered.
- Unit tests exist under `tests/unit/` (extending or alongside
  `tests/unit/settings.test.ts`) and pass via `npm run test:unit`, covering at
  minimum: U precedence (User beats Workspace beats Team beats Global; lower
  layer supplies the value when higher layers omit it), the U! exclusion rule
  (non-User `author` ignored), the W exclusion rule (User value ignored,
  Workspace beats Team beats Global), M exclusion from the merge, and
  malformed-value fallback across layers to defaults (§A3, §A4).
- Layer sources are wired at app startup (§F21): the effective settings the
  app runs with are computed by the resolver from **Global** =
  `DEFAULT_SETTINGS` plus an optional admin file
  `<configDir>/global-settings.json` (absent by default), **Team** = a
  reserved slot with no local file today (the resolver honors a Team input if
  one is supplied), **Workspace** = an empty slot in this issue (the
  `.marky-workspace` source arrives with the workspace-model issue), and
  **User** = the existing `<configDir>/settings.json`. When no
  `global-settings.json` exists, observable behavior is identical to today's
  single-file flow, and the pre-existing unit and e2e suites still pass.
- The resolver, scope tags, and layer contract are shaped for forward
  compatibility (§I27): layers enter the resolver as plain data inputs, so a
  future Team layer or cloud-sourced Global/Workspace layers plug in by
  supplying those inputs — no change to precedence semantics or per-source
  special-casing is needed.
- `npm run validate:quick` has been run in the implementer's session and
  passes (prints `QUICK VALIDATION: ALL PASSED`).
- A summary comment from the implementer exists on issue #14.

## Context

PRD: `prd/002-workspaces-and-layered-configuration.md` (§A, §B5, §F21, §I27);
parent issue #13. This issue is the resolver/inventory slice only — workspace
files, File-menu flows, multi-root sidebar, and the User|Workspace Settings UI
are sibling issues; do not build them here.

Today's model is flat: `src/lib/settings.ts` defines the `Settings` interface,
`DEFAULT_SETTINGS`, and the tolerant `parseSettings` (per-key validation,
clamping, legacy `theme` migration). `src/App.tsx` reads
`<configDir>/settings.json` through `parseSettings` at startup (~line 1487)
and writes it via `serializeSettings` (~line 1723). Reuse the existing per-key
validation for per-layer tolerance rather than duplicating it — a natural
shape is a per-key "validate this raw value or reject" pass that the resolver
walks down the layers, with `parseSettings(json)` preserved (or reimplemented
on top) for the User-layer file. Keep the legacy `theme` migration working for
the User layer. Existing unit coverage lives in `tests/unit/settings.test.ts`.
The same resolver code runs in both desktop and web builds (§H26); web simply
never supplies a Workspace layer. Verify with `npm run validate:quick`
(typecheck + unit + desktop e2e).
