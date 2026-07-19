import { describe, expect, test } from 'vitest';
import {
  addOpen,
  closeOpen,
  cycleOpen,
  OPEN_CAP,
  pruneOpen,
  remapOpen,
  treeOrderCompare,
} from '../../src/lib/openFiles';
import { parseFolderState, serializeFolderState, type FolderState } from '../../src/lib/folderTree';
import { comboFromEvent, displayCombo, eventMatches, parseCombo } from '../../src/lib/hotkeys';

const ev = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
  key: 'Tab',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('SPEC36 open files', () => {
  test('U64: tree order, set ops, remap/prune, FolderState fields, strict-Ctrl hotkeys', () => {
    // --- treeOrderCompare: siblings sort case-insensitively -------------------
    expect(treeOrderCompare('/n/apple.md', '/n/Zeta.md')).toBeLessThan(0);
    expect(treeOrderCompare('/n/Zeta.md', '/n/apple.md')).toBeGreaterThan(0);
    expect(treeOrderCompare('/n/a.md', '/n/a.md')).toBe(0);
    // Folders first at the divergence: sub/b.md (dir component "sub") beats
    // the sibling FILE z.md even though s < z is false... and beats a.md too.
    expect(treeOrderCompare('/n/sub/b.md', '/n/z.md')).toBeLessThan(0);
    expect(treeOrderCompare('/n/sub/b.md', '/n/a.md')).toBeLessThan(0);
    expect(treeOrderCompare('/n/a.md', '/n/sub/b.md')).toBeGreaterThan(0);
    // Deeper nesting still resolves at the first differing component.
    expect(treeOrderCompare('/n/sub/deep/c.md', '/n/sub/x.md')).toBeLessThan(0);
    expect(treeOrderCompare('/n/alpha/x.md', '/n/beta/a.md')).toBeLessThan(0);
    // Windows separators are equivalent.
    expect(treeOrderCompare('C:\\n\\sub\\b.md', 'C:\\n\\a.md')).toBeLessThan(0);
    // The full visible-tree order of the E2E fixture tree:
    expect(
      ['/notes/a.md', '/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/zzz.txt'].sort(treeOrderCompare)
    ).toEqual(['/notes/sub/deep/c.md', '/notes/sub/b.md', '/notes/a.md', '/notes/zzz.txt']);

    // --- addOpen: tree-ordered insert, dedupe --------------------------------
    let list = addOpen([], '/n/z.md');
    list = addOpen(list, '/n/sub/b.md');
    list = addOpen(list, '/n/a.md');
    expect(list).toEqual(['/n/sub/b.md', '/n/a.md', '/n/z.md']);
    expect(addOpen(list, '/n/a.md')).toBe(list); // present ⇒ same list

    // --- closeOpen: neighbor after, else before, else null -------------------
    expect(closeOpen(list, '/n/a.md')).toEqual({ list: ['/n/sub/b.md', '/n/z.md'], nextActive: '/n/z.md' });
    expect(closeOpen(list, '/n/sub/b.md')).toEqual({ list: ['/n/a.md', '/n/z.md'], nextActive: '/n/a.md' });
    expect(closeOpen(list, '/n/z.md')).toEqual({ list: ['/n/sub/b.md', '/n/a.md'], nextActive: '/n/a.md' });
    expect(closeOpen(['/n/a.md'], '/n/a.md')).toEqual({ list: [], nextActive: null });
    expect(closeOpen(list, '/n/absent.md')).toEqual({ list, nextActive: null });

    // --- cycleOpen: wrap both ways; absent active ⇒ first; <2 ⇒ null ---------
    expect(cycleOpen(list, '/n/a.md', 1)).toBe('/n/z.md');
    expect(cycleOpen(list, '/n/z.md', 1)).toBe('/n/sub/b.md'); // wraps forward
    expect(cycleOpen(list, '/n/sub/b.md', -1)).toBe('/n/z.md'); // wraps back
    expect(cycleOpen(list, '/n/a.md', -1)).toBe('/n/sub/b.md');
    expect(cycleOpen(list, null, 1)).toBe('/n/sub/b.md');
    expect(cycleOpen(list, '/gone.md', -1)).toBe('/n/sub/b.md');
    expect(cycleOpen(['/n/a.md'], '/n/a.md', 1)).toBeNull();
    expect(cycleOpen([], null, 1)).toBeNull();

    // --- remapOpen: rename remaps exact + descendants and re-sorts -----------
    expect(remapOpen(['/n/sub/b.md', '/n/a.md'], '/n/sub', '/n/zub')).toEqual(['/n/zub/b.md', '/n/a.md']);
    // A rename that moves the file across the order re-sorts the list.
    expect(remapOpen(['/n/sub/b.md', '/n/a.md'], '/n/sub/b.md', '/n/x.md')).toEqual(['/n/a.md', '/n/x.md']);
    // Prefix boundaries are separator-aware: /a/bc is NOT under /a/b.
    expect(remapOpen(['/a/bc'], '/a/b', '/a/x')).toEqual(['/a/bc']);

    // --- pruneOpen: exact and directory-prefix drops -------------------------
    expect(pruneOpen(['/n/sub/b.md', '/n/sub/deep/c.md', '/n/a.md'], '/n/sub')).toEqual(['/n/a.md']);
    expect(pruneOpen(['/n/a.md', '/n/ab.md'], '/n/a.md')).toEqual(['/n/ab.md']);
    expect(pruneOpen(['/a/bc'], '/a/b')).toEqual(['/a/bc']);

    // --- FolderState: the three new OPTIONAL fields --------------------------
    const full: FolderState = {
      version: 1,
      root: '/n',
      expanded: ['/n'],
      showNonMd: false,
      openFiles: ['/n/sub/b.md', '/n/a.md'],
      activeFile: '/n/a.md',
      openOnly: true,
    };
    expect(parseFolderState(serializeFolderState(full))).toEqual(full);
    // Legacy files parse WITHOUT the new keys (byte-stable round-trips for
    // pre-SPEC36 states — U60/U62 pin that shape).
    const legacy = parseFolderState('{"root":"/n","expanded":[]}');
    expect('openFiles' in legacy).toBe(false);
    expect('activeFile' in legacy).toBe(false);
    expect('openOnly' in legacy).toBe(false);
    expect(legacy.openFiles ?? []).toEqual([]); // consumers default with ??
    // activeFile outside the set is forced null; junk entries are dropped.
    const forced = parseFolderState('{"root":"/n","expanded":[],"openFiles":["/n/a.md",7,""],"activeFile":"/n/x.md"}');
    expect(forced.openFiles).toEqual(['/n/a.md']);
    expect(forced.activeFile).toBeNull();
    expect(parseFolderState('{"expanded":[],"openOnly":"yes"}').openOnly).toBe(false);
    expect(parseFolderState('{"expanded":[],"openOnly":true}').openOnly).toBe(true);
    // OPEN_CAP holds at persistence in both directions.
    const over: FolderState = {
      version: 1,
      root: '/r',
      expanded: [],
      showNonMd: false,
      openFiles: Array.from({ length: OPEN_CAP + 20 }, (_, i) => `/r/f${i}.md`),
      activeFile: null,
      openOnly: false,
    };
    expect(parseFolderState(serializeFolderState(over)).openFiles).toHaveLength(OPEN_CAP);

    // --- hotkeys: the strict-Ctrl token (SPEC36 §6.1) ------------------------
    const ct = parseCombo('Ctrl+Tab')!;
    expect(ct.ctrl).toBe(true);
    expect(ct.mod).toBe(false);
    expect(parseCombo('control+T')!.ctrl).toBe(true);
    expect(parseCombo('Mod+S')!.ctrl).toBe(false);
    // Ctrl+Tab matches ctrlKey — and never ⌘ alone; ⌘+Ctrl+Tab is refused too.
    expect(eventMatches(ev({ ctrlKey: true }), 'Ctrl+Tab')).toBe(true);
    expect(eventMatches(ev({ metaKey: true }), 'Ctrl+Tab')).toBe(false);
    expect(eventMatches(ev({ metaKey: true, ctrlKey: true }), 'Ctrl+Tab')).toBe(false);
    expect(eventMatches(ev({ ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Tab')).toBe(true);
    expect(eventMatches(ev({ ctrlKey: true, shiftKey: true }), 'Ctrl+Tab')).toBe(false);
    // Mod combos still match EITHER modifier (cross-platform discipline).
    expect(eventMatches({ key: 's', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, 'Mod+S')).toBe(true);
    expect(eventMatches({ key: 's', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, 'Mod+S')).toBe(true);
    // Display: ⌃ on mac, Ctrl+ elsewhere; Mod stays ⌘/Ctrl.
    expect(displayCombo('Ctrl+Tab', true)).toBe('⌃Tab');
    expect(displayCombo('Ctrl+Shift+Tab', true)).toBe('⌃⇧Tab');
    expect(displayCombo('Ctrl+Tab', false)).toBe('Ctrl+Tab');
    expect(displayCombo('Mod+Shift+O', true)).toBe('⌘⇧O');
    // Recording is untouched: a physical Ctrl press still serializes as Mod.
    expect(comboFromEvent({ key: 'Tab', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe('Mod+Tab');
  });
});
