import { describe, expect, it } from 'vitest';
import { planSaveConflict, SaveConflictError, isSaveConflict } from '../../src/lib/saveConflict';

// PRD 007 Req 20: the conflict a rejected conditional save raises, and the
// plan each of the prompt's answers runs. Pure: no DOM, no server, no
// platform — App reacts to the error type, never to the flavor.

describe('PRD 007 Req 20 conflict resolution', () => {
  it('U840: reload, overwrite and cancel each do exactly one thing — cancel never “succeeds”', () => {
    expect(planSaveConflict('reload')).toEqual({ reload: true, write: false, dirty: false, saved: false });
    expect(planSaveConflict('overwrite')).toEqual({ reload: false, write: true, dirty: false, saved: true });
    // The whole point: dismissing leaves the buffer dirty and UNSAVED.
    expect(planSaveConflict('cancel')).toEqual({ reload: false, write: false, dirty: true, saved: false });
    // The error the platform throws instead of writing is recognisable across
    // module boundaries (App reacts to the type, never to the flavor).
    const err = new SaveConflictError('/w/1/files/a.md');
    expect(isSaveConflict(err)).toBe(true);
    expect(err.path).toBe('/w/1/files/a.md');
    expect(err.message).toMatch(/a\.md/);
    expect(isSaveConflict(new Error('write failed (500)'))).toBe(false);
  });
});
