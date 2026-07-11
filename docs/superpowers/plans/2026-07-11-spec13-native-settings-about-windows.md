# SPEC13 Native Settings & About Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, Settings (⌘,) and About open as real native Tauri windows (fixed-size, singleton, Esc/⌘W-closable) instead of in-page HTML overlays; web keeps overlays.

**Architecture:** The main window stays sole owner of settings state, persistence, themes, and command handlers. Aux windows (`settings`, `about`) are dumb views that handshake over a platform event bus (`mm://aux-ready` → `mm://aux-init`), send whole-`Settings` edits up (`mm://settings-edit`), send side-effect requests up (`mm://aux-request`), and re-render from canonical broadcasts (`mm://settings-changed`, `mm://themes-changed`). A pure `windowRole()` routes `?window=` to the right React root. The dev shim simulates aux windows with `window.open` + `BroadcastChannel` so Playwright drives the real two-window protocol.

**Tech Stack:** React 19, TypeScript, Tauri 2 (`@tauri-apps/api` only — windows/events ship in it), Vitest, Playwright.

## Global Constraints (from SPEC13 / the /goal condition)

- No new runtime dependencies.
- Version files untouched (`package.json` version, `tauri.conf.json` version, `Cargo.toml`).
- `src-tauri/tauri.conf.json` CSP unchanged (`git diff` must show no CSP change).
- The aux-window capability must contain **no** `fs:` / `dialog:` / `opener:` identifiers.
- Spec files (`docs/specs/`) must not be modified.
- Only new tests allowed: **U22–U24, E51–E53**. Only amendments allowed: **E48's settings/about steps and E49's panel-driving steps**, minimally redirected at the popup page with every existing assertion preserved. Nothing else in `tests/` changes; no `.skip/.only/.todo`.
- Web (`kind === 'web'`) behavior unchanged; W1–W5 must pass.
- Sidecar/trailer formats, theme format, SPEC11 network isolation unchanged.
- Every task ends with `npm run typecheck` green before its commit.

---

### Task 1: `windowRole` router (U22)

**Files:**
- Create: `src/lib/windowRole.ts`
- Test: `tests/unit/window-role.test.ts`

**Interfaces:**
- Produces: `windowRole(search: string): 'main' | 'settings' | 'about'` and `type WindowRole`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/window-role.test.ts
import { describe, expect, test } from 'vitest';
import { windowRole } from '../../src/lib/windowRole';

describe('SPEC13 window role', () => {
  test('U22: ?window= routes to settings/about; absent, unknown, or unrelated params → main', () => {
    expect(windowRole('')).toBe('main');
    expect(windowRole('?nativeMenu=1')).toBe('main');
    expect(windowRole('?window=settings')).toBe('settings');
    expect(windowRole('?window=about')).toBe('about');
    expect(windowRole('?window=about&nativeMenu=1')).toBe('about');
    expect(windowRole('?window=bogus')).toBe('main');
    expect(windowRole('?window=')).toBe('main');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/window-role.test.ts`
Expected: FAIL — cannot resolve `src/lib/windowRole`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/windowRole.ts
/**
 * SPEC13 §4.1: which React root this window mounts. The main window has no
 * ?window= param; aux windows are created with ?window=settings|about.
 * Pure — unit-testable, no DOM.
 */
export type WindowRole = 'main' | 'settings' | 'about';

export function windowRole(search: string): WindowRole {
  const v = new URLSearchParams(search).get('window');
  return v === 'settings' || v === 'about' ? v : 'main';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/window-role.test.ts`
Expected: PASS (U22).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/windowRole.ts tests/unit/window-role.test.ts
git commit -m "feat: SPEC13 windowRole router (U22)"
```

---

### Task 2: aux protocol module (U23, U24)

**Files:**
- Create: `src/lib/auxProtocol.ts`
- Test: `tests/unit/aux-protocol.test.ts`

**Interfaces:**
- Consumes: `Settings`, `DEFAULT_SETTINGS` from `src/lib/settings`; `DEFAULT_HOTKEYS`, `HotkeyMap` from `src/lib/hotkeys`; `Theme` from `src/lib/themes`.
- Produces (used by Tasks 4–7):
  - `type AuxKind = 'settings' | 'about'`
  - `EV_AUX_READY`, `EV_AUX_INIT`, `EV_SETTINGS_EDIT`, `EV_AUX_REQUEST`, `EV_SETTINGS_CHANGED`, `EV_THEMES_CHANGED` (string constants)
  - `interface AuxInit { settings: Settings; themes: Theme[]; isMac: boolean; version: string }`
  - `type AuxRequest = { req: 'reloadThemes' } | { req: 'revealThemesDir' } | { req: 'openExternal'; url: string }`
  - `buildAuxInit(args: AuxInit): AuxInit`
  - `mergeSettingsEdit(canonical: Settings, edit: Settings): Settings`
  - `settingsEqual(a: Settings, b: Settings): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/aux-protocol.test.ts
import { describe, expect, test } from 'vitest';
import { buildAuxInit, mergeSettingsEdit, settingsEqual } from '../../src/lib/auxProtocol';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import type { Theme } from '../../src/lib/themes';

const theme: Theme = { id: 'crisp', name: 'Crisp', author: 'mm', variant: 'light', builtin: true, css: '.theme-root{}' };

describe('SPEC13 aux protocol', () => {
  test('U23: buildAuxInit carries settings, themes, isMac, and version', () => {
    const init = buildAuxInit({ settings: DEFAULT_SETTINGS, themes: [theme], isMac: true, version: '9.9.9' });
    expect(init.settings).toEqual(DEFAULT_SETTINGS);
    expect(init.themes).toEqual([theme]);
    expect(init.isMac).toBe(true);
    expect(init.version).toBe('9.9.9');
  });

  test('U24: merging an edit preserves panel-unedited keys; a re-applied broadcast is a no-op (no echo)', () => {
    // The panel edited zoom on top of a stale snapshot; meanwhile the main
    // window's split drag moved splitRatio. The merge must keep the drag.
    const canonical = { ...DEFAULT_SETTINGS, splitRatio: 0.7 };
    const staleEdit = { ...DEFAULT_SETTINGS, zoom: 125, splitRatio: 0.5 };
    const merged = mergeSettingsEdit(canonical, staleEdit);
    expect(merged.zoom).toBe(125);
    expect(merged.splitRatio).toBe(0.7);

    // Applying a received broadcast and merging it back changes nothing —
    // settingsEqual is the guard the settings view uses to not re-emit.
    expect(settingsEqual(mergeSettingsEdit(canonical, canonical), canonical)).toBe(true);
    expect(settingsEqual(canonical, { ...canonical, zoom: 150 })).toBe(false);
    expect(
      settingsEqual(canonical, { ...canonical, hotkeys: { ...canonical.hotkeys, save: 'Mod+Shift+D' } })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/aux-protocol.test.ts`
Expected: FAIL — cannot resolve `src/lib/auxProtocol`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/auxProtocol.ts
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { DEFAULT_HOTKEYS, type HotkeyMap } from './hotkeys';
import type { Theme } from './themes';

/**
 * SPEC13 §3: the event protocol between the main window (sole owner of
 * settings state, persistence, themes, and command handlers) and the aux
 * windows (dumb views). Pure — no Tauri or DOM imports; the platform layer
 * carries these events over Tauri events (desktop) or BroadcastChannel
 * (dev shim).
 */

export type AuxKind = 'settings' | 'about';

export const EV_AUX_READY = 'mm://aux-ready'; // aux → main, payload { kind: AuxKind }
export const EV_AUX_INIT = 'mm://aux-init'; // main → aux, payload AuxInit
export const EV_SETTINGS_EDIT = 'mm://settings-edit'; // aux → main, payload Settings
export const EV_AUX_REQUEST = 'mm://aux-request'; // aux → main, payload AuxRequest
export const EV_SETTINGS_CHANGED = 'mm://settings-changed'; // main → aux, payload Settings
export const EV_THEMES_CHANGED = 'mm://themes-changed'; // main → aux, payload Theme[]

export interface AuxInit {
  settings: Settings;
  themes: Theme[];
  isMac: boolean;
  version: string;
}

export type AuxRequest =
  | { req: 'reloadThemes' }
  | { req: 'revealThemesDir' }
  | { req: 'openExternal'; url: string };

/** Everything an aux view needs to render (SPEC13 §3.2). */
export function buildAuxInit(args: AuxInit): AuxInit {
  return { settings: args.settings, themes: args.themes, isMac: args.isMac, version: args.version };
}

/** Keys the settings panel never edits — an edit must not clobber them (§3.5). */
const PANEL_UNEDITED: ReadonlyArray<keyof Settings> = ['splitRatio'];

export function mergeSettingsEdit(canonical: Settings, edit: Settings): Settings {
  const out: Settings = { ...edit, hotkeys: { ...edit.hotkeys } };
  for (const k of PANEL_UNEDITED) {
    (out as Record<keyof Settings, unknown>)[k] = canonical[k];
  }
  return out;
}

/** Field-wise equality — the aux view's no-echo guard (§3.5). */
export function settingsEqual(a: Settings, b: Settings): boolean {
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (k === 'hotkeys') continue;
    if (a[k] !== b[k]) return false;
  }
  for (const k of Object.keys(DEFAULT_HOTKEYS) as Array<keyof HotkeyMap>) {
    if (a.hotkeys[k] !== b.hotkeys[k]) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/aux-protocol.test.ts`
Expected: PASS (U23, U24).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/auxProtocol.ts tests/unit/aux-protocol.test.ts
git commit -m "feat: SPEC13 aux window protocol (U23, U24)"
```

---

### Task 3: platform seam + Tauri implementation + capabilities

**Files:**
- Modify: `src/platform/types.ts` (add optional members at the end of `Platform`, after `setAppMenu`)
- Modify: `src/platform/tauri.ts`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src-tauri/capabilities/aux.json`

**Interfaces:**
- Consumes: `AuxKind` from Task 2.
- Produces (used by Tasks 4–7):
  - `Platform.openAuxWindow?(kind: AuxKind): Promise<void>`
  - `Platform.busEmit?(event: string, payload: unknown): Promise<void>`
  - `Platform.busListen?(event: string, cb: (payload: unknown) => void): Promise<() => void>`
  - `Platform.closeFocusedAuxWindow?(): Promise<boolean>`

There is no unit seam for Tauri APIs; this task's verification is `npm run typecheck` plus the Task 10 built-app run. Keep all Tauri imports dynamic, matching the file's existing style.

- [ ] **Step 1: Extend `src/platform/types.ts`**

Add `import type { AuxKind } from '../lib/auxProtocol';` next to the existing `MenuSpec` import, and append inside `interface Platform` after `setAppMenu`:

```ts
  /**
   * SPEC13 §4.2: open (or focus — singleton) the Settings/About aux window.
   * Defined ⇒ the in-page settings/about overlays are never rendered.
   * Desktop implements it; web never does; the dev shim only under
   * ?nativeMenu=1 (window.open + BroadcastChannel).
   */
  openAuxWindow?(kind: AuxKind): Promise<void>;
  /** Cross-window event bus for the SPEC13 §3 protocol. */
  busEmit?(event: string, payload: unknown): Promise<void>;
  /** Subscribe; resolves to an unlisten function. */
  busListen?(event: string, cb: (payload: unknown) => void): Promise<() => void>;
  /**
   * Close the focused aux window if any (the ⌘W path — the native Close
   * Window accelerator runs in the main window's JS regardless of window
   * focus). Resolves true if an aux window was focused and closed.
   */
  closeFocusedAuxWindow?(): Promise<boolean>;
```

- [ ] **Step 2: Implement in `src/platform/tauri.ts`**

Add `import type { AuxKind } from '../lib/auxProtocol';` at the top. Inside `createTauriPlatform`, `listen` and `getCurrentWindow` are already imported; also destructure `emit`: change line 31 to
`const { emit, listen } = await import('@tauri-apps/api/event');`

Add a helper above `const platform: Platform = {`:

```ts
  const AUX_LABELS: readonly AuxKind[] = ['settings', 'about'];
  const AUX_OPTIONS: Record<AuxKind, { title: string; width: number; height: number }> = {
    settings: { title: 'Settings', width: 620, height: 560 },
    about: { title: 'About Marky Mark', width: 360, height: 420 },
  };
```

Replace `closeNow` with (label guard: an aux window's own Esc/close must not tear down its sibling):

```ts
    async closeNow() {
      const current = getCurrentWindow();
      if (current.label === 'main') {
        // SPEC13 §3.6: aux windows die with the main window, promptless.
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        for (const label of AUX_LABELS) {
          const w = await WebviewWindow.getByLabel(label);
          if (w) await w.destroy().catch(() => {});
        }
      }
      await current.destroy();
    },
```

Add after `setAppMenu` (inside the `platform` object literal):

```ts
    /** SPEC13 §1–§2: one fixed-size window per kind; reinvoke = focus. */
    async openAuxWindow(kind: AuxKind) {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel(kind);
      if (existing) {
        await existing.unminimize().catch(() => {});
        await existing.setFocus();
        return;
      }
      const opt = AUX_OPTIONS[kind];
      new WebviewWindow(kind, {
        url: `index.html?window=${kind}`,
        title: opt.title,
        width: opt.width,
        height: opt.height,
        resizable: false,
        maximizable: false,
        center: true,
      });
    },

    async busEmit(event, payload) {
      await emit(event, payload);
    },
    async busListen(event, cb) {
      return listen(event, (e) => cb(e.payload));
    },

    async closeFocusedAuxWindow() {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      for (const label of AUX_LABELS) {
        const w = await WebviewWindow.getByLabel(label);
        if (w && (await w.isFocused().catch(() => false))) {
          await w.destroy().catch(() => {});
          return true;
        }
      }
      return false;
    },
```

- [ ] **Step 3: Capabilities**

In `src-tauri/capabilities/default.json`, extend `permissions` (keep everything already there; add these four after `"core:event:allow-listen"`):

```json
    "core:event:allow-emit",
    "core:webview:allow-create-webview-window",
    "core:window:allow-set-focus",
    "core:window:allow-unminimize",
    "core:window:allow-is-focused",
```

Create `src-tauri/capabilities/aux.json` — events and self-close only, deliberately **no fs/dialog/opener** (SPEC13 §4.4; the DoD greps for this):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "aux",
  "description": "Settings/About aux windows (SPEC13): dumb views — event bus and self-close only. No fs, dialog, or opener permissions, ever.",
  "windows": ["settings", "about"],
  "permissions": [
    "core:default",
    "core:event:allow-listen",
    "core:event:allow-emit",
    "core:window:allow-close",
    "core:window:allow-destroy"
  ]
}
```

- [ ] **Step 4: Typecheck, regenerate schemas, commit**

```bash
npm run typecheck
cd src-tauri && cargo check && cd ..
git add src/platform/types.ts src/platform/tauri.ts src-tauri/capabilities src-tauri/gen
git commit -m "feat: SPEC13 platform aux-window seam — Tauri windows, event bus, aux capability"
```

(`cargo check` regenerates `src-tauri/gen/schemas`; commit whatever it touched.)

---

### Task 4: browser shim — popup aux windows + BroadcastChannel bus

**Files:**
- Modify: `src/platform/browser.ts`

**Interfaces:**
- Consumes: `AuxKind` from Task 2; Platform members from Task 3.
- Produces (used by E51–E53): `window.__mmAux: { opened: Record<AuxKind, number>; focused: Record<AuxKind, number> }`.

- [ ] **Step 1: Implement**

Add to the imports: `import type { AuxKind } from '../lib/auxProtocol';`

Extend the `declare global { interface Window { … } }` block with:

```ts
    /**
     * SPEC13 §5.2: aux-window activity recorded for e2e — how many times each
     * kind was opened vs focused-instead (singleton assertion seam).
     */
    __mmAux?: {
      opened: Record<AuxKind, number>;
      focused: Record<AuxKind, number>;
    };
```

Inside `createBrowserPlatform()`, after the `setAppMenu` const, add:

```ts
  /**
   * SPEC13 §5.2: the shim's cross-window bus. BroadcastChannel never delivers
   * to the posting context, exactly like the real protocol needs (main and
   * aux windows only ever consume each other's events, never their own).
   */
  const channel = new BroadcastChannel('mm://bus');
  const busEmit = async (event: string, payload: unknown) => {
    channel.postMessage({ event, payload });
  };
  const busListen = async (event: string, cb: (payload: unknown) => void) => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { event?: string; payload?: unknown };
      if (data && data.event === event) cb(data.payload);
    };
    channel.addEventListener('message', handler);
    return () => channel.removeEventListener('message', handler);
  };

  /** SPEC13 §5.2: aux windows are same-origin popups; singleton by handle. */
  const auxHandles: Partial<Record<AuxKind, Window | null>> = {};
  const openAuxWindow = async (kind: AuxKind) => {
    const aux = (window.__mmAux ??= {
      opened: { settings: 0, about: 0 },
      focused: { settings: 0, about: 0 },
    });
    const existing = auxHandles[kind];
    if (existing && !existing.closed) {
      existing.focus();
      aux.focused[kind] += 1;
      return;
    }
    auxHandles[kind] = window.open(`/?window=${kind}&nativeMenu=1`, `mm-${kind}`, 'width=620,height=560');
    aux.opened[kind] += 1;
  };

  const closeFocusedAuxWindow = async () => {
    for (const kind of ['settings', 'about'] as const) {
      const h = auxHandles[kind];
      if (h && !h.closed && h.document.hasFocus()) {
        h.close();
        return true;
      }
    }
    return false;
  };
```

Change the returned object's spread line from

```ts
    ...(nativeMenu ? { setAppMenu } : {}),
```

to

```ts
    ...(nativeMenu ? { setAppMenu, openAuxWindow, closeFocusedAuxWindow } : {}),
    busEmit,
    busListen,
```

(The bus is unconditional — the popup page itself carries `?nativeMenu=1`, and providing listen/emit without `openAuxWindow` changes no render rule. The overlay render rule keys on `openAuxWindow` only.)

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add src/platform/browser.ts
git commit -m "feat: SPEC13 shim aux windows — window.open popups + BroadcastChannel bus, __mmAux seam"
```

---

### Task 5: frameless SettingsPanel / AboutDialog + aux styles

**Files:**
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/components/AboutDialog.tsx`
- Modify: `src/styles.css` (append at end)

**Interfaces:**
- Produces: `SettingsPanel` gains optional prop `frameless?: boolean`; `AboutDialog` gains optional prop `frameless?: boolean`. Frameless ⇒ no `.overlay` scrim wrapper, no Done/Close button (the window chrome closes, SPEC13 §1.3). All existing `data-testid`s stay.

- [ ] **Step 1: SettingsPanel**

Add `frameless` to the `Props` interface and destructuring:

```ts
  /** SPEC13 §1.3: aux-window mode — no scrim, no Done button. */
  frameless?: boolean;
```

Replace the component's `return` (the `.overlay`-wrapped block at the bottom, currently lines ~401–428) with:

```tsx
  const body = (
    <div className="modal settings-modal" data-testid="settings-panel">
      <nav className="tab-rail" data-testid="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn${tab === t.id ? ' active' : ''}`}
            data-testid={`settings-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="tab-content">
        {tab === 'appearance' && appearanceTab}
        {tab === 'general' && generalTab}
        {tab === 'hotkeys' && hotkeysTab}
        {!frameless && (
          <div className="actions">
            <button className="primary" data-testid="settings-close" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (frameless) return body;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {body}
    </div>
  );
```

- [ ] **Step 2: AboutDialog**

Change the signature to

```tsx
export function AboutDialog({
  onClose,
  onOpenUrl,
  frameless,
}: {
  onClose(): void;
  onOpenUrl(url: string): void;
  /** SPEC13 §2: aux-window mode — no scrim, no Close button. */
  frameless?: boolean;
}) {
```

and restructure the return the same way: extract the inner `<div className="modal about-dialog" …>…</div>` into `const body = (…)`, render the `.actions` block (`about-close` button) only when `!frameless`, and

```tsx
  if (frameless) return body;
  return (
    <div className="overlay" onMouseDown={onClose}>
      {body}
    </div>
  );
```

Keep the existing Escape `useEffect` untouched — in a window it closes the window (`onClose` will be `closeNow`), in an overlay it dismisses.

- [ ] **Step 3: styles.css**

Append (adjust only if a rule visibly conflicts — check the existing `.modal`/`.settings-modal` rules while there):

```css
/* --- SPEC13: aux windows (Settings/About render frameless, filling the window) --- */
.aux-root {
  height: 100vh;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden;
}
.aux-root > .modal {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  box-shadow: none;
  overflow: auto;
}
```

- [ ] **Step 4: Verify nothing regressed, commit**

```bash
npm run typecheck
npm run test:unit
npx playwright test -g "E49|settings"   # overlay-mode settings tests still green
git add src/components/SettingsPanel.tsx src/components/AboutDialog.tsx src/styles.css
git commit -m "feat: SPEC13 frameless settings/about variants for aux windows"
```

---

### Task 6: aux window React root + main.tsx routing

**Files:**
- Create: `src/aux/AuxWindow.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `<AuxWindow kind={'settings' | 'about'} />`.

- [ ] **Step 1: Create `src/aux/AuxWindow.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { getPlatform, type Platform } from '../platform';
import {
  buildAuxInit,
  EV_AUX_READY,
  EV_AUX_REQUEST,
  EV_SETTINGS_CHANGED,
  EV_SETTINGS_EDIT,
  EV_THEMES_CHANGED,
  mergeSettingsEdit,
  settingsEqual,
  type AuxInit,
  type AuxKind,
  type AuxRequest,
} from '../lib/auxProtocol';
import type { Settings } from '../lib/settings';
import type { Theme } from '../lib/themes';
import { applyThemeCss } from '../themeRuntime';
import { SettingsPanel } from '../components/SettingsPanel';
import { AboutDialog } from '../components/AboutDialog';

/**
 * SPEC13 §1–§3: the aux-window root. A dumb view — no filesystem, no
 * authoritative state. Handshakes mm://aux-ready → mm://aux-init, renders
 * nothing until init arrives, edits go up as whole-Settings events, and
 * canonical broadcasts come back down. Esc and Mod+W close the window
 * (macOS ⌘W also arrives via the native accelerator → main's close command
 * → closeFocusedAuxWindow; both paths are idempotent).
 */
export function AuxWindow({ kind }: { kind: AuxKind }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [init, setInit] = useState<AuxInit | null>(null);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const canonicalRef = useRef<Settings | null>(null);
  canonicalRef.current = init?.settings ?? null;

  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];
    void (async () => {
      const p = await getPlatform();
      if (disposed || !p.busEmit || !p.busListen) return;
      setPlatform(p);
      offs.push(await p.busListen(EV_AUX_INIT, (payload) => setInit(buildAuxInit(payload as AuxInit))));
      offs.push(
        await p.busListen(EV_SETTINGS_CHANGED, (payload) =>
          setInit((i) => (i ? { ...i, settings: payload as Settings } : i))
        )
      );
      offs.push(
        await p.busListen(EV_THEMES_CHANGED, (payload) =>
          setInit((i) => (i ? { ...i, themes: payload as Theme[] } : i))
        )
      );
      await p.busEmit(EV_AUX_READY, { kind });
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [kind]);

  // Esc / Mod+W close the window (SPEC13 §1.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder]')) return;
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w')) {
        e.preventDefault();
        void platform?.closeNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform]);

  // OS light/dark tracking + theming, mirroring App (SPEC13 §1.4).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!init || init.themes.length === 0) return;
    const s = init.settings;
    const wanted = prefersDark && s.useDarkTheme ? s.themeDark : s.themeLight;
    const theme = init.themes.find((t) => t.id === wanted) ?? init.themes.find((t) => t.id === 'crisp') ?? init.themes[0];
    applyThemeCss(theme.css);
  }, [init, prefersDark]);

  if (!platform || !init) return null;

  const request = (r: AuxRequest) => void platform.busEmit!(EV_AUX_REQUEST, r);
  const close = () => void platform.closeNow();

  return (
    <div
      className="theme-root aux-root"
      style={init.settings.fontSize === 'auto' ? undefined : { ['--mm-font-size' as string]: `${init.settings.fontSize}px` }}
    >
      {kind === 'settings' ? (
        <SettingsPanel
          frameless
          settings={init.settings}
          themes={init.themes}
          isMac={init.isMac}
          storageLocked={false}
          autoHideAvailable={false}
          onChange={(next) => {
            const canonical = canonicalRef.current ?? init.settings;
            const merged = mergeSettingsEdit(canonical, next);
            if (settingsEqual(merged, canonical)) return; // no-echo guard (§3.5)
            setInit((i) => (i ? { ...i, settings: merged } : i)); // optimistic; broadcast confirms
            void platform.busEmit!(EV_SETTINGS_EDIT, merged);
          }}
          onReloadThemes={() => request({ req: 'reloadThemes' })}
          onRevealThemesDir={() => request({ req: 'revealThemesDir' })}
          onClose={close}
        />
      ) : (
        <AboutDialog frameless onClose={close} onOpenUrl={(url) => request({ req: 'openExternal', url })} />
      )}
    </div>
  );
}
```

Check whether `App.tsx`'s root div uses the class `theme-root` (`grep -n 'theme-root' src/App.tsx src/styles.css`); if the app root uses a different class for the theme scope, use that same class here instead of `theme-root`.

- [ ] **Step 2: Route in `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuxWindow } from './aux/AuxWindow';
import { windowRole } from './lib/windowRole';
import './styles.css';

// SPEC13 §4.1: aux windows load the same bundle with ?window=settings|about.
const role = windowRole(window.location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{role === 'main' ? <App /> : <AuxWindow kind={role} />}</React.StrictMode>
);
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add src/aux/AuxWindow.tsx src/main.tsx
git commit -m "feat: SPEC13 aux window root — handshake, live theming, Esc/Mod+W close"
```

---

### Task 7: App.tsx main-window wiring

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3 exports.

- [ ] **Step 1: Imports and stateRef**

Add to imports:

```ts
import {
  buildAuxInit,
  EV_AUX_READY,
  EV_AUX_REQUEST,
  EV_SETTINGS_CHANGED,
  EV_SETTINGS_EDIT,
  EV_THEMES_CHANGED,
  mergeSettingsEdit,
  type AuxRequest,
} from './lib/auxProtocol';
```

Extend the state mirror (currently `const stateRef = useRef({ settings, mode, dirty, docPath, buffer, savedText, comments, platform });` at ~line 91) to also carry `themes`:

```ts
  const stateRef = useRef({ settings, mode, dirty, docPath, buffer, savedText, comments, platform, themes });
  stateRef.current = { settings, mode, dirty, docPath, buffer, savedText, comments, platform, themes };
```

- [ ] **Step 2: Command handlers (in the `registerCommands` effect, ~line 442)**

Replace the `settings`, `about`, and `close` entries:

```ts
      // SPEC13 §4.2: a platform with aux windows never shows the overlays.
      settings: () => {
        const p = stateRef.current.platform;
        if (p?.openAuxWindow) void p.openAuxWindow('settings');
        else setSettingsOpen(true);
      },
      about: () => {
        const p = stateRef.current.platform;
        if (p?.openAuxWindow) void p.openAuxWindow('about');
        else setAboutOpen(true);
      },
      // SPEC12 §1.5 + SPEC13 §1.3: ⌘W with an aux window focused closes that
      // window (the native accelerator always lands here, in main's JS);
      // otherwise Quit/Exit/Close run the unsaved-changes guard, unchanged.
      close: () => {
        void (async () => {
          const p = stateRef.current.platform;
          if (p?.closeFocusedAuxWindow && (await p.closeFocusedAuxWindow())) return;
          if (stateRef.current.dirty) setClosePrompt(true);
          else void p?.closeNow();
        })();
      },
```

- [ ] **Step 3: Bus wiring effect** (add after the native-menu install effect, ~line 480)

```ts
  // --- aux windows (SPEC13 §3): main owns state; views handshake and edit over the bus ----
  useEffect(() => {
    if (!platform?.busListen || !platform.busEmit) return;
    let disposed = false;
    const offs: Array<() => void> = [];
    void (async () => {
      const ready = await platform.busListen!(EV_AUX_READY, () => {
        const s = stateRef.current;
        void platform.busEmit!(
          EV_AUX_INIT,
          buildAuxInit({ settings: s.settings, themes: s.themes, isMac: platform.isMac, version: __APP_VERSION__ })
        );
      });
      const edit = await platform.busListen!(EV_SETTINGS_EDIT, (payload) => {
        // §3.5: merge through the latest canonical state — a stale popup
        // snapshot must never clobber splitRatio (or future panel-unedited keys).
        updateSettings(mergeSettingsEdit(stateRef.current.settings, payload as Settings));
      });
      const req = await platform.busListen!(EV_AUX_REQUEST, (payload) => {
        const r = payload as AuxRequest;
        if (r.req === 'reloadThemes') void reloadThemes();
        else if (r.req === 'revealThemesDir') void platform.revealThemesDir?.();
        else if (r.req === 'openExternal') void platform.openExternal(r.url);
      });
      if (disposed) [ready, edit, req].forEach((off) => off());
      else offs.push(ready, edit, req);
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [platform, updateSettings, reloadThemes]);

  // §3.5 canonical echo: every settings/themes change broadcasts, whatever its source.
  useEffect(() => {
    if (platform?.busEmit) void platform.busEmit(EV_SETTINGS_CHANGED, settings);
  }, [platform, settings]);
  useEffect(() => {
    if (platform?.busEmit) void platform.busEmit(EV_THEMES_CHANGED, themes);
  }, [platform, themes]);
```

Also add `EV_AUX_INIT` to the auxProtocol import list.

- [ ] **Step 4: Render-rule belt-and-braces** (SPEC13 §4.2)

At the overlay render sites (~lines 1087 and 1108), prefix the conditions:

```tsx
      {!platform.openAuxWindow && settingsOpen && (
```

```tsx
      {!platform.openAuxWindow && aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} onOpenUrl={(u) => void platform.openExternal(u)} />}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
npm run test:unit
git add src/App.tsx
git commit -m "feat: SPEC13 main-window aux wiring — handshake, edits, requests, canonical echo"
```

---

### Task 8: e2e — amend E48/E49, add E51–E53

**Files:**
- Modify: `tests/e2e/app.spec.ts` (only the blocks named below)

All popups are driven via Playwright's `page.waitForEvent('popup')`. Helpers `freshNativeMenuApp`, `menuClick`, `menuItem`, `fsRead`, `WELCOME`, `addComment` already exist in this file — reuse them.

- [ ] **Step 1: Amend E48's settings/about block** (only the six lines starting at the comment `// Settings and About open through the registry.`) to:

```ts
  // Settings and About open through the registry — in their own windows (SPEC13).
  const settingsPopup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await settingsPopup;
  await expect(sp.getByTestId('settings-panel')).toBeVisible();
  await sp.close();
  const aboutPopup = page.waitForEvent('popup');
  await menuClick(page, 'about');
  const ap = await aboutPopup;
  await expect(ap.getByTestId('about-dialog')).toBeVisible();
  await ap.keyboard.press('Escape');
  await expect.poll(() => ap.isClosed()).toBe(true);
```

(Same assertions — panel visible, dialog visible, Escape dismisses — against the popup handles. Everything else in E48 is untouched.)

- [ ] **Step 2: Amend E49's panel-driving steps.** Replace

```ts
  await menuClick(page, 'settings');
  await page.getByTestId('settings-panel').waitFor();
  await page.getByTestId('settings-tab-general').click();
```

with

```ts
  const popup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popup;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-general').click();
```

and retarget the following panel queries in the nativeMenu half (`settings-line-numbers`, `settings-autohide`) from `page.` to `sp.` — the `fsRead(page, '/config/settings.json')` polls stay on `page` (persistence goes through the main window, which is the point). The non-nativeMenu half of E49 is untouched.

- [ ] **Step 3: Add E51–E53** after E50:

```ts
test('E51: Settings opens its own window — no in-page overlay; edits apply live in main and persist; menu zoom echoes back', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc')).toBeVisible();
  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popupPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0); // never an overlay on desktop

  await expect(sp.getByTestId('settings-tab-appearance')).toBeVisible();
  await expect(sp.getByTestId('settings-tab-general')).toBeVisible();
  await expect(sp.getByTestId('settings-tab-hotkeys')).toBeVisible();

  // Toggle line numbers in the popup → the main editor gutter reacts live…
  await sp.getByTestId('settings-tab-general').click();
  await sp.getByTestId('settings-line-numbers').click();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  // …and persists through the main window (the sole owner of settings.json).
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { lineNumbers?: boolean }).lineNumbers : undefined;
    })
    .toBe(false);

  // Canonical echo: zoom stepped via the main window's menu lands in the popup control.
  await sp.getByTestId('settings-tab-appearance').click();
  await menuClick(page, 'zoomIn');
  await expect(sp.getByTestId('zoom-select')).toHaveValue('110');
});

test('E52: rebinding Save in the settings window updates the menu accelerator; old combo dead, new combo saves', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc')).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popupPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-hotkeys').click();
  await sp.getByTestId('hotkey-save').click();
  await sp.keyboard.press('Control+Shift+D');

  // The main window's installed menu spec follows the rebind (SPEC13 §1.5).
  await expect
    .poll(async () => {
      const item = await page.evaluate(
        () =>
          window
            .__mmMenu!.spec!.submenus.flatMap((m) => m.items)
            .find((i) => i.type === 'command' && i.command === 'save') as { accelerator?: string } | undefined
      );
      return item?.accelerator;
    })
    .toBe('Mod+Shift+D');

  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor').locator('.cm-line').first().click();
  await page.keyboard.type('REBINDMARK ');
  await page.keyboard.press('Control+s'); // old combo — must do nothing
  await expect(page).toHaveTitle('welcome.md • — Marky Mark');
  await page.keyboard.press('Control+Shift+D'); // new combo — saves, exactly once
  await expect(page).toHaveTitle('welcome.md — Marky Mark');
  expect(await fsRead(page, WELCOME)).toContain('REBINDMARK');
});

test('E53: About opens its own window, Esc closes it; aux windows are singletons — reinvoke focuses', async ({
  page,
}) => {
  await freshNativeMenuApp(page);

  const aboutPromise = page.waitForEvent('popup');
  await menuClick(page, 'about');
  const ap = await aboutPromise;
  await ap.getByTestId('about-dialog').waitFor();
  await expect(ap.getByTestId('about-version')).toContainText('v');
  await ap.keyboard.press('Escape');
  await expect.poll(() => ap.isClosed()).toBe(true);

  const settingsPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await settingsPromise;
  await sp.getByTestId('settings-panel').waitFor();
  await menuClick(page, 'settings'); // second invoke: focus the existing window, never a second one
  await expect
    .poll(() => page.evaluate(() => window.__mmAux))
    .toEqual({ opened: { settings: 1, about: 1 }, focused: { settings: 1, about: 0 } });
  await expect(sp.getByTestId('settings-panel')).toBeVisible();
});
```

- [ ] **Step 4: Run the new/amended tests**

Run: `npx playwright test -g "E48|E49|E51|E52|E53"`
Expected: all PASS. If a popup never arrives, debug the shim's `openAuxWindow` gate (`?nativeMenu=1` must be in the main page URL) before touching anything else. If `settings-panel` renders but edits don't reach the main page, debug the BroadcastChannel bus (both pages must construct the platform).

- [ ] **Step 5: Full e2e + unit sweep, commit**

```bash
npm run test:unit && npm run test:e2e
git add tests/e2e/app.spec.ts
git commit -m "test: SPEC13 e2e — aux-window settings/about (E51-E53), E48/E49 popup redirection"
```

---

### Task 9: docs

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`

- [ ] **Step 1: ARCHITECTURE.md** — add a short section after the SPEC12 command-registry/menu section:

```markdown
## Aux windows: Settings & About (SPEC13)

On desktop, Settings (⌘,) and About open as real windows (Tauri labels
`settings`/`about`), not in-page overlays. One owner, dumb views: the main
window keeps sole ownership of settings state, `settings.json`, themes, and
command handlers; aux windows render only what they're sent. The protocol
(`src/lib/auxProtocol.ts`, pure) rides the platform event bus:
`mm://aux-ready` → `mm://aux-init` (handshake), `mm://settings-edit` (whole
Settings up), `mm://aux-request` (reload/reveal/open-external side effects
run by main), `mm://settings-changed` / `mm://themes-changed` (canonical
echo down — applying a broadcast never re-emits, and edits merge through the
latest canonical state so panel-unedited keys like `splitRatio` are never
clobbered). `src/lib/windowRole.ts` routes `?window=` to the right React
root. Render rule: the overlays render iff `platform.openAuxWindow` is
undefined — web keeps them, desktop never shows them, the dev shim provides
aux windows under `?nativeMenu=1` via `window.open` + BroadcastChannel so
Playwright drives the real two-window protocol. Security posture: aux
windows run under their own capability (`src-tauri/capabilities/aux.json`)
with events and self-close only — no fs, dialog, or opener permissions.
```

- [ ] **Step 2: README.md** — update the native-desktop bullet under "What you get" to mention the windows, e.g. change

```markdown
- **A real desktop citizen** — native menus (macOS menu bar / Windows menu
  bar) and a chromeless window: no in-app toolbar, just your document.
```

to

```markdown
- **A real desktop citizen** — native menus (macOS menu bar / Windows menu
  bar), a chromeless window with no in-app toolbar, and real Settings (⌘,)
  and About windows — not in-page pop-overs.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md README.md
git commit -m "docs: SPEC13 aux-window architecture section, README settings/about-windows line"
```

---

### Task 10: full gate — validate, build, DoD checks

- [ ] **Step 1: Full validation (SPEC13 §8.1, §8.5)**

Run: `npm run validate`
Expected: complete output ending `VALIDATION: ALL PASSED`, with U1–U24, E1–E41 + E45–E53, W1–W5, the single-file check, and the static bundle scan line all in the transcript. Fix anything red before proceeding (systematic-debugging skill; never weaken a test).

- [ ] **Step 2: Desktop build (§8.2)**

Run: `npm run tauri build`
Expected: exit 0; note the printed `.app` path and size.

- [ ] **Step 3: DoD greps (§8.3, §8.4)**

```bash
grep -n 'window' src-tauri/capabilities/*.json          # aux.json lists settings/about; check by eye:
grep -En 'fs:|dialog:|opener:' src-tauri/capabilities/aux.json   # MUST print nothing
git diff src-tauri/tauri.conf.json                      # MUST be empty (no CSP change)
git diff --stat docs/specs/                             # MUST be empty
grep -rEn '\.(skip|only|todo)\(' tests/                 # MUST print nothing
git diff --stat package.json src-tauri/Cargo.toml       # version untouched (script additions from earlier session are fine if already committed)
```

- [ ] **Step 4: Manual smoke on the built app** (evidence for §8.2)

```bash
npm run install:app   # replaces /Applications/Marky Mark.app and launches
```

⌘, → separate fixed-size Settings window; theme change restyles both windows live; ⌘, again focuses; ⌘W closes it; About opens its own small window, Esc dismisses; quit with Settings open leaves no stray window.

- [ ] **Step 5: Final commit (anything regenerated) and report**

```bash
git status --short   # commit any straggler (e.g. regenerated gen/schemas)
```

Report per verification-before-completion: paste the validate tail, build path/size, and the grep outputs.
