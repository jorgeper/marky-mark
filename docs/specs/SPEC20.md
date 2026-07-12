# SPEC20: Marky Mark v20 — Image paste & preview resize

Marky Mark becomes image-capable on the authoring side: paste an image into
the editor and it lands as a real file in a folder next to the document, with
a markdown reference inserted at the cursor; click an image in preview and
drag corner handles to resize it, persisted as portable HTML `width`.

Scope decisions (settled with Jorge, 2026-07-12):

- **Persistence format for resize is an HTML `<img>` tag** (`<img src="…"
  alt="…" width="500">`) — renders on GitHub and every CommonMark renderer.
  No Obsidian syntax (`![[…]]`), no Pandoc attributes.
- **Naming is a single pattern field with tokens** — no preset dropdown.
- **Paste is desktop-only.** The web build shows a quiet notice; the dev/e2e
  browser shim implements the seam against its virtual fs so the flow stays
  fully e2e-testable.
- **No new dependencies.** CSP byte-identical. SPEC11 network isolation
  unchanged (clipboard bytes are read via `Blob.arrayBuffer()`, no fetch).

## 1. Settings (FR-S)

A new **Editor** tab in the Settings panel (tab id `editor`, between General
and Hotkeys), opening with an **Images** section:

- **Folder name** — text field, default `images`. The folder pasted images
  are written into, created on demand *next to the document* (sibling of the
  `.md` file). Must be a single path segment: `/`, `\`, and `..` are
  rejected inline (field shows the validation hint and the last valid value
  is kept in settings).
- **File name pattern** — text field, default `{doc} {n}`. Tokens:
  - `{doc}` — document basename without extension (`mods.md` → `mods`)
  - `{n}` — smallest positive integer that makes the final filename unused
    in the target folder
  - `{date}` — local date `YYYY-MM-DD`
  - `{time}` — local time `HHMMSS`
  A live example line under the field renders the pattern against the
  current doc name (e.g. `mods 1.png`). If the pattern contains no `{n}`
  and the resulting name already exists, ` {n}` is implicitly appended so
  paste never overwrites an existing file.

Both settings live in `Settings` (`src/lib/settings.ts`) as `imageFolder`
and `imageNamePattern`, with the usual tolerant load (missing keys take
defaults; no settings-file version bump).

Filename hygiene: the expanded name is sanitized — characters `\ / : * ? "
< > |` and control chars are stripped, leading/trailing dots and spaces
trimmed, and Windows-reserved basenames (`con`, `prn`, `aux`, `nul`,
`com1`–`com9`, `lpt1`–`lpt9`, any case) get a `-img` suffix. Test fixtures
must construct such names at runtime, never as committed files.

## 2. Paste flow (FR-P)

In **edit mode** (including split edit), a paste whose clipboard data
contains one or more image items is intercepted by a CodeMirror
`domEventHandlers.paste` handler:

1. Untitled document (no `docPath`): show the app's transient notice
   ("Save the document first to paste images"), swallow the image items,
   done. Platforms without the seam (web build): notice "Image paste needs
   the desktop app".
2. For each image item, in clipboard order: pick the extension from the
   MIME type (`image/png` → `.png`, `image/jpeg` → `.jpg`, `image/gif` →
   `.gif`, `image/webp` → `.webp`; anything else → `.png`), expand the
   pattern (§1), and write the bytes to
   `dirname(docPath)/<imageFolder>/<name>.<ext>` via the platform seam.
3. Insert at the cursor, one per line:
   `![<name without extension>](<imageFolder>/<encoded filename>.<ext>)`
   — the path is percent-encoded (spaces → `%20`), forward slashes always.
4. The buffer change flows through the normal editor path: dirty flag,
   autosave-on-toggle, undo history (file write is not undone by ⌘Z; only
   the inserted text is).

Mixed clipboard (text + image, e.g. copied from a browser): image items
win; the text fallback is ignored for that paste. A paste with no image
items is untouched — the default CodeMirror behavior runs.

Failure to write (permissions, disk) shows the notice with the OS error
message; nothing is inserted.

## 3. Platform seam (FR-N)

`Platform` (`src/platform/types.ts`) gains one optional method:

```ts
/** Write bytes, creating parent directories. Absent where unsupported (web). */
writeBinaryFile?(path: string, bytes: Uint8Array): Promise<void>;
```

- **tauri.ts** — plugin-fs `mkdir(recursive)` + `writeFile`. Requires a
  capability/scope addition for binary writes under user-chosen document
  trees only if the existing fs scope doesn't already cover it; the aux
  window capability is unchanged.
- **browser.ts (dev/e2e shim)** — stores the bytes base64 in the virtual
  fs; `resolveAssetSrc` learns to return a `data:` URI for paths present in
  the virtual fs, so the pasted image actually renders in the shim preview
  and e2e can assert on it. Exposed through `window.__mmfs` unchanged
  (content is the base64 string).
- **web.ts** — method absent; §2 notice path.

Existence checks for `{n}` go through the platform too: tauri uses
plugin-fs `exists`; the shim uses its virtual fs. (Add `exists?(path):
Promise<boolean>` alongside if no equivalent is reachable from the
renderer today.)

## 4. Preview resize (FR-R)

### 4.1 Source mapping

The render pipeline (`src/lib/markdown.ts`) stamps every `<img>` that
originates from the document with its **source span**: `data-mm-src-start`
/ `data-mm-src-end` (0-based UTF-16 offsets into the markdown source),
taken from node positions in the same pass that stamps `data-mm-line`
(SPEC15 precedent — inert data attributes, sanitize schema extended for
exactly these two names plus `width`/`height` on `img`). Markdown images,
reference-style images, and raw HTML `<img>` in the source all carry
spans; the blocked-remote placeholder (SPEC11) is a `span`, not an `img`,
and is untouchable by design.

### 4.2 Interaction

In **preview mode** (the main rendered view; not the split-edit pane):

- Click an image → selected: outline, four corner handles, and a size
  badge (`500 × 663`). Click elsewhere or press Escape → deselected.
  Selection never enters the comment-anchor text space (attributes/overlay
  only, no text mutation — the SPEC6 anchor coordinate space is
  unchanged).
- Drag a corner handle → live aspect-locked resize (width clamped to
  40 px minimum and the natural width maximum; CSS still caps display at
  container width).
- Release → the image's source span is replaced in the document text with
  `<img src="…" alt="…" width="N">` (N = rounded CSS px; existing HTML
  `<img>` keeps its other attributes and just gets `width` set; `height`
  is never written — aspect follows naturally).
- Double-click a selected image → remove `width` (back to natural size):
  a markdown-syntax image whose width is removed returns to markdown
  syntax untouched only if it was never rewritten; once HTML, it stays
  HTML without `width`.
- The text replacement flows through the same buffer path as typing:
  dirty dot in the title, ⌘S / autosave-on-toggle semantics, re-render
  with fresh spans.

## 5. Tests (added: U43–U46, E71–E75, W8)

Unit (Vitest):

- **U43** pattern expansion: `{doc}`/`{date}`/`{time}` tokens, `{n}`
  picks the smallest free integer against a fake exists-set, implicit
  ` {n}` when the pattern lacks it and the name collides.
- **U44** filename sanitization: forbidden characters stripped, reserved
  basenames suffixed, never emits an empty name (falls back to `image`).
- **U45** source-span stamping: markdown image, reference image, and raw
  HTML `<img>` each carry correct `data-mm-src-start/end`; spans survive
  sanitize; remote images produce the placeholder span with no spans.
- **U46** span rewrite: replacing a span with the `<img>` tag yields the
  expected document text for markdown-syntax and already-HTML images,
  including the double-click width-removal case.

E2E (desktop shim):

- **E71** paste an image in edit mode: file appears in the virtual fs
  under `images/` with the pattern name, `![…](images/…)` inserted at the
  cursor, preview renders the image (data URI).
- **E72** second paste numbers `{n}` = 2; untitled doc shows the
  save-first notice and writes nothing.
- **E73** Settings → Editor tab: fields present with defaults, edits
  persist to settings.json, live example updates, `/`-containing folder
  rejected.
- **E74** preview resize: click selects (handles + badge), drag persists
  `<img … width>` into the buffer, dirty dot appears, re-render keeps the
  size.
- **E75** double-click removes the width; Escape deselects.

Web e2e:

- **W8** paste in the web build shows the needs-desktop notice and leaves
  the buffer unchanged.

## 6. Docs

- ARCHITECTURE.md: paste seam + resize source-span mapping paragraphs.
- README: one feature bullet ("paste images from the clipboard; drag to
  resize in preview") in the existing feature list.

## 7. Definition of Done (the /goal condition verifies exactly this)

`npm run validate` exits 0 — typecheck, U1–U46, E1–E41 + E45–E75, W1–W8,
single-file check, static bundle scan (fetch allowlist still 0), and
`VALIDATION: ALL PASSED` printed. CSP byte-identical, no new npm or cargo
dependencies, version files untouched at 0.2.0-alpha.5, sidecar/theme/
anchor formats unchanged, and no committed fixture file with a
Windows-reserved basename.
