import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Settings } from "@/domain/types";
import { LinearItem, PackRect, packLinear, packStock, ripPlanText } from "./packing";
import { compute } from "./compute";

const S = DEFAULT_SETTINGS;
const item = (length: number, label = "x"): LinearItem => ({ length, color: "#000", label, part: "p" });
const rect = (w: number, h: number, part = "p"): PackRect => ({ w, h, color: "#000", label: "x", part });

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

describe("packStock — store breakdown (panel-saw rip strips)", () => {
  // 96×48 sheet, 1/8" kerf, 1/2" trim on every store-cut edge.
  const BD = { trim: 0.5 };

  it("keeps normal-mode packing byte-identical when breakdown is off", () => {
    const { sheets } = packStock([rect(90, 12), rect(90, 12), rect(90, 12)], 96, 48, 0.125, false);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].strips).toBeUndefined();
    // shelves separated by kerf only — the pre-breakdown golden values
    expect(sheets[0].placements.map((p) => p.y)).toEqual([0, 12.125, 24.25]);
  });

  it("spaces shelves by trim + kerf + trim and plans the rips (golden)", () => {
    const { sheets } = packStock([rect(90, 12), rect(90, 12), rect(90, 12)], 96, 48, 0.125, false, BD);
    expect(sheets).toHaveLength(1);
    // parts sit 1/2" above each rough strip bottom (first shelf: factory edge, y=0)
    expect(sheets[0].placements.map((p) => p.y)).toEqual([0, 13.125, 26.25]);
    const strips = sheets[0].strips!;
    // 3 part strips + the freed offcut; rip line sits 1/2" above each shelf's parts
    expect(strips.map((st) => st.height)).toEqual([12.5, 13, 13, 9.125]);
    expect(strips.map((st) => st.y)).toEqual([0, 12.625, 25.75, 38.875]);
    expect(strips.map((st) => !!st.offcut)).toEqual([false, false, false, true]);
    expect(ripPlanText(strips, "in")).toBe('rips 12 1/2" → 13" → 13" · leaves 9 1/8" offcut');
  });

  it("absorbs a remainder narrower than 4\" into the last strip instead of ripping it free", () => {
    const { sheets } = packStock([rect(90, 22), rect(90, 22)], 96, 48, 0.125, false, BD);
    const strips = sheets[0].strips!;
    // second shelf tops out at 45.125 + trim → a rip at 45.625 would free only
    // 4 1/4"−kerf... < 4" of stock, so the last strip runs to the factory edge.
    expect(strips.map((st) => st.height)).toEqual([22.5, 25.375]);
    expect(strips.some((st) => st.offcut)).toBe(false);
    expect(ripPlanText(strips, "in")).toBe('rips 22 1/2" · leaves 25 3/8"');
  });

  it("says so when a sheet needs no rip at all", () => {
    // 45 + trim + kerf leaves < 4" — nothing worth freeing above the one shelf
    const { sheets } = packStock([rect(90, 45)], 96, 48, 0.125, false, BD);
    const strips = sheets[0].strips!;
    expect(strips).toHaveLength(1);
    expect(strips[0]).toEqual({ y: 0, height: 48 });
    expect(ripPlanText(strips, "in")).toBe("no rips — carry as-is");
  });

  it("invariants: strips tile the sheet and every part clears every store-cut edge by the trim", () => {
    const jumble = [
      rect(30, 23), rect(30, 23), rect(84, 11.25), rect(84, 11.25), rect(40, 15),
      rect(22.5, 15), rect(34.5, 22.5), rect(18, 10), rect(60, 4), rect(60, 4),
      rect(47.5, 16), rect(29, 13.75),
    ];
    const kerf = 0.125;
    const trim = 0.5;
    const { sheets, oversize } = packStock(jumble, 96, 48, kerf, true, { trim });
    expect(oversize).toHaveLength(0);
    const eps = 1e-6;
    for (const sheet of sheets) {
      const strips = sheet.strips!;
      expect(strips[0].y).toBe(0);
      for (let i = 1; i < strips.length; i++) {
        expect(strips[i].y).toBeCloseTo(strips[i - 1].y + strips[i - 1].height + kerf, 6);
      }
      expect(strips[strips.length - 1].y + strips[strips.length - 1].height).toBeCloseTo(48, 6);
      for (const p of sheet.placements) {
        const i = strips.findIndex(
          (st) => p.y >= st.y - eps && p.y + p.h <= st.y + st.height + eps,
        );
        expect(i).toBeGreaterThanOrEqual(0); // fully inside exactly one strip
        const st = strips[i];
        expect(st.offcut).toBeUndefined(); // offcuts carry no parts
        if (i > 0) expect(p.y).toBeGreaterThanOrEqual(st.y + trim - eps);
        if (i < strips.length - 1) expect(p.y + p.h).toBeLessThanOrEqual(st.y + st.height - trim + eps);
      }
    }
  });
});

describe("compute — storeBreakdown setting flows through to the packs", () => {
  const cabs = [makeCabinet("base", "B1", { width: 30 }), makeCabinet("wall", "W1", { width: 30 })];

  it("plans no strips by default", () => {
    const m = compute(cabs, S as Settings);
    expect(m.summary.storeCuts).toBe(0);
    for (const pack of m.packs)
      for (const sh of pack.sheets) expect(sh.strips).toBeUndefined();
  });

  it("plans strips on every sheet of every stock when on, and counts the rips", () => {
    const m = compute(cabs, { ...S, storeBreakdown: true } as Settings);
    let cuts = 0;
    for (const pack of m.packs) {
      for (const sh of pack.sheets) {
        expect(sh.strips!.length).toBeGreaterThan(0);
        cuts += sh.strips!.length - 1;
      }
    }
    expect(cuts).toBeGreaterThan(0);
    expect(m.summary.storeCuts).toBe(cuts);
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
