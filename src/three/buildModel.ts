import { Cabinet, Settings } from "@/domain/types";
import { BuildStage } from "@/engine/steps";
import {
  backThickness,
  boxHeight,
  carcassThickness,
  effectiveFrameWidth,
  insetStackGap,
  isFramed,
  isInset,
  isRailInset,
} from "@/engine/geometry";
import { getDrawerHeights } from "@/engine/drawers";
import { drawerBoxSpecs } from "@/engine/parts";

/**
 * Staged build geometry for ONE cabinet — the data behind the build-tab 3D
 * walkthrough. Pure and framework-free (no Three.js, no DOM): it emits plain
 * axis-aligned boxes tagged with the assembly `stage` they belong to and a
 * material `kind`. `three/CabinetScene.ts` turns these into meshes, drawing
 * earlier stages solid, the current stage highlighted and later stages ghosted.
 *
 * The geometry mirrors `CabinetScene.addCabinet3D` so the focused build render
 * matches the whole-run render, with two deliberate differences for the
 * single-box walkthrough:
 *   - the box always sits near the floor (wall cabinets are not lifted to
 *     `upperBottom`) so a lone cabinet stays well framed;
 *   - both the fronts AND the interior (drawer boxes, shelves) are emitted, so
 *     the scene can flip to a cutaway view; the renderer filters by kind.
 */

export type BuildPartKind =
  | "carcass" // side / top / bottom / stretcher / desktop panel
  | "back" // applied back
  | "toeKick" // recessed toe-kick plinth
  | "frame" // hardwood face-frame stile / rail
  | "front" // door or drawer face
  | "handle" // pull
  | "shelf" // adjustable shelf
  | "drawerBox"; // a drawer-box panel (interior)

export interface BuildPart {
  stage: BuildStage;
  kind: BuildPartKind;
  /** Axis-aligned box: [x0, x1, y0, y1, z0, z1] in inches. */
  box: [number, number, number, number, number, number];
}

/** Front-panel thickness used for the 3D fronts (matches the main scene). */
const FRONT_T = 0.75;
/** Reveal gap drawn between adjacent fronts. */
const GAP = 0.125;

/**
 * Bottom of the carcass for the isolated build view. Base/tall boxes ride the
 * toe-kick height (the plinth fills in at the `base` stage); everything else
 * sits on the floor.
 */
export function buildBaseY(c: Cabinet, s: Settings): number {
  const openBox = c.frontStyle === "opening" || c.frontStyle === "desk";
  return c.type !== "wall" && c.toeKick !== false && !openBox ? s.toeKick : 0;
}

export function cabinetBuildParts(c: Cabinet, s: Settings): BuildPart[] {
  const out: BuildPart[] = [];
  const push = (
    stage: BuildStage,
    kind: BuildPartKind,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
  ) => {
    if (Math.abs(x1 - x0) < 0.01 || Math.abs(y1 - y0) < 0.01 || Math.abs(z1 - z0) < 0.01)
      return;
    out.push({ stage, kind, box: [x0, x1, y0, y1, z0, z1] });
  };

  const matT = carcassThickness(s);
  const backT = backThickness(s);
  const W = c.width;
  const D = c.depth;
  const boxH = boxHeight(c, s);
  const framed = isFramed(c);
  const opening = c.frontStyle === "opening";
  const desk = c.frontStyle === "desk";
  const openBox = opening || desk;
  const yB = buildBaseY(c, s);
  const yT = yB + boxH;
  const x1 = W;

  const ff = s.frameWidth || 1.5; // stile / mid / bottom-rail width
  const topRail = s.faceFrameTop || 2; // the (wider) top rail
  // A toe-kicked framed box drops its frame — and its exposed end panels — to
  // the frame-floor gap (3.25" over the toe kick); floor-standing boxes (an
  // opening / desk) keep their frame at the box bottom. Mirrors the main scene.
  const based = c.type !== "wall" && c.toeKick !== false && !openBox;
  const frameBottom = framed && based ? s.faceFrameFloorGap || 3.25 : yB;

  /* ---------- carcass ---------- */
  // side panels — cut, drilled and edge-banded at the `sides` stage. They run the
  // FULL depth (0..D) so the front sits at the front plane (flush with the front
  // stretcher + face frame) and the rear stays flush with the inset applied back.
  // On a framed toe-kicked box the (exposed) ends drop to the frame line.
  push("sides", "carcass", 0, matT, frameBottom, yT, 0, D);
  push("sides", "carcass", x1 - matT, x1, frameBottom, yT, 0, D);
  // bottom (closed boxes only)
  if (!openBox) push("carcass", "carcass", matT, x1 - matT, yB, yB + matT, 0, D);
  // top: base/desk get two stretchers (front + back), others a full top
  if (c.type === "base") {
    push("carcass", "carcass", matT, x1 - matT, yT - matT, yT, 0, 4);
    push("carcass", "carcass", matT, x1 - matT, yT - matT, yT, D - 4, D);
  } else {
    push("carcass", "carcass", matT, x1 - matT, yT - matT, yT, 0, D);
  }
  // Open box (appliance opening / desk knee): a pair of back stretchers on edge
  // (at the back, z≈0) stiffen the open surround — one under the top rear
  // stretcher, one across the back at floor level (no back/bottom keeps it
  // square; the bottom one also nails to the wall).
  if (openBox && c.type === "base") {
    push("carcass", "carcass", matT, x1 - matT, yT - matT - 4, yT - matT, 0, matT);
    push("carcass", "carcass", matT, x1 - matT, yB, yB + 4, 0, matT);
  }
  // applied back — squares the closed box, captured inset at the rear with its
  // top tucked just UNDER the top back stretcher (which owns the top-rear corner).
  if (!openBox) push("back", "back", matT, x1 - matT, yB, yT - matT + 0.06, 0, backT);
  // desk writing surface, capping the open box (not a nested cut-list part)
  if (desk) push("desktop", "carcass", 0, W, yT, yT + matT, 0, D);
  // Separate toe-kick base: recessed from the front, and (with a separate base)
  // set in on the exposed end sides too — the box-on-a-base look. The isolated
  // build shows a lone box, so both ends are treated as exposed.
  if (based && yB > 0) {
    const rec = s.separateBase ? s.toeKickSideRecess : 0;
    push("base", "toeKick", rec, W - rec, 0, yB, 0, Math.max(matT, D - s.toeKickDepth));
  }

  /* ---------- shelves (interior; shown in cutaway) ---------- */
  if (!openBox && c.shelves > 0) {
    for (let i = 1; i <= c.shelves; i++) {
      const sy = yB + matT + ((boxH - 2 * matT) * i) / (c.shelves + 1);
      push("shelves", "shelf", matT, x1 - matT, sy, sy + 0.75, backT, D - 1);
    }
  }

  /* ---------- drawer boxes (interior; shown in cutaway) ---------- */
  addDrawerBoxes(out, c, s, yT);

  /* ---------- fronts + face frame ---------- */
  const fz0 = D - FRONT_T;
  const fz1 = D;

  // Appliance opening: no front, just the face-frame surround when framed.
  // Its frame runs to the floor (frameBottom) with the wider top rail.
  if (opening) {
    if (framed) {
      push("faceFrame", "frame", 0, ff, frameBottom, yT, fz0, fz1);
      push("faceFrame", "frame", x1 - ff, x1, frameBottom, yT, fz0, fz1);
      push("faceFrame", "frame", ff, x1 - ff, yT - topRail, yT, fz0, fz1);
    }
    return out;
  }

  const cabCenter = (0 + x1) / 2;
  // Pulls are the last thing fitted, so every handle lives on the `pulls` stage
  // regardless of which face it sits on.
  const hbar = (xa: number, xb: number, ya: number, yb: number, vertical: boolean) => {
    if (vertical) {
      // door pull on the inner (opening) edge, toward the cabinet centerline
      const hx = (xa + xb) / 2 < cabCenter ? xb - 1.4 : xa + 0.9;
      push("pulls", "handle", hx, hx + 0.5, (ya + yb) / 2 - 2.4, (ya + yb) / 2 + 2.4, fz1, fz1 + 0.5);
    } else {
      const hy = yb - 1.0;
      push("pulls", "handle", (xa + xb) / 2 - 2.6, (xa + xb) / 2 + 2.6, hy, hy + 0.5, fz1, fz1 + 0.5);
    }
  };

  // Hardwood face-frame perimeter — milled and glued on at the `faceFrame`
  // stage. It is visible during assembly even on full-overlay boxes (whose
  // proud fronts later cover it), so unlike the whole-run render we always draw
  // it, tucking it one panel-thickness back when the fronts sit proud.
  if (framed) {
    const zf1 = isInset(c) ? fz1 : fz0;
    const zf0 = zf1 - FRONT_T;
    push("faceFrame", "frame", 0, ff, frameBottom, yT, zf0, zf1); // left stile
    push("faceFrame", "frame", x1 - ff, x1, frameBottom, yT, zf0, zf1); // right stile
    push("faceFrame", "frame", ff, x1 - ff, yT - topRail, yT, zf0, zf1); // top rail (wider)
    // Closed boxes get a bottom rail; over a toe kick it grows down to the frame
    // line. A desk has no bottom rail — its knee stays open (deck closes it).
    if (!desk) push("faceFrame", "frame", ff, x1 - ff, frameBottom, yB + ff, zf0, zf1);
  }

  if (isInset(c)) {
    const ff = effectiveFrameWidth(c, s);
    const railGap = insetStackGap(c, s); // mid rail (framed/railed) or reveal
    const hasRails = framed || isRailInset(c);
    const railKind: BuildPartKind = framed ? "frame" : "carcass";
    // Framed mid rails belong to the face frame; a frameless railed-inset rail
    // is installed with the drawer stack it divides (there is no face-frame step).
    const railStage: BuildStage = framed ? "faceFrame" : "drawers";
    const ftop = framed ? topRail : ff; // wider top rail bounds the top opening
    const rl = 0 + ff;
    const rr = x1 - ff;
    const iz0 = fz0;
    const iz1 = fz1 - 0.06;
    const ol = 0 + ff + GAP;
    const or = x1 - ff - GAP;
    const drawRail = (yA: number, yB2: number) => {
      if (hasRails) push(railStage, railKind, rl, rr, yA, yB2, iz0, iz1);
    };
    if (c.frontStyle === "doors") {
      const nd = c.doorCount;
      for (let i = 0; i < nd; i++) {
        const a = ol + ((or - ol) * i) / nd + GAP / 2;
        const b = ol + ((or - ol) * (i + 1)) / nd - GAP / 2;
        push("doors", "front", a, b, yB + ff + GAP, yT - ftop - GAP, iz0, iz1);
        hbar(a, b, yB + ff, yT - ftop, true);
      }
    } else {
      const hs = getDrawerHeights(c, s);
      let y = yT - ftop;
      hs.forEach((dh, i) => {
        push("drawerFronts", "front", ol, or, y - dh, y, iz0, iz1);
        hbar(ol, or, y - dh, y, false);
        y -= dh;
        if (i < hs.length - 1) {
          drawRail(y - railGap, y);
          y -= railGap;
        }
      });
      // Framed desk: a rail under the drawer (in the proud face-frame plane, like
      // the top rail) + a deck panel closing the drawer cavity off from the knee.
      if (desk && framed) {
        push("faceFrame", "frame", rl, rr, y - railGap, y, fz0, fz1);
        push("carcass", "carcass", matT, x1 - matT, y - railGap, y - railGap + matT, 0, D);
      }
      if (c.frontStyle === "door_drawer") {
        drawRail(y - railGap, y);
        y -= railGap;
        const nd = c.doorCount;
        const bot = yB + ff;
        for (let i = 0; i < nd; i++) {
          const a = ol + ((or - ol) * i) / nd + GAP / 2;
          const b = ol + ((or - ol) * (i + 1)) / nd - GAP / 2;
          push("doors", "front", a, b, bot + GAP, y, iz0, iz1);
          hbar(a, b, bot, y, true);
        }
      }
    }
    return out;
  }

  // full overlay — fronts proud over the box/frame (frame hidden if framed)
  const ol = 0 + GAP;
  const or = x1 - GAP;
  const ot = yT - GAP;
  const ob = yB + GAP;
  if (c.frontStyle === "doors") {
    const nd = c.doorCount;
    for (let i = 0; i < nd; i++) {
      const a = ol + ((or - ol) * i) / nd + GAP / 2;
      const b = ol + ((or - ol) * (i + 1)) / nd - GAP / 2;
      push("doors", "front", a, b, ob, ot, fz0, fz1);
      hbar(a, b, ob, ot, true);
    }
  } else if (c.frontStyle === "drawers" || desk) {
    let top = ot;
    const hs = getDrawerHeights(c, s);
    hs.forEach((dh) => {
      push("drawerFronts", "front", ol, or, top - dh + GAP / 2, top, fz0, fz1);
      hbar(ol, or, top - dh, top, false);
      top -= dh;
    });
  } else if (c.frontStyle === "door_drawer") {
    const dh = getDrawerHeights(c, s)[0];
    push("drawerFronts", "front", ol, or, ot - dh + GAP / 2, ot, fz0, fz1);
    hbar(ol, or, ot - dh, ot, false);
    const nd = c.doorCount;
    const dt = ot - dh - GAP;
    for (let i = 0; i < nd; i++) {
      const a = ol + ((or - ol) * i) / nd + GAP / 2;
      const b = ol + ((or - ol) * (i + 1)) / nd - GAP / 2;
      push("doors", "front", a, b, ob, dt, fz0, fz1);
      hbar(a, b, ob, dt, true);
    }
  }

  return out;
}

/** Open drawer boxes drawn inside the carcass (revealed in the cutaway view). */
function addDrawerBoxes(out: BuildPart[], c: Cabinet, s: Settings, yT: number): void {
  const hasDrawers =
    c.frontStyle === "drawers" || c.frontStyle === "desk" || c.frontStyle === "door_drawer";
  if (!hasDrawers) return;
  const specs = drawerBoxSpecs(c, s);
  if (!specs.length) return;
  const dt = s.stocks[s.roleStock.drawerBox].thickness;
  const bt = s.stocks[s.roleStock.drawerBottom].thickness;
  const inset = isInset(c);
  const ff = inset ? effectiveFrameWidth(c, s) : 0.125;
  const railGap = inset ? insetStackGap(c, s) : 0.125;
  const heights = getDrawerHeights(c, s);
  const W = c.width;
  const fz0 = c.depth - FRONT_T;
  const push = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    if (Math.abs(x1 - x0) < 0.01 || Math.abs(y1 - y0) < 0.01 || Math.abs(z1 - z0) < 0.01)
      return;
    out.push({ stage: "drawers", kind: "drawerBox", box: [x0, x1, y0, y1, z0, z1] });
  };
  let top = yT - ff;
  heights.forEach((dh, i) => {
    const sp = specs[i];
    if (!sp) return;
    const slotBottom = top - dh;
    const bx0 = W / 2 - sp.boxWidth / 2;
    const bx1 = bx0 + sp.boxWidth;
    const bz1 = fz0 - 0.25;
    const bz0 = Math.max(0.75, bz1 - sp.boxDepth);
    const by0 = slotBottom + 0.25;
    const by1 = Math.max(by0 + 1, Math.min(top - 0.25, by0 + sp.boxHeight));
    push(bx0, bx0 + dt, by0, by1, bz0, bz1); // left side
    push(bx1 - dt, bx1, by0, by1, bz0, bz1); // right side
    push(bx0, bx1, by0, by1, bz1 - dt, bz1); // sub-front
    push(bx0, bx1, by0, by1, bz0, bz0 + dt); // back
    push(bx0, bx1, by0, by0 + bt, bz0, bz1); // bottom
    top = slotBottom - (i < heights.length - 1 ? railGap : 0);
  });
}
