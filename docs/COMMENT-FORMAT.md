# The Marky Mark comment format

**Current format version: `1.0.0`**

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
- [The payload schema (1.0.0)](#the-payload-schema-100)
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
{ "version": "1.0.0", "comments": [] }
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
version, and the two move separately.** Format `1.0.0` has nothing to do with
app version `0.4.0-alpha.4` — they are different numbers describing different
things, and neither one can be derived from the other. The app may ship a
dozen releases without touching the format, and one day may bump the format
without changing its own major. Never parse a Marky Mark release number to
decide what a comment store contains, and never write the app's version into
the `version` key.

## The two containers

The same payload — the identical JSON object described in
[The payload schema](#the-payload-schema-100), with the same `version` key in
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

## The payload schema (1.0.0)

The payload is a JSON object. Every field below is part of the wire format at
version `1.0.0`.

Each table carries a **Min version** column: the lowest format version in
which that field exists. Every field of the format today requires `1.0.0`,
because `1.0.0` is the first version. **Every future field addition must
record its own minimum version in the same way.** That column is not
decoration: it is what makes the writer's "stamp the lowest version that can
represent this data" rule (see [Writer rules](#writer-rules)) computable as
the format grows. Without a per-field minimum, a writer cannot tell which
version its data actually needs.

### The payload object

| Key        | Type              | Required | Min version | Meaning                                                    |
| ---------- | ----------------- | -------- | ----------- | ---------------------------------------------------------- |
| `version`  | string            | yes      | 1.0.0       | The format version this store is written at (see above).    |
| `comments` | array of comments | yes      | 1.0.0       | The document's comments. May be empty in a payload, but an empty comment set is normally stored as *no container at all*. |

### The comment object

| Key         | Type             | Required | Min version | Meaning                                                     |
| ----------- | ---------------- | -------- | ----------- | ----------------------------------------------------------- |
| `id`        | string           | yes      | 1.0.0       | Unique within the document; how a comment is identified when two containers merge. Opaque — no format is defined or may be assumed. |
| `author`    | string           | yes      | 1.0.0       | Display name of the comment's author. Free text.             |
| `createdAt` | string           | yes      | 1.0.0       | ISO 8601 timestamp, UTC (`2026-05-14T09:31:02.418Z`).        |
| `body`      | string           | yes      | 1.0.0       | The comment text. Markdown source; may contain any character, including `-->`. |
| `resolved`  | boolean          | yes      | 1.0.0       | Whether the thread is resolved. A reader treats *only* the literal `true` as resolved; anything else, including a missing key, is `false`. A writer always emits it. |
| `thread`    | array of replies | yes      | 1.0.0       | Replies, oldest first. Empty array when there are none — the key is still written. |
| `anchor`    | anchor object    | yes      | 1.0.0       | Where in the document the comment attaches.                  |

### The reply object

| Key         | Type   | Required | Min version | Meaning                                       |
| ----------- | ------ | -------- | ----------- | --------------------------------------------- |
| `id`        | string | yes      | 1.0.0       | Unique within the thread.                     |
| `author`    | string | yes      | 1.0.0       | Display name of the reply's author.           |
| `createdAt` | string | yes      | 1.0.0       | ISO 8601 timestamp, UTC.                      |
| `body`      | string | yes      | 1.0.0       | The reply text (markdown source).             |

A reply has no `resolved`, no `thread` and no `anchor`: threads are one level
deep and a reply inherits its comment's anchor.

### The anchor object

| Key      | Type   | Required | Min version | Meaning                                                        |
| -------- | ------ | -------- | ----------- | -------------------------------------------------------------- |
| `exact`  | string | yes      | 1.0.0       | The exact text the comment was made on.                        |
| `prefix` | string | yes      | 1.0.0       | Up to 32 characters of context immediately **before** `exact`. |
| `suffix` | string | yes      | 1.0.0       | Up to 32 characters of context immediately **after** `exact`.  |
| `start`  | number | yes      | 1.0.0       | Character offset of the start of `exact`.                      |
| `end`    | number | yes      | 1.0.0       | Character offset just past the end of `exact`.                 |

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

Keys not listed above are **unknown keys** and are governed by the
[reader](#reader-rules) and [writer](#writer-rules) rules: retained per object,
re-emitted at the level they were read from.

Marky Mark holds them in memory on fields named `extra` (the retained keys)
and `extraVersion` (the version they came from). **Neither is part of the wire
format.** No `extra` object and no `extraVersion` key is ever written to a
container, and a reader must not expect one. A retained key is re-emitted as a
plain key of the object it was read from — beside `id` and `body` on a
comment, beside `start` and `end` on an anchor — never nested inside anything.
(If a store *does* contain a key literally named `extra`, it is just an
unknown key like any other, and is retained and re-emitted as one.)

## A complete worked example

A document `notes.md` whose rendered plain text is exactly:

```text
Release checklist

The installer must be signed before upload.
```

with one comment on the word `signed` (offsets 41–47) carrying one reply, and
where the reply's body happens to contain `-->`. The payload:

```json
{
  "version": "1.0.0",
  "comments": [
    {
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

Note the anchor: `prefix` is 32 characters (it starts mid-word, at `hecklist`,
because 32 characters back from offset 41 lands there), while `suffix` is only
16 — the document ends first.

As a sidecar, that is the whole of `notes.md.comments.json`, plus a trailing
newline.

As an embedded trailer, appended to the end of `notes.md` — note `-->` inside
the reply body rendered as `-\u002d>`:

```text
<!-- marky-mark-comments
{
  "version": "1.0.0",
  "comments": [
    {
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
| **MAJOR** | A change a reader of the previous major cannot correctly interpret: removing a field, renaming a field, changing a field's type, or changing the meaning of an existing field. | It must refuse the store outright — it would misread the data.                           | Redefining `anchor.start` / `anchor.end` to count offsets into the **markdown source** instead of the rendered plain text: same keys, same types, silently different meaning → `2.0.0`. Dropping `anchor.prefix` and `suffix` in favour of a new locator is the same story → `2.0.0`. |
| **MINOR** | A backwards-compatible addition: a new **optional** field on a comment, reply or anchor, whose absence a previous reader tolerates and whose presence it can safely ignore.     | It reads the store normally, ignores the new field, and preserves it on write.            | Adding an optional `colour` to a comment (a highlight tint), or an optional `mentions` array of names on a comment or reply: an older reader shows the comment exactly as before → `1.1.0`. |
| **PATCH** | A change that alters no shape at all: a clarification of the semantics already implied, or a serialization fix that produces byte-different but schema-identical output.        | None — it parses the same object it always did.                                          | The `-->` escape in the embedded trailer (byte-different trailer, identical parsed payload), or fixing key order / indentation so output is byte-stable across saves → `1.0.1`.        |

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

### 2. Decide whether the resolved version is supported

Compare the resolved version against the version the reader supports —
`1.0.0` for this build — on **MAJOR, then MINOR. PATCH never decides.**

A store is supported when **both** hold:

- the resolved MAJOR **equals** the reader's supported MAJOR, and
- the resolved MINOR is **greater than or equal to** the reader's supported
  MINOR.

Everything else is unsupported: a greater MAJOR (obviously — it may mean
anything), a *lesser* MAJOR, and a *lesser* MINOR at the right MAJOR.

That last pair surprises people, so it is worth being blunt: **it is not true
that "anything at or below the supported version is readable."** A version
below the supported one is readable only if the reader registers an explicit
transformation for it, and the two coercions of rule 1 are the only
transformations that exist — which is why the legacy encodings are read while
a store that declared, say, `0.9.0` is not: nothing is registered for a version
that never shipped. An uninterpretable version is a signal to be careful, not
to guess.

For this build, supported `1.0.0`, that reduces to: MAJOR must be `1`, MINOR
may be anything (`>= 0`), PATCH is ignored. `1.0.0`, `1.4.2` and `1.99.0` are
read; `2.0.0` and `0.9.9` are not.

### 3. What an unsupported store does — and does not do

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
  format 2.0.0)"; when it declared none, the notice says only that this version
  could not read them.

### 4. Verdicts are per store

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

### 5. A newer MINOR of a supported MAJOR

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

### 6. Entry-level schema check

Within a supported payload, each element of `comments` is checked
individually, and a failing entry is **skipped rather than crashing the
parse** — one malformed comment must not cost the reader the other forty.
An entry is kept when:

- it is a non-null object, and
- `id`, `author`, `createdAt` and `body` are all strings, and
- `anchor` is a non-null object whose `exact`, `prefix` and `suffix` are
  strings and whose `start` and `end` are numbers.

Then:

- `resolved` is `true` only if it is literally `true`; anything else is
  `false`.
- `thread`, if it is not an array, becomes an empty one. Elements that are not
  valid replies (a non-null object with string `id`, `author`, `createdAt` and
  `body`) are dropped individually; the surviving replies keep their order.
- `comments` itself, if it is not an array, yields zero comments.

## Writer rules

- **Stamp the lowest version capable of representing the data being
  written — not the version the writer supports.** A writer that supports
  `1.4.0` but emits only fields that exist in `1.0.0` writes
  `"version": "1.0.0"`, so the store stays readable by every `1.x` reader.
  This is what the per-field **Min version** column is for: the stamp is the
  highest minimum among the fields actually present.
- **Retained fields from a newer version keep that newer version.** If a
  comment carries unknown keys read from a `1.4.0` store, writing it back
  stamps `1.4.0` — the store really does contain `1.4.0` data, and claiming
  `1.0.0` would lie to the next reader. When comments read from several stores
  are written together, the **highest** such version wins. A retained bag
  whose version was uninterpretable can never win that contest.
- **Both containers carry the same payload**: the same schema, the same
  `version` key in the same place. They differ only in how the JSON text is
  wrapped.
- **Serialization is byte-stable and idempotent.** Known keys are emitted in
  the fixed order of the tables above (`id`, `author`, `createdAt`, `body`,
  `resolved`, `thread`, `anchor`; `exact`, `prefix`, `suffix`, `start`, `end`;
  `version` before `comments`), and retained unknown keys follow the known
  ones in the order they were read. Serializing the same comment set twice
  produces identical bytes, and attaching a trailer to a document that already
  has one replaces it rather than appending a second.
- **Never write a container for zero comments.** No empty trailer; no sidecar
  file holding an empty array — the trailer is omitted and the sidecar file is
  removed.
- **Never write a store the reader could not interpret.** If any of the
  document's stores was unsupported, nothing is written to either of them (see
  reader rule 3).

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
