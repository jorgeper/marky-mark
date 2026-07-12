/**
 * SPEC30 §3: crash-safe drafts (draft.json in the config dir). While a
 * buffer is dirty, a debounced shadow copy lands here; a clean save or an
 * explicit discard deletes it. On boot, a non-stale draft offers a restore.
 * Pure: parse/serialize/staleness only — I/O and debounce live in the app.
 */

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
 * drafts are stale only when empty.
 */
export function isStaleDraft(draft: Draft, diskContent: string | null): boolean {
  if (draft.docPath === null) return draft.content === '';
  return diskContent !== null && diskContent === draft.content;
}
