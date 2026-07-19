import { describe, expect, test } from 'vitest';
import { DEFAULT_HOTKEYS } from '../../src/lib/hotkeys';
import {
  buildSmartMenu,
  detectContext,
  insertCallout,
  insertHr,
  setHeading,
  toggleCodeBlock,
  toggleInline,
  toggleList,
  toggleQuote,
  wrapLink,
  type SmartMenuCtx,
  type SmartMenuEntry,
} from '../../src/lib/smartEdit';

const ctx = (over: Partial<SmartMenuCtx> = {}): SmartMenuCtx => ({
  table: false,
  image: false,
  hasSelection: true,
  canPaste: true,
  hotkeys: DEFAULT_HOTKEYS,
  isMac: true,
  tableMode: false, // SPEC39 §5 amendment to U64
  ...over,
});

const ids = (entries: SmartMenuEntry[]): string[] =>
  entries.map((e) => (e === 'sep' ? 'sep' : e.id));

const find = (entries: SmartMenuEntry[], id: string) => {
  const hit = entries.find((e) => e !== 'sep' && e.id === id);
  if (!hit || hit === 'sep') throw new Error(`no item ${id}`);
  return hit;
};

describe('SPEC36 smart edit', () => {
  test('U64: menu model and context detection', () => {
    // --- exact section/item order with no context ---------------------------
    // SPEC37 §9 amendment to U64: the contextual section is now the
    // always-present Table submenu; Resize Image… stays contextual.
    expect(ids(buildSmartMenu(ctx()))).toEqual([
      'table',
      'sep',
      'bold', 'italic', 'strike', 'code', 'link',
      'sep',
      'heading', 'lists', 'callout', 'quote', 'code-block', 'hr',
      'sep',
      'cut', 'copy', 'paste',
    ]);
    expect(ids(buildSmartMenu(ctx({ image: true }))).slice(0, 3)).toEqual([
      'table', 'resize-image', 'sep',
    ]);
    // Table submenu children + enabled flags per context.
    const tableSub = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'table').submenu!.map((e) => e !== 'sep' && [e.id, e.enabled]);
    expect(tableSub(ctx())).toEqual([
      ['edit-table', false],
      ['insert-table', true],
      ['delete-table', false],
    ]);
    expect(tableSub(ctx({ table: true }))).toEqual([
      ['edit-table', true],
      ['insert-table', false],
      ['delete-table', true],
    ]);
    // SPEC39 §5 amendment: with the mode active, the item becomes the exit —
    // labeled so, and enabled even when the cursor is outside any table.
    const activeSub = find(buildSmartMenu(ctx({ tableMode: true })), 'table').submenu!;
    const exitItem = activeSub.find((e) => e !== 'sep' && e.id === 'edit-table');
    expect(exitItem && exitItem !== 'sep' && exitItem.label).toBe('Exit Table Mode');
    expect(exitItem && exitItem !== 'sep' && exitItem.enabled).toBe(true);
    const offItem = find(buildSmartMenu(ctx()), 'table').submenu!.find(
      (e) => e !== 'sep' && e.id === 'edit-table'
    );
    expect(offItem && offItem !== 'sep' && offItem.label).toBe('Edit Table…');

    // --- cut/copy disabled without a selection, paste omitted without seam --
    const bare = buildSmartMenu(ctx({ hasSelection: false, canPaste: false }));
    expect(find(bare, 'cut').enabled).toBe(false);
    expect(find(bare, 'copy').enabled).toBe(false);
    expect(ids(bare)).not.toContain('paste');
    expect(find(buildSmartMenu(ctx()), 'cut').enabled).toBe(true);

    // --- submenu contents pinned ---------------------------------------------
    expect(find(buildSmartMenu(ctx()), 'heading').submenu!.map((e) => e !== 'sep' && e.id)).toEqual([
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ]);
    expect(find(buildSmartMenu(ctx()), 'lists').submenu!.map((e) => e !== 'sep' && e.id)).toEqual([
      'bullet', 'numbered', 'task',
    ]);
    expect(find(buildSmartMenu(ctx()), 'callout').submenu!.map((e) => e !== 'sep' && e.id)).toEqual([
      'note', 'tip', 'important', 'warning', 'caution',
    ]);

    // --- hotkey labels follow the current (rebound) bindings ----------------
    const std = buildSmartMenu(ctx());
    expect(find(std, 'bold').hotkey).toBe('⌘B');
    expect(find(std, 'italic').hotkey).toBe('⌘I');
    const rebound = buildSmartMenu(
      ctx({ hotkeys: { ...DEFAULT_HOTKEYS, bold: 'Mod+Shift+F5' }, isMac: false })
    );
    expect(find(rebound, 'bold').hotkey).toBe('Ctrl+Shift+F5');
    const heads = find(std, 'heading').submenu!;
    expect(find(heads, 'h2').hotkey).toBe('⌘2');
    // Callout items carry no hotkey.
    for (const e of find(std, 'callout').submenu!) {
      if (e !== 'sep') expect(e.hotkey).toBeUndefined();
    }

    // --- detectContext: pipe tables -----------------------------------------
    const table = 'before\n| a | b |\n| --- | --- |\n| 1 | 2 |\nafter';
    const at = (needle: string) => table.indexOf(needle);
    expect(detectContext(table, at('| a')).table).toBe(true); // header row
    expect(detectContext(table, at('---')).table).toBe(true); // delimiter row
    expect(detectContext(table, at('| 1')).table).toBe(true); // body row
    expect(detectContext(table, 0).table).toBe(false); // before
    expect(detectContext(table, table.indexOf('after')).table).toBe(false); // after
    // Edge-less pipes still form a table.
    const bare2 = 'a | b\n--- | ---\n1 | 2';
    expect(detectContext(bare2, 0).table).toBe(true);
    expect(detectContext(bare2, bare2.indexOf('1 |')).table).toBe(true);
    // A lone pipe line with no delimiter row is NOT a table.
    expect(detectContext('just a | pipe\nplain text', 3).table).toBe(false);

    // --- detectContext: images ----------------------------------------------
    const img = 'text ![alt](pics/a.png) more';
    const start = img.indexOf('![');
    const end = img.indexOf(')') + 1;
    expect(detectContext(img, start).image).toBe(true); // span start
    expect(detectContext(img, start + 3).image).toBe(true); // inside
    expect(detectContext(img, end).image).toBe(true); // span end
    expect(detectContext(img, 2).image).toBe(false); // before
    expect(detectContext(img, img.length - 1).image).toBe(false); // after
    const tag = 'x <img src="a.png" width="40"> y';
    expect(detectContext(tag, tag.indexOf('src')).image).toBe(true);
    // A plain link is not an image.
    const link = 'see [alt](pics/a.png) now';
    expect(detectContext(link, link.indexOf('alt')).image).toBe(false);
  });

  test('U65: inline toggles and link', () => {
    // --- wrap/unwrap for all four kinds --------------------------------------
    const cases: Array<['bold' | 'italic' | 'strike' | 'code', string]> = [
      ['bold', '**'],
      ['italic', '*'],
      ['strike', '~~'],
      ['code', '`'],
    ];
    for (const [kind, m] of cases) {
      const wrapped = toggleInline('say word here', 4, 8, kind)!;
      expect(wrapped.text, kind).toBe(`say ${m}word${m} here`);
      expect(wrapped.text.slice(wrapped.from, wrapped.to), kind).toBe('word');
      const un = toggleInline(wrapped.text, wrapped.from, wrapped.to, kind)!;
      expect(un.text, kind).toBe('say word here');
      expect(un.text.slice(un.from, un.to), kind).toBe('word');
      // Unwrap when the selection includes the markers themselves.
      const edges = toggleInline(wrapped.text, 4, 8 + 2 * m.length, kind)!;
      expect(edges.text, kind).toBe('say word here');
    }

    // --- collapsed cursor expands to the word under it -----------------------
    const word = toggleInline('say word here', 6, 6, 'bold')!;
    expect(word.text).toBe('say **word** here');
    const unword = toggleInline(word.text, 8, 8, 'bold')!;
    expect(unword.text).toBe('say word here');

    // --- collapsed cursor in whitespace: marker pair, caret between ----------
    const pair = toggleInline('a  b', 2, 2, 'bold')!;
    expect(pair.text).toBe('a **** b');
    expect(pair.from).toBe(4);
    expect(pair.to).toBe(4);
    const tick = toggleInline('a  b', 2, 2, 'code')!;
    expect(tick.text).toBe('a `` b');
    expect(tick.from).toBe(3);

    // --- bold/italic disambiguation: ** checked before * ---------------------
    const bolded = 'say **word** here';
    const both = toggleInline(bolded, 6, 10, 'italic')!;
    expect(both.text).toBe('say ***word*** here'); // italic on bold stacks, never eats
    const backOff = toggleInline(both.text, both.from, both.to, 'italic')!;
    expect(backOff.text).toBe(bolded);
    const unbold = toggleInline(both.text, both.from, both.to, 'bold')!;
    expect(unbold.text).toBe('say *word* here'); // bold strips its two, italic stays

    // --- doc start/end -------------------------------------------------------
    expect(toggleInline('word', 0, 4, 'bold')!.text).toBe('**word**');
    expect(toggleInline('**word**', 2, 6, 'bold')!.text).toBe('word');
    expect(toggleInline('end word', 4, 8, 'code')!.text).toBe('end `word`');

    // --- link ----------------------------------------------------------------
    const linked = wrapLink('see docs now', 4, 8);
    expect(linked.text).toBe('see [docs](url) now');
    expect(linked.text.slice(linked.from, linked.to)).toBe('url');
    const empty = wrapLink('ab', 1, 1);
    expect(empty.text).toBe('a[text](url)b');
    expect(empty.text.slice(empty.from, empty.to)).toBe('text');
  });

  test('U66: headings, lists, quotes, callouts', () => {
    // --- heading set / switch / toggle-off ----------------------------------
    expect(setHeading('title', 0, 0, 2)!.text).toBe('## title');
    expect(setHeading('# title', 0, 0, 3)!.text).toBe('### title'); // switch, never stack
    expect(setHeading('## title', 0, 0, 2)!.text).toBe('title'); // toggle-off
    // Multi-line: blanks skipped, each non-blank line converted.
    const multi = setHeading('one\n\ntwo', 0, 8, 1)!;
    expect(multi.text).toBe('# one\n\n# two');
    expect(setHeading('\n\n', 0, 2, 1)).toBeNull(); // nothing to head

    // --- list toggles --------------------------------------------------------
    const two = 'first\nsecond';
    const bullet = toggleList(two, 0, two.length, 'bullet')!;
    expect(bullet.text).toBe('- first\n- second');
    expect(toggleList(bullet.text, 0, bullet.text.length, 'bullet')!.text).toBe(two); // all-prefixed ⇒ removal
    const numbered = toggleList(two, 0, two.length, 'numbered')!;
    expect(numbered.text).toBe('1. first\n2. second'); // renumbered from 1
    // Replacement in place: bullet → numbered → task.
    expect(toggleList(bullet.text, 0, bullet.text.length, 'numbered')!.text).toBe('1. first\n2. second');
    expect(toggleList(numbered.text, 0, numbered.text.length, 'task')!.text).toBe('- [ ] first\n- [ ] second');
    // Task removal also strips checked boxes.
    expect(toggleList('- [ ] a\n- [x] b', 0, 15, 'task')!.text).toBe('a\nb');
    // Indent preserved; blank lines untouched.
    const indented = toggleList('  a\n\n  b', 0, 8, 'bullet')!;
    expect(indented.text).toBe('  - a\n\n  - b');
    // A mixed selection is not "all this kind" — applies, replacing in place.
    expect(toggleList('- a\nb', 0, 5, 'bullet')!.text).toBe('- a\n- b');

    // --- blockquote ----------------------------------------------------------
    const quoted = toggleQuote('a\n\nb', 0, 4)!;
    expect(quoted.text).toBe('> a\n>\n> b'); // blanks get bare >
    expect(toggleQuote(quoted.text, 0, quoted.text.length)!.text).toBe('a\n\nb'); // strip one level
    expect(toggleQuote('> > deep', 0, 8)!.text).toBe('> deep'); // one level at a time

    // --- callouts ------------------------------------------------------------
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution'] as const) {
      const tag = `> [!${kind.toUpperCase()}]`;
      const sel = insertCallout('some text', 0, 9, kind);
      expect(sel.text).toBe(`${tag}\n> some text`);
      const blank = insertCallout('', 0, 0, kind);
      expect(blank.text).toBe(`${tag}\n> `);
      expect(blank.from).toBe(blank.text.length); // caret after the final "> "
      expect(blank.from).toBe(blank.to);
    }
    // Collapsed cursor on a non-blank line: block inserted after the line.
    const after = insertCallout('busy line', 4, 4, 'note');
    expect(after.text).toBe('busy line\n> [!NOTE]\n> ');
    expect(after.from).toBe(after.text.length);
  });

  test('U67: code blocks, horizontal rule, splice consistency', () => {
    // --- wrap: fences around the complete lines, caret after opening ``` -----
    const wrap = toggleCodeBlock('before\ncode here\nafter', 8, 12);
    expect(wrap.text).toBe('before\n```\ncode here\n```\nafter');
    expect(wrap.from).toBe(wrap.to);
    expect(wrap.text.slice(wrap.from - 3, wrap.from)).toBe('```'); // caret right after it
    // --- unwrap an exactly-fenced selection (fences inside the selection) ----
    const inner = toggleCodeBlock(wrap.text, 7, 24);
    expect(inner.text).toBe('before\ncode here\nafter');
    // --- unwrap when the fences are the lines immediately outside ------------
    const outer = toggleCodeBlock('before\n```\ncode here\n```\nafter', 11, 15);
    expect(outer.text).toBe('before\ncode here\nafter');
    // Fences at the document edges.
    expect(toggleCodeBlock('```\nx\n```', 4, 5).text).toBe('x');

    // --- horizontal rule ------------------------------------------------------
    const hr = insertHr('para\nnext', 2, 2);
    expect(hr.text).toBe('para\n\n---\n\nnext'); // blanks added both sides
    expect(hr.text.slice(hr.from - 3, hr.from)).toBe('---');
    expect(insertHr('para', 2, 2).text).toBe('para\n\n---'); // doc end: no trailing blank
    expect(insertHr('a\n\nb', 2, 2).text).toBe('a\n\n---\n\nb'); // blank cursor line: no extra above
    expect(insertHr('a\n\n\nb', 2, 2).text).toBe('a\n\n---\n\nb'.replace('---\n\n', '---\n\n')); // existing blank below kept
    const hrEnd = insertHr('a\nb', 2, 2);
    expect(hrEnd.text).toBe('a\nb\n\n---');
    expect(hrEnd.from).toBe(hrEnd.text.length);

    // --- every op modifies exactly one contiguous region ----------------------
    const doc = 'intro line\n\nalpha beta\ngamma\n\n| a |\n| - |\n| b |\n\noutro';
    const results = [
      toggleInline(doc, 12, 22, 'bold'),
      wrapLink(doc, 12, 17),
      setHeading(doc, 12, 17, 2),
      toggleList(doc, 12, 28, 'bullet'),
      toggleQuote(doc, 12, 28),
      insertCallout(doc, 12, 28, 'note'),
      toggleCodeBlock(doc, 12, 28),
      insertHr(doc, 12, 12),
    ];
    for (const r of results) {
      expect(r).not.toBeNull();
      const t = r!.text;
      // One contiguous splice: some prefix and suffix of the original survive
      // and everything between them is the only change.
      let p = 0;
      while (p < Math.min(doc.length, t.length) && doc[p] === t[p]) p++;
      let s = 0;
      while (
        s < Math.min(doc.length, t.length) - p &&
        doc[doc.length - 1 - s] === t[t.length - 1 - s]
      )
        s++;
      // The changed region never reaches the untouched first/last lines.
      expect(p).toBeGreaterThanOrEqual(11);
      expect(s).toBeGreaterThanOrEqual(6);
      // Selection offsets stay inside the new document.
      expect(r!.from).toBeGreaterThanOrEqual(0);
      expect(r!.to).toBeGreaterThanOrEqual(r!.from);
      expect(r!.to).toBeLessThanOrEqual(t.length);
    }
  });
});
