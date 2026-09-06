import { describe, expect, test } from 'vitest';
import {
  annotationMenuModel,
  mapSourceRangeToRendered,
  previewAnnotationModel,
  type AnnotationMenuInput,
  type PreviewAnnotationInput,
} from '../../src/lib/annotationMenu';
import type { CommentData } from '../../src/lib/anchoring';

/** Minimal records — the model reads only id/kind (+ anchor.start for the pick). */
const comment = (id: string, start = 0): CommentData => ({
  kind: 'comment',
  id,
  author: 'a',
  createdAt: 't',
  anchor: { exact: 'x', prefix: '', suffix: '', start, end: start + 1 },
  body: 'b',
  resolved: false,
  thread: [],
});
const highlight = (id: string, start = 0): CommentData => ({
  kind: 'highlight',
  id,
  author: 'a',
  createdAt: 't',
  anchor: { exact: 'x', prefix: '', suffix: '', start, end: start + 1 },
  color: 'yellow',
});

const openGate = { commentsEnabled: true, authoringFrozen: false, canWrite: true };

const input = (over: Partial<AnnotationMenuInput> = {}): AnnotationMenuInput => ({
  gate: openGate,
  source: 'Hello **bold** world\n',
  rendered: 'Hello bold world',
  selFrom: 0,
  selTo: 0,
  head: 0,
  idsAtCaret: [],
  records: [],
  ...over,
});

describe('PRD 023 §19 editor→rendered anchoring (issue #286)', () => {
  test('U1141: unique hits map, zero hits and syntax-only ranges disable, ambiguity resolves only with an agreeing source-side count', () => {
    const source = 'Hello **bold** world\n';
    const rendered = 'Hello bold world';
    // Unique hit: the source span of "bold" (inside the markers) lands on
    // the one rendered occurrence.
    const at = source.indexOf('bold');
    expect(mapSourceRangeToRendered(source, rendered, at, at + 4)).toEqual({
      start: rendered.indexOf('bold'),
      end: rendered.indexOf('bold') + 4,
    });
    // A selection crossing inline markup maps by its VISIBLE text: markers
    // render away, the visible remainder is located.
    const cross = mapSourceRangeToRendered(source, rendered, source.indexOf('**'), source.indexOf('world') + 5);
    expect(cross).toEqual({ start: rendered.indexOf('bold'), end: rendered.length });
    // Zero hits: text absent from the rendered side disables.
    expect(mapSourceRangeToRendered(source, 'Entirely other text', at, at + 4)).toBeNull();
    // Renders away entirely: the marker pair alone has no visible text.
    expect(mapSourceRangeToRendered(source, rendered, source.indexOf('**'), source.indexOf('**') + 2)).toBeNull();
    // Empty range never maps.
    expect(mapSourceRangeToRendered(source, rendered, at, at)).toBeNull();

    // Several hits WITH a winner: matching source/rendered counts make the
    // source-side index pick the right rendered occurrence.
    const twice = 'alpha beta\n\nalpha gamma\n';
    const twiceRendered = 'alpha beta\nalpha gamma';
    const second = twice.lastIndexOf('alpha');
    expect(mapSourceRangeToRendered(twice, twiceRendered, second, second + 5)).toEqual({
      start: twiceRendered.lastIndexOf('alpha'),
      end: twiceRendered.lastIndexOf('alpha') + 5,
    });
    // Several hits WITHOUT a winner: a rendered-side count the source does
    // not agree with (here an extra occurrence) yields null — the PRD 022
    // Req 12 skip rule extended to authoring, never a guessed anchor.
    expect(
      mapSourceRangeToRendered(twice, 'alpha beta\nalpha gamma\nalpha delta', second, second + 5)
    ).toBeNull();
  });

  test('U1142: fenced code bodies map verbatim; fence delimiters and empty lines resolve to nothing', () => {
    const source = 'intro\n\n```\ncode word\n```\n';
    const rendered = 'intro\ncode word';
    // A caret-word inside the fence BODY maps (fence bodies render verbatim).
    const w = source.indexOf('word');
    expect(mapSourceRangeToRendered(source, rendered, w, w + 4)).toEqual({
      start: rendered.indexOf('word'),
      end: rendered.indexOf('word') + 4,
    });
    // The fence delimiter line renders NOTHING — a range on it disables.
    const fence = source.indexOf('```');
    expect(mapSourceRangeToRendered(source, rendered, fence, fence + 3)).toBeNull();
    // The model: an empty-line caret has no word — insert and colors disable.
    const model = annotationMenuModel(
      input({ source, rendered, selFrom: 6, selTo: 6, head: 6 })
    );
    expect(model.show).toBe(true);
    expect(model.insertCommentEnabled).toBe(false);
    expect(model.colorsEnabled).toBe(false);
    expect(model.anchor).toBeNull();
  });
});

describe('PRD 023 §§7–11 annotation menu context model (issue #286)', () => {
  test('U1143: the gate closes as a whole for comments-off, frozen store, and missing comment.write', () => {
    const sel = { selFrom: 6, selTo: 10, head: 10 };
    for (const gate of [
      { ...openGate, commentsEnabled: false },
      { ...openGate, authoringFrozen: true },
      { ...openGate, canWrite: false },
    ]) {
      const model = annotationMenuModel(input({ ...sel, gate }));
      // §7: absence is the pinned expression — show:false removes BOTH
      // entries from the menu entirely (SmartMenuCtx.annotations = null).
      expect(model.show).toBe(false);
      expect(model.insertCommentEnabled).toBe(false);
      expect(model.deleteCommentId).toBeNull();
      expect(model.colorsEnabled).toBe(false);
      expect(model.removeHighlightId).toBeNull();
    }
    expect(annotationMenuModel(input({ ...sel })).show).toBe(true);
  });

  test('U1144: a selection always wins over caret context; caret contexts drive delete, recolor and the word anchor', () => {
    const source = 'Hello **bold** world\n';
    const rendered = 'Hello bold world';
    const bold = source.indexOf('bold');

    // Selection over an existing highlight: the color rows INSERT on the
    // selection (anchor set, recolor null) and Remove Highlight stays off.
    const overHl = annotationMenuModel(
      input({
        selFrom: bold,
        selTo: bold + 4,
        head: bold + 4,
        idsAtCaret: ['h1'],
        records: [highlight('h1')],
      })
    );
    expect(overHl.anchor).not.toBeNull();
    expect(overHl.insertCommentEnabled).toBe(true);
    expect(overHl.colorsEnabled).toBe(true);
    expect(overHl.recolorId).toBeNull();
    expect(overHl.removeHighlightId).toBeNull();

    // Caret (no selection) on that highlight: color rows recolor IT, Remove
    // Highlight arms, and the caret word still anchors Insert Comment.
    const onHl = annotationMenuModel(
      input({
        selFrom: bold + 2,
        selTo: bold + 2,
        head: bold + 2,
        idsAtCaret: ['h1'],
        records: [highlight('h1')],
      })
    );
    expect(onHl.recolorId).toBe('h1');
    expect(onHl.removeHighlightId).toBe('h1');
    expect(onHl.colorsEnabled).toBe(true);
    expect(onHl.insertCommentEnabled).toBe(true);
    expect(onHl.anchor).toEqual({ start: rendered.indexOf('bold'), end: rendered.indexOf('bold') + 4 });

    // Caret on a comment's painted range: Delete Comment names it; a
    // highlight under the caret never does (kind-aware, pickHitRecord).
    const both = annotationMenuModel(
      input({
        selFrom: bold + 2,
        selTo: bold + 2,
        head: bold + 2,
        idsAtCaret: ['c1', 'h1'],
        records: [comment('c1', 2), highlight('h1', 3)],
      })
    );
    expect(both.deleteCommentId).toBe('c1');
    expect(both.recolorId).toBe('h1'); // the comment never shadows recolor
    // Several overlapping comments: the innermost (greatest anchor.start)
    // wins — the existing pickHitRecord rule, not a second divergent one.
    const stacked = annotationMenuModel(
      input({
        selFrom: bold + 2,
        selTo: bold + 2,
        head: bold + 2,
        idsAtCaret: ['c1', 'c2'],
        records: [comment('c1', 0), comment('c2', 5)],
      })
    );
    expect(stacked.deleteCommentId).toBe('c2');

    // Plain caret in a word, nothing painted: the word is the anchor
    // (SPEC44 §1 wordAt, left affinity at the word's end).
    const word = annotationMenuModel(input({ selFrom: bold + 4, selTo: bold + 4, head: bold + 4 }));
    expect(word.anchor).toEqual({ start: rendered.indexOf('bold'), end: rendered.indexOf('bold') + 4 });
    expect(word.recolorId).toBeNull();
    expect(word.removeHighlightId).toBeNull();
    expect(word.deleteCommentId).toBeNull();
  });
});

describe('PRD 023 §13 preview selection context model (issue #287)', () => {
  const pinput = (over: Partial<PreviewAnnotationInput> = {}): PreviewAnnotationInput => ({
    gate: openGate,
    start: 10,
    end: 20,
    positions: {},
    records: [],
    ...over,
  });

  test('U1145: the gate closes as a whole for comments-off, frozen store, and missing comment.write — and a collapsed selection is no context', () => {
    for (const gate of [
      { ...openGate, commentsEnabled: false },
      { ...openGate, authoringFrozen: true },
      { ...openGate, canWrite: false },
    ]) {
      const model = previewAnnotationModel(pinput({ gate }));
      // §7: absence is the pinned expression — show:false means no button
      // and no menu at all, so gate and rows can never disagree.
      expect(model.show).toBe(false);
      expect(model.insertCommentEnabled).toBe(false);
      expect(model.deleteCommentId).toBeNull();
      expect(model.colorsEnabled).toBe(false);
      expect(model.recolorId).toBeNull();
    }
    expect(previewAnnotationModel(pinput()).show).toBe(true);
    // A collapsed or inverted range is no selection: closed, never a guess.
    expect(previewAnnotationModel(pinput({ start: 5, end: 5 })).show).toBe(false);
    expect(previewAnnotationModel(pinput({ start: 9, end: 4 })).show).toBe(false);
  });

  test('U1146: no caret in preview — the selection is both insert anchor and hit context: overlap arms delete/recolor/remove, kind-aware', () => {
    // A plain selection: insert-only context, anchored on the selection
    // itself (rendered offsets, nothing to map).
    const plain = previewAnnotationModel(pinput());
    expect(plain.anchor).toEqual({ start: 10, end: 20 });
    expect(plain.insertCommentEnabled).toBe(true);
    expect(plain.colorsEnabled).toBe(true);
    expect(plain.deleteCommentId).toBeNull();
    expect(plain.recolorId).toBeNull();
    expect(plain.removeHighlightId).toBeNull();

    // Overlapping an existing comment's painted range arms Delete Comment;
    // a merely adjacent range (end == start) never does.
    const overComment = previewAnnotationModel(
      pinput({ records: [comment('c1', 12)], positions: { c1: { start: 12, end: 25 } } })
    );
    expect(overComment.deleteCommentId).toBe('c1');
    expect(overComment.recolorId).toBeNull();
    const adjacent = previewAnnotationModel(
      pinput({ records: [comment('c1', 20)], positions: { c1: { start: 20, end: 25 } } })
    );
    expect(adjacent.deleteCommentId).toBeNull();

    // Overlapping a highlight: the color rows RECOLOR that record in place
    // and Remove Highlight arms — the Reqs 8–9 reading for a caret-free
    // surface (the editor's selection-wins rule would make these
    // unreachable here). Insert Comment still anchors on the selection.
    const overHl = previewAnnotationModel(
      pinput({ records: [highlight('h1', 5)], positions: { h1: { start: 5, end: 15 } } })
    );
    expect(overHl.recolorId).toBe('h1');
    expect(overHl.removeHighlightId).toBe('h1');
    expect(overHl.colorsEnabled).toBe(true);
    expect(overHl.insertCommentEnabled).toBe(true);
    expect(overHl.anchor).toEqual({ start: 10, end: 20 });

    // Overlapping both kinds: the comment arms delete, the highlight still
    // owns recolor/remove — the comment never shadows it (pickHitRecord's
    // kind-aware split, same as the editor model).
    const both = previewAnnotationModel(
      pinput({
        records: [comment('c1', 8), highlight('h1', 12)],
        positions: { c1: { start: 8, end: 18 }, h1: { start: 12, end: 25 } },
      })
    );
    expect(both.deleteCommentId).toBe('c1');
    expect(both.recolorId).toBe('h1');
    expect(both.removeHighlightId).toBe('h1');

    // Among several overlapping highlights the first painted wins; an
    // unpainted record (null position) is no context at all.
    const stacked = previewAnnotationModel(
      pinput({
        records: [highlight('h2', 14), highlight('h1', 11), comment('c9', 0)],
        positions: { h1: { start: 11, end: 22 }, h2: { start: 14, end: 19 }, c9: null },
      })
    );
    expect(stacked.recolorId).toBe('h1');
    expect(stacked.deleteCommentId).toBeNull();
  });
});
