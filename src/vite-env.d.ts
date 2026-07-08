/// <reference types="vite/client" />

/**
 * Build-time app version (SPEC10 §2): injected by `define` in vite.config.ts,
 * vite.web.config.ts, and vitest.config.ts from package.json — the single
 * source of truth. The pre-release identifier is never stripped.
 */
declare const __APP_VERSION__: string;
