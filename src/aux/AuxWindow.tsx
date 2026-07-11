import { useEffect, useRef, useState } from 'react';
import { getPlatform, type Platform } from '../platform';
import {
  buildAuxInit,
  EV_AUX_INIT,
  EV_AUX_READY,
  EV_AUX_REQUEST,
  EV_SETTINGS_CHANGED,
  EV_SETTINGS_EDIT,
  EV_THEMES_CHANGED,
  mergeSettingsEdit,
  settingsEqual,
  type AuxInit,
  type AuxKind,
  type AuxRequest,
} from '../lib/auxProtocol';
import type { Settings } from '../lib/settings';
import type { Theme } from '../lib/themes';
import { applyThemeCss } from '../themeRuntime';
import { SettingsPanel } from '../components/SettingsPanel';
import { AboutDialog } from '../components/AboutDialog';

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
  const canonicalRef = useRef<Settings | null>(null);
  canonicalRef.current = init?.settings ?? null;

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
          setInit((i) => (i ? { ...i, settings: payload as Settings } : i))
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

  return (
    <div
      className="theme-root aux-root"
      style={init.settings.fontSize === 'auto' ? undefined : { ['--mm-font-size' as string]: `${init.settings.fontSize}px` }}
    >
      {kind === 'settings' ? (
        <SettingsPanel
          frameless
          settings={init.settings}
          themes={init.themes}
          isMac={init.isMac}
          storageLocked={false}
          autoHideAvailable={false}
          onChange={(next) => {
            const canonical = canonicalRef.current ?? init.settings;
            const merged = mergeSettingsEdit(canonical, next);
            if (settingsEqual(merged, canonical)) return; // no-echo guard (§3.5)
            setInit((i) => (i ? { ...i, settings: merged } : i)); // optimistic; broadcast confirms
            void platform.busEmit!(EV_SETTINGS_EDIT, merged);
          }}
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
