/**
 * PRD 007 Req 21/22: the app's entry surface, as data. One ordered list of
 * actions — derived from what the platform CAN do, never from which flavor is
 * running (Req 2) — feeds both the start page (components/StartPage.tsx) and
 * the File menu (lib/menuSpec.ts), so the two can never drift apart and the
 * four flavors present the same surface wherever they can honour it.
 *
 * Pure: no DOM, no platform import, every branch unit-testable.
 */

/** An entry-surface action. The drag-a-file drop target is not one — it is
 *  always present on the start page and has no menu equivalent. */
export type StartActionId = 'openFile' | 'openFolder' | 'newWorkspace' | 'openWorkspace';

/** What the platform declares about the four actions' prerequisites. */
export interface StartCapabilities {
  /**
   * The platform can pick a REAL local folder the user chose — the trap this
   * flag exists for: the hosted flavor defines `openFolderDialog` (it answers
   * the bound workspace's blob root so the sidebar renders), which is not a
   * local folder pick, so having the method is never the derivation.
   */
  localFolders: boolean;
  /** A local `.marky-workspace` file can be picked (PRD 002 §D14). */
  localWorkspaceOpen: boolean;
  /** A local `.marky-workspace` file can be created (`saveFileDialog`). */
  localWorkspaceSave: boolean;
  /** The platform owns workspaces itself — the hosted lifecycle seam. */
  managedWorkspaces: boolean;
}

/** The structural subset of Platform the derivation reads. */
export interface StartPlatformCaps {
  localFolders?: boolean;
  openFolderDialog?: unknown;
  openWorkspaceDialog?: unknown;
  saveFileDialog?: unknown;
  readDirEntries?: unknown;
  workspaces?: unknown;
}

/**
 * Fold a Platform's optional members into the four prerequisites. Every local
 * folder/workspace flow also needs `readDirEntries` — the sidebar seam PRD 002
 * §D14 builds on — so a flavor without it (the single-file web build) offers
 * neither, whatever else it defines.
 */
export function startCapabilities(p: StartPlatformCaps): StartCapabilities {
  const tree = !!p.readDirEntries;
  const local = tree && p.localFolders === true;
  return {
    localFolders: local && !!p.openFolderDialog,
    localWorkspaceOpen: local && !!p.openWorkspaceDialog,
    localWorkspaceSave: local && !!p.saveFileDialog,
    managedWorkspaces: !!p.workspaces,
  };
}

/**
 * The ordered action list. Open File is universal — every flavor can read a
 * file the user hands it. The folder and workspace rows appear only where the
 * flavor can honour them: desktop/shim show all four, the hosted flavor shows
 * everything but Open Folder (its workspaces are managed, its folders are
 * not local), and the single-file web build shows only Open File.
 */
export function startActions(caps: StartCapabilities): StartActionId[] {
  const list: StartActionId[] = ['openFile'];
  if (caps.localFolders) list.push('openFolder');
  if (caps.managedWorkspaces || caps.localWorkspaceSave) list.push('newWorkspace');
  if (caps.managedWorkspaces || caps.localWorkspaceOpen) list.push('openWorkspace');
  return list;
}

/**
 * The label each action carries on the start page. The File menu names the
 * same three gated items identically; only Open File… differs, appearing
 * there under the File submenu's own older name, "Open…".
 */
export const START_ACTION_LABELS: Record<StartActionId, string> = {
  openFile: 'Open File…',
  openFolder: 'Open Folder…',
  newWorkspace: 'New Workspace…',
  openWorkspace: 'Open Workspace…',
};

/** The pre-#78 desktop set — what an absent list reads as (frozen fixtures). */
export const DEFAULT_START_ACTIONS: StartActionId[] = ['openFile', 'openFolder', 'openWorkspace'];
