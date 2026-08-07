import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  deleteRetention,
  entryDeletePrompt,
  workspaceDeleteWarning,
  type DeleteRetention,
} from '../../src/lib/deleteRetention';

// PRD 010 Req 21: the delete-copy decision, which had to become a function
// because a hosted delete is now permanent on one backend and history-retained
// on the other. The blob-backed and desktop strings are asserted BYTE-FOR-BYTE
// against what shipped, so a future edit to the git-backed sentence cannot
// drift them (the folder-tree e2e suite pins the same trash strings from the
// other side).

const moduleSource = readFileSync(
  fileURLToPath(new URL('../../src/lib/deleteRetention.ts', import.meta.url)),
  'utf8',
);

const target = (over: Partial<{ name: string; isDir: boolean; dirty: boolean }> = {}) => ({
  name: 'notes.md',
  isDir: false,
  dirty: false,
  ...over,
});

describe('delete retention: which promise a delete may make (PRD 010 Req 21)', () => {
  test('U475: the three cases — an OS trash wins outright, and history only softens the permanent one', () => {
    // Desktop / web: `permanentDelete` absent or false is the Trash, and the
    // workspace's backend has no say in it.
    expect(deleteRetention({})).toBe('trash');
    expect(deleteRetention({ permanentDelete: false })).toBe('trash');
    expect(deleteRetention({ permanentDelete: false, retainsHistory: true })).toBe('trash');

    // Hosted, blob-backed: exactly today's promise.
    expect(deleteRetention({ permanentDelete: true })).toBe('permanent');
    expect(deleteRetention({ permanentDelete: true, retainsHistory: false })).toBe('permanent');

    // Hosted, git-backed (deployment default `github`, or a BYO repo).
    expect(deleteRetention({ permanentDelete: true, retainsHistory: true })).toBe('history');

    // The decision is pure: no DOM, no react, no platform import — the module
    // is importable by the server-side unit env as well as the components.
    expect(moduleSource).not.toMatch(/from 'react'|\bdocument\.|\bwindow\.|@tauri-apps/);
  });

  test('U476: the sidebar prompt — trash and permanent are byte-identical to what shipped, history is the new third', () => {
    // The two strings tests/e2e/folder-tree.spec.ts asserts (E-numbered), and
    // the `and its contents` / unsaved suffixes in the order the prompt built
    // them before this was a function.
    expect(entryDeletePrompt('trash', target({ name: 'zzz.txt' }))).toEqual({
      title: 'Move to Trash',
      body: 'Move “zzz.txt” to the Trash?',
    });
    expect(entryDeletePrompt('trash', target({ name: 'sub', isDir: true })).body).toBe(
      'Move “sub” and its contents to the Trash?',
    );
    expect(entryDeletePrompt('trash', target({ name: 'b.md', dirty: true })).body).toBe(
      'Move “b.md” to the Trash? It has unsaved changes.',
    );

    expect(entryDeletePrompt('permanent', target())).toEqual({
      title: 'Delete',
      body: 'Permanently delete “notes.md”? This cannot be undone.',
    });
    expect(entryDeletePrompt('permanent', target({ name: 'sub', isDir: true, dirty: true })).body).toBe(
      'Permanently delete “sub” and its contents? This cannot be undone. It has unsaved changes.',
    );

    // The correction: no promise of unrecoverable deletion, and no promise of
    // in-app recovery either (PRD 010 non-goals — no undelete, no version
    // browsing), so it says what the repository does and not what the app offers.
    const history = entryDeletePrompt('history', target());
    expect(history).toEqual({
      title: 'Delete',
      body: 'Delete “notes.md”? It is removed from the app; the repository’s history retains it.',
    });
    expect(history.body).not.toContain('cannot be undone');
    expect(entryDeletePrompt('history', target({ name: 'sub', isDir: true, dirty: true })).body).toBe(
      'Delete “sub” and its contents? It is removed from the app; the repository’s history retains it.' +
        ' It has unsaved changes.',
    );
  });

  test('U477: the Danger Zone warning, and PRD 010 Req 3 — nothing in any string names a backend', () => {
    expect(workspaceDeleteWarning('permanent', 'Team notes')).toBe(
      'Deleting “Team notes” permanently removes its documents, comments and images for everyone. This cannot be undone.',
    );
    expect(workspaceDeleteWarning('history', 'Team notes')).toBe(
      'Deleting “Team notes” removes its documents, comments and images from the app for everyone. ' +
        'The repository’s history retains them.',
    );
    expect(workspaceDeleteWarning('history', 'Team notes')).not.toContain('cannot be undone');

    // Req 3: which backend a default-storage workspace uses stays invisible.
    // No repo, owner, branch, host or the word GitHub appears in ANY string
    // this module produces — "the repository's history" is as far as it goes.
    const everyString = (['trash', 'permanent', 'history'] as DeleteRetention[]).flatMap((retention) => [
      entryDeletePrompt(retention, target({ isDir: true, dirty: true })).title,
      entryDeletePrompt(retention, target({ isDir: true, dirty: true })).body,
      workspaceDeleteWarning(retention, 'Team notes'),
    ]);
    for (const text of everyString) {
      expect(text, text).not.toMatch(/github|git\b|branch|commit|owner\/|repo\b/i);
    }
    // …nor does the module hold a host string of its own.
    expect(moduleSource).not.toMatch(/https?:\/\//);
  });
});
