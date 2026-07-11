# SPEC14: Marky Mark v14 — comment navigation (hotkeys + fixed navigator pill)

Delta spec on top of SPEC.md–SPEC13.md as implemented (all green: U1–U24,
E1–E41 + E45–E53, W1–W5; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §7 is the goal condition.

**What ships:** jump between comments without touching the mouse — two new
**rebindable hotkeys** (Next Comment / Previous Comment, like Edit Mode and
Comments) plus native **View-menu items** — and, for mouse users, a small
**navigator pill** that appears while a comment is selected. The pill is
**fixed in place**: its buttons never move as the selection walks the
document, so repeated clicks on the same spot step comment → comment →
comment. Works identically on desktop and web.

Out of scope: navigation while in full edit mode (no rendered marks), items
in the web hamburger menu, trackpad/swipe gestures, reading-position memory,
changes to comment storage or anchoring.

---

## 1. Navigation model (FR-N)

1. **Order and set:** navigation walks the **open (unresolved) comments in
   document-position order** — the same `byPosition` order the margin flow
   uses (live re-anchored position, falling back to the stored anchor).
   Resolved ghosts are skipped. Orphaned open comments participate (they
   hold their sorted position; activating one selects its card without
   scrolling the document).
2. **Stepping:** with an active comment, Next activates the one after it and
   Previous the one before, **wrapping** at both ends. With **no** active
   comment, Next enters at the **first** open comment, Previous at the
   **last**. With zero open comments both commands are silent no-ops.
3. **Activation** reuses the existing card-activate behavior, both sides:
   the comment becomes `activeId`, its first highlight mark scrolls to
   center and flashes, and its margin card scrolls into view. One
   invariant: **navigating must never scroll the pill** — the pill is
   viewport-fixed (§3).
4. **Where it works:** whenever the comments panel renders (preview and
   split-edit modes, comments master switch on, panel shown). In full edit
   mode the commands no-op. All of this is per SPEC7 §2: when
   `commentsEnabled` is off the commands, menu items, and pill are all
   absent.
5. **Pure helper** — `src/lib/commentNav.ts` (new):
   `stepComment(orderedIds: string[], activeId: string | null, dir: 1 | -1): string | null`
   implementing §1.1–§1.2 (null ⇔ empty list; unknown `activeId` treated as
   none). No DOM, no React — unit-tested directly (U26).

## 2. Commands, hotkeys, menu (FR-K)

1. **Commands:** `nextComment` and `prevComment` join the registry
   (SPEC12 §3.1); every surface below dispatches through it.
2. **Hotkeys:** `HotkeyMap` gains `nextComment` / `prevComment`, defaults
   **`Mod+Alt+ArrowDown`** / **`Mod+Alt+ArrowUp`**, rebindable in the
   Hotkeys tab exactly like the existing four (labels "Next comment" /
   "Previous comment", conflict detection included). Settings files
   round-trip: old `settings.json` without the new keys parses to the
   defaults; the serialized form simply gains the two keys.
3. **Menu:** the **View** menu gains `Next Comment` and `Previous Comment`
   directly after the Comments item (macOS and Windows layouts), with
   accelerators that display and follow the rebindable hotkeys (SPEC12
   §1.2 mechanics). Like the Comments item, both are **absent when
   `commentsEnabled` is off**. They stay present with zero comments
   (no-op on activate, matching Save's always-enabled convention).
4. The exactly-once invariant (SPEC12 §1.3) covers the new combos: menu
   accelerator + in-app listener must fire a navigation once per keypress.

## 3. The navigator pill (FR-P)

1. **Presence:** rendered iff a comment is currently active (`activeId`
   non-null) and the comments panel is shown. Deactivating (click-away,
   resolve, delete, document switch) removes it. It renders on desktop and
   web alike — pure app UI, no platform seam.
2. **Fixed position:** centered horizontally at the **bottom of the
   workspace**, `position: fixed`-equivalent within the window — document
   scrolling, card re-layout, and stepping **never move it**. This is the
   point of the feature: park the mouse on ↓ and click through every
   comment.
3. **Contents, left to right:** a **↑ Previous** button, a live **position
   counter** `n / N` (position of the active comment among open comments,
   1-based / total open), and a **↓ Next** button. Test ids:
   `comment-nav`, `comment-nav-prev`, `comment-nav-count`,
   `comment-nav-next`. Buttons dispatch the §2.1 commands.
4. **Interaction details:** clicking the pill must not clear the active
   comment (the click-away-deactivates handler ignores the pill); buttons
   are not focus traps (no persistent focus ring hijacking typing); the
   pill sits above document text but below modal overlays; themed via the
   existing `--mm-*` variables so all 27+ themes style it for free.
5. **Feel:** subtle fade/slide on appear/disappear (CSS only; no test may
   depend on animation timing). Compact — roughly a 3-control capsule, not
   a toolbar.

## 4. Web build & shim (FR-W)

1. Web behavior is identical (hotkeys, pill); the hamburger menu is
   untouched. W1–W5 unchanged.
2. The shim's menu seam (`window.__mmMenu`, SPEC12 §5.2) picks the new View
   items up automatically; no new e2e seams are required.

## 5. Tests (all suites stay green; only these are added)

1. **U25** — menu spec: View carries `nextComment`/`prevComment` after the
   Comments item on both OS layouts with the default accelerators;
   rebinding `nextComment` moves exactly that accelerator; both items and
   the Comments item vanish together when `commentsEnabled` is off.
2. **U26** — `stepComment`: empty → null; no active → first (dir 1) / last
   (dir −1); interior stepping both directions; wrap at both ends; unknown
   active id treated as none.
3. **E54** — pill lifecycle and the fixed-position guarantee: with three
   comments, activating one shows the pill with the right counter; two ↓
   clicks walk position order with the counter tracking; a further ↓ wraps
   to the first; ↑ wraps back; the pill's bounding box is **identical**
   across all steps (the don't-move-the-mouse assertion); click-away
   deactivates and the pill disappears; clicking the pill itself never
   deactivates.
4. **E55** — hotkeys: with no active comment, the default Next combo
   activates the first comment and Previous the last; rebinding Next in
   Settings takes effect immediately and the old combo goes dead; the new
   binding round-trips through `settings.json`.
5. **E56** (shim, `?nativeMenu=1`) — the installed spec shows both items
   with their accelerators; `__mmMenu.click('nextComment')` advances the
   active comment; both items absent from the spec when comments are
   disabled in Settings.
6. E42–E44 stay reserved for SPEC8. No existing test may be modified,
   weakened, skipped, or deleted.

## 6. Docs

1. README: extend the comments bullet with next/previous navigation
   (hotkeys + navigator pill). No screenshot refresh required in v14.

## 7. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U26, E1–E41 +
   E45–E56, W1–W5**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed.
3. No Windows-reserved path components anywhere:
   `git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]'`
   prints nothing.
4. `git diff src-tauri/tauri.conf.json` shows no CSP change;
   `git diff --stat docs/specs/` is empty (SPEC14 lands in its own docs
   commit); `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. README updated per §6; version files untouched (they stay at
   0.2.0-alpha.3); no new runtime dependencies.
