# SPEC26: Marky Mark v26 — YAML front matter: parsed, carded, dismissable

Delta spec on top of SPEC.md–SPEC25.md as implemented (all green: U1–U53,
E1–E41 + E45–E85, W1–W10; SPEC8 still pending, E42–E44 reserved). This
file wins on conflict; nothing may regress. §6 is the goal condition.

**Why:** a document starting with YAML front matter currently renders it
as markdown — the opening `---` becomes a horizontal rule (a huge blank
gap at the top) and the keys mush into a paragraph.

**What ships:** front matter never renders as markdown again. Instead the
preview shows a **dim, theme-styled metadata card** (key/value rows) above
the document — dismissable via an **✕ on the card**, toggleable via
**View → Front Matter** (checkbox), with a persisted **"Show front
matter" setting (default on)** that decides the initial state per opened
document.

Out of scope: editing front matter through the card (the editor shows the
raw source as ever), YAML beyond display parsing (no schema, no types —
nested structures beyond one list level show as raw lines), front matter
in exports/print (it simply no longer renders — the card is app UI),
editor syntax highlighting of the front-matter block, a hotkey.

---

## 1. Rendering (FR-FM)

1. The markdown pipeline gains **`remark-frontmatter`** (unified-family,
   the **only** permitted new dependency): a leading `---`-fenced YAML
   block parses as a `yaml` node that never reaches the HTML — no more
   hr + paragraph garbage, body blocks keep their true source-line
   positions (`data-mm-line` stamps, scroll sync, selection mirrors all
   unaffected). Unclosed fences are not front matter (unchanged
   rendering). Rendered doc text no longer contains front-matter text —
   existing comments on such documents re-anchor as after any edit.
2. Display parsing is a **pure module `src/lib/frontmatter.ts`**:
   `parseFrontMatter(text): { entries: Array<{ key: string; value:
   string }>; raw: string; endLine: number } | null` — recognizes a
   document starting `---` with a closing `---`/`...` fence (mirroring
   remark-frontmatter's recognition), `key: value` rows, one level of
   `- item` lists attached to the preceding key (joined ", "), and
   passes anything else through as a raw row (`key: ''`). Null when the
   document has no front matter.

## 2. The card (FR-CARD)

1. A React component (app UI, **not** part of the rendered markdown —
   exports never carry it) rendered above the document in **preview and
   the split-preview pane**, scrolling with the content. Test id
   `fm-card`: dim theme-variable styling (muted foreground, hairline
   border, small mono keys), one row per entry.
2. An **✕ button** (test id `fm-close`, accessible label "Hide front
   matter") hides the card — same effect as unchecking the menu item.
3. The card shows only when: the document has front matter AND the
   session toggle is on.

## 3. Toggle & setting (FR-TOG)

1. New command **`toggleFrontmatter`**; **View → Front Matter** checkbox
   (no accelerator), after Word Count, both OS layouts, always present.
   `MenuState` gains `showFrontmatter` (the session state).
2. New setting **`showFrontmatter: boolean`, default `true`** (house
   parse/serialize rules), checkbox in Settings → General (test id
   `settings-frontmatter`, label "Show front matter (when a document
   has it)").
3. State model: opening a document (or a new untitled buffer) resets the
   **session toggle** to the setting; ✕ and the menu item flip the
   session toggle only. The setting is the *default*, never overwritten
   by the session toggle.

## 4. Platforms

No Platform/Tauri/Rust changes. The web build and dev shim inherit
everything (same React code path).

## 5. Tests (added: U54–U55, E86)

1. **U54** — `parseFrontMatter`: fenced block → entries (scalars, a
   list-valued key, a raw passthrough line), `endLine` correct; `...`
   closing fence; no front matter → null; unclosed fence → null; `---`
   not at line 1 → null.
2. **U55** — menu + settings: View carries `toggleFrontmatter` ("Front
   Matter", checkbox tracking `showFrontmatter`, no accelerator) after
   `toggleWordCount` on both layouts; `showFrontmatter` setting defaults
   true, explicit false honored, malformed falls back, round-trips.
3. **E86** — a front-matter document: preview shows **no top hr** and no
   "date:" paragraph; `fm-card` lists the keys; ✕ hides it (View
   unchecks — asserted via the nativeMenu spec on a fresh boot);
   toggling the menu item back shows it; with the setting off the next
   open starts hidden; the card also renders in the split preview; a
   document without front matter shows no card and E1's clean layout is
   unchanged.
4. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved.

## 6. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U55, E1–E41 +
   E45–E86, W1–W10 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; the only dependency change is
   `remark-frontmatter`; no version-file changes; no `.skip/.only/.todo`
   in tests/; reserved-name scan prints nothing.
3. README mentions front-matter handling; ARCHITECTURE.md gets a short
   note (pipeline node drop + card/session/setting model).
