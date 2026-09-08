/**
 * PRD 007 Req 10/11/12: the pure logic behind the hosted workspace lifecycle
 * flows — the New Workspace form's validation, the Open dialog's list/search/
 * access classification, the owner-name phrasing of a no-access message, and
 * the delete confirmation's exact-name rule. No I/O, no DOM: the components
 * in src/components/WorkspaceSwitcher.tsx and WorkspaceDangerZone.tsx are
 * thin shells over these functions, and the REST client that feeds them lives
 * in src/platform/hostedWorkspaces.ts.
 */

import { fuzzyFilter } from './fuzzy.ts';
import { buildAppPath } from './hostedPaths.ts';
import { UNIQUE_NAME_MAX_LENGTH, slugifyWorkspaceName, uniqueNameProblem } from './workspaceNames.ts';
import type { MemberEntry } from './membership.ts';
import {
  DEFAULT_EVERYONE_ROLE,
  type BuiltInRoleName,
  type CreateWorkspaceRequest,
  type WorkspaceMember,
} from './hostedWorkspace.ts';

/**
 * PRD 007 Req 11: one row of `GET /api/workspaces`. Every workspace in the
 * deployment is listed; `access` says whether the signed-in caller may open
 * this one, and `owners` names who to ask when they may not — so the dialog
 * never has to attempt a forbidden read to find out which case it is in.
 */
export interface WorkspaceListing {
  id: string;
  name: string;
  /**
   * PRD 020 Req 5: the deployment-unique name the workspace's canonical path
   * URL is built from. The row rides through the PRD 017 Req 11 listing
   * policy, so a caller only ever learns the names of workspaces the policy
   * lists to them; absent only on a pre-migration manifest.
   */
  uniqueName?: string;
  /**
   * PRD 024 Req 5: the unique names this workspace has given up (empty when
   * none) — the manifest history of Req 1, carried on the row so later slices
   * can resolve a link under an old name without a second request. It rides
   * the same row, and therefore the same PRD 017 Req 11 listing policy and
   * PRD 019 Req 8 scratchpad filter, as `uniqueName` above.
   */
  formerNames: string[];
  created: string;
  modified: string;
  owners: string[];
  access: boolean;
  /**
   * PRD 019 Req 8: present (true) only on the caller's own scratchpad row —
   * the server never lists anyone else's scratchpad at all. Drives the Open
   * dialog's "My scratchpad" badge, and Req 9's hidden delete affordance.
   */
  scratchpad?: true;
}

/** PRD 007 Req 10: the New Workspace form's state, exactly as the user sees it. */
export interface NewWorkspaceForm {
  /**
   * PRD 020 Req 2 (amended by PRD 026 Req 4+6): the deployment-unique URL
   * name — required, and second in the dialog since PRD 026 put the display
   * name first. Holds the as-typed value, so it may still carry Req 6's one
   * trailing dash until blur or submit settles it.
   */
  uniqueName: string;
  /**
   * PRD 020 Req 2 (amended by PRD 026 Req 4): the friendly display name —
   * free text, required, leads the dialog, and travels trimmed as the
   * manifest `name`.
   */
  name: string;
  members: WorkspaceMember[];
  everyoneEnabled: boolean;
  /** The default role everyone-access grants; Viewer per PRD 007 Req 16. */
  everyoneRole: string;
}

/**
 * The roles the create flow offers for an initial grant: the built-ins minus
 * Owner (the creator's own role, not something the form hands out). Typed
 * against `BuiltInRoleName`, so a name that stops being a built-in stops
 * compiling here rather than becoming a 400 at create time.
 */
export const GRANTABLE_ROLES: readonly BuiltInRoleName[] = ['Editor', 'Contributor', 'Commenter', 'Viewer'];

/**
 * PRD 007 Req 10: the role a freshly picked initial member starts at — the
 * least-privileged grant, raised per member by the row's role select. Distinct
 * from `DEFAULT_EVERYONE_ROLE` (Req 16) even though both start at Viewer.
 */
export const DEFAULT_MEMBER_ROLE: BuiltInRoleName = 'Viewer';

export function emptyNewWorkspaceForm(): NewWorkspaceForm {
  return { uniqueName: '', name: '', members: [], everyoneEnabled: false, everyoneRole: DEFAULT_EVERYONE_ROLE };
}

export type NewWorkspaceResult =
  | { ok: true; request: CreateWorkspaceRequest }
  | { ok: false; error: string };

/** PRD 026 Req 4: the refusal an empty (after trimming) display name earns at submit. */
export const DISPLAY_NAME_REQUIRED = 'A display name is required.';

/** PRD 026 Req 6: the refusal an empty (after settling) URL name earns at submit. */
export const URL_NAME_REQUIRED = 'A URL name is required.';

/**
 * PRD 026 Req 6: the typing normaliser for the URL-name field — every
 * `onChange` value passes through here before it reaches state, so the field
 * never displays a value outside Req 1's charset (`Foo Bar`→`foo-bar`,
 * `foo--bar`→`foo-bar`, `Team_Docs`→`team-docs`). It is the shared slugifier
 * plus ONE trailing dash, kept because `foo-` is a legitimate stop on the way
 * to `foo-bar`: the dash stays when the raw text ended in a non-alphanumeric
 * (a dash, a space, a `!` — anything the slugifier would have turned into a
 * dash), the slug is non-empty (`-`→`''`, `!!!`→`''`: nothing to hang it on),
 * and the slug has room under the length limit. Blur and submit settle the
 * value through `settleUrlName`.
 */
export function normalizeUrlNameTyping(raw: string): string {
  const slug = slugifyWorkspaceName(raw);
  if (slug === '' || slug.length >= UNIQUE_NAME_MAX_LENGTH) return slug;
  return /[^a-z0-9]$/i.test(raw) ? `${slug}-` : slug;
}

/**
 * PRD 026 Req 6: the settled form of an as-typed URL name — the one trailing
 * dash `normalizeUrlNameTyping` keeps while typing comes off (`foo-`→`foo`).
 * Applied on blur and at submit; a value with no trailing dash is unchanged.
 */
export function settleUrlName(typed: string): string {
  return typed.endsWith('-') ? typed.slice(0, -1) : typed;
}

/** PRD 026 Req 7: the placeholder final segment the preview shows while the URL name is empty. */
export const URL_PREVIEW_PLACEHOLDER = '\u2026';

/**
 * PRD 026 Req 7: the live preview of the address a URL name would produce —
 * `origin` + the same `buildAppPath` the share-link primitive composes
 * (`workspaceShareUrl` in shareLinks.ts), so the preview and the copied link
 * can never disagree. An empty name previews the origin with an ellipsis
 * placeholder for the missing segment. Pure: the caller passes
 * `window.location.origin` in, so this module stays DOM-free.
 */
export function urlNamePreview(origin: string, settled: string): string {
  return settled === '' ? `${origin}/${URL_PREVIEW_PLACEHOLDER}` : `${origin}${buildAppPath(settled)}`;
}

/** PRD 026 Req 10: the settings Names section's form — the two fields plus the URL name the manifest holds. */
export interface WorkspaceNamesForm {
  /** The display-name field as typed (trimmed at save). */
  displayName: string;
  /** The URL-name field as typed (already normalised by `normalizeUrlNameTyping`, may end in one dash). */
  urlName: string;
  /** The URL name the manifest currently holds — the baseline that decides whether the field was edited. */
  storedUrlName: string;
}

export type WorkspaceNamesResult = { ok: true; name: string; uniqueName: string } | { ok: false; error: string };

/**
 * PRD 026 Req 9+10 (amending PRD 020 Req 4): validate the settings Names
 * form and shape the two names the manifest PUT carries. Pure, so the
 * section is a thin caller and the decision order is unit-tested. Stops in
 * field order, first failure wins: the display name is required (Req 10 —
 * the old "blank stores the URL name as the display" fallback is gone);
 * then the URL name, but ONLY if it differs from the stored one. An
 * unedited value travels back verbatim with no strict check — a
 * grandfathered `Team_Docs` (Req 9) stays editable in its display name,
 * because the server skips PRD 026 Req 3's strict rule for an unchanged
 * name and this client must not refuse it either. An edited value is
 * settled (Req 6 strips the one trailing dash typing may leave), required,
 * and then judged by the same strict rule the server enforces on a rename.
 */
export function validateWorkspaceNamesForm(form: WorkspaceNamesForm): WorkspaceNamesResult {
  const name = form.displayName.trim();
  if (name === '') return { ok: false, error: DISPLAY_NAME_REQUIRED };
  if (form.urlName === form.storedUrlName) return { ok: true, name, uniqueName: form.storedUrlName };
  const settled = settleUrlName(form.urlName);
  if (settled === '') return { ok: false, error: URL_NAME_REQUIRED };
  const problem = uniqueNameProblem(settled);
  if (problem) return { ok: false, error: problem };
  return { ok: true, name, uniqueName: settled };
}

/**
 * PRD 007 Req 10 + PRD 020 Req 2 (amended by PRD 026 Req 4+6): validate the
 * form and shape the POST body. Three stops, in dialog order, first failure
 * wins: the display name is required (Req 4 — it travels trimmed as the
 * manifest `name`, and the old "blank means the URL name" fallback is gone
 * from the form; the server's `buildNewWorkspaceManifest` keeps its own for
 * API callers); the URL name, settled (Req 6 strips the one trailing dash
 * typing may leave), is required; then the same pure rule the server
 * enforces (strict format, length, reserved — never trimmed, because the
 * settled charset admits no whitespace to forgive).
 */
export function validateNewWorkspaceForm(form: NewWorkspaceForm): NewWorkspaceResult {
  const friendly = form.name.trim();
  if (friendly === '') return { ok: false, error: DISPLAY_NAME_REQUIRED };
  const settled = settleUrlName(form.uniqueName);
  if (settled === '') return { ok: false, error: URL_NAME_REQUIRED };
  const problem = uniqueNameProblem(settled);
  if (problem) return { ok: false, error: problem };
  return {
    ok: true,
    request: {
      uniqueName: settled,
      name: friendly,
      members: form.members.map((m) => ({ id: m.id, role: m.role })),
      everyone: {
        enabled: form.everyoneEnabled,
        role: form.everyoneRole || DEFAULT_EVERYONE_ROLE,
      },
    },
  };
}

/** Newest first. ISO 8601 timestamps sort chronologically as plain strings. */
function newestFirst(a: WorkspaceListing, b: WorkspaceListing): number {
  if (a.modified === b.modified) return 0;
  return a.modified > b.modified ? -1 : 1;
}

/**
 * PRD 007 Req 11 (issue #312): the Open dialog's base order — the signed-in
 * user's recently USED workspaces first, in the order `recentIds` gives them
 * (the per-user recent-workspaces.json is already an MRU list: front is the
 * last opened), then every other workspace most recently MODIFIED first. Ids
 * with no row in the listing (deleted, or no longer listed) are skipped; a
 * repeated id counts at its first position. With no recency data the result
 * is exactly the newest-modified order, so every caller without ids is
 * unchanged.
 */
export function orderByRecentUse(
  items: readonly WorkspaceListing[],
  recentIds: readonly string[] = [],
): WorkspaceListing[] {
  // An id's rank is its first position; a workspace the user never opened
  // ranks behind every one they did, and equal ranks fall through to modified.
  const rank = new Map<string, number>();
  recentIds.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const rankOf = (w: WorkspaceListing): number => rank.get(w.id) ?? recentIds.length;
  return [...items].sort((a, b) => rankOf(a) - rankOf(b) || newestFirst(a, b));
}

/**
 * PRD 007 Req 11: search-as-you-type over the already-fetched list — the same
 * `fuzzyFilter` the TOC's heading search uses, so no keystroke costs a round
 * trip.
 * An empty query keeps every workspace: the caller's recently used ones first
 * (issue #312, `recentIds` most-recent-first), then most recently modified
 * first. With a query the matches rank by fuzzy score, then that same order —
 * `fuzzyFilter` is stable on input position, so pre-ordering the input is the
 * whole tie-break.
 */
export function filterWorkspaces(
  query: string,
  items: readonly WorkspaceListing[],
  recentIds: readonly string[] = [],
): WorkspaceListing[] {
  return fuzzyFilter(query, orderByRecentUse(items, recentIds), (w) => w.name);
}

/**
 * PRD 007 Req 10/11 (issue #252): how many rows the Open Workspace dialog
 * shows. Five — the list area is a fixed height sized for exactly this many,
 * so the dialog opens at its final size and never grows a scrollbar. The
 * number lives here, next to the seam that applies it, so the stylesheet's
 * reserved height and the rendered row count are traceable to one source.
 */
export const OPEN_WORKSPACE_ROW_CAP = 5;

/**
 * PRD 007 Req 10/11 (issue #252): the rows the Open Workspace dialog actually
 * renders — the filtered listing (whole deployment, search-as-you-type) cut to
 * OPEN_WORKSPACE_ROW_CAP. With no query that is the caller's most recently
 * used workspaces (PRD 007 Req 11, issue #312: `recentIds` most-recent-first)
 * followed by the most recently modified few — the cap is applied AFTER the
 * ordering, so a workspace the user opens daily is never hidden behind five
 * that other people edited; with a query it is the best matches, recent use
 * then modified breaking ties, so a search never changes the dialog's height.
 * Kept apart from `filterWorkspaces`, which still answers the complete
 * filtered list.
 */
export function visibleWorkspaces(
  query: string,
  items: readonly WorkspaceListing[],
  recentIds: readonly string[] = [],
): WorkspaceListing[] {
  return filterWorkspaces(query, items, recentIds).slice(0, OPEN_WORKSPACE_ROW_CAP);
}

/**
 * PRD 007 Req 11: the owners of an inaccessible workspace, phrased for the
 * message. Display names when the directory resolves them, the plain
 * identifier when it does not (`resolveMembers` marks those unresolved), and
 * an Oxford-free "a and b" / "a, b and c" join.
 */
export function formatOwnerNames(owners: readonly MemberEntry[]): string {
  const names = owners.map((o) => (o.resolved ? o.displayName : o.id));
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * PRD 007 Req 11: the in-dialog message for a workspace the signed-in user
 * cannot open. It names the workspace and its Owners; with no owner at all to
 * name (a workspace whose members have all left the tenant) it still says
 * what happened rather than showing an empty "ask ." sentence.
 */
export function noAccessMessage(workspaceName: string, owners: readonly MemberEntry[]): string {
  const names = formatOwnerNames(owners);
  return names
    ? `You don't have access to "${workspaceName}". Ask ${names} for access.`
    : `You don't have access to "${workspaceName}", and it has no owner to ask.`;
}

/**
 * PRD 019 Req 8 + PRD 020 Req 10 (issue #244): the Open dialog's badge for
 * one listing row — the feature's user-facing name, "My scratchpad", on the
 * caller's own scratchpad workspace, nothing on every other row. Extracted so
 * the labeling rule is unit-testable apart from the dialog's DOM.
 */
export function workspaceRowBadge(row: WorkspaceListing): string | null {
  return row.scratchpad ? 'My scratchpad' : null;
}

/**
 * PRD 019 Req 9: whether Workspace settings offers the delete section at all.
 * The caller must hold `workspace.delete` AND the workspace must not be their
 * scratchpad — the server refuses that delete anyway (it would only be
 * silently recreated), so the affordance is not shown even to its Owner.
 */
export function deleteOffered(
  row: Pick<WorkspaceListing, 'scratchpad'> | undefined,
  permissions: readonly string[],
): boolean {
  return permissions.includes('workspace.delete') && !row?.scratchpad;
}

/**
 * PRD 007 Req 12: the delete gate. The typed text must be the workspace's
 * name EXACTLY — no trimming, no case folding. A near-miss is the whole point
 * of the control: it must not quietly pass because the user pasted a trailing
 * space onto the wrong name.
 */
export function deleteConfirmationMatches(typed: string, workspaceName: string): boolean {
  return typed === workspaceName;
}

/**
 * Issue #245: is a failed create the unique name's fault? The New Workspace
 * dialog paints the name field and its typed value in the error colour only
 * when the answer is yes — a permission or network refusal still shows its
 * message, but the name the user typed is not what went wrong.
 *
 * Four shapes count, all of them phrasings this deployment's own unique-name
 * rules produce: the server's collision refusal (`uniqueNameTakenError` in
 * server/workspaces.ts, the one check that needs deployment state), the
 * format/length refusals from `uniqueNameFormatProblem`, the reserved-word
 * refusal — those two shared verbatim by client and server through
 * lib/workspaceNames.ts — and PRD 026 Req 6+8's empty-URL-name refusal from
 * this module's own validation. The display-name refusal (Req 4) is NOT the
 * URL name's fault: that field paints itself (Req 8). The unit tests feed
 * real `uniqueNameProblem` output in, so a reworded rule fails there rather
 * than silently stopping matching.
 */
export function isUniqueNameError(message: string): boolean {
  return (
    message === URL_NAME_REQUIRED ||
    /^The unique name .+ is already taken\.$/.test(message) ||
    /^A unique name /.test(message) ||
    /^".*" is a reserved name\.$/.test(message)
  );
}
