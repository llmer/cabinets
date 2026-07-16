import { Cabinet, CabinetParts, Part, Role, Settings, SlideBlockingSpec } from "@/domain/types";
import {
  backThickness,
  boxHeight,
  cabinetGeometry,
  carcassDepth,
  carcassThickness,
  effectiveFrameWidth,
  faceHeight,
  insetStackGap,
  isFramed,
  isInset,
  isOpenBox,
  isRailInset,
  topBorderWidth,
} from "./geometry";
import { getDrawerHeights } from "./drawers";
import { r3 } from "./units";

type Edge = "none" | "all" | number;

/**
 * How this cabinet's bay sits in a continuous run frame.
 * - `emitFaceFrame: false` — the run-level pass owns the frame, so skip the
 *   per-cabinet stiles/rails here (the box parts and fronts still emit).
 * - `openingWidth` — the bay's actual inset opening in the run frame
 *   (shared-stile aware). Wider than `W - 2·frameWidth` at every joint, so the
 *   inset fronts size up to the correct reveal.
 */
export interface FrameContext {
  emitFaceFrame: boolean;
  openingWidth?: number;
  /**
   * Inches the EXPOSED end side panel drops below the box bottom to meet the
   * face-frame bottom — so a finished end reads flush with the frame from the
   * side. 0 (or no exposed end) leaves both sides at box height.
   */
  sideDrop?: number;
  leftEnd?: boolean;
  rightEnd?: boolean;
  /**
   * This bay's LEFT side is a shared run partition supplied by the left
   * neighbour — suppress it here so the joint carries ONE panel, not two.
   */
  shareLeft?: boolean;
  /**
   * This bay OWNS the shared run partition on its RIGHT — emit it once for the
   * joint (its neighbour drops the matching side).
   */
  shareRight?: boolean;
}

const SOLO_FRAME: FrameContext = { emitFaceFrame: true };

/**
 * Generate the full cut list for one cabinet.
 *
 * Carcass / front geometry is ported verbatim from the imported design's
 * `genParts`. Drawer-box parts are an addition (the original listed only the
 * fronts), guarded by `settings.includeDrawerBoxes`. When the cabinet is part
 * of a continuous run frame, `frame` redirects the face frame to the run pass
 * and widens the inset openings at shared joints.
 */
export function genParts(c: Cabinet, s: Settings, frame: FrameContext = SOLO_FRAME): CabinetParts {
  const t = carcassThickness(s);
  const bt = backThickness(s);
  const rev = s.reveal;
  const ff = s.frameWidth || 1.5;
  const top = topBorderWidth(c, s); // top rail (framed) — usually wider than ff

  const W = c.width;
  const D = c.depth;
  const boxH = boxHeight(c, s);
  // Interior width loses a full panel per own side, but only HALF a panel where a
  // run shares that side — the shared partition is centred on the joint, so the
  // interior carcass panels reach it (matching the 3D scene, no cut-list drift).
  const interiorW = r3(W - (frame.shareLeft ? t / 2 : t) - (frame.shareRight ? t / 2 : t));
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
  // On an exposed end of a face-frame run, the end panel drops past the box
  // bottom to the frame line so the side profile matches the frame height.
  const drop = frame.sideDrop ?? 0;
  const endH = r3(boxH + drop);
  // Emit the two box sides individually so a run can share a joint partition. An
  // exposed end drops to the frame line; a shared joint is supplied ONCE by the
  // left bay (as its right "Shared partition") and dropped on the right bay's
  // left side. Un-shared, both sides merge back to the plain "Side panel" ×2.
  const emitSide = (isEnd: boolean, shared: boolean, suppress: boolean) => {
    if (suppress) return; // the neighbour supplies the shared partition
    if (isEnd && drop > 0) add("End panel", 1, endH, cd, "carcass", endH);
    else add(shared ? "Shared partition" : "Side panel", 1, boxH, cd, "carcass", boxH);
  };
  emitSide(!!frame.leftEnd, false, !!frame.shareLeft);
  emitSide(!!frame.rightEnd, !!frame.shareRight, false);
  if (openBox) {
    if (c.type === "base") add("Top stretcher", 2, interiorW, 4, "carcass", "none");
    else add("Top", 1, interiorW, cd, "carcass", interiorW);
    // An open box (appliance opening / desk knee) has no bottom, back or front
    // to keep it square, so a base surround ties the two sides together at the
    // back with a pair of stretchers on edge: one just under the top rear
    // stretcher and one across the back at floor level. Together with the rear
    // side edges they close the back into a rectangle that resists racking; the
    // bottom one also serves as a wall nailer.
    if (c.type === "base") {
      add("Back stretcher", 1, interiorW, 4, "carcass", "none");
      add("Back bottom stretcher", 1, interiorW, 4, "carcass", "none");
    }
    // A framed desk closes its drawer cavity with a horizontal deck panel under
    // the drawer; the open knee remains below it.
    if (c.frontStyle === "desk" && framed)
      add("Drawer deck", 1, interiorW, cd, "carcass", interiorW);
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
    // APPLIANCE OPENING: no front. In framed mode, surround the bay with a
    // continuous top rail and two stiles hung beneath it (no bottom rail — the
    // opening stays open to the floor).
    if (framed && frame.emitFaceFrame) {
      add("Face-frame top rail", 1, W, top, "faceFrame", "none");
      add("Face-frame stile", 2, r3(boxH - top), ff, "faceFrame", "none");
    }
  } else {
    // FACE-FRAME stock — solid hardwood (not nested). The top and bottom rails
    // are single continuous boards the full width of the box; the stiles are
    // captured between them. Mid rails only divide inset openings.
    if (framed && frame.emitFaceFrame) {
      const midLen = r3(W - 2 * ff); // mid rails fit between the stiles
      // A desk has no bottom rail — its knee stays open to the floor (it gets a
      // deck panel + a rail under the drawer instead, below) — so its stiles run
      // on down under the top rail.
      const hasBottom = c.frontStyle !== "desk";
      add("Face-frame top rail", 1, W, top, "faceFrame", "none");
      if (hasBottom) add("Face-frame bottom rail", 1, W, ff, "faceFrame", "none");
      add("Face-frame stile", 2, r3(boxH - top - (hasBottom ? ff : 0)), ff, "faceFrame", "none");
      const mid = !inset
        ? 0
        : c.frontStyle === "drawers"
          ? c.drawerCount - 1
          : c.frontStyle === "desk"
            ? c.drawerCount // a rail between drawers PLUS one under the drawer
            : c.frontStyle === "door_drawer"
              ? 1
              : 0;
      if (mid > 0) add("Face-frame mid rail", mid, midLen, ff, "faceFrame", "none");
    }

    // Frameless railed inset — a 3/4" rail between every stacked face (no stiles;
    // the box sides serve as the vertical reference). Framed boxes already have
    // their mid rails from the face frame above.
    if (isRailInset(c) && !framed) {
      const railW = s.frameWidth || 1.5;
      const railLen = r3(W - 2 * t);
      const mid =
        c.frontStyle === "drawers" || c.frontStyle === "desk"
          ? c.drawerCount - 1
          : c.frontStyle === "door_drawer"
            ? 1
            : 0;
      if (mid > 0) add("Inset rail", mid, railLen, railW, "carcass", railLen);
    }

    if (inset) {
      // INSET fronts — recessed inside the openings with a reveal all round.
      const insR = rev;
      const effFF = effectiveFrameWidth(c, s); // frame stile (framed) or box edge (frameless)
      const gap = insetStackGap(c, s); // mid rail (framed) or reveal (frameless)
      // In a continuous run frame, this bay's opening is wider at shared joints
      // (a half-stile, not a full one), so the fronts size up to it.
      const openW =
        framed && frame.openingWidth != null
          ? r3(frame.openingWidth)
          : r3(W - 2 * effFF);
      const frontW = r3(openW - 2 * insR);
      const doorW = (nd: number) => r3((openW - insR * (nd + 1)) / nd);
      if (c.frontStyle === "desk" || c.frontStyle === "drawers") {
        const hs = getDrawerHeights(c, s);
        hs.forEach((dh) => add("Drawer front", 1, frontW, r3(dh - 2 * insR), "front", "all"));
      } else if (c.frontStyle === "door_drawer") {
        const dh = getDrawerHeights(c, s)[0];
        add("Drawer front", 1, frontW, r3(dh - 2 * insR), "front", "all");
        const openHdoor = r3(boxH - top - effFF - gap - dh);
        const nd = c.doorCount;
        add("Door", nd, doorW(nd), r3(openHdoor - 2 * insR), "front", "all");
      } else {
        const openH = r3(boxH - top - effFF);
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
  const blocking = slideBlockingSpecs(c, s, frame);
  if (s.includeDrawerBoxes && hasDrawers(c)) {
    const boxSpecs = drawerBoxSpecs(c, s);
    for (const sp of boxSpecs) {
      add("Drawer box side", 2, sp.boxDepth, sp.boxHeight, "drawerBox", "none");
      add("Drawer box front/back", 2, r3(sp.boxWidth - 2 * sp.sideThickness), sp.boxHeight, "drawerBox", "none");
      add("Drawer bottom", 1, sp.bottomWidth, sp.bottomLength, "drawerBottom", "none");
    }
    // Slide pack-out — a framed bay's box clears the FRAME opening, so each
    // wall gets ply strips (per drawer, per side) out to the slide line.
    const strips = blocking.reduce((n, b) => n + b.layers, 0) * boxSpecs.length;
    if (strips > 0)
      add("Slide blocking strip", strips, blocking[0].length, blocking[0].width, "carcass", "none");
  }

  return {
    cabinet: c,
    geometry: {
      ...cabinetGeometry(c, s),
      endDropLeft: frame.leftEnd ? drop : 0,
      endDropRight: frame.rightEnd ? drop : 0,
      slideBlocking: blocking,
    },
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

/** Per-drawer box dimensions, used by both the cut list and the build plans. */
export interface DrawerBoxSpec {
  /** 1-based position from the top. */
  index: number;
  /** The drawer FRONT height (inches). */
  frontHeight: number;
  /** Outside dimensions of the drawer box. */
  boxWidth: number;
  boxDepth: number;
  boxHeight: number;
  sideThickness: number;
  /** Bottom panel, captured in a 1/4" groove all round. */
  bottomWidth: number;
  bottomLength: number;
  bottomThickness: number;
}

/** Width of a slide-blocking strip — enough to catch any slide's screw pattern. */
const BLOCKING_STRIP_WIDTH = 4;

/**
 * Slide pack-out strips for a framed drawer bay, per side.
 *
 * The drawer box clears the face-frame OPENING (see `drawerBoxSpecs`), and it
 * hangs centred under its front — so each slide's mounting face sits well
 * inboard of the carcass wall, and the wall gets packed out to it with ply
 * strips. The pack-out is asymmetric in a run: a shared half-stile joint puts
 * the frame edge (and so the slide line) closer to the wall than an exposed
 * end carrying a full stile. A shared partition (half a panel in this bay)
 * moves the wall itself, and the strip thickens to match. Frameless boxes
 * need none — their slides mount straight to the carcass at 1/2" per side.
 */
export function slideBlockingSpecs(
  c: Cabinet,
  s: Settings,
  frame: FrameContext = SOLO_FRAME,
): SlideBlockingSpec[] {
  if (!isFramed(c) || !hasDrawers(c)) return [];
  const t = carcassThickness(s);
  const ff = s.frameWidth || 1.5;
  // Stile width inside this bay: full on a solo cabinet or an exposed run end,
  // half at a run joint — mirrors `runs.ts` (openingWidth / openingLeft).
  const solo = frame.emitFaceFrame;
  const stileL = solo || frame.leftEnd ? ff : ff / 2;
  const stileR = solo || frame.rightEnd ? ff : ff / 2;
  // Wall inner faces: a shared partition is centred on the joint, so only half
  // its thickness lives in this bay — same rule as `interiorW` in genParts.
  const wallL = frame.shareLeft ? t / 2 : t;
  const wallR = frame.shareRight ? t / 2 : t;
  const boxW = r3(c.width - 2 * effectiveFrameWidth(c, s) - 1); // == drawerBoxSpecs
  const centre = stileL + (c.width - stileL - stileR) / 2;
  const boxDepth = Math.max(6, Math.floor(carcassDepth(c, s) - 1));
  const mk = (side: "left" | "right", plane: number, thickness: number): SlideBlockingSpec => ({
    side,
    plane: r3(plane),
    thickness: r3(thickness),
    layers: Math.max(1, Math.round(thickness / t)),
    length: boxDepth,
    width: BLOCKING_STRIP_WIDTH,
  });
  const planeL = centre - boxW / 2 - 0.5;
  const planeR = centre + boxW / 2 + 0.5;
  return [
    mk("left", planeL, planeL - wallL),
    mk("right", planeR, c.width - wallR - planeR),
  ].filter((sp) => sp.thickness > 0.05);
}

/**
 * Drawer-box geometry for every drawer front.
 *
 * Assumptions: side-mount slides take 1/2" per side (box is 1" narrower than the
 * opening); the box sides run ~1" shallower than the front; the bottom is
 * captured in a 1/4" groove on all four sides.
 */
export function drawerBoxSpecs(c: Cabinet, s: Settings): DrawerBoxSpec[] {
  if (!hasDrawers(c)) return [];
  const dt = s.stocks[s.roleStock.drawerBox].thickness;
  const bt = s.stocks[s.roleStock.drawerBottom].thickness;
  // The box must clear the front aperture: the face-frame opening when framed,
  // otherwise the carcass interior. Frameless: opening === interior (unchanged).
  const opening = r3(c.width - 2 * effectiveFrameWidth(c, s));
  const cDepth = carcassDepth(c, s);
  const boxW = r3(opening - 1);
  const boxDepth = Math.max(6, Math.floor(cDepth - 1));
  return getDrawerHeights(c, s).map((dh, i) => {
    const sideH = r3(Math.max(2.5, dh - 1));
    return {
      index: i + 1,
      frontHeight: dh,
      boxWidth: boxW,
      boxDepth,
      boxHeight: sideH,
      sideThickness: dt,
      bottomWidth: r3(boxW - 2 * dt + 0.5),
      bottomLength: r3(boxDepth - 2 * dt + 0.5),
      bottomThickness: bt,
    };
  });
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
