Cut a macOS release for the version given in the invocation (e.g. `/release-mac 0.4.0-alpha.2`).

Steps, in order, each gated on the previous:
1. Preflight: clean `git status`, no unpushed commits, the version argument is a valid semver newer than the current one.
2. `npm run release:prepare -- <version>` (bumps the three version files + locks, commits).
3. `npm run validate` — must print `VALIDATION: ALL PASSED` (full output in the transcript).
4. `npm run licenses` — commit THIRD-PARTY-NOTICES.md only if it changed.
5. Windows-reserved-filename scan over the tree; must be clean.
6. `git push origin main`, then `git tag -a v<version> -m "Marky Mark <version>"` and `git push origin v<version>` — this starts the mac+web pipeline.
7. Watch the release.yml run to completion (poll `gh run view` about once a minute).
8. When the draft exists: verify the asset list (dmg, web html, SHA256SUMS.txt, app.tar.gz, latest.json), download, and `shasum -c SHA256SUMS.txt` (the .sig entries live in latest.json, not as assets).
9. STOP and report: draft URL, asset list, checksum results. Publishing (`gh release edit v<version> --draft=false --prerelease`) is the human's decision — run it ONLY if the invocation explicitly said to publish.

Rules:
- A failed gate aborts the cut BEFORE any push or tag. Never tag an unvalidated tree.
- If CI fails, diagnose; if a test needs timing headroom, timeouts may be raised but assertions never change. Retag only after the fix is pushed and the old tag produced no release.
- Windows is NOT part of this cut — /release-windows adds it later.
