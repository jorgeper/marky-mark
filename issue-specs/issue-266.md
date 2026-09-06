# Spec: Hosted: Insert Image should upload from the local machine, not demand the desktop app (#266)

## Goal

All acceptance criteria in issue-specs/issue-266.md are satisfied for issue
#266, with evidence visible in the session: on the hosted build Insert Image…
opens the browser's file picker and the chosen local image is stored as a
workspace blob under the document's image folder with its markdown reference
inserted at the cursor (never the "Insert Image needs the desktop app"
refusal), those bytes land through the existing `writeBinaryFile` seam
repaired by #267 rather than a new network call site, a member without the
write verb gets the named permission refusal and an expired session the
sign-in-again wording, desktop and static-web behaviour is unchanged,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #266.

## Acceptance criteria

### 1. Hosted Insert Image… uploads from the local machine

- On the hosted build, with a saved workspace document open in edit mode and
  the signed-in member holding the write verb, invoking Insert Image… — from
  the Edit menu (`cmd('insertImage', …)`, `src/lib/menuSpec.ts:338`), the
  SPEC41 Image ▸ submenu / smart-edit toolbar button
  (`smart-edit-insert-image`), and the `insertImage` command alike — opens the
  browser's own file-picker dialog for a file on the user's machine. The
  picker offers image types (the desktop dialog's filter list — png, jpg,
  jpeg, gif, webp, svg — is the reference).
- Choosing a file ends in the same state a desktop user gets, with upload
  replacing the local copy: the bytes are stored in the workspace under the
  document's image folder (`settings.imageFolder`, resolved as
  `p.join(p.dirname(docPath), folder)` exactly as `insertImage` and
  `pasteImages` already do), under a name derived from the picked file the
  way the desktop branch derives it (`sanitizeImageName` + `expandImageName`
  from `src/lib/imagePaste.ts`, collision-free against the live
  `readDirNames` listing), and the markdown reference produced by
  `imageMarkdownRef` is inserted at the cursor through the same
  `editorInsertRef` call the desktop branch uses.
- The stored image is a workspace blob like a pasted one (PRD 007 Req 8):
  it renders in preview for the author and for a second member holding
  `doc.read`, served through the API — not a `data:` URI held in one browser.
- Cancelling the picker inserts nothing and shows no notice.
- `Insert Image needs the desktop app` is never reachable on hosted.

### 2. One upload path, no second network call site

- The bytes land through the hosted platform's existing `writeBinaryFile`
  (`src/platform/hosted.ts:679`, the `?raw=1` PUT through the shared `api()`
  seam that #267 repaired). No new `fetch`/call site is added: the SPEC11
  §6.6 single-network-call-site bundle scan in `scripts/validate.mjs` still
  passes, and `uploadFile`'s separate `file.upload` route is not conscripted
  into this flow.
- Whatever picking seam hosted grows is a capability declared on `Platform`
  in `src/platform/types.ts` (path-returning `openImageDialog` cannot express
  a browser upload, so a new optional method — or an App-level hidden
  `<input type="file">` in the style of `upload-input`,
  `src/App.tsx:7951` — is expected). `insertImage` chooses its branch by which
  capabilities the platform offers, never by asking which flavor is running,
  matching the house rule stated in `src/lib/fileGrants.ts` and the
  `Platform` doc comments.
- The two branches of `insertImage` share the naming, collision and
  reference-insertion logic rather than duplicating it.

### 3. Gating and refusals stay honest

- Gating other than the desktop refusal is unchanged: not in edit mode →
  the existing toggle-edit notice; no `docPath` → "Save the document first to
  insert images".
- A member whose role lacks the verb the raw PUT requires (`file.create` for
  a new blob, `doc.edit` for an existing one) gets the named permission
  refusal #267 produces (e.g. "You need the file.create permission to do
  that."), shown as a notice — not a broken upload, and no markdown reference
  is inserted.
- A session that expired mid-edit surfaces the gate's re-auth wording via
  `isHostedSessionExpired`, exactly as `pasteImages` (`src/App.tsx:1622`)
  does — never a bare status code.
- Any other failure shows the "Couldn't insert the image: …" notice and
  inserts nothing.

### 4. Scope: hosted only, paste already works

- Desktop (Tauri) keeps its `openImageDialog` + `copyFile` copy-into-place
  path unchanged and E76 (`tests/e2e/images.spec.ts:120`) passes as written;
  the dev shim's prompt-driven picker (`src/platform/browser.ts:457`) and the
  images/smart-edit e2e suites are unaffected.
- The static single-file web build, which has neither seam, still shows
  "Insert Image needs the desktop app".
- The issue's paste companion is **out of scope**: the owner's comment
  retracts it — hosted paste already implements `writeBinaryFile` and its 401
  was fixed under #267. Do not regress it: E332
  (`tests/e2e/hosted.spec.ts:764`) and `tests/unit/hosted-image-write.test.ts`
  (U1177–U1179) still pass. If the shared logic of criterion 2 improves paste
  for free, that is welcome but not required.

### 5. Tests, citations and the gate

- Cheap-tier coverage first: extend `tests/unit/hosted-image-write.test.ts`
  (or a sibling in its style — the real hosted platform against the real
  server over HTTP) so the upload half is covered at unit cost: a picked
  image's bytes land as a workspace blob under the image folder with a
  collision-free name and are readable by a `doc.read` member, and a member
  lacking the write verb gets the named refusal with nothing stored. Any pure
  naming decision new to this flow gets a unit test beside
  `tests/unit/image-paste.test.ts`.
- One end-to-end test in `tests/e2e/hosted.spec.ts` drives the real picker
  (Playwright `setInputFiles` / `filechooser`) through to the inserted
  reference and the stored blob. New tests take fresh `E<n>` / `U<n>` numbers
  in each file's house style, and the desktop-shim e2e collection stays at or
  above `E2E_TEST_FLOOR` (479 in `scripts/validate.mjs`).
- New and changed behaviour carries the house citation comment naming the
  contract it implements (`SPEC20` follow-up / `SPEC41 §…` for the menu
  surface / `PRD 007 Req 8` for the hosted blob, plus issue #266), and
  `docs/MAP.md` matches what `npm run map` derives if citations or E-numbers
  moved — the quick gate diffs it.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the touched hosted tests). Run
  `npm run validate:quick` **once**, right before declaring the goal met —
  not after every change, and not as a start-of-attempt baseline beyond that
  same quick tier — and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #266 describing what
  changed, the seam chosen, and the gate evidence.

## Context

`insertImage` lives at `src/App.tsx:1644` (SPEC20 follow-up) and refuses when
the platform lacks `openImageDialog` + `copyFile`; `pasteImages` at
`src/App.tsx:1593` is the working model for the hosted write, including the
`isHostedSessionExpired` notice. The image helpers (`extForMime`,
`sanitizeImageName`, `expandImageName`, `imageMarkdownRef`) are all exported
from `src/lib/imagePaste.ts`.

Hosted's `writeBinaryFile` (`src/platform/hosted.ts:679`) already stores raw
bytes as a workspace blob through `api()` with `requestError` mapping 401 →
`HostedSessionExpiredError` and 403 → the named verb (#267); `readDirNames`
is at `src/platform/hosted.ts:458`. Hosted intentionally has no
`openImageDialog`/`copyFile` — there is no local filesystem to copy from —
which is why the seam question in criterion 2 is the design decision here.
The existing browser-picker precedent in this codebase is the Upload File…
hidden input (`src/App.tsx:7951`) feeding `folderUpload`
(`src/App.tsx:2166`).

Grep before opening files (`rg 'SPEC20' src`, `rg 'PRD 007 Req 8' src`,
`rg 'SPEC41' src`) and never read `src/App.tsx` end-to-end.
