import { describe, expect, it } from 'vitest';
import { MERGED_SAVE_NOTICE, planMergedSave } from '../../src/lib/mergedSave';
import { attachEmbedded } from '../../src/lib/embedded';
import { createAnchor, type CommentData } from '../../src/lib/anchoring';

// PRD 016 Req 9: what a merged save does to the buffer, the saved marker,
// the caret and the notice — decided by a pure function, proven without a DOM.

const comment = (id: string, body: string): CommentData => ({
  kind: 'comment',
  id,
  author: 'Ada',
  createdAt: '2026-01-01T00:00:00.000Z',
  body,
  resolved: false,
  thread: [],
  anchor: createAnchor('# Doc\n\nbody\n', 8, 12),
});

describe('PRD 016 Req 9 the merged-save plan', () => {
  it('U422: the buffer becomes the merged text, clean at it, with a non-blocking notice and no dialog', () => {
    const plan = planMergedSave({
      mergedText: '# Title\n\nmine\ntheirs\n',
      sidecarComments: [],
      mayReadComments: true,
      selection: { from: 3, to: 3 },
    });
    expect(plan.buffer).toBe('# Title\n\nmine\ntheirs\n');
    // Clean (saved) AT the merged state: savedText is the buffer itself, so
    // nothing about this save leaves the document looking dirty.
    expect(plan.savedText).toBe(plan.buffer);
    expect(plan.notice).toBe(MERGED_SAVE_NOTICE);
    expect(plan.notice.toLowerCase()).toContain('someone else');
    expect(plan.dialog).toBe(false);
  });

  it('U423: the caret is preserved best-effort — never reset to the top, clamped when it would not fit', () => {
    const merged = 'short\n';
    // A caret well inside the merged text is left exactly where it was.
    expect(planMergedSave({ mergedText: 'a much longer document\n', sidecarComments: [], mayReadComments: true, selection: { from: 9, to: 12 } }).selection).toEqual(
      { from: 9, to: 12 },
    );
    // A merged text SHORTER than the buffer clamps rather than throwing.
    const clamped = planMergedSave({
      mergedText: merged,
      sidecarComments: [],
      mayReadComments: true,
      selection: { from: 400, to: 900 },
    });
    expect(clamped.selection).toEqual({ from: merged.length, to: merged.length });
    // The failure this rule exists to prevent: a merge must not throw the
    // user back to line 1 when their caret still fits.
    expect(
      planMergedSave({ mergedText: merged, sidecarComments: [], mayReadComments: true, selection: { from: 4, to: 4 } })
        .selection.from,
    ).toBe(4);
  });

  it('U424: the document state is what a fresh open of the merged file would produce', () => {
    const body = '# Doc\n\nbody\n';
    const trailerComment = comment('c1', 'body');
    const withTrailer = attachEmbedded(body, [trailerComment], null);
    const sidecarOnly = comment('c2', 'from the sidecar');

    // An embedded trailer is stripped from the buffer and its comments are
    // merged with whatever the sidecar store already held — openDoc's rule.
    const plan = planMergedSave({
      mergedText: withTrailer,
      sidecarComments: [sidecarOnly],
      mayReadComments: true,
      selection: { from: 0, to: 0 },
    });
    expect(plan.buffer).toBe(body);
    expect(plan.comments.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(plan.stores).toEqual({ trailer: null, trailerBytes: null });

    // PRD 007 Req 17: no comment.read ⇒ no comments at all, trailer included.
    expect(
      planMergedSave({
        mergedText: withTrailer,
        sidecarComments: [sidecarOnly],
        mayReadComments: false,
        selection: { from: 0, to: 0 },
      }).comments,
    ).toEqual([]);

    // PRD 004 Req 14: a trailer this build cannot read is recorded with its
    // exact bytes, so the next save re-emits it verbatim.
    const unreadable = `${body}\n<!-- marky-mark-comments\n{not json at all\n-->\n`;
    const damaged = planMergedSave({
      mergedText: unreadable,
      sidecarComments: [],
      mayReadComments: true,
      selection: { from: 0, to: 0 },
    });
    expect(damaged.stores.trailer).not.toBeNull();
    expect(damaged.stores.trailerBytes).not.toBeNull();
  });

  it('U425: CRLF in the merged text normalizes at load, exactly as a fresh open does', () => {
    const plan = planMergedSave({
      mergedText: 'one\r\ntwo\r\n',
      sidecarComments: [],
      mayReadComments: true,
      selection: { from: 0, to: 0 },
    });
    expect(plan.buffer).toBe('one\ntwo\n');
    expect(plan.savedText).toBe(plan.buffer); // and therefore not dirty
  });
});
