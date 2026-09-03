import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  COPY_LINK_LABEL,
  LINK_COPIED_LABEL,
  LINK_COPIED_MS,
  createCopyLinkController,
  fileShareUrl,
  workspaceShareUrl,
} from '../../src/lib/shareLinks';

afterEach(() => {
  vi.useRealTimers(); // the suite shares workers: never leave fake timers installed
});

const ORIGIN = 'https://mm.example';

describe('PRD 020 Reqs 16–17 copy-link URL selection', () => {
  // Intent: the workspace placement copies exactly `/<workspace-name>` on the
  // page's own origin — from any canonical pathname, workspace-deep or
  // file-deep — and copies nothing off a workspace path.
  test('U1061: workspaceShareUrl answers origin + /<name> from any workspace pathname, null elsewhere', () => {
    expect(workspaceShareUrl(ORIGIN, '/notes')).toBe(`${ORIGIN}/notes`);
    expect(workspaceShareUrl(ORIGIN, '/notes/guides/intro%20guide.md')).toBe(`${ORIGIN}/notes`);
    // The name segment is re-encoded through buildAppPath, so the copied text
    // matches what a fresh visit canonicalizes to.
    expect(workspaceShareUrl(ORIGIN, '/team%20docs/a.md')).toBe(`${ORIGIN}/team%20docs`);
    // Off-workspace pages copy nothing: the start page and the reserved
    // scratchpad entry route are not workspace addresses.
    expect(workspaceShareUrl(ORIGIN, '/')).toBeNull();
    expect(workspaceShareUrl(ORIGIN, '/scratchpad')).toBeNull();
  });

  // Intent: the file placement copies the open file's Req 5 URL — the whole
  // canonical path, per-segment percent-encoded, never a fragment — and
  // answers null while no file rides the path (the control's inert edge).
  test('U1062: fileShareUrl answers the file-deep Req 5 URL, null without a file segment', () => {
    expect(fileShareUrl(ORIGIN, '/notes/guides/intro%20guide.md')).toBe(
      `${ORIGIN}/notes/guides/intro%20guide.md`,
    );
    // Reserved characters in a segment survive the decode/re-encode round
    // trip byte-identically.
    expect(fileShareUrl(ORIGIN, '/notes/a%23b.md')).toBe(`${ORIGIN}/notes/a%23b.md`);
    expect(fileShareUrl(ORIGIN, '/notes')).toBeNull();
    expect(fileShareUrl(ORIGIN, '/')).toBeNull();
    expect(fileShareUrl(ORIGIN, '/scratchpad')).toBeNull();
  });
});

describe('PRD 020 Req 14 copy-link confirmation contract', () => {
  // Intent: one landed copy turns the confirmation on for LINK_COPIED_MS
  // (~2s), then off — and a re-click while confirming restarts the window
  // instead of letting the older timer cut it short.
  test('U1063: a landed copy confirms for LINK_COPIED_MS, and a re-click restarts the window', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const states: boolean[] = [];
    const ctrl = createCopyLinkController(
      () => `${ORIGIN}/notes`,
      (text) => {
        writes.push(text);
        return true;
      },
      (on) => states.push(on),
    );
    await ctrl.click();
    expect(writes).toEqual([`${ORIGIN}/notes`]);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);

    // Re-click mid-window: the revert fires once, LINK_COPIED_MS after the
    // SECOND click.
    await ctrl.click();
    vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    await ctrl.click();
    vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    expect(states).toEqual([true, false, true, true]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false, true, true, false]);

    // dispose() cancels a pending revert — an unmounted control never flips
    // state afterwards.
    await ctrl.click();
    ctrl.dispose();
    const before = states.length;
    vi.advanceTimersByTime(LINK_COPIED_MS * 2);
    expect(states.length).toBe(before);
  });

  // Intent: the codeCopy contract — a rejected write, and equally a null URL
  // (no canonical address to share), leave the control at rest: no copy, no
  // confirmation, nothing pending.
  test('U1064: a rejected write or a null URL says nothing rather than lying', async () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    const refused = createCopyLinkController(
      () => `${ORIGIN}/notes`,
      () => Promise.resolve(false),
      (on) => states.push(on),
    );
    await refused.click();
    expect(states).toEqual([]);

    const writes: string[] = [];
    const inert = createCopyLinkController(
      () => null,
      (text) => {
        writes.push(text);
        return true;
      },
      (on) => states.push(on),
    );
    await inert.click();
    expect(writes).toEqual([]);
    expect(states).toEqual([]);
    vi.advanceTimersByTime(LINK_COPIED_MS * 2);
    expect(states).toEqual([]);
  });

  // Intent: the labels are the contract the tooltip and the aria-live
  // announcement carry — pinned here so a reworded control fails loudly, and
  // the window stays ~2 seconds (the PRD's own figure).
  test('U1065: the rest and confirmation labels, and the ~2s window', () => {
    expect(COPY_LINK_LABEL).toBe('Copy link');
    expect(LINK_COPIED_LABEL).toBe('Link copied');
    expect(LINK_COPIED_MS).toBe(2000);
  });
});
