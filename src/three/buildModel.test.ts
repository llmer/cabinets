import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet, seedCabinets } from "@/domain/defaults";
import { BUILD_STAGES, BuildStage } from "@/engine/steps";
import { BuildPart, BuildPartKind, cabinetBuildParts } from "./buildModel";

const S = DEFAULT_SETTINGS;

const onStage = (ps: BuildPart[], st: BuildStage) => ps.filter((p) => p.stage === st);
const ofKind = (ps: BuildPart[], k: BuildPartKind) => ps.filter((p) => p.kind === k);
const stages = (ps: BuildPart[]) => new Set(ps.map((p) => p.stage));

describe("cabinetBuildParts — invariants", () => {
  it("tags every part with a known stage and emits non-degenerate boxes", () => {
    for (const c of seedCabinets()) {
      const parts = cabinetBuildParts(c, S);
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        expect(BUILD_STAGES).toContain(p.stage);
        const [x0, x1, y0, y1, z0, z1] = p.box;
        expect(Math.abs(x1 - x0)).toBeGreaterThan(0.01);
        expect(Math.abs(y1 - y0)).toBeGreaterThan(0.01);
        expect(Math.abs(z1 - z0)).toBeGreaterThan(0.01);
      }
    }
  });

  it("always starts with the two side panels at the `sides` stage", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const sides = onStage(cabinetBuildParts(c, S), "sides");
    expect(sides).toHaveLength(2);
    expect(sides.every((p) => p.kind === "carcass")).toBe(true);
  });
});

describe("cabinetBuildParts — face-frame base, drawer over doors, toe kick", () => {
  // The first verification target.
  const c = makeCabinet("base", "FF", {
    construction: "framed",
    frontStyle: "door_drawer",
    doorCount: 2,
    toeKick: true,
    shelves: 1, // a shelf lives behind the doors
  });
  const parts = cabinetBuildParts(c, S);

  it("builds a recessed toe-kick plinth at the `base` stage", () => {
    expect(ofKind(parts, "toeKick")).toHaveLength(1);
    expect(onStage(parts, "base").every((p) => p.kind === "toeKick")).toBe(true);
  });

  it("shows the hardwood face-frame perimeter so the face-frame step isn't empty", () => {
    // 2 stiles + top rail + bottom rail (no mid rails on a full-overlay box).
    const frame = onStage(parts, "faceFrame").filter((p) => p.kind === "frame");
    expect(frame).toHaveLength(4);
  });

  it("puts the drawer FACE on its own stage, distinct from the boxes and doors", () => {
    expect(onStage(parts, "drawerFronts").filter((p) => p.kind === "front")).toHaveLength(1);
    expect(onStage(parts, "doors").filter((p) => p.kind === "front")).toHaveLength(2);
    // the box itself is interior, on the earlier `drawers` stage
    expect(onStage(parts, "drawers").filter((p) => p.kind === "front")).toHaveLength(0);
  });

  it("puts every pull on the final `pulls` stage", () => {
    const handles = ofKind(parts, "handle");
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.every((p) => p.stage === "pulls")).toBe(true);
  });

  it("includes the assembled drawer box (revealed in cutaway)", () => {
    expect(ofKind(parts, "drawerBox").length).toBeGreaterThan(0);
  });

  it("covers the full assembly sequence", () => {
    expect(stages(parts)).toEqual(
      new Set<BuildStage>([
        "sides",
        "carcass",
        "back",
        "base",
        "faceFrame",
        "drawers",
        "shelves",
        "doors",
        "drawerFronts",
        "pulls",
      ]),
    );
  });
});

describe("cabinetBuildParts — base cabinet opening for an appliance", () => {
  // The second verification target: an open bay, no front.
  it("frameless opening has sides + top stretchers and no front/back/frame", () => {
    const c = makeCabinet("base", "OP", { frontStyle: "opening" });
    const parts = cabinetBuildParts(c, S);
    expect(onStage(parts, "sides")).toHaveLength(2);
    expect(onStage(parts, "carcass")).toHaveLength(4); // two top stretchers + two back stretchers, no bottom
    expect(ofKind(parts, "front")).toHaveLength(0);
    expect(ofKind(parts, "back")).toHaveLength(0);
    expect(ofKind(parts, "frame")).toHaveLength(0);
    expect(ofKind(parts, "toeKick")).toHaveLength(0);
  });

  it("framed opening surrounds the bay with a 3-sided face frame", () => {
    const c = makeCabinet("base", "OPF", { frontStyle: "opening", construction: "framed" });
    const parts = cabinetBuildParts(c, S);
    expect(ofKind(parts, "frame")).toHaveLength(3); // 2 stiles + top rail, no bottom rail
    expect(ofKind(parts, "front")).toHaveLength(0);
  });
});

describe("cabinetBuildParts — base desk with an open knee below the drawers", () => {
  // The third verification target.
  const c = makeCabinet("base", "DK", { frontStyle: "desk", drawerCount: 2, toeKick: false });
  const parts = cabinetBuildParts(c, S);

  it("caps the open box with a desktop and keeps the knee space open", () => {
    expect(onStage(parts, "desktop")).toHaveLength(1);
    expect(ofKind(parts, "back")).toHaveLength(0); // open box: no back
    expect(ofKind(parts, "toeKick")).toHaveLength(0); // legs to the floor, no toe kick
  });

  it("stacks the drawer fronts on top with boxes behind them", () => {
    expect(onStage(parts, "drawerFronts").filter((p) => p.kind === "front")).toHaveLength(2);
    expect(ofKind(parts, "drawerBox").length).toBeGreaterThan(0);
  });

  it("attaches faces + pulls but never reaches the doors or shelves stages", () => {
    const present = stages(parts);
    expect(present.has("desktop")).toBe(true);
    expect(present.has("drawerFronts")).toBe(true);
    expect(present.has("pulls")).toBe(true);
    expect(present.has("doors")).toBe(false);
    expect(present.has("shelves")).toBe(false);
  });
});

describe("cabinetBuildParts — lockstep with the run-model face-frame changes", () => {
  const b1 = makeCabinet("base", "B1", {
    construction: "framed",
    overlay: "inset_rail",
    frontStyle: "door_drawer",
    doorCount: 1,
    drawerCount: 1,
    toeKick: true,
    drawerHeights: [6],
  });
  const p1 = cabinetBuildParts(b1, S);
  const frame1 = ofKind(p1, "frame");

  it("uses the wider 2\" top rail", () => {
    // exactly one frame member is faceFrameTop tall — the top rail
    const top = frame1.filter((f) => Math.abs(f.box[3] - f.box[2] - S.faceFrameTop) < 0.01);
    expect(top).toHaveLength(1);
  });

  it("drops the face frame AND the end panels to the frame-floor gap over a toe kick", () => {
    expect(Math.min(...frame1.map((f) => f.box[2]))).toBeCloseTo(S.faceFrameFloorGap, 5);
    const sides = onStage(p1, "sides");
    expect(Math.min(...sides.map((s2) => s2.box[2]))).toBeCloseTo(S.faceFrameFloorGap, 5);
  });

  it("recesses the separate toe-kick base on its exposed sides", () => {
    const base = ofKind(p1, "toeKick")[0];
    expect(base.box[0]).toBeCloseTo(S.toeKickSideRecess, 5);
    expect(base.box[1]).toBeCloseTo(b1.width - S.toeKickSideRecess, 5);
  });

  it("frames a desk with a rail under the drawer + a deck panel, no bottom rail", () => {
    const dk = makeCabinet("base", "DK", {
      construction: "framed",
      overlay: "inset_rail",
      frontStyle: "desk",
      drawerCount: 1,
      toeKick: false,
      drawerHeights: [5],
    });
    const pDk = cabinetBuildParts(dk, S);
    // 2 stiles + top rail + under-drawer rail = 4 (a desk has no bottom rail)
    expect(ofKind(pDk, "frame")).toHaveLength(4);
    // the deck is a full-depth carcass panel installed at the carcass stage
    const deck = onStage(pDk, "carcass").find((x) => x.kind === "carcass" && x.box[5] - x.box[4] > 10);
    expect(deck).toBeTruthy();
  });
});

describe("cabinetBuildParts — full-depth carcass (front flush, captured back)", () => {
  // Pins the carcass depth/position so a closed box's front sits at the front
  // plane (flush with the front stretcher + face frame) and the applied back is
  // captured inset at the rear — not a recessed front or a protruding full-width
  // back. This geometry has no other automated coverage (the Three.js scene
  // can't run headless), so these assertions are the guard against regressions.
  const matT = 0.75; // carcass ply thickness in DEFAULT_SETTINGS
  const backT = 0.75; // applied-back ply thickness
  const c = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2, toeKick: false, depth: 24 });
  const D = c.depth;
  const parts = cabinetBuildParts(c, S);

  it("runs the side panels the FULL depth — rear (0) to the front plane (D)", () => {
    const sides = onStage(parts, "sides");
    expect(sides).toHaveLength(2);
    for (const s2 of sides) {
      expect(s2.box[4]).toBeCloseTo(0, 5); // rear
      expect(s2.box[5]).toBeCloseTo(D, 5); // front plane — no 3/4" recess
    }
  });

  it("sits the front top stretcher flush at the front plane, 4\" deep", () => {
    const carc = onStage(parts, "carcass").filter((p) => p.kind === "carcass");
    const front = carc.find((p) => Math.abs(p.box[5] - D) < 0.01 && Math.abs(p.box[5] - p.box[4] - 4) < 0.01);
    expect(front).toBeTruthy(); // z = [D-4, D]
    // paired with a rear stretcher against the back at z = [0, 4]
    expect(carc.some((p) => Math.abs(p.box[4]) < 0.01 && Math.abs(p.box[5] - 4) < 0.01)).toBe(true);
  });

  it("captures the applied back INSET between the sides, tucked below the top stretcher", () => {
    const back = ofKind(parts, "back");
    expect(back).toHaveLength(1);
    const b = back[0];
    expect(b.box[0]).toBeCloseTo(matT, 5); // inset a side thickness from the left
    expect(b.box[1]).toBeCloseTo(c.width - matT, 5); // and from the right — NOT x0..x1
    expect(b.box[4]).toBeCloseTo(0, 5); // rear face at the back
    expect(b.box[5]).toBeCloseTo(backT, 5); // 3/4" thick, flush inside the full-depth sides
    // its top stops BELOW the top back stretcher, which owns the top-rear corner
    const carc = onStage(parts, "carcass").filter((p) => p.kind === "carcass");
    const yTop = Math.max(...carc.map((p) => p.box[3]));
    expect(b.box[3]).toBeLessThan(yTop - 0.5);
  });
});

describe("cabinetBuildParts — shelves appear in a plain door box", () => {
  it("emits one shelf part per shelf at the `shelves` stage", () => {
    const c = makeCabinet("wall", "W", { frontStyle: "doors", doorCount: 2, shelves: 2 });
    const parts = cabinetBuildParts(c, S);
    expect(onStage(parts, "shelves").filter((p) => p.kind === "shelf")).toHaveLength(2);
  });
});
