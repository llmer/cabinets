import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet, seedCabinets } from "@/domain/defaults";
import { Settings } from "@/domain/types";
import { compute } from "./compute";
import { packStock } from "./packing";

const S: Settings = DEFAULT_SETTINGS;

describe("packStock", () => {
  it("places every part that fits", () => {
    const rects = Array.from({ length: 10 }, () => ({
      w: 24,
      h: 12,
      color: "#000",
      label: "x",
      part: "p",
    }));
    const { sheets, oversize } = packStock(rects, 96, 48, 0.125, true);
    const placed = sheets.reduce((a, s) => a + s.placements.length, 0);
    expect(placed).toBe(10);
    expect(oversize).toHaveLength(0);
  });

  it("flags parts larger than a sheet as oversize", () => {
    const rects = [{ w: 200, h: 10, color: "#000", label: "x", part: "p" }];
    const { oversize } = packStock(rects, 96, 48, 0.125, false);
    expect(oversize).toHaveLength(1);
  });

  it("uses rotation to fit a tall narrow part", () => {
    // 60 tall won't fit a 48-tall sheet upright, but 60 wide fits.
    const rects = [{ w: 10, h: 60, color: "#000", label: "x", part: "p" }];
    const noRot = packStock(rects, 96, 48, 0.125, false);
    const withRot = packStock(rects, 96, 48, 0.125, true);
    expect(noRot.oversize).toHaveLength(1);
    expect(withRot.oversize).toHaveLength(0);
  });
});

describe("compute — full model on the seed kitchen", () => {
  const m = compute(seedCabinets(), S);

  it("summarizes counts", () => {
    expect(m.summary.count).toBe(6);
    // 6 cabinets + 2 run-level toe-kick base groups (the contiguous base run
    // B1–B3, and the tall T1 on its own). Walls carry no toe kick → no group.
    // The build walkthrough stays per-cabinet, so stepGroups holds at 6.
    expect(m.cutGroups).toHaveLength(8);
    expect(m.stepGroups).toHaveLength(6);
    expect(m.legend).toHaveLength(8);
    expect(m.cutGroups.filter((g) => g.typeLabel === "Run")).toHaveLength(2);
  });

  it("nests without oversize parts and gives a sane yield", () => {
    expect(m.summary.oversize).toBe(0);
    expect(m.summary.sheetCount).toBeGreaterThan(0);
    expect(m.summary.yieldPct).toBeGreaterThan(0);
    expect(m.summary.yieldPct).toBeLessThanOrEqual(100);
  });

  it("computes hardware totals", () => {
    expect(m.summary.doors).toBeGreaterThan(0);
    expect(m.summary.hinges).toBeGreaterThanOrEqual(m.summary.doors * 2);
    expect(m.summary.slides).toBe(m.summary.drawers);
  });

  it("cost breakdown sums to the total", () => {
    const sum = m.cost.lines.reduce((a, l) => a + l.amount, 0);
    expect(sum).toBeCloseTo(m.cost.total, 6);
    expect(m.cost.total).toBeGreaterThan(0);
  });

  it("every sheet-good piece is either placed or oversize", () => {
    let placed = 0;
    for (const p of m.packs) {
      placed += p.sheets.reduce((a, s) => a + s.placements.length, 0);
      placed += p.oversize.length;
    }
    // Count from the cut groups so run-level parts (the toe-kick base) are
    // included alongside the per-cabinet parts — both flow through nesting.
    const sheetPieces = m.cutGroups
      .flatMap((g) => g.parts)
      .filter((cp) => !cp.part.linear)
      .reduce((a, cp) => a + cp.qty, 0);
    expect(placed).toBe(sheetPieces);
  });
});

describe("compute — face-frame run lists hardwood separately", () => {
  it("reports frame linear footage and does not nest it", () => {
    const cabs = [
      makeCabinet("base", "B1", { construction: "framed", frontStyle: "doors" }),
    ];
    const m = compute(cabs, S);
    expect(m.summary.framed).toBe(true);
    expect(m.summary.frameLF).toBeGreaterThan(0);
    // hardwood is linear -> never appears as a nested rect
    const hasHardwoodRect = m.packs.some((p) => p.stockId === "hardwood");
    expect(hasHardwoodRect).toBe(false);
  });
});

describe("compute — millimetre display", () => {
  it("formats dimensions in mm without changing the math", () => {
    const cabs = seedCabinets();
    const inModel = compute(cabs, S);
    const mmModel = compute(cabs, { ...S, units: "mm" });
    expect(mmModel.summary.sheetCount).toBe(inModel.summary.sheetCount);
    expect(mmModel.cutGroups[0].parts[0].lenStr).toMatch(/mm$/);
  });
});

describe("compute — run-level build walkthrough", () => {
  it("a multi-cabinet framed run builds each box, then ONE run-level face-frame group", () => {
    const a = makeCabinet("base", "A", { construction: "framed", overlay: "inset", frontStyle: "doors", doorCount: 2 });
    const b = makeCabinet("base", "B", { construction: "framed", overlay: "inset", frontStyle: "drawers", drawerCount: 3 });
    const m = compute([a, b], { ...S, continuousFaceFrame: true });
    // per-cabinet groups no longer carry the face frame or the fronts
    const boxGroups = m.stepGroups.filter((g) => !g.runCabinetIds);
    expect(boxGroups.length).toBe(2);
    for (const g of boxGroups) {
      const stages = g.steps.map((st) => st.stage);
      expect(stages).not.toContain("faceFrame");
      expect(stages).not.toContain("doors");
      expect(stages).not.toContain("pulls");
    }
    // exactly one run-level group, covering both cabinets, that fits the one frame
    const runGroups = m.stepGroups.filter((g) => g.runCabinetIds);
    expect(runGroups).toHaveLength(1);
    expect(runGroups[0].runCabinetIds).toEqual([a.id, b.id]);
    expect(runGroups[0].steps.some((st) => /ONE continuous/i.test(st.t))).toBe(true);
    expect(runGroups[0].steps.some((st) => st.stage === "doors")).toBe(true);
  });

  it("a single framed cabinet keeps its own per-box frame (no run group)", () => {
    const a = makeCabinet("base", "Solo", { construction: "framed", frontStyle: "doors", doorCount: 2 });
    const m = compute([a], { ...S, continuousFaceFrame: true });
    expect(m.stepGroups.filter((g) => g.runCabinetIds)).toHaveLength(0);
    expect(m.stepGroups[0].steps.some((st) => st.stage === "faceFrame")).toBe(true);
  });
});
