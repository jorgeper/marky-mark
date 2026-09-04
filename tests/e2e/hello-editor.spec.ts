import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// PRD 021 Req 16 (issue #240): the independence check — the hello-editor
// sample (editor/samples/hello-editor/index.html) opened as a plain
// file:// page against the built standalone bundle, with no Marky Mark app
// code involved: no dev server, no src/ modules, no fixtures/helpers from
// this suite — just @playwright/test and the file on disk. That is why this
// file deliberately imports nothing from ./helpers or ./fixtures.

const repoRoot = path.resolve(import.meta.dirname, '../..');
const sampleUrl = pathToFileURL(path.join(repoRoot, 'editor/samples/hello-editor/index.html')).href;

test.beforeAll(() => {
  // Req 16: the check must pass from a clean checkout — build the standalone
  // bundle here rather than trusting whatever dist/standalone holds. ~25s.
  test.setTimeout(300_000);
  execFileSync('npm', ['run', 'build:standalone', '-w', 'editor'], { cwd: repoRoot, stdio: 'pipe' });
});

test('E415: hello-editor mounts from the standalone bundle over file:// and accepts typed input', async ({ page }) => {
  // Req 15: "open the file, it works" — everything the page touches must
  // come off the disk. Any http(s) request would mean a network dependency.
  const networkRequests: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('file://')) networkRequests.push(req.url());
  });

  await page.goto(sampleUrl);

  // The mount API put a live CodeMirror surface in the page…
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Hello, editor');
  // …and the preview pane rendered the starter markdown beside it.
  await expect(page.locator('.doc h1')).toHaveText('Hello, editor');

  // The editor accepts typed input, and the (debounced) preview follows.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Typed by E415.');
  await expect(editor).toContainText('Typed by E415.');
  await expect(page.locator('.doc')).toContainText('Typed by E415.');

  expect(networkRequests).toEqual([]);
});
