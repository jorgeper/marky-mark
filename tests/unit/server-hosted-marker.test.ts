import { describe, expect, it } from 'vitest';
import { injectHostedMarker } from '../../server/app';
import { detectHostedMode, HOSTED_META_NAME } from '../../src/lib/hostedGate';

// PRD 007 Req 5: the serve-time marker that tells the unmodified SPA build it
// is being served by the hosted backend (and in which mode).
describe('PRD 007 Req 5 hosted HTML marker', () => {
  const HTML = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>';

  it('U240: the marker lands inside <head> and names the server mode', () => {
    const local = injectHostedMarker(HTML, 'local');
    expect(local).toContain(`<meta name="${HOSTED_META_NAME}" content="local"></head>`);
    const azure = injectHostedMarker(HTML, 'azure');
    expect(azure).toContain(`<meta name="${HOSTED_META_NAME}" content="azure"></head>`);
    // Everything else about the document is untouched.
    expect(local.replace(`<meta name="${HOSTED_META_NAME}" content="local">`, '')).toBe(HTML);
  });

  it('U241: headless HTML still gets a marker, and the marker name matches what the SPA detects', () => {
    // No </head> (defensive: dist/index.html always has one) — the marker is
    // prepended so the browser still hoists it into head.
    const marked = injectHostedMarker('<body>x</body>', 'local');
    expect(marked.startsWith(`<meta name="${HOSTED_META_NAME}" content="local">`)).toBe(true);
    // The injected name is the exact selector the SPA's gate looks for —
    // a rename on either side breaks sign-in silently, so pin them together.
    const doc = {
      querySelector: (sel: string) =>
        sel === `meta[name="${HOSTED_META_NAME}"]` ? { getAttribute: () => 'azure' } : null,
    };
    expect(detectHostedMode(doc)).toBe('azure');
  });
});
