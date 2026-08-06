# Spec → code map

<!-- GENERATED FILE — DO NOT EDIT BY HAND -->

This file is **generated** by `npm run map` (`scripts/map.mjs`) from the
`SPEC<n>` citations already in the tree — `docs/specs/*.md` for the spec list
and titles, `src/` and the E-numbered tests in `tests/e2e/` for the rows. It
is **never hand-edited**: any manual change is overwritten by the next run, and
`npm run validate` (and `npm run validate:quick`) fails while the committed
file differs from what the generator produces from the current tree. After
adding or moving a citation, run `npm run map` and commit the result.

Use it to answer "which file do I edit": find the spec that owns the behaviour,
then read off its `src/` files and the e2e tests that cover it. A spec with no
citations yet shows `_none_`. Files listed under **e2e** rather than an
E-number cite the spec outside any test body (file header or shared setup).

| Spec | Title | src files | e2e |
| --- | --- | --- | --- |
| [SPEC](specs/SPEC.md) | SPEC: Markimark — a fast, themeable Markdown viewer | `src/bundled.ts`, `src/components/Editor.tsx`, `src/lib/anchoring.ts`, `src/lib/hotkeys.ts`, `src/platform/types.ts` | _none_ |
| [SPEC2](specs/SPEC2.md) | SPEC2: Markimark v2 — three targets, simpler chrome, embedded comments | `src/App.tsx`, `src/components/Toolbar.tsx`, `src/lib/embedded.ts`, `src/platform/index.ts`, `src/platform/web.ts` | E9 |
| [SPEC3](specs/SPEC3.md) | SPEC3: Markimark v3 — Typora-grade settings, vim nav, tighter Claude theme | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/Toolbar.tsx`, `src/lib/settings.ts`, `src/lib/vimnav.ts` | E105 |
| [SPEC4](specs/SPEC4.md) | SPEC4: Markimark v4 — vanishing toolbar, tabbed settings, text-only zoom, clean start | `src/App.tsx`, `src/lib/settings.ts`, `src/styles.css` | E24, E13 |
| [SPEC5](specs/SPEC5.md) | SPEC5: Marky Mark v5 — app badge, opt-in auto-hide, centered hint, rename | `src/App.tsx`, `src/styles.css` | E25 |
| [SPEC6](specs/SPEC6.md) | SPEC6: Marky Mark v6 — aligned editor, Word-style comment flow, 20 new themes | `src/App.tsx`, `src/components/CommentCard.tsx`, `src/lib/markdown.ts`, `src/styles.css` | E134 |
| [SPEC7](specs/SPEC7.md) | SPEC7: Marky Mark v7 — comment controls, split view, undo/redo | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/Toolbar.tsx`, `src/lib/commentAffordance.ts`, `src/lib/menuSpec.ts`, `src/lib/settings.ts`, `src/styles.css` | E9, E33, E38, E151, E154 |
| [SPEC8](specs/SPEC8.md) | SPEC8: Marky Mark v8 — scroll continuity across modes and split panes | _none_ | _none_ |
| [SPEC9](specs/SPEC9.md) | SPEC9: Marky Mark v9 — release pipeline (CI/CD → GitHub Releases) | _none_ | _none_ |
| [SPEC10](specs/SPEC10.md) | SPEC10: Marky Mark v10 — open-source alpha: semver, CI/CD releases, About, license | `src/components/AboutDialog.tsx`, `src/styles.css`, `src/vite-env.d.ts` | E13, E45 |
| [SPEC11](specs/SPEC11.md) | SPEC11: Marky Mark v11 — network isolation guarantee & security hardening | `src/App.tsx`, `src/components/AboutDialog.tsx`, `src/components/HostedSignIn.tsx`, `src/components/imageView.ts`, `src/components/livePreview.ts`, `src/lib/markdown.ts`, `src/lib/themes.ts`, `src/platform/hosted.ts`, `src/platform/tauri.ts`, `src/platform/types.ts`, `src/styles.css` | E121, E46 |
| [SPEC12](specs/SPEC12.md) | SPEC12: Marky Mark v12 — native desktop menus, chromeless desktop window | `src/App.tsx`, `src/components/SettingsPanel.tsx`, `src/lib/commands.ts`, `src/lib/menuSpec.ts`, `src/platform/browser.ts`, `src/platform/tauri.ts`, `src/platform/types.ts` | E94, E95, E47, E49, E133, E101 |
| [SPEC13](specs/SPEC13.md) | SPEC13: Marky Mark v13 — native Settings and About windows | `src/App.tsx`, `src/AuxWindow.tsx`, `src/components/AboutDialog.tsx`, `src/components/SettingsPanel.tsx`, `src/lib/auxProtocol.ts`, `src/lib/windowRole.ts`, `src/main.tsx`, `src/platform/browser.ts`, `src/platform/tauri.ts`, `src/platform/types.ts`, `src/styles.css` | E52, `tests/e2e/shell-and-menus.spec.ts`, E178 |
| [SPEC14](specs/SPEC14.md) | SPEC14: Marky Mark v14 — comment navigation (hotkeys + fixed navigator pill) | `src/App.tsx`, `src/lib/commentNav.ts`, `src/lib/menuSpec.ts`, `src/styles.css` | _none_ |
| [SPEC15](specs/SPEC15.md) | SPEC15: Marky Mark v15 — synchronized scrolling in split edit | `src/App.tsx`, `src/components/Editor.tsx`, `src/lib/activePosition.ts`, `src/lib/markdown.ts`, `src/lib/scrollSync.ts` | E57 |
| [SPEC16](specs/SPEC16.md) | SPEC16: Marky Mark v16 — review bundles, diff-since-save, reading memory, heading palette, word count | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/HeadingPalette.tsx`, `src/lib/diffLines.ts`, `src/lib/exportDoc.ts`, `src/lib/fuzzy.ts`, `src/lib/menuSpec.ts`, `src/lib/readingPositions.ts`, `src/lib/reviewBundle.ts`, `src/lib/settings.ts`, `src/lib/wordCount.ts`, `src/platform/web.ts`, `src/styles.css` | E175, E176 |
| [SPEC17](specs/SPEC17.md) | SPEC17: Marky Mark v17 — the Export dialog (HTML & PDF, options, sticky theme) | `src/App.tsx`, `src/components/ExportDialog.tsx`, `src/lib/reviewBundle.ts`, `src/lib/settings.ts` | E63 |
| [SPEC18](specs/SPEC18.md) | SPEC18: Marky Mark v18 — static HTML export, working PDF | `src/App.tsx`, `src/lib/exportDoc.ts` | E63 |
| [SPEC19](specs/SPEC19.md) | SPEC19: Marky Mark v19 — Check for Updates (GitHub-releases updater) | `src/App.tsx`, `src/components/UpdateDialog.tsx`, `src/platform/browser.ts`, `src/platform/types.ts`, `src/styles.css` | _none_ |
| [SPEC20](specs/SPEC20.md) | SPEC20: Marky Mark v20 — Image paste & preview resize | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/SettingsPanel.tsx`, `src/lib/imagePaste.ts`, `src/lib/imageResize.ts`, `src/lib/markdown.ts`, `src/lib/menuSpec.ts`, `src/lib/settings.ts`, `src/platform/browser.ts`, `src/platform/hosted.ts`, `src/platform/tauri.ts`, `src/platform/types.ts`, `src/styles.css` | E73, E77, E123, E26 |
| [SPEC21](specs/SPEC21.md) | SPEC21: Marky Mark v21 — New File (⌘N) | _none_ | E13 |
| [SPEC22](specs/SPEC22.md) | SPEC22: Marky Mark v22 — New File v2: the untitled buffer | `src/App.tsx`, `src/lib/menuSpec.ts` | E72 |
| [SPEC23](specs/SPEC23.md) | SPEC23: Marky Mark v23 — editing trio: mirrored selection, vim nav mode, markdown highlighting | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/livePreview.ts`, `src/lib/selectionMap.ts`, `src/lib/settings.ts`, `src/lib/vimnav.ts`, `src/platform/browser.ts`, `src/styles.css` | E150, `tests/e2e/live-preview.spec.ts`, E61 |
| [SPEC24](specs/SPEC24.md) | SPEC24: Marky Mark v24 — mirrored selection, both ways | `src/App.tsx`, `src/components/Editor.tsx`, `src/lib/selectionMap.ts`, `src/platform/browser.ts`, `src/styles.css` | _none_ |
| [SPEC25](specs/SPEC25.md) | SPEC25: Marky Mark v25 — selection across mode switches; first-class split toggle | `src/App.tsx`, `src/components/Editor.tsx`, `src/lib/commentAffordance.ts`, `src/lib/menuSpec.ts` | E153 |
| [SPEC26](specs/SPEC26.md) | SPEC26: Marky Mark v26 — YAML front matter: parsed, carded, dismissable | `src/App.tsx`, `src/components/FrontMatterCard.tsx`, `src/lib/frontmatter.ts`, `src/lib/markdown.ts`, `src/lib/menuSpec.ts`, `src/lib/settings.ts`, `src/styles.css` | _none_ |
| [SPEC27](specs/SPEC27.md) | SPEC27: Marky Mark v27 — the new icon, everywhere, and a real splash | `src/App.tsx`, `src/components/Toolbar.tsx`, `src/styles.css` | E78, E1 |
| [SPEC29](specs/SPEC29.md) | SPEC29: Marky Mark v29 — File → Open Recent | `src/App.tsx`, `src/lib/commands.ts`, `src/lib/menuSpec.ts`, `src/lib/recentFiles.ts`, `src/platform/browser.ts`, `src/platform/tauri.ts` | _none_ |
| [SPEC30](specs/SPEC30.md) | SPEC30: Marky Mark v30 — Find, reopen-on-launch, crash-safe drafts | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/FindBar.tsx`, `src/lib/drafts.ts`, `src/lib/menuSpec.ts`, `src/styles.css` | _none_ |
| [SPEC31](specs/SPEC31.md) | SPEC31: Marky Mark v31 — New Window (multi-window) | _none_ | _none_ |
| [SPEC32](specs/SPEC32.md) | SPEC32: Marky Mark v32 — the identity break (0.4 fresh start) | `src/lib/embedded.ts`, `src/platform/browser.ts`, `src/platform/web.ts` | _none_ |
| [SPEC33](specs/SPEC33.md) | SPEC33: Marky Mark v33 — the tiered developer workflow | _none_ | _none_ |
| [SPEC34](specs/SPEC34.md) | SPEC34: Marky Mark v34 — the folder sidebar | `src/App.tsx`, `src/components/FolderPanel.tsx`, `src/lib/folderOps.ts`, `src/lib/folderTree.ts`, `src/lib/menuSpec.ts`, `src/lib/settings.ts`, `src/platform/browser.ts`, `src/platform/hosted.ts`, `src/platform/tauri.ts`, `src/platform/types.ts`, `src/styles.css` | E6 |
| [SPEC35](specs/SPEC35.md) | SPEC35: Marky Mark v35 — folder & file management in the sidebar | `src/App.tsx`, `src/components/FolderPanel.tsx`, `src/lib/folderOps.ts`, `src/lib/openFiles.ts`, `src/platform/browser.ts`, `src/platform/tauri.ts`, `src/platform/types.ts`, `src/styles.css` | E96, E107 |
| [SPEC36](specs/SPEC36.md) | SPEC36: Marky Mark v36 — multiple open files (sidebar tabs) | `src/App.tsx`, `src/components/FolderPanel.tsx`, `src/lib/folderTree.ts`, `src/lib/hotkeys.ts`, `src/lib/menuSpec.ts`, `src/lib/openFiles.ts`, `src/styles.css` | E27, E96, E98, `tests/e2e/folder-tree.spec.ts`, E175 |
| [SPEC37](specs/SPEC37.md) | SPEC37: Marky Mark v37 — aligned table editing in the editor pane | `src/components/Editor.tsx`, `src/lib/smartEdit.ts`, `src/lib/tableEdit.ts`, `src/styles.css` | E107 |
| [SPEC38](specs/SPEC38.md) | SPEC38: Marky Mark v38 — the table grid becomes transient and wraps | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/tableMode.ts`, `src/lib/dirty.ts`, `src/lib/tableEdit.ts` | _none_ |
| [SPEC39](specs/SPEC39.md) | SPEC39: Marky Mark v39 — table mode: live re-fit, cell confinement, mode chrome | `src/components/tableMode.ts`, `src/lib/tableEdit.ts`, `src/styles.css` | E110 |
| [SPEC40](specs/SPEC40.md) | SPEC40: Marky Mark v40 — the grid is how tables look: no mode, one global view | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/imageView.ts`, `src/components/livePreview.ts`, `src/components/tableMode.ts`, `src/lib/imageResize.ts`, `src/lib/livePreview.ts`, `src/lib/settings.ts`, `src/lib/smartEdit.ts`, `src/lib/tableEdit.ts` | E107 |
| [SPEC41](specs/SPEC41.md) | SPEC41: Marky Mark v41 — images render in the editor: one global view, chips to resize | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/imageView.ts`, `src/lib/imageResize.ts`, `src/lib/markdown.ts`, `src/lib/settings.ts`, `src/lib/smartEdit.ts`, `src/styles.css` | E77, E107 |
| [SPEC42](specs/SPEC42.md) | SPEC42: Marky Mark v42 — resize chips on every border and corner | `src/components/Editor.tsx`, `src/styles.css` | E122 |
| [SPEC43](specs/SPEC43.md) | SPEC43: Marky Mark v36 — Smart Edit (contextual formatting menu) | `src/App.tsx`, `src/components/Editor.tsx`, `src/components/SettingsPanel.tsx`, `src/components/SmartEditMenu.tsx`, `src/lib/commands.ts`, `src/lib/hotkeys.ts`, `src/lib/smartEdit.ts`, `src/lib/tableEdit.ts`, `src/platform/browser.ts`, `src/platform/tauri.ts`, `src/platform/types.ts`, `src/platform/web.ts`, `src/styles.css` | E107 |
| [SPEC44](specs/SPEC44.md) | SPEC44: Marky Mark v44 — where am I? (active line & word, both panes) | `src/App.tsx`, `src/components/Editor.tsx`, `src/lib/activePosition.ts`, `src/lib/selectionMap.ts`, `src/styles.css` | _none_ |
| [SPEC45](specs/SPEC45.md) | SPEC45: Marky Mark v45 — cue-anchored split scrolling | `src/App.tsx`, `src/components/Editor.tsx` | _none_ |
| [SPEC46](specs/SPEC46.md) | SPEC46: Marky Mark v46 — performance pass (same behavior, less work) | _none_ | _none_ |
