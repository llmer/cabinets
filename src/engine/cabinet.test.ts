import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Cabinet, Settings } from "@/domain/types";
import {
  boxHeight,
  carcassDepth,
  faceHeight,
  interiorWidth,
} from "./geometry";
import {
  drawerStackBudget,
  evenHeights,
  getDrawerHeights,
  withDrawerHeight,
} from "./drawers";

const S: Settings = DEFAULT_SETTINGS;

function baseDoors(): Cabinet {
  return makeCabinet("base", "B", { width: 24, height: 34.5, depth: 24 });
}

describe("geometry", () => {
  it("computes box height net of toe kick (base)", () => {
    expect(boxHeight(baseDoors(), S)).toBe(30); // 34.5 - 4.5
  });
  it("uses full height for wall cabinets", () => {
    const w = makeCabinet("wall", "W", { height: 30 });
    expect(boxHeight(w, S)).toBe(30);
  });
  it("keeps full height when toe kick is off", () => {
    const c = makeCabinet("base", "B", { height: 34.5, toeKick: false });
    expect(boxHeight(c, S)).toBe(34.5);
  });
  it("computes interior width and carcass depth", () => {
    const c = baseDoors();
    expect(interiorWidth(c, S)).toBe(22.5); // 24 - 2*0.75
    expect(carcassDepth(c, S)).toBe(23.25); // 24 - 0.75 back
    expect(faceHeight(c, S)).toBe(29.875); // 30 - 0.125
  });
  it("uses full depth for open boxes (no back)", () => {
    const c = makeCabinet("base", "B", { frontStyle: "opening", depth: 24 });
    expect(carcassDepth(c, S)).toBe(24);
  });
});

describe("drawer-height model", () => {
  it("splits the budget evenly (frameless drawer bank)", () => {
    const c = makeCabinet("base", "B", {
      width: 18,
      height: 34.5,
      frontStyle: "drawers",
      drawerCount: 3,
    });
    // faceH 29.875 - (3-1)*0.125 = 29.625; /3 = 9.875
    expect(drawerStackBudget(c, S)).toBe(29.625);
    expect(evenHeights(c, 3, S)).toEqual([9.875, 9.875, 9.875]);
  });

  it("keeps >=22\" knee clearance on a desk", () => {
    const c = makeCabinet("base", "B", {
      height: 34.5,
      frontStyle: "desk",
      drawerCount: 1,
      toeKick: false,
    });
    // boxH = 34.5 (no toe kick) - knee 22 = 12.5
    expect(drawerStackBudget(c, S)).toBe(12.5);
    // but defaults to a shallow ~5" pencil drawer
    expect(evenHeights(c, 1, S)).toEqual([5]);
  });

  it("reserves >=6\" door opening on drawer-over-door", () => {
    const c = makeCabinet("base", "B", {
      height: 34.5,
      frontStyle: "door_drawer",
      doorCount: 2,
    });
    // faceH 29.875 - rev 0.125 - 6 = 23.75
    expect(drawerStackBudget(c, S)).toBe(23.75);
  });

  it("clamps an edited drawer so the stack never overflows", () => {
    const c = makeCabinet("base", "B", {
      width: 18,
      height: 34.5,
      frontStyle: "drawers",
      drawerCount: 3,
    });
    // budget 29.625; set drawer 0 absurdly large -> clamped to budget - others
    const hs = withDrawerHeight(c, S, 0, 100);
    const others = hs[1] + hs[2];
    expect(hs[0]).toBeCloseTo(29.625 - others, 3);
    expect(hs.reduce((a, x) => a + x, 0)).toBeLessThanOrEqual(29.625 + 1e-6);
  });

  it("falls back to even split when stored heights overflow", () => {
    const c = makeCabinet("base", "B", {
      width: 18,
      height: 34.5,
      frontStyle: "drawers",
      drawerCount: 3,
      drawerHeights: [40, 40, 40],
    });
    expect(getDrawerHeights(c, S)).toEqual([9.875, 9.875, 9.875]);
  });

  it("framed inset budget accounts for rails", () => {
    const c = makeCabinet("base", "B", {
      width: 18,
      height: 34.5,
      frontStyle: "drawers",
      drawerCount: 3,
      construction: "framed",
      overlay: "inset",
    });
    // boxH 30 - 2*1.5 - (3-1)*1.5 = 30 - 3 - 3 = 24
    expect(drawerStackBudget(c, S)).toBe(24);
  });

  it("framed full-overlay budget ignores rails (fronts cover the frame)", () => {
    const c = makeCabinet("base", "B", {
      width: 18,
      height: 34.5,
      frontStyle: "drawers",
      drawerCount: 3,
      construction: "framed",
      overlay: "full",
    });
    // same as frameless overlay: faceH 29.875 - (3-1)*0.125 = 29.625
    expect(drawerStackBudget(c, S)).toBe(29.625);
  });
});
