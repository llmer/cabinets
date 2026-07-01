import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Cabinet, Settings } from "@/domain/types";
import { drawerStackBudget } from "@/engine/drawers";
import * as ops from "./ops";

const S: Settings = DEFAULT_SETTINGS;

function base(over: Partial<Cabinet> = {}): Cabinet {
  return makeCabinet("base", "B1", { width: 24, height: 34.5, depth: 24, ...over });
}

const sum = (xs: number[] | undefined) => (xs ?? []).reduce((a, x) => a + x, 0);

describe("ops — cabinet list", () => {
  it("addCabinet appends with an auto name and a fresh id", () => {
    const start = [base()];
    const { cabinets, cabinet } = ops.addCabinet(start, S, "base");
    expect(cabinets).toHaveLength(2);
    expect(cabinet.name).toBe("B2");
    expect(cabinet.id).not.toBe(start[0].id);
    // input is not mutated
    expect(start).toHaveLength(1);
  });

  it("addCabinet with no overrides leaves heights undefined (matches store)", () => {
    const { cabinet } = ops.addCabinet([], S, "base");
    expect(cabinet.drawerHeights).toBeUndefined();
  });

  it("addCabinet seeds construction from settings.construction", () => {
    const framed = ops.addCabinet([], { ...S, construction: "framed" }, "base").cabinet;
    expect(framed.construction).toBe("framed");
    // explicit override still wins
    const overridden = ops.addCabinet([], { ...S, construction: "framed" }, "base", {
      construction: "frameless",
    }).cabinet;
    expect(overridden.construction).toBe("frameless");
  });

  it("gives new + duplicated cabinets a unique name even after a remove", () => {
    // add B1, add B2, remove B1, add base → must NOT reuse 'B2'
    let cabs = ops.addCabinet([], S, "base").cabinets; // B1
    cabs = ops.addCabinet(cabs, S, "base").cabinets; // B2
    cabs = ops.removeCabinet(cabs, cabs[0].id); // drop B1
    const added = ops.addCabinet(cabs, S, "base").cabinet;
    expect(cabs.map((c) => c.name)).not.toContain(added.name);
    // a caller-supplied colliding name is uniquified too
    const collide = ops.addCabinet(cabs, S, "base", { name: "B2" }).cabinet;
    expect(collide.name).not.toBe("B2");
  });

  it("addCabinet re-derives heights when overrides touch the budget", () => {
    const { cabinet } = ops.addCabinet([], S, "base", {
      frontStyle: "drawers",
      drawerCount: 3,
    });
    expect(cabinet.drawerHeights).toHaveLength(3);
    expect(sum(cabinet.drawerHeights)).toBeGreaterThan(0);
  });

  it("addCabinet enforces open-box invariants for a seeded opening/desk", () => {
    const open = ops.addCabinet([], S, "base", { frontStyle: "opening" }).cabinet;
    expect(open.toeKick).toBe(false);
    expect(open.shelves).toBe(0);
    const desk = ops.addCabinet([], S, "base", { frontStyle: "desk", drawerCount: 0 }).cabinet;
    expect(desk.toeKick).toBe(false);
    expect(desk.drawerCount).toBeGreaterThanOrEqual(1);
  });

  it("duplicateCabinet inserts the copy right after the source", () => {
    const a = base({ name: "B1" });
    const b = base({ name: "B2" });
    const { cabinets, cabinet } = ops.duplicateCabinet([a, b], a.id);
    expect(cabinets.map((c) => c.id)).toEqual([a.id, cabinet!.id, b.id]);
    expect(cabinet!.id).not.toBe(a.id);
  });

  it("removeCabinet drops the target only", () => {
    const a = base();
    const b = base();
    expect(ops.removeCabinet([a, b], a.id).map((c) => c.id)).toEqual([b.id]);
  });

  it("moveCabinet re-sequences the list and clamps the target index", () => {
    const a = base({ name: "A" });
    const b = base({ name: "B" });
    const c = base({ name: "C" });
    expect(ops.moveCabinet([a, b, c], c.id, 0).map((x) => x.name)).toEqual(["C", "A", "B"]);
    expect(ops.moveCabinet([a, b, c], a.id, 99).map((x) => x.name)).toEqual(["B", "C", "A"]);
    expect(ops.moveCabinet([a, b, c], "nope", 0)).toEqual([a, b, c]);
  });

  it("setFrontStyle desk forces an open box and a drawer", () => {
    const c = base({ frontStyle: "doors", toeKick: true, shelves: 2, drawerCount: 0 });
    const [out] = ops.setFrontStyle([c], S, c.id, "desk");
    expect(out.frontStyle).toBe("desk");
    expect(out.toeKick).toBe(false);
    expect(out.shelves).toBe(0);
    expect(out.drawerCount).toBeGreaterThanOrEqual(1);
    expect(out.drawerHeights?.length).toBeGreaterThanOrEqual(1);
  });

  it("setFrontStyle opening strips shelves + toe kick", () => {
    const c = base({ shelves: 3, toeKick: true });
    const [out] = ops.setFrontStyle([c], S, c.id, "opening");
    expect(out.toeKick).toBe(false);
    expect(out.shelves).toBe(0);
  });

  it("setDrawerCount re-splits the stack evenly and fits the budget", () => {
    const c = base({ frontStyle: "drawers", drawerCount: 2 });
    const [out] = ops.setDrawerCount([c], S, c.id, 4);
    expect(out.drawerCount).toBe(4);
    expect(out.drawerHeights).toHaveLength(4);
    expect(sum(out.drawerHeights)).toBeLessThanOrEqual(drawerStackBudget(out, S) + 0.03);
  });

  it("setOverlay + setConstruction recompute heights (budget moves)", () => {
    const c = base({ frontStyle: "drawers", drawerCount: 3, overlay: "full" });
    const [ov] = ops.setOverlay([c], S, c.id, "inset");
    expect(ov.overlay).toBe("inset");
    expect(sum(ov.drawerHeights)).toBeLessThanOrEqual(drawerStackBudget(ov, S) + 0.03);
    const [fr] = ops.setConstruction([c], S, c.id, "framed");
    expect(fr.construction).toBe("framed");
    expect(sum(fr.drawerHeights)).toBeLessThanOrEqual(drawerStackBudget(fr, S) + 0.03);
  });

  it("setCabinetType clamps base-only fronts + wall depth", () => {
    const c = base({ frontStyle: "drawers", depth: 24 });
    const [out] = ops.setCabinetType([c], c.id, "wall");
    expect(out.type).toBe("wall");
    expect(out.frontStyle).toBe("doors"); // drawers is base-only
    expect(out.depth).toBe(12);
  });

  it("setCabinetType bumps a short tall cabinet up to 84", () => {
    const c = base({ height: 34.5 });
    const [out] = ops.setCabinetType([c], c.id, "tall");
    expect(out.height).toBe(84);
  });

  it("setRunBreak toggles the escape hatch on and off", () => {
    const c = base();
    const [on] = ops.setRunBreak([c], c.id, true);
    expect(on.runBreak).toBe(true);
    const [off] = ops.setRunBreak([on], c.id, false);
    expect(off.runBreak).toBeUndefined();
  });

  it("setConstructionAll / setOverlayAll touch every cabinet", () => {
    const cabs = [base(), base({ construction: "framed" })];
    const framed = ops.setConstructionAll(cabs, S, "framed");
    expect(framed.every((c) => c.construction === "framed")).toBe(true);
    const inset = ops.setOverlayAll(cabs, S, "inset");
    expect(inset.every((c) => c.overlay === "inset")).toBe(true);
  });

  it("unknown ids are no-ops that return the input list", () => {
    const cabs = [base()];
    expect(ops.setFrontStyle(cabs, S, "nope", "desk")).toBe(cabs);
    expect(ops.setCabinetType(cabs, "nope", "wall")).toBe(cabs);
    expect(ops.duplicateCabinet(cabs, "nope").cabinet).toBeNull();
  });
});

describe("ops — settings", () => {
  it("updateSettings merges shallowly without mutating", () => {
    const next = ops.updateSettings(S, { reveal: 0.0625 });
    expect(next.reveal).toBe(0.0625);
    expect(S.reveal).toBe(0.125);
  });

  it("updateStock patches one stock, setRoleStock re-points a role", () => {
    const s1 = ops.updateStock(S, "ply34", { costPerSheet: 99 });
    expect(s1.stocks.ply34.costPerSheet).toBe(99);
    expect(S.stocks.ply34.costPerSheet).toBe(55);
    const s2 = ops.setRoleStock(S, "back", "ply14");
    expect(s2.roleStock.back).toBe("ply14");
  });

  it("updateHardware merges pricing", () => {
    const s = ops.updateHardware(S, { hingeEach: 5 });
    expect(s.hardware.hingeEach).toBe(5);
    expect(s.hardware.slidePairEach).toBe(S.hardware.slidePairEach);
  });
});
