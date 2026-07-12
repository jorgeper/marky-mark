Add the Windows installer to an existing release tag (e.g. `/release-windows v0.4.0-alpha.2`).

Steps:
1. Verify the tag's release exists (`gh release view <tag>`); note whether it is draft or published.
2. `gh workflow run release-windows.yml -f tag=<tag>`.
3. Watch the run to completion (gate → NSIS build → attach job).
4. Verify: the release now carries `*-setup.exe`, SHA256SUMS.txt covers ALL assets (download + `shasum -c`, ignoring the .sig lines), and latest.json contains a `windows-x86_64` platform entry.
5. If the release was already published, confirm the updater-manifest run the workflow dispatched also succeeded.
6. Report the final asset list.

Rules:
- Never edit the release's publish state here; this command only appends Windows.
- A failed gate or build changes nothing on the release — safe to rerun after fixing.
