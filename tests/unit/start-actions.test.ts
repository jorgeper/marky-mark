import { describe, expect, test } from 'vitest';
import {
  DEFAULT_START_ACTIONS,
  START_ACTION_LABELS,
  startActions,
  startCapabilities,
  type StartPlatformCaps,
} from '../../src/lib/startActions';

/**
 * PRD 007 Req 21/22: the entry surface's capability→action mapping — the one
 * decision behind both the start page and the File menu. The four flavors are
 * modelled here exactly as their Platform implementations declare themselves,
 * so a regression in any of them (most of all the hosted trap: it DOES define
 * openFolderDialog, and must still offer no Open Folder) fails in vitest.
 */

// The optional members each real platform defines (src/platform/*.ts).
const noop = () => {};
const TAURI: StartPlatformCaps = {
  localFolders: true,
  openFolderDialog: noop,
  openWorkspaceDialog: noop,
  saveFileDialog: noop,
  readDirEntries: noop,
};
const SHIM: StartPlatformCaps = { ...TAURI };
const WEB: StartPlatformCaps = { saveFileDialog: noop }; // no folder/workspace seam at all
const HOSTED: StartPlatformCaps = {
  // The trap: both dialogs exist — they answer the bound workspace, not a
  // local pick — and localFolders is deliberately absent.
  openFolderDialog: noop,
  openWorkspaceDialog: noop,
  readDirEntries: noop,
  // Issue #275: the hosted lifecycle is the only one that defines the
  // scratchpad seam (src/platform/hostedWorkspaces.ts).
  workspaces: { openScratchpad: noop },
};
/** A managed-workspace flavor WITHOUT the scratchpad seam — the pre-#275 hosted shape. */
const MANAGED_NO_SCRATCH: StartPlatformCaps = { ...HOSTED, workspaces: {} };

describe('PRD 007 Req 21/22: the entry action list', () => {
  test('U311: desktop and the e2e shim offer all four actions, Open File first', () => {
    expect(startActions(startCapabilities(TAURI))).toEqual([
      'openFile',
      'openFolder',
      'newWorkspace',
      'openWorkspace',
    ]);
    expect(startActions(startCapabilities(SHIM))).toEqual(startActions(startCapabilities(TAURI)));
  });

  test('U312: hosted offers Open File + both workspace flows and NEVER Open Folder, though it defines openFolderDialog', () => {
    const caps = startCapabilities(HOSTED);
    expect(caps.localFolders).toBe(false);
    expect(caps.managedWorkspaces).toBe(true);
    const actions = startActions(caps);
    expect(actions).toEqual(['openFile', 'newWorkspace', 'openWorkspace', 'openScratchpad']);
    expect(actions).not.toContain('openFolder');
  });

  test('U313: the single-file web build offers Open File alone — no folder seam, no workspaces', () => {
    expect(startActions(startCapabilities(WEB))).toEqual(['openFile']);
  });

  test('U314: a platform that declares localFolders but has no sidebar seam still offers nothing local', () => {
    // readDirEntries is what PRD 002 §D14's flows are built on; without it the
    // flag alone must not conjure rows the app cannot honour.
    const caps = startCapabilities({ localFolders: true, openFolderDialog: noop, saveFileDialog: noop });
    expect(caps).toEqual({
      localFolders: false,
      localWorkspaceOpen: false,
      localWorkspaceSave: false,
      managedWorkspaces: false,
      // Issue #275: no workspace seam at all ⇒ no scratchpad either.
      scratchpad: false,
    });
    expect(startActions(caps)).toEqual(['openFile']);
  });

  test('U315: New and Open Workspace are independent — a flavor that can pick one but not save one shows only Open', () => {
    expect(startActions(startCapabilities({ ...TAURI, saveFileDialog: undefined }))).toEqual([
      'openFile',
      'openFolder',
      'openWorkspace',
    ]);
    expect(startActions(startCapabilities({ ...TAURI, openWorkspaceDialog: undefined }))).toEqual([
      'openFile',
      'openFolder',
      'newWorkspace',
    ]);
  });

  test('U1206: Open Scratchpad is the hosted seam’s own capability — right after Open Workspace, and nowhere else', () => {
    // Issue #275 (PRD 019): a capability test, never a flavor sniff. Only the
    // hosted lifecycle defines `openScratchpad`, so only the hosted set
    // carries the action — and it lands immediately after `openWorkspace`,
    // which is where the start page's button and the menus' row follow from.
    const hosted = startActions(startCapabilities(HOSTED));
    expect(startCapabilities(HOSTED).scratchpad).toBe(true);
    expect(hosted.indexOf('openScratchpad')).toBe(hosted.indexOf('openWorkspace') + 1);
    // The desktop, the shim and the single-file web build do not carry it at
    // all — nor does a managed-workspace flavor whose lifecycle omits the
    // member (the pre-#275 hosted shape), which is the proof the derivation
    // reads the seam rather than `workspaces` being present.
    for (const caps of [TAURI, SHIM, WEB, MANAGED_NO_SCRATCH]) {
      expect(startCapabilities(caps).scratchpad).toBe(false);
      expect(startActions(startCapabilities(caps))).not.toContain('openScratchpad');
    }
    // It asks no question, so its label carries no ellipsis (#275).
    expect(START_ACTION_LABELS.openScratchpad).toBe('Open Scratchpad');
  });

  test('U316: every action has a label, and the legacy default is the pre-#78 desktop set', () => {
    for (const id of startActions(startCapabilities(TAURI))) expect(START_ACTION_LABELS[id]).toBeTruthy();
    expect(DEFAULT_START_ACTIONS).toEqual(['openFile', 'openFolder', 'openWorkspace']);
  });
});
