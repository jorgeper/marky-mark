// PRD 026 Req 7: the two always-visible caption lines beneath a URL-name
// field — the one-sentence rule and the live address preview. One component,
// mounted by the New Workspace dialog (issue #352) and, with a different
// test-id prefix, by the settings Names section (issue #353), so the sentence,
// the preview composition and the muted treatment cannot drift between them.
// It is a pure view over its props: the caller settles the value and supplies
// `window.location.origin`, and the preview string itself comes from
// lib/workspaceLifecycle.ts so it is unit-tested without a DOM.

import { urlNamePreview } from '../lib/workspaceLifecycle';

/** PRD 026 Req 7: the exact guidance sentence, asserted verbatim by the e2e tests. */
export const URL_NAME_GUIDANCE = "Lowercase letters, numbers and dashes. This is the workspace's address.";

export function UrlNameGuidance({
  origin,
  urlName,
  testIdPrefix,
}: {
  /** `window.location.origin`, passed in so the preview matches the share-link primitive's origin. */
  origin: string;
  /** The settled URL name (trailing dash already stripped); empty shows the `…` placeholder. */
  urlName: string;
  /** The mounting surface's test-id prefix: `<prefix>-url-guidance` and `<prefix>-url-preview`. */
  testIdPrefix: string;
}) {
  return (
    <>
      <p className="url-name-guidance" data-testid={`${testIdPrefix}-url-guidance`}>
        {URL_NAME_GUIDANCE}
      </p>
      <p className="url-name-guidance" data-testid={`${testIdPrefix}-url-preview`}>
        {urlNamePreview(origin, urlName)}
      </p>
    </>
  );
}
