# The Marky Mark comment format

**Current format version: `2.0.0`**

This is the published specification of the format Marky Mark uses to store
comments alongside a markdown document. It is written for someone building a
reader or a writer of that format — another editor, a review bot, a CI check,
the sibling `md-with-comments` app — who has no access to Marky Mark's source.
Everything needed to produce and consume a byte-valid comment store is stated
here in prose, JSON and tables.

Marky Mark implements this document in `src/lib/commentFormat.ts` (the version
rules and the payload schema), `src/lib/embedded.ts` (the trailer container)
and `src/lib/sidecar.ts` (the file container). Those pointers are for
maintainers; no rule below depends on reading them.

## Contents

- [The version string](#the-version-string)
- [The two containers](#the-two-containers)
- [The payload schema (2.0.0)](#the-payload-schema-200)
- [A complete worked example](#a-complete-worked-example)
- [MAJOR / MINOR / PATCH](#major--minor--patch)
- [Reader rules](#reader-rules)
- [Writer rules](#writer-rules)
- [The container is frozen](#the-container-is-frozen)
- [Changelog](#changelog)

## The version string

A comment store declares its format version in a single key, `version`, at the
top level of the payload:

```json
{ "version": "2.0.0", "comments": [] }
```

A valid version is `MAJOR.MINOR.PATCH`, where each component is a run of ASCII
digits. Nothing else qualifies: no `v` prefix, no pre-release or build suffix,
no two- or four-component forms. Anything else in the `version` key is *not* a
version, and a reader must not guess at it (see
[Reader rules](#reader-rules)).

`version` is the only versioning key in the format. There is no
`formatVersion`, no parallel `major` / `minor` pair, and no per-comment version
field. A writer must not invent one; a reader must ignore any it finds (it is
simply an unknown key, retained like any other — see
[Unknown keys](#unknown-keys-extra-and-extraversion)).

### The format version is not the application version

**The comment-format version is independent of the Marky Mark application
version, and the two move separately.** Format `2.0.0` has nothing to do with
app version `0.4.0-alpha.4` — they are different numbers describing different
things, and neither one can be derived from the other. The app may ship a
dozen releases without touching the format, and one day may bump the format
without changing its own major. Never parse a Marky Mark release number to
decide what a comment store contains, and never write the app's version into
the `version` key.

## The two containers

The same payload — the identical JSON object described in
[The payload schema](#the-payload-schema-200), with the same `version` key in
the same place — is stored in one of two containers. A document may carry
either, or both.

### Container 1: the embedded trailer

Comments live in an HTML comment block appended to the very end of the
markdown file:

```text
<!-- marky-mark-comments
{ …payload… }
-->
```

Precise layout, exactly as Marky Mark writes it:

- The block is the **last thing in the file**. Nothing follows the closing
  `-->` except a single newline.
- A newline precedes the opening `<!-- `, separating the block from the
  document's last line.
- The opening line is `<!-- marky-mark-comments` — the marker, then a
  newline. Nothing else on that line.
- The payload is pretty-printed JSON with a 2-space indent, on its own lines.
- A newline, then `-->`, then a newline, ends the file.

So a writer emits, appended to the document content:

```text
\n<!-- marky-mark-comments\n<payload JSON>\n-->\n
```

A reader should be more forgiving than that, and Marky Mark is: it locates the
trailer with the equivalent of

```text
/\n?<!-- (?:marky-mark|markimark)-comments\n([\s\S]*?)\n-->\s*$/
```

— the leading newline is optional and trailing whitespace after `-->` is
tolerated. Everything before the match is the document content, byte for byte;
the capture group is the payload JSON text. The trailer never appears in the
editor or the rendered preview: HTML comments are hidden by GitHub and every
mainstream markdown renderer, and Marky Mark's sanitizer strips them.

**The legacy marker.** `markimark-comments` is accepted on read, permanently.
It is what Marky Mark wrote before 0.4, and it is a **frozen alias, not a
deprecation** — no future version will stop reading it. New trailers are
always written with `marky-mark-comments`; a document whose comments are
rewritten therefore migrates its marker on the first save, but a reader must
never require that to have happened.

**The `-->` escape.** A comment body containing `-->` would close the HTML
comment early and truncate the payload. Before wrapping the JSON text in the
block, a writer therefore replaces **every** occurrence of the three-character
sequence `-->` in that text with the eight-character sequence:

```text
-\u002d>
```

That is a hyphen, then the standard JSON escape for a hyphen (`\u002d` is
`-`), then `>`. `JSON.parse` restores it losslessly, so the string a reader
gets back is exactly `-->` again — no unescaping step is needed, and none
should be performed. The replacement is unconditional across the whole JSON
text, which is safe because `-->` can only ever occur inside a JSON string
literal: outside strings the serializer emits only structural characters,
digits and the literals `true`, `false`, `null`. A reader that wants to be
strict may reject a payload in which `-->` survives unescaped; Marky Mark
simply never produces one.

**Zero comments means no trailer.** A document with no comments carries no
trailer block at all — not an empty versioned one. When the last comment is
deleted, the block is removed and the file ends at the document's own last
byte.

### Container 2: the sidecar file

The payload is stored as JSON in a file next to the document, named by
appending `.comments.json` to the **full document filename, extension
included**:

| Document      | Sidecar                     |
| ------------- | --------------------------- |
| `notes.md`    | `notes.md.comments.json`    |
| `README.md`   | `README.md.comments.json`   |
| `a.b.md`      | `a.b.md.comments.json`      |

It is *not* `notes.comments.json`; the `.md` is never stripped.

The file holds the payload pretty-printed with a 2-space indent and a single
trailing newline, so sidecars diff cleanly in git. When the last comment of a
document is deleted, the sidecar file is **removed**, not left holding an
empty array.

### When both containers exist

A document may have both a trailer and a sidecar (for instance after the user
switches storage modes). They are merged by comment `id`, and **trailer
entries win** a collision; the merged order is the trailer's comments first,
then the sidecar-only ones. The two containers are judged independently for
readability (see [Reader rules](#reader-rules)).

## The payload schema (2.0.0)

The payload is a JSON object. Every field below is part of the wire format at
version `2.0.0`.

Each table carries a **Min version** column: the lowest format version in
which that field exists. Every `2.0.0` field requires `2.0.0` — the kind
split landed as one MAJOR break, so no field of this shape predates it.
**Every future field addition must record its own minimum version in the
same way.** That column is not decoration: it is what makes the writer's
"stamp the lowest version that can represent this data" rule (see
[Writer rules](#writer-rules)) computable as the format grows. Without a
per-field minimum, a writer cannot tell which version its data actually
needs.

### The payload object

| Key        | Type             | Required | Min version | Meaning                                                    |
| ---------- | ---------------- | -------- | ----------- | ---------------------------------------------------------- |
| `version`  | string           | yes      | 2.0.0       | The format version this store is written at (see above).    |
| `comments` | array of records | yes      | 2.0.0       | The document's annotation records. May be empty in a payload, but an empty record set is normally stored as *no container at all*. |

### The two record kinds

Every element of `comments` is a **record**, and every record carries a
required `kind` key holding exactly `"comment"` or `"highlight"`. The two
kinds share their identity fields (`kind`, `id`, `author`, `createdAt`,
`anchor`) and split the rest: a comment carries `body`, `thread` and
`resolved` and **no** `color`; a highlight carries `color` and **none** of
`body`, `thread` or `resolved`. A record whose `kind` is missing, not a
string, or not one of the two literals is never guessed at — the reader
skips it whole (see the
[entry-level schema check](#7-entry-level-schema-check)).

**Foreign known keys.** A key that belongs to the *other* kind — `color` on
a comment record; `body`, `thread` or `resolved` on a highlight record — is
a **known key with no meaning on that kind**, not an unknown key. A reader
ignores it entirely: it is not interpreted, not retained, and not re-emitted
on write. This is the same stance the format takes on a wrong-typed known
key (a known key is a schema question, never an unknown-key one), and it is
deliberate: without it, `body` on a highlight would fall into the
unknown-key bag and silently ride along forever. A writer never emits a
foreign key.

### The comment record

| Key         | Type             | Required | Min version | Meaning                                                     |
| ----------- | ---------------- | -------- | ----------- | ----------------------------------------------------------- |
| `kind`      | string           | yes      | 2.0.0       | The literal `"comment"`.                                     |
| `id`        | string           | yes      | 2.0.0       | Unique within the document; how a record is identified when two containers merge. Opaque — no format is defined or may be assumed. |
| `author`    | string           | yes      | 2.0.0       | Display name of the comment's author. Free text.             |
| `createdAt` | string           | yes      | 2.0.0       | ISO 8601 timestamp, UTC (`2026-05-14T09:31:02.418Z`).        |
| `body`      | string           | yes      | 2.0.0       | The comment text. Markdown source; may contain any character, including `-->`. |
| `resolved`  | boolean          | yes      | 2.0.0       | Whether the thread is resolved. A reader treats *only* the literal `true` as resolved; anything else, including a missing key, is `false`. A writer always emits it. |
| `thread`    | array of replies | yes      | 2.0.0       | Replies, oldest first. Empty array when there are none — the key is still written. |
| `anchor`    | anchor object    | yes      | 2.0.0       | Where in the document the comment attaches.                  |

A comment has no `color`: comments render in one fixed tint, not a marker
hue. `color` on a comment record is a foreign known key (see above).

### The highlight record

| Key         | Type          | Required | Min version | Meaning                                                        |
| ----------- | ------------- | -------- | ----------- | -------------------------------------------------------------- |
| `kind`      | string        | yes      | 2.0.0       | The literal `"highlight"`.                                      |
| `id`        | string        | yes      | 2.0.0       | Unique within the document, exactly as on a comment record.     |
| `author`    | string        | yes      | 2.0.0       | Display name of the highlight's author. Free text.              |
| `createdAt` | string        | yes      | 2.0.0       | ISO 8601 timestamp, UTC.                                        |
| `color`     | string        | yes      | 2.0.0       | Marker tint: exactly one of `"yellow"`, `"green"`, `"orange"`, `"pink"`. **Required** — a highlight IS its color. A record whose `color` is missing or holds any other value (`"blue"` included) fails the schema check and is skipped whole; it is never coerced to a default tint. |
| `anchor`    | anchor object | yes      | 2.0.0       | Where in the document the highlight paints.                     |

A highlight has no `body`, no `thread` and no `resolved`: it is a painted
range, not a conversation. Each of those on a highlight record is a foreign
known key (see above).

### The reply object

| Key         | Type   | Required | Min version | Meaning                                       |
| ----------- | ------ | -------- | ----------- | --------------------------------------------- |
| `id`        | string | yes      | 2.0.0       | Unique within the thread.                     |
| `author`    | string | yes      | 2.0.0       | Display name of the reply's author.           |
| `createdAt` | string | yes      | 2.0.0       | ISO 8601 timestamp, UTC.                      |
| `body`      | string | yes      | 2.0.0       | The reply text (markdown source).             |

A reply has no `kind`, no `resolved`, no `thread` and no `anchor`: replies
exist only inside a comment record's `thread`, threads are one level deep,
and a reply inherits its comment's anchor.

### The anchor object

| Key      | Type   | Required | Min version | Meaning                                                        |
| -------- | ------ | -------- | ----------- | -------------------------------------------------------------- |
| `exact`  | string | yes      | 2.0.0       | The exact text the record was made on.                         |
| `prefix` | string | yes      | 2.0.0       | Up to 32 characters of context immediately **before** `exact`. |
| `suffix` | string | yes      | 2.0.0       | Up to 32 characters of context immediately **after** `exact`.  |
| `start`  | number | yes      | 2.0.0       | Character offset of the start of `exact`.                      |
| `end`    | number | yes      | 2.0.0       | Character offset just past the end of `exact`.                 |

**The coordinate space is stated, not assumed.** `start` and `end` are
character offsets into the document's **rendered plain text** — the text
content of the rendered markdown, i.e. what a reader sees, with markup removed
— not into the markdown source, and not into any HTML. Offsets are counted in
JavaScript string units (UTF-16 code units). `end` is exclusive, so
`renderedText.slice(start, end)` equals `exact` when the anchor is still
valid.

`prefix` and `suffix` are the 32 characters of rendered text on either side of
`exact`, truncated by the document's edges: an anchor near the start of the
document has a shorter `prefix`, one near the end a shorter `suffix`. They are
context for re-anchoring after the document is edited — a reader that finds
`exact` at a different offset, or more than once, uses them to choose the
right occurrence. Offsets are advisory in exactly that sense: a conforming
reader may re-locate an anchor whose `start`/`end` no longer match and rewrite
them.

### Unknown keys, `extra` and `extraVersion`

Keys not listed above — and not known to the *other* record kind (see
[Foreign known keys](#the-two-record-kinds)) — are **unknown keys** and are
governed by the [reader](#reader-rules) and [writer](#writer-rules) rules:
retained per object, re-emitted at the level they were read from.

Marky Mark holds them in memory on fields named `extra` (the retained keys)
and `extraVersion` (the version they came from). **Neither is part of the wire
format.** No `extra` object and no `extraVersion` key is ever written to a
container, and a reader must not expect one. A retained key is re-emitted as a
plain key of the object it was read from — beside `id` and `body` on a
comment record, beside `start` and `end` on an anchor — never nested inside
anything. (If a store *does* contain a key literally named `extra`, it is just
an unknown key like any other, and is retained and re-emitted as one.)

## A complete worked example

A document `notes.md` whose rendered plain text is exactly:

```text
Release checklist

The installer must be signed before upload.
```

with one orange highlight on the word `installer` (offsets 23–32) and one
comment on the word `signed` (offsets 41–47) whose note carries one reply,
and where the reply's body happens to contain `-->`. The payload:

```json
{
  "version": "2.0.0",
  "comments": [
    {
      "kind": "highlight",
      "id": "h-27b1",
      "author": "Dana",
      "createdAt": "2026-05-14T09:29:44.102Z",
      "color": "orange",
      "anchor": {
        "exact": "installer",
        "prefix": "Release checklist\n\nThe ",
        "suffix": " must be signed before upload.\n",
        "start": 23,
        "end": 32
      }
    },
    {
      "kind": "comment",
      "id": "c-9f2a",
      "author": "Dana",
      "createdAt": "2026-05-14T09:31:02.418Z",
      "body": "Signed with which certificate?",
      "resolved": false,
      "thread": [
        {
          "id": "r-41c8",
          "author": "Sam",
          "createdAt": "2026-05-14T10:02:57.006Z",
          "body": "The release cert — see the note in <!-- ops --> below."
        }
      ],
      "anchor": {
        "exact": "signed",
        "prefix": "hecklist\n\nThe installer must be ",
        "suffix": " before upload.\n",
        "start": 41,
        "end": 47
      }
    }
  ]
}
```

Note the second record's anchor: `prefix` is 32 characters (it starts
mid-word, at `hecklist`, because 32 characters back from offset 41 lands
there), while `suffix` is only 16 — the document ends first.

As a sidecar, that is the whole of `notes.md.comments.json`, plus a trailing
newline.

As an embedded trailer, appended to the end of `notes.md` — note `-->` inside
the reply body rendered as `-\u002d>`:

```text
<!-- marky-mark-comments
{
  "version": "2.0.0",
  "comments": [
    {
      "kind": "highlight",
      "id": "h-27b1",
      "author": "Dana",
      "createdAt": "2026-05-14T09:29:44.102Z",
      "color": "orange",
      "anchor": {
        "exact": "installer",
        "prefix": "Release checklist\n\nThe ",
        "suffix": " must be signed before upload.\n",
        "start": 23,
        "end": 32
      }
    },
    {
      "kind": "comment",
      "id": "c-9f2a",
      "author": "Dana",
      "createdAt": "2026-05-14T09:31:02.418Z",
      "body": "Signed with which certificate?",
      "resolved": false,
      "thread": [
        {
          "id": "r-41c8",
          "author": "Sam",
          "createdAt": "2026-05-14T10:02:57.006Z",
          "body": "The release cert — see the note in <!-- ops -\u002d> below."
        }
      ],
      "anchor": {
        "exact": "signed",
        "prefix": "hecklist\n\nThe installer must be ",
        "suffix": " before upload.\n",
        "start": 41,
        "end": 47
      }
    }
  ]
}
-->
```

## MAJOR / MINOR / PATCH

The version components mean this, and only this:

| Component | Incremented when                                                                                                                                   | Effect on an older reader                                                              | Worked example                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MAJOR** | A change a reader of the previous major cannot correctly interpret: removing a field, renaming a field, changing a field's type, or changing the meaning of an existing field. | It must refuse the store outright — it would misread the data.                           | Splitting every entry on a required `kind` and making `color` a highlight-only, required field (the change that became `2.0.0`): a `1.x` reader would misread the records, so the major moved. Redefining `anchor.start` / `anchor.end` to count offsets into the **markdown source** would be the same story → `3.0.0`. |
| **MINOR** | A backwards-compatible addition: a new **optional** field on a record, reply or anchor, whose absence a previous reader tolerates and whose presence it can safely ignore.     | It reads the store normally, ignores the new field, and preserves it on write.            | Adding an optional `mentions` array of names on a comment record or a reply: an older reader shows the record exactly as before → `2.1.0`. (`1.1.0` was a bump of exactly this shape: one optional field — `color` — added to the single entry kind of the day.) |
| **PATCH** | A change that alters no shape at all: a clarification of the semantics already implied, or a serialization fix that produces byte-different but schema-identical output.        | None — it parses the same object it always did.                                          | The `-->` escape in the embedded trailer (byte-different trailer, identical parsed payload), or fixing key order / indentation so output is byte-stable across saves → `2.0.1`.        |

Two consequences worth stating outright:

- A MINOR addition must be **optional**. If a reader at the same major would
  be wrong without the new field, the change is MAJOR, not MINOR.
- PATCH never changes what a reader may do. It is therefore never consulted
  when deciding whether a store can be read (see below).

Every bump must also append an entry to this document's
[Changelog](#changelog); see `CONTRIBUTING.md`.

## Reader rules

These are the rules exactly as this build implements them. A conforming reader
may be more permissive about what it *accepts*, but it must not be more
permissive about what it *interprets*: reading comments out of a store you do
not understand is the one thing the version field exists to prevent.

### 1. Resolve the declared version

Given the result of `JSON.parse` on the container's payload text:

1. If the parsed value is **not a JSON object** — `null`, an array, a string,
   a number, a boolean — treat it as the empty object. It therefore declares
   no version, and rule 3 below applies: it resolves to `1.0.0` and yields
   zero comments.
2. If `version` is the **integer `1`** (not the string `"1"`), the payload
   resolves to **`1.0.0`**. This is what Marky Mark's pre-versioning embedded
   trailers wrote.
3. If there is **no `version` key at all**, the payload resolves to
   **`1.0.0`**. This is what Marky Mark's pre-versioning sidecars wrote.
4. Otherwise, if `version` is a valid `MAJOR.MINOR.PATCH` string, that is the
   resolved version.
5. Otherwise — `version` is present but is not a valid version string
   (`"1.0"`, `"v1.0.0"`, `"1.0.0-beta"`, `2`, `true`, an object) — the version
   is **uninterpretable**. It does *not* resolve to `1.0.0`. The store is
   unsupported (rule 2), and the reader must not guess.

Rules 2 and 3 are the only two legacy coercions that exist. They are a closed
list, not a pattern: a reader must not invent a coercion for a version that
never shipped.

### 2. Decide what the resolved version is

Compare the resolved version against what the reader knows — for this build,
supported `2.0.0`, within a MAJOR whose oldest shipped version is `2.0.0` —
on **MAJOR, then MINOR. PATCH never decides.** There are three verdicts:

A store is **supported** when **both** hold:

- the resolved MAJOR **equals** the reader's supported MAJOR, and
- the resolved MINOR is **greater than or equal to** the MINOR of the
  *oldest version of that MAJOR that ever shipped* (`2.0.0` for this build,
  so a MINOR of `0` or more).

A MINOR at or below the reader's own is readable because every minor of a
major that shipped is the previous shape plus optional fields. A *greater*
MINOR is readable by the compatibility promise MINOR makes (rule 6 below).

A store whose resolved MAJOR is **lesser** than the reader's is **legacy**:
readable in the degenerate sense of rule 3 below — it yields zero records
and is simply written over.

Everything else is **unsupported**: a greater MAJOR (obviously — it may mean
anything), an uninterpretable version (rule 1's case 5), and a MINOR below
the oldest one that shipped at the right MAJOR. On that last case: **it is
not true that "anything below the supported version is readable."** A
version inside a MAJOR is readable only back to the oldest minor of that
MAJOR that actually shipped; nothing is registered for a version that never
existed, and an uninterpretable version is a signal to be careful, not to
guess.

For this build, supported `2.0.0` with `2.0.0` the oldest of its major, that
reduces to: MAJOR `2` reads normally (`2.0.0`, `2.4.2`, `2.99.0`); MAJOR `1`
and below — including both legacy coercions of rule 1 — is legacy and reads
as empty; `3.0.0` and an uninterpretable version are unsupported. PATCH is
ignored throughout.

### 3. A lesser MAJOR is the deliberate legacy break

The move to `2.0.0` (the kind split, issue #283) happened while Marky Mark
was unreleased, and PRD 023 is explicit that `1.x` stores are **not**
migrated. A store at a lesser MAJOR — a `1.x` version string, the integer
`1`, no version key at all, or a non-object payload — therefore:

- contributes **zero** records. Not a best-effort reinterpretation: the
  `1.x` shape is not this shape, and partial reads are how data gets
  corrupted.
- does **not** stop the markdown from opening, raises **no** unreadable
  verdict, shows **no** notice, and does **not** freeze authoring. To the
  user the document simply has no annotations.
- is **not** preserved: the next save writes a current store over it (or
  removes the container when there are no records). The legacy annotations
  are intentionally lost.

This is a one-time, pre-release break. A future MAJOR bump against a
*shipped* format must not reuse this rule without restating it here.

### 4. What an unsupported store does — and does not do

An unsupported store (unsupported version, or, in the embedded trailer, JSON
that does not parse at all):

- contributes **zero** comments. Not a best-effort subset: zero. Partial
  interpretation of a format you do not understand is how data gets corrupted.
- does **not** stop the markdown from opening. The document loads, renders and
  edits normally; only its comments are absent.
- has its bytes **preserved exactly** across open → edit → save. The trailer
  block is re-emitted verbatim — marker, JSON text, whitespace and all —
  rather than re-serialized from an empty comment set, so a round trip through
  an older reader never destroys a newer store. A sidecar the reader will not
  interpret is never rewritten and never deleted.
- freezes **comment authoring for the whole document** while any of its stores
  is unsupported: no new comment, no reply, no edit, no resolve, no delete.
  The freeze is per document, not per store — if one store cannot be written
  safely, none of them is written.
- is announced by a **persistent indication**, not a transient toast: a notice
  that stays on screen for as long as the document is open, saying the comments
  cannot be shown and are left untouched. When the store declared a version,
  Marky Mark names it — "written by a newer version of Marky Mark (comment
  format 3.0.0)"; when it declared none, the notice says only that this version
  could not read them.

### 5. Verdicts are per store

The trailer and the sidecar are judged **independently**. A document with an
unsupported trailer and a supported sidecar still shows the sidecar's
comments; the freeze and the notice apply document-wide, but a readable store
is still read.

(Shipped detail, for exactness: Marky Mark's *trailer* is judged unsupported
both for an unsupported version and for JSON that does not parse. A *sidecar*
whose text is not JSON at all cannot be judged by the format layer — it is
ignored and contributes no comments, and it does not by itself freeze the
document; only a sidecar that parsed as JSON and then declared a version this
build may not interpret does.)

### 6. A newer MINOR of a supported MAJOR

Parse it normally — that is what MINOR compatibility means. On top of that:

- **Unknown keys are retained, per object.** Every key of a comment, a reply
  or an anchor that the reader does not recognize is kept, attached to the
  object it was found on, and re-emitted verbatim on write. A reader that
  drops them turns every save into silent data loss for the newer writer.
- **A retained key never shadows a known one.** Retention applies only to keys
  the reader does not recognize. A key the reader knows is parsed by the
  reader's own rules — even when its value has the wrong type, which is a
  schema question, not an unknown-key one — and is never also retained. On
  write, the known keys win any collision.
- **Retention remembers its version.** A comment that retained anything
  remembers the version it was read at, so the writer can stamp that version
  again (see [Writer rules](#writer-rules)).
- Retention applies to entries that **parse**. An entry skipped by the schema
  check below is skipped whole, taking its unknown keys with it — a retained
  bag with nothing valid to hang off has nowhere to be re-emitted from.

### 7. Entry-level schema check

Within a supported payload, each element of `comments` is checked
individually, and a failing record is **skipped rather than crashing the
parse** — one malformed record must not cost the reader the other forty.
A record is kept when:

- it is a non-null object, and
- `id`, `author` and `createdAt` are all strings, and
- `anchor` is a non-null object whose `exact`, `prefix` and `suffix` are
  strings and whose `start` and `end` are numbers, and
- `kind` is the literal `"comment"` or `"highlight"` (a missing, non-string
  or unrecognized `kind` skips the record whole — never a guess), and
- per kind: a comment record's `body` is a string; a highlight record's
  `color` is one of the four vocabulary literals (anything else — a missing
  color, `"blue"`, `"YELLOW"`, a number — skips the record whole; it is
  never coerced to a default tint).

Then, on a comment record:

- `resolved` is `true` only if it is literally `true`; anything else is
  `false`.
- `thread`, if it is not an array, becomes an empty one. Elements that are not
  valid replies (a non-null object with string `id`, `author`, `createdAt` and
  `body`) are dropped individually; the surviving replies keep their order.

And at the payload level, `comments` itself, if it is not an array, yields
zero records. Foreign known keys on either kind are ignored, per
[the rule above](#the-two-record-kinds).

## Writer rules

- **Stamp the lowest version capable of representing the data being
  written — not the version the writer supports.** A writer that supports
  `2.4.0` but emits only fields that exist in `2.0.0` writes
  `"version": "2.0.0"`, so the store stays readable by every `2.x` reader.
  This is what the per-field **Min version** column is for: the stamp is the
  highest minimum among the fields actually present.
- **Retained fields from a newer version keep that newer version.** If a
  record carries unknown keys read from a `2.4.0` store, writing it back
  stamps `2.4.0` — the store really does contain `2.4.0` data, and claiming
  `2.0.0` would lie to the next reader. When comments read from several stores
  are written together, the **highest** such version wins. A retained bag
  whose version was uninterpretable can never win that contest.
- **Both containers carry the same payload**: the same schema, the same
  `version` key in the same place. They differ only in how the JSON text is
  wrapped.
- **Serialization is byte-stable and idempotent.** Known keys are emitted in
  the fixed per-kind order of the tables above (comment records: `kind`,
  `id`, `author`, `createdAt`, `body`, `resolved`, `thread`, `anchor`;
  highlight records: `kind`, `id`, `author`, `createdAt`, `color`, `anchor`;
  replies: `id`, `author`, `createdAt`, `body`; anchors: `exact`, `prefix`,
  `suffix`, `start`, `end`; `version` before `comments`), and retained
  unknown keys follow the known ones in the order they were read. A foreign
  known key is never emitted. Serializing the same record set twice produces
  identical bytes, and attaching a trailer to a document that already has
  one replaces it rather than appending a second.
- **Never write a container for zero comments.** No empty trailer; no sidecar
  file holding an empty array — the trailer is omitted and the sidecar file is
  removed.
- **Never write a store the reader could not interpret.** If any of the
  document's stores was unsupported, nothing is written to either of them (see
  reader rule 4). A *legacy* store is different: it was interpreted — as
  empty, per reader rule 3 — so writing proceeds and replaces it.

## The container is frozen

**The embedded trailer marker and the sidecar filename pattern never change
again — not in `1.x`, not in `2.0.0`, not in any later major.** These strings
are frozen for the life of the format:

| Frozen string         | Role                                                          |
| --------------------- | ------------------------------------------------------------- |
| `marky-mark-comments` | The embedded trailer marker: written and read, forever.        |
| `markimark-comments`  | Legacy trailer marker: **read** forever. A frozen alias, never deprecated, never written by a current build. |
| `<doc>.comments.json` | The sidecar filename pattern, e.g. `notes.md.comments.json`.   |

All future evolution of the format happens **inside the JSON payload**, where
the version field can describe it.

**The reason:** the version field lives *inside* the container. A reader that
does not recognize the container never reaches the version, so it cannot know
that a newer format exists and cannot warn anyone about it. A renamed marker
or a renamed sidecar file would not look like "a newer version I should refuse
politely" — it would look like *no comments at all*. The document would open
clean, the user would add comments to it, and the save would either sit beside
an invisible store or overwrite it. Freezing the container is what makes every
future version bump detectable, and therefore survivable.

That is also why the legacy `markimark-comments` alias is permanent rather
than deprecated: a document written years ago must keep announcing that it has
comments, even to a build that will not interpret them.

## Changelog

Entries are **newest first**. Every change to the comment payload appends an
entry here and bumps the version per
[MAJOR / MINOR / PATCH](#major--minor--patch) — see `CONTRIBUTING.md`, which
makes that a review gate.

### 2.0.0 — 2026-09-05

The PRD 023 kind split (issue #283): comments and highlights become two
record kinds, and the format deliberately breaks with `1.x`.

- Every record now carries a required `kind` — `"comment"` or `"highlight"`,
  first in the key order. A comment record carries `body`, `thread` and
  `resolved` and no `color`; a highlight record carries a **required**
  `color` and no `body`, `thread` or `resolved`. A record with a missing,
  non-string or unrecognized `kind` is skipped whole.
- The highlight color vocabulary is `"yellow"`, `"green"`, `"orange"`,
  `"pink"` — `orange` replaces 1.1.0's `"blue"` (blue is the fixed comment
  tint now, and comments are not highlights). An out-of-vocabulary color —
  `"blue"` included — skips the record at parse: a deliberate change from
  1.1.0's "invalid color reads as absent", because a highlight IS its color
  and has no colorless form to degrade to.
- Foreign known keys are pinned: a known key of the other kind (`color` on a
  comment record; `body`, `thread` or `resolved` on a highlight record) is
  ignored — not interpreted, not retained, never re-emitted.
- The break with `1.x` readers and stores is deliberate and one-way (Marky
  Mark is unreleased; PRD 023's non-goal is no migration of 1.x stores): a
  `2.0.0` reader opens a pre-2.0.0 store — a `1.x` version string or either
  legacy coercion — as zero records with no unreadable verdict and no
  authoring freeze, and the next save writes a `2.0.0` store over it
  (reader rule 3). A `1.x` reader, by its own MAJOR rule, refuses a `2.0.0`
  store outright — including the shipped v0.4.0-alpha.4 reader, whose
  PRD 004 Req 39 forward-compatibility guarantee this MAJOR deliberately
  ends.

### 1.1.0 — 2026-09-04

Highlights (PRD 022): one optional field, nothing else moves.

- The comment object gains an optional `color` — exactly one of `"yellow"`,
  `"green"`, `"blue"`, `"pink"`; absent means the legacy default tint. It
  slots between `resolved` and `thread` in the fixed key order and is emitted
  only when present, so a colorless store's bytes are unchanged from `1.0.0`.
- The stamp follows the fields actually present: a store where some entry
  carries `color` stamps `1.1.0`; a store whose entries all lack it still
  stamps `1.0.0` (the lowest-version rule of [Writer rules](#writer-rules)).
- Note-less highlights are stated as valid: an entry with an empty `body` and
  an empty `thread` stores a highlight without a note, at min version
  `1.0.0`, with the `1.0.0`-reader degradation documented under
  [The comment object](#the-comment-object).
- Reader rule 2 restated for a world with two shipped minors: within the
  supported MAJOR, every MINOR back to the oldest that shipped (`1.0.0`) is
  supported — the rule was previously phrased against the reader's own MINOR
  because only one existed.

### 1.0.0 — 2026-08-03

The shape that shipped. Named, not changed: `1.0.0` is the comment / reply /
anchor schema Marky Mark has written since the beginning, given a version
number for the first time so later changes have something to move from.

- The payload object (`version`, `comments`), the comment, reply and anchor
  objects exactly as documented above.
- Both containers frozen: the `marky-mark-comments` trailer (with the
  permanent `markimark-comments` read alias) and `<doc>.comments.json`.
- The legacy encodings this version reads as `1.0.0`: an embedded trailer
  declaring the integer `1`, and a sidecar declaring no version at all.
