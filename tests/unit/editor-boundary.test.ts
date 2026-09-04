import { describe, expect, it } from 'vitest';
import {
  appImportViolation,
  editorImportViolation,
  exportedSpecifiers,
  importSpecifiers,
  lintAppSource,
  lintEditorSource,
} from '../../scripts/editor-boundary.mjs';

// PRD 021 Req 10 (issue #239): each direction of the editor↔app boundary
// check proven with a caught and a clean fixture, so a future change to the
// scan cannot silently stop catching a pattern. Fixtures are minimal source
// strings, not tree reads — the tests/unit/style-lint.test.ts pattern.

describe('PRD 021 Req 10 editor boundary — editor→app direction', () => {
  it('U1095: a relative import escaping the package into src/ fails with its line', () => {
    const source = `import { x } from './local';\nimport { openFile } from '../../../src/platform/api';\n`;
    const found = lintEditorSource(source, 'editor/src/lib');
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
    expect(found[0].message).toContain('../../../src/platform/api');
    expect(found[0].message).toContain('src/platform/api');
  });

  it('U1096: relative escapes into server/ and src-tauri/ fail too', () => {
    expect(lintEditorSource(`import { app } from '../../server/app';\n`, 'editor/src')).toHaveLength(1);
    expect(lintEditorSource(`import '../../src-tauri/anything';\n`, 'editor/src')).toHaveLength(1);
  });

  it('U1097: bare and alias-style specifiers resolving into the app fail', () => {
    // The root package name resolves into app code via the workspace self-link.
    expect(lintEditorSource(`import { x } from 'marky-mark';\n`, 'editor/src')).toHaveLength(1);
    expect(lintEditorSource(`import { x } from 'marky-mark/src/lib/settings';\n`, 'editor/src')).toHaveLength(1);
    // A baseUrl/alias-style specifier whose first segment is an app root.
    expect(lintEditorSource(`import { x } from 'src/lib/settings';\n`, 'editor/src')).toHaveLength(1);
  });

  it('U1098: in-package relative imports and third-party packages pass', () => {
    const source = [
      "import { EditorView } from '@codemirror/view';",
      "import { renderMarkdown } from '../lib/markdown';", // editor/src/lib — inside the package
      "import { helper } from '../src/lib/markdown';", // from editor/tests: editor/src, not root src
      "export { diffLineSets } from './diffLines';",
      "const lazy = await import('./heavy');",
    ].join('\n');
    expect(lintEditorSource(source, 'editor/tests')).toEqual([]);
    // The scan sees every static form: from-clauses, side-effect imports,
    // dynamic import(), require().
    const specs = importSpecifiers("import './styles.css';\nconst m = require('../../src/x');\n").map((s) => s.spec);
    expect(specs).toEqual(['./styles.css', '../../src/x']);
    expect(editorImportViolation('../../src/x', 'editor/src')).toContain('src/x');
  });
});

describe('PRD 021 Req 10 editor boundary — app→editor direction', () => {
  it('U1099: a deep-path import of @marky-mark/editor internals fails with its line', () => {
    const source = `import { A } from '@marky-mark/editor';\nimport { tableModeField } from '@marky-mark/editor/src/components/tableMode';\n`;
    const found = lintAppSource(source);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
    expect(found[0].message).toContain('@marky-mark/editor/src/components/tableMode');
  });

  it('U1100: the exported entry point and unrelated imports pass', () => {
    const source = [
      "import { SplitView, Editor } from '@marky-mark/editor';",
      "import { useState } from 'react';",
      "import { loadSettings } from './lib/settings';",
    ].join('\n');
    expect(lintAppSource(source)).toEqual([]);
    expect(appImportViolation('@marky-mark/editor')).toBeNull();
  });

  it('U1102: subpaths the exports map names pass (issue #231 — #238 imports the exported styles.css); internals stay sealed', () => {
    const manifest = JSON.stringify({
      exports: { '.': './src/index.ts', './styles.css': './styles.css', './default-theme.css': './default-theme.css' },
    });
    const exported = exportedSpecifiers(manifest);
    expect(exported).toEqual(
      new Set(['@marky-mark/editor/styles.css', '@marky-mark/editor/default-theme.css'])
    );
    expect(appImportViolation('@marky-mark/editor/styles.css', exported)).toBeNull();
    expect(lintAppSource("import '@marky-mark/editor/styles.css';", exported)).toEqual([]);
    // The allowlist is exactly the map: internals and near-misses still fail.
    expect(appImportViolation('@marky-mark/editor/src/index.ts', exported)).toContain('deep-path import');
    expect(appImportViolation('@marky-mark/editor/styles.css/extra', exported)).toContain('deep-path import');
    // An unreadable manifest seals every deep path rather than opening them.
    expect(exportedSpecifiers('not json')).toEqual(new Set());
  });
});
