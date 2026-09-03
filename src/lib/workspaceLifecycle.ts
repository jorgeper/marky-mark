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
import { uniqueNameProblem } from './workspaceNames.ts';
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
  /** PRD 020 Req 2: the deployment-unique name, chosen up front (required). */
  uniqueName: string;
  /** PRD 020 Req 2: the optional friendly display name (free text). */
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

/**
 * PRD 007 Req 10 + PRD 020 Req 2: validate the form and shape the POST body.
 * The unique name is the hard stop — the same pure rule the server enforces
 * (format, length, reserved), never trimmed because its charset admits no
 * whitespace to forgive. The friendly display name is optional and travels
 * trimmed; blank means the unique name is the display, stored as the manifest
 * `name` so every existing chrome surface keeps rendering it.
 */
export function validateNewWorkspaceForm(form: NewWorkspaceForm): NewWorkspaceResult {
  const problem = uniqueNameProblem(form.uniqueName);
  if (problem) return { ok: false, error: problem };
  const friendly = form.name.trim();
  return {
    ok: true,
    request: {
      uniqueName: form.uniqueName,
      name: friendly || form.uniqueName,
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
 * PRD 007 Req 11: search-as-you-type over the already-fetched list — the same
 * fuzzy matcher the heading palette uses, so no keystroke costs a round trip.
 * An empty query keeps every workspace, most recently modified first.
 */
export function filterWorkspaces(query: string, items: readonly WorkspaceListing[]): WorkspaceListing[] {
  return fuzzyFilter(query, [...items].sort(newestFirst), (w) => w.name);
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
 * PRD 019 Req 8: the Open dialog's badge for one listing row — the personal
 * label on the caller's own scratchpad, nothing on every other row. Extracted
 * so the labeling rule is unit-testable apart from the dialog's DOM.
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
