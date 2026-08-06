import { describe, expect, test } from 'vitest';
import {
  ensureWritePermission,
  flushLocalDoc,
  saveLocalDoc,
  type FSPermissionState,
  type LocalWriteTarget,
} from '../../src/lib/localSave';

/** How one stub answers the permission seams and the write. */
interface StubOptions {
  query?: FSPermissionState;
  request?: FSPermissionState;
  omitQuery?: boolean;
  omitRequest?: boolean;
  throwOnWrite?: boolean;
  throwOnQuery?: boolean;
}
/** A target that also records the calls it received. */
type StubTarget = LocalWriteTarget & { written: string[]; requests: number; queries: number };

/** A stub handle: scripted permission answers plus what it recorded. */
function stubTarget(opts: StubOptions = {}): StubTarget {
  const rec: StubTarget = {
    written: [],
    requests: 0,
    queries: 0,
    write: async (content) => {
      if (opts.throwOnWrite) throw new Error('permission revoked mid-session');
      rec.written.push(content);
    },
  };
  if (!opts.omitQuery) {
    rec.query = async () => {
      rec.queries += 1;
      if (opts.throwOnQuery) throw new Error('handle gone');
      return opts.query ?? 'granted';
    };
  }
  if (!opts.omitRequest) {
    rec.request = async () => {
      rec.requests += 1;
      return opts.request ?? 'denied';
    };
  }
  return rec;
}

describe('PRD 009 Req 15 local single-file save', () => {
  test('U336: an already-granted handle writes in place, without re-prompting', async () => {
    const target = stubTarget({ query: 'granted' });
    expect(await saveLocalDoc(target, '# one\n')).toEqual({ kind: 'in-place' });
    // A second save in the same session still writes and still never prompts.
    expect(await saveLocalDoc(target, '# two\n')).toEqual({ kind: 'in-place' });
    expect(target.written).toEqual(['# one\n', '# two\n']);
    expect(target.requests).toBe(0);
  });

  test('U337: a handle at "prompt" that the user grants writes in place', async () => {
    const target = stubTarget({ query: 'prompt', request: 'granted' });
    expect(await saveLocalDoc(target, '# granted\n')).toEqual({ kind: 'in-place' });
    expect(target.written).toEqual(['# granted\n']);
    expect(target.requests).toBe(1);
    // The grant is asked for exactly once per save that needs it, after the
    // query says it is needed.
    expect(target.queries).toBe(1);
  });

  test('U338: a denied (or dismissed) permission request falls back to the download', async () => {
    const denied = stubTarget({ query: 'prompt', request: 'denied' });
    expect(await saveLocalDoc(denied, '# nope\n')).toEqual({ kind: 'download', reason: 'permission-denied' });
    expect(denied.written).toEqual([]);

    // A handle already refused outright is not re-asked at all.
    const blocked = stubTarget({ query: 'denied', request: 'denied' });
    expect(await saveLocalDoc(blocked, '# nope\n')).toEqual({ kind: 'download', reason: 'permission-denied' });
    expect(blocked.written).toEqual([]);

    // A permission seam that throws is a refusal, not a licence to write.
    const broken = stubTarget({ throwOnQuery: true });
    expect(await saveLocalDoc(broken, '# nope\n')).toEqual({ kind: 'download', reason: 'permission-denied' });
    expect(broken.written).toEqual([]);
  });

  test('U339: a write that throws falls back to the download — never a silent success', async () => {
    const target = stubTarget({ query: 'granted', throwOnWrite: true });
    expect(await saveLocalDoc(target, '# revoked\n')).toEqual({ kind: 'download', reason: 'write-failed' });
    expect(target.written).toEqual([]);
  });

  test('U340: a doc with no handle downloads on an explicit Save', async () => {
    expect(await saveLocalDoc(null, '# handle-less\n')).toEqual({ kind: 'download', reason: 'no-handle' });
  });

  test('U341: a write that is not the explicit Save downloads nothing and never prompts', async () => {
    // Handle-less: memory-only, so nothing landed and nothing was offered.
    expect(await flushLocalDoc(null, '# autosave\n')).toBe(false);

    // Granted: kept up to date in place, no prompt.
    const granted = stubTarget({ query: 'granted' });
    expect(await flushLocalDoc(granted, '# autosave\n')).toBe(true);
    expect(granted.written).toEqual(['# autosave\n']);
    expect(granted.requests).toBe(0);

    // Not yet granted: the prompt belongs to the user's own Save gesture, so
    // this write simply stays in memory.
    const prompt = stubTarget({ query: 'prompt', request: 'granted' });
    expect(await flushLocalDoc(prompt, '# autosave\n')).toBe(false);
    expect(prompt.written).toEqual([]);
    expect(prompt.requests).toBe(0);

    // A throwing write is reported, not thrown at the caller.
    const broken = stubTarget({ query: 'granted', throwOnWrite: true });
    expect(await flushLocalDoc(broken, '# autosave\n')).toBe(false);
  });

  test('U342: a handle with no permission members is simply written to', async () => {
    // Some browsers (and every `showSaveFilePicker` handle) hand back a
    // handle with no query/request members: it already has the grant.
    const bare = stubTarget({ omitQuery: true, omitRequest: true });
    expect(await ensureWritePermission(bare)).toBe(true);
    expect(await saveLocalDoc(bare, '# bare\n')).toEqual({ kind: 'in-place' });
    expect(await flushLocalDoc(bare, '# bare autosave\n')).toBe(true);
    expect(bare.written).toEqual(['# bare\n', '# bare autosave\n']);

    // A handle that can be queried but not requested cannot escape 'prompt'.
    const unaskable = stubTarget({ query: 'prompt', omitRequest: true });
    expect(await ensureWritePermission(unaskable)).toBe(false);
  });
});
