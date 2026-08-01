import { describe, expect, test } from 'vitest';
import { deriveAppMode } from '../../src/lib/appMode';

describe('issue #22: the derived three-mode model', () => {
  test('U121: splash / file / workspace derive from docOpen + workspace kind', () => {
    // Splash: nothing open, no workspace.
    expect(deriveAppMode(false, 'none')).toBe('splash');
    // File: a document (or untitled buffer) open, no workspace.
    expect(deriveAppMode(true, 'none')).toBe('file');
    // Workspace: any open workspace wins, with or without a document.
    expect(deriveAppMode(false, 'untitled')).toBe('workspace');
    expect(deriveAppMode(true, 'untitled')).toBe('workspace');
    expect(deriveAppMode(false, 'named')).toBe('workspace');
    expect(deriveAppMode(true, 'named')).toBe('workspace');
  });
});
