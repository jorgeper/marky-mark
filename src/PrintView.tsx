import { useEffect, useRef } from 'react';
import { getPlatform } from './platform';

/**
 * SPEC17 §3: the printview window's root. A throwaway page: announce
 * readiness on the aux bus, receive the standalone print HTML, render it,
 * invoke the webview's native print (macOS: PDF ▾ / Save as PDF), then
 * close. Holds no state and never touches the filesystem.
 */
export function PrintView() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | null = null;
    void (async () => {
      const p = await getPlatform();
      if (disposed || !p.busListen || !p.busEmit) return;
      off = await p.busListen('mm://print-doc', (payload) => {
        const host = hostRef.current;
        if (!host || typeof payload !== 'string') return;
        // The payload is a complete standalone document; render its body and
        // adopt its styles inside this window.
        const parsed = new DOMParser().parseFromString(payload, 'text/html');
        document.title = parsed.title || 'Print';
        host.innerHTML = '';
        parsed.querySelectorAll('style').forEach((s) => host.appendChild(s.cloneNode(true)));
        Array.from(parsed.body.children).forEach((el) => host.appendChild(el.cloneNode(true)));
        // Give the webview a frame to lay out, then print and leave —
        // the REAL native print via the Rust print_view command (SPEC18 §2;
        // window.print() is a silent no-op in WKWebView).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void (async () => {
              try {
                await p.printPage?.();
              } finally {
                setTimeout(() => void p.closeNow(), 400);
              }
            })();
          });
        });
      });
      await p.busEmit('mm://print-ready', {});
    })();
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  return <div ref={hostRef} data-testid="print-host" />;
}
