import { Cabinet, CabinetParts, Part, Role, Settings } from "@/domain/types";
import {
  backThickness,
  boxHeight,
  cabinetGeometry,
  carcassThickness,
  effectiveFrameWidth,
  faceHeight,
  insetStackGap,
  isFramed,
  isInset,
  isOpenBox,
} from "./geometry";
import { getDrawerHeights } from "./drawers";
import { r3 } from "./units";

type Edge = "none" | "all" | number;

/**
 * Generate the full cut list for one cabinet.
 *
 * Carcass / front geometry is ported verbatim from the imported design's
 * `genParts`. Drawer-box parts are an addition (the original listed only the
 * fronts), guarded by `settings.includeDrawerBoxes`.
 */
export function genParts(c: Cabinet, s: Settings): CabinetParts {
  const t = carcassThickness(s);
  const bt = backThickness(s);
  const rev = s.reveal;
  const ff = s.frameWidth || 1.5;

  const W = c.width;
  const D = c.depth;
  const boxH = boxHeight(c, s);
  const interiorW = r3(W - 2 * t);
  const cDepth = r3(D - bt);
  const framed = isFramed(c);
  const openBox = isOpenBox(c);
  const cd = openBox ? D : cDepth; // no applied back => sides/top run full depth

  const parts: Part[] = [];
  const add = (
    name: string,
    qty: number,
    length: number,
    width: number,
    role: Role,
    edge: Edge = "none",
  ) => {
    parts.push({
      name,
      qty,
      length: r3(length),
      width: r3(width),
      role,
      stockId: s.roleStock[role],
      bandAll: edge === "all",
      bandFrontEdge: typeof edge === "number" ? r3(edge) : 0,
      linear: s.stocks[s.roleStock[role]].kind === "linear",
    });
  };

  /* ---------- carcass ---------- */
  add("Side panel", 2, boxH, cd, "carcass", boxH);
  if (openBox) {
    if (c.type === "base") add("Top stretcher", 2, interiorW, 4, "carcass", "none");
    else add("Top", 1, interiorW, cd, "carcass", interiorW);
  } else {
    add("Bottom", 1, interiorW, cd, "carcass", interiorW);
    if (c.type === "base") add("Top stretcher", 2, interiorW, 4, "carcass", "none");
    else add("Top", 1, interiorW, cd, "carcass", interiorW);
    add("Back (applied)", 1, W, boxH, "back", "none");
    if (c.shelves > 0)
      add("Adjustable shelf", c.shelves, interiorW, r3(cd - 1), "carcass", interiorW);
  }

  /* ---------- fronts ---------- */
  const inset = isInset(c);

  if (c.frontStyle === "opening") {
    // APPLIANCE OPENING: no front. In framed mode, surround the bay.
    if (framed) {
      add("Face-frame stile", 2, boxH, ff, "faceFrame", "none");
      add("Face-frame top rail", 1, r3(W - 2 * ff), ff, "faceFrame", "none");
    }
  } else {
    // FACE-FRAME stock — solid hardwood (not nested). Mid rails only divide
    // inset openings; full-overlay fronts span a single opening.
    if (framed) {
      const railLen = r3(W - 2 * ff);
      add("Face-frame stile", 2, boxH, ff, "faceFrame", "none");
      add("Face-frame top rail", 1, railLen, ff, "faceFrame", "none");
      if (c.frontStyle !== "desk")
        add("Face-frame bottom rail", 1, railLen, ff, "faceFrame", "none");
      const mid = !inset
        ? 0
        : c.frontStyle === "drawers" || c.frontStyle === "desk"
          ? c.drawerCount - 1
          : c.frontStyle === "door_drawer"
            ? 1
            : 0;
      if (mid > 0) add("Face-frame mid rail", mid, railLen, ff, "faceFrame", "none");
    }

    if (inset) {
      // INSET fronts — recessed inside the openings with a reveal all round.
      const insR = rev;
      const effFF = effectiveFrameWidth(c, s); // frame stile (framed) or box edge (frameless)
      const gap = insetStackGap(c, s); // mid rail (framed) or reveal (frameless)
      const openW = r3(W - 2 * effFF);
      const frontW = r3(openW - 2 * insR);
      const doorW = (nd: number) => r3((openW - insR * (nd + 1)) / nd);
      if (c.frontStyle === "desk" || c.frontStyle === "drawers") {
        const hs = getDrawerHeights(c, s);
        hs.forEach((dh) => add("Drawer front", 1, frontW, r3(dh - 2 * insR), "front", "all"));
      } else if (c.frontStyle === "door_drawer") {
        const dh = getDrawerHeights(c, s)[0];
        add("Drawer front", 1, frontW, r3(dh - 2 * insR), "front", "all");
        const openHdoor = r3(boxH - 2 * effFF - gap - dh);
        const nd = c.doorCount;
        add("Door", nd, doorW(nd), r3(openHdoor - 2 * insR), "front", "all");
      } else {
        const openH = r3(boxH - 2 * effFF);
        const nd = c.doorCount;
        add("Door", nd, doorW(nd), r3(openH - 2 * insR), "front", "all");
      }
    } else {
      // FULL-OVERLAY fronts — sit proud, covering the box/frame to a reveal.
      const faceW = r3(W - rev);
      const faceH = r3(boxH - rev);
      if (c.frontStyle === "desk" || c.frontStyle === "drawers") {
        const hs = getDrawerHeights(c, s);
        hs.forEach((dh) => add("Drawer front", 1, faceW, dh, "front", "all"));
      } else if (c.frontStyle === "door_drawer") {
        const dh = getDrawerHeights(c, s)[0];
        add("Drawer front", 1, faceW, dh, "front", "all");
        const doorH = r3(faceH - dh - rev);
        const nd = c.doorCount;
        const dw = r3((faceW - (nd - 1) * rev) / nd);
        add("Door", nd, dw, doorH, "front", "all");
      } else {
        const nd = c.doorCount;
        const dw = r3((faceW - (nd - 1) * rev) / nd);
        add("Door", nd, dw, faceH, "front", "all");
      }
    }
  }

  /* ---------- drawer boxes (addition) ---------- */
  if (s.includeDrawerBoxes && hasDrawers(c)) {
    addDrawerBoxes(parts, add, c, s, interiorW, cDepth);
  }

  return {
    cabinet: c,
    geometry: cabinetGeometry(c, s),
    parts: mergeParts(parts),
  };
}

function hasDrawers(c: Cabinet): boolean {
  return (
    c.frontStyle === "drawers" ||
    c.frontStyle === "desk" ||
    c.frontStyle === "door_drawer"
  );
}

/**
 * Append drawer-box parts for every drawer front.
 *
 * Assumptions (documented in the cut-list notes): side-mount slides take 1/2"
 * per side (box is 1" narrower than the opening); the bottom is captured in a
 * 1/4" groove on all four sides; box sides run ~1" shallower than the front.
 */
function addDrawerBoxes(
  parts: Part[],
  add: (n: string, q: number, l: number, w: number, role: Role, e?: Edge) => void,
  c: Cabinet,
  s: Settings,
  interiorW: number,
  cDepth: number,
): void {
  void parts;
  const dt = s.stocks[s.roleStock.drawerBox].thickness;
  const boxW = r3(interiorW - 1);
  const boxDepth = Math.max(6, Math.floor(cDepth - 1));
  const heights = getDrawerHeights(c, s);
  for (const dh of heights) {
    const sideH = r3(Math.max(2.5, dh - 1));
    add("Drawer box side", 2, boxDepth, sideH, "drawerBox", "none");
    add("Drawer box front/back", 2, r3(boxW - 2 * dt), sideH, "drawerBox", "none");
    add(
      "Drawer bottom",
      1,
      r3(boxW - 2 * dt + 0.5),
      r3(boxDepth - 2 * dt + 0.5),
      "drawerBottom",
      "none",
    );
  }
}

/** Merge parts that are identical in every shop-relevant dimension. */
export function mergeParts(parts: Part[]): Part[] {
  const map = new Map<string, Part>();
  for (const p of parts) {
    const key = `${p.name}|${p.length}|${p.width}|${p.role}|${p.stockId}|${p.bandAll}|${p.bandFrontEdge}`;
    const existing = map.get(key);
    if (existing) existing.qty += p.qty;
    else map.set(key, { ...p });
  }
  return [...map.values()];
}

/** Inches of edge-banding for a single piece (× qty applied by callers). */
export function bandingInchesPerPiece(p: Part): number {
  if (p.bandAll) return 2 * (p.length + p.width);
  return p.bandFrontEdge;
}

/** Re-export geometry helpers commonly needed alongside parts. */
export { boxHeight, faceHeight, isFramed, isOpenBox };
