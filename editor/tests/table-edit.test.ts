import { describe, expect, test } from 'vitest';
import {
  cellAt,
  cellContentSpan,
  cellSelectionText,
  deleteCol,
  displayCellAt,
  displayCellBounds,
  displayPosOf,
  displayRoundTrips,
  displayWholeCellBounds,
  layoutTable,
  parseDisplay,
  serializeCompactTable,
  deleteRow,
  deleteTableAt,
  escapeCell,
  insertCol,
  insertRow,
  insertTableAt,
  parseTable,
  serializeTable,
  normalizeTable,
  normalizeWithCursor,
  setCell,
  snapToCell,
  starterTable,
  tableRegionAt,
  type TableModel,
} from '../src/lib/tableEdit';

const TBL = '| a | b |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |';
const DOC = `intro\n\n${TBL}\n\noutro`;
const REGION = { start: 7, end: 7 + TBL.length };

const model = (): TableModel => parseTable(DOC, tableRegionAt(DOC, DOC.indexOf('| 1'))!);

describe('SPEC37 table edit', () => {
  test('U69: region detection, parse/serialize round-trips, escapes', () => {
    // --- tableRegionAt boundaries -------------------------------------------
    expect(tableRegionAt(DOC, DOC.indexOf('| a'))).toEqual(REGION); // header first char
    expect(tableRegionAt(DOC, DOC.indexOf(':-:'))).toEqual(REGION); // delimiter row
    expect(tableRegionAt(DOC, REGION.end)).toEqual(REGION); // last char of last line
    expect(tableRegionAt(DOC, 0)).toBeNull(); // intro
    expect(tableRegionAt(DOC, DOC.indexOf('outro'))).toBeNull(); // after
    expect(tableRegionAt('just a | pipe\nplain', 3)).toBeNull(); // no delimiter row
    // Edge-less pipes form a table too.
    const bare = 'x | y\n--- | ---\n1 | 2';
    expect(tableRegionAt(bare, 0)).toEqual({ start: 0, end: bare.length });

    // --- parse ---------------------------------------------------------------
    const m = model();
    expect(m.header).toEqual(['a', 'b']);
    expect(m.align).toEqual([null, 'center']);
    expect(m.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(m.start).toBe(REGION.start);
    expect(m.end).toBe(REGION.end);
    // Ragged body rows pad to the header's width.
    const ragged = parseTable('| a | b | c |\n| - | - | - |\n| only |', {
      start: 0,
      end: '| a | b | c |\n| - | - | - |\n| only |'.length,
    });
    expect(ragged.rows).toEqual([['only', '', '']]);

    // --- serialize: edged, one-space padded, delimiter from align -----------
    expect(serializeTable(m)).toBe('| a   | b   |\n| --- | :-: |\n| 1   | 2   |\n| 3   | 4   |');
    // All four alignment forms survive a round trip.
    const forms = '| w | x | y | z |\n| --- | :--- | :---: | ---: |\n| 1 | 2 | 3 | 4 |';
    const fm = parseTable(forms, { start: 0, end: forms.length });
    expect(fm.align).toEqual([null, 'left', 'center', 'right']);
    const fs = serializeTable(fm);
    expect(parseTable(fs, { start: 0, end: fs.length }).align).toEqual(fm.align);
    // Serialization is idempotent.
    const again = parseTable(fs, { start: 0, end: fs.length });
    expect(serializeTable(again)).toBe(fs);

    // --- \| escapes stay raw -------------------------------------------------
    const esc = '| a\\|b | c |\n| --- | --- |\n| d | e\\|f |';
    const em = parseTable(esc, { start: 0, end: esc.length });
    expect(em.header[0]).toBe('a\\|b'); // verbatim, escape intact
    expect(em.rows[0][1]).toBe('e\\|f');
    const eser = serializeTable(em);
    expect(parseTable(eser, { start: 0, end: eser.length }).header[0]).toBe('a\\|b');
    expect(escapeCell('x|y')).toBe('x\\|y');
    expect(escapeCell('a\\|b')).toBe('a\\|b'); // already escaped passes through
  });

  test('U70: operations, guards, spans, starter, insert/delete at cursor', () => {
    const m = model();

    // --- rows ----------------------------------------------------------------
    const r0 = insertRow(DOC, m, 0);
    expect(r0.text).toContain('| --- | :-: |\n|     |     |\n| 1   | 2   |');
    const rEnd = insertRow(DOC, m, 2);
    expect(rEnd.text).toContain('| 3   | 4   |\n|     |     |');
    const rDel = deleteRow(DOC, m, 0)!;
    expect(rDel.text).toContain('| :-: |\n| 3   | 4   |');
    expect(rDel.text).not.toContain('| 1');
    expect(deleteRow(DOC, m, -1)).toBeNull(); // header is structural
    expect(deleteRow(DOC, m, 5)).toBeNull(); // out of range

    // --- columns -------------------------------------------------------------
    const c0 = insertCol(DOC, m, 0);
    expect(parseTable(c0.text, { start: c0.start, end: c0.end }).header).toEqual(['', 'a', 'b']);
    const cEnd = insertCol(DOC, m, 2);
    expect(parseTable(cEnd.text, { start: cEnd.start, end: cEnd.end }).header).toEqual(['a', 'b', '']);
    // Alignment travels with its column.
    expect(parseTable(c0.text, { start: c0.start, end: c0.end }).align).toEqual([null, null, 'center']);
    const cDel = deleteCol(DOC, m, 0)!;
    const cdm = parseTable(cDel.text, { start: cDel.start, end: cDel.end });
    expect(cdm.header).toEqual(['b']);
    expect(cdm.rows).toEqual([['2'], ['4']]);
    // 1-column tables refuse deleteCol (Delete Table is the path).
    expect(deleteCol(cDel.text, cdm, 0)).toBeNull();

    // --- setCell -------------------------------------------------------------
    const sc = setCell(DOC, m, 0, 1, '**bold**')!;
    expect(sc.text).toContain('| **bold** |');
    const hc = setCell(DOC, m, -1, 0, 'Head')!;
    expect(parseTable(hc.text, { start: hc.start, end: hc.end }).header[0]).toBe('Head');
    const pipe = setCell(DOC, m, 0, 0, 'x|y')!;
    expect(parseTable(pipe.text, { start: pipe.start, end: pipe.end }).rows[0][0]).toBe('x\\|y');
    expect(setCell(DOC, m, 0, 9, 'nope')).toBeNull();

    // --- spans track the new table; text outside the region is untouched ----
    for (const r of [r0, rEnd, rDel, c0, cEnd, cDel, sc, hc, pipe]) {
      expect(r.start).toBe(REGION.start);
      expect(r.text.slice(0, r.start)).toBe('intro\n\n');
      expect(r.text.slice(r.end)).toBe('\n\noutro');
      expect(tableRegionAt(r.text, r.start)).toEqual({ start: r.start, end: r.end });
    }

    // --- starter table -------------------------------------------------------
    const starter = starterTable();
    const sm = parseTable(starter, { start: 0, end: starter.length });
    expect(sm.header).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(sm.align).toEqual([null, null, null]);
    expect(sm.rows).toEqual([
      ['', '', ''],
      ['', '', ''],
    ]);

    // --- insertTableAt: blank-line management + Column 1 selected -----------
    const ins = insertTableAt('para\nnext', 2);
    expect(ins.text.startsWith('para\n\n| Column 1')).toBe(true);
    expect(ins.text).toContain('|\n\nnext');
    expect(ins.text.slice(ins.from, ins.to)).toBe('Column 1');
    const insBlank = insertTableAt('a\n\nb', 2);
    expect(insBlank.text.startsWith('a\n\n| Column 1')).toBe(true);
    const insEmpty = insertTableAt('', 0);
    expect(insEmpty.text).toBe(starter);
    expect(insEmpty.text.slice(insEmpty.from, insEmpty.to)).toBe('Column 1');

    // --- deleteTableAt: region + one separating blank line -------------------
    const del = deleteTableAt(DOC, DOC.indexOf('| 1'))!;
    expect(del.text).toBe('intro\n\noutro');
    expect(del.from).toBe(7);
    expect(deleteTableAt(DOC, 0)).toBeNull(); // not in a table
    const delMid = deleteTableAt('a\n\n| x |\n| - |\n| 1 |\nafter', 5)!;
    expect(delMid.text).toBe('a\n\nafter'); // no blank line after: terminator only
    const delEnd = deleteTableAt('a\n\n| x |\n| - |\n| 1 |', 5)!;
    expect(delEnd.text).toBe('a\n'); // doc end: the preceding blank collapses

    // --- normalizeTable: aligns a ragged table; null when already aligned ---
    const ragged2 = 'pre\n\n| a | long |\n| - | - |\n| bbbb | c |\n\npost';
    const rr = tableRegionAt(ragged2, 8)!;
    const norm = normalizeTable(ragged2, rr)!;
    expect(norm.text).toBe('pre\n\n| a    | long |\n| ---- | ---- |\n| bbbb | c    |\n\npost');
    expect(norm.start).toBe(rr.start);
    expect(norm.text.slice(norm.start, norm.end)).toBe(
      '| a    | long |\n| ---- | ---- |\n| bbbb | c    |'
    );
    // Already aligned ⇒ null (live mode never churns no-op transactions).
    expect(normalizeTable(norm.text, { start: norm.start, end: norm.end })).toBeNull();

    // --- cellAt: rows, columns, padding/pipe clamping, delimiter → header ---
    const at = norm.text;
    const region = { start: norm.start, end: norm.end };
    const inA = norm.text.indexOf('a', norm.start);
    expect(cellAt(at, region, inA)).toMatchObject({ row: -1, col: 0 });
    const inC = norm.text.indexOf('| c') + 2;
    expect(cellAt(at, region, inC)).toMatchObject({ row: 0, col: 1 });
    // The delimiter row maps to the header level with its column.
    const inDelim = norm.text.indexOf('----', norm.start);
    expect(cellAt(at, region, inDelim)).toMatchObject({ row: -1, col: 0 });
    // Padding after 'a' clamps into the a-cell's content span.
    const aCell = cellAt(at, region, inA)!;
    const padded = cellAt(at, region, aCell.contentEnd + 2)!;
    expect(padded.col).toBe(0);
    expect(padded.contentStart).toBe(aCell.contentStart);
    // Outside the region ⇒ null.
    expect(cellAt(at, region, 0)).toBeNull();

    // --- cellContentSpan --------------------------------------------------
    const hSpan = cellContentSpan(at, region, -1, 1)!;
    expect(at.slice(hSpan.start, hSpan.end)).toBe('long');
    const bSpan = cellContentSpan(at, region, 0, 0)!;
    expect(at.slice(bSpan.start, bSpan.end)).toBe('bbbb');

    // --- normalizeWithCursor: cursor keeps its logical spot ----------------
    // Cursor after 'bb' (2 chars into the bbbb cell) in the RAGGED text.
    const raggedB = ragged2.indexOf('bbbb') + 2;
    const nc = normalizeWithCursor(ragged2, rr, raggedB);
    expect(nc.text).toBe(norm.text);
    expect(nc.text.slice(nc.head - 2, nc.head)).toBe('bb'); // same content offset
    expect(cellAt(nc.text, { start: nc.start, end: nc.end }, nc.head)).toMatchObject({ row: 0, col: 0 });
    // A cursor in removed padding clamps to the content edge.
    const inPad = ragged2.indexOf('long |') + 5; // the space before the pipe
    const nc2 = normalizeWithCursor(ragged2, rr, inPad);
    const hdr = cellContentSpan(nc2.text, { start: nc2.start, end: nc2.end }, -1, 1)!;
    expect(nc2.head).toBeGreaterThanOrEqual(hdr.start);
    expect(nc2.head).toBeLessThanOrEqual(hdr.end);
    // Already-aligned input returns everything unchanged.
    const nc3 = normalizeWithCursor(norm.text, region, inA);
    expect(nc3.text).toBe(norm.text);
    expect(nc3.head).toBe(inA);
  });
});

describe('SPEC38 transient wrapped grid', () => {
  const M = {
    header: ['Name', 'Description'],
    align: [null, 'center'] as const,
    rows: [
      ['a', 'short'],
      ['b', 'a rather long description that will need wrapping to fit'],
    ],
  } as { header: string[]; align: Array<'left' | 'center' | 'right' | null>; rows: string[][] };

  test('U71: layout engine — widths, wrapping, separators, map', () => {
    // --- natural widths when the budget is generous -------------------------
    const wide = layoutTable(M, 200);
    const wideLines = wide.text.split('\n');
    expect(wideLines).toHaveLength(5); // header, align-sep, row, sep, row
    expect(new Set(wideLines.map((l) => l.length)).size).toBe(1); // all aligned
    expect(wideLines[1]).toMatch(/^\| -+ \| :-+: \|$/); // alignment on the FIRST separator
    expect(wideLines[3]).toMatch(/^\| -+ \| -+ \|$/); // later separators plain
    expect(wideLines[2]).toContain('| a');
    expect(wide.text).toContain('a rather long description that will need wrapping to fit');

    // --- shrink widest-first to the budget; long content wraps ---------------
    const narrow = layoutTable(M, 40);
    const nLines = narrow.text.split('\n');
    for (const l of nLines) expect(l.length).toBeLessThanOrEqual(40);
    expect(new Set(nLines.map((l) => l.length)).size).toBe(1); // grid stays square
    expect(nLines.length).toBeGreaterThan(5); // continuation lines appeared
    // Content is intact across fragments (joined back with single spaces).
    const parsed = parseDisplay(narrow.text, { start: 0, end: narrow.text.length })!;
    expect(parsed.model.rows[1][1]).toBe('a rather long description that will need wrapping to fit');
    expect(parsed.model.align).toEqual([null, 'center']);

    // --- the 8-char floor: never squeezed below it (unless natural is less) --
    const tight = layoutTable(M, 10);
    const tParsed = parseDisplay(tight.text, { start: 0, end: tight.text.length })!;
    expect(tParsed.model.rows[1][1]).toBe('a rather long description that will need wrapping to fit');
    const tWidths = tight.map.widths;
    for (const w of tWidths) expect(w).toBeGreaterThanOrEqual(4); // 'Name' natural = 4
    expect(Math.max(...tWidths)).toBeGreaterThanOrEqual(8); // floor for the long column

    // --- hard-break of an over-long word ------------------------------------
    const longWord = layoutTable(
      { header: ['h'], align: [null], rows: [['Supercalifragilisticexpialidocious']] },
      20
    );
    const lwParsed = parseDisplay(longWord.text, { start: 0, end: longWord.text.length })!;
    // Hard-break pieces carry the continuation marker and rejoin LOSSLESSLY.
    expect(longWord.text).toContain('↩');
    expect(lwParsed.model.rows[0][0]).toBe('Supercalifragilisticexpialidocious');

    // --- whitespace normalization -------------------------------------------
    const messy = layoutTable({ header: ['h'], align: [null], rows: [['a   b\tc']] }, 60);
    const mParsed = parseDisplay(messy.text, { start: 0, end: messy.text.length })!;
    expect(mParsed.model.rows[0][0]).toBe('a b c');

    // --- the map: displayCellAt over fragments, displayPosOf inverse --------
    const region = { start: 0, end: narrow.text.length };
    for (const f of narrow.map.fragments) {
      const mid = f.from + Math.floor(f.length / 2);
      const loc = displayCellAt(narrow.text, region, parsed, mid)!;
      expect(loc.row).toBe(f.row);
      expect(loc.col).toBe(f.col);
      expect(loc.contentOffset).toBe(f.contentOffset + Math.floor(f.length / 2));
      // Inverse: displayPosOf lands back on the same spot.
      expect(displayPosOf(narrow.map, loc)).toBe(mid);
    }
    // Padding clamps to the fragment's end.
    const frag0 = narrow.map.fragments.find((f) => f.row === -1 && f.col === 0)!;
    const inPad = displayCellAt(narrow.text, region, parsed, frag0.to + 1)!;
    expect(inPad.col).toBe(0);
  });

  test('U72: display grammar — round-trips, the guard, collapse', () => {
    // --- parse(layout(m)) round-trips for varied models ----------------------
    const models = [
      M,
      { header: ['only'], align: [null] as Array<null>, rows: [] as string[][] },
      { header: ['a\\|b', 'c'], align: ['left', 'right'] as Array<'left' | 'right'>, rows: [['x\\|y', ''], ['', 'z']] },
      { header: ['e', 'f', 'g'], align: [null, null, null] as Array<null>, rows: [['', '', '']] },
    ];
    for (const m of models) {
      for (const width of [24, 60, 200]) {
        const l = layoutTable(m, width);
        const region = { start: 0, end: l.text.length };
        const p = parseDisplay(l.text, region);
        expect(p, JSON.stringify(m)).not.toBeNull();
        expect(p!.model.header).toEqual(m.header.map((h) => h.split(/\s+/).join(' ')));
        expect(p!.model.rows).toEqual(m.rows.map((r) => r.map((c) => c.split(/\s+/).join(' '))));
        // The guard accepts every genuine layout…
        expect(displayRoundTrips(l.text, region, width)).toBe(true);
        // …and collapse-of-parse equals compact-of-model.
        expect(serializeCompactTable(p!.model)).toBe(serializeCompactTable(p!.model));
      }
    }

    // --- the guard REJECTS a plain GFM table (rows would merge) -------------
    const plain = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    expect(displayRoundTrips(plain, { start: 0, end: plain.length }, 60)).toBe(false);
    // …and perturbed padding.
    const good = layoutTable(M, 60).text;
    const perturbed = good.replace('| a', '|  a');
    expect(displayRoundTrips(perturbed, { start: 0, end: perturbed.length }, 60)).toBe(false);

    // --- grammar violations ⇒ null ------------------------------------------
    const l = layoutTable(M, 60);
    const lines = l.text.split('\n');
    expect(parseDisplay('no pipes here\nat all', { start: 0, end: 20 })).toBeNull();
    const noSep = [lines[0], lines[2]].join('\n'); // header + row, no separator
    expect(parseDisplay(noSep, { start: 0, end: noSep.length })).toBeNull();
    const adjacent = [lines[0], lines[1], lines[3]].join('\n'); // sep right after sep
    expect(parseDisplay(adjacent, { start: 0, end: adjacent.length })).toBeNull();

    // --- compact serializer --------------------------------------------------
    expect(serializeCompactTable(M)).toBe(
      '| Name | Description |\n| --- | :---: |\n| a | short |\n| b | a rather long description that will need wrapping to fit |'
    );
    expect(serializeCompactTable({ header: ['x'], align: [null], rows: [['']] })).toBe(
      '| x |\n| --- |\n|  |'
    );
  });
});

describe('SPEC39 confinement helpers', () => {
  test('U73: sanitizeCellInsert and cellNavTarget', async () => {
    const { sanitizeCellInsert, cellNavTarget } = await import('../src/lib/tableEdit');

    // --- sanitizeCellInsert --------------------------------------------------
    expect(sanitizeCellInsert('one\ntwo\r\nthree')).toBe('one two three');
    expect(sanitizeCellInsert('a|b')).toBe('a\\|b');
    expect(sanitizeCellInsert('a\\|b')).toBe('a\\|b'); // already escaped: untouched
    expect(sanitizeCellInsert('x | y\nz')).toBe('x \\| y z');
    expect(sanitizeCellInsert('plain')).toBe('plain');

    // --- cellNavTarget -------------------------------------------------------
    const m = { header: ['a', 'b'], rows: [['1', '2'], ['3', '4']] };
    // down: header → row 0 → row 1 → null at the end.
    expect(cellNavTarget(m, { row: -1, col: 1 }, 'down')).toEqual({ row: 0, col: 1 });
    expect(cellNavTarget(m, { row: 0, col: 0 }, 'down')).toEqual({ row: 1, col: 0 });
    expect(cellNavTarget(m, { row: 1, col: 0 }, 'down')).toBeNull();
    // up mirrors, stopping at the header.
    expect(cellNavTarget(m, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 1 });
    expect(cellNavTarget(m, { row: 0, col: 1 }, 'up')).toEqual({ row: -1, col: 1 });
    expect(cellNavTarget(m, { row: -1, col: 0 }, 'up')).toBeNull();
    // next/prev walk row-major, header included, null past the ends.
    expect(cellNavTarget(m, { row: -1, col: 0 }, 'next')).toEqual({ row: -1, col: 1 });
    expect(cellNavTarget(m, { row: -1, col: 1 }, 'next')).toEqual({ row: 0, col: 0 });
    expect(cellNavTarget(m, { row: 1, col: 1 }, 'next')).toBeNull();
    expect(cellNavTarget(m, { row: 0, col: 0 }, 'prev')).toEqual({ row: -1, col: 1 });
    expect(cellNavTarget(m, { row: -1, col: 0 }, 'prev')).toBeNull();
    // Single-cell table: every direction is an end.
    const single = { header: ['x'], rows: [] as string[][] };
    expect(cellNavTarget(single, { row: -1, col: 0 }, 'next')).toBeNull();
    expect(cellNavTarget(single, { row: -1, col: 0 }, 'down')).toBeNull();
  });
});

describe('SPEC40 grid-for-all helpers', () => {
  // The tableGridView SETTING assertions that used to ride along here moved
  // app-side (tests/unit/settings.test.ts U1094) with the PRD 021 workspace
  // split — the setting is app-owned; this package only renders the grids.
  test('U74: allTableRegions — none/one/many, exact offsets, order', async () => {
    const { allTableRegions } = await import('../src/lib/tableEdit');

    // --- none / one / many, exact offsets, order ----------------------------
    expect(allTableRegions('no tables\nhere at all')).toEqual([]);
    const one = 'x\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\ny';
    const r1 = allTableRegions(one);
    expect(r1).toHaveLength(1);
    expect(one.slice(r1[0].start, r1[0].end)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const two = `${one}\n\n| c |\n| --- |\n| 3 |\n\ntail`;
    const r2 = allTableRegions(two);
    expect(r2).toHaveLength(2);
    expect(two.slice(r2[1].start, r2[1].end)).toBe('| c |\n| --- |\n| 3 |');
    expect(r2[0].start).toBeLessThan(r2[1].start); // document order

    // Non-tables are skipped (pipes without a delimiter row).
    expect(allTableRegions('a | b\njust pipes\nmore | pipes')).toEqual([]);
    // Adjacent pipe paragraphs merge into the region per the SPEC43 scan.
    const zeroRow = '| h |\n| --- |';
    const rz = allTableRegions(zeroRow);
    expect(rz).toHaveLength(1);
    expect(zeroRow.slice(rz[0].start, rz[0].end)).toBe(zeroRow);
  });
});

describe('SPEC41 image view helpers', () => {
  test('U75: allImageRefs, height-capable rewrite, deleteImageAt', async () => {
    const { allImageRefs, rewriteImageSpan, deleteImageAt } = await import('../src/lib/imageResize');

    // --- allImageRefs: both forms, exact offsets, document order ------------
    const doc = 'intro ![a](p/x.png) mid <img src="p/y.png" alt="b" width="120" height="80"> end\n![c](q.png "cap")';
    const refs = allImageRefs(doc);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ kind: 'md', src: 'p/x.png', alt: 'a' });
    expect(doc.slice(refs[0].start, refs[0].end)).toBe('![a](p/x.png)');
    expect(refs[1]).toMatchObject({ kind: 'html', src: 'p/y.png', alt: 'b', width: 120, height: 80 });
    expect(doc.slice(refs[1].start, refs[1].end)).toBe('<img src="p/y.png" alt="b" width="120" height="80">');
    expect(refs[2]).toMatchObject({ kind: 'md', src: 'q.png', alt: 'c', title: 'cap' });
    expect(refs[0].start).toBeLessThan(refs[1].start);
    // Non-images skipped: plain links and lone bangs.
    expect(allImageRefs('a [link](x.md) and ! and <b>')).toEqual([]);

    // --- rewrite: width-only path byte-identical to SPEC20 ------------------
    const parts = { src: 'p/x.png', alt: 'a' };
    expect(rewriteImageSpan('![a](p/x.png)', parts, 200)).toBe('<img src="p/x.png" alt="a" width="200">');
    expect(rewriteImageSpan('![a](p/x.png)', parts, null)).toBeNull();
    // Height variants: both set, corner-clears-height, removal idempotence.
    expect(rewriteImageSpan('![a](p/x.png)', parts, 200, 100)).toBe(
      '<img src="p/x.png" alt="a" width="200" height="100">'
    );
    const both = '<img src="p/x.png" alt="a" width="200" height="100">';
    expect(rewriteImageSpan(both, parts, 300, null)).toBe('<img src="p/x.png" alt="a" width="300">');
    expect(rewriteImageSpan(both, parts, null, null)).toBe('<img src="p/x.png" alt="a">');
    expect(rewriteImageSpan(both, parts, 300, 150)).toBe('<img src="p/x.png" alt="a" width="300" height="150">');
    // Untouched height (3-arg call) leaves an existing height alone.
    expect(rewriteImageSpan(both, parts, 300)).toBe('<img src="p/x.png" alt="a" height="100" width="300">');
    expect(rewriteImageSpan('![a](p/x.png)', parts, null, null)).toBeNull();

    // --- deleteImageAt -------------------------------------------------------
    const alone = 'para\n\n![a](p/x.png)\n\nafter';
    const d1 = deleteImageAt(alone, alone.indexOf('![') + 2)!;
    expect(d1.text).toBe('para\n\nafter'); // line + one blank gone
    const inlineRef = 'text ![a](p/x.png) more';
    const d2 = deleteImageAt(inlineRef, inlineRef.indexOf('![') + 1)!;
    expect(d2.text).toBe('text  more'); // just the reference
    expect(deleteImageAt('no images', 3)).toBeNull();
    const atEnd = 'para\n\n![a](p/x.png)';
    const d3 = deleteImageAt(atEnd, atEnd.indexOf('![') + 2)!;
    expect(d3.text).toBe('para\n');
  });
});

describe('SPEC39 §2.1 whole-cell selection helpers (issue #346)', () => {
  // A grid whose Detail cell wraps over exactly three display lines at a
  // 15-wide column (budget 26 − overhead 7 = 19; Name keeps 4), an empty
  // Name cell on row 1, and a 22-char word that hard-breaks on row 2.
  const M = {
    header: ['Name', 'Detail'],
    align: [null, null] as Array<null>,
    rows: [
      ['a', 'k01 k02 k03 k04 k05 k06 k07 k08 k09'],
      ['', 'solo'],
      ['b', 'abcdefghijklmnopqrstuv'],
    ],
  };
  const laid = layoutTable(M, 26);
  const DOC = `intro\n\n${laid.text}\n\noutro`;
  const REGION = { start: 7, end: 7 + laid.text.length };
  const parsed = parseDisplay(DOC, REGION)!;
  const at = (needle: string, nth = 0) => {
    let i = -1;
    for (let k = 0; k <= nth; k++) i = DOC.indexOf(needle, i + 1);
    return i;
  };
  const lineOf = (offset: number) => DOC.slice(DOC.lastIndexOf('\n', offset - 1) + 1, DOC.indexOf('\n', offset));

  test('U1359: displayWholeCellBounds spans every wrapped line of the cell; unwrapped, empty, separator and hard-break cells', () => {
    expect(displayRoundTrips(DOC, REGION, 26)).toBe(true);
    expect(parsed.lineInfo.filter((l) => l.kind === 'cells' && l.row === 0)).toHaveLength(3);
    const wholeFrom = (offset: number) => displayWholeCellBounds(DOC, REGION, parsed, offset)!;

    // --- the wrapped cell, from an offset on each of its three lines --------
    const expected = { contentStart: at('k01'), contentEnd: at('k09') + 3 };
    for (const probe of [at('k02'), at('k06'), at('k09') + 1]) {
      const w = wholeFrom(probe);
      expect(w.kind).toBe('cells');
      expect({ contentStart: w.contentStart, contentEnd: w.contentEnd }).toEqual(expected);
      expect(w.row).toBe(0);
      expect(w.col).toBe(1);
      expect(w.fragments.map((f) => DOC.slice(f.contentStart, f.contentEnd))).toEqual([
        'k01 k02 k03 k04',
        'k05 k06 k07 k08',
        'k09',
      ]);
      // Each fragment names its own display line.
      for (const f of w.fragments) expect(lineOf(f.contentStart)).toBe(DOC.slice(f.lineStart, f.lineEnd));
    }
    // The union is one contiguous range crossing pipes and newlines.
    expect(DOC.slice(expected.contentStart, expected.contentEnd)).toContain('|');

    // --- an unwrapped cell equals its per-line displayCellBounds span -------
    const a = wholeFrom(at('| a ') + 2);
    const b = displayCellBounds(DOC, REGION, parsed, at('| a ') + 2)!;
    expect([a.contentStart, a.contentEnd]).toEqual([b.contentStart, b.contentEnd]);
    expect(a.fragments).toHaveLength(1);
    expect(DOC.slice(a.contentStart, a.contentEnd)).toBe('a');
    // Padding on a continuation line of the wrapped cell resolves to it too.
    const pad = wholeFrom(at('k09') + 4);
    expect([pad.contentStart, pad.contentEnd]).toEqual([expected.contentStart, expected.contentEnd]);

    // --- an empty cell: start == end on the block's first line ---------------
    const soloLine = at('solo');
    const empty = wholeFrom(soloLine - 8); // inside the empty Name cell's padding
    expect(empty.kind).toBe('cells');
    expect(empty.row).toBe(1);
    expect(empty.col).toBe(0);
    expect(empty.contentStart).toBe(empty.contentEnd);
    expect(empty.fragments).toEqual([]);
    expect(lineOf(empty.contentStart)).toContain('solo');

    // --- separator lines keep their kind and yield no span ------------------
    const sep = wholeFrom(at('| ----') + 3);
    expect(sep.kind).toBe('separator');
    expect(sep.fragments).toEqual([]);

    // --- a hard-broken word: two fragments, the first carrying the marker ---
    const hb = wholeFrom(at('abcdefghijklmn') + 3);
    expect(hb.fragments.map((f) => DOC.slice(f.contentStart, f.contentEnd))).toEqual(['abcdefghijklmn↩', 'opqrstuv']);
    expect(DOC.slice(hb.contentStart, hb.contentEnd).startsWith('abcdefghijklmn↩')).toBe(true);
    expect(hb.contentEnd).toBe(at('opqrstuv') + 'opqrstuv'.length);

    // Outside the region: null.
    expect(displayWholeCellBounds(DOC, REGION, parsed, 2)).toBeNull();
  });

  test('U1360: snapToCell — endpoints in padding, gutters, pipes or another column snap onto the cell\'s own fragments', () => {
    const w = displayWholeCellBounds(DOC, REGION, parsed, at('k01'))!;
    const [f1, f2, f3] = w.fragments;
    // Inside a fragment: unchanged.
    expect(snapToCell(w, at('k06'))).toBe(at('k06'));
    // Padding after the second fragment (still on its line): its content end.
    expect(snapToCell(w, f2.contentEnd + 1)).toBe(f2.contentEnd);
    // The trailing pipe / newline of the second line: its content end.
    expect(snapToCell(w, f2.lineEnd)).toBe(f2.contentEnd);
    // The Name column's padding on the second line (before the fragment): its content start.
    expect(snapToCell(w, f2.lineStart + 3)).toBe(f2.contentStart);
    // The gutter between the columns on the third line: that fragment's start.
    expect(snapToCell(w, f3.contentStart - 1)).toBe(f3.contentStart);
    // Before the first fragment / past the last one: the whole-cell edges.
    expect(snapToCell(w, f1.lineStart)).toBe(w.contentStart);
    expect(snapToCell(w, f3.lineEnd + 40)).toBe(w.contentEnd);
    expect(snapToCell(w, 0)).toBe(w.contentStart);
    // An empty cell snaps to its one position.
    const empty = displayWholeCellBounds(DOC, REGION, parsed, at('solo') - 8)!;
    expect(snapToCell(empty, 0)).toBe(empty.contentStart);
    expect(snapToCell(empty, DOC.length)).toBe(empty.contentStart);
  });

  test('U1361: cellSelectionText joins the selected fragment parts — spaces across wraps, nothing across hard breaks, no marker/pipes/padding', () => {
    const w = displayWholeCellBounds(DOC, REGION, parsed, at('k01'))!;
    const sel = (from: number, to: number) => cellSelectionText(DOC, REGION, parsed, from, to);
    // The full cell.
    expect(sel(w.contentStart, w.contentEnd)).toBe('k01 k02 k03 k04 k05 k06 k07 k08 k09');
    // A partial range within one fragment.
    expect(sel(at('k02'), at('k03') + 3)).toBe('k02 k03');
    // A range spanning the wrap join.
    expect(sel(at('k04'), at('k05') + 3)).toBe('k04 k05');
    expect(sel(at('k03'), at('k06') + 2)).toBe('k03 k04 k05 k0');
    // A hard-break join: no space, the marker dropped.
    const hb = displayWholeCellBounds(DOC, REGION, parsed, at('abcdefghijklmn'))!;
    expect(sel(hb.contentStart, hb.contentEnd)).toBe('abcdefghijklmnopqrstuv');
    expect(sel(at('klmn'), at('opqr') + 4)).toBe('klmnopqr');
    // An unwrapped cell: its text.
    expect(sel(at('solo'), at('solo') + 4)).toBe('solo');
    // Two cells, or a separator line: null (the caller keeps the raw slice).
    expect(sel(at('| a ') + 2, at('k02'))).toBeNull();
    expect(sel(at('| ----') + 3, at('| ----') + 6)).toBeNull();
    expect(sel(at('k01'), at('| ----', 1) + 3)).toBeNull();
  });
});
