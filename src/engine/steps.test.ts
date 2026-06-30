import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet, seedCabinets } from "@/domain/defaults";
import { Cabinet, Settings } from "@/domain/types";
import { genParts } from "./parts";
import { BUILD_STAGES, genSteps } from "./steps";

const S: Settings = DEFAULT_SETTINGS;

describe("genSteps", () => {
  it("numbers steps sequentially from 1", () => {
    const c = makeCabinet("base", "B1", { frontStyle: "doors", doorCount: 2, shelves: 1 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((st) => st.n)).toEqual(steps.map((_, i) => i + 1));
  });

  it("tags exactly one drawer-box step when the box has drawers", () => {
    const c = makeCabinet("base", "B2", { frontStyle: "drawers", drawerCount: 3 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    const drawerSteps = steps.filter((st) => st.kind === "drawerBoxes");
    expect(drawerSteps).toHaveLength(1);
  });

  it("emits no drawer-box step for a plain door cabinet", () => {
    const c = makeCabinet("wall", "W1", { frontStyle: "doors", doorCount: 2, shelves: 2 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    expect(steps.some((st) => st.kind === "drawerBoxes")).toBe(false);
  });

  // The build-tab 3D relies on stages advancing in assembly order so it can
  // light up the right parts. Exercise a spread of construction/overlay/front
  // combinations and the full seed run.
  const matrix: Cabinet[] = [
    ...seedCabinets(),
    makeCabinet("base", "framed-dd", { construction: "framed", frontStyle: "door_drawer", toeKick: true }),
    makeCabinet("base", "inset-dr", { overlay: "inset", frontStyle: "drawers", drawerCount: 3 }),
    makeCabinet("base", "railed", { overlay: "inset_rail", frontStyle: "door_drawer" }),
    makeCabinet("base", "appliance", { frontStyle: "opening", construction: "framed" }),
    makeCabinet("base", "desk", { frontStyle: "desk", drawerCount: 2, toeKick: false }),
    makeCabinet("tall", "pantry", { frontStyle: "doors", doorCount: 2, shelves: 4 }),
  ];

  it("gives every step a valid stage, starting at the side panels", () => {
    for (const c of matrix) {
      const { steps } = genSteps(genParts(c, S), S, "#000");
      expect(steps[0].stage).toBe("sides");
      for (const st of steps) expect(BUILD_STAGES).toContain(st.stage);
    }
  });

  // The build 3D reveals parts cumulatively, so each stage must form one
  // contiguous run — a stage may not reappear once the build has moved on (else
  // a "revealed" part would un-reveal). Note `base` can precede `faceFrame` (an
  // appliance surround is framed before it is stood in place), so the run order
  // is NOT a fixed global order — only contiguity matters.
  it("keeps each stage to a single contiguous run of steps", () => {
    for (const c of matrix) {
      const { steps } = genSteps(genParts(c, S), S, "#000");
      const runs = steps
        .map((st) => st.stage)
        .filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    }
  });

  it("always tags the drawer-box step as the `drawers` stage", () => {
    const c = makeCabinet("base", "B", { frontStyle: "drawers", drawerCount: 3 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    const db = steps.find((st) => st.kind === "drawerBoxes");
    expect(db?.stage).toBe("drawers");
  });

  it("gives drawers a distinct face-attach step + a pulls step, after the boxes", () => {
    const c = makeCabinet("base", "B", { frontStyle: "drawers", drawerCount: 3 });
    const stages = genSteps(genParts(c, S), S, "#000").steps.map((st) => st.stage);
    expect(stages).toContain("drawers"); // build the boxes
    expect(stages).toContain("drawerFronts"); // attach the faces — the gap the user flagged
    expect(stages).toContain("pulls"); // fit the pulls
    expect(stages.indexOf("drawerFronts")).toBeGreaterThan(stages.indexOf("drawers"));
    expect(stages[stages.length - 1]).toBe("pulls"); // walkthrough ends fully assembled
  });

  it("hangs the doors after the interior, so the build never ends on an open box", () => {
    const c = makeCabinet("base", "B", { frontStyle: "door_drawer", doorCount: 2 });
    const stages = genSteps(genParts(c, S), S, "#000").steps.map((st) => st.stage);
    // interior (boxes, shelves) precede the exterior faces (doors, fronts, pulls),
    // so the cutaway used to fit boxes never hides a face that is already on.
    expect(stages.indexOf("doors")).toBeGreaterThan(stages.indexOf("drawers"));
    expect(stages.indexOf("drawerFronts")).toBeGreaterThan(stages.indexOf("doors"));
    expect(stages[stages.length - 1]).toBe("pulls");
  });

  it("adds no drawer-front or pulls step to a frontless appliance opening", () => {
    const c = makeCabinet("base", "OP", { frontStyle: "opening" });
    const stages = genSteps(genParts(c, S), S, "#000").steps.map((st) => st.stage);
    expect(stages).not.toContain("pulls");
    expect(stages).not.toContain("drawerFronts");
    expect(stages).not.toContain("doors");
  });

  it("breaks the face frame into cut → assemble → attach (and never says 'mill')", () => {
    const c = makeCabinet("base", "FF", { construction: "framed", frontStyle: "doors", doorCount: 2 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    const ff = steps.filter((st) => st.stage === "faceFrame");
    expect(ff).toHaveLength(3);
    expect(ff.some((st) => /mill/i.test(st.t))).toBe(false);
    expect(ff[0].t).toMatch(/^Cut /);
  });

  it("breaks drawer-box creation into several operations, not one bundle", () => {
    const c = makeCabinet("base", "DR", { frontStyle: "drawers", drawerCount: 3 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    const boxSteps = steps.filter((st) => st.stage === "drawers");
    // slides + cut parts + groove/assemble + hang — at least four distinct beats
    expect(boxSteps.length).toBeGreaterThanOrEqual(4);
    // the dimension table still hangs off exactly one (the "cut the parts") step
    expect(boxSteps.filter((st) => st.kind === "drawerBoxes")).toHaveLength(1);
    expect(boxSteps.some((st) => /slides/i.test(st.t))).toBe(true);
    expect(boxSteps.some((st) => /square/i.test(st.t))).toBe(true);
  });
});
