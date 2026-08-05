# Release Pre-Tag CI Gate + Failure Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The releaser only spends a tag (and merge-back) after the macOS test suite passes on the release branch; a failed cut files a `sandcastle` bug and parks the release; `npm run sandcastle` reports the cut's real outcome.

**Architecture:** One reusable macOS test workflow called by both the tag-triggered `release.yml` and a new push-triggered workflow on `release/**` branches. Host-side, pure classification/parsing additions in `.sandcastle/release-lane.mts` (unit-tested) with impure wiring in `.sandcastle/main.ts`. The releaser runbook (`.sandcastle/release-prompt.md`) reorders Phase 2 and gains a bug-filing failure flow.

**Tech Stack:** GitHub Actions (reusable workflows / `workflow_call`), TypeScript (`.mts`, vitest), `gh` CLI, markdown runbook.

**Spec:** `docs/superpowers/specs/2026-08-04-release-pretag-gate-design.md` — read it first.

## Global Constraints

- Work on branch `release-pretag-gate` (already created from `origin/main` @ `f438e0b`; spec committed as `8fdf87f`).
- Coding rules: `.sandcastle/CODING_STANDARDS.md`. `.sandcastle/*.mts` files carry `prd/008 R<n>` citation comments — follow that style for new code.
- Phase-marker invariant (test U209): no marker string may contain another. New marker `🏰 Sandcastle releaser: pre-tag CI green` satisfies it.
- Unit tests are numbered; the next free number is **U212**. Add new tests to `tests/unit/release-lane.test.ts`.
- Inner loop: `npm run typecheck` + `npx vitest run tests/unit/release-lane.test.ts` (seconds). Full unit suite: `npm run test:unit`.
- Never delete tags, releases, or `release/*` branches — including during manual testing.
- Commit after every task (small commits, message style: `feat:`/`chore:`/`docs:` seen in `git log`).

---

### Task 1: Reusable macOS test workflow + two callers

**Files:**
- Create: `.github/workflows/test-suite.yml`
- Create: `.github/workflows/release-branch-test.yml`
- Modify: `.github/workflows/release.yml:25-67` (the `test` job)

**Interfaces:**
- Produces: reusable workflow `test-suite.yml` with optional input `version` (string; leading `v` tolerated; empty ⇒ resolve from `package.json` and skip nothing — the drift check then verifies the three version files agree with each other) and output `version` (bare semver). `release.yml`'s downstream jobs keep using `needs.test.outputs.version` unchanged.

- [ ] **Step 1: Create `test-suite.yml`**

The steps are today's `test` job from `release.yml` verbatim, with the version-resolution step generalized:

```yaml
# Reusable macOS test gate (shared by release.yml and
# release-branch-test.yml so the pre-tag gate and the tag-time safety
# net can never drift — see docs/superpowers/specs/
# 2026-08-04-release-pretag-gate-design.md §1). Runs the full validate
# gate on macos-latest; `version` empty means "no expected version"
# (branch runs): it is resolved from package.json and the drift check
# then only asserts the three version files agree with each other.
name: test-suite

on:
  workflow_call:
    inputs:
      version:
        description: 'Expected version (leading v tolerated); empty resolves from package.json'
        required: false
        type: string
        default: ''
    outputs:
      version:
        description: 'Resolved bare semver'
        value: ${{ jobs.test.outputs.version }}

jobs:
  test:
    runs-on: macos-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - name: Resolve version
        id: version
        run: |
          v="${{ inputs.version }}"
          v="${v#v}"
          if [ -z "$v" ]; then
            v=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
          fi
          echo "version=$v" >> "$GITHUB_OUTPUT"
      - name: Version check (no silent drift)
        run: |
          v="${{ steps.version.outputs.version }}"
          fail=0
          for f in package.json src-tauri/tauri.conf.json; do
            got=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf8')).version")
            if [ "$got" != "$v" ]; then echo "::error::$f has $got, releasing $v"; fail=1; fi
          done
          got=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
          if [ "$got" != "$v" ]; then echo "::error::src-tauri/Cargo.toml has $got, releasing $v"; fail=1; fi
          exit $fail
      - run: npm ci
      - name: Dependency audit — npm production tree (SPEC11 §6.7)
        run: npm audit --omit=dev --audit-level=high
      - name: Dependency audit — cargo advisories (SPEC11 §6.7)
        run: |
          cargo install cargo-audit --locked
          cargo audit --file src-tauri/Cargo.lock
      - run: npx playwright install chromium
      - run: npm run validate
```

- [ ] **Step 2: Replace `release.yml`'s `test` job with a caller**

Replace the entire `test:` job (from `  test:` through the `- run: npm run validate` line, i.e. everything before `  build-macos:`) with:

```yaml
  # The same reusable suite release-branch-test.yml runs pre-tag; here
  # it is the redundant safety net gating the builds (spec §1).
  test:
    uses: ./.github/workflows/test-suite.yml
    with:
      version: ${{ github.event_name == 'push' && github.ref_name || inputs.version }}
```

Do NOT touch the header comment, `on:`, `concurrency:`, or the `build-macos`/`build-web`/`release` jobs — `needs.test.outputs.version` keeps working because the reusable workflow re-exports the output.

- [ ] **Step 3: Create `release-branch-test.yml`**

```yaml
# Pre-tag CI gate (spec §1–2): fires on every release/** branch push, so
# the releaser can watch it and only spend the tag once macOS is green.
# cancel-in-progress: a retry force-pushes a re-cut branch; the
# superseded run is worthless.
name: release-branch-test

on:
  push:
    branches: ['release/**']

concurrency:
  group: release-branch-test-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    uses: ./.github/workflows/test-suite.yml
```

- [ ] **Step 4: Verify the YAML parses**

Run: `for f in .github/workflows/test-suite.yml .github/workflows/release-branch-test.yml .github/workflows/release.yml; do npx --yes js-yaml "$f" > /dev/null && echo "OK $f"; done`
Expected: three `OK` lines, no parse errors.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/test-suite.yml .github/workflows/release-branch-test.yml .github/workflows/release.yml
git commit -m "feat: reusable macOS test suite + pre-tag release-branch gate (spec §1)"
```

---

### Task 2: `release-lane.mts` — new marker, `parseBlockedBy`, `releaseOutcome`

**Files:**
- Modify: `.sandcastle/release-lane.mts` (marker block ~line 201; new functions after `parseMarkerPresent` ~line 180)
- Test: `tests/unit/release-lane.test.ts`

**Interfaces:**
- Produces:
  - `PRETAG_CI_GREEN_MARKER: string` = `"🏰 Sandcastle releaser: pre-tag CI green"`
  - `parseBlockedBy(json: string): number | null` — bug number from the `Blocked-by: #<n>` line of the **newest** comment starting with `CUT_FAILED_MARKER`; null when absent. Input: `gh issue view <n> --json comments` JSON.
  - `releaseOutcome(json: string): ReleaseOutcome` where `export interface ReleaseOutcome { level: "ok" | "failed" | "incomplete"; text: string }` — newest phase-marker comment decides: `AWAITING_PUBLISH_MARKER` ⇒ ok, `CUT_FAILED_MARKER` ⇒ failed, anything else (or none) ⇒ incomplete.

- [ ] **Step 1: Write the failing tests**

Append to the `cut-phase classification` describe block's file (new describe at the end of `tests/unit/release-lane.test.ts`), and extend U209's `markers` array with `PRETAG_CI_GREEN_MARKER` (import it too):

```ts
describe('spec 2026-08-04 §4 failure-flow parsing', () => {
  const comments = (...bodies: string[]) =>
    JSON.stringify({ comments: bodies.map((body) => ({ body })) });

  test('U212: parseBlockedBy reads the Blocked-by line of the newest cut-failed comment only', () => {
    expect(
      parseBlockedBy(
        comments(
          `${CUT_FAILED_MARKER}\n\nold failure\nBlocked-by: #41`,
          `${TAG_PUSHED_MARKER}\n\nretry got further`,
          `${CUT_FAILED_MARKER}\n\nnew failure\nBlocked-by: #67\nmore text`,
        ),
      ),
    ).toBe(67);
    expect(parseBlockedBy(comments(`${CUT_FAILED_MARKER}\n\nno link here`))).toBe(null);
    expect(parseBlockedBy(comments('owner chatter'))).toBe(null);
    expect(parseBlockedBy(JSON.stringify({}))).toBe(null);
  });

  test('U213: releaseOutcome maps the newest phase marker — awaiting-publish ok, cut-failed failed, all else incomplete', () => {
    expect(releaseOutcome(comments(`${AWAITING_PUBLISH_MARKER}\n\ndraft url`)).level).toBe('ok');
    expect(
      releaseOutcome(comments(`${GATE_PASSED_MARKER}\n\n…`, `${CUT_FAILED_MARKER}\n\nE150`)).level,
    ).toBe('failed');
    // A retry that got past its old failure is no longer "failed".
    expect(
      releaseOutcome(
        comments(`${CUT_FAILED_MARKER}\n\nold`, `${PREFLIGHT_ACK_MARKER}\n\nretrying`),
      ).level,
    ).toBe('incomplete');
    expect(releaseOutcome(comments('owner chatter')).level).toBe('incomplete');
    expect(releaseOutcome(JSON.stringify({})).level).toBe('incomplete');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/release-lane.test.ts`
Expected: FAIL — `parseBlockedBy` / `releaseOutcome` / `PRETAG_CI_GREEN_MARKER` not exported.

- [ ] **Step 3: Implement in `release-lane.mts`**

Add the marker beside the others (after `CI_GREEN_MARKER`, keeping the R17 comment block intact):

```ts
/** Spec 2026-08-04 §2: pre-tag branch CI green — posted between the
 * gate-passed and tag-pushed markers; the tag is only spent after it. */
export const PRETAG_CI_GREEN_MARKER = "🏰 Sandcastle releaser: pre-tag CI green";
```

Add after `parseMarkerPresent`:

```ts
// ---------------------------------------------------------------------------
// Spec 2026-08-04 §4: failure-flow parsing. A failed cut's comment links the
// sandcastle bug that blocks it; the outcome of a releaser run is read back
// from the newest phase marker rather than trusted from process exit.
// ---------------------------------------------------------------------------

const PHASE_MARKERS = (): string[] => [
  MALFORMED_MARKER,
  OUT_OF_ORDER_MARKER,
  DRAFT_REPORT_MARKER,
  PREFLIGHT_ACK_MARKER,
  GATE_PASSED_MARKER,
  PRETAG_CI_GREEN_MARKER,
  CUT_FAILED_MARKER,
  TAG_PUSHED_MARKER,
  CI_GREEN_MARKER,
  DRAFT_VERIFIED_MARKER,
  WINDOWS_APPENDED_MARKER,
  AWAITING_PUBLISH_MARKER,
];

/** The bug number from the `Blocked-by: #<n>` line of the newest
 * cut-failed comment; null when no cut-failed comment or no line. */
export const parseBlockedBy = (json: string): number | null => {
  const view = JSON.parse(json) as { comments?: { body?: string }[] };
  const all = view.comments ?? [];
  for (let i = all.length - 1; i >= 0; i--) {
    const body = all[i].body ?? "";
    if (body.trimStart().startsWith(CUT_FAILED_MARKER)) {
      const m = body.match(/^Blocked-by: #(\d+)\s*$/m);
      return m ? Number(m[1]) : null;
    }
  }
  return null;
};

export interface ReleaseOutcome {
  level: "ok" | "failed" | "incomplete";
  text: string;
}

/** The run's semantic outcome, from the newest comment that starts with a
 * phase marker. Only awaiting-publish is terminal success; a cut-failed
 * newest marker is a failed cut; anything else means the run ended mid-cut. */
export const releaseOutcome = (json: string): ReleaseOutcome => {
  const view = JSON.parse(json) as { comments?: { body?: string }[] };
  let last: string | null = null;
  for (const comment of view.comments ?? []) {
    const body = (comment.body ?? "").trimStart();
    const marker = PHASE_MARKERS().find((m) => body.startsWith(m));
    if (marker !== undefined) last = marker;
  }
  if (last === AWAITING_PUBLISH_MARKER)
    return { level: "ok", text: "cut complete, awaiting publish" };
  if (last === CUT_FAILED_MARKER) return { level: "failed", text: "cut failed" };
  return {
    level: "incomplete",
    text: last === null ? "no phase marker posted" : `stopped after "${last}"`,
  };
};
```

(Note: `PHASE_MARKERS` is a function, not a top-level const, because the marker consts are declared later in the file — module-eval order. Do not reorder the file.)

- [ ] **Step 4: Run to verify green (including extended U209)**

Run: `npx vitest run tests/unit/release-lane.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .sandcastle/release-lane.mts tests/unit/release-lane.test.ts
git commit -m "feat: pre-tag marker, parseBlockedBy, releaseOutcome (spec §2,4)"
```

---

### Task 3: `release-lane.mts` — `parked` classification

**Files:**
- Modify: `.sandcastle/release-lane.mts` (`ReleaseAction` union + `classifyReleaseIssue`, ~lines 250-303)
- Test: `tests/unit/release-lane.test.ts`

**Interfaces:**
- Consumes: `parseBlockedBy` / `releaseOutcome` exist (Task 2) — the *host* computes the new inputs from them; the classifier itself stays pure.
- Produces: `ReleaseAction` gains `{ kind: "parked"; bug: number | null }`. `classifyReleaseIssue` input gains three required fields: `cutFailedActive: boolean` (newest phase marker is cut-failed), `blockedByBug: number | null`, `blockingBugOpen: boolean | null` (null = unknown/unresolvable).

- [ ] **Step 1: Write the failing tests**

In the existing `cut-phase classification` describe block, extend the `fresh` helper with the three new fields defaulting inert, then add:

```ts
const fresh = (b: string) => ({
  body: b,
  tagNames: TAGS,
  draftTags: [],
  draftReportPosted: false,
  awaitingPublishPosted: false,
  tagPushedPosted: false,
  cutFailedActive: false,
  blockedByBug: null as number | null,
  blockingBugOpen: null as boolean | null,
});
```

```ts
test('U214: an active cut-failed parks the release while its bug is open, unknown, or unlinked — never dispatching a sandbox', () => {
  expect(
    classifyReleaseIssue({
      ...fresh(body('0.5.0-alpha.1', 'both')),
      tagPushedPosted: true,
      cutFailedActive: true,
      blockedByBug: 67,
      blockingBugOpen: true,
    }),
  ).toEqual({ kind: 'parked', bug: 67 });
  // Unknown bug state fails safe: parked.
  expect(
    classifyReleaseIssue({
      ...fresh(body('0.5.0-alpha.1', 'both')),
      cutFailedActive: true,
      blockedByBug: 67,
      blockingBugOpen: null,
    }).kind,
  ).toBe('parked');
  // Legacy cut-failed with no Blocked-by line: parked with bug null.
  expect(
    classifyReleaseIssue({
      ...fresh(body('0.5.0-alpha.1', 'both')),
      tagPushedPosted: true,
      cutFailedActive: true,
    }),
  ).toEqual({ kind: 'parked', bug: null });
});

test('U215: a closed blocking bug un-parks — the cut resumes (proceed), and terminal/guard states still dominate', () => {
  expect(
    classifyReleaseIssue({
      ...fresh(body('0.5.0-alpha.1', 'both')),
      tagPushedPosted: true,
      cutFailedActive: true,
      blockedByBug: 67,
      blockingBugOpen: false,
    }).kind,
  ).toBe('proceed');
  // Pre-tag failure (no tag pushed): closed bug resumes through the
  // ordering guard as a fresh cut of the same, still-unspent version.
  expect(
    classifyReleaseIssue({
      ...fresh(body('0.5.0-alpha.1', 'both')),
      cutFailedActive: true,
      blockedByBug: 67,
      blockingBugOpen: false,
    }).kind,
  ).toBe('proceed');
  // awaiting-publish and malformed still outrank parking.
  expect(
    classifyReleaseIssue({
      ...fresh(body('0.5.0-alpha.1', 'both')),
      awaitingPublishPosted: true,
      cutFailedActive: true,
      blockedByBug: 67,
      blockingBugOpen: true,
    }).kind,
  ).toBe('awaiting-publish');
  expect(
    classifyReleaseIssue({
      ...fresh('no structure'),
      cutFailedActive: true,
    }).kind,
  ).toBe('malformed');
});
```

Note U215 uses version `0.5.0-alpha.1` against the `TAGS` list (newest `v0.4.0-alpha.5`), so the ordering guard passes.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/release-lane.test.ts`
Expected: FAIL — `cutFailedActive` unknown field / kind `parked` never returned. (U205–U208 keep passing: the extended `fresh` supplies inert values.)

- [ ] **Step 3: Implement**

Extend the union:

```ts
export type ReleaseAction =
  | { kind: "malformed"; problems: string[] }
  | { kind: "awaiting-publish"; spec: ReleaseSpec }
  | { kind: "parked"; bug: number | null }
  | { kind: "windows-append"; spec: ReleaseSpec }
  | { kind: "out-of-order"; version: string; newestTag: string }
  | { kind: "drafts-to-report"; spec: ReleaseSpec; drafts: string[] }
  | { kind: "proceed"; spec: ReleaseSpec };
```

Extend the input type with the three fields (documented like the existing ones), and insert between the `awaitingPublishPosted` check and the `tagPushedPosted` check:

```ts
  // Spec 2026-08-04 §4: a cut whose newest phase marker is cut-failed is
  // dead until its blocking bug closes. Park — no sandbox — unless the
  // linked bug is known-closed; a missing link or unknown bug state also
  // parks (fail safe: never dispatch at a known-dead cut).
  if (input.cutFailedActive) {
    const bugKnownClosed = input.blockedByBug !== null && input.blockingBugOpen === false;
    if (!bugKnownClosed) return { kind: "parked", bug: input.blockedByBug };
  }
```

- [ ] **Step 4: Run all unit tests + typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS. (Full suite, not just release-lane: `main.ts` won't compile against the new required fields yet only if it's type-checked — it is wired in Task 4; if `npm run typecheck` fails ONLY in `main.ts`'s `classifyReleaseIssue` call with missing fields, that is expected mid-flight: proceed to Task 4 before committing typecheck-green, but the unit tests must pass now.)

- [ ] **Step 5: Commit** (fold with Task 4's commit if typecheck is mid-flight red; otherwise commit here)

```bash
git add .sandcastle/release-lane.mts tests/unit/release-lane.test.ts
git commit -m "feat: parked classification for cut-failed releases (spec §4)"
```

---

### Task 4: Host wiring — `github.issueState`, parking, loud outcome reporting

**Files:**
- Modify: `.sandcastle/github.mts` (add helper near `issueCommentsJson`, ~line 112)
- Modify: `.sandcastle/main.ts` (`runReleaseLane`, lines 763-901; imports ~line 91)

**Interfaces:**
- Consumes: `parseBlockedBy`, `releaseOutcome`, `ReleaseOutcome`, `parked` kind (Tasks 2-3).
- Produces: `github.issueState(issueNumber: number): Promise<string>` returning the raw `gh` state (`"OPEN"` / `"CLOSED"`).

- [ ] **Step 1: Add `issueState` to `github.mts`**

```ts
/** Spec 2026-08-04 §4: state of the bug blocking a failed cut. */
export const issueState = (issueNumber: number): Promise<string> =>
  gh(["issue", "view", String(issueNumber), "--json", "state", "-q", ".state"]);
```

(Match the file's existing style — `issueCommentsJson` directly above is the template. `gh` output may carry a trailing newline; callers compare with `.trim()`.)

- [ ] **Step 2: Wire classification inputs in `main.ts`**

Add to the release-lane import block (line ~91): `parseBlockedBy`, `releaseOutcome`, `PRETAG_CI_GREEN_MARKER`, and type `ReleaseOutcome`.

In `runReleaseLane`, replace the classify call (currently `action = classifyReleaseIssue({ body: issue.body, tagNames, draftTags, draftReportPosted..., awaitingPublishPosted..., tagPushedPosted... })`) with:

```ts
      commentsJson = await github.issueCommentsJson(issue.number);
      // Spec 2026-08-04 §4: the newest phase marker decides whether the
      // cut is dead; a linked open bug parks it host-side (no sandbox).
      const cutFailedActive = releaseOutcome(commentsJson).level === "failed";
      const blockedByBug = parseBlockedBy(commentsJson);
      let blockingBugOpen: boolean | null = null;
      if (cutFailedActive && blockedByBug !== null) {
        try {
          blockingBugOpen = (await github.issueState(blockedByBug)).trim() === "OPEN";
        } catch {
          blockingBugOpen = null; // unknown state parks (fail safe)
        }
      }
      action = classifyReleaseIssue({
        body: issue.body,
        tagNames,
        draftTags,
        draftReportPosted: parseMarkerPresent(commentsJson, DRAFT_REPORT_MARKER),
        awaitingPublishPosted: parseMarkerPresent(commentsJson, AWAITING_PUBLISH_MARKER),
        tagPushedPosted: parseMarkerPresent(commentsJson, TAG_PUSHED_MARKER),
        cutFailedActive,
        blockedByBug,
        blockingBugOpen,
      });
```

- [ ] **Step 3: Handle `parked` after the `release #n → kind` log line**

Insert directly after `console.log(\`  release #${issue.number} → ${action.kind}\`);`:

```ts
    // Spec 2026-08-04 §4: a parked cut waits for its bug — never a sandbox.
    if (action.kind === "parked") {
      console.warn(
        action.bug === null
          ? `  ⚠ release #${issue.number}: cut failed with no linked bug — read the issue thread and close or re-arm it yourself.`
          : `  release #${issue.number}: parked on open bug #${action.bug} — fix lands via npm run sandcastle; the cut auto-resumes when the bug closes.`,
      );
      continue;
    }
```

- [ ] **Step 4: Loud outcome reporting after the releaser run**

Above `runReleaseLane`, define:

```ts
/** Spec 2026-08-04 §4: thrown inside the timed releaser callback when the
 * run's newest phase marker is not terminal success — marks the timing
 * entry failed and carries the outcome for the console line. */
class ReleaseCutNotOk extends Error {
  constructor(
    readonly outcome: ReleaseOutcome,
    readonly bug: number | null,
  ) {
    super(outcome.text);
  }
}
```

Replace the `timed("releaser", ...)` call body so the outcome is derived before the callback resolves:

```ts
        await timed("releaser", { issue: issue.number }, async () => {
          await sandbox.run({
            name: "releaser",
            maxIterations: 1,
            agent: sandcastle.claudeCode(releaserModel),
            promptFile: "./.sandcastle/release-prompt.md",
            promptArgs: {
              ISSUE_NUMBER: issue.number,
              VERSION: spec.version,
              PLATFORMS: spec.platforms,
              REPO: repo,
              MODE: action.kind === "windows-append" ? "windows-append" : "full-cut",
              CHANGELOG: spec.changelog,
              PREFLIGHT_ACK_MARKER,
              GATE_PASSED_MARKER,
              CUT_FAILED_MARKER,
              PRETAG_CI_GREEN_MARKER,
              TAG_PUSHED_MARKER,
              CI_GREEN_MARKER,
              DRAFT_VERIFIED_MARKER,
              WINDOWS_APPENDED_MARKER,
              AWAITING_PUBLISH_MARKER,
            },
          });
          // Spec §4: never trust process exit — read the cut's outcome
          // back from the issue's newest phase marker.
          const afterJson = await github.issueCommentsJson(issue.number);
          const outcome = releaseOutcome(afterJson);
          if (outcome.level !== "ok")
            throw new ReleaseCutNotOk(outcome, parseBlockedBy(afterJson));
          console.log(`  ✔ release #${issue.number}: ${outcome.text}`);
        });
```

(Note `PRETAG_CI_GREEN_MARKER` joins `promptArgs` here, in the same commit as the runbook gains its `{{PRETAG_CI_GREEN_MARKER}}` placeholder — Task 5 — so the prompt-args drift test only sees consistent states at commit boundaries. If splitting the commits, run the drift test after both.)

Extend the existing `catch (error)` on the dispatch:

```ts
    } catch (error) {
      if (error instanceof ReleaseCutNotOk) {
        console.warn(
          error.bug !== null
            ? `  ✖ release #${issue.number}: ${error.outcome.text.toUpperCase()} — bug #${error.bug} filed; fix it via npm run sandcastle, the cut auto-resumes when it closes.`
            : `  ✖ release #${issue.number}: ${error.outcome.text.toUpperCase()} — see the issue thread for evidence.`,
        );
      } else {
        console.warn(
          `  ⚠ release lane: releaser for #${issue.number} failed (${error instanceof Error ? error.message.split("\n", 1)[0] : error}) — the issue stays open for the next run.`,
        );
      }
    }
```

- [ ] **Step 5: Typecheck + full unit suite**

Run: `npm run typecheck && npm run test:unit`
Expected: PASS (the prompt-args drift test may fail until Task 5 adds the placeholder — if so, do Task 5 before committing).

- [ ] **Step 6: Commit** (with Task 5 if the drift test demands it)

```bash
git add .sandcastle/github.mts .sandcastle/main.ts
git commit -m "feat: park failed cuts, report releaser outcome loudly (spec §4)"
```

---

### Task 5: Runbook — pre-tag gate + failure flow in `release-prompt.md`

**Files:**
- Modify: `.sandcastle/release-prompt.md` (Phase 2 section; the `**Failure (R10)**` paragraph; RESUME section; HARD RULES)

**Interfaces:**
- Consumes: `{{PRETAG_CI_GREEN_MARKER}}` placeholder ↔ `promptArgs` entry from Task 4.

- [ ] **Step 1: Replace the Phase 2 section**

Replace from `## Phase 2 — push, tag, merge back (R11, R15)` down to (and including) the paragraph `Post one comment starting \`{{TAG_PUSHED_MARKER}}\` noting the branch, the tag, and that the merge-back landed.` with:

```markdown
## Phase 2a — push the branch, watch the pre-tag CI

The sandbox normally has no push credentials — agents don't push; the
host does (see `pushBranch` in `.sandcastle/main.ts`). The releaser is
the sanctioned exception (prd/008 R11): establish credentials yourself
with `gh auth setup-git`, then push **the branch only — no tag yet**:

    git push -u origin release/v{{VERSION}}

(On a retry after a failed attempt, the branch already exists with the
old attempt's commits: push with `--force-with-lease` instead. Updating
a not-yet-tagged release branch is sanctioned; deleting one never is.)

The push triggers the `release-branch-test` workflow — the same macOS
test suite the tag-time pipeline runs, moved before the tag so a
failure spends nothing. Find the run for your exact branch tip
(`gh run list --workflow release-branch-test.yml`, match its head SHA
to `git rev-parse HEAD`; allow a minute for the trigger — if no run
appears after ~5 minutes of polling, treat that itself as a cut
failure, evidence being the empty `gh run list` output). Watch it to
completion, polling about once a minute.

- On failure → the failure flow below, and STOP. Nothing is spent: no
  tag, no merge-back, main untouched — the version stays reusable.
- On success → post one comment starting `{{PRETAG_CI_GREEN_MARKER}}`
  with the run URL, then continue.

## Phase 2b — tag + merge back, only on green (R11, R15 amended)

1. `git tag -a v{{VERSION}} -m "Marky Mark {{VERSION}}"` on the release
   branch tip, then `git push origin v{{VERSION}}` — the tag points into
   the release branch, and its push starts the mac+web pipeline.
2. Merge back (R15, now gated on the pre-tag CI being green, so main
   only ever carries the version files of a cut that passed macOS
   tests): merge the release branch into the default branch —

       git checkout -b mergeback-v{{VERSION}} origin/main
       git merge --no-edit release/v{{VERSION}}
       git push origin HEAD:main

   (If the push is rejected because main moved, `git fetch origin`,
   merge `origin/main` in, and retry. On resume, skip when
   `git merge-base --is-ancestor release/v{{VERSION}} origin/main`
   already holds.) The `release/v{{VERSION}}` branch itself is
   **permanent** — never delete it (the #57 guard).

Post one comment starting `{{TAG_PUSHED_MARKER}}` noting the branch,
the tag, and that the merge-back landed.
```

- [ ] **Step 2: Replace the `**Failure (R10)**` paragraph (in Phase 1)**

Replace the paragraph starting `**Failure (R10):** if any step fails, post one comment starting` (through `Never tag or push after a failure.`) with:

```markdown
**Failure flow (R10, amended by spec 2026-08-04):** if any step fails —
the local gate here, the pre-tag branch CI (phase 2a), the tag-triggered
run (phase 3), or the Windows run (phase 5) — do all of this, then STOP:

1. Unless the newest `{{CUT_FAILED_MARKER}}` comment already links an
   open bug for this same failure, file **one** bug issue:

       gh issue create --label sandcastle \
         --title "Release cut failed: <failing step or test id>" \
         --body "<what failed, the CI run URL if CI failed, the tail of
                 the failing output, and the line:
                 Blocks release #{{ISSUE_NUMBER}}.>"

2. Post one comment starting `{{CUT_FAILED_MARKER}}` naming the failing
   step plus the tail of its output, containing **on its own line**
   exactly `Blocked-by: #<bug-number>`, and telling the owner: the fix
   flows through the normal `npm run sandcastle` implement lane, and
   this release auto-resumes once that bug closes.
3. If filing the bug itself failed, still post the cut-failed comment —
   just without the Blocked-by line — and say the bug could not be
   filed.

A failure in phase 1 or 2a has pushed no tag and touched neither main
nor any release: the version stays reusable and the retry re-cuts it.
Never tag, merge back, or push anything further after a failure.
```

- [ ] **Step 3: Add retry semantics to the RESUME section**

After the existing bullet ending `is redone (without duplicating the comment).` add:

```markdown
- A `{{CUT_FAILED_MARKER}}` comment **newer than every other phase
  marker** means the last attempt failed and you were re-dispatched
  because its blocking bug closed. Start a fresh attempt: re-cut
  `release/v{{VERSION}}` from current `origin/main` (phase 1's
  `git checkout -B`), force-push in phase 2a, and post each phase's
  comment again for this attempt — markers older than that cut-failed
  comment belong to the failed attempt and do not count as done.
```

- [ ] **Step 4: Update HARD RULES**

Replace `- A failed gate aborts before any push or tag exists (prd/008 R10).` with:

```markdown
- A failed local gate aborts before any push exists; a failed pre-tag
  CI aborts before any tag or merge-back exists (prd/008 R10, amended
  by spec 2026-08-04). Every failure files its blocking bug per the
  failure flow.
```

- [ ] **Step 5: Verify placeholder ↔ promptArgs consistency and run everything**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS — in particular the prompt-args drift tests (U210/U211 family in `tests/unit/prompt-args.test.mts` / `new-release-skill.test.ts`) must see `{{PRETAG_CI_GREEN_MARKER}}` in the prompt and in `main.ts` promptArgs.

- [ ] **Step 6: Commit**

```bash
git add .sandcastle/release-prompt.md
git commit -m "feat: runbook — pre-tag CI gate, bug-filing failure flow, retry semantics (spec §2-3)"
```

---

### Task 6: Documentation consistency — `prd/008` amendment note + `RELEASING.md`

**Files:**
- Modify: `prd/008-releaser-agent.md` (append a short amendment note at the end)
- Modify: `docs/RELEASING.md` (note the pre-tag branch gate near the "tag push is the trigger" rules-of-thumb, ~line 76)

- [ ] **Step 1: Append to `prd/008-releaser-agent.md`**

```markdown
## Amendment 2026-08-04 — pre-tag CI gate and failure flow

Superseding parts of R10/R11/R15/R17; full design in
`docs/superpowers/specs/2026-08-04-release-pretag-gate-design.md`.
The macOS test suite now runs on the release branch push
(`release-branch-test.yml`) **before** the tag is spent; the merge-back
is gated on that run being green. A failed cut files a
`sandcastle`-labeled bug (linked via `Blocked-by: #n` in the cut-failed
comment); the lane parks the release while that bug is open and
auto-resumes when it closes. The host reports every releaser run's
outcome from the issue's newest phase marker (new marker: `pre-tag CI
green`) instead of trusting process exit.
```

- [ ] **Step 2: Update `docs/RELEASING.md` rules-of-thumb**

After the sentence `Rules of thumb: the tag push is the trigger, the draft is the safety net, and` … (complete the existing sentence, then append):

```markdown
Pushing a `release/**` branch triggers `release-branch-test.yml` — the
same macOS suite the tag run gates on — so agents (and you) can get a
green light *before* spending the tag. The agent-driven cut in
`.sandcastle/release-prompt.md` always does this; manual cuts may tag
directly and lean on the draft safety net as before.
```

- [ ] **Step 3: Commit**

```bash
git add prd/008-releaser-agent.md docs/RELEASING.md
git commit -m "docs: record pre-tag gate amendment in prd/008 and RELEASING.md"
```

---

### Task 7: One-time cleanup — file the E150 bug, close #66

**Files:** none (GitHub state only; run from the host repo checkout).

- [ ] **Step 1: File the E150 bug with the `sandcastle` label**

```bash
gh issue create --label sandcastle \
  --title "E150 presses Control+Home, a no-op on macOS — release CI (macos-latest) fails deterministically" \
  --body "$(cat <<'EOF'
The release v0.5.0-alpha.1 cut (#66) failed in the tag-triggered release.yml run
https://github.com/jorgeper/marky-mark/actions/runs/30970731325 — job `test`
(macos-latest), step `npm run validate`, e2e test E150
(`tests/e2e/live-preview.spec.ts:286`), identical on Playwright's in-run retry.

`page.keyboard.press('Control+Home')` (used at lines 212 and 299) does not move
the cursor to document start on macOS, so the revealed H1 line stays split and
the first `.mm-md-h1` span holds only " Big " instead of "Big Title":

    Error: expect(locator).toContainText(expected) failed
    Locator: getByTestId('editor').locator('.mm-md-h1:not(.mm-md-mark)').first()
    Expected substring: "Big Title"
    Received string:    " Big "

Fix shape is the implementer's call — the tests need a platform-correct
go-to-document-start (both Control+Home call sites), such that the suite passes
on macOS runners as well as Linux. The suite is macOS-green when this closes.

Blocks release #66 (that cut is abandoned; the next release re-files as
0.5.0-alpha.2 once this lands).
EOF
)"
```

- [ ] **Step 2: Close #66 with an explanatory comment**

```bash
gh issue close 66 --comment "Closing: the v0.5.0-alpha.1 cut is abandoned — the tag and merge-back were spent before CI caught the macOS-only E150 failure (bug: see the sandcastle issue filed for E150). Tag v0.5.0-alpha.1 and branch release/v0.5.0-alpha.1 remain per the immutability rules. The next release re-files via /new-release as 0.5.0-alpha.2 once the fix lands. Future cuts run the macOS suite on the release branch before any tag exists (docs/superpowers/specs/2026-08-04-release-pretag-gate-design.md)."
```

- [ ] **Step 3: Verify**

Run: `gh issue view 66 --json state -q .state` → `CLOSED`; `gh issue list --label sandcastle --state open` shows the new E150 bug.

No commit (no tree changes).

---

### Task 8: Final gate

- [ ] **Step 1: Run the quick gate**

Run: `npm run validate:quick`
Expected: `QUICK VALIDATION: ALL PASSED`.

**Known-failure contingency:** this machine is macOS, and the E150 bug (Task 7) is exactly a macOS-only e2e failure — `validate:quick` includes the desktop-shim e2e suite, so E150 may fail here for the pre-existing reason this whole plan exists. If E150 (and only E150) fails: re-run just it to confirm (`npx playwright test -g 'E150'`), and report the gate as "all passed except the pre-existing, already-filed E150 macOS failure". Any OTHER failure must be investigated as possibly caused by this work.

- [ ] **Step 2: Verify no drift between CLAUDE.md's verify commands and config**

The plan touched neither `QUICK_VERIFY_COMMANDS`/`VERIFY_COMMANDS` in `.sandcastle/config.mts` nor CLAUDE.md's verification section — confirm with `git diff origin/main --stat -- .sandcastle/config.mts CLAUDE.md` (expect empty).

- [ ] **Step 3: Hand off**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR for `release-pretag-gate`.
