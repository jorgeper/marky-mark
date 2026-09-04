/**
 * PRD 020 Reqs 14–17 (issue #222): the copy-link affordance's logic layer —
 * which URL each placement copies, and the confirmation timing contract —
 * kept pure so both are unit-testable without a DOM. The React shell
 * (`components/CopyLinkButton.tsx`) is glue over this module, the same
 * split `lib/codeCopy.ts` gives the code-block copy button.
 *
 * PRD 020 Reqs 18–19 (issue #223) add the `#fragment` half: GitHub-style
 * heading slugs derived from the section model (`sectionModel.ts` — never
 * from scraping DOM), the heading share URL that rides them, and the
 * landing-side match from a visited `#<slug>` back to a source line.
 */
import { buildAppPath, parseAppPath } from './hostedPaths';
import type { DocumentSections } from './sectionModel';

/**
 * PRD 020 Req 14 as reworded by issue #227: each placement's rest tooltip
 * and accessible name says its target — the PRD's uniform "Copy link" made
 * the three controls indistinguishable on hover. The rest of Req 14's
 * contract (icon, click-to-copy, confirmation) is unchanged.
 */
export const COPY_LINK_WORKSPACE_LABEL = 'Copy link to workspace';
/** Issue #227: the file placement's rest tooltip and accessible name. */
export const COPY_LINK_FILE_LABEL = 'Copy link to file';
/** Issue #227: both heading placements' rest tooltip and accessible name. */
export const COPY_LINK_HEADING_LABEL = 'Copy link to heading';
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
 * PRD 020 Req 18: one heading's GitHub-style slug — the text lowercased,
 * punctuation dropped (unicode letters, marks, digits and connector
 * punctuation survive, the GitHub character class), spaces turned into
 * hyphens one-for-one ("A & B" → "a--b", exactly GitHub's double hyphen).
 * Dedupe is NOT here: it needs document order, so it lives in
 * `headingAnchors` below.
 */
export function headingSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** One addressable heading: its 1-based source line and deduped slug. */
export interface HeadingAnchor {
  line: number;
  slug: string;
  title: string;
}

/**
 * PRD 020 Req 18: every heading's slug, derived from the section model's
 * all-headings list in document order — never the rendered DOM. That list
 * (issue #226) also carries headings nested inside containers (a blockquote,
 * a list item), which render as real h1–h6 and must be addressable even
 * though only root-level headings delimit sections. Duplicate slugs dedupe
 * GitHub-style: the first keeps the bare slug, later ones take `-1`, `-2`, …
 * in document order.
 */
export function headingAnchors(doc: DocumentSections): HeadingAnchor[] {
  const seen = new Map<string, number>();
  const out: HeadingAnchor[] = [];
  for (const h of doc.headings) {
    const base = headingSlug(h.title);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ line: h.line, slug: n === 0 ? base : `${base}-${n}`, title: h.title });
  }
  return out;
}

/**
 * PRD 020 Req 18: the heading share URL — the file's canonical Req 5 URL
 * plus `#<slug>`, the slug percent-encoded so the copied text is a valid URL
 * byte-for-byte (unicode slugs travel encoded, exactly as a browser would
 * re-emit them). Null when no file rides the path: a heading in an untitled
 * buffer has no address to share.
 */
export function headingShareUrl(origin: string, pathname: string, slug: string): string | null {
  const file = fileShareUrl(origin, pathname);
  return file === null ? null : `${file}#${encodeURIComponent(slug)}`;
}

/**
 * PRD 020 Req 19: the landing side's read of `location.hash` — the slug the
 * visit asked for, percent-decoded (a malformed escape falls back to the raw
 * text rather than throwing), or null when the hash is absent or empty.
 */
export function slugFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * PRD 020 Req 19: where a visited slug lands — the matching heading's source
 * line, through the same derivation the copy side used, or null when no
 * heading matches (the caller shows the renamed-section notice).
 */
export function headingLineForSlug(doc: DocumentSections, slug: string): number | null {
  return headingAnchors(doc).find((a) => a.slug === slug)?.line ?? null;
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
