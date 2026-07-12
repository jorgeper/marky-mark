Build and install a fast dogfood build of Marky Mark.

Steps:
1. Run `npm run ship:local` (quick gate → debug-profile .app → install to /Applications → relaunch).
2. Confirm the app relaunched: `pgrep -lx marky-mark` must list a process; report it.
3. Remind the user this is a DEBUG build (fast to produce, slower at runtime); performance judgments need `npm run build:app && npm run install:app`.

Rules:
- If the quick gate fails, stop — do not install a build that failed its gate. Diagnose per /check rules.
