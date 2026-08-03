# Launching the Marky Mark v36 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC43.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC43.md in full (delta on SPEC.md–SPEC35.md as implemented; SPEC43 wins on conflict, no regressions; SPEC31 spec-only, E42–E44 reserved; out of scope per SPEC43: Edit Table…/Resize Image… stay no-op stubs that close the menu and do nothing, no native-menubar Format menu, no preview right-click changes, no setext headings, indented code blocks, indent/outdent, or clear-formatting, no new web tests). Deliverable: Smart Edit per SPEC43 §1–§8 — in edit mode a custom CodeMirror gutter (class mm-smart-gutter, test id smart-edit-gutter) shows the 18px slanted-top hash icon on the selection head's line only (right of line numbers when shown, alone when hidden, theme-colored, tooltip "Smart Edit" + current combo); clicking it, right-clicking in the editor pane (native menu suppressed there ONLY), or Mod+. opens the theme-menu-styled popup (test id smart-edit-menu, items smart-edit-<id>, viewport-clamped, Esc/outside/scroll/resize dismissal, ↑↓→←/Enter/Esc keyboard nav, hotkey label right-aligned per row) built by pure buildSmartMenu(ctx) in new src/lib/smartEdit.ts: contextual Edit Table…/Resize Image… via detectContext (GFM pipe-table region / image span or <img> tag); Bold/Italic/Strikethrough/Inline code/Link; flyout submenus Heading▸H1–H6, Lists▸Bullet/Numbered/Task, Callout▸Note/Tip/Important/Warning/Caution (GitHub alert syntax, insert-only); Blockquote, Code block, Horizontal rule; Cut/Copy (disabled without selection, existing copyText seam) and Paste via a new OPTIONAL readClipboardText seam (desktop: tauri-plugin-clipboard-manager, the ONLY permitted new dependency; shim: last __mmClipboard entry; item omitted when absent). All text ops are pure functions over (text, from, to) returning new text + selection, each applied as ONE CodeMirror transaction (single undo step), semantics exactly per SPEC43 §2. HotkeyMap gains 18 rebindable fields with the §5.1 defaults (smartMenu Mod+., bold Mod+B, italic Mod+I, strikethrough Mod+Shift+X, inlineCode Mod+Shift+M, link Mod+Shift+K, heading1–6 Mod+1–6, bullet/numbered/task Mod+Shift+8/7/9, blockquote Mod+Shift+B, codeBlock Mod+Alt+C, horizontalRule Mod+Alt+-), each a new CommandId routed through the existing window hotkey listener to an imperative Editor applyFormat/openSmartMenu handle, silent no-ops outside edit mode; Settings → Hotkeys grows a "Smart Edit" recorder group with the same capture/conflict/reset semantics; settings.json parses the new keys with per-key defaults; menuSpec.ts untouched. Done when: 'npm run validate' exits 0 with complete output — U1–U68, E1–E41 plus E45–E108, W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is limited to the clipboard-manager dependency + registration + clipboard-read permission, AND version files stay 0.4.0-alpha.1, AND README gains the Smart Edit bullet and ARCHITECTURE.md the Smart Edit section (pure module, gutter, menu, seam, stub status), AND 'git diff --stat docs/specs' is empty, 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing, and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: spec files and this condition unmodified; existing tests never modified, weakened, stubbed, or deleted — only permitted additions U65–U68 and E105–E108; no dependencies beyond tauri-plugin-clipboard-manager; SPEC11 network isolation (bundle scan clean), sidecar/trailer formats, comment-anchor space, parked undo history, SPEC25 selection carry, vim nav-mode, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

```bash
# from this worktree — review, then merge via PR per your flow
git log --oneline main..feat/table-edit
```

Manual checks (the parts automation can't see):

- Open a doc, enter edit mode — the hash button hugs your current
  line and follows the caret as you arrow around; it feels attached,
  never laggy, and scrolls with the text.
- Click it: the menu opens beside the line. Hover Heading — the
  flyout opens on the correct side near the window edge.
- Select a word mid-sentence, ⌘B, ⌘B again — bold on, bold off,
  cursor still sensible. ⌘Z once per toggle.
- Put the caret in a pipe table → Edit Table… appears (and safely
  does nothing). On an image line → Resize Image…. Plain paragraph →
  neither.
- Right-click in the editor: smart menu. Right-click in preview and
  in the folder panel: the menus you had before.
- Select two paragraphs → Lists ▸ Numbered: `1.` `2.` appear;
  again: they go away.
- Callout ▸ Warning on a selection — GitHub renders the result as an
  alert (paste it into a gist to see); Marky Mark shows a blockquote.
- Rebind Bold in Settings → Hotkeys to something odd, reopen the
  menu — the row shows the new combo; the old ⌘B does nothing.
- Cut/Copy/Paste from the menu round-trip through the system
  clipboard in the packaged app (not just the shim).
- Toggle line numbers off — the hash button stays, alone in the
  gutter.
