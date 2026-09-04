/**
 * PRD 020 Req 14 (issue #222): the copy-link confirmation contract and the
 * labels shared by every placement, kept as a pure module with no app
 * imports. PRD 021 Req 5 (issue #236) moved it here out of `shareLinks.ts`
 * so the editor subtree (`headingLinks.ts`, `components/Editor.tsx`) can use
 * the controller without reaching the app's hosted-URL modules
 * (`shareLinks → hostedPaths`); `shareLinks.ts` re-exports these for its
 * app-side callers, so there is exactly one definition.
 */

/** Issue #227: both heading placements' rest tooltip and accessible name. */
export const COPY_LINK_HEADING_LABEL = 'Copy link to heading';
/** PRD 020 Req 14: the inline confirmation the control transforms into. */
export const LINK_COPIED_LABEL = 'Link copied';
/** PRD 020 Req 14: how long the confirmation shows (~2s) before reverting. */
export const LINK_COPIED_MS = 2000;

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
