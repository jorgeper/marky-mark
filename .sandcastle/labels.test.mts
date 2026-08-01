import { describe, expect, it } from "vitest";
import { ALL_LABEL_DEFS } from "./github.mts";
import { LABEL_ROWS } from "./setup.mts";

// Tripwire: the init table (LABEL_ROWS) and the provisioned label set
// (ALL_LABEL_DEFS) drifted once — a new status label was created but never
// shown in the init output. They must always name the same labels.
describe("label vocabulary", () => {
  it("init table lists exactly the labels init provisions", () => {
    const provisioned = ALL_LABEL_DEFS.map((d) => d.name).sort();
    const displayed = LABEL_ROWS.map(([name]) => name).sort();
    expect(displayed).toEqual(provisioned);
  });

  it("provisions the requires-prd trigger label", () => {
    expect(ALL_LABEL_DEFS.map((d) => d.name)).toContain(
      "sandcastle:requires-prd",
    );
  });
});
