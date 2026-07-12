# SPEC32: Marky Mark v32 — the identity break (0.4 fresh start)

Delta spec on top of SPEC.md–SPEC30.md as implemented (SPEC31 remains a
spec-only future milestone; SPEC28 withdrawn). This file wins on
conflict. §5 is the goal condition. **Owner decision:** the app breaks
identity once, now, while alpha — new installs start fresh; no data
migration is performed.

**What ships:**
1. Bundle identifier `com.markimark.app` → **`io.jorgepereira.markymark.app`**.
2. Embedded-comments trailer marker `markimark-comments` →
   **`marky-mark-comments`** — written always; **legacy trailers are
   still READ** (one regex alternation keeps old documents' comments
   alive; saves rewrite them to the new marker).
3. Web/shim localStorage keys `markimark.*` → **`marky-mark.*`**
   (web users start fresh too).

Consequences accepted by the owner: desktop settings/themes/positions/
recents/drafts start empty under the new config dir (the old
`com.markimark.app` directory is left behind; the README uninstall
section covers deleting it); web localStorage state resets.

---

## 1. Identifier (FR-ID)

`tauri.conf.json` `identifier` — the ONLY functional `src-tauri` change.
Docs follow: README uninstall paths, THEMES.md theme-folder paths,
WINDOWS.md config path, `scripts/deep-clean.sh` (`BUNDLE_ID`, plus its
stale `pkill -x markimark` → `marky-mark`), and ARCHITECTURE.md's
"identifier stays" paragraph is rewritten to record this break.

## 2. Trailer (FR-TRAILER)

`src/lib/embedded.ts`: the serializer writes `<!-- marky-mark-comments`;
the parser accepts `marky-mark-comments` OR the legacy
`markimark-comments` (split/attach round-trips migrate old files on
their first save). ARCHITECTURE's format example updates; historical
specs stay as written.

## 3. localStorage keys (FR-LS)

`browser.ts` `markimark.fs.v1` → `marky-mark.fs.v1`; `web.ts`
`markimark.web.config.v1` → `marky-mark.web.config.v1`.

## 4. Tests (amended only — no new numbers)

1. **Amended, not weakened:** every literal `markimark-comments`
   expectation in U14/U22 (embedded unit tests), E-tests, and W-tests
   becomes `marky-mark-comments`; the embedded unit test additionally
   gains legacy-read assertions (an old-marker document parses, and
   re-attaching writes the new marker) — strengthened, not weakened.
   The W-test localStorage key assertion follows §3.
2. No other test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved.

## 5. Definition of Done

1. `npm run validate` exits 0 with complete output (all current U/E/W
   ranges) and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` shows exactly the one identifier line (plus
   regenerated `gen/` schemas if the build refreshes them); no
   dependency changes; no `.skip/.only/.todo`; reserved-name scan
   prints nothing.
3. `grep -rn "com.markimark" README.md THEMES.md docs/WINDOWS.md
   scripts/ src-tauri/tauri.conf.json` prints nothing;
   `grep -rn "markimark-comments" src/` prints only the legacy-read
   alternation in `embedded.ts`.
4. Follow-up (outside this spec's gate): cut `v0.4.0-alpha.1`.
