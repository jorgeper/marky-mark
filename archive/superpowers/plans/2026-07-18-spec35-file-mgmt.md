# SPEC35 — Sidebar File & Folder Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right-click context menu on the folder sidebar — create (New File/New Folder), rename in place, delete to the OS Trash (confirmed), reveal in the OS file manager, and copy path / copy relative path — with all app state (open doc, tree, recents, foldertree.json) kept consistent.

**Architecture:** Four new OPTIONAL `Platform` seam methods (`renameEntry`, `trashEntry`, `revealPath`, `copyText`) implemented by `tauri.ts` and the browser shim; one new pure module `src/lib/folderOps.ts` (name validation, unique naming, path remapping, relative paths, the menu model); UI in `FolderPanel.tsx` (menu + inline rename input) with all I/O and state remapping owned by `App.tsx`, following the exact SPEC34 pattern.

**Tech Stack:** React 19 + TypeScript (vite), Tauri v2 (plugin-fs `rename`, plugin-opener `revealItemInDir`, one new Rust command on the `trash` crate), Vitest (U63), Playwright (E96–E99).

## Global Constraints

- `npm run validate` must exit 0 with `VALIDATION: ALL PASSED` (full tier, not `--quick`).
- `git diff src-tauri/` limited to: `trash` crate dep + one Rust command + registration + the previously-missing `fs:allow-rename` and `opener:allow-reveal-item-in-dir` permissions. Nothing else.
- The `trash` crate is the ONLY permitted new dependency (no network use, no extra capability).
- Version files stay at `0.4.0-alpha.1` (package.json, tauri.conf.json, Cargo.toml).
- No existing test modified/weakened/skipped/deleted. Only additions: U63 (unit) and E96–E99 (e2e, appended to `tests/e2e/app.spec.ts`). E42–E44 stay reserved. No `.skip(`/`.only(`/`.todo(` anywhere in `tests/`.
- `docs/specs/` untouched (`git diff --stat docs/specs` empty).
- Windows-reserved-filename scan must print nothing:
  `git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]'`
- Out of scope: web build (panel never renders there), root rename/delete, drag-and-drop, copy/cut/paste of entries, multi-select, undo of file ops, keyboard menu invocation, `.md` guard on rename.
- Ports: before any e2e/dev-server run, check `lsof -iTCP:4923 -sTCP:LISTEN` (and 1420) — if busy, STOP and tell the user; never kill the process.

## Key existing facts (verified against the tree)

- Platform seam: `src/platform/types.ts` (optional-method pattern, e.g. `readDirEntries?` at :66). Shim: `src/platform/browser.ts` — virtual fs = flat `Record<path,string>` in localStorage; recording hooks pattern: `__mmPrints` (:226), `__mmExternalOpens` (:430).
- Desktop: `src/platform/tauri.ts` — `fsp = await import('@tauri-apps/plugin-fs')` (:28), `invoke` round-trip example `invoke('print_view')` (:326). Rust commands in `src-tauri/src/lib.rs`, registered at :46 `generate_handler![take_pending_open_files, print_view]`. Capabilities: `src-tauri/capabilities/default.json` fs block at :29-41 (no `fs:allow-rename`), opener block :21-28 (no reveal). Consult `src-tauri/gen/schemas/desktop-schema.json` for the exact reveal-permission scope shape.
- App state: `App.tsx` — `folderRoot/folderExpanded/folderChildren/folderShowNonMd` (:102-105), `folderStateRef` (:649), `persistFolderState` (:655), `listFolderDir` (:672), `openDoc` (:741, watcher at :779-797), `openDocGuarded` (:804), `saveDoc` (:1102), `startUntitled` (:1192 — template for close-to-splash), `deleteDraft` (:1222), `commitRecent` (:632), FolderPanel mount (:2371-2391), modal template `open-prompt` (:2724-2764).
- Recents: `recentFiles.ts` — `rememberRecent/removeRecent/serializeRecent`; store `{version:1, entries:[{path,at}]}`.
- Panel: `FolderPanel.tsx` — rows are `<button data-testid="folder-item" data-path={path}>`; dim non-md rows currently `disabled` (must change: disabled buttons don't fire `contextmenu`); `.folder-list` is the scroll container.
- Tests: e2e appends to `tests/e2e/app.spec.ts` (flat `test('E<n>: …')`, highest E95 at :3115; spec-local helpers `seedFolders` (:2973), `freshNativeMenuApp` (:1189)); helpers `fsRead/fsWrite` in `tests/e2e/helpers.ts`; unit highest U62 in `tests/unit/folder-tree.test.ts`. Playwright: port 4923, workers 1. Console errors fail tests (fixtures.ts consoleGuard).

---

### Task 1: Pure module `src/lib/folderOps.ts` + U63

**Files:**
- Create: `src/lib/folderOps.ts`
- Test: `tests/unit/folder-ops.test.ts`

**Interfaces (produced, used by Tasks 3–6):**
```ts
export type FolderMenuItem = { id: string; label: string } | 'sep';
export function validateEntryName(name: string): string | null;
export function uniqueChildName(existing: string[], base: string): string;
export function remapPath(path: string, oldPrefix: string, newPrefix: string): string | null;
export function relativePath(root: string, path: string): string;
export function folderContextMenu(
  kind: 'dir' | 'file' | 'root',
  opts: { isMac: boolean; canReveal: boolean; canTrash: boolean; canRename: boolean; canCopy: boolean }
): FolderMenuItem[];
```

- [ ] **Step 1: Write the failing test** `tests/unit/folder-ops.test.ts` — one `test('U63: …')` inside `describe('SPEC35 folder ops', …)` covering:
  - `validateEntryName`: valid (`notes.md`, `New Folder`, `com0.md`, `con2.md`, `lpt10.txt`, `x`.repeat(255)); rejected: `''`, `'   '`, `a/b`, `a\\b`, `.`, `..`, `.hidden`, `name.`, `name `, `'x'.repeat(256)`, and EVERY reserved stem `aux con prn nul com1…com9 lpt1…lpt9` bare + `.md` + upper/mixed case (`CON.md`, `Lpt3.backup.md` — stem judged before the FIRST dot).
  - `uniqueChildName`: no collision ⇒ base; `Untitled.md`→`Untitled 2.md`→`Untitled 3.md` (number before extension); `New Folder`→`New Folder 2`; collision check case-insensitive (`untitled.md` collides with `Untitled.md`).
  - `remapPath`: exact (`/a/b`,`/a/b`→`/a/x` ⇒ `/a/x`), descendant (`/a/b/c.md` ⇒ `/a/x/c.md`), unaffected ⇒ null, separator boundary: `/a/bc` with `/a/b`→`/a/x` ⇒ null; Windows `C:\\n\\sub\\f.md` with `C:\\n\\sub`→`C:\\n\\stuff` ⇒ `C:\\n\\stuff\\f.md`.
  - `relativePath`: `('/notes','/notes/sub/b.md')` ⇒ `sub/b.md`; root itself ⇒ `.`; Windows `('C:\\notes','C:\\notes\\a.md')` ⇒ `a.md`.
  - `folderContextMenu`: exact arrays (ids, labels, sep positions) for all three kinds with all caps true (dir: New File, New Folder, ─, Rename, Delete, ─, reveal, ─, Copy Path, Copy Relative Path; file: reveal, ─, Rename, Delete, ─, Copy Path, Copy Relative Path; root: New File, New Folder, ─, reveal, ─, Copy Path); `isMac:true` ⇒ `Reveal in Finder`, false ⇒ `Reveal in File Explorer`; omission + separator collapse: dir with `canReveal:false` ⇒ `[new-file,new-folder,'sep',rename,delete,'sep',copy-path,copy-relative-path]`; root with `canCopy:false` ⇒ `[new-file,new-folder,'sep',reveal]` (no trailing sep); file with `canRename:false,canTrash:false` ⇒ `[reveal,'sep',copy-path,copy-relative-path]`.
- [ ] **Step 2:** `npx vitest run tests/unit/folder-ops.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `src/lib/folderOps.ts`** (pure, no DOM/platform imports; header comment citing SPEC35 §2):

```ts
const RESERVED = /^(aux|con|prn|nul|com[1-9]|lpt[1-9])$/;

export function validateEntryName(name: string): string | null {
  if (!name.trim()) return 'Name required';
  if (/[/\\]/.test(name)) return 'Names cannot contain / or \\';
  if (name === '.' || name === '..') return 'Not a valid name';
  if (name.startsWith('.')) return 'Names starting with “.” are hidden from the tree';
  if (/[. ]$/.test(name)) return 'Names cannot end with a dot or space';
  if (name.length > 255) return 'Name too long';
  const stem = name.split('.')[0].toLowerCase();
  if (RESERVED.test(stem)) return `“${stem}” is a reserved name on Windows`;
  return null;
}

export function uniqueChildName(existing: string[], base: string): string {
  const taken = new Set(existing.map((e) => e.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function remapPath(path: string, oldPrefix: string, newPrefix: string): string | null {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`))
    return newPrefix + path.slice(oldPrefix.length);
  return null;
}

export function relativePath(root: string, path: string): string {
  const r = root.replace(/[\\/]+$/, '');
  if (path === r || path.replace(/[\\/]+$/, '') === r) return '.';
  const rest = remapPath(path, r, '');
  return rest === null ? path : rest.replace(/^[\\/]/, '');
}
```
  plus `folderContextMenu` exactly as designed (build per-kind array with `null` for capability-omitted items, then filter nulls and collapse leading/doubled/trailing `'sep'`).
- [ ] **Step 4:** `npx vitest run tests/unit/folder-ops.test.ts` — PASS. Then `npx vitest run` (whole unit suite) — PASS.
- [ ] **Step 5: Commit** `feat: folderOps pure module — validation, unique names, remap, menu model (U63)`

### Task 2: Platform seams — types, shim, desktop, Rust trash command, capabilities

**Files:**
- Modify: `src/platform/types.ts` (after `copyFile?` ~:70), `src/platform/browser.ts`, `src/platform/tauri.ts`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`

**Interfaces (produced):** `Platform.renameEntry?/trashEntry?/revealPath?/copyText?` per SPEC35 §1; shim hooks `window.__mmTrash: string[]`, `__mmReveals: string[]`, `__mmClipboard: string[]`.

- [ ] **Step 1: types.ts** — add with SPEC35 §1 doc comments:
```ts
/** SPEC35 §1: rename/move a file or directory (directory contents follow). */
renameEntry?(oldPath: string, newPath: string): Promise<void>;
/** SPEC35 §1: move a file or directory (recursively) to the OS Trash. */
trashEntry?(path: string): Promise<void>;
/** SPEC35 §1: select the entry in the OS file manager. */
revealPath?(path: string): Promise<void>;
/** SPEC35 §1: clipboard write (shim also records on __mmClipboard for e2e). */
copyText?(text: string): Promise<void>;
```
- [ ] **Step 2: browser.ts shim.** Add `__mmTrash?: string[]; __mmReveals?: string[]; __mmClipboard?: string[];` to the `declare global Window` block. Make explicit empty directories real: `mkdirp` writes a `${dir}/` marker key (trailing slash denotes a directory; `readDirEntries` already yields `{name, isDir:true}` for it since `rest` ends in `/`), and guard `readDirNames` against the empty tail (`if (rest) names.add(rest.split('/')[0])`). Then implement:
```ts
async mkdirp(dir) {
  const d = normalize(dir).replace(/\/+$/, '');
  // Directories are implicit via file prefixes; an explicit (possibly empty)
  // directory is a trailing-slash marker key so the tree can list it.
  if (d && !fs.list().some((p) => p === `${d}/` || p.startsWith(`${d}/`))) fs.write(`${d}/`, '');
},
async renameEntry(oldPath, newPath) {
  const from = normalize(oldPath).replace(/\/+$/, '');
  const to = normalize(newPath).replace(/\/+$/, '');
  let moved = false;
  for (const p of fs.list()) {
    if (p === from || p.startsWith(`${from}/`)) {
      const content = fs.read(p)!;
      fs.remove(p);
      fs.write(p === from ? to : to + p.slice(from.length), content);
      moved = true;
    }
  }
  if (!moved) throw new Error(`ENOENT: ${oldPath}`);
},
async trashEntry(path) {
  const target = normalize(path).replace(/\/+$/, '');
  for (const p of fs.list()) if (p === target || p.startsWith(`${target}/`)) fs.remove(p);
  (window.__mmTrash ??= []).push(path);
},
async revealPath(path) {
  (window.__mmReveals ??= []).push(path);
},
async copyText(text) {
  (window.__mmClipboard ??= []).push(text);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* headless/e2e without clipboard permission — the record above is the seam */
  }
},
```
- [ ] **Step 3: tauri.ts** — add:
```ts
renameEntry: (oldPath, newPath) => fsp.rename(oldPath, newPath),
async trashEntry(path) {
  await invoke('trash_entry', { path });
},
async revealPath(path) {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
},
async copyText(text) {
  await navigator.clipboard.writeText(text);
},
```
- [ ] **Step 4: Rust.** `Cargo.toml` dependencies: add `trash = "5"`. `lib.rs`: add
```rust
/// SPEC35 §1: move a file or directory (recursively) to the OS Trash.
#[tauri::command]
fn trash_entry(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}
```
and register: `generate_handler![take_pending_open_files, print_view, trash_entry]`.
- [ ] **Step 5: capabilities/default.json** — add `"fs:allow-rename"` to the fs block and the reveal permission (check `src-tauri/gen/schemas/desktop-schema.json` for whether it takes a scope; expected shape `{ "identifier": "opener:allow-reveal-item-in-dir", "allow": [{ "path": "**" }] }`, else the plain string).
- [ ] **Step 6: Verify** — `npm run typecheck` PASS; `cargo check` in `src-tauri/` PASS (validates capabilities too); `npx vitest run` PASS; **full desktop e2e** `npx playwright test` PASS (guards the shim `mkdirp`/`readDirNames` change against regressions; check port 4923 first).
- [ ] **Step 7: Commit** `feat: SPEC35 platform seams — renameEntry/trashEntry/revealPath/copyText (+trash crate command, rename/reveal permissions)`

### Task 3: Context menu — FolderPanel UI + App wiring for reveal/copy + E96

**Files:**
- Modify: `src/components/FolderPanel.tsx`, `src/App.tsx` (mount + one dispatcher), `src/styles.css`
- Test: append E96 to `tests/e2e/app.spec.ts`

**Interfaces (produced, consumed by Tasks 4–6):** new `FolderPanelProps` members:
```ts
dirname(path: string): string;
isMac: boolean;
caps: { canReveal: boolean; canTrash: boolean; canRename: boolean; canCopy: boolean };
renamingPath: string | null;   // Task 4 drives; wire now, pass null
renameError: string | null;    // Task 4 drives; wire now, pass null
onMenuAction(id: string, target: { kind: 'dir' | 'file' | 'root'; path: string }): void;
onRenameCommit(oldPath: string, newName: string): void;  // Task 4
onRenameCancel(): void;                                   // Task 4
```

- [ ] **Step 1: Write E96** (append after E95). Setup: `seedFolders`, `Control+Shift+E`, `nextFolderPath='/notes'`, `folder-open-btn`. Assertions:
  - `menuIds()` helper: `page.$$eval('[data-testid="folder-menu"] [data-testid^="folder-menu-"]', els => els.map(e => e.getAttribute('data-testid')!.replace('folder-menu-','')))`.
  - Right-click `/notes/sub` ⇒ `['new-file','new-folder','rename','delete','reveal','copy-path','copy-relative-path']`; Esc dismisses (`folder-menu` count 0).
  - Right-click `/notes/a.md` ⇒ `['reveal','rename','delete','copy-path','copy-relative-path']`; outside pointer-down (click `folder-header`) dismisses.
  - `folder-filter` click, right-click dim `/notes/pic.png` ⇒ same file set; Esc.
  - Right-click `.folder-list` empty area (`position: {x: 60, y: 400}`) ⇒ `['new-file','new-folder','reveal','copy-path']`; Esc.
  - Left click on `/notes/a.md` never opens the menu (menu count 0; doc opens as before).
  - Expand `sub`; right-click `/notes/sub/b.md` → `folder-menu-copy-path` ⇒ `window.__mmClipboard` `['/notes/sub/b.md']`; again → `copy-relative-path` ⇒ `[...,'sub/b.md']`.
  - Right-click `/notes/a.md` → `folder-menu-reveal` ⇒ `window.__mmReveals` `['/notes/a.md']`.
- [ ] **Step 2:** `npx playwright test -g "E96"` — FAIL (no menu).
- [ ] **Step 3: FolderPanel implementation.**
  - Remove `disabled={!md}` from dim file rows (keep `onClick` only when `md`; disabled buttons swallow `contextmenu`). Check `styles.css` for `.folder-item:disabled` rules — if any, duplicate them under `.folder-item-dim` so E93's dim look survives.
  - Panel root div: `onContextMenu={(e) => e.preventDefault()}` (suppresses the native menu everywhere in the panel).
  - Row buttons (dir + file): `onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: isDirRow ? 'dir' : 'file', path, x: e.clientX, y: e.clientY }); }}`.
  - `.folder-list`: `onContextMenu` that (when the target is not inside a `[data-path]` row) opens the `root` menu with `path: p.root` — only rendered when root is set, so the "only when a root is set" rule holds; `folder-empty` (no root) is covered by the panel-level preventDefault.
  - Menu state `useState<{kind, path, x, y} | null>`; render inside the panel:
```tsx
{menu && (
  <div className="theme-menu folder-menu" data-testid="folder-menu" ref={menuRef}
       style={{ left: menu.x, top: menu.y }}>
    {folderContextMenu(menu.kind, { isMac: p.isMac, ...p.caps }).map((it, i) =>
      it === 'sep' ? (
        <div key={`sep-${i}`} className="folder-menu-sep" />
      ) : (
        <button key={it.id} className="theme-option" data-testid={`folder-menu-${it.id}`}
          onClick={() => { const m = menu; setMenu(null); p.onMenuAction(it.id, { kind: m.kind, path: m.path }); }}>
          <span>{it.label}</span>
        </button>
      )
    )}
  </div>
)}
```
  - Clamp to viewport in a `useLayoutEffect` on `[menu]`: measure `menuRef.getBoundingClientRect()`, set `el.style.left/top` to `max(4, min(menu.x, innerWidth - w - 4))` etc.
  - Dismissal `useEffect` on `[menu]` (no-op when null): document `pointerdown` (close unless inside `menuRef`), document `keydown` Escape (close, `stopPropagation`), `window scroll` (capture: true — catches `.folder-list`), `window resize`. Clean up all on close.
- [ ] **Step 4: styles.css** — `.folder-menu { position: fixed; z-index: 60; right: auto; }` (overrides the `.theme-menu` anchored positioning; match existing z-index conventions) and `.folder-menu-sep { height: 1px; margin: 4px 0; background: <the theme border var used by .theme-menu>; }` (copy the exact var from the existing menu styles).
- [ ] **Step 5: App wiring.** Pass the new props at the FolderPanel mount (:2371): `dirname={platform.dirname}`, `isMac={platform.isMac}`, `caps={{ canReveal: !!platform.revealPath, canTrash: !!platform.trashEntry, canRename: !!platform.renameEntry, canCopy: !!platform.copyText }}`, `renamingPath={null}` `renameError={null}` (Task 4 replaces), and `onMenuAction={folderMenuAction}` with the dispatcher (rename/delete/new-* cases land in Tasks 4–6; wire reveal/copy now):
```ts
const folderMenuAction = useCallback((id: string, target: { kind: 'dir' | 'file' | 'root'; path: string }) => {
  const p = stateRef.current.platform;
  if (!p) return;
  const root = folderStateRef.current.root;
  if (id === 'reveal') void p.revealPath?.(target.path);
  else if (id === 'copy-path') void p.copyText?.(target.path);
  else if (id === 'copy-relative-path' && root) void p.copyText?.(relativePath(root, target.path));
  // 'new-file' | 'new-folder' | 'rename' | 'delete' → Tasks 4–6
}, []);
```
- [ ] **Step 6:** `npx playwright test -g "E96"` — PASS. Then `npx playwright test -g "E93|E94|E95"` — PASS (dim-row un-disable + panel handlers must not regress). `npm run typecheck` PASS.
- [ ] **Step 7: Commit** `feat: folder sidebar context menu — per-kind items, dismissal, copy/reveal (E96)`

### Task 4: Rename in place — input, validation, remap + E98

**Files:**
- Modify: `src/components/FolderPanel.tsx` (RenameRow), `src/App.tsx`, `src/styles.css` (`.invalid`)
- Test: insert E98 after E97's future position (append; keep numeric order in file)

**Interfaces (produced, consumed by Task 5):** App: `startFolderRename(session: { path: string; openOnDone: boolean } | null)`, `folderRenameCommit(oldPath, newName)`, `folderRenameCancel()`, `remapAfterRename(p, oldPath, newPath)`, `installWatcher(p, path)` (extracted from `openDoc`).

- [ ] **Step 1: Write E98** (see SPEC35 §9.4). Setup: seed, open panel+root, expand `sub`, open `/notes/sub/b.md`, dirty it (edit mode, type `DIRTY `, back to preview). Then:
  - Menu → Rename on the row: input `folder-rename-input` value `b.md`; typing `renamed` replaces the selected stem ⇒ value `renamed.md`; Enter commits.
  - Assert: `docname` shows `renamed.md`; `page.title()` contains `renamed.md •` (dirty dot intact); row `/notes/sub/renamed.md` has `selected`; `fsRead('/notes/sub/b.md')` null; `fsRead('/notes/sub/renamed.md')` = the seeded content (buffer NOT saved yet); `/config/recent.json` contains the new path, not the old.
  - `Control+s` ⇒ `fsRead('/notes/sub/renamed.md')` contains `DIRTY`; old path stays null; title dot clears.
  - Menu → Rename on directory `/notes/sub`: input value `sub` fully selected; type `stuff`, Enter ⇒ row `/notes/stuff/renamed.md` visible (still expanded), `docname` still `renamed.md`, row still `selected`, `foldertree.json` contains `/notes/stuff`, `⌘S`-path… assert `recent.json` contains `/notes/stuff/renamed.md`.
  - Collision: Rename `/notes/a.md`, `fill('stuff')` (case-insensitive vs the sibling dir — also try `STUFF`) ⇒ input has class `invalid`; Enter refuses (input closes, row `a.md` still there, `fsRead('/notes/a.md')` unchanged).
  - Reserved: Rename `/notes/a.md`, `fill('con.md')` ⇒ `invalid` + `title` matching /reserved/i; Escape restores the label.
- [ ] **Step 2:** `npx playwright test -g "E98"` — FAIL.
- [ ] **Step 3: FolderPanel `RenameRow`.** In `Rows`, before rendering a dir/file row: `if (p.renamingPath === path) return <RenameRow key={path} p={p} dir={dir} entry={e} depth={depth} />;` (for a renaming dir, also keep rendering its children below if expanded — mirror the dir branch structure).
```tsx
function RenameRow({ p, dir, entry, depth }: { p: FolderPanelProps; dir: string; entry: DirEntry; depth: number }) {
  const path = p.join(dir, entry.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [value, setValue] = useState(entry.name);
  const siblings = (p.children[dir] ?? [])
    .map((s) => s.name)
    .filter((n) => n.toLowerCase() !== entry.name.toLowerCase());
  const error =
    validateEntryName(value) ??
    (siblings.some((n) => n.toLowerCase() === value.toLowerCase()) ? 'Already exists here' : null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (entry.isDir) el.select();
    else el.setSelectionRange(0, entry.name.replace(/\.[^.]+$/, '').length);
  }, []);
  useEffect(() => {
    if (p.renameError) doneRef.current = false; // commit failed — the input lives on
  }, [p.renameError]);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (!commit || error || value === entry.name) p.onRenameCancel();
    else p.onRenameCommit(path, value);
  };
  return (
    <div className="folder-item folder-rename" style={{ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties}>
      <input
        ref={inputRef}
        data-testid="folder-rename-input"
        className={error ? 'invalid' : undefined}
        title={p.renameError ?? error ?? undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}
```
  (`e.stopPropagation()` on keydown keeps global hotkeys/vim-nav inert for the row.) Wire `renamingPath={folderRenaming?.path ?? null}` `renameError={folderRenameError}` `onRenameCommit={folderRenameCommit}` `onRenameCancel={folderRenameCancel}` at the mount.
- [ ] **Step 4: App implementation.**
  - Extract `installWatcher(p, path)` from `openDoc`'s watcher block (:779-797) verbatim into a `useCallback([loadDocParts])`; `openDoc` calls it.
  - State + mirror ref:
```ts
const [folderRenaming, setFolderRenaming] = useState<{ path: string; openOnDone: boolean } | null>(null);
const [folderRenameError, setFolderRenameError] = useState<string | null>(null);
const folderRenamingRef = useRef<typeof folderRenaming>(null);
const startFolderRename = useCallback((s: { path: string; openOnDone: boolean } | null) => {
  folderRenamingRef.current = s;
  setFolderRenaming(s);
  setFolderRenameError(null);
}, []);
```
  - `folderMenuAction` gains: `else if (id === 'rename') startFolderRename({ path: target.path, openOnDone: false });`
  - Commit / cancel / remap:
```ts
const remapAfterRename = useCallback((p: Platform, oldPath: string, newPath: string) => {
  const remap = (s: string) => remapPath(s, oldPath, newPath);
  const s = stateRef.current;
  const newDoc = s.docPath ? remap(s.docPath) : null;
  if (newDoc) {
    setDocPath(newDoc); // title follows its effect; buffer/dirty/undo/comments untouched
    void installWatcher(p, newDoc);
  }
  setFolderExpanded((prev) => {
    const next = new Set([...prev].map((d) => remap(d) ?? d));
    folderStateRef.current = { ...folderStateRef.current, expanded: next };
    return next;
  });
  setFolderChildren((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [remap(k) ?? k, v])));
  persistFolderState(p);
  const entries = recentRef.current.entries.map((en) => ({ ...en, path: remap(en.path) ?? en.path }));
  commitRecent({ ...recentRef.current, entries }, p); // same MRU positions
}, [installWatcher, persistFolderState, commitRecent]);

const folderRenameCommit = useCallback(async (oldPath: string, newName: string) => {
  const p = stateRef.current.platform;
  if (!p?.renameEntry) return;
  const session = folderRenamingRef.current;
  const parent = p.dirname(oldPath);
  const newPath = p.join(parent, newName);
  try {
    await p.renameEntry(oldPath, newPath);
  } catch (e) {
    setFolderRenameError(e instanceof Error ? e.message : String(e)); // input stays open (§5.4)
    return;
  }
  startFolderRename(null);
  await listFolderDir(p, parent);
  remapAfterRename(p, oldPath, newPath);
  if (session?.openOnDone && isMarkdownFile(p.basename(newPath))) openDocGuarded(p, newPath);
}, [startFolderRename, listFolderDir, remapAfterRename, openDocGuarded]);

const folderRenameCancel = useCallback(() => {
  const p = stateRef.current.platform;
  const session = folderRenamingRef.current;
  startFolderRename(null);
  if (p && session?.openOnDone && isMarkdownFile(p.basename(session.path))) openDocGuarded(p, session.path);
}, [startFolderRename, openDocGuarded]);
```
- [ ] **Step 5: styles.css** — `.folder-rename input { … }` sized like a row label; `.folder-rename input.invalid { outline: 1px solid <the theme error/danger var, or #d33 fallback matching existing conventions>; }`.
- [ ] **Step 6:** `npx playwright test -g "E98"` PASS; `-g "E93|E94|E95|E96"` PASS; `npm run typecheck` PASS.
- [ ] **Step 7: Commit** `feat: in-place rename with full state remap (E98)`

### Task 5: Create — New File / New Folder + E97

**Files:**
- Modify: `src/App.tsx`
- Test: insert E97 between E96 and E98 in `tests/e2e/app.spec.ts`

- [ ] **Step 1: Write E97.** Setup: seed, panel+root `/notes`, expand `sub`. Then:
  - Menu on `/notes/sub` → New File: `fsRead('/notes/sub/Untitled.md')` is `''`; `folder-rename-input` visible with value `Untitled.md`; Escape ⇒ keeps the name and OPENS it (`docname` shows `Untitled.md`).
  - Menu on `/notes/sub` → New File again: input value `Untitled 2.md` (numbered before the extension); the stem is preselected — `page.keyboard.type('story')` ⇒ value `story.md`; Enter ⇒ commits, `fsRead('/notes/sub/story.md')` is `''`, old placeholder gone, doc OPENS (`docname` `story.md`, row `selected`).
  - Menu on `/notes/sub` → New Folder: input value `New Folder` fully selected; type `drafts`, Enter ⇒ row `/notes/sub/drafts` visible (a dir, collapsed), `docname` still `story.md` (nothing opened).
  - Empty-area menu (right-click `.folder-list` at `{x:60,y:400}`) → New File targets the ROOT: input `Untitled.md`, Enter (unchanged ⇒ cancel path) ⇒ `/notes/Untitled.md` exists and opens.
- [ ] **Step 2:** `npx playwright test -g "E97"` — FAIL.
- [ ] **Step 3: App `folderCreate`:**
```ts
const folderCreate = useCallback(async (p: Platform, dir: string, kind: 'file' | 'dir') => {
  if (!p.readDirEntries) return;
  try {
    const listing = await p.readDirEntries(dir);
    const name = uniqueChildName(listing.map((e) => e.name), kind === 'file' ? 'Untitled.md' : 'New Folder');
    const path = p.join(dir, name);
    if (kind === 'file') await p.writeTextFile(path, '');
    else await p.mkdirp(path);
    setFolderExpanded((prev) => {
      const next = new Set(prev);
      next.add(dir); // the target directory opens; a new folder itself stays collapsed
      folderStateRef.current = { ...folderStateRef.current, expanded: next };
      return next;
    });
    persistFolderState(p);
    await listFolderDir(p, dir);
    startFolderRename({ path, openOnDone: kind === 'file' });
  } catch {
    /* creation failed — no row to rename */
  }
}, [persistFolderState, listFolderDir, startFolderRename]);
```
  `folderMenuAction` gains: `else if (id === 'new-file') void folderCreate(p, target.path, 'file'); else if (id === 'new-folder') void folderCreate(p, target.path, 'dir');` (for the `root` kind, `target.path` IS the root — Task 3 set that).
  Note the open-after-rename flow (commit AND cancel) plus the unsaved-changes guard is already Task 4's `openOnDone` handling; `openDocGuarded` gives the guard (cancel leaves the file created but unopened — SPEC35 §4.2).
- [ ] **Step 4:** `npx playwright test -g "E97"` PASS; `-g "E9[3-8]"` PASS; typecheck PASS.
- [ ] **Step 5: Commit** `feat: New File / New Folder from the sidebar menu, inline-rename handoff (E97)`

### Task 6: Delete — confirm modal, trash, prune, close-to-splash + E99

**Files:**
- Modify: `src/App.tsx`
- Test: append E99 after E98

- [ ] **Step 1: Write E99.** Setup: seed, panel+root, `folder-filter` (show all). Then:
  - Cancel no-op: menu-delete `/notes/zzz.txt` ⇒ `folder-delete-prompt` visible with text `Move “zzz.txt” to the Trash?`; `folder-delete-cancel` ⇒ prompt gone, row alive, `window.__mmTrash ?? []` empty.
  - Dim file: menu-delete `/notes/pic.png` → `folder-delete-confirm` ⇒ row gone, `__mmTrash` `['/notes/pic.png']`.
  - Open dirty file: expand `sub`, open `b.md`, dirty it, wait `expect.poll(fsRead('/config/draft.json'))` to contain `/notes/sub/b.md` (draft debounce ~2 s; poll timeout ≥ 5 s). Menu-delete `b.md`: prompt text ends `It has unsaved changes.`; Confirm ⇒ splash (`empty-hint` visible), `.folder-item.selected` count 0, `recent.json` no longer contains the path, `draft.json` gone (null), `__mmTrash` gained the path.
  - Directory with open doc: expand `sub`→`deep` (re-seed paths as needed: the earlier deletion removed `b.md`; use `/notes/sub/deep/c.md`), open `c.md` (clean). Menu-delete `/notes/sub`: prompt `Move “sub” and its contents to the Trash?` (no unsaved sentence); Confirm ⇒ splash, rows under `/notes/sub` gone, `foldertree.json` no longer contains `/notes/sub`, `recent.json` no `c.md`, `__mmTrash` gained `/notes/sub`.
  - Esc closes the prompt (bonus of the modal keydown): open one more delete prompt, `Escape` ⇒ gone, no-op.
- [ ] **Step 2:** `npx playwright test -g "E99"` — FAIL.
- [ ] **Step 3: App implementation.**
  - State: `const [folderDeletePrompt, setFolderDeletePrompt] = useState<{ path: string; isDir: boolean } | null>(null);`
  - `folderMenuAction` gains: `else if (id === 'delete') setFolderDeletePrompt({ path: target.path, isDir: target.kind === 'dir' });`
  - `closeToSplash` — `startUntitled` (:1192) mirrored, but `untitled=false`, `mode='preview'`, plus draft discard:
```ts
const closeToSplash = useCallback(() => {
  skipSaveRef.current = true;
  editorHistoryRef.current = null;
  pendingEditorSelRef.current = null;
  pendingPreviewSelRef.current = null;
  lastEditorSelRef.current = { from: 0, to: 0 };
  setFmOverride(null);
  setFindOpen(false);
  setFindQuery('');
  setFindDebounced('');
  setDocPath(null);
  setUntitled(false);
  setBuffer('');
  setSavedText('');
  setHtml('');
  setComments([]);
  setPositions({});
  setActiveId(null);
  setPending(null);
  setMode('preview');
  setShowDiff(false);
  setDiff(null);
  unwatchRef.current?.();
  unwatchRef.current = null;
  void deleteDraft(); // SPEC35 §6.3: the deleted doc's crash draft goes with it
}, [deleteDraft]);
```
  - Runner:
```ts
const folderDeleteRun = useCallback(async (target: { path: string; isDir: boolean }) => {
  const p = stateRef.current.platform;
  if (!p?.trashEntry) return;
  try {
    await p.trashEntry(target.path);
  } catch {
    return; /* fs error — tree untouched */
  }
  const within = (s: string) => remapPath(s, target.path, target.path) !== null;
  await listFolderDir(p, p.dirname(target.path));
  setFolderExpanded((prev) => {
    const next = new Set([...prev].filter((d) => !within(d)));
    folderStateRef.current = { ...folderStateRef.current, expanded: next };
    return next;
  });
  setFolderChildren((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !within(k))));
  persistFolderState(p);
  commitRecent({ ...recentRef.current, entries: recentRef.current.entries.filter((en) => !within(en.path)) }, p);
  const s = stateRef.current;
  if (s.docPath && within(s.docPath)) closeToSplash(); // reading-position entry: existing pruning rules
}, [listFolderDir, persistFolderState, commitRecent, closeToSplash]);
```
  - Modal (next to `open-prompt`, same `.overlay`/`.modal` structure; Enter = confirm via `autoFocus` on the primary button; Esc = cancel via `onKeyDown` on the modal div):
```tsx
{folderDeletePrompt && (
  <div className="overlay">
    <div
      className="modal"
      data-testid="folder-delete-prompt"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setFolderDeletePrompt(null);
      }}
    >
      <h2>Move to Trash</h2>
      <p style={{ fontSize: 13.5 }}>
        Move “{platform.basename(folderDeletePrompt.path)}”{folderDeletePrompt.isDir ? ' and its contents' : ''} to
        the Trash?
        {dirty && docPath && remapPath(docPath, folderDeletePrompt.path, folderDeletePrompt.path) !== null
          ? ' It has unsaved changes.'
          : ''}
      </p>
      <div className="actions">
        <button data-testid="folder-delete-cancel" onClick={() => setFolderDeletePrompt(null)}>
          Cancel
        </button>
        <button
          className="primary"
          data-testid="folder-delete-confirm"
          autoFocus
          onClick={() => {
            const target = folderDeletePrompt;
            setFolderDeletePrompt(null);
            void folderDeleteRun(target);
          }}
        >
          Move to Trash
        </button>
      </div>
    </div>
  </div>
)}
```
- [ ] **Step 4:** `npx playwright test -g "E99"` PASS; full desktop e2e `npx playwright test` PASS; typecheck; `npx vitest run` PASS.
- [ ] **Step 5: Commit** `feat: delete to Trash with confirm, prune, close-to-splash (E99)`

### Task 7: Docs + full gate

**Files:**
- Modify: `README.md` (Folders bullet block, ~:82-86), `docs/ARCHITECTURE.md` (after the SPEC34 folder-sidebar section, ~:536)

- [ ] **Step 1: README** — extend the folder-sidebar bullet (or add a sibling bullet under it): right-click file management — create, rename in place, delete to the Trash, Reveal in Finder/File Explorer, copy (relative) path — with the open document following renames.
- [ ] **Step 2: ARCHITECTURE.md** — add a short "File management (SPEC35)" subsection after the SPEC34 section: the four optional seams (`renameEntry` = plugin-fs rename; `trashEntry` = one Rust command on the `trash` crate; `revealPath` = plugin-opener `revealItemInDir`; `copyText` = clipboard, shim-recorded), `folderOps.ts` as the pure menu/validation/remap module, and the remap-on-rename / prune-on-delete rules (docPath+watcher+title, expanded set, recents MRU, foldertree.json persisted; delete prunes and closes to the splash, discarding the crash draft).
- [ ] **Step 3: Gate evidence** (ports first: `lsof -iTCP:4923 -sTCP:LISTEN; lsof -iTCP:1420 -sTCP:LISTEN`):
  - `npm run validate` → exits 0, full output, final `VALIDATION: ALL PASSED`.
  - `git diff main...HEAD --stat -- src-tauri/` → only Cargo.toml/Cargo.lock (trash), lib.rs (command+registration), capabilities/default.json (two permissions).
  - `git diff --stat docs/specs` → empty.
  - `grep -rEn "\.(skip|only|todo)\(" tests/` → nothing.
  - Reserved-name scan (Global Constraints) → nothing.
  - Version check: `grep version package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml` → 0.4.0-alpha.1.
- [ ] **Step 4: Commit** `docs: README file-management bullet + ARCHITECTURE seams and remap rules`

## Risks / verifications baked in

- Shim `mkdirp` now writes `dir/` marker keys (needed so a new empty folder exists and lists) — full e2e re-run in Task 2 guards every existing test against this.
- Dim rows lose the `disabled` attribute (disabled buttons swallow `contextmenu`) — E93 click-inertness re-verified in Task 3; CSS parity checked.
- `opener:allow-reveal-item-in-dir` scope shape confirmed against `src-tauri/gen/schemas/desktop-schema.json`; `cargo check` validates.
- Clipboard writes wrapped in try/catch in the shim so headless e2e (consoleGuard: zero console errors) stays green; `__mmClipboard` is the assertion seam.
- Deleting/renaming the open doc: watcher torn down/reinstalled via the extracted `installWatcher`; the shim watcher's ENOENT reload attempt is already caught inside the watcher body.
