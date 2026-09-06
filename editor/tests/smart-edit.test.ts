import { describe, expect, test } from 'vitest';
import { combosConflict, DEFAULT_HOTKEYS } from '../src/lib/hotkeys';
import {
  buildAnnotationMenu,
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
  type SmartMenuAnnotations,
  type SmartMenuCtx,
  type SmartMenuEntry,
} from '../src/lib/smartEdit';

const ctx = (over: Partial<SmartMenuCtx> = {}): SmartMenuCtx => ({
  table: false,
  image: false,
  hasSelection: true,
  canPaste: true,
  hotkeys: DEFAULT_HOTKEYS,
  isMac: true,
  gridView: true, // SPEC40 §6 amendment to U65
  imageView: true, // SPEC41 §8 amendment to U65
  codeView: true, // Issue #157 amendment to U65
  diagramView: true, // PRD 013 Req 6 amendment to U65
  linkView: true, // SPEC43 §11 (issue #270) amendment to U65
  calloutView: true, // Issue #318 amendment to U65
  link: false, // SPEC43 §11 (issue #270): caret outside any link by default
  ...over,
});

const ids = (entries: SmartMenuEntry[]): string[] =>
  entries.map((e) => (e === 'sep' ? 'sep' : e.id));

const find = (entries: SmartMenuEntry[], id: string) => {
  const hit = entries.find((e) => e !== 'sep' && e.id === id);
  if (!hit || hit === 'sep') throw new Error(`no item ${id}`);
  return hit;
};

describe('SPEC43 smart edit', () => {
  test('U65: menu model and context detection', () => {
    // --- exact section/item order with no context ---------------------------
    // SPEC37 §9 amendment to U65: the contextual section is now the
    // always-present Table submenu; Resize Image… stays contextual.
    // SPEC41 §8 amendment: the Image submenu sits below Table (always
    // present); the SPEC43 top-level resize-image stub is gone.
    // Issue #157 amendment: the Code Block submenu joins them, after Image.
    // PRD 013 Req 6 amendment: the Diagram submenu joins them, after Code Block.
    // SPEC43 §11 (issue #270) amendment: the Link submenu joins them, after
    // Diagram, and the top-level `link` row moves under it — the inline group
    // reads Bold, Italic, Strikethrough, Inline Code, then the separator.
    expect(ids(buildSmartMenu(ctx()))).toEqual([
      'table', 'image', 'code-block-view', 'diagram', 'link-view',
      'sep',
      'bold', 'italic', 'strike', 'code',
      'sep',
      'heading', 'lists', 'callout', 'quote', 'code-block', 'hr',
      'sep',
      'cut', 'copy', 'paste',
    ]);
    expect(ids(buildSmartMenu(ctx({ image: true })))).not.toContain('resize-image');
    const imageSub = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'image').submenu!.map((e) => e !== 'sep' && [e.id, e.enabled]);
    expect(imageSub(ctx())).toEqual([
      ['toggle-images', true],
      ['insert-image', true],
      ['delete-image', false],
      ['resize-image', false],
    ]);
    expect(imageSub(ctx({ image: true }))).toEqual([
      ['toggle-images', true],
      ['insert-image', true],
      ['delete-image', true],
      ['resize-image', true],
    ]);
    const imgOn = find(buildSmartMenu(ctx({ imageView: true })), 'image').submenu!.find(
      (e) => e !== 'sep' && e.id === 'toggle-images'
    );
    expect(imgOn && imgOn !== 'sep' && imgOn.label).toBe('Show Raw Images');
    const imgOff = find(buildSmartMenu(ctx({ imageView: false })), 'image').submenu!.find(
      (e) => e !== 'sep' && e.id === 'toggle-images'
    );
    expect(imgOff && imgOff !== 'sep' && imgOff.label).toBe('Show Rendered Images');
    // Table submenu children + enabled flags per context.
    const tableSub = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'table').submenu!.map((e) => e !== 'sep' && [e.id, e.enabled]);
    expect(tableSub(ctx())).toEqual([
      ['toggle-grid', true],
      ['insert-table', true],
      ['delete-table', false],
    ]);
    expect(tableSub(ctx({ table: true }))).toEqual([
      ['toggle-grid', true],
      ['insert-table', false],
      ['delete-table', true],
    ]);
    // SPEC40 §6 amendment: the per-table entry is gone — the submenu's first
    // item is the always-enabled GLOBAL toggle, labeled by the view state.
    const onItem = find(buildSmartMenu(ctx({ gridView: true })), 'table').submenu!.find(
      (e) => e !== 'sep' && e.id === 'toggle-grid'
    );
    expect(onItem && onItem !== 'sep' && onItem.label).toBe('Show Raw Tables');
    expect(onItem && onItem !== 'sep' && onItem.enabled).toBe(true);
    const offItem = find(buildSmartMenu(ctx({ gridView: false })), 'table').submenu!.find(
      (e) => e !== 'sep' && e.id === 'toggle-grid'
    );
    expect(offItem && offItem !== 'sep' && offItem.label).toBe('Show Table Grid');

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
    // Issue #318 amendment: the view toggle leads the submenu; the five
    // insert rows keep their ids and order behind it.
    expect(find(buildSmartMenu(ctx()), 'callout').submenu!.map((e) => e !== 'sep' && e.id)).toEqual([
      'toggle-callouts', 'note', 'tip', 'important', 'warning', 'caution',
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

  test('U736: issue #157 — the Code Block submenu carries the always-enabled global toggle, labeled by the view state', () => {
    const sub = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'code-block-view').submenu!.map((e) => e !== 'sep' && [e.id, e.label, e.enabled]);
    // Rendered (the default): the toggle offers the way back to raw.
    expect(sub(ctx({ codeView: true }))).toEqual([['toggle-code-blocks', 'Show Raw Code', true]]);
    // Raw: it offers the cards, mirroring Show Raw Tables / Show Raw Images.
    expect(sub(ctx({ codeView: false }))).toEqual([['toggle-code-blocks', 'Show Rendered Code', true]]);
    // The submenu's ids stay clear of the top-level Inline Code / insert items.
    const top = buildSmartMenu(ctx());
    expect(find(top, 'code').label).toBe('Inline Code');
    expect(find(top, 'code-block').label).toBe('Code Block');
  });

  test('U760: PRD 013 Req 6 — the Diagram submenu carries the always-enabled global toggle, labeled by the view state', () => {
    const sub = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'diagram').submenu!.map((e) => e !== 'sep' && [e.id, e.label, e.enabled]);
    // Rendered (the default): the toggle offers the way back to raw.
    expect(sub(ctx({ diagramView: true }))).toEqual([['toggle-diagrams', 'Show Raw Diagrams', true]]);
    // Raw: it offers the diagrams, mirroring its three view neighbours.
    expect(sub(ctx({ diagramView: false }))).toEqual([
      ['toggle-diagrams', 'Show Rendered Diagrams', true],
    ]);
  });

  test('U66: inline toggles and link', () => {
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

  test('U67: headings, lists, quotes, callouts', () => {
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

  test('U68: code blocks, horizontal rule, splice consistency', () => {
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

describe('PRD 023 §§7–12 annotation menu entries (issue #286)', () => {
  const annotations = (over: Partial<SmartMenuAnnotations> = {}): SmartMenuAnnotations => ({
    insertCommentEnabled: true,
    deleteCommentEnabled: false,
    colors: ['yellow', 'green', 'orange', 'pink'],
    colorsEnabled: true,
    armedColor: 'yellow',
    removeHighlightEnabled: false,
    ...over,
  });

  test('U1140: Comment and Highlight sit below Diagram, gate-absent when annotations is null, rows carry their enabled flags and hotkeys', () => {
    // §7: with the gate closed (null/absent), NEITHER entry exists at all —
    // the popup's all-or-nothing gate, pinned as absence.
    expect(ids(buildSmartMenu(ctx()))).not.toContain('comment');
    expect(ids(buildSmartMenu(ctx({ annotations: null })))).not.toContain('highlight');

    // §7: Comment then Highlight, immediately below Diagram, above the
    // separator that precedes Bold — the Table/Image submenu idiom.
    const entries = buildSmartMenu(ctx({ annotations: annotations() }));
    // SPEC43 §11 (issue #270) amendment: Link sits between Diagram and the
    // annotation entries; the top-level `link` row lives under it now.
    expect(ids(entries)).toEqual([
      'table', 'image', 'code-block-view', 'diagram', 'link-view', 'comment', 'highlight',
      'sep',
      'bold', 'italic', 'strike', 'code',
      'sep',
      'heading', 'lists', 'callout', 'quote', 'code-block', 'hr',
      'sep',
      'cut', 'copy', 'paste',
    ]);

    // §8: Insert Comment renders its hotkey through displayCombo (mac form
    // for Mod+Alt+M) and both rows are always LISTED, each enabled by its
    // own condition — the Table submenu's Insert/Delete idiom.
    const comment = find(entries, 'comment').submenu!;
    expect(comment.map((e) => e !== 'sep' && [e.id, e.enabled])).toEqual([
      ['insert-comment', true],
      ['delete-comment', false],
    ]);
    const insert = comment.find((e) => e !== 'sep' && e.id === 'insert-comment');
    expect(insert !== 'sep' && insert?.hotkey).toBe('⌘⌥M');

    // §9: the four color rows in FIXED vocabulary order plus Remove
    // Highlight; the armed color's cue is the Mod+Alt+H hotkey it applies.
    const hl = find(entries, 'highlight').submenu!;
    expect(hl.map((e) => e !== 'sep' && e.id)).toEqual([
      'hl-yellow', 'hl-green', 'hl-orange', 'hl-pink', 'remove-highlight',
    ]);
    const armedRow = hl.find((e) => e !== 'sep' && e.id === 'hl-yellow');
    expect(armedRow !== 'sep' && armedRow?.hotkey).toBe('⌘⌥H');
    const otherRow = hl.find((e) => e !== 'sep' && e.id === 'hl-green');
    expect(otherRow !== 'sep' && otherRow?.hotkey).toBeUndefined();
    // A different armed color moves the cue, never the order.
    const rearmed = find(
      buildSmartMenu(ctx({ annotations: annotations({ armedColor: 'pink' }) })),
      'highlight'
    ).submenu!;
    expect(rearmed.map((e) => e !== 'sep' && e.id)).toEqual([
      'hl-yellow', 'hl-green', 'hl-orange', 'hl-pink', 'remove-highlight',
    ]);
    const pinkRow = rearmed.find((e) => e !== 'sep' && e.id === 'hl-pink');
    expect(pinkRow !== 'sep' && pinkRow?.hotkey).toBe('⌘⌥H');

    // §§10–11: disabled contexts grey the rows in place — still listed.
    const greyed = buildSmartMenu(
      ctx({
        annotations: annotations({
          insertCommentEnabled: false,
          colorsEnabled: false,
          deleteCommentEnabled: true,
          removeHighlightEnabled: true,
        }),
      })
    );
    const gComment = find(greyed, 'comment').submenu!;
    expect(gComment.map((e) => e !== 'sep' && [e.id, e.enabled])).toEqual([
      ['insert-comment', false],
      ['delete-comment', true],
    ]);
    const gHl = find(greyed, 'highlight').submenu!;
    expect(gHl.map((e) => e !== 'sep' && [e.id, e.enabled])).toEqual([
      ['hl-yellow', false],
      ['hl-green', false],
      ['hl-orange', false],
      ['hl-pink', false],
      ['remove-highlight', true],
    ]);

    // §12: the two new defaults collide with no shipped combo (chord-level
    // conflict, not string equality — issue #84).
    for (const fresh of ['Mod+Alt+M', 'Mod+Alt+H']) {
      for (const [name, combo] of Object.entries(DEFAULT_HOTKEYS)) {
        if (combo === fresh) continue; // its own entry
        expect(combosConflict(fresh, combo), `${fresh} vs ${name}`).toBe(false);
      }
    }
  });

  test('U1147: PRD 023 §13 (issue #287) — the shared annotation builder emits exactly the Comment/Highlight rows, and buildSmartMenu embeds its output verbatim', () => {
    const a = annotations({ armedColor: 'green', deleteCommentEnabled: true });
    const built = buildAnnotationMenu(a, DEFAULT_HOTKEYS, true);

    // Exactly two top-level rows — no text-editing id, no separator, ever.
    expect(ids(built)).toEqual(['comment', 'highlight']);
    const leafIds = built.flatMap((e) =>
      e === 'sep' || !e.submenu ? [] : e.submenu.map((s) => (s === 'sep' ? 'sep' : s.id))
    );
    expect(leafIds).toEqual([
      'insert-comment', 'delete-comment',
      'hl-yellow', 'hl-green', 'hl-orange', 'hl-pink', 'remove-highlight',
    ]);

    // The known id set is closed: nothing outside it can appear from this
    // builder — the preview menu can never grow a text-editing row.
    const KNOWN = new Set([
      'comment', 'highlight',
      'insert-comment', 'delete-comment',
      'hl-yellow', 'hl-green', 'hl-orange', 'hl-pink', 'remove-highlight',
    ]);
    for (const id of [...ids(built), ...leafIds]) expect(KNOWN.has(id)).toBe(true);

    // Hotkey cues render through displayCombo like the editor rows: Insert
    // Comment always, the ARMED color's row only.
    const insert = find(built, 'comment').submenu!.find((e) => e !== 'sep' && e.id === 'insert-comment');
    expect(insert !== 'sep' && insert?.hotkey).toBe('⌘⌥M');
    const armed = find(built, 'highlight').submenu!.find((e) => e !== 'sep' && e.id === 'hl-green');
    expect(armed !== 'sep' && armed?.hotkey).toBe('⌘⌥H');

    // buildSmartMenu's Comment/Highlight block IS the shared builder's
    // output — deep-equal, so the two surfaces cannot drift.
    const full = buildSmartMenu(ctx({ annotations: a }));
    expect([find(full, 'comment'), find(full, 'highlight')]).toEqual(built);
  });

  test('U1153: SPEC43 §11 (issue #270) — the Link submenu: position after Diagram, its three rows, and no top-level link row', () => {
    const entries = buildSmartMenu(ctx());
    const top = ids(entries);
    // After Diagram, before the first separator; the inline group has no link.
    expect(top.indexOf('link-view')).toBe(top.indexOf('diagram') + 1);
    expect(top).not.toContain('link');

    // The rows in order, with ids, labels, hotkeys and enabled flags.
    const sub = find(entries, 'link-view').submenu!;
    expect(sub.map((e) => e !== 'sep' && [e.id, e.label])).toEqual([
      ['toggle-links', 'Show Raw Links'],
      ['link', 'Create Link'],
      ['open-link', 'Open Link'],
    ]);
    const create = sub.find((e) => e !== 'sep' && e.id === 'link');
    expect(create !== 'sep' && create?.hotkey).toBe('⌘⇧K');
    expect(create !== 'sep' && create?.enabled).toBe(true);
    // Open Link documents its binding through displayCombo, mac and PC forms.
    const open = sub.find((e) => e !== 'sep' && e.id === 'open-link');
    expect(open !== 'sep' && open?.hotkey).toBe('⌘⌥O');
    const pc = find(buildSmartMenu(ctx({ isMac: false })), 'link-view').submenu!.find(
      (e) => e !== 'sep' && e.id === 'open-link'
    );
    expect(pc !== 'sep' && pc?.hotkey).toBe('Ctrl+Alt+O');
  });

  test('U1154: SPEC43 §11 (issue #270) — the toggle label follows the view flag; Open Link is enabled only with the link context', () => {
    const toggleOf = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'link-view').submenu!.find((e) => e !== 'sep' && e.id === 'toggle-links');
    const on = toggleOf(ctx({ linkView: true }));
    expect(on !== 'sep' && on && [on.label, on.enabled]).toEqual(['Show Raw Links', true]);
    const off = toggleOf(ctx({ linkView: false }));
    expect(off !== 'sep' && off && [off.label, off.enabled]).toEqual(['Show Rendered Links', true]);

    const openOf = (c: SmartMenuCtx) =>
      find(buildSmartMenu(c), 'link-view').submenu!.find((e) => e !== 'sep' && e.id === 'open-link');
    const out = openOf(ctx({ link: false }));
    expect(out !== 'sep' && out?.enabled).toBe(false); // disabled, never absent
    const inside = openOf(ctx({ link: true }));
    expect(inside !== 'sep' && inside?.enabled).toBe(true);
  });

  test('U1247: Issue #318 — the Callout submenu leads with the view toggle whose label follows the flag; the five insert rows keep ids, labels, order and no hotkey', () => {
    const sub = (c: SmartMenuCtx) => find(buildSmartMenu(c), 'callout').submenu!;
    const rows = sub(ctx({ calloutView: true })).map((e) => e !== 'sep' && [e.id, e.label, e.hotkey]);
    expect(rows).toEqual([
      ['toggle-callouts', 'Show Raw Callouts', undefined],
      ['note', 'Note', undefined],
      ['tip', 'Tip', undefined],
      ['important', 'Important', undefined],
      ['warning', 'Warning', undefined],
      ['caution', 'Caution', undefined],
    ]);
    const off = sub(ctx({ calloutView: false }))[0];
    expect(off !== 'sep' && off && [off.id, off.label, off.enabled]).toEqual(['toggle-callouts', 'Show Rendered Callouts', true]);
    // The flip changes nothing else in the submenu.
    expect(sub(ctx({ calloutView: false })).slice(1)).toEqual(sub(ctx({ calloutView: true })).slice(1));
  });

  test('U1155: SPEC43 §11 (issue #270) — the whole default map stays chord-conflict-free with openLink in it', () => {
    expect(DEFAULT_HOTKEYS.openLink).toBe('Mod+Alt+O');
    const entries = Object.entries(DEFAULT_HOTKEYS);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        expect(
          combosConflict(entries[i][1], entries[j][1]),
          `${entries[i][0]} vs ${entries[j][0]}`
        ).toBe(false);
      }
    }
  });
});
