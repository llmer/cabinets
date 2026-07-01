import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Cabinet, Settings } from "@/domain/types";
import { baseSegments, runsOf } from "./runs";
import { genBaseParts, genRunFrameParts } from "./runParts";
import { compute } from "./compute";

const S: Settings = DEFAULT_SETTINGS;

/** The user's maple kitchen: 3 contiguous framed inset_rail base cabinets. */
function kitchen(): Cabinet[] {
  return [
    makeCabinet("base", "B1", {
      width: 30,
      frontStyle: "door_drawer",
      doorCount: 2,
      drawerCount: 1,
      shelves: 1,
      construction: "framed",
      overlay: "inset_rail",
      toeKick: true,
      drawerHeights: [6],
    }),
    makeCabinet("base", "B2", {
      width: 18,
      frontStyle: "opening",
      construction: "framed",
      overlay: "inset_rail",
      toeKick: false,
    }),
    makeCabinet("base", "B3", {
      width: 24,
      frontStyle: "desk",
      drawerCount: 1,
      construction: "framed",
      overlay: "inset_rail",
      toeKick: false,
      drawerHeights: [5],
    }),
  ];
}

describe("runsOf — grouping", () => {
  it("joins three contiguous same-spec base cabinets into one run", () => {
    const runs = runsOf(kitchen(), S);
    expect(runs).toHaveLength(1);
    expect(runs[0].lane).toBe("base");
    expect(runs[0].framed).toBe(true);
    expect(runs[0].members.map((m) => m.cabinet.name)).toEqual(["B1", "B2", "B3"]);
  });

  it("lays members out left to right with cumulative x", () => {
    const [run] = runsOf(kitchen(), S);
    expect(run.members.map((m) => [m.x0, m.x1])).toEqual([
      [0, 30],
      [30, 48],
      [48, 72],
    ]);
  });

  it("breaks the run at a runBreak flag", () => {
    const cabs = kitchen();
    cabs[1] = { ...cabs[1], runBreak: true };
    const runs = runsOf(cabs, S);
    expect(runs).toHaveLength(2);
    expect(runs[0].members.map((m) => m.cabinet.name)).toEqual(["B1"]);
    expect(runs[1].members.map((m) => m.cabinet.name)).toEqual(["B2", "B3"]);
  });

  it("breaks between a base run and a tall pantry", () => {
    const cabs = [...kitchen(), makeCabinet("tall", "T1", { height: 84, construction: "framed" })];
    const runs = runsOf(cabs, S);
    // base run [B1,B2,B3] + tall run [T1]
    expect(runs).toHaveLength(2);
    expect(runs[1].members.map((m) => m.cabinet.name)).toEqual(["T1"]);
  });
});

describe("genRunFrameParts — continuous frame", () => {
  const [run] = runsOf(kitchen(), S);

  it("emits shared stiles: members + 1, not 2 per box", () => {
    const stiles = genRunFrameParts(run, S).filter((p) => p.name === "Face-frame stile");
    expect(stiles).toHaveLength(4); // 3 bays → 4 stiles (was 6 with per-box frames)
    expect(stiles.every((p) => p.width === 1.5 && p.linear)).toBe(true);
    // Captured between the rails: every stile tops out under the 2" top rail
    // (34.5 − 2 = 32.5). B1's end stile rests on its bottom rail at box bottom +
    // a rail width (4.5 + 1.5 = 6) → 26.5; the stiles beside the open appliance
    // and desk bays have no bottom rail, so they run to the floor → 32.5.
    expect(stiles.map((p) => p.length).sort((a, b) => a - b)).toEqual([26.5, 32.5, 32.5, 32.5]);
  });

  it("widens each bay's opening at shared joints (half a stile, not a full one)", () => {
    expect(run.members.map((m) => m.openingWidth)).toEqual([27.75, 16.5, 21.75]);
  });

  it("runs ONE continuous top rail across the whole run, 2 inches wide", () => {
    const parts = genRunFrameParts(run, S);
    const tops = parts.filter((p) => p.name === "Face-frame top rail");
    expect(tops).toHaveLength(1); // one long board, not one per bay
    expect(tops[0].length).toBe(72); // the full run width (30 + 18 + 24)
    expect(tops[0].width).toBe(2); // wider than the 1.5" stiles
    expect(parts.filter((p) => p.name === "Face-frame stile").every((p) => p.width === 1.5)).toBe(true);
  });

  it("runs each bay's frame to its own bottom: 3.25 over the toe kick, floor at the open bays", () => {
    expect(run.members.map((m) => m.frameBottom)).toEqual([3.25, 0, 0]);
    expect(run.frameTop).toBe(34.5);
  });

  it("gives the toe-kicked bay a taller continuous bottom rail; the open bays none", () => {
    const parts = genRunFrameParts(run, S);
    const bottoms = parts.filter((p) => p.name === "Face-frame bottom rail");
    // only B1 is a closed cabinet → one bottom rail; B2 (opening) and B3 (desk)
    // stay open at the floor
    expect(bottoms).toHaveLength(1);
    // owns its corners: from the run's left edge (0, under the end stile) to the
    // B1|B2 joint stile it butts into (B1.openingLeft 1.5 + opening 27.75 = 29.25)
    expect(bottoms[0].length).toBe(29.25);
    expect(bottoms[0].width).toBe(2.75); // yB 4.5 + ff 1.5 − frameBottom 3.25
    // the desk still gets a rail UNDER its drawer (1 drawer → 1 mid rail)
    const deskMid = parts.filter((p) => p.name === "Face-frame mid rail" && p.length === 21.75);
    expect(deskMid).toHaveLength(1);
  });
});

describe("genBaseParts — separate toe-kick base under B1 only", () => {
  const [run] = runsOf(kitchen(), S);

  it("finds a single base segment (B1), since B2/B3 sit on the floor", () => {
    const segs = baseSegments(run);
    expect(segs).toHaveLength(1);
    expect(segs[0].map((m) => m.cabinet.name)).toEqual(["B1"]);
  });

  it("recesses both exposed ends 2 inches (run end + the appliance-bay side)", () => {
    const parts = genBaseParts(run, S);
    const fascia = parts.find((p) => p.name === "Toe-kick fascia")!;
    expect(fascia.width).toBe(4.5); // full toe-kick height
    expect(fascia.length).toBe(26); // 30 − 2 (left run end) − 2 (right, base stops vs B2)
    expect(fascia.role).toBe("base");
    expect(fascia.linear).toBe(false); // ply, nests into sheets
    const ret = parts.find((p) => p.name === "Toe-kick return")!;
    expect(ret.qty).toBe(2); // both exposed ends finished
    expect(ret.length).toBe(21); // depth 24 − toeKickDepth 3
  });
});

describe("degenerate runs never emit negative dimensions", () => {
  it("a floor-standing closed bay in a toe-kicked run gets a normal, non-negative bottom rail", () => {
    const cabs = [
      makeCabinet("base", "A", { construction: "framed", overlay: "inset", frontStyle: "doors", toeKick: true, height: 34.5, depth: 24 }),
      makeCabinet("base", "B", { construction: "framed", overlay: "inset", frontStyle: "doors", toeKick: false, height: 34.5, depth: 24 }),
    ];
    const [run] = runsOf(cabs, S);
    expect(run.members).toHaveLength(2); // they share one run (toeKick alone doesn't break it)
    const rails = genRunFrameParts(run, S).filter((p) => p.name === "Face-frame bottom rail");
    expect(rails.every((r) => r.width > 0)).toBe(true);
    expect(rails.map((r) => r.width).sort((a, b) => a - b)).toEqual([1.5, 2.75]);
  });

  it("clamps base fascia width to >= 0 for a narrow segment with a deep side recess", () => {
    const deep = { ...S, toeKickSideRecess: 6 };
    const cabs = [makeCabinet("base", "N", { construction: "framed", frontStyle: "doors", toeKick: true, width: 6, height: 34.5, depth: 24 })];
    const [run] = runsOf(cabs, deep);
    const base = genBaseParts(run, deep);
    expect(base.every((p) => p.length >= 0 && p.width >= 0)).toBe(true);
  });
});

describe("compute — continuous frame integration", () => {
  const m = compute(kitchen(), S);

  it("moves the face frame off the boxes onto one run group", () => {
    const b1 = m.cabinetParts.find((cp) => cp.cabinet.name === "B1")!;
    expect(b1.parts.some((p) => p.name === "Face-frame stile")).toBe(false);
    const runGroup = m.cutGroups.find((g) => g.typeLabel === "Run")!;
    expect(runGroup.name).toMatch(/Face frame \+ base · B1–B3/);
    expect(runGroup.parts.some((p) => p.name === "Face-frame stile")).toBe(true);
  });

  it("sizes B1's inset fronts to the wider run opening", () => {
    const b1 = m.cabinetParts.find((cp) => cp.cabinet.name === "B1")!;
    const front = b1.parts.find((p) => p.name === "Drawer front")!;
    // run opening 27.75 − 2·reveal = 27.5 (was 26.75 with a per-box frame)
    expect(front.length).toBe(27.5);
  });

  it("keeps the hardwood frame linear (priced by the foot, never nested)", () => {
    expect(m.summary.framed).toBe(true);
    expect(m.summary.frameLF).toBeGreaterThan(0);
    expect(m.packs.some((p) => p.stockId === "hardwood")).toBe(false);
  });

  it("drops B1's exposed end panel to the frame line so the side matches", () => {
    const b1 = m.cabinetParts.find((cp) => cp.cabinet.name === "B1")!;
    const side = b1.parts.find((p) => p.name === "Side panel")!;
    const end = b1.parts.find((p) => p.name === "End panel")!;
    expect(side.qty).toBe(1); // the interior side (abuts B2) stays at box height
    expect(side.length).toBe(30);
    expect(end.qty).toBe(1); // the exposed left end, taller
    expect(end.length).toBe(31.25); // boxTop 34.5 − frameBottom 3.25 (drops to the frame line)
    // a floor-standing run end (B3 desk) already reaches the floor → no end panel
    const b3 = m.cabinetParts.find((cp) => cp.cabinet.name === "B3")!;
    expect(b3.parts.some((p) => p.name === "End panel")).toBe(false);
  });
});
