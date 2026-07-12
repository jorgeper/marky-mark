/**
 * SPEC26 §1.2: display-parse YAML front matter (pure, no YAML dependency —
 * this feeds a read-only metadata card, not a data model). Recognition
 * mirrors remark-frontmatter: the document's FIRST line is exactly `---`,
 * and a closing `---` or `...` fence line exists. Anything else ⇒ null,
 * and the renderer treats the text as ordinary markdown.
 */

export interface FrontMatterEntry {
  /** '' for raw passthrough lines that aren't `key: value`. */
  key: string;
  value: string;
}

export interface FrontMatter {
  entries: FrontMatterEntry[];
  /** The raw text between the fences (no fence lines). */
  raw: string;
  /** 1-based line number of the closing fence. */
  endLine: number;
}

const FENCE_OPEN = /^---[ \t]*$/;
const FENCE_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_VALUE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;
const LIST_ITEM = /^\s+-\s+(.*)$/;

export function parseFrontMatter(text: string): FrontMatter | null {
  const lines = text.split('\n');
  if (lines.length < 2 || !FENCE_OPEN.test(lines[0])) return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE_CLOSE.test(lines[i])) {
      close = i;
      break;
    }
  }
  if (close === -1) return null; // unclosed ⇒ not front matter (renders as-is)

  const body = lines.slice(1, close);
  const entries: FrontMatterEntry[] = [];
  for (const line of body) {
    if (!line.trim()) continue;
    const item = LIST_ITEM.exec(line);
    if (item && entries.length > 0 && entries[entries.length - 1].key) {
      const last = entries[entries.length - 1];
      last.value = last.value ? `${last.value}, ${item[1].trim()}` : item[1].trim();
      continue;
    }
    const kv = KEY_VALUE.exec(line.trim());
    if (kv) {
      entries.push({ key: kv[1], value: kv[2].trim().replace(/^['"]|['"]$/g, '') });
    } else {
      entries.push({ key: '', value: line.trim() }); // raw passthrough row
    }
  }
  return { entries, raw: body.join('\n'), endLine: close + 1 };
}
