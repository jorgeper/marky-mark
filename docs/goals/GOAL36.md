# Launching the Marky Mark v36 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC36.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC36.md in full (delta on SPEC.md–SPEC35.md as implemented; SPEC36 wins on conflict, no regressions; SPEC31 stays spec-only, E42–E44 reserved; out of scope: the real table editor and image-resize actions — Edit Table…/Resize Image… are stubs that close the menu and do nothing — plus any native-menubar Format menu, preview-mode right-click changes, setext headings, indented code blocks, list indent/outdent, clear-formatting, and new web-suite tests). The deliverable is Smart Edit: in edit mode a custom CodeMirror gutter (class mm-smart-gutter, test id smart-edit-gutter) shows the Marky Mark slanted-top hash icon at 18px on the selection head's line only — right of the line numbers when shown, standing alone when hidden, theme-colored, tooltip "Smart Edit" plus the current smartMenu combo — and clicking it, right-clicking anywhere in the editor pane (native menu suppressed there ONLY), or pressing Mod+. opens a theme-menu-styled contextual popup (test id smart-edit-menu, items smart-edit-<id>, viewport-clamped, Esc/outside/scroll/resize dismissal, full ↑↓→←/Enter/Esc keyboard navigation, hotkey labels right-aligned per row) built by the pure buildSmartMenu(ctx) in a new src/lib/smartEdit.ts: contextual Edit Table… iff detectContext finds the cursor inside a GFM pipe-table region and Resize Image… iff on a markdown image span or <img> tag; inline Bold/Italic/Strikethrough/Inline code/Link; flyout submenus Heading▸H1–H6, Lists▸Bullet/Numbered/Task, Callout▸Note/Tip/Important/Warning/Caution (GitHub alert syntax, insert-only); Blockquote, Code block, Horizontal rule; then Cut/Copy (disabled without selection, via the existing copyText seam) and Paste (via a new OPTIONAL readClipboardText seam — desktop tauri-plugin-clipboard-manager which is the ONLY permitted new dependency, shim returns the last __mmClipboard entry, item omitted when the seam is absent). All text operations are pure functions in smartEdit.ts over (text, from, to) returning the new text plus selection, applied as ONE CodeMirror transaction each (single undo step): inline toggles wrap/unwrap with word-expansion at a collapsed cursor and **-before-* disambiguation; link wraps with url (or placeholder text) selected; setHeading replaces/toggles ATX prefixes per non-blank selected line; toggleList applies/removes/replaces bullet - , renumbered 1. 2. …, and task - [ ] prefixes preserving indent; toggleQuote adds > to every selected line or strips one level; insertCallout puts > [!KIND] above the quoted selection or inserts the template at a collapsed cursor; toggleCodeBlock wraps complete lines in ``` fences (caret after the opening fence) or removes an exactly-bounding pair; insertHr drops a --- line below the cursor's line managing blank lines. Hotkeys: HotkeyMap gains 18 rebindable fields with defaults smartMenu Mod+., bold Mod+B, italic Mod+I, strikethrough Mod+Shift+X, inlineCode Mod+Shift+M, link Mod+Shift+K, heading1–6 Mod+1–6, bulletList Mod+Shift+8, numberedList Mod+Shift+7, taskList Mod+Shift+9, blockquote Mod+Shift+B, codeBlock Mod+Alt+C, horizontalRule Mod+Alt+-, each a new CommandId (smartMenu, fmtBold, fmtItalic, fmtStrike, fmtCode, fmtLink, fmtHeading1–6, fmtBullet, fmtNumbered, fmtTask, fmtQuote, fmtCodeBlock, fmtHr) routed through the existing window hotkey listener to an imperative Editor applyFormat/openSmartMenu handle, silent no-ops outside edit mode; Settings → Hotkeys grows a "Smart Edit" group of recorders with the same capture/conflict/reset semantics and settings.json parses the new keys with per-key defaults; menuSpec.ts untouched. Done when: 'npm run validate' exits 0 with its complete output — U1–U67, E1–E41 plus E45–E103, W1–W11 — and the final line 'VALIDATION: ALL PASSED' printed in the transcript, AND 'git diff src-tauri/' is limited to the tauri-plugin-clipboard-manager dependency + registration + clipboard-read permission, AND version files stay at 0.4.0-alpha.1, AND README gains the Smart Edit bullet and ARCHITECTURE.md the Smart Edit section (pure module, gutter, menu, readClipboardText seam, stub status), AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: the spec files and this condition must not be modified; existing tests may not be modified, weakened, stubbed, or deleted — the only permitted test additions are U64–U67 and E100–E103; no dependencies beyond tauri-plugin-clipboard-manager; the SPEC11 network-isolation guarantee (static bundle scan clean), sidecar/trailer formats, comment-anchor coordinate space, parked undo history, SPEC25 selection carry, vim nav-mode, and all existing web behavior are unchanged. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
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
