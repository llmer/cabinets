import { Cabinet, Settings } from "@/domain/types";
import { boxHeight, faceHeight, isFramed } from "./geometry";
import { r3 } from "./units";

/**
 * Drawer-height model — ported from the imported design.
 *
 * `drawerHeights[]` are the individual drawer-FRONT heights (inches). The
 * default is an even split of the available stack; user edits are clamped so
 * the stack can never overflow the face opening.
 */

/** Minimum knee clearance kept open below the drawers on a desk. */
const DESK_KNEE_CLEARANCE = 22;
/** Minimum door opening kept below the drawer on a drawer-over-door front. */
const DOOR_DRAWER_MIN_DOOR = 6;

/** Total vertical room available to the drawer-front stack. */
export function drawerStackBudget(c: Cabinet, s: Settings): number {
  const boxH = boxHeight(c, s);
  const rev = s.reveal;
  const ff = s.frameWidth || 1.5;

  if (c.frontStyle === "desk") {
    // Drawers sit at the top over an OPEN knee space — cap the stack so at
    // least ~22" of knee clearance remains (not the full face height).
    const n = c.drawerCount;
    return r3(Math.max(n * 2, boxH - DESK_KNEE_CLEARANCE));
  }

  if (isFramed(c)) {
    if (c.frontStyle === "door_drawer") {
      // top + mid + bottom rail + >=6" door opening
      return r3(boxH - 3 * ff - DOOR_DRAWER_MIN_DOOR);
    }
    const n = c.drawerCount;
    return r3(boxH - 2 * ff - (n - 1) * ff);
  }

  const faceH = faceHeight(c, s);
  if (c.frontStyle === "door_drawer") {
    return r3(faceH - rev - DOOR_DRAWER_MIN_DOOR); // leave >=6" for the doors below
  }
  const n = c.drawerCount;
  return r3(faceH - (n - 1) * rev);
}

/** Even split of the budget across `n` drawers. */
export function evenHeights(c: Cabinet, n: number, s: Settings): number[] {
  const tmp: Cabinet = { ...c, drawerCount: n };
  const budget = drawerStackBudget(tmp, s);
  // Desk drawers default to a shallow ~5" pencil drawer, not the whole budget.
  const each = tmp.frontStyle === "desk" ? Math.min(5, budget / n) : budget / n;
  return Array(n).fill(r3(each));
}

export function defaultHeights(c: Cabinet, s: Settings): number[] {
  if (c.frontStyle === "door_drawer") return [6];
  return evenHeights(c, c.drawerCount, s);
}

/**
 * Resolve the effective drawer-front heights for a cabinet, falling back to an
 * even split when the stored heights are missing or no longer valid.
 */
export function getDrawerHeights(c: Cabinet, s: Settings): number[] {
  if (c.frontStyle === "door_drawer") {
    const maxD = Math.max(2, drawerStackBudget(c, s));
    const v =
      Array.isArray(c.drawerHeights) && c.drawerHeights.length
        ? c.drawerHeights[0]
        : 6;
    return [Math.max(2, Math.min(maxD, v))];
  }
  const n = c.drawerCount;
  const budget = drawerStackBudget(c, s);
  let hs: number[] | null =
    Array.isArray(c.drawerHeights) && c.drawerHeights.length === n
      ? c.drawerHeights.slice()
      : null;
  if (hs) {
    const sum = hs.reduce((a, x) => a + x, 0);
    if (sum > budget + 0.03 || hs.some((x) => x < 0.9)) hs = null;
  }
  if (!hs) hs = evenHeights(c, n, s);
  return hs;
}

/**
 * Pure helper: return a new heights array with drawer `i` set to `val`,
 * clamped so the stack never overflows.
 */
export function withDrawerHeight(
  c: Cabinet,
  s: Settings,
  i: number,
  val: number,
): number[] {
  let v = val;
  if (isNaN(v)) v = 1;
  v = Math.max(1, v);
  const hs = getDrawerHeights(c, s).slice();
  const budget = drawerStackBudget(c, s);
  if (c.frontStyle === "door_drawer") {
    hs[0] = r3(Math.min(v, Math.max(1, budget)));
  } else {
    const others = hs.reduce((a, x, j) => (j === i ? a : a + x), 0);
    const max = Math.max(1, r3(budget - others));
    hs[i] = r3(Math.min(v, max));
  }
  return hs;
}
