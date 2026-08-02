# PRD 004: Semantic versioning for the comment format

**Status:** Draft
**Date:** 2026-08-02

## Problem

Marky Mark persists comments in two places — an HTML-comment trailer at the
end of the `.md` file (`src/lib/embedded.ts`) and a `.md.comments.json`
sidecar (`src/lib/sidecar.ts`) — and neither is versioned in any way that a
reader acts on.

- The trailer writes `{"version":1,"comments":[…]}`, but nothing ever reads
  that field. It is decorative.
- The sidecar writes `{"comments":[…]}` with no version field at all.
- `parseSidecar` silently drops every key it does not recognize and skips
  every entry that fails its shape check.

Together those three facts mean the format has **no way to change safely**.
The moment a field is added — a comment colour, a mention, a richer anchor —
these things happen and the user is never told:

1. A build that predates the field opens the file, parses it happily, and
   deletes the field from every comment on the next save.
2. A build that postdates a breaking change has no way to detect that it is
   looking at an older shape, so it mis-reads it.
3. A build that predates a breaking change has no way to detect that it is
   looking at a *newer* shape, so it corrupts it.

The format also already leaves the machine: comments travel inside the `.md`
file itself, through git, and into the sibling `md-with-comments` app whose
sidecar schema Marky Mark deliberately matches. A silent-data-loss format is
a bad thing to have committed to other people's repositories.

Now, because the app is at `0.4.0-alpha.4` — pre-1.0, formats explicitly
still shifting, and the trailer marker was *already* renamed once
(`markimark-comments` → `marky-mark-comments`, SPEC32 §2) with the old name
kept as a permanent regex alias. That rename is the exact failure this PRD
prevents: an old build meeting the new marker finds no trailer and reports
zero comments, with nothing in the file able to tell it otherwise. The next
such change should be announced by the format, not absorbed by a growing
list of aliases.

## Goals

- Every comment store Marky Mark writes carries an explicit semver version
  string, and every read goes through a single place that interprets it.
- A build that meets a **newer major** version never destroys the data it
  cannot understand, and says so visibly rather than failing silently.
- A build that meets a **newer minor** version round-trips the fields it
  does not recognize, so editing a comment in an old build is lossless.
- The version number a writer stamps is the truth about what the file needs,
  not about which build wrote it — so files stay readable as widely as
  possible.
- The rules are written down in a published document an outside implementer
  (or the sibling `md-with-comments` app) can build against, with a
  changelog that future format changes are required to append to.
- No existing file in the wild becomes unreadable, and no migration step is
  required of any user.

## Non-goals

- **Versioning any other persisted format.** `settings.ts`, `workspace.ts`,
  `drafts.ts`, `readingPositions.ts`, `recentFiles.ts` and friends keep their
  integer `version: 1` markers untouched. They are local-only machine state;
  losing them costs a preference, not a colleague's review comment. They may
  adopt this scheme later, but not here.
- **The HTML export and the review bundle.** `exportDoc.ts` and
  `reviewBundle.ts` produce read-only artifacts that are never parsed back
  into the app, so a version on them buys nothing.
- **A downgrade path.** There is no mechanism to rewrite a 2.0 file as 1.0.
  Newer-major files are preserved, not converted.
- **Coupling the format version to the app version.** `1.0.0` of the comment
  format has nothing to do with `0.4.0-alpha.4` of Marky Mark. They move
  independently and the document must say so.
- **Cross-store reconciliation.** When a document has both a trailer and a
  sidecar, each carries its own version and is judged on its own. This PRD
  does not change `mergeComments` merge semantics (trailer wins by id).
- **Changing the comment schema itself.** No field is added, removed or
  renamed. 1.0.0 describes exactly the shape that ships today.
- **A UI for inspecting or choosing the format version.** No setting, no
  picker, no version display in About.

## Requirements

### A. The version literal

1. The comment payload of both stores carries a `version` key whose value is
   a semver string of the form `MAJOR.MINOR.PATCH` (e.g. `"1.0.0"`). A value
   that is not a string of that shape is not a valid version.
2. The shape that ships today is defined as version `1.0.0`. No field of the
   comment, reply or anchor schema changes as part of this PRD.
3. On read, a payload whose `version` is the integer `1` is interpreted as
   `1.0.0`. This is what existing embedded trailers contain.
4. On read, a payload with no `version` key is interpreted as `1.0.0`. This
   is what existing sidecars contain.
5. On read, a payload whose `version` is present but is neither the integer
   `1` nor a valid semver string is treated as unreadable under the
   newer-major rules (requirement 12), not as `1.0.0`. An unintelligible
   version is a signal to be careful, not a signal to guess.
6. `version` is the only versioning key. No parallel `major`/`minor` fields,
   no `formatVersion` alias.

### B. What the version components mean

7. **MAJOR** is incremented for any change that a reader of the previous
   major cannot correctly interpret: removing a field, renaming a field,
   changing a field's type, or changing the meaning of an existing field.
8. **MINOR** is incremented for a backwards-compatible addition: a new
   optional field on a comment, reply or anchor, whose absence a previous
   reader tolerates and whose presence it can safely ignore.
9. **PATCH** is incremented for a change that alters no shape at all — a
   clarification of semantics, or a serialization fix (whitespace, key order,
   escaping) that produces byte-different but schema-identical output.
10. `docs/COMMENT-FORMAT.md` states these three rules with at least one
    concrete worked example per component, drawn from this codebase.

### C. Reading a version this build does not support

11. A build declares the highest format version it supports. Comparison is
    performed on MAJOR first, then MINOR; PATCH is informational and never
    affects a compatibility decision.
12. When a store's version has a **MAJOR greater than** the build supports,
    the build does not parse its comments. That store contributes zero
    comments to the document.
13. In that state the markdown document still opens, renders and edits
    normally. Only comment data is withheld.
14. In that state the unreadable store's bytes are preserved exactly. Saving
    the document writes the modified markdown content and re-emits the
    original trailer byte-for-byte; an unreadable sidecar file is not written
    to at all. A round-trip of open → edit text → save leaves the comment
    payload bit-identical.
15. In that state, creating, editing, replying to, resolving and deleting
    comments is disabled for that document, so no path exists by which a
    partial comment set could be written back over the preserved data.
16. In that state the app shows a **persistent** indication that the
    document's comments were written by a newer version of Marky Mark and
    cannot be shown. It must not be the existing `mm-notice` toast, which
    auto-dismisses after 4 seconds; the indication remains for as long as the
    document is open.
17. Version state is per store. A document whose trailer is unreadable but
    whose sidecar is at a supported version still shows the sidecar's
    comments, and requirements 14–16 apply to the trailer alone. When *any*
    store of the open document is unreadable, comment authoring is disabled
    for the whole document (requirement 15), because a save targets a single
    store and must not be able to strand the other.

### D. Reading a newer minor of a supported major

18. When a store's MAJOR is supported but its MINOR is greater than the build
    supports, the build parses it normally. A newer minor is by definition
    additive (requirement 8).
19. Keys present on a comment, a reply or an anchor that the build does not
    recognize are retained in an opaque per-object bag rather than dropped,
    and are re-emitted verbatim on the next save. The existing
    drop-unknown-keys behaviour of `parseSidecar` is replaced by this.
20. Retained unknown keys never collide with or shadow a known key. A key the
    build knows is parsed by the build's rules and is not also carried in the
    bag.
21. A file read at a version higher than the build supports and then saved
    keeps its higher version number. It is not downgraded to the build's own
    version, because its unknown fields are still present in the output.
22. An entry that fails the schema check is still skipped rather than
    crashing the parse, as today. Requirement 19 changes what happens to
    *extra* keys, not to *missing or malformed* ones.

### E. Writing

23. The version stamped on a save is the **lowest** version capable of
    representing the data being written — not the build's own supported
    version. A build that supports 1.4.0 writing comments that use no field
    newer than 1.0.0 stamps `"1.0.0"`.
24. Requirement 23 is subject to requirement 21: a file carrying retained
    unknown fields from a newer version keeps that newer version, since those
    fields are part of the data being written.
25. `docs/COMMENT-FORMAT.md` states that every future field addition must
    record the minimum version that field requires, so requirement 23 stays
    computable as the format grows.
26. Both stores serialize the same comment payload schema and the same
    `version` key. The sidecar gains the `version` key it lacks today.
27. Writing remains idempotent and byte-stable: serializing an unchanged
    comment set twice produces identical bytes, and `attachEmbedded` still
    never double-attaches a trailer.
28. A document with zero comments still writes no trailer at all, as today —
    an absent trailer is not a versioned empty one.

### F. The migration seam

29. Every read of either store passes through a single migration chokepoint
    that takes the raw parsed payload and its declared version and returns
    either the current in-memory shape or an explicit "unsupported, do not
    parse" result.
30. The only transformations registered at the seam today are the legacy
    coercions of requirements 3 and 4. No speculative migration steps are
    written for versions that do not exist.
31. The seam is a pure module function with no DOM and no platform imports,
    consistent with `embedded.ts` and `sidecar.ts` today, and is unit tested
    directly.

### G. The container

32. The embedded trailer marker and the sidecar filename pattern are frozen.
    `<!-- marky-mark-comments … -->` and `<doc>.comments.json` do not change
    again, in 1.x or in any later major. All future evolution of the format
    happens inside the JSON payload, where the version field can describe it.
33. The legacy `markimark-comments` marker remains accepted on read
    permanently. It is a frozen alias, not a deprecation.
34. `docs/COMMENT-FORMAT.md` states requirement 32 and gives its reason: the
    version field lives inside the container, so a reader that does not
    recognize the container never reaches the version and cannot be warned.

### H. The document

35. `docs/COMMENT-FORMAT.md` is published in the repository and contains: the
    complete schema of the comment payload at 1.0.0; the two container forms;
    the MAJOR/MINOR/PATCH table from requirement 10; the reader rules from
    sections C and D; the writer rules from section E; the frozen-container
    rule from section G; and a changelog section whose first entry is 1.0.0.
36. The document states explicitly that the format version is independent of
    the Marky Mark application version.
37. The document is written for an outside implementer — someone building a
    tool that reads or writes Marky Mark comments without reading this
    codebase — and is complete enough to implement against.
38. `CONTRIBUTING.md` requires any PR that changes the comment payload to
    bump the version per section B and append to the changelog in
    requirement 35.

### I. Compatibility evidence

39. A file written by the new build is read correctly by the shipped
    `0.4.0-alpha.4` build's parsing logic — the string `"1.0.0"` in place of
    the integer `1` does not disturb it, because it ignores the field.
40. Existing files are read correctly by the new build: an embedded trailer
    with `"version":1`, a sidecar with no version, and a trailer using the
    legacy `markimark-comments` marker all load their comments.
41. Tests cover, at minimum: each legacy coercion; a newer-major store
    preserved byte-for-byte across an open-edit-save cycle; comment
    authoring disabled for a newer-major document; a newer-minor store whose
    unknown fields survive a round-trip; the version-retention rule of
    requirement 21; the lowest-version write rule of requirement 23; and a
    malformed version string treated as newer-major rather than as 1.0.0.

## Open questions

None.
