/**
 * PRD 010 Req 21: what a delete promises, decided in one place.
 *
 * Three cases, and the app has always had two of them: a desktop delete goes
 * to the OS Trash, a hosted blob-backed delete is gone for good. The github
 * backend adds a third — the bytes leave the app, and the commit that removed
 * them is itself history the repository keeps — so copy that promised
 * unrecoverable deletion would now be a lie.
 *
 * No I/O, no DOM, no `react`: `src/App.tsx`'s sidebar prompt and
 * `src/components/WorkspaceDangerZone.tsx` render what these functions
 * return, exactly as `WorkspaceConnectionSettings.tsx` is a shell over
 * `workspaceConnection.ts`.
 *
 * PRD 010 Req 3 is the constraint on the wording: a default-storage
 * workspace never reveals WHICH backend it is on, so the git-backed sentence
 * states the retention fact and names no repo, owner, branch — and not
 * GitHub. "The repository's history" is as specific as it may get.
 */

/**
 * How a delete on this workspace behaves.
 *
 * - `trash`: the OS Trash is behind it (desktop, and the web shim).
 * - `permanent`: nothing is behind it — no trash, no version history.
 * - `history`: the content leaves the app; the backing repository's history
 *   retains it. NOT a promise of in-app recovery: there is no undelete and no
 *   version browsing (PRD 010 non-goals), which is why the copy says what the
 *   repository does and never what the app offers.
 */
export type DeleteRetention = 'trash' | 'permanent' | 'history';

/** What the caller knows: the platform's delete semantics, and the workspace's. */
export interface RetentionInputs {
  /** `Platform.permanentDelete` — absent/false means an OS Trash is behind it. */
  permanentDelete?: boolean;
  /**
   * PRD 010 Req 21: the workspace row's own answer, server-supplied. Absent
   * on a platform with no workspace listing, and on a row whose backend could
   * not be reached — both fall back to the stricter promise.
   */
  retainsHistory?: boolean;
}

/**
 * PRD 010 Req 21: the decision. `permanentDelete` still leads — a delete that
 * goes to the Trash is a delete that goes to the Trash whatever backs the
 * workspace — and the retention fact only ever softens the harsher of the two
 * remaining cases.
 */
export function deleteRetention({ permanentDelete, retainsHistory }: RetentionInputs): DeleteRetention {
  if (!permanentDelete) return 'trash';
  return retainsHistory ? 'history' : 'permanent';
}

/** The sidebar prompt's target: what is being deleted, and whether it is dirty. */
export interface EntryDeleteTarget {
  /** The entry's display name (a basename, never a path). */
  name: string;
  /** A directory takes its contents with it. */
  isDir: boolean;
  /** The open document has unsaved changes and is inside the target. */
  dirty: boolean;
}

/** The two strings the sidebar's delete confirmation shows. */
export interface EntryDeletePrompt {
  title: string;
  body: string;
}

/**
 * SPEC35 §6 + PRD 010 Req 21: the sidebar file/folder delete confirmation.
 * The `trash` and `permanent` strings are byte-for-byte what this prompt has
 * always shown (E-numbered folder-tree tests pin them); `history` is the new
 * third case.
 */
export function entryDeletePrompt(
  retention: DeleteRetention,
  { name, isDir, dirty }: EntryDeleteTarget,
): EntryDeletePrompt {
  const contents = isDir ? ' and its contents' : '';
  const unsaved = dirty ? ' It has unsaved changes.' : '';
  if (retention === 'trash') {
    return { title: 'Move to Trash', body: `Move “${name}”${contents} to the Trash?${unsaved}` };
  }
  if (retention === 'history') {
    return {
      title: 'Delete',
      body: `Delete “${name}”${contents}? It is removed from the app; the repository’s history retains it.${unsaved}`,
    };
  }
  return { title: 'Delete', body: `Permanently delete “${name}”${contents}? This cannot be undone.${unsaved}` };
}

/**
 * PRD 007 Req 12 + PRD 010 Req 21: the Danger Zone's warning above the
 * type-the-name confirmation. The `permanent` string is byte-for-byte today's.
 *
 * `trash` never reaches here in practice — the Danger Zone only mounts on a
 * platform offering the workspace lifecycle, and every one of those deletes
 * server-side — but the function is total rather than throwing on it.
 */
export function workspaceDeleteWarning(retention: DeleteRetention, name: string): string {
  if (retention === 'history') {
    return (
      `Deleting “${name}” removes its documents, comments and images from the app for everyone. ` +
      'The repository’s history retains them.'
    );
  }
  return `Deleting “${name}” permanently removes its documents, comments and images for everyone. This cannot be undone.`;
}
