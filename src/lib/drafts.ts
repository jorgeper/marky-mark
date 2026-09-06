/**
 * SPEC30 §3: crash-safe drafts (draft.json in the config dir). While a
 * buffer is dirty, a debounced shadow copy lands here; a clean save or an
 * explicit discard deletes it. On boot, a non-stale draft offers a restore.
 * Pure: parse/serialize/staleness only — I/O and debounce live in the app.
 */
import { isDirtyText } from './dirty.ts';
import { splitEmbedded } from './embedded.ts';

export interface Draft {
  version: 1;
  /** null ⇒ an untitled buffer. */
  docPath: string | null;
  content: string;
  at: string; // ISO-8601
}

export function parseDraft(json: string): Draft | null {
  try {
    const d = JSON.parse(json) as Partial<Draft>;
    if (d.version !== 1) return null;
    if (d.docPath !== null && typeof d.docPath !== 'string') return null;
    if (typeof d.content !== 'string' || typeof d.at !== 'string') return null;
    return { version: 1, docPath: d.docPath, content: d.content, at: d.at };
  } catch {
    return null;
  }
}

export function serializeDraft(draft: Draft): string {
  return `${JSON.stringify(draft, null, 2)}\n`;
}

/**
 * A draft is stale when the disk already holds its content (nothing to
 * restore — the save landed, or the user reproduced the state). Untitled
 * drafts are stale only when empty. Issue #42: "holds its content" rides
 * the shared dirty predicate, so a disk copy differing only in line-ending
 * representation (drafts are written LF-canonical) still reads as stale.
 */
export function isStaleDraft(draft: Draft, diskContent: string | null): boolean {
  if (draft.docPath === null) return draft.content === '';
  if (diskContent === null) return false;
  // SPEC30 §3.3 (issue #319): the draft holds the BODY — what the buffer
  // held, i.e. the file after splitEmbedded (SPEC2 §5) — while the disk holds
  // body + comment trailer. Compare like with like, or a leftover draft for
  // any commented document could never read as stale and would be re-offered
  // on every launch until the user clicked Discard. A draft that somehow
  // carries a trailer of its own is stripped the same way.
  return !isDirtyText(splitEmbedded(diskContent).content, splitEmbedded(draft.content).content);
}
