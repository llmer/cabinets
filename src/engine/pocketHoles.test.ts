import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Settings, Stock } from "@/domain/types";
import { genParts } from "./parts";
import {
  framePocketScrews,
  jigSetting,
  pocketRow,
  pocketSpec,
  pocketScrewTotals,
  pocketsPerEnd,
  screwLabel,
  screwLength,
} from "./pocketHoles";
import { runsOf } from "./runs";
import { runFrameJoints } from "./runParts";
import { genSteps } from "./steps";

const S: Settings = DEFAULT_SETTINGS;
const PH: Settings = { ...S, pocketHoles: true };
const sheet = (thickness: number): Stock =>
  ({ id: "x", label: "x", kind: "sheet", thickness, sheetW: 96, sheetH: 48, costPerSheet: 0, costPerFoot: 0 });

describe("pocketHoles — jig settings + screw chart", () => {
  it("snaps stock thickness to the jig's 1/8\" stops", () => {
    expect(jigSetting(0.71875)).toBe(0.75); // 23/32 ply drills at the 3/4 stop
    expect(jigSetting(0.5)).toBe(0.5);
    expect(jigSetting(0.59375)).toBe(0.625); // 19/32 → 5/8
    expect(jigSetting(0.46875)).toBe(0.5); // 15/32 still rounds up safely
    expect(jigSetting(2)).toBe(1.5); // clamps to the jig's maximum
  });

  it("refuses stock below the jig's range instead of giving unsafe advice", () => {
    expect(jigSetting(0.375)).toBeNull(); // 3/8 stock: no pocket-hole spec
    expect(pocketSpec(sheet(0.25))).toBeNull();
    // steps fall back to pin+glue wording for that stock
    const thin: Settings = {
      ...PH,
      stocks: { ...PH.stocks, ply12: { ...PH.stocks.ply12, thickness: 0.375 } },
    };
    const c = makeCabinet("base", "B", { frontStyle: "drawers", drawerCount: 2 });
    const { steps } = genSteps(genParts(c, thin), thin, "#000");
    const groove = steps.find((st) => /Groove/.test(st.t));
    expect(groove!.t).toMatch(/glue and pin/i);
    expect(groove!.t).not.toMatch(/pocket/i);
    // and the totals skip it rather than counting 1/2"-class screws
    const totals = pocketScrewTotals(genParts(c, thin).parts, thin);
    expect(totals.some((t) => t.spec.setting === 0.5)).toBe(false);
  });

  it("matches the standard screw-length chart", () => {
    expect(screwLength(0.5)).toBe(1);
    expect(screwLength(0.625)).toBe(1);
    expect(screwLength(0.75)).toBe(1.25);
    expect(screwLength(1)).toBe(1.5);
    expect(screwLength(1.5)).toBe(2.5);
  });

  it("threads by material: coarse into ply, fine into hardwood", () => {
    expect(pocketSpec(sheet(0.71875))).toEqual({ setting: 0.75, screwLength: 1.25, thread: "coarse" });
    expect(pocketSpec(S.stocks.hardwood)).toEqual({ setting: 0.75, screwLength: 1.25, thread: "fine" });
    expect(pocketSpec(sheet(0.5))).toEqual({ setting: 0.5, screwLength: 1, thread: "coarse" });
    expect(screwLabel(pocketSpec(sheet(0.71875))!, "in")).toBe('1 1/4" coarse-thread');
  });

  it("labels metric projects with the package size, not a raw conversion", () => {
    expect(screwLabel(pocketSpec(sheet(0.71875))!, "mm")).toBe("32 mm coarse-thread");
    expect(screwLabel(pocketSpec(sheet(0.5))!, "mm")).toBe("25 mm coarse-thread");
  });

  it("spaces pockets every ~8\" along a panel end, never fewer than 2", () => {
    expect(pocketsPerEnd(4)).toBe(2);
    expect(pocketsPerEnd(23.375)).toBe(3);
    expect(pocketsPerEnd(30)).toBe(4);
  });
});

describe("pocketScrewTotals — the shopping-list demand", () => {
  it("counts a base cabinet's bottom, stretchers and drawer boxes by spec", () => {
    const c = makeCabinet("base", "B", { frontStyle: "drawers", drawerCount: 2 });
    const { parts } = genParts(c, PH);
    const totals = pocketScrewTotals(parts, PH);
    // 3/4-class ply (bottom row each end + 2 per stretcher end) and the
    // 1/2-class drawer front/backs land in separate buckets.
    const coarse34 = totals.find((t) => t.spec.setting === 0.75 && t.spec.thread === "coarse");
    const coarse12 = totals.find((t) => t.spec.setting === 0.5);
    expect(coarse34).toBeTruthy();
    expect(coarse12).toBeTruthy();
    // bottom: 2 ends × 3 (23.25 deep) + stretchers: 2 × 2 ends × 2 = 6 + 8
    expect(coarse34!.count).toBe(14);
    // drawer front/backs: 2 drawers × qty2 × 2 ends × 2 per corner
    expect(coarse12!.count).toBe(16);
  });

  it("counts frame screws from the frame's ACTUAL joints, not part names", () => {
    // A single closed framed cabinet: both stiles captured between the rails.
    const c = makeCabinet("base", "F", { construction: "framed", frontStyle: "doors", doorCount: 2 });
    // 2 stiles × 2 joined ends × 2 screws = 8, whether run-framed or solo
    expect(framePocketScrews([c], PH)).toBe(8);
    expect(framePocketScrews([c], { ...PH, continuousFaceFrame: false })).toBe(8);
    // frame member names contribute NOTHING via the name-based totals
    const totals = pocketScrewTotals(genParts(c, PH).parts, PH);
    expect(totals.some((t) => t.spec.thread === "fine")).toBe(false);
  });

  it("floor-running stiles beside open bays join only at the top (maple-run golden)", () => {
    // The real kitchen shape: closed toe-kick bay + appliance opening + desk.
    const b1 = makeCabinet("base", "B1", { construction: "framed", overlay: "inset_rail", frontStyle: "door_drawer", drawerCount: 1, toeKick: true });
    const b2 = makeCabinet("base", "B2", { construction: "framed", overlay: "inset_rail", frontStyle: "opening", toeKick: false });
    const b3 = makeCabinet("base", "B3", { construction: "framed", overlay: "inset_rail", frontStyle: "desk", drawerCount: 1, toeKick: false });
    const runs = runsOf([b1, b2, b3], PH);
    expect(runs).toHaveLength(1);
    const j = runFrameJoints(runs[0], PH);
    // 4 stiles join the top rail; only B1's end stile rests on the bottom rail;
    // that rail's other end butts the floor-running B1|B2 stile; 2 mid rails.
    expect(j).toEqual({ stileTopEnds: 4, stileBottomEnds: 1, railButtEnds: 1, midRailEnds: 4 });
    expect(framePocketScrews([b1, b2, b3], PH)).toBe(20);
  });

  it("at a closed/closed height break, only the HIGHER rail end butts the stile", () => {
    // Toe-kicked bay beside a floor-standing closed bay: two bottom-rail
    // segments at different heights. The stile rests on the lower rail (its
    // bottom pockets into it); the higher rail's end butts the stile; the
    // lower rail's end runs under the stile and takes NO pockets.
    const a = makeCabinet("base", "A", { construction: "framed", frontStyle: "doors", doorCount: 2, toeKick: true });
    const b = makeCabinet("base", "B", { construction: "framed", frontStyle: "doors", doorCount: 2, toeKick: false });
    const runs = runsOf([a, b], PH);
    expect(runs).toHaveLength(1);
    const j = runFrameJoints(runs[0], PH);
    expect(j.stileTopEnds).toBe(3);
    expect(j.stileBottomEnds).toBe(3); // all three rest on a rail (middle on the lower one)
    expect(j.railButtEnds).toBe(1); // ONLY the toe-kicked span's rail end
  });

  it("teaches the solo appliance-opening frame the same joints it bills for", () => {
    const c = makeCabinet("base", "OP", { frontStyle: "opening", construction: "framed" });
    const noRun: Settings = { ...PH, continuousFaceFrame: false };
    const { steps } = genSteps(genParts(c, noRun), noRun, "#000");
    const ff = steps.find((st) => st.stage === "faceFrame");
    expect(ff).toBeTruthy();
    expect(ff!.t).toMatch(/TOP end/);
    expect(ff!.t).toContain('1 1/4" fine-thread');
    // 2 stiles × 1 joined end × 2 screws — guide and shopping list agree
    expect(framePocketScrews([c], noRun)).toBe(4);
  });

  it("thin frame stock gets dowel/spline wording, never pocket-screw text", () => {
    const thinFrame: Settings = {
      ...PH,
      continuousFaceFrame: false,
      stocks: { ...PH.stocks, hardwood: { ...PH.stocks.hardwood, thickness: 0.375 } },
    };
    const c = makeCabinet("base", "F", { construction: "framed", frontStyle: "doors", doorCount: 2 });
    const { steps } = genSteps(genParts(c, thinFrame), thinFrame, "#000");
    const assemble = steps.filter((st) => st.stage === "faceFrame")[1];
    expect(assemble.t).toMatch(/dowels or splines/i);
    expect(assemble.t).not.toMatch(/pocket-screw/i);
  });

  it("always drills the NON-sanded face, with per-part orientation", () => {
    // The desk deck installs sanded DOWN (open knee space) — pockets face up.
    const c = makeCabinet("base", "D", { construction: "framed", frontStyle: "desk", drawerCount: 1, toeKick: false });
    const deck = genParts(c, PH).parts.find((p) => p.name === "Drawer deck")!;
    const row = pocketRow(deck, PH);
    expect(row).toBeTruthy();
    expect(row!.face).toMatch(/NON-sanded/);
    expect(row!.face).toMatch(/UP under the drawer/);
    // A base bottom's non-sanded face becomes the underside…
    const b = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const bottom = genParts(b, PH).parts.find((p) => p.name === "Bottom")!;
    expect(pocketRow(bottom, PH)!.face).toMatch(/NON-sanded/);
    expect(pocketRow(bottom, PH)!.face).toMatch(/underside/);
    // …but a WALL cabinet's underside shows from below, so its bottom flips
    const w = makeCabinet("wall", "W", { frontStyle: "doors", doorCount: 2 });
    const wBottom = genParts(w, PH).parts.find((p) => p.name === "Bottom")!;
    expect(pocketRow(wBottom, PH, true)!.face).toMatch(/facing UP, inside/);
    expect(pocketRow(wBottom, PH, true)!.showFace).toMatch(/DOWN/);
    // the one rule holds for every drillable part in a whole kitchen
    for (const cab of [c, b, w]) {
      for (const p of genParts(cab, PH).parts) {
        const r = pocketRow(p, PH, cab.type === "wall");
        if (r) expect(r.face).toMatch(/NON-sanded/);
      }
    }
    const { steps } = genSteps(genParts(w, PH), PH, "#000");
    const join = steps.find((st) => /join the BOTTOM/i.test(st.t))!;
    expect(join.t).toMatch(/sanded face DOWN/);
    expect(join.t).toMatch(/INSIDE/);
    // frame members and backs are not per-part rows
    const back = genParts(b, PH).parts.find((p) => p.name === "Back (applied)")!;
    expect(pocketRow(back, PH)).toBeNull();
  });

  it("counts frameless railed-inset divider rails", () => {
    const c = makeCabinet("base", "R", { overlay: "inset_rail", frontStyle: "drawers", drawerCount: 3 });
    const { parts } = genParts(c, PH);
    const rails = parts.filter((p) => p.name === "Inset rail");
    expect(rails.reduce((a, p) => a + p.qty, 0)).toBe(2);
    const totals = pocketScrewTotals(rails, PH);
    expect(totals).toHaveLength(1);
    expect(totals[0].count).toBe(8); // 2 rails × 2 ends × 2 pockets
  });

  it("gives backs, shelves and fronts no pockets at all", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2, shelves: 2 });
    const { parts } = genParts(c, PH);
    const pocketless = parts.filter((p) =>
      ["Back (applied)", "Adjustable shelf", "Door"].includes(p.name),
    );
    expect(pocketless.length).toBeGreaterThan(0);
    const totals = pocketScrewTotals(pocketless, PH);
    expect(totals).toHaveLength(0);
  });
});

describe("genSteps — pocket-hole walkthrough (opt-in)", () => {
  it("stays byte-off when the setting is off", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const { steps } = genSteps(genParts(c, S), S, "#000");
    expect(steps.some((st) => /pocket-hole jig/i.test(st.t))).toBe(false);
  });

  it("adds a drill-the-pockets step with the jig setting and screw spec", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const { steps } = genSteps(genParts(c, PH), PH, "#000");
    const drill = steps.find((st) => /pocket-hole jig/i.test(st.t));
    expect(drill).toBeTruthy();
    // The drill step rides the carcass stage so the 3D panel shows the very
    // boards being drilled (glowing, dots visible) instead of ghosting them.
    expect(drill!.stage).toBe("carcass");
    expect(drill!.t).toContain('3/4"'); // jig setting for 3/4-class ply
    const join = steps.find((st) => st.stage === "carcass" && /join the BOTTOM/i.test(st.t));
    expect(join).toBeTruthy();
    expect(join!.t).toContain('1 1/4" coarse-thread'); // matching screws
    expect(join!.t).not.toContain("confirmat");
  });

  it("re-sets the jig for the thinner drawer-box stock", () => {
    const c = makeCabinet("base", "B", { frontStyle: "drawers", drawerCount: 2 });
    const { steps } = genSteps(genParts(c, PH), PH, "#000");
    const box = steps.find((st) => st.stage === "drawers" && /pocket/i.test(st.t));
    expect(box).toBeTruthy();
    expect(box!.t).toContain('1/2"'); // jig re-set to the drawer stock
    expect(box!.t).toContain('1" coarse-thread');
    expect(box!.t).toMatch(/clear of the groove/i);
  });

  it("uses fine-thread screws for the hardwood face frame", () => {
    const c = makeCabinet("base", "F", { construction: "framed", frontStyle: "doors", doorCount: 2 });
    const { steps } = genSteps(genParts(c, PH), PH, "#000");
    const ff = steps.find((st) => st.stage === "faceFrame" && /pocket/i.test(st.t));
    expect(ff).toBeTruthy();
    expect(ff!.t).toContain('1 1/4" fine-thread');
    // the face-frame beat count is unchanged: cut → assemble → attach
    expect(steps.filter((st) => st.stage === "faceFrame")).toHaveLength(3);
  });

  it("keeps every stage contiguous with the drill step added", () => {
    for (const c of [
      makeCabinet("base", "B", { frontStyle: "door_drawer", construction: "framed" }),
      makeCabinet("base", "D", { frontStyle: "desk", drawerCount: 1, toeKick: false, construction: "framed" }),
      makeCabinet("base", "O", { frontStyle: "opening", construction: "framed" }),
      makeCabinet("wall", "W", { frontStyle: "doors", doorCount: 2 }),
    ]) {
      const { steps } = genSteps(genParts(c, PH), PH, "#000");
      const runs = steps.map((st) => st.stage).filter((s2, i, arr) => i === 0 || s2 !== arr[i - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    }
  });
});
