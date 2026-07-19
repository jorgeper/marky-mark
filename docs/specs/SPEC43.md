# SPEC43: Marky Mark v36 — Smart Edit (contextual formatting menu)

Delta spec on top of SPEC.md–SPEC35.md as implemented (SPEC31 remains
spec-only; SPEC28 withdrawn). This file wins on conflict; nothing may
regress. §10 is the goal condition.

**What ships:** **Smart Edit** — in edit mode, a Marky Mark hash button
rides the gutter on the cursor's line; clicking it (or right-clicking in
the editor, or pressing a hotkey) opens a contextual formatting menu:
inline formatting (bold, italic, strikethrough, inline code, link),
Heading / Lists / Callout submenus, blockquote, code block, horizontal
rule, and Cut / Copy / Paste. Every action has a rebindable hotkey shown
at the right edge of its menu row and listed in Settings → Hotkeys.
Contextual entries — **Edit Table…** when the cursor is inside a pipe
table, **Resize Image…** when it is on an image — appear at the top and
are **deliberate no-ops in this delta** (they close the menu and do
nothing; wiring them is a later spec).

Out of scope: the actual table editor and image-resize actions (stubs
only); a Format submenu in the native menubar (`menuSpec.ts` unchanged);
any preview-mode right-click change (preview and the folder panel keep
their current behavior); spell-check suggestions inside the custom menu;
setext headings; indented (non-fenced) code blocks; list indent/outdent
and renumber-on-edit; clear-formatting; new web-suite tests (the feature
is pure frontend and ships on web by construction).

---

## 1. Naming (FR-NAME)

The feature is called **Smart Edit** everywhere users see it (menu
tooltip, Settings group label). All user-visible strings live in
`src/lib/smartEdit.ts` as constants so a later rename is one file.

## 2. Pure logic — `src/lib/smartEdit.ts` (FR-OPS)

New pure module, no DOM, no CodeMirror or platform imports. All text
operations take `(text: string, from: number, to: number)` (0-based
offsets, `from <= to`, collapsed when equal) and return
`{ text: string; from: number; to: number } | null` — the whole new
document text plus the new selection, or null for a no-op. Each caller
applies the result as **one** CodeMirror transaction (single undo step).

1. **Inline toggles** — `toggleInline(text, from, to, kind)` for
   `bold` (`**`), `italic` (`*`), `strike` (`~~`), `code` (`` ` ``):
   - Collapsed selection expands to the word around the cursor
     (Unicode letters/digits/underscore). Cursor not in a word ⇒ insert
     the marker pair and place the caret between them.
   - If the (expanded) selection is already wrapped — markers
     immediately outside the range, or the range's own edges — the
     markers are removed; otherwise added. Bold/italic disambiguation:
     `**` is checked before `*`, so toggling italic on bold text yields
     `***…***` and never eats a bold marker.
2. **Link** — `wrapLink(text, from, to)`: selection becomes
   `[selection](url)` with `url` selected; collapsed cursor inserts
   `[text](url)` with `text` selected.
3. **Heading** — `setHeading(text, from, to, level 1–6)`: every
   non-blank line touched by the selection gets its ATX prefix replaced
   by `#`·level + space; a line already at exactly that level loses its
   prefix (toggle-off). Existing `#` prefixes of other levels are
   replaced, never stacked.
4. **Line prefixes** — `toggleList(text, from, to, kind)` for
   `bullet` (`- `), `numbered` (`1. `, `2. `, … renumbered from 1 within
   the selection), `task` (`- [ ] `): if **all** non-blank selected
   lines already carry the kind's prefix (task matches `- [ ] ` and
   `- [x] `), it is removed; otherwise it is applied, replacing any
   other list prefix in place (indent whitespace preserved).
5. **Blockquote** — `toggleQuote(text, from, to)`: if all selected
   lines start with `>`, one `> `/`>` level is stripped; otherwise
   every selected line (blanks included, as bare `>`) gains `> `.
6. **Callout** — `insertCallout(text, from, to, kind)` for `note | tip |
   important | warning | caution` (GitHub alert syntax): a selection is
   quoted like §2.5-add with a `> [!NOTE]`-style line (uppercased kind)
   inserted above; a collapsed cursor inserts `> [!KIND]` and a `> `
   line below on the current line (which must be blank — otherwise the
   block is inserted after the current line), caret after the final
   `> `. Insert-only, no toggle. (The current pipeline renders these as
   plain blockquotes; that is acceptable and noted — GitHub renders
   them as alerts.)
7. **Code block** — `toggleCodeBlock(text, from, to)`: wraps the
   selection's complete lines in ``` fences, caret placed right after
   the opening fence (to type a language); if the selection's immediate
   boundary lines are already a matched fence pair, both fences are
   removed instead.
8. **Horizontal rule** — `insertHr(text, from, to)`: inserts a `---`
   line after the cursor's line, with blank lines above/below added
   only as needed; caret lands after the rule.
9. **Context detection** —
   `detectContext(text, head): { table: boolean; image: boolean }`:
   - `table`: the head's line lies within a pipe-table region — ≥ 2
     consecutive lines containing `|` whose second line is a GFM
     delimiter row (optionally piped/edged `:?-+:?` cells).
   - `image`: the head offset falls within a markdown image
     `![alt](src)` span or an `<img …>` tag on its line.
10. **Menu model** — `buildSmartMenu(ctx)` with
    `ctx = { table, image, hasSelection, canPaste, hotkeys, isMac }` —
    the single source of menu truth, returning sections of
    `{ id, label, hotkey?, enabled, submenu? } | 'sep'`:
    - contextual: `edit-table` (iff `table`), `resize-image` (iff
      `image`), then a separator iff either was present;
    - inline: `bold`, `italic`, `strike`, `code`, `link`;
    - blocks: `heading` ▸ `h1`–`h6`; `lists` ▸ `bullet`, `numbered`,
      `task`; `callout` ▸ `note`, `tip`, `important`, `warning`,
      `caution`; then `quote`, `code-block`, `hr`;
    - clipboard: `cut`, `copy` (both `enabled: false` when
      `!hasSelection`), `paste` (omitted when `!canPaste`).
    `hotkey` carries the `displayCombo` of the **current** binding from
    `ctx.hotkeys`; callout and clipboard items have none (clipboard rows
    may show the fixed ⌘X/⌘C/⌘V labels).

## 3. The gutter button (FR-GUTTER)

1. A custom CodeMirror gutter (class `mm-smart-gutter`) renders in edit
   mode — full-screen and split alike — showing one marker: the Marky
   Mark hash icon (same slanted-top-bar geometry as the folder-filter
   button, SPEC34; rendered at **18 px**, vs the 16 px file icon) on
   the **selection head's line only**. It tracks every cursor move and
   scrolls natively with the document.
2. Placement: with line numbers on, the smart gutter sits **between the
   line numbers and the text**; with them off it stands alone. The
   icon inherits theme colors (muted at rest, accent on hover).
3. The marker is a button: test id `smart-edit-gutter`, `title` =
   "Smart Edit" + the current `smartMenu` binding's `displayCombo`.
   Click opens the menu (§4) anchored at that line, never moving the
   cursor or stealing the selection.

## 4. The menu (FR-MENU)

1. `SmartEditMenu` (new `src/components/SmartEditMenu.tsx`) renders the
   §2.10 model as a `theme-menu`-styled popup (the FolderPanel pattern:
   positioned, viewport-clamped, dismissed by Esc, outside pointerdown,
   scroll, resize, or invoking a leaf item). Test ids: `smart-edit-menu`,
   items `smart-edit-<id>`. Each row shows its label left and its
   hotkey right (`.menu-hotkey`, muted).
2. Submenu rows (`heading`, `lists`, `callout`) show a ▸ and open a
   flyout beside the parent row on hover or click (flipping to the
   other side at the viewport edge); only one flyout is open at a time.
3. Keyboard: ↑/↓ move, → opens a submenu, ← closes it, Enter invokes,
   Esc dismisses (the flyout first, then the menu). The menu takes
   focus while open and returns it to the editor on close.
4. Openers (all edit-mode only):
   - the gutter button (§3), anchored at the button;
   - **right-click anywhere in the editor pane** — the menu opens at
     the pointer and the native context menu is suppressed **only
     there** (preview, folder panel, inputs, and every other surface
     keep the native menu);
   - the `smartMenu` hotkey (default **Mod+.**), anchored at the
     cursor's viewport coordinates.
5. Invoking a formatting item applies the §2 operation to the current
   selection via one CM dispatch, closes the menu, and returns focus to
   the editor. `edit-table` and `resize-image` close the menu and do
   nothing (stubs; test ids must exist). `cut`/`copy` route the
   selection through the existing `Platform.copyText` seam (`cut` also
   deletes the selection through the normal undo path); `paste` inserts
   the clipboard text at the selection.
6. Clipboard read is a new OPTIONAL seam `readClipboardText?():
   Promise<string>` — desktop: `tauri-plugin-clipboard-manager` (the
   **only permitted new dependency**, official plugin, no network);
   shim: returns the last `__mmClipboard` entry (and `copyText` keeps
   recording there); web: defined iff `navigator.clipboard.readText`
   exists. Absent seam ⇒ the `paste` item is omitted (`canPaste`).

## 5. Hotkeys & commands (FR-KEYS)

1. `HotkeyMap` gains **18 fields** with these defaults (all conflict-free
   against SPEC1–35 bindings and menubar accelerators):
   `smartMenu` Mod+. · `bold` Mod+B · `italic` Mod+I · `strikethrough`
   Mod+Shift+X · `inlineCode` Mod+Shift+M · `link` Mod+Shift+K ·
   `heading1`–`heading6` Mod+1–Mod+6 · `bulletList` Mod+Shift+8 ·
   `numberedList` Mod+Shift+7 · `taskList` Mod+Shift+9 · `blockquote`
   Mod+Shift+B · `codeBlock` Mod+Alt+C · `horizontalRule` Mod+Alt+-.
2. Each maps to a new `CommandId` (`smartMenu`, `fmtBold`, `fmtItalic`,
   `fmtStrike`, `fmtCode`, `fmtLink`, `fmtHeading1`–`6`, `fmtBullet`,
   `fmtNumbered`, `fmtTask`, `fmtQuote`, `fmtCodeBlock`, `fmtHr`)
   dispatched by the existing window-level hotkey listener and handled
   in App by forwarding to an imperative `applyFormat(op)` /
   `openSmartMenu()` on the Editor handle. **Outside edit mode every
   one is a silent no-op.** Callout and clipboard actions are menu-only
   (no CommandId, no hotkey — the OS/CM cut/copy/paste combos already
   work).
3. Settings → Hotkeys grows a **"Smart Edit"** group heading beneath
   the existing recorders, one recorder per new field, same
   capture/conflict/reset semantics (Reset restores all defaults,
   old and new). Rebinding updates menu rows and the gutter tooltip
   immediately.
4. `settings.json` parsing accepts the new keys with per-key fallback
   to defaults, exactly like the existing ones. `menuSpec.ts` is
   untouched — no native Format menu in this delta.

## 6. Editor integration (FR-EDITOR)

1. The gutter extension and the right-click handler live in the
   editor's mount effect; the menu state (open/anchor/context) lives
   beside it and is torn down on unmount (mode toggle, doc switch).
   Parked undo history, the SPEC25 selection carry, vim nav-mode, find,
   and diff decorations are unaffected.
2. Menu-open computes `detectContext(docText, head)` fresh at open
   time; the menu never holds stale offsets (any formatting applies to
   the selection as of invocation).
3. While the menu is open, editor typing is unreachable (menu holds
   focus); vim nav-mode and type-to-comment cannot fire; app hotkeys
   still dismiss nothing except via Esc (which the menu consumes).

## 7. Styling (FR-STYLE)

`styles.css` only: `.mm-smart-gutter` (fixed width, centered icon,
cursor pointer, `--mm-muted` at rest / `--mm-accent` on hover),
`.smart-edit-menu` reusing the `theme-menu` look, `.menu-hotkey`
(right-aligned, muted, `font-variant-numeric: tabular-nums`), flyout
positioning classes. All colors via existing `--mm-*` variables — no
theme-format change, dark themes work for free.

## 8. Security & platform posture

No new network surface: the clipboard plugin is local, the CSP and
sanitize layer are untouched, and the SPEC11 zero-request guarantee
holds (the static bundle scan must stay clean). The web build ships the
identical feature minus `paste` where clipboard read is unavailable.

## 9. Tests (added: U65–U68, E105–E108)

1. **U65** — `buildSmartMenu`: exact section/item/order snapshot with
   no context; `edit-table`/`resize-image` presence iff table/image;
   separator collapse; cut/copy disabled without selection; paste
   omitted without `canPaste`; hotkey labels follow a rebound
   `ctx.hotkeys`; submenu contents pinned. `detectContext`: pipe tables
   (edged and edge-less, delimiter-row required, single `|` line ⇒
   false), images (`![…](…)` span boundaries, `<img>` tag, plain link
   ⇒ false).
2. **U66** — inline toggles: wrap/unwrap for all four kinds; word
   expansion at a collapsed cursor; caret-between-markers on
   whitespace; bold-vs-italic disambiguation (`***`); link wrap with
   `url` selected and collapsed-cursor placeholder; selections at doc
   start/end.
3. **U67** — line ops: heading set / switch level / toggle-off /
   multi-line with blanks skipped; bullet↔numbered↔task replacement
   in place; numbered renumbering from 1; all-prefixed ⇒ removal;
   indent preserved; quote add (blanks get `>`) and strip; callout
   above a selection and at a collapsed cursor, all five kinds.
4. **U68** — code block wrap (caret after opening fence) and unwrap of
   an exactly-fenced selection; HR below the cursor's line with
   blank-line management at doc edges; every §2 op returns a result
   applied as a single string splice (offsets consistent).
5. **E105** — the gutter button (shim, edit mode): appears on the
   cursor's line, follows cursor moves, sits right of line numbers,
   survives the line-numbers-off setting; click opens
   `smart-edit-menu` with hotkey labels rendered; Esc and outside
   click dismiss; preview mode shows no gutter button.
6. **E106** — formatting end-to-end: bold via menu on a selection;
   italic via its default hotkey; H2 via the Heading flyout; bullet
   toggle on a multi-line selection; each action is exactly one undo
   step (⌘Z restores the prior text verbatim); a formatting hotkey in
   preview mode changes nothing.
7. **E107** — right-click & context: right-click in the editor opens
   the menu at the pointer (native menu suppressed there only);
   cursor inside a fixture pipe table ⇒ `smart-edit-edit-table` shown,
   invoking it closes the menu and the buffer is byte-identical;
   cursor on an image line ⇒ `smart-edit-resize-image` shown, same
   no-op check; cursor on plain text ⇒ neither; copy puts the
   selection on `__mmClipboard`; paste inserts the shim clipboard
   text; right-click in preview mode does not open the smart menu.
8. **E108** — hotkeys & settings: the Smart Edit group renders in
   Settings → Hotkeys; rebinding `bold` updates the menu row's label
   and the new combo applies bold (the old one no longer does);
   conflict against an existing binding is refused; Mod+. opens the
   menu at the cursor; Reset restores the Smart Edit defaults too.
9. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved. The only permitted test additions are
   U65–U68 and E105–E108.

## 10. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U68, E1–E41 +
   E45–E108, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` limited to: the `tauri-plugin-clipboard-manager`
   dependency, its registration, and its clipboard-read permission. No
   version-file changes (0.4.0-alpha.1); no other dependencies; no
   `.skip/.only/.todo`; the Windows-reserved-name scan prints nothing.
3. README: a Smart Edit bullet (button, right-click, hotkeys).
   ARCHITECTURE.md: a Smart Edit section — the pure module, the gutter,
   the menu, the `readClipboardText` seam, and the no-op stubs' status.
