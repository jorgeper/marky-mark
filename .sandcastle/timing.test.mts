import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { timed } from "./timing.mts";

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-timing-"));
  return join(dir, "logs", "timings.jsonl");
};

const readEntries = (path: string): Record<string, unknown>[] =>
  readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("timed", () => {
  it("returns the wrapped result and appends a timing entry with meta", async () => {
    const path = setup();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await timed("implementer", { issue: 8 }, async () => 42, path);

    expect(result).toBe(42);
    const [entry] = readEntries(path);
    expect(entry).toMatchObject({ phase: "implementer", issue: 8, ok: true });
    expect(typeof entry!.ms).toBe("number");
    expect(typeof entry!.ts).toBe("string");
  });

  it("records ok:false and rethrows when the wrapped fn fails", async () => {
    const path = setup();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      timed(
        "planner",
        {},
        async () => {
          throw new Error("boom");
        },
        path,
      ),
    ).rejects.toThrow("boom");

    const [entry] = readEntries(path);
    expect(entry).toMatchObject({ phase: "planner", ok: false });
  });

  it("prints timestamped start and finish lines", async () => {
    const path = setup();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });

    await timed("spec-writer", { issue: 3 }, async () => undefined, path);

    expect(lines[0]).toMatch(
      /^\[\d{2}:\d{2}:\d{2}\] ▶ spec-writer started \(issue=3\)$/,
    );
    expect(lines[1]).toMatch(
      /^\[\d{2}:\d{2}:\d{2}\] ■ spec-writer finished in \d+\.\ds \(issue=3\)$/,
    );
  });
});

describe("heartbeat", () => {
  it("prints a still-running line for active phases every two minutes", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    const path = setup();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = timed("implementer", { issue: 22 }, () => gate, path);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(
      lines.some((l) => /⏳ still running: implementer\(issue=22\) \d+\.\dm/.test(l)),
    ).toBe(true);

    release();
    await running;
    lines.length = 0;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(lines.some((l) => l.includes("still running"))).toBe(false);
    vi.useRealTimers();
  });
});
