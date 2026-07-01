import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Cabinet, Settings } from "@/domain/types";
import { compute } from "./compute";
import { membersSharePartition, runsOf } from "./runs";

const ON: Settings = { ...DEFAULT_SETTINGS, sharedPartitions: true };

/** A based bay (rides a toe kick) followed by a floor-standing bay — same run,
 *  but mismatched box extents, so their joint must never merge. */
function toeKickThenFloor(): Cabinet[] {
  return [
    makeCabinet("base", "A", { width: 24, construction: "framed", overlay: "inset_rail", toeKick: true }),
    makeCabinet("base", "B", { width: 24, construction: "framed", overlay: "inset_rail", toeKick: false }),
  ];
}

/** Two lined-up, floor-standing framed bases join into one continuous-frame run. */
function twoFloorBays(): Cabinet[] {
  return [
    makeCabinet("base", "A", { width: 24, construction: "framed", overlay: "inset_rail", toeKick: false }),
    makeCabinet("base", "B", { width: 24, construction: "framed", overlay: "inset_rail", toeKick: false }),
  ];
}

/** Tally the vertical carcass panels across every cabinet's cut list. */
function panels(cabs: Cabinet[], s: Settings) {
  const t = { side: 0, end: 0, shared: 0 };
  for (const cp of compute(cabs, s).cabinetParts)
    for (const p of cp.parts) {
      if (p.name === "Side panel") t.side += p.qty;
      else if (p.name === "End panel") t.end += p.qty;
      else if (p.name === "Shared partition") t.shared += p.qty;
    }
  return t;
}

describe("sharedPartitions", () => {
  it("is off by default → every box carries both of its own sides", () => {
    expect(DEFAULT_SETTINGS.sharedPartitions).toBe(false);
    expect(panels(twoFloorBays(), DEFAULT_SETTINGS)).toEqual({ side: 4, end: 0, shared: 0 });
  });

  it("merges a lined-up joint onto ONE shared partition (members + 1 panels, not 2·members)", () => {
    // 2 bays → 3 vertical panels: the run ends stay their own sides, the joint
    // collapses to a single shared partition owned by the left bay.
    expect(panels(twoFloorBays(), ON)).toEqual({ side: 2, end: 0, shared: 1 });
  });

  it("sizes the shared partition like a box side (box height × carcass depth)", () => {
    const parts = compute(twoFloorBays(), ON).cabinetParts.flatMap((cp) => cp.parts);
    const sp = parts.find((p) => p.name === "Shared partition")!;
    expect(sp.qty).toBe(1);
    expect([sp.length, sp.width]).toEqual([34.5, 23.25]); // 24 deep − 3/4 applied back
  });

  it("grows the shared bay's interior panels to reach the centred partition (no 3D ↔ cut-list drift)", () => {
    const bottom = (cabs: Cabinet[], s: Settings) =>
      compute(cabs, s).cabinetParts.flatMap((cp) => cp.parts).find((p) => p.name === "Bottom")!.length;
    expect(bottom(twoFloorBays(), DEFAULT_SETTINGS)).toBe(22.5); // 24 − two full 3/4" sides
    expect(bottom(twoFloorBays(), ON)).toBe(22.875); // one side shared → −3/4 −3/8 to the centred panel
  });

  it("does NOT share across a toe-kick mismatch — a based bay beside a floor bay keeps its side", () => {
    // A join is allowed (same type/height/depth/construction) but the box extents
    // differ: the based bay rides a 4.5" toe kick, the floor bay sits at 0.
    expect(panels(toeKickThenFloor(), ON).shared).toBe(0);
    // Same panel tally whether sharing is on or off — the mismatch is never merged.
    expect(panels(toeKickThenFloor(), ON)).toEqual(panels(toeKickThenFloor(), DEFAULT_SETTINGS));
  });

  // The predicate the cut list AND the 3D scene both call — pinning it here keeps
  // the two renderers from drifting (the 3D geometry itself can't run under node).
  describe("membersSharePartition", () => {
    it("is true for two lined-up floor bays, but only when the flag is on", () => {
      const [run] = runsOf(twoFloorBays(), ON);
      expect(membersSharePartition(run.members[0], run.members[1], ON)).toBe(true);
      expect(membersSharePartition(run.members[0], run.members[1], DEFAULT_SETTINGS)).toBe(false);
    });

    it("is false across a toe-kick / floor mismatch even with the flag on", () => {
      const [run] = runsOf(toeKickThenFloor(), ON);
      expect(membersSharePartition(run.members[0], run.members[1], ON)).toBe(false);
    });
  });
});
