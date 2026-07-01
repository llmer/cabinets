import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Settings } from "@/domain/types";
import { LinearItem, packLinear } from "./packing";
import { compute } from "./compute";

const S = DEFAULT_SETTINGS;
const item = (length: number, label = "x"): LinearItem => ({ length, color: "#000", label, part: "p" });

describe("packLinear — 1D hardwood cut layout", () => {
  it("lays parts largest-first onto one board, kerf between each cut", () => {
    const { boards, oversize } = packLinear([item(30), item(40), item(20)], 96, 0.125);
    expect(oversize).toHaveLength(0);
    expect(boards).toHaveLength(1);
    // sorted 40,30,20 → offsets step by length + 1/8" kerf
    expect(boards[0].cuts.map((c) => c.offset)).toEqual([0, 40.125, 70.25]);
    expect(boards[0].used).toBeCloseTo(90.25, 5);
  });

  it("opens a new board when the next cut + kerf won't fit", () => {
    // 50 + 1/8" + 46 = 96.125 > 96 → second board (without kerf it would just fit)
    const { boards } = packLinear([item(50), item(46)], 96, 0.125);
    expect(boards).toHaveLength(2);
    expect(boards.map((b) => b.cuts.length)).toEqual([1, 1]);
  });

  it("reports a part longer than a board as oversize", () => {
    const { boards, oversize } = packLinear([item(120), item(30)], 96, 0.125);
    expect(oversize.map((o) => o.length)).toEqual([120]);
    expect(boards).toHaveLength(1); // the 30 still lands
  });

  it("conserves length — every part is placed or oversize", () => {
    const items = [item(74), item(37.25), item(60), item(12)];
    const { boards, oversize } = packLinear(items, 96, 0.125);
    const placed = boards.flatMap((b) => b.cuts).reduce((a, c) => a + c.length, 0);
    const dropped = oversize.reduce((a, o) => a + o.length, 0);
    expect(placed + dropped).toBeCloseTo(74 + 37.25 + 60 + 12, 5);
  });

  it("packs the maple-v2 face frame onto 3 eight-foot boards", () => {
    const lengths = [74, 16.75, 26.5, 32.5, 32.5, 32.5, 15.25, 37.25];
    const { boards, oversize, usedLength } = packLinear(lengths.map((l) => item(l)), 96, 0.125);
    expect(oversize).toHaveLength(0);
    expect(boards).toHaveLength(3);
    expect(usedLength).toBeCloseTo(267.25, 5);
    // no board exceeds its length
    for (const b of boards) expect(b.used).toBeLessThanOrEqual(96 + 1e-6);
  });
});

describe("compute — hardwood lands in linearPacks, split by profile, off the sheets", () => {
  const cabs = [
    makeCabinet("base", "B1", { width: 30, construction: "framed", overlay: "inset_rail" }),
    makeCabinet("base", "B2", { width: 24, construction: "framed", overlay: "inset_rail" }),
  ];
  const m = compute(cabs, S as Settings);
  const hardwoodPacks = m.linearPacks.filter((p) => p.stockId === "hardwood");

  it("breaks the hardwood down into a separate board run per cross-section width", () => {
    expect(hardwoodPacks.length).toBeGreaterThan(0);
    // stiles (1 1/2") and the wider top rail (2") are different profiles.
    expect(new Set(hardwoodPacks.map((p) => p.width)).size).toBeGreaterThan(1);
    expect(hardwoodPacks.every((p) => p.thickness === S.stocks.hardwood.thickness)).toBe(true);
  });

  it("cuts the continuous top rail from a 2\"-wide board, not mixed with the stiles", () => {
    const topRailPack = hardwoodPacks.find((p) =>
      p.boards.some((b) => b.cuts.some((c) => c.part === "Face-frame top rail")),
    );
    expect(topRailPack).toBeTruthy();
    expect(topRailPack!.width).toBeCloseTo(S.faceFrameTop, 5); // 2", not the 1 1/2" stile width
  });

  it("never nests a hardwood part on a plywood sheet", () => {
    for (const pack of m.packs)
      for (const s2 of pack.sheets)
        expect(s2.placements.some((pl) => pl.part === "Face-frame top rail")).toBe(false);
  });
});
