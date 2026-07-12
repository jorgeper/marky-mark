Run the full feature-complete gate and print the evidence.

Steps:
1. Run `npm run validate` (this is the ~4 min full gate; run it to completion).
2. Print the evidence block into the chat: unit test counts, desktop e2e count, web e2e count, single-file check line, bundle-scan line, and the final `VALIDATION: ALL PASSED`.
3. If it fails: diagnose the failing step/tests (root cause, not symptom), report, and only fix product code.

Rules:
- Only `VALIDATION: ALL PASSED` from THIS command is commit/release evidence — the quick gate's pass-line never is.
- NEVER weaken, skip, or delete a test to make the gate pass.
