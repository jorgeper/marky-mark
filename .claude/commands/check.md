Run the quick inner-loop gate and report.

Steps:
1. Run `npm run validate:quick` (capture full output).
2. If it prints `QUICK VALIDATION: ALL PASSED`, report the pass with the unit/e2e counts.
3. If it fails: identify the failing step and test(s), read the relevant test + code, and diagnose the root cause. Report the diagnosis and the minimal fix — apply it only if it is a product-code fix.

Rules:
- NEVER weaken, skip, or delete a test to make the gate pass. If a test seems wrong, say so and stop for a decision.
- This is the inner-loop tier: do not run the full validate, web builds, or cargo here.
