import { Cabinet, CabinetGeometry, Settings } from "@/domain/types";
import { r3 } from "./units";

/** Thickness of the carcass stock (sides, top/bottom, shelves). */
export function carcassThickness(s: Settings): number {
  return s.stocks[s.roleStock.carcass].thickness;
}

/** Thickness of the back stock (when an applied back is present). */
export function backThickness(s: Settings): number {
  return s.stocks[s.roleStock.back].thickness;
}

export function isFramed(c: Cabinet): boolean {
  return (c.construction || "frameless") === "framed";
}

/** Desk and opening fronts produce a box with no bottom and no back. */
export function isOpenBox(c: Cabinet): boolean {
  return c.frontStyle === "desk" || c.frontStyle === "opening";
}

/** Finished box height — the carcass without the toe kick (base/tall). */
export function boxHeight(c: Cabinet, s: Settings): number {
  if (c.type === "wall") return c.height;
  const tk = c.toeKick === false ? 0 : s.toeKick;
  return r3(c.height - tk);
}

/** Clear interior width between the two side panels. */
export function interiorWidth(c: Cabinet, s: Settings): number {
  return r3(c.width - 2 * carcassThickness(s));
}

/** Depth of the carcass sides (reduced by the applied back, unless open box). */
export function carcassDepth(c: Cabinet, s: Settings): number {
  if (isOpenBox(c)) return c.depth;
  return r3(c.depth - backThickness(s));
}

/** Height of a full-overlay front (box height less one reveal). */
export function faceHeight(c: Cabinet, s: Settings): number {
  return r3(boxHeight(c, s) - s.reveal);
}

export function cabinetGeometry(c: Cabinet, s: Settings): CabinetGeometry {
  return {
    boxHeight: boxHeight(c, s),
    interiorWidth: interiorWidth(c, s),
    carcassDepth: carcassDepth(c, s),
    faceHeight: faceHeight(c, s),
    framed: isFramed(c),
    openBox: isOpenBox(c),
  };
}
