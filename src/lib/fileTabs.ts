/**
 * PRD 013 Req 7: the file tab strip's pure rules — the tab context menu's
 * item model (the single source of menu truth, in folderOps'
 * folderContextMenu mold) and the Close Others target order. No DOM, no
 * platform imports; the component renders the model, App runs the verbs.
 */

export type FileTabMenuItem = { id: 'close' | 'close-others' | 'close-all'; label: string };

/** PRD 013 Req 7: exactly three items, in this fixed order. */
export function fileTabContextMenu(): FileTabMenuItem[] {
  return [
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close Others' },
    { id: 'close-all', label: 'Close All' },
  ];
}

/**
 * PRD 013 Req 7: Close Others' close sequence — every open-set file except
 * the kept one, in the list's own order (the strip's tree order, SPEC36 §1).
 */
export function closeOthersTargets(openFiles: string[], keep: string): string[] {
  return openFiles.filter((f) => f !== keep);
}
