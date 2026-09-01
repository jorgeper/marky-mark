import { expect, test } from './fixtures';
import {
  freshApp,
  freshNativeMenuApp,
  fsRead,
  fsWrite,
  menuClick,
  openFolderRoot,
  openSettings,
  openWelcomeViaHelp,
  revealToolbar,
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

  await select.selectOption('monokai');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(39, 40, 34)'); // Monokai #272822
  await page.getByTestId('settings-close').click();

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
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(1, 2, 3)');
});

test('E19: customized font size applies to the document; Auto restores the theme default', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('fontsize-custom').check();
  await page.getByTestId('fontsize-input').fill('20');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('20px');

  await page.getByTestId('fontsize-auto').check();
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
    .toBe('12px');
  const modalFontBefore = await page.getByTestId('settings-panel').evaluate((el) => getComputedStyle(el).fontSize);

  await page.getByTestId('zoom-select').selectOption('150');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('18px'); // 12px default × 1.5 — document text only

  // The UI is NOT zoomed: settings modal font size unchanged, root not CSS-zoomed.
  expect(await page.getByTestId('settings-panel').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    modalFontBefore
  );
  expect(await page.locator('.theme-root').evaluate((el) => getComputedStyle(el).zoom)).toBe('1');

  await page.getByTestId('zoom-reset').click();
  await expect(page.getByTestId('zoom-select')).toHaveValue('100');
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('12px');
});

test('E21: light/dark theme pair follows the OS scheme; unchecking uses the light theme everywhere', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId('settings-theme-light').selectOption('crisp');
  await page.getByTestId('settings-theme-dark').selectOption('one-dark');
  const useDark = page.getByTestId('use-dark-theme');
  if (!(await useDark.isChecked())) await useDark.check();
  await page.getByTestId('settings-close').click();

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(bg).toBe('rgb(255, 255, 255)'); // Crisp

  // Uncheck "Use separate theme in dark mode" → dark scheme keeps the light theme.
  await openSettings(page);
  await page.getByTestId('use-dark-theme').uncheck();
  await page.getByTestId('settings-close').click();
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
  await expect
    .poll(() => page.getByTestId('doc').evaluate((el) => getComputedStyle(el).maxWidth))
    .toBe('608px'); // 38rem
  await page.getByTestId('settings-close').click();

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
  await page.getByTestId('settings-close').click();

  const doc = page.getByTestId('doc');
  await expect
    .poll(() => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(250, 249, 245)'); // #faf9f5 paper
  expect(await doc.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia'); // serif body stack
  await expect.poll(() => doc.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('960px'); // 60rem (SPEC4 §7)
  expect(await doc.locator('h1').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px'); // 1.375rem
});

test('E26: settings shows four left tabs with the right content on each; controls work through their tabs', async ({
  page,
}) => {
  // Open without the helper's tab click so the DEFAULT tab is observable.
  await revealToolbar(page);
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-panel').waitFor();
  const tabs = page.getByTestId('settings-tabs');
  // SPEC20 §1 added Editor; PRD 011 Req 4 added LLM providers as its own page;
  // PRD 011 Req 1 added Experimental as the last one.
  await expect(tabs.locator('button')).toHaveCount(6);
  await expect(page.getByTestId('settings-tab-llm')).toHaveText('LLM providers');
  await expect(page.getByTestId('settings-tab-experimental')).toHaveText('Experimental');
  // Issue #21: General is listed first and is the default tab.
  await expect(tabs.locator('button').first()).toHaveText('General');
  await expect(page.getByTestId('settings-tab-general')).toHaveClass(/(^|\s)on(\s|$)/);

  // General (default): comments + navigation, no appearance/hotkeys/LLM controls.
  await expect(page.getByTestId('comment-storage')).toBeVisible();
  await expect(page.getByTestId('settings-vimnav')).toBeVisible();
  await expect(page.getByTestId('zoom-select')).toHaveCount(0);
  await expect(page.getByTestId('hotkey-toggleEdit')).toHaveCount(0);
  // PRD 011 Req 4: the LLM area is a page of its own, never a row on General.
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
  await page.getByTestId('settings-close').click();
  await expect.poll(() => fsRead(page, '/config/settings.json')).toContain('TabTester');
});

test('E34: the theme catalog lists 27+ themes; new classics apply their canonical backgrounds', async ({
  page,
}) => {
  await openSettings(page);
  const select = page.getByTestId('settings-theme-light');
  expect(await select.locator('option').count()).toBeGreaterThanOrEqual(27);

  const bg = () => page.locator('.theme-root').evaluate((el) => getComputedStyle(el).backgroundColor);

  await select.selectOption('gruvbox-dark');
  await expect.poll(bg).toBe('rgb(40, 40, 40)'); // #282828

  await select.selectOption('github-dark');
  await expect.poll(bg).toBe('rgb(13, 17, 23)'); // #0d1117

  await select.selectOption('phosphor');
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

test('E136: issue #10 — View → Line Numbers toggles the gutter live and persists; an inset gutter is ruled on both sides', async ({
  page,
}) => {
  await freshNativeMenuApp(page);
  await menuClick(page, 'help');
  await expect(page.getByTestId('doc')).toBeVisible();

  // Wide margins + full-screen edit: the gutter+content pair is centered, so
  // the strip floats inset from the pane's left edge — the issue's case.
  const popup = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp = await popup;
  await sp.getByTestId('settings-panel').waitFor();
  await sp.getByTestId('settings-tab-appearance').click();
  await sp.getByTestId('settings-margins').selectOption('wide');
  await sp.close();
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

  // .gutter-inset lands on a rAF scheduled by the pane ResizeObserver
  // (Editor.tsx), so the rules appear a frame after the toggle above settles —
  // poll for the ruled state like every other reading below, rather than
  // one-shot sampling into that gap.
  await expect.poll(async () => (await gutter()).left).toMatch(/^1px solid /);
  const light = await gutter();
  expect(light.inset).toBeGreaterThan(20); // genuinely inset — margins either side
  expect(light.left).toBe(light.right); // both sides read the same --mm-border token
  expect(light.left).toMatch(/^1px solid /);
  expect(light.left).not.toContain('rgba(0, 0, 0, 0)');

  // Dark theme: both sides read the same --mm-border token, so they follow it
  // together instead of drifting apart.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await gutter()).left).not.toBe(light.left);
  const dark = await gutter();
  expect(dark.left).toBe(dark.right);
  expect(dark.left).toMatch(/^1px solid /);
  await page.emulateMedia({ colorScheme: 'light' });

  // The predicate is slack, not mode. At the DEFAULT margins the column all
  // but fills a 1280px window, so the folder panel alone squeezes the last of
  // it out: this same full-screen, non-split pane goes flush, and the left
  // rule has to come off there too — it would otherwise land on
  // .folder-panel::after's own seam hairline, in the same token, and read as
  // a doubled seam.
  const popup2 = page.waitForEvent('popup');
  await menuClick(page, 'settings');
  const sp2 = await popup2;
  await sp2.getByTestId('settings-panel').waitFor();
  await sp2.getByTestId('settings-tab-appearance').click();
  await sp2.getByTestId('settings-margins').selectOption('super-narrow');
  await sp2.close();
  await seedFolders(page);
  await openFolderRoot(page);
  await expect(page.locator('.editor-wrap .cm-gutters')).toBeVisible();
  await expect.poll(async () => (await gutter()).left).toMatch(/^0px /);
  expect((await gutter()).inset).toBeLessThanOrEqual(2);

  // A third mover of the slack, distinct from the two above: the margins
  // preset resizes the text column off a ROOT variable, so the pane never
  // resizes and no edit happens — nothing moves here but --mm-content-width.
  // Widening the column back inside this same squeezed pane hands the slack
  // back, and the rules have to follow.
  const setMargins = async (value: string) => {
    const p = page.waitForEvent('popup');
    await menuClick(page, 'settings');
    const s = await p;
    await s.getByTestId('settings-panel').waitFor();
    await s.getByTestId('settings-tab-appearance').click();
    await s.getByTestId('settings-margins').selectOption(value);
    await s.close();
  };
  await setMargins('wide');
  await expect(page.getByTestId('folder-panel')).toBeVisible(); // nothing resized
  await expect.poll(async () => (await gutter()).left).toBe(light.left);
  expect((await gutter()).inset).toBeGreaterThan(20);

  // …and the other direction, which is where a stale latch draws the left rule
  // flush on the folder seam.
  await setMargins('super-narrow');
  await expect(page.getByTestId('folder-panel')).toBeVisible();
  await expect.poll(async () => (await gutter()).left).toMatch(/^0px /);
  expect((await gutter()).inset).toBeLessThanOrEqual(2);

  // …and back: closing the panel hands the slack back, so both rules return —
  // nothing about the mode changed between these two measurements.
  await menuClick(page, 'toggleFolders');
  await expect(page.getByTestId('folder-panel')).toHaveCount(0);
  await expect.poll(async () => (await gutter()).left).toBe(light.left);
  expect((await gutter()).inset).toBeGreaterThan(0);

  // Split mode hugs the folder seam (issue #7) — nothing to outline there, so
  // the left rule stays off rather than doubling up on the seam.
  await menuClick(page, 'toggleSplit');
  await expect(page.getByTestId('split-preview')).toBeVisible();
  // Issue #165: the column now GLIDES to the seam through the 180ms slide
  // instead of snapping flush on its first frame — poll for the settled
  // geometry (the contract is the resting state, not the flight).
  await expect.poll(async () => (await gutter()).inset).toBeLessThanOrEqual(2);
  const flush = await gutter();
  expect(flush.inset).toBeLessThanOrEqual(2);
  expect(flush.left).toMatch(/^0px /);
  expect(flush.right).toMatch(/^1px solid /);

  // Issue #63: the flush right rule is themed too. It reads --mm-border —
  // never CodeMirror's hardcoded #ddd — so it follows a theme change, while
  // the left rule stays off the seam throughout.
  expect(flush.right).not.toContain('rgb(221, 221, 221)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await gutter()).right).not.toBe(flush.right);
  const darkFlush = await gutter();
  expect(darkFlush.right).toMatch(/^1px solid /);
  expect(darkFlush.right).not.toContain('rgb(221, 221, 221)');
  expect(darkFlush.left).toMatch(/^0px /);
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
  await page.getByTestId('settings-close').click();
  await expect.poll(async () => (await colors()).bg).toBe('rgb(39, 40, 34)'); // --mm-bg
  await expect.poll(async () => (await colors()).fg).toBe('rgb(165, 159, 133)'); // --mm-fg-muted
  expect(await activeBg()).toBe('rgba(0, 0, 0, 0)');
});

// --- PRD 011 Reqs 4/6/7/9/10: the LLM providers area -------------------------
// Every request here runs against src/lib/llmFake.ts, wired into the desktop
// shim as its `llmTransport` (PRD 011 Req 35) — no real provider is contacted.

test('E226: the LLM providers tab is its own User-scope page; with nothing configured it says why, and the test action is disabled', async ({
  page,
}) => {
  await openSettings(page, 'llm');

  // Req 4: a page of its own in the tab rail, not a row on another tab.
  await expect(page.getByTestId('settings-tab-llm')).toBeVisible();
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

  // Req 4: User-scope only, following the Hotkeys precedent — the tab rail
  // offers both User-only tabs together, and the Workspace scope offers
  // neither (it is disabled here because no workspace is open).
  await expect(page.getByTestId('settings-tab-hotkeys')).toBeVisible();
  await expect(page.getByTestId('settings-scope-workspace')).toBeDisabled();
});

test('E227: configuring a provider, a curated model and a key enables Test connection, and the result is reported', async ({
  page,
}) => {
  await openSettings(page, 'llm');

  // Req 6: the curated list fills the free-text field, which stays editable.
  await page.getByTestId('llm-model-preset').selectOption('claude-opus-5');
  await expect(page.getByTestId('llm-model')).toHaveValue('claude-opus-5');
  // …and any id the provider accepts can be typed instead.
  await page.getByTestId('llm-model').fill('claude-shipped-tomorrow');
  await expect(page.getByTestId('llm-availability')).toContainText('No API key configured');

  await page.getByTestId('llm-api-key').fill('sk-e227-secret');
  await expect(page.getByTestId('llm-availability')).toContainText('Ready');

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

  await sp.getByTestId('settings-tab-llm').click();
  await sp.getByTestId('llm-model-preset').selectOption('claude-sonnet-5');
  await sp.getByTestId('llm-api-key').fill('sk-e228-secret');
  await expect(sp.getByTestId('llm-availability')).toContainText('Ready');

  // Req 10: the aux window holds no capability — the request travels to the
  // main window over the bus and the verdict comes back for it to render.
  await sp.getByTestId('llm-test').click();
  await expect(sp.getByTestId('llm-test-result')).toContainText('succeeded');

  // Req 7: no key crosses into anything the main window renders or persists
  // outside the User layer, and the settings window never shows it back.
  const rendered = await sp.getByTestId('settings-panel').innerHTML();
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
  await page.getByTestId('settings-close').click();
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
  await page.getByTestId('settings-close').click();
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
