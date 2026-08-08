import { describe, expect, test } from 'vitest';
import {
  buildAuxInit,
  sanitizeAuxRequest,
  sanitizeLlmTestResult,
  sanitizeSettingsEdit,
  sanitizeSummaryCacheClearResult,
  sanitizeSummaryCacheSizeResult,
} from '../../src/lib/auxProtocol';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import type { Theme } from '../../src/lib/themes';

const theme: Theme = { id: 'crisp', name: 'Crisp', author: 'mm', variant: 'light', builtin: true, css: '.theme-root{}' };

describe('SPEC13 aux protocol', () => {
  test('U23: buildAuxInit carries settings, layers, workspace state, themes, isMac, and version', () => {
    const layers = { workspace: { themeLight: 'monokai' }, user: { zoom: 125 } };
    const init = buildAuxInit({
      settings: DEFAULT_SETTINGS,
      layers,
      workspaceOpen: true,
      themes: [theme],
      isMac: true,
      version: '9.9.9',
      llm: { transport: false, hosted: null },
      // PRD 011 Req 30: the cache capability travels beside `llm`.
      summaryCache: false,
    });
    expect(init.settings).toEqual(DEFAULT_SETTINGS);
    expect(init.layers).toEqual(layers);
    expect(init.workspaceOpen).toBe(true);
    expect(init.themes).toEqual([theme]);
    expect(init.isMac).toBe(true);
    expect(init.version).toBe('9.9.9');
  });

  test('U24: sanitizeSettingsEdit keeps known editable keys and drops panel-unedited ones', () => {
    // splitRatio belongs to the main window's split drag — a panel edit
    // must never carry it (PRD 002 §E18 + SPEC13 §3.5).
    const e = sanitizeSettingsEdit({ scope: 'user', patch: { zoom: 125, splitRatio: 0.5, bogus: 1 } });
    expect(e).toEqual({ scope: 'user', patch: { zoom: 125 } });
  });

  test('U24b: a workspace-scoped edit is limited to workspace-eligible keys', () => {
    // Issue #21: any U key (vimNav included) may land as a workspace default,
    // but author (U!), splitEdit (M), and hotkeys never travel to the
    // shareable workspace layer through the panel.
    const e = sanitizeSettingsEdit({
      scope: 'workspace',
      patch: { commentStorage: 'embedded', themeLight: 'monokai', author: 'Eve', vimNav: true, splitEdit: false, hotkeys: {} },
    });
    expect(e).toEqual({
      scope: 'workspace',
      patch: { commentStorage: 'embedded', themeLight: 'monokai', vimNav: true },
    });
  });

  test('U24c: malformed edits sanitize to null', () => {
    expect(sanitizeSettingsEdit(null)).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'global', patch: { zoom: 125 } })).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'user', patch: null })).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'user', patch: { splitRatio: 0.5 } })).toBeNull();
    expect(sanitizeSettingsEdit({ scope: 'workspace', patch: { author: 'Eve' } })).toBeNull();
  });

  test('U574: PRD 011 Req 7 — a workspace-scoped patch carrying llmApiKey is dropped entirely', () => {
    // The key cannot be written into a `.marky-workspace` file, so it cannot
    // be committed or shared by opening a workspace. Neither can the provider,
    // model or base URL that reach it.
    expect(
      sanitizeSettingsEdit({
        scope: 'workspace',
        patch: { llmApiKey: 'sk-secret', llmProvider: 'openai', llmModel: 'gpt-5', llmBaseUrl: 'https://x/v1' },
      })
    ).toBeNull();
    // A workspace patch that also carries an eligible key keeps only that one.
    expect(sanitizeSettingsEdit({ scope: 'workspace', patch: { llmApiKey: 'sk-secret', vimNav: true } })).toEqual({
      scope: 'workspace',
      patch: { vimNav: true },
    });
    // The User layer is where they belong, and there they travel.
    expect(sanitizeSettingsEdit({ scope: 'user', patch: { llmApiKey: 'sk-secret' } })).toEqual({
      scope: 'user',
      patch: { llmApiKey: 'sk-secret' },
    });
  });
});

describe('PRD 011 Req 10 aux test-connection round trip', () => {
  test('U575: the request and the result round-trip, and malformed payloads are refused', () => {
    // Request: carries no configuration and no credential — the main window
    // already owns the settings.
    expect(sanitizeAuxRequest({ req: 'llmTestConnection' })).toEqual({ req: 'llmTestConnection' });
    expect(sanitizeAuxRequest({ req: 'llmTestConnection', apiKey: 'sk-secret' })).toEqual({
      req: 'llmTestConnection',
    });
    // Its neighbours still round-trip through the same validator.
    expect(sanitizeAuxRequest({ req: 'reloadThemes' })).toEqual({ req: 'reloadThemes' });
    expect(sanitizeAuxRequest({ req: 'revealThemesDir' })).toEqual({ req: 'revealThemesDir' });
    expect(sanitizeAuxRequest({ req: 'openExternal', url: 'https://example.com' })).toEqual({
      req: 'openExternal',
      url: 'https://example.com',
    });
    // Refused rather than trusted.
    expect(sanitizeAuxRequest(null)).toBeNull();
    expect(sanitizeAuxRequest('llmTestConnection')).toBeNull();
    expect(sanitizeAuxRequest({ req: 'rmRf' })).toBeNull();
    expect(sanitizeAuxRequest({ req: 'openExternal' })).toBeNull();

    // Result: the seam's verdict, narrowed. Success carries nothing else.
    expect(sanitizeLlmTestResult({ ok: true })).toEqual({ ok: true });
    expect(sanitizeLlmTestResult({ ok: true, text: 'chatty', apiKey: 'sk-secret' })).toEqual({ ok: true });
    expect(
      sanitizeLlmTestResult({ ok: false, failure: { kind: 'rate-limited', message: 'slow down', retryAfterSeconds: 5 } })
    ).toEqual({ ok: false, failure: { kind: 'rate-limited', message: 'slow down', retryAfterSeconds: 5 } });
    // A failure with an unknown kind, no sentence, or no failure at all is refused.
    expect(sanitizeLlmTestResult({ ok: false })).toBeNull();
    expect(sanitizeLlmTestResult({ ok: false, failure: { kind: 'meltdown', message: 'x' } })).toBeNull();
    expect(sanitizeLlmTestResult({ ok: false, failure: { kind: 'bad-key', message: '' } })).toBeNull();
    expect(sanitizeLlmTestResult({ ok: 'yes' })).toBeNull();
    expect(sanitizeLlmTestResult(null)).toBeNull();
  });
});

describe('PRD 011 Req 30 the summary cache round trip', () => {
  test('U629: the two stand-down requests cross the bus and carry nothing with them', () => {
    expect(sanitizeAuxRequest({ req: 'summaryCacheSize' })).toEqual({ req: 'summaryCacheSize' });
    expect(sanitizeAuxRequest({ req: 'summaryCacheClear' })).toEqual({ req: 'summaryCacheClear' });
    // A hostile extra payload is dropped: the main window owns the store and
    // resolves the workspace itself, so nothing a sender attached is honoured.
    expect(sanitizeAuxRequest({ req: 'summaryCacheClear', workspaceId: 'someone-else', apiKey: 'sk-secret' })).toEqual({
      req: 'summaryCacheClear',
    });
    expect(sanitizeAuxRequest({ req: 'summaryCacheWipe' })).toBeNull();
  });

  test('U630: a size result is accepted only in the real shape, never invented', () => {
    expect(sanitizeSummaryCacheSizeResult({ ok: true, size: { bytes: 34_500, entries: 12 } })).toEqual({
      ok: true,
      size: { bytes: 34_500, entries: 12 },
    });
    // Only the two fields the report uses travel; extras ride nowhere.
    expect(
      sanitizeSummaryCacheSizeResult({ ok: true, size: { bytes: 1, entries: 1, summaries: ['secret'] } })
    ).toEqual({ ok: true, size: { bytes: 1, entries: 1 } });
    expect(sanitizeSummaryCacheSizeResult({ ok: false, message: 'could not read it' })).toEqual({
      ok: false,
      message: 'could not read it',
    });
    // Junk: wrong type, missing field, impossible count, no payload at all.
    expect(sanitizeSummaryCacheSizeResult({ ok: true })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult({ ok: true, size: { bytes: '34kb', entries: 12 } })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult({ ok: true, size: { bytes: 1 } })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult({ ok: true, size: { bytes: -1, entries: 1 } })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult({ ok: true, size: { bytes: Number.NaN, entries: 1 } })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult({ ok: false })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult({ ok: 'yes' })).toBeNull();
    expect(sanitizeSummaryCacheSizeResult(null)).toBeNull();
    expect(sanitizeSummaryCacheSizeResult('12 summaries')).toBeNull();
  });

  test('U631: a clear verdict without a reason is refused rather than read as a success', () => {
    expect(sanitizeSummaryCacheClearResult({ ok: true })).toEqual({ ok: true });
    expect(sanitizeSummaryCacheClearResult({ ok: true, entries: 3 })).toEqual({ ok: true });
    expect(sanitizeSummaryCacheClearResult({ ok: false, message: 'not cleared' })).toEqual({
      ok: false,
      message: 'not cleared',
    });
    expect(sanitizeSummaryCacheClearResult({ ok: false })).toBeNull();
    expect(sanitizeSummaryCacheClearResult({ ok: false, message: '' })).toBeNull();
    expect(sanitizeSummaryCacheClearResult({ cleared: true })).toBeNull();
    expect(sanitizeSummaryCacheClearResult(null)).toBeNull();
  });
});
