/**
 * PRD 007 Req 10/11/12: the pure logic behind the hosted workspace lifecycle
 * flows — the New Workspace form's validation, the Open dialog's list/search/
 * access classification, the owner-name phrasing of a no-access message, and
 * the delete confirmation's exact-name rule. No I/O, no DOM: the components
 * in src/components/WorkspaceSwitcher.tsx and WorkspaceDangerZone.tsx are
 * thin shells over these functions, and the REST client that feeds them lives
 * in src/platform/hostedWorkspaces.ts.
 */

import { fuzzyFilter } from './fuzzy';
import type { MemberEntry } from './membership';
import {
  DEFAULT_EVERYONE_ROLE,
  type BuiltInRoleName,
  type CreateWorkspaceRequest,
  type WorkspaceMember,
} from './hostedWorkspace';

/**
 * PRD 007 Req 11: one row of `GET /api/workspaces`. Every workspace in the
 * deployment is listed; `access` says whether the signed-in caller may open
 * this one, and `owners` names who to ask when they may not — so the dialog
 * never has to attempt a forbidden read to find out which case it is in.
 */
export interface WorkspaceListing {
  id: string;
  name: string;
  created: string;
  modified: string;
  owners: string[];
  access: boolean;
  /**
   * PRD 010 Req 18: present only when this workspace's backend could not be
   * reached — the named, actionable reason, so a repo-backed workspace whose
   * connection broke is listed as needing attention instead of silently
   * vanishing from the dialog. Absent on every healthy row.
   */
  attention?: string;
  /**
   * PRD 010 Req 21: true when deleting in this workspace leaves the content
   * in the backing repository's history. Server-supplied on the listing —
   * which is pre-permission, so every member who can delete has it without
   * `workspace.settings` and without a GitHub round trip per prompt.
   *
   * PRD 010 Req 3 survives it: it says what a delete MEANS, never which
   * backend a default-storage workspace sits on. Absent (an older server, an
   * unreachable backend) reads as `false` — the stricter promise.
   */
  retainsHistory?: boolean;
}

/** PRD 007 Req 10: the New Workspace form's state, exactly as the user sees it. */
export interface NewWorkspaceForm {
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
  return { name: '', members: [], everyoneEnabled: false, everyoneRole: DEFAULT_EVERYONE_ROLE };
}

export type NewWorkspaceResult =
  | { ok: true; request: CreateWorkspaceRequest }
  | { ok: false; error: string };

/**
 * PRD 007 Req 10: validate the form and shape the POST body. A blank or
 * whitespace-only name is the one hard stop (the server trims and rejects the
 * same way); everything else is already constrained by the controls. The name
 * travels trimmed, so "  Docs  " and "Docs" create the same workspace name.
 */
export function validateNewWorkspaceForm(form: NewWorkspaceForm): NewWorkspaceResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: 'Enter a name for the workspace.' };
  return {
    ok: true,
    request: {
      name,
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
 * PRD 007 Req 12: the delete gate. The typed text must be the workspace's
 * name EXACTLY — no trimming, no case folding. A near-miss is the whole point
 * of the control: it must not quietly pass because the user pasted a trailing
 * space onto the wrong name.
 */
export function deleteConfirmationMatches(typed: string, workspaceName: string): boolean {
  return typed === workspaceName;
}
