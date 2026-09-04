import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  COPY_LINK_FILE_LABEL,
  COPY_LINK_HEADING_LABEL,
  COPY_LINK_WORKSPACE_LABEL,
  LINK_COPIED_LABEL,
  LINK_COPIED_MS,
  createCopyLinkController,
  fileShareUrl,
  headingAnchors,
  headingLineForSlug,
  headingShareUrl,
  headingSlug,
  slugFromHash,
  workspaceShareUrl,
} from '../../src/lib/shareLinks';
import { parseSections } from '../../src/lib/sectionModel';

afterEach(() => {
  vi.useRealTimers(); // the suite shares workers: never leave fake timers installed
});

const ORIGIN = 'https://mm.example';

describe('PRD 020 Reqs 16–17 copy-link URL selection', () => {
  // Intent: the workspace placement copies exactly `/<workspace-name>` on the
  // page's own origin — from any canonical pathname, workspace-deep or
  // file-deep — and copies nothing off a workspace path.
  test('U1079: workspaceShareUrl answers origin + /<name> from any workspace pathname, null elsewhere', () => {
    expect(workspaceShareUrl(ORIGIN, '/notes')).toBe(`${ORIGIN}/notes`);
    expect(workspaceShareUrl(ORIGIN, '/notes/guides/intro%20guide.md')).toBe(`${ORIGIN}/notes`);
    // The name segment is re-encoded through buildAppPath, so the copied text
    // matches what a fresh visit canonicalizes to.
    expect(workspaceShareUrl(ORIGIN, '/team%20docs/a.md')).toBe(`${ORIGIN}/team%20docs`);
    // Off-workspace pages copy nothing: the start page and the reserved
    // scratch entry route (PRD 020 Req 11 replaced /scratchpad, which now
    // resolves like any workspace name) are not workspace addresses.
    expect(workspaceShareUrl(ORIGIN, '/')).toBeNull();
    expect(workspaceShareUrl(ORIGIN, '/scratch')).toBeNull();
  });

  // Intent: the file placement copies the open file's Req 5 URL — the whole
  // canonical path, per-segment percent-encoded, never a fragment — and
  // answers null while no file rides the path (the control's inert edge).
  test('U1080: fileShareUrl answers the file-deep Req 5 URL, null without a file segment', () => {
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
  test('U1081: a landed copy confirms for LINK_COPIED_MS, and a re-click restarts the window', async () => {
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
  test('U1082: a rejected write or a null URL says nothing rather than lying', async () => {
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
  // the window stays ~2 seconds (the PRD's own figure). Issue #227: each
  // placement's rest label names its target; only the confirmation is shared.
  test('U1083: the rest and confirmation labels, and the ~2s window', () => {
    expect(COPY_LINK_WORKSPACE_LABEL).toBe('Copy link to workspace');
    expect(COPY_LINK_FILE_LABEL).toBe('Copy link to file');
    expect(COPY_LINK_HEADING_LABEL).toBe('Copy link to heading');
    expect(LINK_COPIED_LABEL).toBe('Link copied');
    expect(LINK_COPIED_MS).toBe(2000);
  });
});

describe('PRD 020 Req 18 heading slugs', () => {
  // Intent: GitHub's slug rules — lowercase, punctuation dropped, each space
  // becomes a hyphen ("A & B" keeps GitHub's double hyphen) — and the edges:
  // unicode letters survive, connector punctuation survives, an all-punctuation
  // title slugs to the empty string rather than throwing.
  test('U1073: headingSlug lowercases, drops punctuation, and maps spaces to hyphens one-for-one', () => {
    expect(headingSlug('Getting Started')).toBe('getting-started');
    expect(headingSlug('Set Up & Go')).toBe('set-up--go');
    expect(headingSlug("What's new? (v2.1)")).toBe('whats-new-v21');
    expect(headingSlug('snake_case_stays')).toBe('snake_case_stays');
    expect(headingSlug('Héllo Wörld — Ünïcode')).toBe('héllo-wörld--ünïcode');
    expect(headingSlug('日本語の見出し')).toBe('日本語の見出し');
    expect(headingSlug('already-hyphen-ed')).toBe('already-hyphen-ed');
    expect(headingSlug('!!!')).toBe('');
  });

  // Intent: slugs come from the SECTION MODEL's titles in document order —
  // nested headings included, the preamble skipped — and duplicates dedupe
  // GitHub-style: first bare, then -1, -2… in document order, counted per
  // base slug (two different titles that slug identically collide too).
  test('U1074: headingAnchors walks the model in document order and dedupes -1, -2…', () => {
    const doc = parseSections(
      ['intro text', '# Alpha', '## Notes', 'a', '# Beta', '## Notes', 'b', '### Notes!', '## Notes', ''].join('\n'),
    );
    expect(headingAnchors(doc)).toEqual([
      { line: 2, slug: 'alpha', title: 'Alpha' },
      { line: 3, slug: 'notes', title: 'Notes' },
      { line: 5, slug: 'beta', title: 'Beta' },
      { line: 6, slug: 'notes-1', title: 'Notes' },
      { line: 8, slug: 'notes-2', title: 'Notes!' },
      { line: 9, slug: 'notes-3', title: 'Notes' },
    ]);
  });

  // Intent (issue #226): headings nested inside a container — a blockquote,
  // or indented under a list item — render as real h1–h6 but are not
  // root-level mdast children, so a section-only walk never slugs them and
  // both placements (preview button, editor gutter) go dark. Anchors must
  // cover EVERY heading in document order, container-nested ones deduped in
  // the same GitHub-style sequence, and the landing side must resolve them.
  test('U1085: headingAnchors covers container-nested headings in document order, and the landing resolves them', () => {
    const doc = parseSections(
      ['# Alpha', '', '> ## Notes', '', '- item', '  ### Notes', '', '## Notes', ''].join('\n'),
    );
    expect(headingAnchors(doc)).toEqual([
      { line: 1, slug: 'alpha', title: 'Alpha' },
      { line: 3, slug: 'notes', title: 'Notes' },
      { line: 6, slug: 'notes-1', title: 'Notes' },
      { line: 8, slug: 'notes-2', title: 'Notes' },
    ]);
    expect(headingLineForSlug(doc, 'notes-1')).toBe(6);
  });

  // Intent: the heading share URL is the file's Req 5 URL plus '#<slug>',
  // slug percent-encoded — and null wherever the file URL is null, so an
  // untitled buffer or a workspace-only path shares nothing.
  test('U1075: headingShareUrl appends the encoded slug to the file URL, null without a file', () => {
    expect(headingShareUrl(ORIGIN, '/notes/guides/intro%20guide.md', 'set-up--go')).toBe(
      `${ORIGIN}/notes/guides/intro%20guide.md#set-up--go`,
    );
    expect(headingShareUrl(ORIGIN, '/notes/a.md', 'héllo')).toBe(`${ORIGIN}/notes/a.md#h%C3%A9llo`);
    expect(headingShareUrl(ORIGIN, '/notes', 'x')).toBeNull();
    expect(headingShareUrl(ORIGIN, '/', 'x')).toBeNull();
  });
});

describe('PRD 020 Req 19 heading-link landing', () => {
  // Intent: the landing side inverts the copy side — location.hash decodes
  // back to the slug (malformed escapes fall back raw, empty means none) and
  // the slug resolves to the same source line the anchor was derived from.
  test('U1076: slugFromHash decodes the visited hash and headingLineForSlug finds the line, null on a miss', () => {
    expect(slugFromHash('')).toBeNull();
    expect(slugFromHash('#')).toBeNull();
    expect(slugFromHash('#setup')).toBe('setup');
    expect(slugFromHash('#h%C3%A9llo')).toBe('héllo');
    expect(slugFromHash('#bad%zz')).toBe('bad%zz');

    const doc = parseSections(['# Alpha', '## Notes', 'a', '## Notes', 'b', ''].join('\n'));
    expect(headingLineForSlug(doc, 'alpha')).toBe(1);
    expect(headingLineForSlug(doc, 'notes')).toBe(2);
    expect(headingLineForSlug(doc, 'notes-1')).toBe(4);
    expect(headingLineForSlug(doc, 'renamed-away')).toBeNull();
  });
});
