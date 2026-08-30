import type { Workspace } from './workspace.ts';

/**
 * Issue #22: the explicit three-mode model. The mode is DERIVED, never
 * stored — one pure function over state the app already tracks, consumed by
 * the menu gating (menuSpec) and the mode-scoped chrome (FolderPanel).
 *
 * - `splash`: nothing open — the initial screen.
 * - `file`: a document (file or untitled buffer) open, no workspace.
 * - `workspace`: a workspace open (folders exist; a document may or may not).
 */
export type AppMode = 'splash' | 'file' | 'workspace';

export function deriveAppMode(docOpen: boolean, workspaceKind: Workspace['kind']): AppMode {
  if (workspaceKind !== 'none') return 'workspace';
  return docOpen ? 'file' : 'splash';
}
