import { describe, expect, test } from 'vitest';
import { commentsPaneOpen, commentsSeamUp, type CommentsPaneState } from '../../src/lib/commentsPane';

const base: CommentsPaneState = { commentsEnabled: true, showComments: true, docOpen: true, zoomed: false };

describe('PRD 023 §14–§15 comments pane visibility (issue #284)', () => {
  test('U1134: the seam is per-document and mode-free; the pane follows the setting; every seam gate removes pane and chevron together', () => {
    // Open document, comments enabled: chevron up, pane follows the setting.
    expect(commentsSeamUp(base)).toBe(true);
    expect(commentsPaneOpen(base)).toBe(true);
    expect(commentsSeamUp({ ...base, showComments: false })).toBe(true); // the closed pane keeps its chevron
    expect(commentsPaneOpen({ ...base, showComments: false })).toBe(false);

    // The master switch (SPEC7 §2), a closed document, and semantic zoom
    // (PRD 011 Req 17) each remove the seam — pane AND chevron, and no open
    // setting resurrects either.
    for (const off of [{ commentsEnabled: false }, { docOpen: false }, { zoomed: true }]) {
      expect(commentsSeamUp({ ...base, ...off })).toBe(false);
      expect(commentsPaneOpen({ ...base, ...off })).toBe(false);
    }
  });
});
