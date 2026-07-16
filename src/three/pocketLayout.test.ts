import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Settings } from "@/domain/types";
import { pocketRow } from "@/engine/pocketHoles";
import { genParts } from "@/engine/parts";
import { pocketBoardLayout } from "./pocketLayout";

const PH: Settings = { ...DEFAULT_SETTINGS, pocketHoles: true };

describe("pocketBoardLayout — the bench-view marker positions", () => {
  it("spreads a panel's pockets across each joining end (golden)", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const bottom = genParts(c, PH).parts.find((p) => p.name === "Bottom")!;
    const row = pocketRow(bottom, PH)!;
    const lay = pocketBoardLayout(bottom, row);
    expect(lay.thickness).toBe(0.75);
    expect(lay.markers).toHaveLength(row.perPiece); // 3 per end × 2 ends
    // ends sit 1 3/4" in; rows spread evenly across the width (the depth)
    const xs = [...new Set(lay.markers.map((m) => m.x))].sort((a, b) => a - b);
    expect(xs).toEqual([1.75, +(bottom.length - 1.75).toFixed(3)]);
    const zs = lay.markers.filter((m) => m.toward === -1).map((m) => m.z);
    expect(zs).toEqual([
      +(bottom.width / 4).toFixed(3),
      +(bottom.width / 2).toFixed(3),
      +((3 * bottom.width) / 4).toFixed(3),
    ]);
  });

  it("keeps two pockets per end on a narrow stretcher, inset scaled to fit", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const st = genParts(c, PH).parts.find((p) => p.name === "Top stretcher")!;
    const lay = pocketBoardLayout(st, pocketRow(st, PH)!);
    expect(lay.markers).toHaveLength(4);
    expect(lay.markers.filter((m) => m.toward === 1)).toHaveLength(2);
    // markers never land outside the board
    for (const m of lay.markers) {
      expect(m.x).toBeGreaterThan(0);
      expect(m.x).toBeLessThan(st.length);
      expect(m.z).toBeGreaterThan(0);
      expect(m.z).toBeLessThan(st.width);
    }
  });
});
