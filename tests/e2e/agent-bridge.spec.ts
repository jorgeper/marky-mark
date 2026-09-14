import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freshApp, fsRead, fsWrite } from './helpers';
import {
  BRIDGE_PROTOCOL_VERSION,
  decodeBridgeMessage,
  encodeBridgeMessage,
  type BridgeToolRequest,
  type BridgeToolResult,
} from '../../src/lib/agentBridgeProtocol';

// PRD 027 Req 8/12/13 (issue #366): the agent-bridge executor, driven through
// the dev shim's typed message transport — an encoded `ServerToTabMessage`
// posted to the window, the encoded `TabToServerMessage` read back — exactly
// the envelopes the server will send (issue #367). No `__mm*` global.

let seq = 0;

/** Send one tool request through the shim transport and await its result. */
async function bridge(page: Page, request: Omit<BridgeToolRequest, 'id'>): Promise<BridgeToolResult> {
  const id = `e2e-${++seq}`;
  const wire = encodeBridgeMessage({
    v: BRIDGE_PROTOCOL_VERSION,
    kind: 'tool_request',
    request: { id, ...request } as BridgeToolRequest,
  });
  const reply = await page.evaluate(
    ([text, wantId]) =>
      new Promise<string>((resolve) => {
        // The request this posts arrives on the same listener: only the
        // shim's tool_result carrying our id is the reply.
        const onMessage = (e: MessageEvent) => {
          if (typeof e.data !== 'string') return;
          let parsed: { kind?: string; result?: { id?: string } } | null = null;
          try {
            parsed = JSON.parse(e.data) as { kind?: string; result?: { id?: string } };
          } catch {
            return;
          }
          if (parsed?.kind !== 'tool_result' || parsed.result?.id !== wantId) return;
          window.removeEventListener('message', onMessage);
          resolve(e.data);
        };
        window.addEventListener('message', onMessage);
        window.postMessage(text, '*');
      }),
    [wire, id] as const
  );
  const decoded = decodeBridgeMessage(reply);
  if (!decoded.ok || decoded.message.kind !== 'tool_result') throw new Error(`not a tool result: ${reply}`);
  expect(decoded.message.result.id).toBe(id);
  return decoded.message.result;
}

function ok(result: BridgeToolResult): Extract<BridgeToolResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result;
}

/** The canonical buffer as the bridge reports it (innerText doubles blank lines). */
async function docText(page: Page): Promise<string> {
  return ok(await bridge(page, { tool: 'get_editor_state' })).state.content;
}

const DOC = '# Bridge\n\nalpha beta gamma\n\n## Second\n\ndelta\n';

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E653: bridge edits land as one undo unit, dirty the document, never autosave, are refused on a stale revision, and save through the app', async ({
  page,
}) => {
  await fsWrite(page, '/docs/bridge.md', DOC);
  await page.goto('/#open=/docs/bridge.md');
  await expect(page.getByTestId('doc')).toContainText('alpha');
  await page.keyboard.press('Control+e');
  const content = page.getByTestId('editor').locator('.cm-content');
  await expect(content).toBeVisible();
  const text = () => content.evaluate((el) => (el as HTMLElement).innerText);

  // get_editor_state answers a revision and the buffer.
  const first = ok(await bridge(page, { tool: 'get_editor_state' })).state;
  expect(first.path).toBe('/docs/bridge.md');
  expect(first.content).toBe(DOC);
  expect(first.dirty).toBe(false);
  expect(first.revision.length).toBeGreaterThan(0);

  // set_selection over "beta", then replace_selection with the revision just read.
  const from = DOC.indexOf('beta');
  const sel = ok(await bridge(page, { tool: 'set_selection', from, to: from + 4 })).state;
  expect(sel.selection).toEqual({ from, to: from + 4, text: 'beta' });
  expect(sel.revision).toBe(first.revision); // a selection is not a buffer change
  const edited = ok(await bridge(page, { tool: 'replace_selection', revision: first.revision, text: 'BETA' })).state;
  expect(edited.content).toBe(DOC.replace('beta', 'BETA'));
  expect(edited.revision).not.toBe(first.revision);
  expect(edited.dirty).toBe(true);
  expect(edited.cursor.offset).toBe(from + 4); // typing semantics: after the insertion
  await expect(content).toContainText('alpha BETA gamma');
  // The document is dirty through the ordinary edit path...
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  // ...and nothing autosaved: the file on disk is untouched.
  expect(await fsRead(page, '/docs/bridge.md')).toBe(DOC);
  // A following get_editor_state repeats the new revision.
  expect(ok(await bridge(page, { tool: 'get_editor_state' })).state.revision).toBe(edited.revision);

  // ONE undo reverts the whole tool call.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).toContainText('alpha beta gamma');
  expect(await docText(page)).toBe(DOC);
  expect(await fsRead(page, '/docs/bridge.md')).toBe(DOC);

  // A user keystroke after the agent's last read makes the next mutating
  // call stale — and the refusal carries the fresh state, typed character included.
  const read = ok(await bridge(page, { tool: 'get_editor_state' })).state;
  await content.locator('.cm-line').filter({ hasText: /^delta$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(content).toContainText('delta!');
  const stale = await bridge(page, { tool: 'insert_text', revision: read.revision, text: 'NOPE' });
  expect(stale.ok).toBe(false);
  if (stale.ok) throw new Error('unreachable');
  expect(stale.error.code).toBe('stale_revision');
  if (stale.error.code !== 'stale_revision') throw new Error('unreachable');
  expect(stale.error.state.content).toContain('delta!');
  expect(stale.error.state.revision).not.toBe(read.revision);
  expect(await text()).not.toContain('NOPE');

  // With the fresh revision the same call lands, at the caret.
  const landed = ok(await bridge(page, { tool: 'insert_text', revision: stale.error.state.revision, text: ' ok' })).state;
  expect(landed.content).toContain('delta! ok');
  await expect(content).toContainText('delta! ok');
  expect(await fsRead(page, '/docs/bridge.md')).toBe(DOC); // still no autosave

  // save goes through the app's save path: the file lands and the dot clears.
  const saved = ok(await bridge(page, { tool: 'save' })).state;
  expect(saved.dirty).toBe(false);
  expect(await fsRead(page, '/docs/bridge.md')).toBe(landed.content);
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
});

test('E654: apply_format is one undo step, replace_range takes canonical offsets, scroll targets resolve, and a preview-mode tool answers a typed failure', async ({
  page,
}) => {
  await fsWrite(page, '/docs/bridge2.md', DOC);
  await page.goto('/#open=/docs/bridge2.md');
  await expect(page.getByTestId('doc')).toContainText('alpha');

  // Preview mode: get_editor_state still answers; an edit-mode tool fails, typed.
  const preview = ok(await bridge(page, { tool: 'get_editor_state' })).state;
  expect(preview.content).toBe(DOC);
  const refused = await bridge(page, { tool: 'set_selection', from: 0, to: 1 });
  expect(refused).toMatchObject({ ok: false, error: { code: 'tool_failed', message: 'editor is not in edit mode' } });

  await page.keyboard.press('Control+e');
  const content = page.getByTestId('editor').locator('.cm-content');
  await expect(content).toBeVisible();

  // apply_format over a bridge-set selection: one undo step.
  const from = DOC.indexOf('gamma');
  ok(await bridge(page, { tool: 'set_selection', from, to: from + 5 }));
  const rev = ok(await bridge(page, { tool: 'get_editor_state' })).state.revision;
  const bold = ok(await bridge(page, { tool: 'apply_format', revision: rev, op: 'bold' })).state;
  expect(bold.content).toContain('**gamma**');
  await expect(content).toContainText('**gamma**');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('**gamma**');
  expect(await docText(page)).toBe(DOC);
  expect(await fsRead(page, '/docs/bridge2.md')).toBe(DOC);

  // replace_range with explicit canonical offsets, independent of the selection.
  const rev2 = ok(await bridge(page, { tool: 'get_editor_state' })).state.revision;
  const ranged = ok(await bridge(page, { tool: 'replace_range', revision: rev2, from: 2, to: 8, text: 'Renamed' })).state;
  expect(ranged.content.startsWith('# Renamed\n')).toBe(true);
  await expect(content).toContainText('# Renamed');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await docText(page)).toBe(DOC);

  // scroll: a heading resolves, an unknown one fails, and the caret stays put.
  const before = ok(await bridge(page, { tool: 'get_editor_state' })).state.cursor;
  ok(await bridge(page, { tool: 'scroll', target: { to: 'heading', heading: 'Second' } }));
  ok(await bridge(page, { tool: 'scroll', target: { by: 'pages', amount: 1 } }));
  ok(await bridge(page, { tool: 'scroll', target: { by: 'lines', amount: -2 } }));
  const after = ok(await bridge(page, { tool: 'scroll', target: { to: 'line', line: 1 } })).state;
  expect(after.cursor).toEqual(before);
  expect(after.scroll.totalLines).toBe(DOC.split('\n').length);
  const missing = await bridge(page, { tool: 'scroll', target: { to: 'heading', heading: 'Nowhere' } });
  expect(missing).toMatchObject({ ok: false, error: { code: 'tool_failed', message: 'heading not found: Nowhere' } });

  // open_file through the registry: the result names the newly open path.
  await fsWrite(page, '/docs/other.md', '# Other\n');
  const opened = ok(await bridge(page, { tool: 'open_file', path: '/docs/other.md' })).state;
  expect(opened.path).toBe('/docs/other.md');
  expect(opened.content).toBe('# Other\n');
  await expect(page.locator('.doc h1, .cm-content').first()).toContainText('Other');
});
