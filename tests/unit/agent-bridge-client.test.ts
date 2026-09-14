import { describe, expect, it } from 'vitest';
import type {
  AnnotationSelection,
  EditStateReport,
  EditorSyncHandle,
  SelectSourceRange,
  SmartEditHandle,
  SmartFormatOp,
} from '@marky-mark/editor';
import {
  bufferRevision,
  createBridgeExecutor,
  headingLineOf,
  type BridgeDocument,
  type BridgeExecutorDeps,
} from '../../src/lib/agentBridgeClient';
import {
  BRIDGE_TOOL_NAMES,
  MUTATING_TOOLS,
  type BridgeToolRequest,
  type BridgeToolResult,
} from '../../src/lib/agentBridgeProtocol';

// PRD 027 Req 8/12/13 (issue #366): the executor, driven against FAKE handles
// — plain objects over a string buffer that record their calls and feed the
// executor the `EditStateReport` a real editor would. No CodeMirror, no DOM,
// no React: every capability the executor uses arrives through `deps`.

const DOC = '# Title\n\nalpha beta gamma\n\n## Second Part\n\ndelta\n';

/**
 * A fake editor: `text` is the live document (what the handle reads
 * synchronously); `committed` is the host's React buffer, which only
 * follows on an explicit `commit()` — the lag the executor must not trust.
 */
function fakeEditor(initial = DOC, opts: { editMode?: boolean; path?: string | null } = {}) {
  const calls: string[] = [];
  let text = initial;
  let committed = initial;
  let dirty = false;
  let path: string | null = opts.path === undefined ? '/docs/a.md' : opts.path;
  let sel = { from: 0, to: 0 };
  let top = 1;
  let editMode = opts.editMode ?? true;

  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  const executorRef: { current: ReturnType<typeof createBridgeExecutor> | null } = { current: null };
  const report = (origin: EditStateReport['origin'] = 'editor') =>
    executorRef.current?.onEditState({
      canonHead: sel.to,
      head: sel.to,
      headLine: lineOf(sel.to),
      selFrom: sel.from,
      selTo: sel.to,
      selAnchor: sel.from,
      selHead: sel.to,
      selText: text.slice(sel.from, sel.to),
      focused: false,
      selectionSet: true,
      origin,
    });

  const smart: SmartEditHandle = {
    applyFormat: (op: SmartFormatOp) => {
      calls.push(`applyFormat:${op}`);
      const wrapped = `**${text.slice(sel.from, sel.to)}**`;
      text = text.slice(0, sel.from) + wrapped + text.slice(sel.to);
      sel = { from: sel.from, to: sel.from + wrapped.length }; // the package keeps its post-format selection
      report();
    },
    openSmartMenu: () => calls.push('openSmartMenu'),
    openLink: () => calls.push('openLink'),
    canonicalText: (t) => t,
    annotationSelection: () => ({}) as AnnotationSelection,
    replaceRange: (from, to, insert) => {
      calls.push(`replaceRange:${from}:${to}:${insert}`);
      const a = Math.max(0, Math.min(from, to, text.length));
      const b = Math.max(a, Math.min(Math.max(from, to), text.length));
      text = text.slice(0, a) + insert + text.slice(b);
      sel = { from: a + insert.length, to: a + insert.length };
      report();
    },
    documentText: () => text,
  };
  const sync: EditorSyncHandle = {
    topLine: () => top,
    scrollToLine: (line) => {
      calls.push(`scrollToLine:${line}`);
      top = line;
    },
    goToLine: () => calls.push('goToLine'),
    goToHeading: () => calls.push('goToHeading'),
    scrollInfo: () => ({ top: 0, max: 0 }),
    headRow: () => ({ top: 0, bottom: 0 }),
    setScrollTop: () => calls.push('setScrollTop'),
    onScroll: () => () => {},
    revealHighlight: () => false,
    rawLinesOf: () => [],
    landSearchHit: () => calls.push('landSearchHit'),
    viewportLines: () => 25,
  };
  const select: SelectSourceRange = (from, to, o) => {
    calls.push(`select:${from}:${to}:${o?.reveal === true}`);
    sel = { from: Math.min(from, to), to: Math.max(from, to) };
    report('host');
  };

  const deps: BridgeExecutorDeps = {
    smartEdit: () => (editMode ? smart : null),
    editorSync: () => (editMode ? sync : null),
    selectRange: () => (editMode ? select : null),
    document: (): BridgeDocument => ({ path, content: committed, dirty }),
    openFile: async (p) => {
      calls.push(`openFile:${p}`);
      if (p.startsWith('/docs/')) {
        path = p;
        text = committed = `# ${p}\n`;
        dirty = false;
        sel = { from: 0, to: 0 };
        report('host');
      }
    },
    save: async () => {
      calls.push('save');
      if (!path) return false;
      committed = text;
      dirty = false;
      return true;
    },
    settleMs: 50,
  };
  const executor = createBridgeExecutor(deps);
  executorRef.current = executor;
  report('host'); // the mount seed

  return {
    executor,
    calls,
    text: () => text,
    committed: () => committed,
    /** The host's React commit: buffer and dirty flag catch up with the live text. */
    commit: () => {
      dirty = dirty || committed !== text;
      committed = text;
    },
    /** A user keystroke at the caret, through the same feed a real editor uses. */
    type: (ch: string) => {
      text = text.slice(0, sel.to) + ch + text.slice(sel.to);
      sel = { from: sel.to + ch.length, to: sel.to + ch.length };
      report();
    },
    select: (from: number, to: number) => {
      sel = { from, to };
      report();
    },
    setEditMode: (on: boolean) => {
      editMode = on;
    },
    setPath: (p: string | null) => {
      path = p;
    },
  };
}

let seq = 0;
const req = <T extends Omit<BridgeToolRequest, 'id'>>(r: T): BridgeToolRequest => ({ id: `r${++seq}`, ...r }) as BridgeToolRequest;

function expectOk(result: BridgeToolResult): Extract<BridgeToolResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result;
}
function expectError(result: BridgeToolResult): Extract<BridgeToolResult, { ok: false }> {
  if (result.ok) throw new Error(`expected an error, got ok`);
  return result;
}

describe('PRD 027 Req 8/12/13 (issue #366) agent bridge client', () => {
  it('U1407: every tool in BRIDGE_TOOL_NAMES answers a typed result echoing its id; the snapshot is filled from the injected sources', async () => {
    const ed = fakeEditor();
    const { executor } = ed;
    const revision = executor.snapshot().revision;
    const requests: Record<(typeof BRIDGE_TOOL_NAMES)[number], BridgeToolRequest> = {
      get_editor_state: req({ tool: 'get_editor_state' }),
      open_file: req({ tool: 'open_file', path: '/docs/b.md' }),
      scroll: req({ tool: 'scroll', target: { to: 'line', line: 3 } }),
      set_selection: req({ tool: 'set_selection', from: 9, to: 14 }),
      replace_selection: req({ tool: 'replace_selection', revision, text: 'x' }),
      insert_text: req({ tool: 'insert_text', revision, text: 'y' }),
      replace_range: req({ tool: 'replace_range', revision, from: 0, to: 1, text: 'z' }),
      apply_format: req({ tool: 'apply_format', revision, op: 'bold' }),
      save: req({ tool: 'save' }),
    };
    for (const tool of BRIDGE_TOOL_NAMES) {
      const r = requests[tool];
      const result = await executor.execute(r);
      expect(result.id).toBe(r.id);
      expect(typeof result.ok).toBe('boolean');
      if (result.ok) expect(typeof result.state.revision).toBe('string');
      else expect(typeof result.error.code).toBe('string');
    }

    // The snapshot, field by field, from the injected sources — no side effect.
    const fresh = fakeEditor();
    fresh.select(9, 14);
    const before = fresh.calls.length;
    const state = expectOk(await fresh.executor.execute(req({ tool: 'get_editor_state' }))).state;
    expect(fresh.calls.length).toBe(before);
    expect(state).toEqual({
      path: '/docs/a.md',
      content: DOC,
      dirty: false,
      cursor: { offset: 14, line: 3 },
      selection: { from: 9, to: 14, text: 'alpha' },
      scroll: { topLine: 1, totalLines: DOC.split('\n').length },
      revision: bufferRevision('/docs/a.md', DOC),
    });
    expect(fresh.executor.snapshot()).toEqual(state);
  });

  it('U1408: the revision is stable across cursor-only reports, changes with the content and with the path, and is never cached', async () => {
    const ed = fakeEditor();
    const first = ed.executor.snapshot().revision;
    ed.select(3, 5);
    ed.select(0, 0);
    expect(ed.executor.snapshot().revision).toBe(first);
    ed.type('!');
    const second = ed.executor.snapshot().revision;
    expect(second).not.toBe(first);
    // Recomputed at execution time: the host's buffer has not committed, the
    // live text has — the revision follows the live text.
    expect(ed.committed()).toBe(DOC);
    expect(expectOk(await ed.executor.execute(req({ tool: 'get_editor_state' }))).state.revision).toBe(second);
    ed.setPath('/docs/renamed.md');
    expect(ed.executor.snapshot().revision).not.toBe(second);
    // A pure function of (path, content): deterministic, and the two inputs are not conflated.
    expect(bufferRevision('a.md', 'x')).toBe(bufferRevision('a.md', 'x'));
    expect(bufferRevision('a.md', 'x')).not.toBe(bufferRevision('a.md', 'y'));
    expect(bufferRevision('a.md', 'x')).not.toBe(bufferRevision('b.md', 'x'));
    expect(bufferRevision(null, 'x')).not.toBe(bufferRevision('', 'x '));
  });

  it('U1409: each mutating tool refuses a stale revision with the fresh state and no edit; a matching one edits and returns the new revision that get_editor_state then repeats', async () => {
    for (const tool of MUTATING_TOOLS) {
      const ed = fakeEditor();
      ed.select(9, 13);
      const stale = ed.executor.snapshot().revision;
      ed.type('Q'); // the user typed after the agent's last read
      const live = ed.text();
      const before = ed.calls.length;
      const build = (revision: string): BridgeToolRequest => {
        switch (tool) {
          case 'replace_selection':
            return req({ tool, revision, text: 'NEW' });
          case 'insert_text':
            return req({ tool, revision, text: 'NEW' });
          case 'replace_range':
            return req({ tool, revision, from: 2, to: 7, text: 'NEW' });
          case 'apply_format':
            return req({ tool, revision, op: 'bold' });
        }
      };
      const refused = expectError(await ed.executor.execute(build(stale)));
      expect(refused.error.code).toBe('stale_revision');
      if (refused.error.code !== 'stale_revision') throw new Error('unreachable');
      expect(refused.error.state.content).toBe(live);
      expect(refused.error.state.revision).toBe(bufferRevision('/docs/a.md', live));
      expect(ed.text()).toBe(live);
      expect(ed.calls.length).toBe(before); // NO edit, no handle call

      const ok = expectOk(await ed.executor.execute(build(refused.error.state.revision)));
      expect(ed.text()).not.toBe(live);
      expect(ok.state.content).toBe(ed.text());
      expect(ok.state.revision).toBe(bufferRevision('/docs/a.md', ed.text()));
      expect(ok.state.revision).not.toBe(refused.error.state.revision);
      const again = expectOk(await ed.executor.execute(req({ tool: 'get_editor_state' })));
      expect(again.state.revision).toBe(ok.state.revision);
    }
  });

  it('U1410: the text tools land through replaceRange with the caret after the insertion; the result reflects the live edit before the host commits, and reads dirty', async () => {
    const ed = fakeEditor();
    // replace_selection over the current range (canonical selFrom/selTo).
    ed.select(15, 19);
    let rev = ed.executor.snapshot().revision;
    let r = expectOk(await ed.executor.execute(req({ tool: 'replace_selection', revision: rev, text: 'BETA' })));
    expect(ed.calls.at(-1)).toBe('replaceRange:15:19:BETA');
    expect(ed.text()).toBe('# Title\n\nalpha BETA gamma\n\n## Second Part\n\ndelta\n');
    // The host's buffer has NOT committed yet — the result is still the live edit.
    expect(ed.committed()).toBe(DOC);
    expect(r.state.content).toBe(ed.text());
    expect(r.state.dirty).toBe(true);
    expect(r.state.cursor).toEqual({ offset: 19, line: 3 });
    expect(r.state.selection).toEqual({ from: 19, to: 19, text: '' });
    ed.commit();
    expect(ed.executor.snapshot().dirty).toBe(true);

    // insert_text at the caret (an empty range).
    rev = ed.executor.snapshot().revision;
    r = expectOk(await ed.executor.execute(req({ tool: 'insert_text', revision: rev, text: '!' })));
    expect(ed.calls.at(-1)).toBe('replaceRange:19:19:!');
    expect(ed.text()).toContain('alpha BETA! gamma');
    expect(r.state.cursor.offset).toBe(20);

    // replace_range: explicit canonical [from, to), independent of the selection.
    rev = ed.executor.snapshot().revision;
    r = expectOk(await ed.executor.execute(req({ tool: 'replace_range', revision: rev, from: 2, to: 7, text: 'Heading' })));
    expect(ed.calls.at(-1)).toBe('replaceRange:2:7:Heading');
    expect(ed.text().startsWith('# Heading\n')).toBe(true);
    expect(r.state.cursor.offset).toBe(9);

    // apply_format delegates to the package's own formatting seam, which keeps its selection.
    ed.select(11, 16);
    rev = ed.executor.snapshot().revision;
    r = expectOk(await ed.executor.execute(req({ tool: 'apply_format', revision: rev, op: 'italic' })));
    expect(ed.calls.at(-1)).toBe('applyFormat:italic');
    expect(ed.text()).toContain('**alpha**');
    expect(r.state.selection).toEqual({ from: 11, to: 20, text: '**alpha**' });
  });

  it('U1411: scroll by lines is relative to topLine, by pages uses the viewport measure, to a line is absolute, to a heading resolves through the section model; the caret never moves', async () => {
    const ed = fakeEditor();
    ed.select(4, 4);
    const caret = ed.executor.snapshot().cursor;
    const scroll = (target: Extract<BridgeToolRequest, { tool: 'scroll' }>['target']) =>
      ed.executor.execute(req({ tool: 'scroll', target }));

    expectOk(await scroll({ by: 'lines', amount: 3 }));
    expect(ed.calls.at(-1)).toBe('scrollToLine:4');
    expectOk(await scroll({ by: 'pages', amount: 2 })); // 4 + 2 × 25
    expect(ed.calls.at(-1)).toBe('scrollToLine:54');
    expectOk(await scroll({ by: 'pages', amount: -5 })); // clamped at line 1
    expect(ed.calls.at(-1)).toBe('scrollToLine:1');
    expectOk(await scroll({ to: 'line', line: 6 }));
    expect(ed.calls.at(-1)).toBe('scrollToLine:6');
    expectOk(await scroll({ to: 'heading', heading: 'Second Part' }));
    expect(ed.calls.at(-1)).toBe('scrollToLine:5');
    // Trimmed, then case-insensitive.
    expectOk(await scroll({ to: 'heading', heading: '  second part ' }));
    expect(ed.calls.at(-1)).toBe('scrollToLine:5');
    const unknown = expectError(await scroll({ to: 'heading', heading: 'Nowhere' }));
    expect(unknown.error).toEqual({ code: 'tool_failed', message: 'heading not found: Nowhere' });
    expect(ed.executor.snapshot().cursor).toEqual(caret);
    expect(ed.calls.filter((c) => c.startsWith('select') || c.startsWith('goTo'))).toEqual([]);

    // The resolver on its own: exact beats case-folded; a heading inside a
    // fence is not a heading.
    expect(headingLineOf('# a\n\n## A\n', 'A')).toBe(3);
    expect(headingLineOf('# a\n\n## A\n', 'a')).toBe(1);
    expect(headingLineOf('```\n# not\n```\n# yes\n', 'not')).toBeNull();
    expect(headingLineOf('```\n# not\n```\n# yes\n', 'yes')).toBe(4);

    // set_selection: canonical offsets through the select seam, revealed; the result shows the range.
    const sel = expectOk(await ed.executor.execute(req({ tool: 'set_selection', from: 14, to: 9 })));
    expect(ed.calls.at(-1)).toBe('select:14:9:true');
    expect(sel.state.selection).toEqual({ from: 9, to: 14, text: 'alpha' });
  });

  it('U1412: a null handle answers tool_failed naming the reason while get_editor_state still answers; open_file and save go through the registry callbacks; a throwing handle never escapes execute', async () => {
    const ed = fakeEditor(DOC, { editMode: false });
    const rev = ed.executor.snapshot().revision;
    const notEditing = { code: 'tool_failed', message: 'editor is not in edit mode' };
    expect(expectError(await ed.executor.execute(req({ tool: 'scroll', target: { by: 'lines', amount: 1 } }))).error).toEqual(notEditing);
    expect(expectError(await ed.executor.execute(req({ tool: 'set_selection', from: 0, to: 1 }))).error).toEqual(notEditing);
    expect(expectError(await ed.executor.execute(req({ tool: 'replace_selection', revision: rev, text: 'x' }))).error).toEqual(notEditing);
    expect(expectError(await ed.executor.execute(req({ tool: 'insert_text', revision: rev, text: 'x' }))).error).toEqual(notEditing);
    expect(expectError(await ed.executor.execute(req({ tool: 'replace_range', revision: rev, from: 0, to: 1, text: 'x' }))).error).toEqual(notEditing);
    expect(expectError(await ed.executor.execute(req({ tool: 'apply_format', revision: rev, op: 'bold' }))).error).toEqual(notEditing);
    expect(ed.text()).toBe(DOC);
    // Preview mode still reports the buffer (from the host, no handle to read).
    const state = expectOk(await ed.executor.execute(req({ tool: 'get_editor_state' }))).state;
    expect(state).toMatchObject({ path: '/docs/a.md', content: DOC, dirty: false, scroll: { topLine: 1 } });

    // open_file: the registry callback, then the result names the newly open path.
    const opened = expectOk(await ed.executor.execute(req({ tool: 'open_file', path: '/docs/b.md' })));
    expect(ed.calls).toContain('openFile:/docs/b.md');
    expect(opened.state.path).toBe('/docs/b.md');
    expect(opened.state.content).toBe('# /docs/b.md\n');
    // A path the host never lands on (the registry's "no longer there" notice) is a typed failure.
    const missing = expectError(await ed.executor.execute(req({ tool: 'open_file', path: '/elsewhere/c.md' })));
    expect(missing.error).toEqual({ code: 'tool_failed', message: 'could not open /elsewhere/c.md' });
    expect(ed.executor.snapshot().path).toBe('/docs/b.md');

    // save: through the registry callback; success ⇒ dirty false.
    ed.setEditMode(true);
    ed.type('Z');
    ed.commit();
    expect(ed.executor.snapshot().dirty).toBe(true);
    const saved = expectOk(await ed.executor.execute(req({ tool: 'save' })));
    expect(ed.calls.at(-1)).toBe('save');
    expect(saved.state.dirty).toBe(false);
    expect(ed.committed()).toBe(ed.text());
    // A refused save is a typed failure — never a bypass.
    ed.setPath(null);
    expect(expectError(await ed.executor.execute(req({ tool: 'save' }))).error).toEqual({ code: 'tool_failed', message: 'save was refused' });

    // Nothing throws out of execute: a handle that throws becomes tool_failed.
    const boom = createBridgeExecutor({
      smartEdit: () => {
        throw new Error('handle exploded');
      },
      editorSync: () => null,
      selectRange: () => null,
      document: () => ({ path: null, content: '', dirty: false }),
      openFile: async () => {},
      save: async () => false,
    });
    const r = await boom.execute(req({ tool: 'get_editor_state' }));
    expect(r).toEqual({ id: r.id, ok: false, error: { code: 'tool_failed', message: 'handle exploded' } });
  });
});
