import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Part, Settings } from "@/domain/types";
import { genParts } from "./parts";

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

describe("genParts — face frame", () => {
  const c = makeCabinet("base", "B3", {
    width: 24,
    height: 34.5,
    frontStyle: "doors",
    doorCount: 2,
    construction: "framed",
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

  it("sizes inset doors inside the opening", () => {
    const door = find(parts, "Door")!;
    // opening width 24 - 2*1.5 = 21; doorW = (21 - 0.125*3)/2 = 10.3125 -> r3 10.313
    expect(door.length).toBe(10.313);
    expect(door.bandAll).toBe(true);
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
  });
});
