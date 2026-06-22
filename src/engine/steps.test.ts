import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Settings } from "@/domain/types";
import { genParts } from "./parts";
import { genSteps } from "./steps";

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
});
