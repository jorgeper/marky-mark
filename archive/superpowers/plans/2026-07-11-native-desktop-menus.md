# Native Desktop Menus + Chromeless Window (SPEC12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-app header on desktop with native OS menus (macOS system menu bar, Windows in-window menu bar) and the window title; web build unchanged.

**Architecture:** A pure `buildMenuSpec(state)` produces a serializable menu structure; a named-command registry (`commands.ts`) is the single dispatch point shared by the DOM toolbar (web), the native menu (Tauri), and hotkeys. `Platform.setAppMenu?` is the seam: `tauri.ts` converts the spec to `@tauri-apps/api/menu` objects; `browser.ts` records it on `window.__mmMenu` under `?nativeMenu=1` for e2e. Header renders iff `setAppMenu` is undefined.

**Tech Stack:** React 18, TypeScript, Tauri v2 (`@tauri-apps/api` ^2.5.0 — menu API included, no new deps), Vitest, Playwright.

## Global Constraints (from SPEC12 / the goal condition)

- Only permitted test additions: **U19–U21, E47–E50**. No existing test modified, weakened, skipped, or deleted. E42–E44 stay reserved.
- No new runtime dependencies. Version files untouched. Spec files untouched.
- No CSP change in `src-tauri/tauri.conf.json`; capabilities gain only `core:menu` permissions.
- Web build behavior identical (W1–W5 unchanged); `autoHideToolbar` key keeps parsing/serializing.
- Each hotkey combo bound to a menu item fires exactly once per keypress on desktop.
- Done = `npm run validate` prints U1–U21, E1–E41 + E45–E50, W1–W5, single-file check, bundle scan, `VALIDATION: ALL PASSED`; `npm run tauri build` (macOS) exits 0.

---

### Task 1: `commands.ts` registry + `menuSpec.ts` + U19–U21

**Files:**
- Create: `src/lib/commands.ts`
- Create: `src/lib/menuSpec.ts`
- Test: `tests/unit/menu-spec.test.ts`

**Interfaces:**
- Produces: `CommandId`, `registerCommands(handlers)`, `dispatchCommand(id, source)` from `commands.ts`; `buildMenuSpec(state): MenuSpec`, `MenuSpec`/`SubmenuSpec`/`MenuItemSpec`/`CommandItemSpec`/`PredefinedItemSpec`, `MenuState` from `menuSpec.ts`.

- [x] **Step 1: Write the failing tests** — `tests/unit/menu-spec.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildMenuSpec, type CommandItemSpec, type MenuState } from '../../src/lib/menuSpec';
import { DEFAULT_HOTKEYS } from '../../src/lib/hotkeys';

const base: MenuState = {
  isMac: true,
  mode: 'preview',
  showComments: true,
  commentsEnabled: true,
  commentCount: 0,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

const titles = (s: MenuState) => buildMenuSpec(s).submenus.map((m) => m.title);
const commandsIn = (s: MenuState, title: string) =>
  buildMenuSpec(s)
    .submenus.find((m) => m.title === title)!
    .items.filter((i): i is CommandItemSpec => i.type === 'command');
const find = (s: MenuState, title: string, command: string) =>
  commandsIn(s, title).find((i) => i.command === command);

describe('SPEC12 menu spec', () => {
  test('U19: macOS layout — app menu holds About/Settings/Quit; File has Open/Save/Save As/Close; Window present; Help has no About', () => {
    expect(titles(base)).toEqual(['Marky Mark', 'File', 'Edit', 'View', 'Window', 'Help']);
    const app = commandsIn(base, 'Marky Mark').map((i) => i.command);
    expect(app).toEqual(['about', 'settings', 'close']);
    expect(find(base, 'Marky Mark', 'settings')!.accelerator).toBe('Mod+,');
    expect(find(base, 'Marky Mark', 'close')!.label).toBe('Quit Marky Mark');
    const file = commandsIn(base, 'File').map((i) => i.command);
    expect(file).toEqual(['open', 'save', 'saveAs', 'close']);
    expect(find(base, 'File', 'close')!.label).toBe('Close Window');
    expect(commandsIn(base, 'Help').map((i) => i.command)).toEqual(['help']);
    // Edit is entirely predefined system items
    const edit = buildMenuSpec(base).submenus.find((m) => m.title === 'Edit')!;
    expect(edit.items.every((i) => i.type === 'predefined')).toBe(true);
    const editKinds = edit.items.filter((i) => i.type === 'predefined' && i.item !== 'Separator').map((i) => (i.type === 'predefined' ? i.item : ''));
    expect(editKinds).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'SelectAll']);
    // View ends with Full Screen on mac
    const view = buildMenuSpec(base).submenus.find((m) => m.title === 'View')!;
    expect(view.items.some((i) => i.type === 'predefined' && i.item === 'Fullscreen')).toBe(true);
  });

  test('U20: Windows layout — File carries Settings and Exit; Help carries About; no app/Window menu; no Full Screen', () => {
    const win = { ...base, isMac: false };
    expect(titles(win)).toEqual(['File', 'Edit', 'View', 'Help']);
    const file = commandsIn(win, 'File').map((i) => i.command);
    expect(file).toEqual(['open', 'save', 'saveAs', 'settings', 'close']);
    expect(find(win, 'File', 'close')!.label).toBe('Exit');
    expect(commandsIn(win, 'Help').map((i) => i.command)).toEqual(['help', 'about']);
    const view = buildMenuSpec(win).submenus.find((m) => m.title === 'View')!;
    expect(view.items.some((i) => i.type === 'predefined' && i.item === 'Fullscreen')).toBe(false);
  });

  test('U21: dynamics — checkmarks follow state, live count, comments item vanishes with the master switch, rebinding moves one accelerator', () => {
    expect(find(base, 'View', 'toggleMode')!.checked).toBe(false);
    expect(find({ ...base, mode: 'edit' }, 'View', 'toggleMode')!.checked).toBe(true);
    expect(find(base, 'View', 'toggleComments')!.checked).toBe(true);
    expect(find({ ...base, showComments: false }, 'View', 'toggleComments')!.checked).toBe(false);
    expect(find(base, 'View', 'toggleComments')!.label).toBe('Comments');
    expect(find({ ...base, commentCount: 3 }, 'View', 'toggleComments')!.label).toBe('Comments (3)');
    expect(find({ ...base, commentsEnabled: false }, 'View', 'toggleComments')).toBeUndefined();
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, save: 'Mod+K' } };
    expect(find(rebound, 'File', 'save')!.accelerator).toBe('Mod+K');
    expect(find(rebound, 'File', 'open')!.accelerator).toBe(DEFAULT_HOTKEYS.openFile);
    expect(find(rebound, 'View', 'toggleMode')!.accelerator).toBe(DEFAULT_HOTKEYS.toggleEdit);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/menu-spec.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/menuSpec`.

- [x] **Step 3: Implement** — `src/lib/commands.ts`:

```ts
/**
 * Named-command registry (SPEC12 §3.1): every user action has one command id;
 * the DOM toolbar (web), the native menu (desktop), and the hotkey listener
 * all dispatch through here. One source of truth — no duplicated handlers.
 */

export type CommandId =
  | 'open'
  | 'save'
  | 'saveAs'
  | 'toggleMode'
  | 'toggleComments'
  | 'settings'
  | 'help'
  | 'about'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'close';

export type CommandHandlers = Record<CommandId, () => void>;
export type CommandSource = 'menu' | 'hotkey' | 'ui';

let handlers: Partial<CommandHandlers> = {};
let last: { id: CommandId; source: CommandSource; at: number } | null = null;

/**
 * Exactly-once window (SPEC12 §1.3): when a combo is both a native menu
 * accelerator and an in-app hotkey, whichever path the OS delivers first wins
 * and the other is swallowed. Same-source repeats (key auto-repeat) pass.
 */
const CROSS_SOURCE_DEDUP_MS = 150;

export function registerCommands(h: CommandHandlers): void {
  handlers = h;
}

export function dispatchCommand(id: CommandId, source: CommandSource = 'ui'): void {
  const now = performance.now();
  if (last && last.id === id && last.source !== source && now - last.at < CROSS_SOURCE_DEDUP_MS) {
    last = { id, source, at: now };
    return;
  }
  last = { id, source, at: now };
  handlers[id]?.();
}
```

`src/lib/menuSpec.ts`:

```ts
import type { CommandId } from './commands';
import type { HotkeyMap } from './hotkeys';

/**
 * Pure menu description (SPEC12 §3.2): buildMenuSpec(state) → plain data.
 * No Tauri imports — the platform layer turns this into real native menus,
 * the browser shim records it for e2e, unit tests assert on it directly.
 * Accelerators are canonical combo strings ("Mod+E"); the platform converts.
 */

export type PredefinedItem =
  | 'Separator'
  | 'Undo'
  | 'Redo'
  | 'Cut'
  | 'Copy'
  | 'Paste'
  | 'SelectAll'
  | 'Minimize'
  | 'Maximize'
  | 'Fullscreen'
  | 'Hide'
  | 'HideOthers'
  | 'ShowAll'
  | 'Services'
  | 'BringAllToFront';

export interface CommandItemSpec {
  type: 'command';
  command: CommandId;
  label: string;
  accelerator?: string;
  /** Present ⇒ checkbox item. */
  checked?: boolean;
}

export interface PredefinedItemSpec {
  type: 'predefined';
  item: PredefinedItem;
  /** Optional label override (e.g. macOS calls Maximize "Zoom"). */
  label?: string;
}

export type MenuItemSpec = CommandItemSpec | PredefinedItemSpec;

export interface SubmenuSpec {
  title: string;
  items: MenuItemSpec[];
}

export interface MenuSpec {
  submenus: SubmenuSpec[];
}

export interface MenuState {
  isMac: boolean;
  mode: 'preview' | 'edit';
  showComments: boolean;
  commentsEnabled: boolean;
  commentCount: number;
  hotkeys: HotkeyMap;
}

const sep: PredefinedItemSpec = { type: 'predefined', item: 'Separator' };
const pre = (item: PredefinedItem, label?: string): PredefinedItemSpec =>
  label ? { type: 'predefined', item, label } : { type: 'predefined', item };
const cmd = (command: CommandId, label: string, accelerator?: string, checked?: boolean): CommandItemSpec => ({
  type: 'command',
  command,
  label,
  ...(accelerator ? { accelerator } : {}),
  ...(checked !== undefined ? { checked } : {}),
});

export function buildMenuSpec(s: MenuState): MenuSpec {
  const editMenu: SubmenuSpec = {
    title: 'Edit',
    items: [pre('Undo'), pre('Redo'), sep, pre('Cut'), pre('Copy'), pre('Paste'), pre('SelectAll')],
  };

  const viewMenu: SubmenuSpec = {
    title: 'View',
    items: [
      cmd('toggleMode', 'Edit Mode', s.hotkeys.toggleEdit, s.mode === 'edit'),
      ...(s.commentsEnabled
        ? [
            cmd(
              'toggleComments',
              s.commentCount > 0 ? `Comments (${s.commentCount})` : 'Comments',
              s.hotkeys.toggleComments,
              s.showComments
            ),
          ]
        : []),
      sep,
      cmd('zoomIn', 'Zoom In', 'Mod+='),
      cmd('zoomOut', 'Zoom Out', 'Mod+-'),
      cmd('zoomReset', 'Actual Size', 'Mod+0'),
      ...(s.isMac ? [sep, pre('Fullscreen')] : []),
    ],
  };

  const helpItem = cmd('help', 'Marky Mark Help');

  if (s.isMac) {
    return {
      submenus: [
        {
          title: 'Marky Mark',
          items: [
            cmd('about', 'About Marky Mark'),
            sep,
            cmd('settings', 'Settings…', 'Mod+,'),
            sep,
            pre('Services'),
            sep,
            pre('Hide'),
            pre('HideOthers'),
            pre('ShowAll'),
            sep,
            cmd('close', 'Quit Marky Mark', 'Mod+Q'),
          ],
        },
        {
          title: 'File',
          items: [
            cmd('open', 'Open…', s.hotkeys.openFile),
            sep,
            cmd('save', 'Save', s.hotkeys.save),
            cmd('saveAs', 'Save As…', 'Mod+Shift+S'),
            sep,
            cmd('close', 'Close Window', 'Mod+W'),
          ],
        },
        editMenu,
        viewMenu,
        { title: 'Window', items: [pre('Minimize'), pre('Maximize', 'Zoom'), sep, pre('BringAllToFront')] },
        { title: 'Help', items: [helpItem] },
      ],
    };
  }

  return {
    submenus: [
      {
        title: 'File',
        items: [
          cmd('open', 'Open…', s.hotkeys.openFile),
          sep,
          cmd('save', 'Save', s.hotkeys.save),
          cmd('saveAs', 'Save As…', 'Mod+Shift+S'),
          sep,
          cmd('settings', 'Settings…', 'Mod+,'),
          sep,
          cmd('close', 'Exit'),
        ],
      },
      editMenu,
      viewMenu,
      { title: 'Help', items: [helpItem, sep, cmd('about', 'About Marky Mark')] },
    ],
  };
}
```

- [x] **Step 4: Run tests**

Run: `npx vitest run tests/unit/menu-spec.test.ts`
Expected: 3 passed (U19, U20, U21). Also `npx tsc --noEmit` clean.

- [x] **Step 5: Commit**

```bash
git add src/lib/commands.ts src/lib/menuSpec.ts tests/unit/menu-spec.test.ts
git commit -m "feat: SPEC12 command registry + pure menu spec (U19-U21)"
```

---

### Task 2: Platform seam + shim + App integration + E47–E50

**Files:**
- Modify: `src/platform/types.ts` (add `setAppMenu?`)
- Modify: `src/platform/browser.ts` (`?nativeMenu=1` → `window.__mmMenu`)
- Modify: `src/App.tsx` (registry wiring, menu install effect, header render rule, zoom/close commands)
- Modify: `src/components/SettingsPanel.tsx` (`autoHideAvailable` prop)
- Test: `tests/e2e/app.spec.ts` (append E47–E50)

**Interfaces:**
- Consumes: `buildMenuSpec`, `MenuSpec`, `registerCommands`, `dispatchCommand`, `CommandId` from Task 1.
- Produces: `Platform.setAppMenu?(spec: MenuSpec): Promise<void>`; `window.__mmMenu: { spec: MenuSpec | null; click(command: string): void }` (shim, `?nativeMenu=1` only); `SettingsPanel` prop `autoHideAvailable: boolean`.

- [x] **Step 1: Write the failing e2e tests** — append to `tests/e2e/app.spec.ts` (E47–E50 as designed: chromeless + title; menu-driven commands + re-installed spec state; auto-hide setting visibility + key round-trip; close guard via menu). Full test code lives in the appended section; key assertions: `toolbar-shell`/`toolbar-hotzone`/`menu-btn` have count 0 under `?nativeMenu=1`; `page.toHaveTitle('Marky Mark')` empty, `'welcome.md — Marky Mark'` open, `'welcome.md • — Marky Mark'` dirty; `__mmMenu.click()` for help/toggleMode/settings/about/save/saveAs/open; spec re-install shows `checked` + `Comments (1)`; `settings-autohide` count 0 with nativeMenu, visible without; `click('close')` dirty → `close-prompt`, cancel keeps doc.

- [x] **Step 2: Run to verify failure**

Run: `npx playwright test -g "E47"`
Expected: FAIL (toolbar-shell still rendered, `__mmMenu` undefined).

- [x] **Step 3: Implement**
  - `types.ts`: `setAppMenu?(spec: MenuSpec): Promise<void>;` (+ type import).
  - `browser.ts`: when `new URLSearchParams(window.location.search).has('nativeMenu')`, add `setAppMenu` recording the spec on `window.__mmMenu` with `click(command)` that verifies the command exists in the recorded spec then `dispatchCommand(command as CommandId, 'menu')`. Extend the `declare global` block.
  - `App.tsx`: `const nativeMenu = !!platform?.setAppMenu;` — register commands (open/save/saveAs/toggleMode/toggleComments/settings/help/about/zoomIn/zoomOut/zoomReset/close) via `registerCommands` in an effect; hotkey listener dispatches `dispatchCommand(id, 'hotkey')`; Toolbar props dispatch `dispatchCommand(id, 'ui')`; menu-install effect calls `platform.setAppMenu(buildMenuSpec(...))` on [platform, mode, showComments, settings.commentsEnabled, comments.length, settings.hotkeys]; header + hotzone render only when `!nativeMenu`; root gets `toolbar-static` only when `!nativeMenu && !settings.autoHideToolbar`; bare `Marky Mark` title when no doc; `close` command = dirty ? `setClosePrompt(true)` : `closeNow()`; zoom steps `ZOOM_LEVELS`.
  - `SettingsPanel.tsx`: new required prop `autoHideAvailable: boolean`; the auto-hide checkbox row renders only when true. App passes `autoHideAvailable={!nativeMenu}`.

- [x] **Step 4: Run tests**

Run: `npx playwright test -g "E47|E48|E49|E50"` → 4 passed, then full `npx playwright test` → E1–E41 + E45–E50 all pass (existing suite untouched), and `npx vitest run` + `npx tsc --noEmit` clean.

- [x] **Step 5: Commit**

```bash
git add src/platform/types.ts src/platform/browser.ts src/App.tsx src/components/SettingsPanel.tsx tests/e2e/app.spec.ts
git commit -m "feat: SPEC12 chromeless desktop shell — registry-driven commands, shim native menu, E47-E50"
```

---

### Task 3: Tauri native menu + capabilities

**Files:**
- Modify: `src/platform/tauri.ts` (implement `setAppMenu`)
- Modify: `src-tauri/capabilities/default.json` (add `core:menu:default`)

**Interfaces:**
- Consumes: `MenuSpec` types, `dispatchCommand(id, 'menu')`, `parseCombo`.

- [x] **Step 1: Implement `setAppMenu` in `tauri.ts`** — dynamic-import `@tauri-apps/api/menu`; convert canonical combos via `parseCombo` → `CmdOrCtrl+…` with special-key names (`=`→`Equal` etc., verified against muda's parser in the cargo registry); `CheckMenuItem` for checked items, `PredefinedMenuItem` (with `text` override for Zoom), `MenuItem` otherwise, every action `() => dispatchCommand(item.command, 'menu')`; `Menu.new({ items })` → `menu.setAsAppMenu()`.
- [x] **Step 2: Verify muda accelerator key names**: `grep -rn 'fn parse_key' ~/.cargo/registry/src/*/muda-*/src/accelerator.rs` and adjust the conversion table so `Mod+=`, `Mod+-`, `Mod+0`, `Mod+,` all parse.
- [x] **Step 3: Add `core:menu:default` to `src-tauri/capabilities/default.json`** permissions (add specific `core:menu:allow-*` entries instead if the build reports missing permissions).
- [x] **Step 4: Verify**: `npx tsc --noEmit` clean; `cargo check` (in src-tauri) clean; `npm run tauri build` exits 0 and the built app shows the menu bar (manual glance).
- [x] **Step 5: Commit**

```bash
git add src/platform/tauri.ts src-tauri/capabilities/default.json
git commit -m "feat: SPEC12 native menu bar on Tauri — spec conversion, accelerators, core:menu capability"
```

---

### Task 4: Docs + validate comment

**Files:**
- Modify: `ARCHITECTURE.md` (new "Native menus & the command registry" section: registry, menu-spec seam, header render rule, network-isolation note)
- Modify: `README.md` (one line: desktop uses native menus + chromeless window)
- Modify: `scripts/validate.mjs` (header comment test ranges → U1–U21, E1–E41 + E45–E50)

- [x] **Step 1: Write the docs changes.**
- [x] **Step 2: Commit**

```bash
git add ARCHITECTURE.md README.md scripts/validate.mjs
git commit -m "docs: SPEC12 architecture section, README native-menus line"
```

---

### Task 5: Full validation + goal condition

- [x] **Step 1**: `npm run validate` → complete output, `VALIDATION: ALL PASSED`.
- [x] **Step 2**: `npm run tauri build` → app path + size printed.
- [x] **Step 3**: goal greps — `grep -n 'core:menu' src-tauri/capabilities/default.json`; `git diff src-tauri/tauri.conf.json` empty; `git diff --stat docs/specs` empty; `grep -rEn '\.(skip|only|todo)\(' tests/` empty.
- [x] **Step 4**: Commit any remainder; summarize.

## Self-Review Notes

- Spec coverage: §1 (Task 1 layout + Task 3 conversion), §2 (Task 2 render rule/title), §3 (Tasks 1–3), §4 (Task 2 SettingsPanel), §5 (Task 2 shim), §6 (Tasks 1–2 tests), §7 (Task 4), §8 (Task 5). No gaps.
- Exactly-once: cross-source dedup in `dispatchCommand` — platform-independent guarantee.
- Type consistency: `CommandId` defined once in commands.ts; menuSpec imports it; `MenuSpec` defined once in menuSpec.ts; platform seam imports the type.
