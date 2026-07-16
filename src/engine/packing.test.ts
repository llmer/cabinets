import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Settings } from "@/domain/types";
import { BoardItem, LinearItem, PackRect, packBoards, packLinear, packStock, ripPlanText } from "./packing";
import { compute } from "./compute";

const S = DEFAULT_SETTINGS;
const item = (length: number, label = "x"): LinearItem => ({ length, color: "#000", label, part: "p" });
const bitem = (length: number, width: number, part = "p"): BoardItem => ({ length, width, color: "#000", label: "x", part });
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

describe("packBoards — rip the parts out of the boards on hand", () => {
  // The maple-v3 kitchen's continuous run frame vs. the boards actually bought:
  // one 3/4×2 1/2×7' and one 3/4×3 1/2×14'.
  const MAPLE_ITEMS: BoardItem[] = [
    bitem(74, 2, "Face-frame top rail"),
    bitem(16.75, 2.75, "Face-frame bottom rail"),
    bitem(26.5, 1.5, "Face-frame stile"),
    bitem(32.5, 1.5, "Face-frame stile"),
    bitem(32.5, 1.5, "Face-frame stile"),
    bitem(32.5, 1.5, "Face-frame stile"),
    bitem(15.25, 1.5, "Face-frame mid rail"),
    bitem(37.25, 1.5, "Face-frame mid rail"),
  ];
  const MAPLE_BOARDS = [
    { width: 2.5, length: 84, qty: 1 },
    { width: 3.5, length: 168, qty: 1 },
  ];

  it("fits the maple-v3 run frame on the 7' 1×3 + 14' 1×4 (golden)", () => {
    const { boards, oversize, shortfall, usedLength } = packBoards(MAPLE_ITEMS, MAPLE_BOARDS, 0.125);
    expect(oversize).toHaveLength(0);
    expect(shortfall).toHaveLength(0);
    expect(usedLength).toBeCloseTo(267.25, 5);
    expect(boards).toHaveLength(2);

    // Widest profile first: the 2 3/4" bottom rail claims the 1×4 …
    const b14 = boards[0];
    expect(b14.width).toBe(3.5);
    expect(b14.segments).toHaveLength(2);
    expect(b14.segments[0]).toMatchObject({ offset: 0, length: 16.75, ripWidth: 2.75 });
    expect(b14.segments[0].strips).toHaveLength(1);
    // … then the 1 1/2" stiles + mid rails rip 2-up from the rest of it,
    // balanced across both strips so the crosscut stays short.
    expect(b14.segments[1]).toMatchObject({ offset: 16.875, length: 91.75, ripWidth: 1.5 });
    expect(b14.segments[1].strips).toHaveLength(2);
    expect(b14.segments[1].strips[0].cuts.map((c) => c.offset)).toEqual([0, 37.375, 70]);
    expect(b14.segments[1].strips[0].cuts.map((c) => c.length)).toEqual([37.25, 32.5, 15.25]);
    expect(b14.segments[1].strips[1].cuts.map((c) => c.offset)).toEqual([0, 32.625, 65.25]);
    expect(b14.segments[1].strips[1].cuts.map((c) => c.length)).toEqual([32.5, 32.5, 26.5]);
    expect(b14.used).toBeCloseTo(108.625, 5); // ~59" of the 14-footer left over

    // The 2" top rail rips from the narrower 1×3 — not burned out of the 1×4.
    const b13 = boards[1];
    expect(b13.width).toBe(2.5);
    expect(b13.segments).toHaveLength(1);
    expect(b13.segments[0]).toMatchObject({ offset: 0, length: 74, ripWidth: 2 });
    expect(b13.segments[0].strips[0].cuts[0].part).toBe("Face-frame top rail");
    expect(b13.used).toBeCloseTo(74, 5);
  });

  it("counts rips a board's width can actually yield (kerf-aware)", () => {
    // 3 1/2" board rips two 1 1/2" strips (1.5 + 0.125 + 1.5 = 3.125), never three.
    const { boards, shortfall } = packBoards(
      [bitem(40, 1.5), bitem(40, 1.5), bitem(40, 1.5)],
      [{ width: 3.5, length: 96, qty: 1 }],
      0.125,
    );
    expect(boards).toHaveLength(1);
    expect(shortfall).toHaveLength(0);
    const seg = boards[0].segments[0];
    expect(seg.strips).toHaveLength(2);
    // first-fit: two 40s share strip 1 (40 + kerf + 40 ends at 80 1/8), the third opens strip 2
    expect(seg.strips[0].cuts.map((c) => c.offset)).toEqual([0, 40.125]);
    expect(seg.strips[1].cuts.map((c) => c.offset)).toEqual([0]);
    expect(seg.length).toBeCloseTo(80.125, 5);
  });

  it("spreads a profile across parallel strips instead of burning board length", () => {
    // Regression (found in adversarial review): stacking 60 + 40 end-to-end in
    // ONE strip would consume a 100 1/8" segment and strand the 35" × 1" part.
    // Balanced strips keep the segment at 60" so the 1" part still fits after.
    const { boards, shortfall } = packBoards(
      [bitem(60, 1.5), bitem(40, 1.5), bitem(35, 1)],
      [{ width: 3.5, length: 100.25, qty: 1 }],
      0.125,
    );
    expect(shortfall).toHaveLength(0);
    expect(boards).toHaveLength(1);
    expect(boards[0].segments).toHaveLength(2);
    expect(boards[0].segments[0]).toMatchObject({ offset: 0, length: 60, ripWidth: 1.5 });
    expect(boards[0].segments[0].strips.map((st) => st.cuts[0].length)).toEqual([60, 40]);
    expect(boards[0].segments[1]).toMatchObject({ offset: 60.125, length: 35, ripWidth: 1 });
  });

  it("shortens a 3-strip segment to the tightest balanced crosscut (MULTIFIT)", () => {
    // Regression (adversarial round 2): greedy strip choice packed
    // 20+3+2+2 into one strip (a 27 3/8" segment), stranding the 9" × 1" part.
    // The refined plan crosscuts at 21 1/4" — 20 | 18+3 | 17+2+2 — and the
    // 9" part still fits the board after it.
    const { boards, shortfall } = packBoards(
      [bitem(20, 1.5), bitem(18, 1.5), bitem(17, 1.5), bitem(3, 1.5), bitem(2, 1.5), bitem(2, 1.5), bitem(9, 1)],
      [{ width: 5, length: 30.5, qty: 1 }],
      0.125,
    );
    expect(shortfall).toHaveLength(0);
    expect(boards).toHaveLength(1);
    expect(boards[0].segments).toHaveLength(2);
    expect(boards[0].segments[0].length).toBeCloseTo(21.25, 5);
    expect(boards[0].segments[0].strips).toHaveLength(3);
    expect(boards[0].segments[1]).toMatchObject({ offset: 21.375, length: 9, ripWidth: 1 });
    expect(boards[0].used).toBeCloseTo(30.375, 5); // of 30.5
  });

  it("reports shortfall when the boards run out — not silently", () => {
    const { boards, shortfall } = packBoards(
      [bitem(60, 1.5), bitem(60, 1.5), bitem(60, 1.5), bitem(60, 1.5)],
      [{ width: 1.5, length: 96, qty: 1 }],
      0.125,
    );
    expect(boards).toHaveLength(1);
    expect(boards[0].segments[0].strips[0].cuts).toHaveLength(1); // 60 + kerf + 60 > 96
    expect(shortfall).toHaveLength(3);
  });

  it("opens another board of the same size while qty lasts", () => {
    const { boards, shortfall } = packBoards(
      [bitem(60, 1.5), bitem(60, 1.5)],
      [{ width: 1.5, length: 96, qty: 2 }],
      0.125,
    );
    expect(boards).toHaveLength(2);
    expect(shortfall).toHaveLength(0);
  });

  it("flags a part no board size can produce as oversize", () => {
    const { oversize, shortfall, boards } = packBoards(
      [bitem(20, 5), bitem(200, 1.5), bitem(30, 1.5)],
      MAPLE_BOARDS,
      0.125,
    );
    // 5" wide and 200" long fit no board; the 30" still lands.
    expect(oversize.map((o) => o.length).sort((a, b) => a - b)).toEqual([20, 200]);
    expect(shortfall).toHaveLength(0);
    expect(boards).toHaveLength(1);
  });

  it("conserves length — every part is placed, oversize, or shortfall", () => {
    const { boards, oversize, shortfall, usedLength } = packBoards(
      [...MAPLE_ITEMS, bitem(300, 1.5), bitem(90, 3)],
      MAPLE_BOARDS,
      0.125,
    );
    const placed = boards
      .flatMap((b) => b.segments)
      .flatMap((s2) => s2.strips)
      .flatMap((st) => st.cuts)
      .reduce((a, c) => a + c.length, 0);
    expect(placed).toBeCloseTo(usedLength, 5);
    const total = [...MAPLE_ITEMS, bitem(300, 1.5), bitem(90, 3)].reduce((a, x) => a + x.length, 0);
    const lost = oversize.reduce((a, x) => a + x.length, 0) + shortfall.reduce((a, x) => a + x.length, 0);
    expect(placed + lost).toBeCloseTo(total, 5);
  });

  it("never exceeds a board's physical length or rip count", () => {
    const jumble = [
      bitem(74, 2), bitem(16.75, 2.75), bitem(50, 1.5), bitem(50, 1.5), bitem(50, 1.5),
      bitem(50, 1.5), bitem(50, 1.5), bitem(24, 2), bitem(12, 1.5), bitem(12, 1.5),
    ];
    const kerf = 0.125;
    const { boards } = packBoards(jumble, [{ width: 3.5, length: 96, qty: 4 }], kerf);
    for (const b of boards) {
      expect(b.used).toBeLessThanOrEqual(b.length + 1e-6);
      let cursor = 0;
      for (const seg of b.segments) {
        expect(seg.offset).toBeGreaterThanOrEqual(cursor - 1e-6); // segments never overlap
        cursor = seg.offset + seg.length;
        const maxStrips = Math.floor((b.width + kerf + 1e-6) / (seg.ripWidth + kerf));
        expect(seg.strips.length).toBeLessThanOrEqual(maxStrips);
        for (const st of seg.strips) {
          expect(st.used).toBeLessThanOrEqual(seg.length + 1e-6);
          // cuts inside a strip are kerf-separated and inside the segment
          let x = 0;
          st.cuts.forEach((c, i2) => {
            if (i2 > 0) expect(c.offset).toBeCloseTo(x + kerf, 6);
            x = c.offset + c.length;
          });
          expect(x).toBeLessThanOrEqual(seg.length + 1e-6);
        }
      }
      expect(cursor).toBeLessThanOrEqual(b.length + 1e-6);
    }
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

describe("compute — hardwood boards on hand flip the stock to the rip-aware board plan", () => {
  const cabs = [
    makeCabinet("base", "B1", { width: 30, construction: "framed", overlay: "inset_rail" }),
    makeCabinet("base", "B2", { width: 24, construction: "framed", overlay: "inset_rail" }),
  ];
  const withBoards = (boards: { width: number; length: number; qty: number }[]): Settings =>
    ({
      ...S,
      stocks: { ...S.stocks, hardwood: { ...S.stocks.hardwood, boards } },
    }) as Settings;

  it("uses boardPacks instead of per-profile linearPacks when boards are set", () => {
    const m = compute(cabs, withBoards([{ width: 5.5, length: 144, qty: 4 }]));
    expect(m.linearPacks.filter((p) => p.stockId === "hardwood")).toHaveLength(0);
    expect(m.boardPacks).toHaveLength(1);
    const bp = m.boardPacks[0];
    expect(bp.stockId).toBe("hardwood");
    expect(bp.shortfall).toHaveLength(0);
    expect(bp.oversize).toHaveLength(0);
    // every hardwood part landed on a board
    const placed = bp.boards.flatMap((b) => b.segments).flatMap((s2) => s2.strips).flatMap((st) => st.cuts);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.reduce((a, c) => a + c.length, 0)).toBeCloseTo(bp.usedLength, 5);
  });

  it("counts board oversize in summary.oversize and shortfall in summary.boardShort", () => {
    // one tiny board: almost the whole frame can't be cut
    const m = compute(cabs, withBoards([{ width: 1.5, length: 20, qty: 1 }]));
    const bp = m.boardPacks[0];
    expect(bp.shortfall.length + bp.oversize.length).toBeGreaterThan(0);
    expect(m.summary.oversize).toBeGreaterThanOrEqual(bp.oversize.length);
    expect(m.summary.boardShort).toBe(bp.shortfall.length);
  });

  it("an empty boards list keeps the legacy per-profile plan", () => {
    const m = compute(cabs, withBoards([]));
    expect(m.boardPacks).toHaveLength(0);
    expect(m.linearPacks.filter((p) => p.stockId === "hardwood").length).toBeGreaterThan(0);
  });
});

describe("compute — pocketPlan rides the Model when the setting is on", () => {
  const cabs = [
    makeCabinet("base", "B1", { width: 30, construction: "framed", overlay: "inset_rail", frontStyle: "door_drawer", drawerCount: 1 }),
    makeCabinet("base", "B2", { width: 24, construction: "framed", overlay: "inset_rail", frontStyle: "desk", drawerCount: 1, toeKick: false }),
  ];

  it("is null by default and populated when pocketHoles is on", () => {
    expect(compute(cabs, S as Settings).pocketPlan).toBeNull();
    const m = compute(cabs, { ...S, pocketHoles: true } as Settings);
    expect(m.pocketPlan).toBeTruthy();
    expect(m.pocketPlan!.totals.length).toBeGreaterThan(0);
    // one frame entry, keyed to the run's cut group id
    expect(m.pocketPlan!.frames).toHaveLength(1);
    const runGroup = m.cutGroups.find((g) => g.typeLabel === "Run")!;
    expect(m.pocketPlan!.frames[0].id).toBe(runGroup.id);
    // the frame's fine-thread screws are included in the merged totals
    const fine = m.pocketPlan!.totals.find((t) => t.spec.thread === "fine");
    expect(fine).toBeTruthy();
    expect(fine!.count).toBe(m.pocketPlan!.frames[0].screws);
  });
});
