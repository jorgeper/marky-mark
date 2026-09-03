/**
 * PRD 020 Reqs 14–17 (issue #222): the copy-link affordance's logic layer —
 * which URL each placement copies, and the confirmation timing contract —
 * kept pure so both are unit-testable without a DOM. The React shell
 * (`components/CopyLinkButton.tsx`) is glue over this module, the same
 * split `lib/codeCopy.ts` gives the code-block copy button.
 *
 * Scope note: this module never emits a `#fragment` — heading share is
 * PRD 020 Req 18, a later issue.
 */
import { buildAppPath, parseAppPath } from './hostedPaths';

/** PRD 020 Req 14: the control's rest tooltip and accessible name. */
export const COPY_LINK_LABEL = 'Copy link';
/** PRD 020 Req 14: the inline confirmation the control transforms into. */
export const LINK_COPIED_LABEL = 'Link copied';
/** PRD 020 Req 14: how long the confirmation shows (~2s) before reverting. */
export const LINK_COPIED_MS = 2000;

/**
 * PRD 020 Req 16: the workspace share URL — absolute (origin included) and
 * canonical. Derived from the canonical address bar: Req 6 keeps
 * `location.pathname` on the Req 5 form, so the workspace is the path's
 * first segment, re-encoded through `buildAppPath` so the copied text is
 * byte-identical to what a fresh visit would canonicalize to. Null when the
 * page is not on a workspace path (start page, scratchpad entry route, or a
 * pre-migration workspace the bar cannot name) — the caller copies nothing.
 */
export function workspaceShareUrl(origin: string, pathname: string): string | null {
  const target = parseAppPath(pathname);
  return target.kind === 'workspace' ? `${origin}${buildAppPath(target.name)}` : null;
}

/**
 * PRD 020 Req 17: the open file's share URL — the whole canonical pathname
 * the bar shows (Req 6 tracks the active file), origin included, every
 * segment percent-encoded, never a `#fragment`. Null while no file rides
 * the path (workspace-only URL, or off any workspace path at all).
 */
export function fileShareUrl(origin: string, pathname: string): string | null {
  const target = parseAppPath(pathname);
  return target.kind === 'workspace' && target.file.length > 0
    ? `${origin}${buildAppPath(target.name, target.file)}`
    : null;
}

/**
 * PRD 020 Req 14: the one confirmation contract, shared by every placement
 * (the `createCopyButton` precedent in `lib/codeCopy.ts`): a click reads its
 * URL at click time, copies it, and only a landed write turns the
 * confirmation on — for LINK_COPIED_MS, then off; a rejected write or a
 * null URL says nothing rather than lying. A re-click while confirming
 * restarts the window. `dispose` cancels the pending revert so an unmounted
 * control never flips state afterwards.
 */
export function createCopyLinkController(
  getUrl: () => string | null,
  copy: (text: string) => Promise<boolean> | boolean,
  setCopied: (on: boolean) => void,
): { click(): Promise<void>; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    async click() {
      const url = getUrl();
      if (url === null) return;
      const ok = await copy(url);
      if (!ok) return;
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}
