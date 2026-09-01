# Spec: When I create a new file it should alway be in edit mode by default (#194)

## Goal

All acceptance criteria in issue-specs/issue-194.md are satisfied for issue #194, with evidence visible in the session: every way of creating a new file lands the user in edit mode — the folder-sidebar New File path (both the committed rename and the cancelled christening) opens the just-created file in edit mode instead of inheriting the current preview mode, File → New (⌘N) keeps its existing edit-mode behaviour, opening an *existing* file still does not force a mode switch, the new behaviour is covered by desktop-shim e2e assertions, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- Creating a file from the folder sidebar (context-menu **New File** on a directory row or the empty area, SPEC35 §4) opens the just-created markdown file **in edit mode**, regardless of the mode the app was in before. This holds on both exits from the inline-rename christening: committing a name (`folderRenameCommit`, `src/App.tsx:2468`) and cancelling it (`folderRenameCancel`, `src/App.tsx:2490`), since both open the file via `openDocGuarded`.
- File → New (⌘N, the untitled buffer) still lands in edit mode as SPEC22 §1.1 already requires (`startUntitled`, `src/App.tsx:3692`) — unchanged, not regressed.
- Opening an **existing** file (recents, sidebar click on an existing row, open dialog, rename of an existing file) does not force a mode switch — the current SPEC-cited behaviour of `openDocGuarded`/`openDoc` for ordinary opens is preserved. The edit-mode landing applies only to files the app just created.
- If the unsaved-changes guard intercepts the open (dirty buffer at creation time), whichever resolution actually opens the new file still lands in edit mode; a resolution that abandons the open changes nothing.
- The new behaviour carries `// SPEC<n> §x.y:`-style citation comments consistent with `.sandcastle/CODING_STANDARDS.md`, pointing at whichever contract document the implementer extends for this rule.
- A desktop-shim e2e test (numbered `E<n>`, in `tests/e2e/folder-tree.spec.ts` beside E97) asserts: with the app in preview mode, sidebar New File → name committed → the editor is active (edit mode) on the new file; and the cancel-christening exit also lands in edit mode. Any pure decision logic extracted for this gets `vitest` coverage in `npm run test:unit`.
- If the collected desktop-shim e2e count grew, `E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned to the new count.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code, e.g. `npx playwright test -g '<title>'`) after each change; the full gate `npm run validate:quick` was run **once**, right before declaring the goal met — not after every small change and not as a starting baseline — and passed, printing `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #194.

## Context

The gap is only in the sidebar path: `folderCreate` (`src/App.tsx:1848`) writes the file and starts the inline rename with `openOnDone: true`; both rename exits open through `openDocGuarded`, which deliberately never touches `mode` (default is `'preview'`, `src/App.tsx:408`), so a user in preview stays in preview staring at an empty rendered page. ⌘N's `startUntitled` already calls `setMode('edit')` under SPEC22 §1.1 — use it as the reference for what "land in edit mode" means. Prefer signalling edit-intent from the two creation call sites (e.g. an option on `openDocGuarded`/`openDoc`) over mutating mode inside the generic open path, so ordinary opens stay mode-neutral. SPEC35 §4.2 (`docs/specs/SPEC35.md`) is the christening contract these call sites cite today; E97 in `tests/e2e/folder-tree.spec.ts:333` is the existing create test to sit beside.
