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
    expect(onStage(parts, "carcass")).toHaveLength(2); // two top stretchers, no bottom
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

describe("cabinetBuildParts — shelves appear in a plain door box", () => {
  it("emits one shelf part per shelf at the `shelves` stage", () => {
    const c = makeCabinet("wall", "W", { frontStyle: "doors", doorCount: 2, shelves: 2 });
    const parts = cabinetBuildParts(c, S);
    expect(onStage(parts, "shelves").filter((p) => p.kind === "shelf")).toHaveLength(2);
  });
});
