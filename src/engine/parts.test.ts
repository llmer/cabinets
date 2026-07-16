import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Part, Settings } from "@/domain/types";
import { drawerBoxSpecs, genParts, slideBlockingSpecs } from "./parts";
import { drawerStackBudget } from "./drawers";

const S: Settings = DEFAULT_SETTINGS;
const noBoxes: Settings = { ...DEFAULT_SETTINGS, includeDrawerBoxes: false };

function find(parts: Part[], name: string): Part | undefined {
  return parts.find((p) => p.name === name);
}

describe("genParts — frameless base with doors", () => {
  const c = makeCabinet("base", "B1", {
    width: 24,
    height: 34.5,
    depth: 24,
    frontStyle: "doors",
    doorCount: 2,
    shelves: 1,
  });
  const { parts } = genParts(c, noBoxes);

  it("produces the carcass + 2 doors", () => {
    const names = parts.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        "Adjustable shelf",
        "Back (applied)",
        "Bottom",
        "Door",
        "Side panel",
        "Top stretcher",
      ].sort(),
    );
  });

  it("sizes side panels to box height × carcass depth", () => {
    const side = find(parts, "Side panel")!;
    expect(side.qty).toBe(2);
    expect(side.length).toBe(30); // box height
    expect(side.width).toBe(23.25); // depth - back
    expect(side.bandFrontEdge).toBe(30); // banded front edge
  });

  it("sizes the bottom and back", () => {
    expect(find(parts, "Bottom")!.length).toBe(22.5); // interior width
    expect(find(parts, "Bottom")!.width).toBe(23.25);
    const back = find(parts, "Back (applied)")!;
    expect(back.length).toBe(24); // full width
    expect(back.width).toBe(30);
    expect(back.role).toBe("back");
  });

  it("computes full-overlay door dimensions", () => {
    const door = find(parts, "Door")!;
    expect(door.qty).toBe(2);
    expect(door.length).toBe(11.875); // (24 - 0.125 - 1*0.125)/2
    expect(door.width).toBe(29.875); // box height - reveal
    expect(door.bandAll).toBe(true);
  });
});

describe("genParts — drawer bank generates fronts and boxes", () => {
  const c = makeCabinet("base", "B2", {
    width: 18,
    height: 34.5,
    depth: 24,
    frontStyle: "drawers",
    drawerCount: 3,
  });

  it("merges 3 equal drawer fronts into one row of qty 3", () => {
    const { parts } = genParts(c, noBoxes);
    const fronts = parts.filter((p) => p.name === "Drawer front");
    expect(fronts).toHaveLength(1);
    expect(fronts[0].qty).toBe(3);
    expect(fronts[0].length).toBe(17.875); // 18 - reveal
    expect(fronts[0].width).toBe(9.875); // 29.625 / 3
  });

  it("adds drawer-box parts on the right stocks", () => {
    const { parts } = genParts(c, S);
    const side = find(parts, "Drawer box side")!;
    expect(side.role).toBe("drawerBox");
    expect(side.qty).toBe(6); // 2 sides × 3 drawers
    expect(side.length).toBe(22); // floor(carcassDepth - 1)
    const bottom = find(parts, "Drawer bottom")!;
    expect(bottom.role).toBe("drawerBottom");
    expect(bottom.qty).toBe(3);
  });
});

describe("genParts — face frame, inset", () => {
  const c = makeCabinet("base", "B3", {
    width: 24,
    height: 34.5,
    frontStyle: "doors",
    doorCount: 2,
    construction: "framed",
    overlay: "inset",
  });
  const { parts } = genParts(c, noBoxes);

  it("emits hardwood stiles and rails as linear stock", () => {
    const stile = find(parts, "Face-frame stile")!;
    expect(stile.qty).toBe(2);
    expect(stile.linear).toBe(true);
    expect(stile.role).toBe("faceFrame");
    expect(find(parts, "Face-frame top rail")).toBeTruthy();
    expect(find(parts, "Face-frame bottom rail")).toBeTruthy();
  });

  it("makes the top rail wider (2\") than the 1.5\" stiles and bottom rail", () => {
    expect(find(parts, "Face-frame top rail")!.width).toBe(2);
    expect(find(parts, "Face-frame stile")!.width).toBe(1.5);
    expect(find(parts, "Face-frame bottom rail")!.width).toBe(1.5);
  });

  it("cuts both rails full-width and captures the stiles between them", () => {
    // ladder frame: the top and bottom rails run the full box width...
    expect(find(parts, "Face-frame top rail")!.length).toBe(24);
    expect(find(parts, "Face-frame bottom rail")!.length).toBe(24);
    // ...and the stiles are shortened to fit between them: boxH 30 − top 2 − bottom 1.5
    expect(find(parts, "Face-frame stile")!.length).toBe(26.5);
  });

  it("sizes inset doors inside the opening", () => {
    const door = find(parts, "Door")!;
    // opening width 24 - 2*1.5 = 21; doorW = (21 - 0.125*3)/2 = 10.3125 -> r3 10.313
    expect(door.length).toBe(10.313);
    expect(door.bandAll).toBe(true);
  });
});

describe("genParts — overlay vs inset are independent of construction", () => {
  it("face frame + full overlay: frame parts present, doors sized full-overlay, no mid rails", () => {
    const c = makeCabinet("base", "B", {
      width: 24,
      height: 34.5,
      frontStyle: "doors",
      doorCount: 2,
      construction: "framed",
      overlay: "full",
    });
    const { parts } = genParts(c, noBoxes);
    // face frame still listed
    expect(find(parts, "Face-frame stile")).toBeTruthy();
    expect(find(parts, "Face-frame mid rail")).toBeUndefined();
    // doors are full-overlay sized (cover the frame), not inset-in-opening
    const door = find(parts, "Door")!;
    expect(door.length).toBe(11.875); // (24 - 0.125 - 0.125)/2
    expect(door.width).toBe(29.875); // boxH - reveal
  });

  it("frameless + inset: no frame parts, doors inset in the box opening", () => {
    const c = makeCabinet("base", "B", {
      width: 24,
      height: 34.5,
      frontStyle: "doors",
      doorCount: 2,
      construction: "frameless",
      overlay: "inset",
    });
    const { parts } = genParts(c, noBoxes);
    expect(find(parts, "Face-frame stile")).toBeUndefined();
    const door = find(parts, "Door")!;
    // opening = interior 24 - 2*0.75 = 22.5; doorW = (22.5 - 0.125*3)/2 = 11.0625 -> 11.063
    expect(door.length).toBe(11.063);
    // door height = (boxH - 2*0.75) - 2*0.125 = 28.5 - 0.25 = 28.25
    expect(door.width).toBe(28.25);
  });
});

describe("railed inset (frameless)", () => {
  const c = makeCabinet("base", "B", {
    width: 18,
    height: 34.5,
    depth: 24,
    frontStyle: "drawers",
    drawerCount: 3,
    construction: "frameless",
    overlay: "inset_rail",
  });

  it("budgets for a rail between every face", () => {
    // boxH 30 - 2*0.75 (box edges) - (3-1)*1.5 (rails) = 25.5
    expect(drawerStackBudget(c, S)).toBe(25.5);
  });

  it("adds inset rails and sizes the inset fronts", () => {
    const { parts } = genParts(c, noBoxes);
    const rail = find(parts, "Inset rail")!;
    expect(rail).toBeTruthy();
    expect(rail.qty).toBe(2); // n-1 rails
    expect(rail.length).toBe(16.5); // W - 2*0.75 (between box sides)
    expect(rail.width).toBe(1.5); // rail width
    expect(rail.role).toBe("carcass"); // ply rail (frameless), not hardwood
    const front = find(parts, "Drawer front")!;
    expect(front.qty).toBe(3);
    expect(front.length).toBe(16.25); // openW 16.5 - 2*0.125 reveal
    expect(front.width).toBe(8.25); // dh 8.5 - 2*0.125
  });

  it("flush inset (no rails) leaves more room and lists no inset rails", () => {
    const flush: typeof c = { ...c, overlay: "inset" };
    expect(drawerStackBudget(flush, S)).toBe(28.25); // 30 - 1.5 - 2*0.125
    const { parts } = genParts(flush, noBoxes);
    expect(find(parts, "Inset rail")).toBeUndefined();
  });
});

describe("drawerBoxSpecs", () => {
  it("derives box dimensions per drawer", () => {
    const c = makeCabinet("base", "B", {
      width: 18,
      height: 34.5,
      depth: 24,
      frontStyle: "drawers",
      drawerCount: 3,
    });
    const specs = drawerBoxSpecs(c, S);
    expect(specs).toHaveLength(3);
    const sp = specs[0];
    expect(sp.boxWidth).toBe(15.5); // interior 16.5 - 1 (slides)
    expect(sp.boxDepth).toBe(22); // floor(carcassDepth 23.25 - 1)
    expect(sp.bottomWidth).toBe(15); // 15.5 - 2*0.5 + 0.5
    expect(sp.bottomLength).toBe(21.5); // 22 - 2*0.5 + 0.5
  });

  it("is empty for a door cabinet", () => {
    const c = makeCabinet("base", "B", { frontStyle: "doors" });
    expect(drawerBoxSpecs(c, S)).toHaveLength(0);
  });

  it("sizes the box to the face-frame opening (framed), so it clears the frame", () => {
    const c = makeCabinet("base", "B", {
      width: 24,
      frontStyle: "drawers",
      drawerCount: 3,
      construction: "framed",
      overlay: "inset",
    });
    const opening = 24 - 2 * 1.5; // 21" face-frame opening
    const sp = drawerBoxSpecs(c, S)[0];
    expect(sp.boxWidth).toBe(20); // opening 21 - 1 for slides
    expect(sp.boxWidth).toBeLessThanOrEqual(opening); // must pass through the frame
  });
});

describe("genParts — open boxes", () => {
  it("opening: only sides + top, no bottom/back/front", () => {
    const c = makeCabinet("base", "B", { width: 33, frontStyle: "opening" });
    const { parts } = genParts(c, noBoxes);
    const names = parts.map((p) => p.name);
    expect(names).toContain("Side panel");
    expect(names).toContain("Top stretcher");
    expect(names).not.toContain("Bottom");
    expect(names).not.toContain("Back (applied)");
    expect(names).not.toContain("Door");
    // side panels run the full depth (no back deduction)
    expect(find(parts, "Side panel")!.width).toBe(c.depth);
  });

  it("opening: a base surround adds top + bottom back stretchers to stiffen the open box", () => {
    const c = makeCabinet("base", "B", { width: 33, frontStyle: "opening" });
    const { parts } = genParts(c, noBoxes);
    for (const name of ["Back stretcher", "Back bottom stretcher"]) {
      const back = find(parts, name)!;
      expect(back).toBeTruthy();
      expect(back.qty).toBe(1);
      expect(back.length).toBe(31.5); // interior width: 33 - 2*0.75
      expect(back.width).toBe(4); // same 4" as the top stretchers
      expect(back.role).toBe("carcass");
    }
  });

  it("opening: a tall (full-top) surround has no back stretcher", () => {
    const c = makeCabinet("tall", "T", { width: 33, frontStyle: "opening" });
    const { parts } = genParts(c, noBoxes);
    expect(find(parts, "Top")).toBeTruthy();
    expect(find(parts, "Back stretcher")).toBeUndefined();
  });

  it("desk: open knee space, drawer fronts on top", () => {
    const c = makeCabinet("base", "B", {
      frontStyle: "desk",
      drawerCount: 1,
      toeKick: false,
    });
    const { parts } = genParts(c, noBoxes);
    expect(find(parts, "Bottom")).toBeUndefined();
    expect(find(parts, "Back (applied)")).toBeUndefined();
    expect(find(parts, "Drawer front")).toBeTruthy();
    // the open knee gets the same back stretchers as the appliance opening
    expect(find(parts, "Back stretcher")!.width).toBe(4);
    expect(find(parts, "Back bottom stretcher")!.width).toBe(4);
  });

  it("framed desk: a deck closes the drawer cavity + a rail under the drawer", () => {
    const c = makeCabinet("base", "D", {
      frontStyle: "desk",
      drawerCount: 1,
      toeKick: false,
      construction: "framed",
      overlay: "inset",
    });
    const { parts } = genParts(c, noBoxes);
    const deck = find(parts, "Drawer deck")!;
    expect(deck).toBeTruthy(); // horizontal panel under the drawer
    expect(deck.role).toBe("carcass");
    expect(find(parts, "Face-frame bottom rail")).toBeUndefined(); // knee stays open at the floor
    expect(find(parts, "Face-frame mid rail")!.qty).toBe(1); // 1 drawer → 1 rail under it
  });

  it("a frameless desk is left untouched (no deck, no extra rail)", () => {
    const c = makeCabinet("base", "D", { frontStyle: "desk", drawerCount: 1, toeKick: false });
    const { parts } = genParts(c, noBoxes);
    expect(find(parts, "Drawer deck")).toBeUndefined();
  });
});

describe("drawerBoxSpecs — the box is sized to the RUN opening, not a solo one", () => {
  // A framed bay in a run carries only HALF a stile at each joint, so its
  // opening — and its drawer box — is WIDER than a standalone cabinet's. The
  // box used to be derived solo (always W − 2×frameWidth) while the inset FRONT
  // was derived from the run: the boxes came out undersized and the slide line
  // moved inboard, which piled on pack-out. Pin both ends of that.
  const framed = makeCabinet("base", "FF", {
    width: 18,
    construction: "framed",
    overlay: "inset",
    frontStyle: "drawers",
    drawerCount: 3,
  });

  it("solo bay: box = W − two full stiles − 1\" of slide, centred", () => {
    const [b] = drawerBoxSpecs(framed, S);
    expect(b.boxWidth).toBe(14); // 18 − 1.5 − 1.5 − 1
    expect(b.boxLeft).toBe(2); // stile 1.5 + 1/2" slide
    expect(b.boxLeft + b.boxWidth).toBe(16); // symmetric — 2" clear each side
  });

  it("run bay: a half stile at each joint widens the box by that half stile", () => {
    const [b] = drawerBoxSpecs(framed, S, {
      emitFaceFrame: false,
      leftEnd: false,
      rightEnd: false,
    });
    expect(b.boxWidth).toBe(15.5); // 18 − 0.75 − 0.75 − 1 (was 14 when solo-derived)
    expect(b.boxLeft).toBe(1.25);
  });

  it("run END bay: full stile outboard, half stile at the joint — box hangs off centre", () => {
    const [b] = drawerBoxSpecs(framed, S, {
      emitFaceFrame: false,
      leftEnd: false,
      rightEnd: true,
    });
    expect(b.boxWidth).toBe(14.75); // 18 − 0.75 − 1.5 − 1
    expect(b.boxLeft).toBe(1.25); // NOT the carcass centre (which would be 1.625)
  });

  it("takes the run's own openingWidth when the run supplies one", () => {
    const [b] = drawerBoxSpecs(framed, S, { emitFaceFrame: false, openingWidth: 15.25 });
    expect(b.boxWidth).toBe(14.25);
  });

  it("the box and the inset FRONT are keyed off the SAME opening", () => {
    const frame = { emitFaceFrame: false, openingWidth: 15.25 };
    const { parts, geometry } = genParts(framed, S, frame);
    const front = find(parts, "Drawer front")!;
    // front = opening − 2 reveals; box = opening − 1" of slide. Both from 15.25.
    expect(front.length).toBe(15); // 15.25 − 2×0.125
    expect(geometry.drawerBoxes[0].boxWidth).toBe(14.25);
    // the box must still pass through the opening it lives behind
    expect(geometry.drawerBoxes[0].boxWidth).toBeLessThan(15.25);
  });

  it("frameless bays are unaffected — opening === carcass interior", () => {
    const fl = makeCabinet("base", "FL", { width: 18, frontStyle: "drawers", drawerCount: 3 });
    const solo = drawerBoxSpecs(fl, S)[0];
    const run = drawerBoxSpecs(fl, S, { emitFaceFrame: false, leftEnd: false, rightEnd: true })[0];
    expect(solo.boxWidth).toBe(15.5); // 18 − 2×0.75 − 1
    expect(run.boxWidth).toBe(solo.boxWidth); // no stiles to share
  });
});

describe("slideBlockingSpecs — slide pack-out for framed drawer bays", () => {
  // 18" framed drawer stack: box = 18 - 2×1.5 - 1 = 14" wide, 3/4" ply walls.
  const framed = makeCabinet("base", "FF", {
    width: 18,
    construction: "framed",
    frontStyle: "drawers",
    drawerCount: 3,
  });

  it("solo bay: symmetric pack-out flush with the full stiles", () => {
    const bl = slideBlockingSpecs(framed, S);
    expect(bl.map((b) => b.side)).toEqual(["left", "right"]);
    // box centred: slide planes at the stile edges, 1/2" off each box side
    expect(bl[0].plane).toBe(1.5);
    expect(bl[1].plane).toBe(16.5);
    // stile 1.5 − wall 0.75 = 3/4" pack-out, one ply strip each
    expect(bl[0].thickness).toBe(0.75);
    expect(bl[1].thickness).toBe(0.75);
    expect(bl.every((b) => b.layers === 1)).toBe(true);
    // strips run with the slide: box depth long × 4" wide
    expect(bl[0].length).toBe(22); // floor(24 − 0.25 back − 1)
    expect(bl[0].width).toBe(4);
  });

  it("run end bay: a strip at the full end stile, NONE at the shared half-stile joint", () => {
    // B3-style right end: 3/4" half-stile on the left, 1 1/2" end stile on the right.
    const bl = slideBlockingSpecs(framed, S, {
      emitFaceFrame: false,
      leftEnd: false,
      rightEnd: true,
    });
    // The box sizes to the RUN opening (0.75→16.5, box 14.75), so each slide
    // plane lands exactly on its stile's inner edge — the real-world rule.
    // The left half-stile is already flush with the 3/4" carcass wall, so that
    // side needs no pack-out at all and drops out.
    expect(bl.map((b) => b.side)).toEqual(["right"]);
    expect(bl[0].plane).toBe(16.5); // == the end stile's inner edge
    expect(bl[0].thickness).toBe(0.75); // stile 1.5 − wall 0.75
    expect(bl[0].layers).toBe(1);
  });

  it("a shared partition halves the wall, leaving a sub-ply pack-out to shim", () => {
    const bl = slideBlockingSpecs(framed, S, {
      emitFaceFrame: false,
      leftEnd: false,
      rightEnd: true,
      shareLeft: true,
    });
    // half-stile 0.75 − half a 3/4" partition = 3/8" — thinner than one ply, so
    // it is all shim (rounding UP to a ply would push the slide past its line).
    expect(bl[0].side).toBe("left");
    expect(bl[0].thickness).toBe(0.375);
    expect(bl[0].layers).toBe(0);
  });

  it("frameless boxes need no pack-out — slides mount straight to the carcass", () => {
    const fl = makeCabinet("base", "FL", { width: 18, frontStyle: "drawers", drawerCount: 3 });
    expect(slideBlockingSpecs(fl, S)).toEqual([]);
  });

  it("the cut list carries the strips (per drawer, per side, per layer) and the geometry carries the specs", () => {
    const { parts, geometry } = genParts(framed, S);
    const strip = find(parts, "Slide blocking strip")!;
    expect(strip.qty).toBe(6); // 3 drawers × (1 left + 1 right layer)
    expect(strip.length).toBe(22);
    expect(strip.width).toBe(4);
    expect(strip.role).toBe("carcass");
    expect(geometry.slideBlocking).toHaveLength(2);
    // a run-end bay packs out the END side only — the half-stile joint is
    // already flush with the wall: 3 drawers × 1 strip = 3
    const runEnd = genParts(framed, S, { emitFaceFrame: false, leftEnd: false, rightEnd: true });
    expect(find(runEnd.parts, "Slide blocking strip")!.qty).toBe(3);
    // suppressed with the drawer boxes; absent on doors-only and frameless boxes
    expect(find(genParts(framed, noBoxes).parts, "Slide blocking strip")).toBeUndefined();
    const doors = makeCabinet("base", "D", { construction: "framed", frontStyle: "doors", doorCount: 2 });
    expect(find(genParts(doors, S).parts, "Slide blocking strip")).toBeUndefined();
    const fl = makeCabinet("base", "FL", { width: 18, frontStyle: "drawers", drawerCount: 3 });
    expect(find(genParts(fl, S).parts, "Slide blocking strip")).toBeUndefined();
    expect(genParts(fl, S).geometry.slideBlocking).toEqual([]);
  });
});
