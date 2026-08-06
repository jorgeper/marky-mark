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
  workspaces: {},
};

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
    expect(actions).toEqual(['openFile', 'newWorkspace', 'openWorkspace']);
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

  test('U316: every action has a label, and the legacy default is the pre-#78 desktop set', () => {
    for (const id of startActions(startCapabilities(TAURI))) expect(START_ACTION_LABELS[id]).toBeTruthy();
    expect(DEFAULT_START_ACTIONS).toEqual(['openFile', 'openFolder', 'openWorkspace']);
  });
});
