import { useEffect, useState } from 'react';
import { getPlatform, type Platform } from './platform';
import {
  buildAuxInit,
  EV_AUX_INIT,
  EV_AUX_READY,
  EV_AUX_REQUEST,
  EV_LLM_TEST_RESULT,
  EV_SETTINGS_CHANGED,
  EV_SETTINGS_EDIT,
  EV_THEMES_CHANGED,
  sanitizeLlmTestResult,
  type AuxInit,
  type AuxKind,
  type AuxRequest,
  type SettingsBroadcast,
  type SettingsEdit,
} from './lib/auxProtocol';
import type { LlmTestResult } from './lib/llmSettings';
import type { Theme } from './lib/themes';
import { applyThemeCss } from './themeRuntime';
import { SettingsPanel } from './components/SettingsPanel';
import { AboutDialog } from './components/AboutDialog';

/**
 * SPEC13 §1–§3: the aux-window root. A dumb view — no filesystem, no
 * authoritative state. Handshakes mm://aux-ready → mm://aux-init, renders
 * nothing until init arrives, edits go up as whole-Settings events, and
 * canonical broadcasts come back down. Esc and Mod+W close the window
 * (macOS ⌘W also arrives via the native accelerator → main's close command
 * → closeFocusedAuxWindow; both paths are idempotent).
 */
export function AuxWindow({ kind }: { kind: AuxKind }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [init, setInit] = useState<AuxInit | null>(null);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];
    void (async () => {
      const p = await getPlatform();
      if (disposed || !p.busEmit || !p.busListen) return;
      setPlatform(p);
      offs.push(await p.busListen(EV_AUX_INIT, (payload) => setInit(buildAuxInit(payload as AuxInit))));
      offs.push(
        await p.busListen(EV_SETTINGS_CHANGED, (payload) =>
          setInit((i) => (i ? { ...i, ...(payload as SettingsBroadcast) } : i))
        )
      );
      offs.push(
        await p.busListen(EV_THEMES_CHANGED, (payload) =>
          setInit((i) => (i ? { ...i, themes: payload as Theme[] } : i))
        )
      );
      await p.busEmit(EV_AUX_READY, { kind });
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [kind]);

  // Esc / Mod+W close the window (SPEC13 §1.3) — but never while the
  // hotkey recorder input is capturing a combo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder]')) return;
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w')) {
        e.preventDefault();
        void platform?.closeNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform]);

  // OS light/dark tracking + theming, mirroring App (SPEC13 §1.4).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!init || init.themes.length === 0) return;
    const s = init.settings;
    const wanted = prefersDark && s.useDarkTheme ? s.themeDark : s.themeLight;
    const theme =
      init.themes.find((t) => t.id === wanted) ?? init.themes.find((t) => t.id === 'crisp') ?? init.themes[0];
    applyThemeCss(theme.css);
  }, [init, prefersDark]);

  if (!platform || !init) return <div className="theme-root aux-root" />;

  const request = (r: AuxRequest) => void platform.busEmit!(EV_AUX_REQUEST, r);
  const close = () => void platform.closeNow();

  /**
   * PRD 011 Req 10: the desktop round trip. This window holds no LLM
   * capability — it never calls `runLlmRequest`, never reads
   * `platform.llmTransport` and never invokes an IPC command. It asks the main
   * window over the existing bus and renders whatever comes back, which is the
   * seam's already-redacted verdict and carries no key material.
   */
  const testLlm = (): Promise<LlmTestResult> =>
    new Promise((resolve) => {
      let off: (() => void) | undefined;
      let settled = false;
      void platform
        .busListen!(EV_LLM_TEST_RESULT, (payload) => {
          const result = sanitizeLlmTestResult(payload);
          if (!result || settled) return;
          settled = true;
          off?.();
          resolve(result);
        })
        .then((dispose) => {
          off = dispose;
          if (settled) dispose();
          // Emitted only once the listener is attached, so a main window that
          // answers immediately cannot beat us to it.
          else request({ req: 'llmTestConnection' });
        });
    });

  return (
    <div
      className="theme-root aux-root"
      style={init.settings.fontSize === 'auto' ? undefined : { ['--mm-font-size' as string]: `${init.settings.fontSize}px` }}
    >
      {kind === 'settings' ? (
        <SettingsPanel
          frameless
          settings={init.settings}
          layers={init.layers}
          workspaceOpen={init.workspaceOpen}
          scopeSelector
          themes={init.themes}
          isMac={init.isMac}
          storageLocked={false}
          autoHideAvailable={false}
          onEdit={(scope, patch) => {
            // §E18: only the changed keys travel, tagged with the target
            // layer; the main window persists and echoes the canonical state.
            const edit: SettingsEdit = { scope, patch };
            void platform.busEmit!(EV_SETTINGS_EDIT, edit);
          }}
          llmCapabilities={init.llm}
          onLlmTest={testLlm}
          onReloadThemes={() => request({ req: 'reloadThemes' })}
          onRevealThemesDir={() => request({ req: 'revealThemesDir' })}
          onClose={close}
        />
      ) : (
        <AboutDialog frameless onClose={close} onOpenUrl={(url) => request({ req: 'openExternal', url })} />
      )}
    </div>
  );
}
