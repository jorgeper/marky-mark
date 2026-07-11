# SPEC14 Comment Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next/previous comment navigation via rebindable hotkeys, native View-menu items, and a fixed bottom-center navigator pill that never moves while stepping.

**Architecture:** A pure `stepComment()` helper does the ordering/wrapping math; `App.tsx` owns a `navigateComment(dir)` that activates + scrolls via the existing card-activate path; the command registry fans in menu items, hotkeys, and pill clicks. No platform changes — pure app-level feature, identical on web and desktop.

**Tech Stack:** React 19, TypeScript, Vitest, Playwright. No new dependencies.

## Global Constraints (SPEC14 / goal condition)

- Version files stay at `0.2.0-alpha.3`; CSP untouched; specs untouched.
- Only new tests U25–U26, E54–E56; no existing test modified.
- New file/dir names must pass the Windows reserved-name scan (no `aux`, `con`, `nul`, …).
- Old `settings.json` files parse: new hotkeys default (parseSettings already iterates `DEFAULT_HOTKEYS`).

---

### Task 1: `stepComment` helper (U26)

**Files:** Create `src/lib/commentNav.ts`; Test `tests/unit/comment-nav.test.ts`.

**Produces:** `stepComment(orderedIds: string[], activeId: string | null, dir: 1 | -1): string | null` — null ⇔ empty list; no/unknown active → first (dir 1) / last (dir −1); wraps both ends.

- [ ] Failing test:

```ts
import { describe, expect, test } from 'vitest';
import { stepComment } from '../../src/lib/commentNav';

describe('SPEC14 comment stepping', () => {
  test('U26: empty → null; no/unknown active enters at first/last; steps and wraps both ways', () => {
    expect(stepComment([], null, 1)).toBeNull();
    expect(stepComment([], null, -1)).toBeNull();
    const ids = ['a', 'b', 'c'];
    expect(stepComment(ids, null, 1)).toBe('a');
    expect(stepComment(ids, null, -1)).toBe('c');
    expect(stepComment(ids, 'zzz', 1)).toBe('a'); // unknown = none
    expect(stepComment(ids, 'a', 1)).toBe('b');
    expect(stepComment(ids, 'b', -1)).toBe('a');
    expect(stepComment(ids, 'c', 1)).toBe('a'); // wrap forward
    expect(stepComment(ids, 'a', -1)).toBe('c'); // wrap back
  });
});
```

- [ ] Implementation:

```ts
/**
 * SPEC14 §1: pure next/previous stepping over the open comments in document
 * order. No active (or unknown) id enters at the first (dir 1) / last
 * (dir −1); stepping wraps at both ends; empty list → null.
 */
export function stepComment(orderedIds: string[], activeId: string | null, dir: 1 | -1): string | null {
  if (orderedIds.length === 0) return null;
  const idx = activeId ? orderedIds.indexOf(activeId) : -1;
  if (idx === -1) return dir === 1 ? orderedIds[0] : orderedIds[orderedIds.length - 1];
  return orderedIds[(idx + dir + orderedIds.length) % orderedIds.length];
}
```

- [ ] `npx vitest run tests/unit/comment-nav.test.ts` (fail → implement → pass), `npm run typecheck`, commit `feat: SPEC14 stepComment helper (U26)`.

### Task 2: hotkeys, commands, menu items (U25)

**Files:** Modify `src/lib/hotkeys.ts`, `src/lib/commands.ts`, `src/lib/menuSpec.ts`, `src/components/SettingsPanel.tsx`; Test `tests/unit/menu-spec.test.ts` (append U25 only).

- [ ] `hotkeys.ts`: add to `HotkeyMap` interface `nextComment: string; prevComment: string;` and to `DEFAULT_HOTKEYS`: `nextComment: 'Mod+Alt+ArrowDown', prevComment: 'Mod+Alt+ArrowUp',`.
- [ ] `commands.ts`: add `| 'nextComment' | 'prevComment'` to `CommandId`.
- [ ] `menuSpec.ts` — in `buildMenuSpec`'s `viewMenu`, directly after the Comments entry (inside the same `commentsEnabled` conditional, SPEC14 §2.3):

```ts
      ...(s.commentsEnabled
        ? [
            cmd('toggleComments', /* existing item unchanged */),
            cmd('nextComment', 'Next Comment', s.hotkeys.nextComment),
            cmd('prevComment', 'Previous Comment', s.hotkeys.prevComment),
          ]
        : []),
```

(Keep the existing toggleComments expression verbatim; only the two new lines are added.)
- [ ] `SettingsPanel.tsx`: add to `HOTKEY_LABELS`: `nextComment: 'Next comment', prevComment: 'Previous comment',`.
- [ ] U25 in `tests/unit/menu-spec.test.ts`:

```ts
  test('U25: View carries Next/Previous Comment after Comments with hotkey accelerators; they vanish with the master switch', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      const view = commandsIn(s, 'View').map((i) => i.command);
      const at = view.indexOf('toggleComments');
      expect(view.slice(at, at + 3)).toEqual(['toggleComments', 'nextComment', 'prevComment']);
      expect(find(s, 'View', 'nextComment')!.accelerator).toBe('Mod+Alt+ArrowDown');
      expect(find(s, 'View', 'prevComment')!.accelerator).toBe('Mod+Alt+ArrowUp');
    }
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, nextComment: 'Mod+J' } };
    expect(find(rebound, 'View', 'nextComment')!.accelerator).toBe('Mod+J');
    expect(find(rebound, 'View', 'prevComment')!.accelerator).toBe('Mod+Alt+ArrowUp');
    const off = { ...base, commentsEnabled: false };
    expect(find(off, 'View', 'nextComment')).toBeUndefined();
    expect(find(off, 'View', 'prevComment')).toBeUndefined();
  });
```

- [ ] `npx vitest run tests/unit` all green (existing tests untouched), `npm run typecheck`, commit `feat: SPEC14 nav commands, hotkeys, View menu items (U25)`.

### Task 3: App wiring — navigateComment, pill, click-away

**Files:** Modify `src/App.tsx`, `src/styles.css`.

- [ ] Import `stepComment`. Extend the state mirror with `positions, activeId, showComments`:

```ts
  const stateRef = useRef({ settings, mode, dirty, docPath, buffer, savedText, comments, platform, themes, positions, activeId, showComments });
  stateRef.current = { settings, mode, dirty, docPath, buffer, savedText, comments, platform, themes, positions, activeId, showComments };
```

- [ ] `navigateComment` (place after `handleCardActivate`; hoist `handleCardActivate` above the command-registration effect if needed — or define `navigateComment` with `useCallback([])` reading refs):

```ts
  /** SPEC14 §1: step activation through the open comments in position order. */
  const navigateComment = useCallback((dir: 1 | -1) => {
    const s = stateRef.current;
    // Only where the comments panel renders: preview or split-edit (§1.4).
    if (!s.settings.commentsEnabled || !s.showComments) return;
    if (s.mode === 'edit' && !s.settings.splitEdit) return;
    const ordered = s.comments
      .filter((c) => !c.resolved)
      .sort((a, b) => (s.positions[a.id]?.start ?? a.anchor.start) - (s.positions[b.id]?.start ?? b.anchor.start))
      .map((c) => c.id);
    const id = stepComment(ordered, s.activeId, dir);
    if (!id) return;
    setActiveId(id);
    const doc = docRef.current ?? splitDocRef.current; // split-edit marks live in the split preview
    const marks = doc ? Array.from(doc.querySelectorAll<HTMLElement>(`mark.hl[data-cid="${CSS.escape(id)}"]`)) : [];
    if (marks.length > 0) {
      marks[0].scrollIntoView({ block: 'center' });
      for (const m of marks) {
        m.classList.add('flash');
        setTimeout(() => m.classList.remove('flash'), 900);
      }
    }
    panelRef.current?.querySelector(`[data-flowcard="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, []);
```

- [ ] Register commands (add to the `registerCommands` map): `nextComment: () => navigateComment(1), prevComment: () => navigateComment(-1),` and add `navigateComment` to the effect deps.
- [ ] Hotkey listener: extend the existing `onKey` chain:

```ts
      } else if (eventMatches(e, hk.nextComment)) {
        e.preventDefault();
        dispatchCommand('nextComment', 'hotkey');
      } else if (eventMatches(e, hk.prevComment)) {
        e.preventDefault();
        dispatchCommand('prevComment', 'hotkey');
      }
```

- [ ] Click-away (§3.1 + E54): in the preview doc's `onClick`, after the existing mark branch:

```ts
                const mark = (e.target as HTMLElement).closest?.('mark.hl') as HTMLElement | null;
                if (mark?.dataset.cid && showComments) handleMarkClick(mark.dataset.cid);
                else if (!mark) setActiveId(null); // click-away deactivates (SPEC14 §3.1)
```

- [ ] Pill (render next to the settings/about overlays, sibling of the workspace). `open` (sorted, unresolved) already exists in scope:

```tsx
      {activeId && showComments && settings.commentsEnabled && open.some((c) => c.id === activeId) && (
        <div className="comment-nav" data-testid="comment-nav" onMouseDown={(e) => e.stopPropagation()}>
          <button data-testid="comment-nav-prev" title="Previous comment" onClick={() => dispatchCommand('prevComment')}>
            ↑
          </button>
          <span data-testid="comment-nav-count">
            {open.findIndex((c) => c.id === activeId) + 1} / {open.length}
          </span>
          <button data-testid="comment-nav-next" title="Next comment" onClick={() => dispatchCommand('nextComment')}>
            ↓
          </button>
        </div>
      )}
```

- [ ] `styles.css` (append):

```css
/* --- SPEC14: fixed comment navigator pill — never moves while stepping --- */
.comment-nav {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 18px;
  z-index: 60; /* above the document, below .overlay (100) */
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--mm-bg-elevated, #f6f8fa);
  color: var(--mm-fg, #1f2328);
  border: 1px solid var(--mm-border, #d1d9e0);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  animation: mm-nav-in 0.15s ease-out;
}
@keyframes mm-nav-in {
  from { opacity: 0; transform: translateX(-50%) translateY(6px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.comment-nav button {
  font: inherit;
  font-size: 14px;
  line-height: 1;
  color: inherit;
  background: none;
  border: none;
  border-radius: 999px;
  padding: 5px 8px;
  cursor: pointer;
}
.comment-nav button:hover {
  background: color-mix(in srgb, var(--mm-accent, #0969da) 14%, transparent);
}
.comment-nav span {
  font-size: 11.5px;
  color: var(--mm-fg-muted, #59636e);
  padding: 0 4px;
  min-width: 44px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
```

- [ ] `npm run typecheck && npm run test:unit && npm run test:e2e` (existing suites must stay green), commit `feat: SPEC14 comment navigation — navigateComment, fixed pill, click-away`.

### Task 4: e2e E54–E56

**Files:** Modify `tests/e2e/app.spec.ts` (append after E53). Reuse `freshApp`-style helpers, `addComment`, `selectPhrase`, `menuClick`, `menuItem`, `fsRead`, `openSettings`.

- [ ] **E54** — pill lifecycle + fixed-position: open welcome (or a fixture with 3 known phrases), `addComment` ×3, click the first mark (`page.locator('mark.hl').first().click()`) → `comment-nav` visible, count `1 / 3`; record `boundingBox()`; click `comment-nav-next` twice → count `3 / 3`, active card advances (`.card.active` or `mark.hl.active[data-cid]` tracks position order); box identical each step; next again wraps to `1 / 3`; `comment-nav-prev` wraps back to `3 / 3`; clicking the pill never removed it; click empty doc (e.g. `page.getByTestId('doc').click({ position: … }` on blank area) → pill gone.
- [ ] **E55** — hotkeys + rebind round-trip: with 2 comments and nothing active, press `Control+Alt+ArrowDown` → first comment active (pill count `1 / 2`); `Control+Alt+ArrowUp` from none → last. Rebind Next in Settings (overlay mode, like E6) to `Control+Shift+J`; old combo inert; new combo advances; `/config/settings.json` contains `Mod+Shift+J`.
- [ ] **E56** — (`?nativeMenuApp`) installed spec holds both items with accelerators (`menuItem(page, 'nextComment')`); `__mmMenu.click('nextComment')` activates/advances; disable comments in settings (master switch via popup like E49 pattern) → re-installed spec lacks both items.
- [ ] Run `npx playwright test -g "E54|E55|E56"` then the full suites; commit `test: SPEC14 e2e — pill, hotkeys, menu navigation (E54-E56)`.

### Task 5: README + full gate

- [ ] README comments bullet: append `Jump between comments with ⌥⌘↓ / ⌥⌘↑ (rebindable) or the fixed navigator pill.` phrased to fit the existing bullet.
- [ ] `npm run validate` → `VALIDATION: ALL PASSED` (U1–U26, E1–E41 + E45–E56, W1–W5); `npm run tauri build` exit 0 with path+size; reserved-name scan clean; `git diff src-tauri/tauri.conf.json` empty; `git diff --stat docs/specs/` empty; skip/only/todo grep empty.
- [ ] Commit `docs: SPEC14 README navigation line`, report with evidence.
