import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
// @ts-expect-error — the control panel is plain untyped CommonJS Node.
import { parseRuns } from '../../control-panel/server.js';

/** One timings.jsonl entry. */
type Timing = { ts: string; phase: string; ms: number; ok: boolean; issue?: string };

/** What the panel renders per run block; only the fields under test are named. */
type Run = { status: string; durationMs: number | null; endedAt: string | null };

const runs = (file: string, content: string, mtimeMs: number, timings: Timing[]): Run[] =>
  (parseRuns as (f: string, c: string, m: number, t: Timing[]) => Run[])(file, content, mtimeMs, timings);

describe('control panel agent-run status', () => {
  // parseRuns decides running-vs-interrupted against the real clock (mtime
  // within RUNNING_WINDOW_MS of now), so pin now to the moment of the
  // reproduced logs — on a live clock the running-lane case below stops
  // passing 15 minutes after its hardcoded mtime.
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-08-03T22:12:50Z') }));
  afterEach(() => vi.useRealTimers());

  // Reproduces the real 2026-08-03 logs: issue 32's implementer finished in
  // 2m32s while issue 31's implementer — started 9s earlier — was still
  // working. On phase+time matching alone, 31 adopted 32's entry and the
  // panel showed it as "success", so the Running filter came up empty.
  test('a running lane does not adopt a parallel lane\'s finished timings entry', () => {
    const timings: Timing[] = [
      { ts: '2026-08-03T22:09:01.431Z', phase: 'implementer', ms: 152210, ok: true, issue: '32' },
    ];
    const running =
      '--- Run started: 2026-08-03T22:06:20.263Z ---\n' +
      '[22:06:25] Iteration 1/4\n' +
      '[22:12:42] Bash(npm run validate:quick 2>&1 | tail -40)\n';

    const [run] = runs(
      'sandcastle-issue-31-implementer.log',
      running,
      Date.parse('2026-08-03T22:12:42Z'), // log touched moments ago
      timings,
    );

    expect(run.status).toBe('running');
    expect(run.durationMs).toBeNull(); // not 32's 2m32s
    expect(run.endedAt).toBeNull();
  });

  test('a lane still matches its own timings entry', () => {
    const timings: Timing[] = [
      { ts: '2026-08-03T22:09:01.431Z', phase: 'implementer', ms: 152210, ok: true, issue: '32' },
    ];
    const finished =
      '--- Run started: 2026-08-03T22:06:29.231Z ---\n' +
      '[22:06:35] Iteration 1/1\n' +
      '[22:09:01] Run complete: agent finished after 1 iteration(s).\n';

    const [run] = runs(
      'sandcastle-issue-32-implementer.log',
      finished,
      Date.parse('2026-08-03T22:09:01Z'),
      timings,
    );

    expect(run.status).toBe('success');
    expect(run.durationMs).toBe(152210);
  });

  // Main-scoped logs (planner) carry no issue, and their timings entries carry
  // none either — the pairing must still hold.
  test('an issue-less phase matches its issue-less entry', () => {
    const timings: Timing[] = [
      { ts: '2026-08-03T22:06:02.801Z', phase: 'planner', ms: 16571, ok: true },
    ];
    const planner =
      '--- Run started: 2026-08-03T22:05:46.230Z ---\n' +
      '[22:05:50] Agent started\n';

    const [run] = runs('main-planner.log', planner, Date.parse('2026-08-03T22:06:02Z'), timings);

    expect(run.status).toBe('success');
    expect(run.durationMs).toBe(16571);
  });
});
