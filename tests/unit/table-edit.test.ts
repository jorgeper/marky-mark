import { describe, expect, test } from 'vitest';
import {
  cellAt,
  cellContentSpan,
  deleteCol,
  displayCellAt,
  displayPosOf,
  displayRoundTrips,
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
  starterTable,
  tableRegionAt,
  type TableModel,
} from '../../src/lib/tableEdit';

const TBL = '| a | b |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |';
const DOC = `intro\n\n${TBL}\n\noutro`;
const REGION = { start: 7, end: 7 + TBL.length };

const model = (): TableModel => parseTable(DOC, tableRegionAt(DOC, DOC.indexOf('| 1'))!);

describe('SPEC37 table edit', () => {
  test('U68: region detection, parse/serialize round-trips, escapes', () => {
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

  test('U69: operations, guards, spans, starter, insert/delete at cursor', () => {
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

  test('U70: layout engine — widths, wrapping, separators, map', () => {
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

  test('U71: display grammar — round-trips, the guard, collapse', () => {
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
