import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet, seedCabinets } from "@/domain/defaults";
import { deskDeckTop } from "@/engine/drawers";
import { slideBlockingSpecs } from "@/engine/parts";
import { BUILD_STAGES, BuildStage } from "@/engine/steps";
import { BuildPart, BuildPartKind, buildBaseY, cabinetBuildParts } from "./buildModel";

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

  it("builds a ladder frame: full-width top + bottom rails, stiles captured between", () => {
    const ff = S.frameWidth;
    // the top rail is one board the full width of the box
    const top = frame1.find((f) => Math.abs(f.box[3] - f.box[2] - S.faceFrameTop) < 0.01)!;
    expect(top.box[0]).toBeCloseTo(0, 5);
    expect(top.box[1]).toBeCloseTo(b1.width, 5);
    // the two stiles (ff wide, at the edges) hang beneath it and rest on the
    // bottom rail — their top is the rail's underside, their foot box bottom + ff
    const stiles = frame1.filter((f) => Math.abs(f.box[1] - f.box[0] - ff) < 0.01);
    expect(stiles).toHaveLength(2);
    const yB = buildBaseY(b1, S);
    for (const st of stiles) {
      expect(st.box[3]).toBeCloseTo(top.box[2], 5); // butts under the top rail
      expect(st.box[2]).toBeCloseTo(yB + ff, 5); // foot rests on the bottom rail
    }
    // the bottom rail is also full width, its top flush with the stile feet
    const bottom = frame1.find((f) => f !== top && Math.abs(f.box[1] - f.box[0] - b1.width) < 0.01)!;
    expect(bottom.box[3]).toBeCloseTo(yB + ff, 5);
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

  it("drops only the EXPOSED end to the frame line when run ends are given", () => {
    const b1 = makeCabinet("base", "B1", {
      construction: "framed",
      overlay: "inset_rail",
      frontStyle: "door_drawer",
      drawerCount: 1,
      toeKick: true,
    });
    // B1-style bay: exposed LEFT end, shared side on the right
    const parts = cabinetBuildParts(b1, S, { left: true, right: false });
    const sides = onStage(parts, "sides");
    expect(sides).toHaveLength(2);
    const [left, right] = sides;
    expect(left.box[2]).toBeCloseTo(S.faceFrameFloorGap, 5); // End panel: down to 3.25
    expect(right.box[2]).toBeCloseTo(S.toeKick, 5); // plain side: box bottom (4.5)
    // the toe-kick base recesses under the exposed end only
    const base = parts.find((p) => p.kind === "toeKick")!;
    expect(base.box[0]).toBeCloseTo(S.toeKickSideRecess, 5);
    expect(base.box[1]).toBeCloseTo(b1.width, 5);
    // omitted ends = both exposed (standalone / run of one), the old behaviour
    const solo = onStage(cabinetBuildParts(b1, S), "sides");
    expect(solo[0].box[2]).toBeCloseTo(S.faceFrameFloorGap, 5);
    expect(solo[1].box[2]).toBeCloseTo(S.faceFrameFloorGap, 5);
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
    // its TOP face sits on the engine's deck line — the same number the build
    // step quotes — with its underside flush under the mid rail
    expect(deck!.box[3]).toBeCloseTo(deskDeckTop(dk, S), 5);
    expect(deck!.box[3]).toBeCloseTo(26.75, 5); // 34.5 - 2 - 5 - 1.5 + 0.75
    expect(deck!.box[2]).toBeCloseTo(26, 5);
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

describe("cabinetBuildParts — pocket-hole markers (settings.pocketHoles)", () => {
  const PH = { ...S, pocketHoles: true };

  it("emits no markers when the setting is off", () => {
    for (const c of seedCabinets()) {
      for (const p of cabinetBuildParts(c, S)) expect(p.pockets).toBeUndefined();
    }
  });

  it("every marker sits ON its part, exactly on one face plane", () => {
    const cabs = [
      ...seedCabinets(),
      makeCabinet("base", "desk", { construction: "framed", overlay: "inset_rail", frontStyle: "desk", drawerCount: 1, toeKick: false }),
      makeCabinet("base", "open", { construction: "framed", frontStyle: "opening" }),
    ];
    for (const c of cabs) {
      for (const p of cabinetBuildParts(c, PH)) {
        for (const d of p.pockets ?? []) {
          const [x0, x1, y0, y1, z0, z1] = p.box;
          expect(d.x).toBeGreaterThanOrEqual(x0 - 1e-6);
          expect(d.x).toBeLessThanOrEqual(x1 + 1e-6);
          expect(d.y).toBeGreaterThanOrEqual(y0 - 1e-6);
          expect(d.y).toBeLessThanOrEqual(y1 + 1e-6);
          expect(d.z).toBeGreaterThanOrEqual(z0 - 1e-6);
          expect(d.z).toBeLessThanOrEqual(z1 + 1e-6);
          const [nx, ny, nz] = d.n;
          expect(Math.abs(nx) + Math.abs(ny) + Math.abs(nz)).toBe(1);
          // the dot lies on the face its normal points out of
          if (ny === -1) expect(d.y).toBeCloseTo(y0, 6);
          if (ny === 1) expect(d.y).toBeCloseTo(y1, 6);
          if (nz === -1) expect(d.z).toBeCloseTo(z0, 6);
          if (nz === 1) expect(d.z).toBeCloseTo(z1, 6);
        }
      }
    }
  });

  it("marks a base bottom's UNDERSIDE but flips a wall bottom to its inside TOP", () => {
    const b = makeCabinet("base", "B", { frontStyle: "doors", doorCount: 2 });
    const bParts = cabinetBuildParts(b, PH);
    const bottom = bParts.find((p) => p.stage === "carcass" && p.pockets?.some((d) => d.n[1] === -1))!;
    expect(bottom).toBeTruthy();
    expect(bottom.pockets).toHaveLength(6); // 3 per end for a 24"-deep box
    for (const d of bottom.pockets!) expect(d.y).toBeCloseTo(bottom.box[2], 6); // underside plane
    const w = makeCabinet("wall", "W", { frontStyle: "doors", doorCount: 2 });
    const wParts = cabinetBuildParts(w, PH);
    const wBottom = wParts.find((p) => p.stage === "carcass" && p.box[2] === 0 && p.pockets)!;
    expect(wBottom).toBeTruthy();
    for (const d of wBottom.pockets!) {
      expect(d.n).toEqual([0, 1, 0]); // pockets face UP, inside the cabinet
      expect(d.y).toBeCloseTo(wBottom.box[3], 6);
    }
  });

  it("marks the desk deck's TOP face — the knee space below stays clean", () => {
    const c = makeCabinet("base", "D", { construction: "framed", overlay: "inset_rail", frontStyle: "desk", drawerCount: 1, toeKick: false });
    const parts = cabinetBuildParts(c, PH);
    // the deck is the only carcass-stage part that runs the full depth at panel thickness
    const deck = parts.find(
      (p) => p.stage === "carcass" && p.box[5] - p.box[4] > 20 && p.box[3] - p.box[2] < 1,
    )!;
    expect(deck).toBeTruthy();
    expect(deck.pockets).toHaveLength(6);
    for (const d of deck.pockets!) expect(d.n).toEqual([0, 1, 0]);
  });

  it("marks the drawer box front/back OUTSIDE faces, never the sides or bottom", () => {
    const c = makeCabinet("base", "DR", { frontStyle: "drawers", drawerCount: 1 });
    const parts = cabinetBuildParts(c, PH);
    const boxParts = parts.filter((p) => p.kind === "drawerBox");
    const withDots = boxParts.filter((p) => p.pockets);
    expect(withDots).toHaveLength(2); // sub-front + back only
    const fronts = withDots.filter((p) => p.pockets!.every((d) => d.n[2] === 1));
    const backs = withDots.filter((p) => p.pockets!.every((d) => d.n[2] === -1));
    expect(fronts).toHaveLength(1);
    expect(backs).toHaveLength(1);
    expect(fronts[0].pockets).toHaveLength(4); // 2 per end
  });
});

describe("cabinetBuildParts — coverage gaps from adversarial review", () => {
  const PH = { ...S, pocketHoles: true };

  it("a framed FULL-OVERLAY desk still gets its deck (+ dots) and under-drawer rail", () => {
    const c = makeCabinet("base", "OD", { construction: "framed", overlay: "full", frontStyle: "desk", drawerCount: 1, toeKick: false });
    const parts = cabinetBuildParts(c, PH);
    const deck = parts.find(
      (p) => p.stage === "carcass" && p.box[5] - p.box[4] > 20 && p.box[3] - p.box[2] < 1,
    )!;
    expect(deck).toBeTruthy();
    expect(deck.pockets).toHaveLength(6);
    for (const d of deck.pockets!) expect(d.n).toEqual([0, 1, 0]); // top face
    // the under-drawer rail exists too, on the (hidden) frame plane
    expect(onStage(parts, "faceFrame").length).toBeGreaterThan(0);
  });

  it("frameless railed-inset divider rails carry back-face dots", () => {
    const c = makeCabinet("base", "R", { overlay: "inset_rail", frontStyle: "drawers", drawerCount: 3 });
    const parts = cabinetBuildParts(c, PH);
    const rails = parts.filter((p) => p.stage === "drawers" && p.kind === "carcass" && p.pockets);
    expect(rails).toHaveLength(2); // 3 drawers → 2 divider rails
    for (const r of rails) {
      expect(r.pockets).toHaveLength(4); // 2 per end
      for (const d of r.pockets!) {
        expect(d.n).toEqual([0, 0, -1]); // back face, seen in the cutaway
        expect(d.z).toBeCloseTo(r.box[4], 6);
      }
    }
  });
});

describe("cabinetBuildParts — slide pack-out strips", () => {
  // 18" framed railed-inset drawer-over-door, toe kick: yB 4.5, yT 34.5, one 6" drawer.
  const c = makeCabinet("base", "FF", {
    width: 18,
    construction: "framed",
    overlay: "inset_rail",
    frontStyle: "door_drawer",
    doorCount: 2,
    toeKick: true,
  });

  it("packs both walls out to the slide line at the drawers stage", () => {
    const drawers = onStage(cabinetBuildParts(c, S), "drawers");
    // 5 drawer-box panels + 2 pack-out strips
    expect(drawers).toHaveLength(7);
    // solo planes at the stile edges (1.5 / 16.5), strips fill wall → plane
    const left = drawers.find((p) => p.box[0] === 0.75 && p.box[1] === 1.5)!;
    const right = drawers.find((p) => p.box[0] === 16.5 && p.box[1] === 17.25)!;
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    // 4" wide, bottom edge 7/8" below the box bottom (slot 26.5 + 0.25 slide gap)
    expect(left.box[2]).toBe(25.875);
    expect(left.box[3]).toBe(29.875);
  });

  it("hangs the first inset slot under the 2\" top rail, matching the cut list", () => {
    const parts = cabinetBuildParts(c, S);
    // box bottom = yT 34.5 − top rail 2 − front 6 + 0.25 = 26.75
    const boxBottoms = onStage(parts, "drawers").map((p) => p.box[2]);
    expect(Math.min(...boxBottoms.filter((y) => y > 26))).toBe(26.75);
  });

  it("follows the run-aware blocking when the bay's geometry is passed in", () => {
    const bl = slideBlockingSpecs(c, S, { emitFaceFrame: false, leftEnd: false, rightEnd: true });
    const drawers = onStage(cabinetBuildParts(c, S, undefined, bl), "drawers");
    // planes shift toward the shared half-stile: 1.125 / 16.125
    expect(drawers.some((p) => p.box[0] === 0.75 && p.box[1] === 1.125)).toBe(true);
    expect(drawers.some((p) => p.box[0] === 16.125 && p.box[1] === 17.25)).toBe(true);
    // the box hangs centred under its front: left side at plane + 1/2"
    expect(drawers.some((p) => p.box[0] === 1.625)).toBe(true);
  });

  it("draws no strips in a frameless box", () => {
    const fl = makeCabinet("base", "FL", { width: 18, frontStyle: "drawers", drawerCount: 3 });
    const drawers = onStage(cabinetBuildParts(fl, S), "drawers");
    expect(drawers).toHaveLength(15); // 3 boxes × 5 panels, nothing else
  });
});
