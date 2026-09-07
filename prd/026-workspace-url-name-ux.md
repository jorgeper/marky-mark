# PRD 026: Workspace URL-name UX

**Status:** Draft
**Date:** 2026-09-07

Issue: #324. Amends PRD 020 Req 1–4 (unique names) and Req 12
(usernames).

## Problem

PRD 020 made the unique name a workspace's identity, and the New
Workspace dialog asks for it *first*, as a required field, with the
friendly display name relegated to an optional afterthought. So the very
first thing a user does when creating a workspace is invent a URL-safe
identifier by hand, under a charset rule (`[A-Za-z0-9._-]`) that lets
`Team_Docs`, `team.docs` and `TEAM-DOCS` all through, and learns the
rules only by tripping over red error text. That is energy spent on the
least interesting field on the form.

Every app in this space solved this the same way years ago: you type the
human name, the URL slug is derived from it live, you can edit the slug
if you care, and the slug field quietly refuses to hold anything but
lowercase letters, digits and dashes. GitHub repository names, Slack
workspace URLs, Notion domains and Vercel project names all behave like
this. This PRD adopts that model, tightens the slug rule to the
lowercase-dash form, and states the rule once, in the form, next to a
live preview of the address it produces.

**Build applicability: hosted (cloud) only.** Desktop (Tauri), dev-shim
and single-file builds have no hosted workspaces and are untouched.

## Goals

- Creating a workspace costs one decision: its display name. The URL
  name fills itself in and is right by default.
- A URL name can only ever be lowercase letters, digits and single
  dashes. The user never sees a red error for uppercase, spaces or
  punctuation because the field normalises those as they type.
- The rule and its consequence are visible in the form: one guidance
  sentence and a live preview of the resulting address.
- Names that already exist under the old charset keep working unchanged.
- Usernames, which share the URL segment and the slugifier, follow the
  same rule for users provisioned from now on.
- A collision on submit costs one click to resolve, not a retype.

## Non-goals

- **Migrating existing names.** Workspaces whose unique name carries
  uppercase, dots or underscores are grandfathered (Req 9). No upgrade
  migration rewrites them; PRD 024's former-name redirects make that a
  safe follow-up if it is ever wanted, but it is not this PRD.
- **Rewriting existing usernames.** Usernames are derived once and
  stored (PRD 020 Req 12). Stored usernames are untouched; only the
  derivation for a user seen for the first time changes (Req 11).
- **Live availability checking.** No "is this name taken?" request as
  the user types and no new endpoint for it. The listing API only
  returns names the caller is allowed to see, so a client-side check
  would be wrong for everyone but admins. Collisions surface on submit
  (Req 12) exactly as today, with a suggestion attached.
- **Auto-deriving the URL name in Settings.** In the settings Names
  section the display name never drives the URL name (Req 10). A URL
  change there is a rename with link consequences (PRD 024) and must
  stay a deliberate act.
- **Changing the length limit.** 1–100 characters stays. Nothing in
  the issue asks for it, and shortening it would strand grandfathered
  names.
- **Changing the reserved list, case-insensitive uniqueness, dedupe
  order, or the migration planner.** PRD 020 Req 1 and Req 3 stand
  apart from the charset change; `dedupeUniqueName` and
  `planUniqueNameMigration` keep their behaviour with the new slugifier
  substituted in.
- **Renaming test ids.** `new-workspace-name` (display field) and
  `new-workspace-unique-name` (URL field), and their settings-page
  counterparts, keep their ids. The fields change order and label, not
  identity.
- **Relabelling URL contexts elsewhere.** The share-link primitive, the
  top-bar workspace name, the Open dialog and not-found page keep their
  current wording. Only the two forms that *choose* a name change.

## Requirements

### The rule

1. **Strict format for chosen names.** A URL name newly chosen at
   creation, or newly entered as a rename, must match
   `^[a-z0-9]+(-[a-z0-9]+)*$` and be 1–100 characters: lowercase ASCII
   letters, digits and single dashes, with no leading, trailing or
   consecutive dashes. The reserved list and case-insensitive
   uniqueness of PRD 020 Req 1 are unchanged. The pure rule lives in
   `src/lib/workspaceNames.ts` and is the one function client and
   server both call, as today.
2. **One slugifier.** A single pure function turns free text into a
   URL-name candidate: lowercase; every run of characters outside
   `[a-z0-9]` becomes one dash; leading and trailing dashes are
   removed; the result is clamped to 100 characters and trailing
   dashes removed again after clamping. `Team Docs` → `team-docs`,
   `  Hello, World!! ` → `hello-world`, `jane.doe` → `jane-doe`,
   `A--B` → `a-b`. Input with nothing usable (`日本語`, `!!!`) yields
   the empty string. The migration planner, the server's name-only
   create fallback and username derivation supply their own fallback
   word (`workspace`, `user`) when the slug is empty, as they do today;
   the dialog does not (Req 6). The output of the slugifier always
   satisfies Req 1 or is empty.
3. **Server enforcement.** `POST /api/workspaces` with a `uniqueName`,
   and a manifest `PUT` whose `uniqueName` differs from the stored one,
   reject a name failing Req 1 with a 400 whose message is the same
   text the client shows for that problem. A `PUT` that leaves
   `uniqueName` equal to the stored value is never re-validated against
   Req 1 (that is what keeps Req 9's grandfathered names editable for
   their other fields).

### The New Workspace dialog

4. **Display name leads.** The dialog's first field is **Display name**,
   required, autofocused. The second is **URL name**. The people and
   everyone-access sections follow as today. The display name travels
   trimmed as the manifest `name`; an empty display name at submit is
   refused inline with `A display name is required.`.
5. **Auto-fill until touched.** While the URL-name field is untouched,
   every change to the display name re-derives the URL name through
   Req 2's slugifier. The first keystroke the user makes *in the
   URL-name field* marks it touched and stops the mirroring. Clearing
   the URL-name field back to empty un-touches it: mirroring resumes
   from the current display name. Accepting the collision suggestion
   (Req 12) counts as touching.
6. **Normalise as you type.** Text typed or pasted into the URL-name
   field is passed through the slugifier before it lands in the field:
   typing `Foo Bar` shows `foo-bar`; typing `foo--bar` shows `foo-bar`.
   The field therefore never displays a value that fails Req 1's
   charset. Because a trailing dash is a legitimate mid-typing state
   (`foo-` on the way to `foo-bar`), a single trailing dash is kept
   while typing and stripped on blur and on submit. An empty URL-name
   field at submit is refused inline with `A URL name is required.`;
   the reserved-word refusal stays inline as you type, as today.
7. **Guidance and preview.** Beneath the URL-name field, always
   visible: one sentence, `Lowercase letters, numbers and dashes. This
   is the workspace's address.`, and a live preview line showing the
   canonical path URL the current value would produce
   (`https://<host>/<url-name>`), built from the same path helper the
   share-link primitive uses (`src/lib/hostedPaths.ts`) so the two can
   never disagree. With an empty URL name the preview shows the host
   with an empty final segment placeholder (`https://<host>/…`). The
   guidance uses the muted caption style; refusals keep the `.form-error`
   treatment of issue #245.
8. **Error paint unchanged.** The URL-name field wears the issue #245
   error border and value colour exactly while its value is what the
   server or the reserved-word rule refused, and the display-name field
   wears it while it is empty at submit. Editing either field retires
   its own refusal.

### Existing names and Settings

9. **Grandfathering.** A stored `uniqueName` or `formerNames` entry
   that satisfies PRD 020's old rule (`[A-Za-z0-9._-]`, 1–100) but not
   Req 1 remains valid: manifest validation (`src/lib/hostedWorkspace.ts`)
   keeps accepting the old charset, path resolution keeps matching it
   case-insensitively, listings and share links keep showing it
   unchanged. Only a name being *chosen* meets Req 1.
10. **Settings Names section.** The section's fields swap to **Display
    name** (required; blank at save is refused with `A display name is
    required.`, replacing today's "blank means the URL name" rule) then
    **URL name**, with Req 7's guidance and preview under the URL name.
    The URL-name field normalises as you type (Req 6) and shows the
    grandfathered stored value untouched until the user edits it; once
    the value differs from the stored one it must satisfy Req 1 before
    Save is accepted. The display name never auto-derives the URL name
    here. The former-names caption of PRD 024 Req 16 is unchanged.

### Usernames

11. **Usernames follow the rule.** Username derivation
    (`src/lib/usernames.ts`) uses Req 2's slugifier with the `user`
    fallback, so a first-seen `jane.doe@contoso.com` becomes `jane-doe`
    and `j_smith` becomes `j-smith`, deduped as today. Usernames already
    stored are read back unchanged, and the scratch path helpers keep
    resolving them.

### Collisions

12. **Suggest on 409.** When creation or rename is refused because the
    name is taken, the server's 409 body carries, beside `error`, a
    `suggestion`: the first free name the dedupe rule would mint from
    the requested one (`team-docs` → `team-docs-2`, respecting the
    reserved list and the length clamp). The New Workspace dialog and
    the settings Names section show the refusal and, next to it, a
    single action `Use team-docs-2` that puts the suggestion in the
    URL-name field, marks it touched, and clears the refusal. Clicking
    it does not submit. An old server whose 409 carries no suggestion
    shows the refusal alone.

### Verification

13. **Unit coverage.** `src/lib/workspaceNames.ts` and
    `src/lib/usernames.ts` have unit tests for Req 1 (accept/reject
    table including edge and double dashes, uppercase, dots,
    underscores, length), Req 2 (the examples above plus empty output),
    Req 9 (the legacy rule still accepts the old charset while Req 1
    rejects it), and Req 12's suggestion minting. The New Workspace
    form's pure validation covers Req 4 and Req 6's empty cases.
14. **End-to-end coverage.** Hosted e2e tests cover: typing a display
    name fills the URL name live and the preview updates (Req 5, 7);
    editing the URL name stops mirroring, clearing it resumes (Req 5);
    typing `Foo Bar` into the URL name shows `foo-bar` (Req 6); the
    settings section renames a grandfathered `Team_Docs` workspace to
    `team-docs` while a save that only changes the display name leaves
    `Team_Docs` in place (Req 9, 10); a taken name shows the suggestion
    and one click fills it (Req 12).

## Open questions

None.
