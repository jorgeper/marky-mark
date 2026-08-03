# Launching the Marky Mark v20 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC20.md` first — the goal implements exactly what it
prescribes.

The statement stays under the /goal 4000-character limit by deferring all
detail to SPEC20's sections rather than restating them.

```
/goal Implement docs/specs/SPEC20.md in full (delta on SPEC.md–SPEC19.md as implemented; SPEC20 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved). Deliverable: image paste in the editor + click-to-resize in preview, exactly as SPEC20 prescribes: (1) §1 Settings — new Editor tab with Images section: imageFolder (default 'images', single path segment) and imageNamePattern (default '{doc} {n}', tokens {doc}/{n}/{date}/{time}, live example, implicit ' {n}' on collision), sanitized filenames (Windows-reserved basenames suffixed; no committed fixture may use one — runtime-constructed only). (2) §2 Paste — edit-mode CodeMirror handler writes clipboard images to dirname(docPath)/<imageFolder>/ and inserts percent-encoded ![](…) at the cursor; untitled → 'save first' notice; web → 'needs the desktop app' notice; normal dirty/undo/autosave path. (3) §3 Seam — optional Platform.writeBinaryFile (+exists if needed): tauri plugin-fs, browser shim virtual-fs base64 with data: URI resolveAssetSrc, web absent; aux capability unchanged. (4) §4 Resize — data-mm-src-start/end span stamping in markdown.ts (sanitize schema widened for exactly those two attrs + img width/height, nothing else); preview-only click→handles→drag (aspect-locked, 40px..natural)→release rewrites the span to <img src alt width=N>; double-click removes width; Escape/click-away deselects; comment-anchor space unchanged. (5) §5 Tests exactly U43–U46, E71–E75, W8. (6) §6 Docs — ARCHITECTURE.md paragraphs + one README bullet. Done when: 'npm run validate' exits 0 with complete output — U1–U46, E1–E41 plus E45–E75, W1–W8, single-file check, static bundle scan with fetch allowlist 0, and 'VALIDATION: ALL PASSED' printed in the transcript — AND the CSP in tauri.conf.json is byte-identical, AND 'git diff' shows no changes under docs/specs and no version-file changes (0.2.0-alpha.5), AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing, AND no new entries in package.json dependencies/devDependencies or src-tauri/Cargo.toml. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U43–U46, E71–E75, W8 (no amendments to existing tests); zero new dependencies; sidecar/trailer formats, theme format, comment-anchor space, SPEC11 webview network isolation, SPEC13 aux protocol, and SPEC14–19 behaviors unchanged. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

Manual checks (the parts automation can't see):

- In the desktop app, paste a real screenshot (⌘⇧4 space-copy or Copy
  Image from a browser) into a saved doc: the file lands in `images/`
  next to the doc with the pattern name, and renders inline.
- Paste into an *untitled* doc: friendly "save first" notice, no file.
- Resize with the handles in preview, save, open the file in another
  renderer (GitHub gist works): the `<img … width>` size is honored.
- Double-click returns the image to natural size.
- Check `~/Downloads/test-with-images.md` still renders all its standard
  cases identically (no regression from the sanitize-schema widening).
