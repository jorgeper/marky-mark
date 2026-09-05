# PRD 024: MarkyDown — the annotation format becomes its own spec

**Status:** Draft
**Date:** 2026-09-05

## Problem

Marky Mark quietly extends Markdown: a document can carry a versioned JSON
annotation payload at the bottom of the file inside a hidden HTML comment, so
any plain Markdown tool still opens it cleanly. That format is currently an
app internal — documented in `docs/COMMENT-FORMAT.md`, branded with the app's
own name in the trailer marker, and versioned under app-repo rules (PRD 004).
The owner wants it elevated into a named format, **MarkyDown**, documented
like a standard with its own home and identity, so the format is a thing other
tools could implement and Marky Mark is merely its first implementation
(issue #280).

This work rides the 2.0.0 format break of PRD 023 (issue #276): since that
break already abandons backwards compatibility, the rebrand costs nothing
extra if it lands in the same version.

## Goals

- MarkyDown exists as a named, self-contained, normatively documented format
  with a per-version history, decoupled from Marky Mark's docs tree.
- One authoritative spec: no second normative source left behind to drift.
- The format's version lineage stays truthful (1.0.0 → 1.1.0 → 2.0.0).
- Code and reviewers can navigate from spec clauses to implementing code the
  same way they do for SPECs today.

## Non-goals

- **No new file extension.** A MarkyDown document is a `.md` file; the hidden
  HTML comment is what makes portability work, and that is the identity.
- **No sidecar in the normative scope.** The external
  `<doc>.comments.json` sidecar is Marky Mark app behavior; the spec covers
  the embedded carrier and the data model, with the sidecar container
  described only in a clearly-marked non-normative appendix.
- **No backwards compatibility.** The old trailer markers
  (`marky-mark-comments`, alias `markimark-comments`) are not read after the
  rename; interop with the sibling `md-with-comments` project ends and is not
  preserved.
- **No repo extraction yet.** `markydown/` stays in this repository; a
  separate repo, website, npm package, or reference parser package are all
  out of scope (the folder's self-containment keeps them possible later).
- **No RFC 2119 boilerplate.** The spec keeps the existing house voice.
- **No payload redesign.** The 2.0.0 schema is PRD 023's; this PRD renames
  the container and re-homes the documentation, nothing more.

## Requirements

### Dependency

1. This PRD builds on PRD 023 (issue #276): it must be implemented after the
   2.0.0 format work lands, and the container rename below ships as part of
   the same MAJOR break from the perspective of stored files (a 2.0.0 file is
   a MarkyDown file; no file ever carries the new payload in the old
   container or vice versa).

### The format

2. The embedded trailer marker renames to `markydown`: the block written at
   the end of a document is `<!-- markydown\n<payload JSON>\n-->`. The
   `marky-mark-comments` marker and the `markimark-comments` read alias are
   removed from reader and writer; documents using them are treated as
   having no annotations (never an error, never a crash). The existing
   escaping, placement, byte-round-trip, and zero-annotations-writes-nothing
   rules are unchanged and become spec clauses.
3. The format's version lineage is inherited: MarkyDown 1.0.0 and 1.1.0 are
   the historical comment-format versions; 2.0.0 (PRD 023) is the current
   version and the first to use the `markydown` container.

### The spec folder

4. A top-level `markydown/` folder holds the format's documentation:
   `markydown/SPEC.md` — the complete normative spec of the current version —
   plus `markydown/versions/` with one document per version: concise
   historical descriptions of 1.0.0 and 1.1.0 (what the format was, what
   changed), and an entry for 2.0.0 that records the delta and defers detail
   to `SPEC.md`. A `markydown/README.md` states what MarkyDown is in a
   paragraph and maps the folder.
5. `SPEC.md` is written for an outside implementer with no access to Marky
   Mark source (the standing bar `docs/COMMENT-FORMAT.md` already meets). It
   keeps the house normative voice (lowercase RFC-flavored imperatives) and
   adds an explicit **conformance section** defining what a conforming reader
   and a conforming writer are. It covers: the container (frozen strings,
   placement, escaping, round-trip), the payload schema with
   key/type/required/min-version tables, reader rules, writer rules
   (including lowest-representative-version stamping), the
   MAJOR/MINOR/PATCH rules, and a complete worked example.
6. The `markydown/` folder is **self-contained**: no links into `src/`,
   `docs/`, `prd/`, or any other repo internals. Marky Mark documentation
   points into `markydown/`; nothing in `markydown/` points out.

### Consolidation — one normative source

7. `docs/COMMENT-FORMAT.md` is deleted. Its normative content moves into
   `markydown/SPEC.md`; the sidecar container documentation moves into a
   non-normative appendix in the spec folder. Every reference to the old
   path (`CONTRIBUTING.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, issue-spec
   conventions, code comments) is retargeted.
8. The U147 drift gate (`tests/unit/comment-format.test.ts`) retargets to the
   new spec: it must keep asserting that the spec's current-version
   statement, changelog/version history, and schema tables agree with
   `SUPPORTED_COMMENT_FORMAT_VERSION` and the code's key sets — against
   `markydown/` paths.
9. `CONTRIBUTING.md` rules 3–4 are rewritten: the frozen container table
   becomes the `markydown` marker (and, app-side, the `.comments.json`
   sidecar suffix); the payload-change review gate (version bump + version
   history entry + schema-table update, "both, not either") now points at
   `markydown/SPEC.md`. The md-with-comments interop rationale is dropped.

### Citations and the map

10. Code implementing format behavior cites the spec as `MARKYDOWN §x.y`
    (same citation-comment style as `SPEC<n> §x.y`). The modules owning the
    format seam (`commentFormat.ts`, `embedded.ts`, and spec-relevant parts
    of `anchoring.ts`) carry such citations after this work.
11. `scripts/map.mjs` learns the `MARKYDOWN` citation prefix and maps it to
    `markydown/SPEC.md`, so `docs/MAP.md` indexes spec-citing files the way
    it indexes SPECs. The MAP freshness gate keeps passing;
    `npm run map` regenerates the table.

### Verification

12. Unit coverage: the renamed container round-trips (write → read →
    byte-identical), old-marker documents read as annotation-free, and the
    retargeted drift gate (Req 8) is green. E2e suites referencing embedded
    storage are updated. `npm run validate:quick` passes with
    `docs/COMMENT-FORMAT.md` gone and `markydown/` present.

## Open questions

- None — all decisions above were settled in the grilling session on
  issue #280 (2026-09-05).
