import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  cancelSettings,
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openFolderRoot,
  openLlmPage,
  openSettings,
  openWelcomeViaHelp,
  revealToolbar,
  saveSettings,
  seedFolders,
} from './helpers';

// Settings dialog, themes, typography, zoom and the line-number gutter.

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('E2: Settings lists the 7 built-in themes; Monokai changes the background; choice persists across reload', async ({
  page,
}) => {
  await openSettings(page);
  const select = page.getByTestId('settings-theme-light');
  for (const id of ['crisp', 'claude', 'monokai', 'dracula', 'nord', 'solarized-light', 'one-dark']) {
    await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
  }

  const before = await page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(before).toBe('rgb(255, 255, 255)'); // Crisp default (#ffffff)

  // Issue #246: the pick is pending — the main window restyles on Save.
  await select.selectOption('monokai');
  await saveSettings(page);
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)'); // Monokai #272822

  await page.reload();
  await openWelcomeViaHelp(page);
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)');
  await openSettings(page);
  await expect(page.getByTestId('settings-theme-light')).toHaveValue('monokai');
});

test('E3: dropping a user theme into the config themes dir + Reload themes (in Settings) makes it appear and apply', async ({
  page,
}) => {
  const css = `/* @name: Midnight Ocean\n   @author: e2e\n   @variant: dark */\n.theme-root { --mm-bg: #010203; --mm-fg: #d8e2ec; }`;
  await fsWrite(page, '/config/themes/midnight-ocean.css', css);

  await openSettings(page);
  await page.getByTestId('reload-themes').click();
  const select = page.getByTestId('settings-theme-light');
  const option = select.locator('option[value="midnight-ocean"]');
  await expect(option).toHaveCount(1);
  await expect(option).toHaveText(/Midnight Ocean/);
  await select.selectOption('midnight-ocean');
  await saveSettings(page); // issue #246: the pick applies on Save
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(1, 2, 3)');
});

test('E19: customized font size applies to the document; Auto restores the theme default', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('fontsize-custom').check();
  await page.getByTestId('fontsize-input').fill('20');
  await saveSettings(page); // issue #246: pending until Save
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('20px');

  await openSettings(page);
  await page.getByTestId('fontsize-auto').check();
  await saveSettings(page);
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('16px'); // Crisp's --mm-font-size
});

test('E20: zoom scales only the document text — the settings UI keeps its size; Reset restores 100%', async ({
  page,
}) => {
  await openSettings(page);
  // Let the async settings load apply the default font override first —
  // the baseline must be the settled UI, not the boot-time theme value.
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('14px');
  const modalFontBefore = await page.getByTestId('settings-panel').evaluate((el) => getComputedStyle(el).fontSize);

  await page.getByTestId('zoom-select').selectOption('150');
  await saveSettings(page); // issue #246: the zoom applies on Save
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('21px'); // 14px default × 1.5 — document text only

  // The UI is NOT zoomed: settings modal font size unchanged, root not CSS-zoomed.
  await openSettings(page);
  expect(await page.getByTestId('settings-panel').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    modalFontBefore
  );
  expect(await page.locator('.theme-root').evaluate((el) => getComputedStyle(el).zoom)).toBe('1');

  await page.getByTestId('zoom-reset').click();
  await expect(page.getByTestId('zoom-select')).toHaveValue('100');
  await saveSettings(page);
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('14px');
});

test('E21: light/dark theme pair follows the OS scheme; unchecking uses the light theme everywhere', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await saveSettings(page);

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)'); // Crisp

  // Uncheck "Use separate theme in dark mode" → dark scheme keeps the light theme.
  await openSettings(page);
  await page.getByTestId('use-dark-theme').uncheck();
  await saveSettings(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)');
});

test('E22: Wide text margins narrow the column; line numbers gutter follows its setting', async ({ page }) => {
  // The app default is the super-narrow 76rem column (narrowest margins).
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('1216px');

  await openSettings(page);
  await page.getByTestId('settings-margins').selectOption('super-narrow');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('1216px'); // 76rem — even fewer margins than narrow

  await page.getByTestId('settings-margins').selectOption('wide');
  await saveSettings(page); // issue #246: the column moves on Save
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('608px'); // 38rem

  // Default: gutter present.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers')).toBeVisible();
  await page.keyboard.press('Control+e');

  // Issue #10: the gutter's toggle lives in the View menu now — in the
  // menu-less shim that is the same command through window.__mmDispatch.
  await page.evaluate(() => window.__mmDispatch!('toggleLineNumbers'));
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor').locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers')).toHaveCount(0);
});

test('E24: the new Claude theme — Typora-derived paper, serif body, tight headings, 752px column', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('claude');
  // The margins setting now defaults to super-narrow, which overrides any
  // theme column — this test is about the THEME's own width, so pick
  // "Theme default" explicitly.
  await page.getByTestId('settings-margins').selectOption('default');
  await saveSettings(page);

  const doc = page.getByTestId('doc');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(250, 249, 245)'); // #faf9f5 paper
  expect(await doc.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia'); // serif body stack
  await expect.poll(() => doc.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('960px'); // 60rem (SPEC4 §7)
  expect(await doc.locator('h1').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px'); // 1.375rem
});

test('E26: settings shows five left tabs with the right content on each; controls work through their tabs', async ({
  page,
}) => {
  // Open without the helper's tab click so the DEFAULT tab is observable.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-panel').waitFor();
  const tabs = page.getByTestId('settings-tabs');
  // SPEC20 §1 added Editor; PRD 011 Req 1 added Experimental as the last one.
  // Issue #247 took LLM providers back out of the rail — it is a nested page
  // under the Semantic zoom experiment now, so the rail is back to five.
  await expect(tabs.locator('button')).toHaveCount(5);
  await expect(page.getByTestId('settings-tab-llm')).toHaveCount(0);
  await expect(page.getByTestId('settings-tab-experimental')).toHaveText('Experimental');
  // Issue #21: General is listed first and is the default tab.
  await expect(tabs.locator('button').first()).toHaveText('General');
  await expect(page.getByTestId('settings-tab-general')).toHaveClass(/(^|\s)on(\s|$)/);

  // General (default): comments + navigation, no appearance/hotkeys/LLM controls.
  await expect(page.getByTestId('comment-storage')).toBeVisible();
  await expect(page.getByTestId('settings-vimnav')).toBeVisible();
  await expect(page.getByTestId('zoom-select')).toHaveCount(0);
  await expect(page.getByTestId('hotkey-toggleEdit')).toHaveCount(0);
  // PRD 011 Req 4 (amended by issue #247): the LLM area is a page of its own
  // — nested under the Semantic zoom experiment — and never a row on General.
  await expect(page.getByTestId('llm-provider')).toHaveCount(0);

  // Appearance: font size present, General content absent.
  await page.getByTestId('settings-tab-appearance').click();
  await expect(page.getByTestId('fontsize-auto')).toBeVisible();
  await expect(page.getByTestId('comment-storage')).toHaveCount(0);

  // Hotkeys tab.
  await page.getByTestId('settings-tab-hotkeys').click();
  await expect(page.getByTestId('hotkey-toggleEdit')).toBeVisible();
  await expect(page.getByTestId('fontsize-auto')).toHaveCount(0);

  // A control still works through its tab: change author in General, persists.
  await page.getByTestId('settings-tab-general').click();
  await page.getByTestId('author-input').fill('TabTester');
  await saveSettings(page);
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('TabTester');
});

test('E34: the theme catalog lists 27+ themes; new classics apply their canonical backgrounds', async ({
  page,
}) => {
  await openSettings(page);
  expect(await page.getByTestId('settings-theme-light').locator('option').count()).toBeGreaterThanOrEqual(27);

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);

  // Issue #246: one pick per dialog session — each applies on its Save.
  const pick = async (id: string) => {
    if ((await page.getByTestId('settings-panel').count()) === 0) await openSettings(page);
    await page.getByTestId('settings-theme-light').selectOption(id);
    await saveSettings(page);
  };

  await pick('gruvbox-dark');
  await expect.poll(bg).toBe('rgb(40, 40, 40)'); // #282828

  await pick('github-dark');
  await expect.poll(bg).toBe('rgb(13, 17, 23)'); // #0d1117

  await pick('phosphor');
  await expect.poll(bg).toBe('rgb(10, 15, 10)'); // near-black CRT
  // Phosphor is a mono theme — the document body uses a monospace stack.
  expect(
    await page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())
  ).toContain('mono');
});

test('E35: the settings dialog keeps one fixed size across all three tabs', async ({ page }) => {
  await openSettings(page);
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const tab of ['general', 'appearance', 'hotkeys'] as const) {
    await page.getByTestId(`settings-tab-${tab}`).click();
    await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveClass(/(^|\s)on(\s|$)/);
    boxes.push((await page.getByTestId('settings-panel').boundingBox())!);
  }
  for (const b of boxes.slice(1)) {
    expect(Math.abs(b.width - boxes[0].width)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - boxes[0].height)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x - boxes[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - boxes[0].y)).toBeLessThanOrEqual(1);
  }
});

test('E136: issue #10 — View → Line Numbers toggles the gutter live and persists; the flush gutter carries a right rule only (issue #272)', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc')).toBeVisible();

  // Wide margins + full-screen edit: maximum horizontal slack. Before issue
  // #272 the gutter+content pair centred here and the strip floated inset
  // (issue #10's case); the column now anchors flush left, so this is the
  // configuration where any leftover centring would show.
  const popup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popup;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-appearance').click();
  await sp.getByTestId('settings-margins').selectOption('wide');
  // Issue #246: the aux window holds edits pending too — Save commits and
  // closes the window itself.
  await sp.getByTestId('settings-save').click();
  await menuClick(page, 'toggleSplit'); // full-screen edit: the pane IS the window

  await menuClick(page, 'toggleMode');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('split-preview')).toHaveCount(0);
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();

  /** The View item, straight off the installed spec. */
  const item = () =>
    page.evaluate(
      () =>
        window
          .__mmMenu!.spec!.submenus.find((m) => m.title === 'View')!
          .items.find((i) => i.type === 'command' && i.command === 'toggleLineNumbers') as
          | { label: string; checked?: boolean; accelerator?: string }
          | undefined
    );

  // A checkbox tracking the setting — and deliberately hotkey-less.
  const initial = (await item())!;
  expect(initial.label).toBe('Line Numbers');
  expect(initial.checked).toBe(true);
  expect(initial.accelerator).toBeUndefined();

  // Clicking it reconfigures the editor live…
  await menuClick(page, 'toggleLineNumbers');
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  await expect.poll(async () => (await item())!.checked).toBe(false);
  // …and persists through the main window (the sole owner of settings.json).
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { lineNumbers?: boolean }).lineNumbers : undefined;
    })
    .toBe(false);
  // Back on, checkbox in step.
  await menuClick(page, 'toggleLineNumbers');
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  await expect.poll(async () => (await item())!.checked).toBe(true);

  /** Gutter inset from its pane's left edge, plus its two side rules. */
  const gutter = () =>
    page.locator('.editor-wrap .cm-gutters').evaluate((el) => {
      const cs = getComputedStyle(el);
      const wrap = (el.closest('.editor-wrap') as HTMLElement).getBoundingClientRect();
      return {
        inset: Math.round(el.getBoundingClientRect().left - wrap.left),
        left: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
        right: `${cs.borderRightWidth} ${cs.borderRightStyle} ${cs.borderRightColor}`,
      };
    });
  /** Issue #272's contract, the same in every configuration this test walks:
   *  flush at the pane edge, nothing (no rule) to the gutter's left, and the
   *  themed right rule (issue #63) still present. */
  const expectFlushRightRuled = async () => {
    await expect.poll(async () => (await gutter()).inset).toBeLessThanOrEqual(2);
    const g = await gutter();
    expect(g.left).toMatch(/^0px /);
    expect(g.right).toMatch(/^1px solid /);
    expect(g.right).not.toContain('rgb(221, 221, 221)'); // --mm-border, never CM's #ddd
    return g;
  };

  // Wide margins, full-screen edit, maximum slack: flush anyway — the slack
  // is all on the column's right (issue #272; the left rule that used to
  // outline the centred strip is gone with the centring).
  const light = await expectFlushRightRuled();

  // Dark theme: the right rule reads --mm-border, so it follows the theme —
  // and the left side stays bare rather than drifting back in.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await gutter()).right).not.toBe(light.right);
  await expectFlushRightRuled();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await gutter()).right).toBe(light.right);

  const setMargins = async (value: string) => {
    const p = page.waitForEvent('popup');
    await menuClick(page, 'settings');
    const s = await p;
    await s.getByTestId('settings-panel').waitFor();
    await s.getByTestId('settings-tab-appearance').click();
    await s.getByTestId('settings-margins').selectOption(value);
    await s.getByTestId('settings-save').click(); // issue #246: Save commits, then closes
  };
  // The movers that used to change the slack now change nothing about the
  // anchor. The folder panel squeezes the pane from the left…
  await setMargins('super-narrow');
  await seedFolders(page);
  await openFolderRoot(page);
  await expect(page.locator('.editor-wrap .cm-gutters')).toBeVisible();
  await expectFlushRightRuled(); // flush against the folder seam, no doubled hairline

  // …the margins preset resizes the column off a ROOT variable (no pane
  // resize, no edit — only --mm-content-width moves)…
  await setMargins('wide');
  await expect(page.getByTestId('folder-panel')).toBeVisible(); // nothing resized
  await expectFlushRightRuled();
  await setMargins('super-narrow');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expectFlushRightRuled();

  // …closing the panel hands the width back…
  await menuClick(page, 'toggleFolders');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expectFlushRightRuled();

  // …and split mode hugs the folder seam exactly as before (issue #7) —
  // now simply the same geometry as everything above.
  await menuClick(page, 'toggleSplit');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  await expectFlushRightRuled();

  // Dark again in split, for the full matrix: themed right rule, bare left.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await gutter()).right).not.toBe(light.right);
  await expectFlushRightRuled();
});

test('E156: issue #52 — the line-number gutter follows the theme instead of staying CodeMirror gray', async ({
  page,
}) => {
  // Line numbers are on by default; enter edit mode to get the gutter.
  await page.keyboard.press('Control+e');
  const gutters = page.getByTestId('editor').locator('.cm-gutters');
  await expect(gutters).toBeVisible();

  /** Computed gutter surface + digit colors, straight off the DOM. */
  const colors = () =>
    gutters.evaluate((el) => {
      const digit = el.querySelector('.cm-lineNumbers .cm-gutterElement:last-child')!;
      return {
        bg: getComputedStyle(el).backgroundColor,
        fg: getComputedStyle(digit).color,
      };
    });

  // Crisp: theme tokens, not the base theme's #f5f5f5 / #6c6c6c grays.
  const light = await colors();
  expect(light.bg).toBe('rgb(255, 255, 255)'); // --mm-bg
  expect(light.fg).toBe('rgb(89, 99, 110)'); // --mm-fg-muted

  // The app doesn't mount highlightActiveLineGutter, but the base theme still
  // ships a hardcoded light-blue #e2f2fa for .cm-activeLineGutter; the issue
  // #52 rule neutralizes it so it can never clash with a theme. Probe the
  // rule by putting the class on a real gutter element and reading it back.
  const activeBg = () =>
    gutters.evaluate((el) => {
      const digit = el.querySelector('.cm-lineNumbers .cm-gutterElement:last-child')!;
      digit.classList.add('cm-activeLineGutter');
      const bg = getComputedStyle(digit).backgroundColor;
      digit.classList.remove('cm-activeLineGutter');
      return bg;
    });
  expect(await activeBg()).toBe('rgba(0, 0, 0, 0)');

  // Switch to Monokai (the E2 pattern): every reading follows the new tokens.
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('monokai');
  await saveSettings(page);
  await expect.poll(async () => (await colors()).bg).toBe('rgb(39, 40, 34)'); // --mm-bg
  await expect.poll(async () => (await colors()).fg).toBe('rgb(165, 159, 133)'); // --mm-fg-muted
  expect(await activeBg()).toBe('rgba(0, 0, 0, 0)');
});

// --- PRD 011 Reqs 4/6/7/9/10: the LLM providers area -------------------------
// Every request here runs against src/lib/llmFake.ts, wired into the desktop
// shim as its `llmTransport` (PRD 011 Req 35) — no real provider is contacted.

test('E226: the LLM providers page is its own User-scope page under the experiment; with nothing configured it says why, and the test action is disabled', async ({
  page,
}) => {
  await openLlmPage(page);

  // Req 4 (amended by issue #247): a page of its own — nested under the
  // experiment it serves, not a row on another tab and no longer a top-level
  // tab.
  await expect(page.getByTestId('settings-tab-llm')).toHaveCount(0);
  await expect(page.getByTestId('settings-page-llm')).toBeVisible();
  await expect(page.getByTestId('llm-provider')).toBeVisible();

  // Req 5: exactly the seam's five kinds, and no sixth.
  const provider = page.getByTestId('llm-provider');
  await expect(provider.locator('option')).toHaveCount(5);
  for (const kind of ['openai', 'anthropic', 'gemini', 'openrouter', 'custom']) {
    await expect(provider.locator(`option[value="${kind}"]`)).toHaveCount(1);
  }

  // Req 9: it states why it is unavailable, phrased so the reader knows what
  // to do next, and offers no action that cannot work.
  await expect(page.getByTestId('llm-availability')).toContainText('No API key configured');
  await expect(page.getByTestId('llm-test')).toBeDisabled();

  // Req 7: the key field is masked.
  await expect(page.getByTestId('llm-api-key')).toHaveAttribute('type', 'password');

  // Req 4: User-scope only, following the Hotkeys precedent — issue #247's
  // Back returns to the Experimental tab it hangs off, which is User-only
  // beside Hotkeys, and the Workspace scope offers neither (it is disabled
  // here because no workspace is open).
  await page.getByTestId('settings-page-back').click();
  await expect(page.getByTestId('settings-tab-experimental')).toHaveClass(/(^|\s)on(\s|$)/);
  await expect(page.getByTestId('settings-tab-hotkeys')).toBeVisible();
  await expect(page.getByTestId('settings-scope-workspace')).toBeDisabled();
});

test('E227: configuring a provider, a curated model and a key enables Test connection, and the result is reported', async ({
  page,
}) => {
  await openLlmPage(page);

  // Req 6: the curated list fills the free-text field, which stays editable.
  await page.getByTestId('llm-model-preset').selectOption('claude-opus-5');
  await expect(page.getByTestId('llm-model')).toHaveValue('claude-opus-5');
  // …and any id the provider accepts can be typed instead.
  await page.getByTestId('llm-model').fill('claude-shipped-tomorrow');
  await expect(page.getByTestId('llm-availability')).toContainText('No API key configured');

  await page.getByTestId('llm-api-key').fill('sk-e227-secret');
  await expect(page.getByTestId('llm-availability')).toContainText('Ready');

  // Issue #246: edits are pending until Save, and Test connection runs
  // against the SAVED settings — so commit, then reopen to test the key.
  await saveSettings(page);
  await openLlmPage(page);

  // Req 10: one user-invoked request, reported as success or a specific failure.
  await page.getByTestId('llm-test').click();
  await expect(page.getByTestId('llm-test-result')).toContainText('succeeded');

  // Req 7: the key persists to the User layer of settings.json and appears
  // nowhere in the rendered page — not in a hint, a title or a notice.
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { llmApiKey?: string }).llmApiKey : undefined;
    })
    .toBe('sk-e227-secret');
  // The masked field is the ONE place the value lives: strip that input and
  // the key appears in no hint, title, indicator, scope note or result.
  const shown = await page.getByTestId('settings-panel').innerHTML();
  expect(shown.replace(/<input[^>]*data-testid="llm-api-key"[^>]*>/g, '')).not.toContain('sk-e227-secret');
  // The free-text model survived the round trip through the settings layer.
  await expect(page.getByTestId('llm-model')).toHaveValue('claude-shipped-tomorrow');
});

test('E228: on desktop the settings window round-trips Test connection through the main window', async ({ page }) => {
  await freshNativeMenuApp(page);
  const popupPromise = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popupPromise;
  await sp.getByTestId('settings-panel').waitFor();

  // Issue #247: the aux window nests exactly like the overlay — Experimental,
  // then the row's stand-down route to the LLM providers page.
  await sp.getByTestId('settings-tab-experimental').click();
  await sp.getByTestId('experimental-semantic-zoom-stand-down-link').click();
  await expect(sp.getByTestId('settings-page-llm')).toBeVisible();
  await sp.getByTestId('llm-model-preset').selectOption('claude-sonnet-5');
  await sp.getByTestId('llm-api-key').fill('sk-e228-secret');
  await expect(sp.getByTestId('llm-availability')).toContainText('Ready');
  // Issue #246: the key is pending until Save (which closes the window), and
  // Test connection runs against the saved settings — so save, then reopen.
  await sp.getByTestId('settings-save').click();
  const reopened = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp2 = await reopened;
  await sp2.getByTestId('settings-tab-experimental').click();
  await sp2.getByTestId('experimental-semantic-zoom-stand-down-link').click();

  // Req 10: the aux window holds no capability — the request travels to the
  // main window over the bus and the verdict comes back for it to render.
  await sp2.getByTestId('llm-test').click();
  await expect(sp2.getByTestId('llm-test-result')).toContainText('succeeded');

  // Req 7: no key crosses into anything the main window renders or persists
  // outside the User layer, and the settings window never shows it back.
  const rendered = await sp2.getByTestId('settings-panel').innerHTML();
  expect(rendered.replace(/<input[^>]*data-testid="llm-api-key"[^>]*>/g, '')).not.toContain('sk-e228-secret');
  await expect
    .poll(async () => {
      const raw = await fsRead(page, '/config/settings.json');
      return raw ? (JSON.parse(raw) as { llmApiKey?: string }).llmApiKey : undefined;
    })
    .toBe('sk-e228-secret');
});

// --- Issue #122: the code-block syntax-coloring setting ----------------------

const SYNTAX_DOC = [
  '# Colour',
  '',
  '```js',
  'const answer = 42; // the number',
  '```',
  '',
  'Tail prose.',
  '',
].join('\n');

test('E265: issue #122 — code block syntax coloring is on by default, toggles live in both panes, and persists', async ({
  page,
}) => {
  // Intent: the setting half of issue #122 end to end. On (the default) both
  // panes colour a labelled fence by language — the preview through
  // rehype-highlight's hljs classes, the editor through the mm-code-* classes
  // on the same --mm-syn-* theme tokens. Off, neither pane shows a token
  // colour while the code background survives, the toggle applies live with no
  // reopen, and the choice lands in settings.json.
  await fsWrite(page, '/docs/colour.md', SYNTAX_DOC);
  await page.goto('/#open=/docs/colour.md');
  const doc = page.getByTestId('doc');
  await expect(doc.locator('pre code.hljs')).toHaveCount(1);
  // Default ON: the preview's colours are live (the neutralizer class is off).
  await expect(doc).not.toHaveClass(/mm-code-plain/);
  await expect(doc.locator('.hljs-keyword').first()).toHaveText('const');
  const litKeyword = await doc.locator('.hljs-keyword').first().evaluate((el) => getComputedStyle(el).color);
  const litPlain = await doc.locator('pre code').evaluate((el) => getComputedStyle(el).color);
  expect(litKeyword).not.toBe(litPlain); // actually coloured, not just classed

  // The editor pane colours the same fence, and keeps the code background.
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.mm-code-keyword').first()).toHaveText('const');
  await expect(editor.locator('.mm-code-comment').first()).toContainText('the number');
  await expect(editor.locator('.mm-md-code').first()).toBeVisible(); // SPEC23 §3 fence background intact

  // Toggle it off from Settings ▸ Editor ▸ Syntax — live, no reopen.
  await openSettings(page, 'general');
  await page.getByTestId('settings-tab-editor').click();
  await page.getByTestId('code-syntax').uncheck();
  await saveSettings(page);
  await expect(editor.locator('[class*="mm-code-"]:not(.mm-code-sel)')).toHaveCount(0);
  // The markdown highlighting beside it is untouched — the two are independent.
  await expect(editor.locator('.mm-md-code').first()).toBeVisible();

  await page.keyboard.press('Control+e');
  await expect(doc).toHaveClass(/mm-code-plain/);
  // The hljs markup is still emitted (the rendered text must not vary with a
  // setting) but paints in the plain code foreground.
  await expect(doc.locator('.hljs-keyword').first()).toHaveText('const');
  const offKeyword = await doc.locator('.hljs-keyword').first().evaluate((el) => getComputedStyle(el).color);
  const offPlain = await doc.locator('pre code').evaluate((el) => getComputedStyle(el).color);
  expect(offKeyword).toBe(offPlain);
  // The code background is unchanged by the setting.
  const bg = await doc.locator('pre').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');

  // Persisted, and honored on a cold boot.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"codeSyntax": false');
  await page.reload();
  await page.goto('/#open=/docs/colour.md');
  await expect(page.getByTestId('doc')).toHaveClass(/mm-code-plain/);
});

test('E314: issue #167 — scrollbars fade after the idle delay without reflow; the setting restores always-visible bars and persists', async ({
  page,
}) => {
  // A doc tall enough that the full-preview workspace scrolls.
  await page.evaluate(() => {
    const parts: string[] = [];
    for (let i = 1; i <= 60; i++) parts.push(`## Section ${i}\n\n` + `Body for section ${i}. `.repeat(10) + '\n');
    window.__mmfs!.write('/docs/tall.md', parts.join('\n'));
  });
  await page.goto('/#open=/docs/tall.md');
  const ws = page.locator('.workspace');
  await expect(ws.locator('h2').first()).toContainText('Section 1');

  // The default is ON: the root carries the mode class before any scroll.
  await expect(page.locator('.theme-root')).toHaveClass(/autohide-scrollbars/);

  // Hiding is paint-only: the gutter is reserved, so the content box and the
  // wrapped text hold the same geometry in the shown and hidden states.
  const geom = () =>
    ws.evaluate((el) => {
      const doc = el.querySelector('[data-testid="doc"]')!.getBoundingClientRect();
      return { cw: el.clientWidth, x: Math.round(doc.x), w: Math.round(doc.width) };
    });

  // Scrolling shows the bar (data-scrollbars=active)…
  await ws.evaluate((el) => (el.scrollTop = 400));
  await expect(ws).toHaveAttribute('data-scrollbars', 'active');
  const shown = await geom();
  // …and one idle delay later it fades on its own, with no reflow.
  await expect(ws).toHaveAttribute('data-scrollbars', 'idle', { timeout: 4000 });
  expect(await geom()).toEqual(shown);
  // A new scroll restarts the cycle.
  await ws.evaluate((el) => (el.scrollTop = 800));
  await expect(ws).toHaveAttribute('data-scrollbars', 'active');
  expect(await geom()).toEqual(shown);

  // The Settings checkbox rides beside the auto-hide-toolbar row and takes
  // effect live: mode class gone, attribute stripped, no timer re-arming it.
  await openSettings(page, 'general');
  await expect(page.getByTestId('settings-autohide-scrollbars')).toBeChecked();
  await page.getByTestId('settings-autohide-scrollbars').uncheck();
  await saveSettings(page);
  await expect(page.locator('.theme-root')).not.toHaveClass(/autohide-scrollbars/);
  await expect(ws).not.toHaveAttribute('data-scrollbars');
  await ws.evaluate((el) => (el.scrollTop = 200));
  await page.waitForTimeout(200);
  await expect(ws).not.toHaveAttribute('data-scrollbars');

  // Persisted: the choice reaches disk and a restart boots with plain
  // always-visible bars.
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('"autoHideScrollbars": false');
  await page.reload();
  await expect(ws.locator('h2').first()).toContainText('Section 1');
  await expect(page.locator('.theme-root')).not.toHaveClass(/autohide-scrollbars/);
});

// --- Issue #246: the enlarged dialog, its pinned footer, and Save / Cancel ---

/** One key straight out of the User layer on disk — absent until a Save writes it. */
const readSetting = async (page: Page, key: string): Promise<unknown> => {
  const raw = await fsRead(page, '/config/settings.json');
  return raw ? (JSON.parse(raw) as Record<string, unknown>)[key] : undefined;
};

test('E486: issue #246 — the action footer is pinned outside the scrolling tab content, on every tab', async ({
  page,
}) => {
  await openSettings(page, 'general');
  const panel = page.getByTestId('settings-panel');
  const panelBox = (await panel.boundingBox())!;
  // Issue #317: 20% bigger again (was 648x552), still inside the viewport
  // caps — which is why this is computed rather than a bare 778x662: at this
  // suite's 720px-tall window the height clamps to `.dialog`'s `max-height:
  // 84vh` (~605px) long before it reaches 662.
  const viewport = page.viewportSize()!;
  expect(panelBox.width).toBeLessThanOrEqual(Math.min(778, viewport.width * 0.94) + 1);
  expect(panelBox.width).toBeGreaterThanOrEqual(Math.min(778, viewport.width * 0.94) - 1);
  const cappedHeight = Math.min(662, viewport.height * 0.85, viewport.height * 0.84);
  expect(panelBox.height).toBeLessThanOrEqual(cappedHeight + 1);
  expect(panelBox.height).toBeGreaterThanOrEqual(cappedHeight - 1);

  // The footer is a child of the dialog and a SIBLING of the scrolling
  // region — the whole point: it cannot scroll away with the tab content.
  const actions = page.getByTestId('settings-actions');
  expect(
    await actions.evaluate((el) => ({
      parent: el.parentElement?.dataset.testid ?? '',
      insideScroller: el.closest('.tab-content') !== null,
    }))
  ).toEqual({ parent: 'settings-panel', insideScroller: false });
  // Exactly two close controls, both here: the scrolling third button the
  // tab content used to carry is gone.
  await expect(actions.getByRole('button')).toHaveCount(2);

  const first = (await actions.boundingBox())!;
  // Issue #247: `llm` left the rail — the nested page it became is checked
  // right after this loop, because the footer must pin on BOTH levels.
  for (const tab of ['appearance', 'editor', 'hotkeys', 'experimental'] as const) {
    await page.getByTestId(`settings-tab-${tab}`).click();
    const box = (await actions.boundingBox())!;
    expect(Math.abs(box.y - first.y)).toBeLessThanOrEqual(1); // it never moves
    expect(Math.abs(box.x - first.x)).toBeLessThanOrEqual(1);
    // …and it stays inside the dialog, below the scrolling region.
    expect(box.y + box.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
    await expect(page.getByTestId('settings-save')).toBeVisible();
    await expect(page.getByTestId('settings-cancel')).toBeVisible();
  }

  // Scrolling the longest tab to its end leaves the footer exactly where it was.
  const scroller = page.getByTestId('settings-scope-content-user');
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const scrolled = (await actions.boundingBox())!;
  expect(Math.abs(scrolled.y - first.y)).toBeLessThanOrEqual(1);

  // Issue #247: and one level down. The nested page replaces the rail and the
  // tab content, never the footer — same sibling, same place, still scrolling
  // independently of it.
  await page.getByTestId('settings-tab-experimental').click();
  await page.getByTestId('experimental-semantic-zoom-stand-down-link').click();
  await expect(page.getByTestId('settings-page-llm')).toBeVisible();
  const nested = (await actions.boundingBox())!;
  expect(Math.abs(nested.y - first.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(nested.x - first.x)).toBeLessThanOrEqual(1);
  expect(
    await actions.evaluate((el) => el.parentElement?.dataset.testid ?? '')
  ).toBe('settings-panel');
  await expect(page.getByTestId('settings-save')).toBeVisible();
  await expect(page.getByTestId('settings-cancel')).toBeVisible();
});

test('E487: issue #246 — nothing is written until Save, which commits and closes', async ({ page }) => {
  await openSettings(page, 'editor');
  const syntax = page.getByTestId('editor-syntax');
  await expect(syntax).toBeChecked();
  await syntax.click();
  await expect(syntax).not.toBeChecked(); // the pending value shows

  // Pending means pending: settings.json has not moved while the dialog is up.
  expect(await readSetting(page, 'editorSyntax')).toBeUndefined();

  await saveSettings(page);
  await expect.poll(() => readSetting(page, 'editorSyntax')).toBe(false);
  await openSettings(page, 'editor');
  await expect(page.getByTestId('editor-syntax')).not.toBeChecked();
  await saveSettings(page);
});

test('E488: issue #246 — Cancel confirms before discarding, and go-back keeps the dialog as it was', async ({
  page,
}) => {
  await openSettings(page, 'editor');
  await page.getByTestId('editor-syntax').click();

  await page.getByTestId('settings-cancel').click();
  await expect(page.getByTestId('settings-discard-prompt')).toBeVisible();

  // Go back: still open, still on the Editor tab, the pending edit intact.
  await page.getByTestId('settings-discard-cancel').click();
  await expect(page.getByTestId('settings-discard-prompt')).toHaveCount(0);
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(page.getByTestId('settings-tab-editor')).toHaveClass(/(^|\s)on(\s|$)/);
  await expect(page.getByTestId('editor-syntax')).not.toBeChecked();

  // Confirm: no write, and reopening shows the original value.
  await page.getByTestId('settings-cancel').click();
  await page.getByTestId('settings-discard-confirm').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  expect(await readSetting(page, 'editorSyntax')).toBeUndefined();
  await openSettings(page, 'editor');
  await expect(page.getByTestId('editor-syntax')).toBeChecked();
  await cancelSettings(page); // nothing pending → closes with no prompt
});

test('E489: issue #246 — Esc and a scrim click take the Cancel path; a clean dialog closes with no prompt', async ({
  page,
}) => {
  // Nothing pending: Cancel, Esc and the scrim each close on the spot.
  await openSettings(page, 'general');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);

  await openSettings(page, 'editor');
  await page.getByTestId('editor-syntax').click();

  // Esc with pending work asks first, and go-back leaves it open.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-discard-prompt')).toBeVisible();
  await page.getByTestId('settings-discard-cancel').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();

  // A scrim mousedown is the same route, not a silent discard.
  await page.mouse.click(6, 300);
  await expect(page.getByTestId('settings-discard-prompt')).toBeVisible();
  await page.getByTestId('settings-discard-confirm').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  expect(await readSetting(page, 'editorSyntax')).toBeUndefined();
});

test('E577: PRD 025 Reqs 1–7, 22 — the Fluid mode row is off by default; on, its nested page maps four actions through Save, the editor root carries the mapping and an inert overlay; off again, both are gone', async ({
  page,
}) => {
  await freshApp(page);
  // Editor pane up first, so the root's attribute can be read with the switch off.
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('editor')).toBeVisible();
  // Req 3: off by default — no configuration attribute, no overlay element.
  await expect(page.getByTestId('editor')).not.toHaveAttribute('data-fluid');
  await expect(page.getByTestId('fluid-overlay')).toHaveCount(0);

  // Req 1: the registry row, unchecked, with the one-line description; the
  // page button is dead while the switch is off (issue #247's rule).
  await openSettings(page, 'experimental');
  const row = page.getByTestId('experimental-fluid-mode');
  await expect(row).not.toBeChecked();
  await expect(page.getByTestId('experimental-fluid-mode-description')).toHaveText(
    'Animates the editor — the cursor glides, selections stretch, and text fades in and out. Does nothing when your system asks for reduced motion.'
  );
  await expect(page.getByTestId('experimental-fluid-mode-settings')).toBeDisabled();
  await row.check();
  await expect(page.getByTestId('experimental-fluid-mode-settings')).toBeEnabled();

  // Req 4: the nested page, in the shared shell with its breadcrumb.
  await page.getByTestId('experimental-fluid-mode-settings').click();
  await expect(page.getByTestId('settings-page-fluid')).toBeVisible();
  await expect(page.getByTestId('settings-page-crumb')).toHaveText('Experimental › Fluid mode');
  await expect(page.getByTestId('settings-page-back')).toBeVisible();

  // Req 5 + 7: exactly four pickers, in order, each None + the applicable effects.
  const pickers = page.getByTestId('settings-page-fluid').locator('select');
  await expect(pickers).toHaveCount(4);
  const ids = await pickers.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  expect(ids).toEqual(['fluid-pick-cursor', 'fluid-pick-selection', 'fluid-pick-deletion', 'fluid-pick-insertion']);
  const options = async (id: string) =>
    page
      .getByTestId(id)
      .locator('option')
      .evaluateAll((els) => els.map((el) => [(el as HTMLOptionElement).value, el.textContent]));
  expect(await options('fluid-pick-cursor')).toEqual([
    ['none', 'None'],
    ['glide', 'Glide'],
    ['elastic', 'Elastic'],
  ]);
  expect(await options('fluid-pick-selection')).toEqual([
    ['none', 'None'],
    ['glide', 'Glide'],
    ['elastic', 'Elastic'],
  ]);
  expect(await options('fluid-pick-deletion')).toEqual([
    ['none', 'None'],
    ['fade', 'Fade'],
    ['pop', 'Pop'],
    ['burst', 'Burst'],
  ]);
  expect(await options('fluid-pick-insertion')).toEqual([
    ['none', 'None'],
    ['fade', 'Fade'],
    ['pop', 'Pop'],
  ]);
  // Req 6: the defaults on first enable.
  await expect(page.getByTestId('fluid-pick-cursor')).toHaveValue('glide');
  await expect(page.getByTestId('fluid-pick-selection')).toHaveValue('elastic');
  await expect(page.getByTestId('fluid-pick-deletion')).toHaveValue('fade');
  await expect(page.getByTestId('fluid-pick-insertion')).toHaveValue('pop');

  // Change one mapping; Save commits it with the switch (issue #246).
  await page.getByTestId('fluid-pick-deletion').selectOption('pop');
  await saveSettings(page);

  // Req 3 + 18: the root encodes the saved mapping and the inert layer exists.
  await expect(page.getByTestId('editor')).toHaveAttribute(
    'data-fluid',
    'cursor=glide;selection=elastic;deletion=pop;insertion=pop'
  );
  await expect(page.getByTestId('fluid-overlay')).toHaveCount(1);
  await expect(page.getByTestId('fluid-overlay')).toHaveAttribute('aria-hidden', 'true');
  expect(
    await page.getByTestId('fluid-overlay').evaluate((el) => getComputedStyle(el).pointerEvents)
  ).toBe('none');
  // The layer lives inside the editor's scroller, never in the content DOM.
  expect(await page.getByTestId('fluid-overlay').evaluate((el) => el.parentElement?.classList.contains('cm-scroller'))).toBe(true);

  // Off again: the feature is absent, not disabled.
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-fluid-mode').uncheck();
  await saveSettings(page);
  await expect(page.getByTestId('fluid-overlay')).toHaveCount(0);
  await expect(page.getByTestId('editor')).not.toHaveAttribute('data-fluid');
});

test('E580: PRD 025 Reqs 9, 10, 16 (issue #334) — with Fluid mode on, reduced motion draws no caret ghost, typing never draws one and lands synchronously, and Cursor movement → None draws nothing', async ({
  page,
}) => {
  await freshApp(page);
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  // On, with the default mapping (Cursor movement → Glide).
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-fluid-mode').check();
  await saveSettings(page);
  await expect(editor).toHaveAttribute('data-fluid', 'cursor=glide;selection=elastic;deletion=fade;insertion=pop');
  const layer = page.getByTestId('fluid-overlay');
  await expect(layer).toHaveCount(1);
  const ghosts = () => layer.evaluate((el) => el.childElementCount);

  // (a) Req 16: reduced motion — navigation moves create no ghost at all,
  // yet the mode stays configured (the root keeps its attribute).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const content = editor.locator('.cm-content');
  await content.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  expect(await ghosts()).toBe(0);
  await expect(editor).toHaveAttribute('data-fluid', /^cursor=glide;/);

  // (b) Reqs 9, 10: motion allowed again — typing never animates, and the
  // document and caret land synchronously: the second character follows the
  // first because the caret advanced, with no wait between key and check.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Home');
  const firstLine = content.locator('.cm-line').first();
  await page.keyboard.press('Q');
  expect(await firstLine.textContent()).toMatch(/^Q/);
  expect(await ghosts()).toBe(0);
  await page.keyboard.press('Z');
  expect(await firstLine.textContent()).toMatch(/^QZ/);
  expect(await ghosts()).toBe(0);
  // Deleting is not a navigation move either.
  await page.keyboard.press('Backspace');
  expect(await firstLine.textContent()).toMatch(/^Q[^Z]/);
  expect(await ghosts()).toBe(0);

  // (c) Cursor movement → None: a navigation move draws nothing.
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-fluid-mode-settings').click();
  await page.getByTestId('fluid-pick-cursor').selectOption('none');
  await saveSettings(page);
  await expect(editor).toHaveAttribute('data-fluid', /^cursor=none;/);
  await content.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  expect(await ghosts()).toBe(0);
  await expect(layer).toHaveCount(1);
});

test('E581: PRD 025 Reqs 9, 11, 14, 16 (issue #335) — with Fluid mode on, reduced motion draws no selection ghost, typing over a selection replaces it synchronously and draws nothing, a large selection snaps, and Selection change → None draws nothing', async ({
  page,
}) => {
  await freshApp(page);
  await page.keyboard.press('Control+e');
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  // On, with the default mapping (Selection change → Elastic).
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-fluid-mode').check();
  await saveSettings(page);
  await expect(editor).toHaveAttribute('data-fluid', 'cursor=glide;selection=elastic;deletion=fade;insertion=pop');
  const layer = page.getByTestId('fluid-overlay');
  await expect(layer).toHaveCount(1);
  const ghosts = () => layer.evaluate((el) => el.childElementCount);
  const content = editor.locator('.cm-content');
  const firstLine = content.locator('.cm-line').first();

  // (a) Req 16: reduced motion — range results create no ghost at all, yet
  // the mode stays configured (the root keeps its attribute).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await content.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  expect(await ghosts()).toBe(0);
  await page.keyboard.press('Shift+ArrowDown');
  expect(await ghosts()).toBe(0);
  await expect(editor).toHaveAttribute('data-fluid', /;selection=elastic;/);

  // (b) Reqs 9, 11: motion allowed again — the selection is real and
  // synchronous (typing replaces exactly what Shift+End selected, with no
  // wait between key and check), a document change cancels any ghost, and
  // typing over a selection never animates one.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Q');
  expect(await firstLine.textContent()).toBe('Q');
  expect(await ghosts()).toBe(0);

  // (c) Req 14: the large-operation snap — once the document is past
  // FLUID_LARGE_OPERATION_LINES lines, select-all draws nothing.
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Enter');
  expect(await content.locator('.cm-line').count()).toBeGreaterThan(50);
  await page.keyboard.press('Control+a');
  expect(await ghosts()).toBe(0);

  // (d) Selection change → None: a range result draws nothing; the layer stays.
  await openSettings(page, 'experimental');
  await page.getByTestId('experimental-fluid-mode-settings').click();
  await page.getByTestId('fluid-pick-selection').selectOption('none');
  await saveSettings(page);
  await expect(editor).toHaveAttribute('data-fluid', /;selection=none;/);
  await content.click();
  await page.keyboard.press('Control+Home'); // line 1 is non-empty, so Shift+End lands a range
  await page.keyboard.press('Shift+End');
  expect(await ghosts()).toBe(0);
  await expect(layer).toHaveCount(1);
});
