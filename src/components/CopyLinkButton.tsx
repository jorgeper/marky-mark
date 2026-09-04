import { useEffect, useMemo, useRef, useState } from 'react';
import { LINK_COPIED_LABEL, createCopyLinkController } from '../lib/shareLinks';
import { IconButton } from './ui/IconButton';

/**
 * PRD 020 Req 14 (issue #222): the one reusable copy-link control. Both
 * placements — the workspace's top-left cluster (Req 16) and the file's
 * top-right cluster (Req 17) — render this component and differ only in
 * where they hang it, what URL `getUrl` answers, and (issue #227) the rest
 * `label` naming that target, the `createCopyButton` house pattern. `getUrl` runs at click time so the copied text is the
 * canonical address of that moment; the contract itself (confirm only on a
 * landed write, ~2s, then revert) lives in `lib/shareLinks.ts` where it is
 * unit-tested. While confirming, the control swaps its link glyph for the
 * visible "Link copied" text — no dialog, no toast — and the always-present
 * `aria-live` region announces the same words to assistive tech.
 */
export function CopyLinkButton({
  testid,
  label,
  getUrl,
  copy,
}: {
  testid: string;
  label: string;
  getUrl(): string | null;
  copy(text: string): Promise<boolean> | boolean;
}) {
  const [copied, setCopied] = useState(false);
  // The controller is created once; the latest props are read through a ref
  // so App's inline lambdas never reset the confirmation timer mid-window.
  const props = useRef({ getUrl, copy });
  props.current = { getUrl, copy };
  const ctrl = useMemo(
    () =>
      createCopyLinkController(
        () => props.current.getUrl(),
        (text) => props.current.copy(text),
        setCopied,
      ),
    [],
  );
  useEffect(() => () => ctrl.dispose(), [ctrl]);
  return (
    <IconButton
      className={copied ? 'copy-link is-copied' : 'copy-link'}
      data-testid={testid}
      title={label}
      aria-label={copied ? LINK_COPIED_LABEL : label}
      onClick={() => void ctrl.click()}
    >
      {copied ? (
        <span className="copy-link-copied" data-testid={`${testid}-copied`} aria-hidden="true">
          {LINK_COPIED_LABEL}
        </span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-icon="link">
          <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.7 9.3l2.6-2.6" />
            <path d="M7.5 4.6l1.4-1.4a2.55 2.55 0 0 1 3.6 3.6l-1.4 1.4" />
            <path d="M8.5 11.4l-1.4 1.4a2.55 2.55 0 0 1-3.6-3.6l1.4-1.4" />
          </g>
        </svg>
      )}
      {/* PRD 020 Req 14: the live region exists at rest (a region born with
          its text is not announced) and gains/loses the confirmation. */}
      <span className="copy-link-live" aria-live="polite">
        {copied ? LINK_COPIED_LABEL : ''}
      </span>
    </IconButton>
  );
}
