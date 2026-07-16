import { Cabinet, Settings, SlideBlockingSpec } from "@/domain/types";
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
  topBorderWidth,
} from "@/engine/geometry";
import { deskDeckTop, getDrawerHeights } from "@/engine/drawers";
import { drawerBoxSpecs, slideBlockingSpecs } from "@/engine/parts";
import { pocketSpec, pocketsPerEnd } from "@/engine/pocketHoles";

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

/**
 * One pocket-hole marker on a build part: the centre of the pocket on the
 * drilled face, the face's outward normal, and the pocket's long axis (the
 * direction the screw travels — toward the nearest joining end).
 */
export interface PocketDot {
  x: number;
  y: number;
  z: number;
  /** Outward unit normal of the drilled face (exactly one axis is ±1). */
  n: [number, number, number];
  along: "x" | "y";
}

export interface BuildPart {
  stage: BuildStage;
  kind: BuildPartKind;
  /** Axis-aligned box: [x0, x1, y0, y1, z0, z1] in inches. */
  box: [number, number, number, number, number, number];
  /**
   * Pocket-hole markers on this part (settings.pocketHoles only). Mirrors the
   * drill schedule (engine/pocketHoles): pockets in the NON-sanded face —
   * underside of a base bottom, top of a wall bottom / desk deck / stretchers,
   * outside faces of drawer fronts/backs. Face-frame members carry none here:
   * their pockets face the carcass and are invisible once assembled.
   */
  pockets?: PocketDot[];
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

/**
 * Which sides of the box are EXPOSED run ends (an exposed end drops to the
 * face-frame floor line and the toe-kick base recesses under it). Omitted =
 * both exposed — right for a standalone box or a run of one; a run bay passes
 * its real ends (from `CabinetGeometry.endDropLeft/Right`) so the walkthrough
 * shows one long End panel and one plain side, matching the cut list.
 */
export interface BuildEnds {
  left: boolean;
  right: boolean;
}

export function cabinetBuildParts(
  c: Cabinet,
  s: Settings,
  ends?: BuildEnds,
  /**
   * Run-aware slide pack-out from `CabinetParts.geometry.slideBlocking`.
   * Omitted = solo-cabinet blocking (full stiles both sides) — right for a
   * standalone box, wrong at a run joint, so run bays must pass theirs in.
   */
  blocking?: SlideBlockingSpec[],
): BuildPart[] {
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
    pockets?: PocketDot[],
  ) => {
    if (Math.abs(x1 - x0) < 0.01 || Math.abs(y1 - y0) < 0.01 || Math.abs(z1 - z0) < 0.01)
      return;
    out.push({ stage, kind, box: [x0, x1, y0, y1, z0, z1], ...(pockets?.length ? { pockets } : {}) });
  };

  // Pocket-hole markers (opt-in), gated per stock exactly like the build steps.
  const phBox = s.pocketHoles && pocketSpec(s.stocks[s.roleStock.carcass]) != null;
  /**
   * A row of pockets near each X end of a panel/stretcher (screws exit into the
   * side panels): on the face given by `face` (one axis pinned + its outward
   * normal), spread evenly across [s0, s1] on the other axis.
   */
  const xEndDots = (
    on: boolean,
    x0: number,
    x1: number,
    perEnd: number,
    face: { y?: [number, 1 | -1]; z?: [number, 1 | -1] },
    s0: number,
    s1: number,
  ): PocketDot[] | undefined => {
    if (!on) return undefined;
    const inset = Math.min(1.75, (x1 - x0) / 4);
    const dots: PocketDot[] = [];
    for (const ex of [x0 + inset, x1 - inset]) {
      for (let i = 0; i < perEnd; i++) {
        const t = s0 + ((s1 - s0) * (i + 1)) / (perEnd + 1);
        if (face.y) dots.push({ x: ex, y: face.y[0], z: t, n: [0, face.y[1], 0], along: "x" });
        else dots.push({ x: ex, y: t, z: face.z![0], n: [0, 0, face.z![1]], along: "x" });
      }
    }
    return dots;
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
  const endL = ends?.left ?? true;
  const endR = ends?.right ?? true;

  /* ---------- carcass ---------- */
  // side panels — cut, drilled and edge-banded at the `sides` stage. They run the
  // FULL depth (0..D) so the front sits at the front plane (flush with the front
  // stretcher + face frame) and the rear stays flush with the inset applied back.
  // On a framed toe-kicked box an EXPOSED end drops to the frame line; a side
  // shared with a neighbouring bay stays at box height.
  push("sides", "carcass", 0, matT, endL ? frameBottom : yB, yT, 0, D);
  push("sides", "carcass", x1 - matT, x1, endR ? frameBottom : yB, yT, 0, D);
  // bottom (closed boxes only) — pockets in the NON-sanded face: the underside,
  // EXCEPT a wall cabinet whose underside shows from below (they flip inside).
  if (!openBox)
    push(
      "carcass",
      "carcass",
      matT,
      x1 - matT,
      yB,
      yB + matT,
      0,
      D,
      xEndDots(
        phBox,
        matT,
        x1 - matT,
        pocketsPerEnd(D),
        c.type === "wall" ? { y: [yB + matT, 1] } : { y: [yB, -1] },
        0,
        D,
      ),
    );
  // top: base/desk get two stretchers (front + back), others a full top —
  // pockets face up (hidden under the counter / above the cabinet).
  if (c.type === "base") {
    push("carcass", "carcass", matT, x1 - matT, yT - matT, yT, 0, 4,
      xEndDots(phBox, matT, x1 - matT, 2, { y: [yT, 1] }, 0, 4));
    push("carcass", "carcass", matT, x1 - matT, yT - matT, yT, D - 4, D,
      xEndDots(phBox, matT, x1 - matT, 2, { y: [yT, 1] }, D - 4, D));
  } else {
    push("carcass", "carcass", matT, x1 - matT, yT - matT, yT, 0, D,
      xEndDots(phBox, matT, x1 - matT, pocketsPerEnd(D), { y: [yT, 1] }, 0, D));
  }
  // Open box (appliance opening / desk knee): a pair of back stretchers on edge
  // (at the back, z≈0) stiffen the open surround — one under the top rear
  // stretcher, one across the back at floor level (no back/bottom keeps it
  // square; the bottom one also nails to the wall). Pockets toward the wall.
  if (openBox && c.type === "base") {
    push("carcass", "carcass", matT, x1 - matT, yT - matT - 4, yT - matT, 0, matT,
      xEndDots(phBox, matT, x1 - matT, 2, { z: [0, -1] }, yT - matT - 4, yT - matT));
    push("carcass", "carcass", matT, x1 - matT, yB, yB + 4, 0, matT,
      xEndDots(phBox, matT, x1 - matT, 2, { z: [0, -1] }, yB, yB + 4));
  }
  // applied back — squares the closed box, captured inset at the rear with its
  // top tucked just UNDER the top back stretcher (which owns the top-rear corner).
  if (!openBox) push("back", "back", matT, x1 - matT, yB, yT - matT + 0.06, 0, backT);
  // desk writing surface, capping the open box (not a nested cut-list part)
  if (desk) push("desktop", "carcass", 0, W, yT, yT + matT, 0, D);
  // Separate toe-kick base: recessed from the front, and (with a separate base)
  // set in on the EXPOSED end sides only — the box-on-a-base look; at a shared
  // joint the ladder runs through to the neighbouring bay.
  if (based && yB > 0) {
    const rec = s.separateBase ? s.toeKickSideRecess : 0;
    push("base", "toeKick", endL ? rec : 0, W - (endR ? rec : 0), 0, yB, 0, Math.max(matT, D - s.toeKickDepth));
  }

  /* ---------- shelves (interior; shown in cutaway) ---------- */
  if (!openBox && c.shelves > 0) {
    for (let i = 1; i <= c.shelves; i++) {
      const sy = yB + matT + ((boxH - 2 * matT) * i) / (c.shelves + 1);
      push("shelves", "shelf", matT, x1 - matT, sy, sy + 0.75, backT, D - 1);
    }
  }

  /* ---------- drawer boxes (interior; shown in cutaway) ---------- */
  addDrawerBoxes(out, c, s, yT, blocking ?? slideBlockingSpecs(c, s));

  /* ---------- fronts + face frame ---------- */
  const fz0 = D - FRONT_T;
  const fz1 = D;

  // Appliance opening: no front, just the face-frame surround when framed.
  // Its frame runs to the floor (frameBottom) with the wider top rail.
  if (opening) {
    if (framed) {
      // Continuous top rail; the two stiles hang beneath it to the floor (no
      // bottom rail — the opening stays open).
      push("faceFrame", "frame", 0, x1, yT - topRail, yT, fz0, fz1);
      push("faceFrame", "frame", 0, ff, frameBottom, yT - topRail, fz0, fz1);
      push("faceFrame", "frame", x1 - ff, x1, frameBottom, yT - topRail, fz0, fz1);
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
    // Ladder frame: one continuous top rail and (closed boxes) one continuous
    // bottom rail run the full width; the stiles are captured between them. Over
    // a toe kick the bottom rail grows down to the frame line. A desk has no
    // bottom rail — its knee stays open (the deck closes it) — so its stiles run
    // on down under the top rail.
    const stileFoot = desk ? frameBottom : yB + ff;
    push("faceFrame", "frame", 0, x1, yT - topRail, yT, zf0, zf1); // top rail (wider)
    if (!desk) push("faceFrame", "frame", 0, x1, frameBottom, yB + ff, zf0, zf1); // bottom rail
    push("faceFrame", "frame", 0, ff, stileFoot, yT - topRail, zf0, zf1); // left stile
    push("faceFrame", "frame", x1 - ff, x1, stileFoot, yT - topRail, zf0, zf1); // right stile
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
      // A frameless railed-inset divider rail is pocket-screwed into the sides
      // (2 per end, on its back face — hidden behind it, seen only in cutaway).
      // Framed mid rails carry no dots: their pockets face the carcass.
      if (hasRails)
        push(railStage, railKind, rl, rr, yA, yB2, iz0, iz1,
          framed ? undefined : xEndDots(phBox, rl, rr, 2, { z: [iz0, -1] }, yA, yB2));
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
      // Deck pockets face UP — it installs sanded face DOWN over the open knee.
      if (desk && framed) {
        push("faceFrame", "frame", rl, rr, y - railGap, y, fz0, fz1);
        const dkTop = yB + deskDeckTop(c, s); // == y - railGap + matT; the step text quotes this line
        push("carcass", "carcass", matT, x1 - matT, dkTop - matT, dkTop, 0, D,
          xEndDots(phBox, matT, x1 - matT, pocketsPerEnd(D), { y: [dkTop, 1] }, 0, D));
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
    // Framed FULL-OVERLAY desk: the proud front hides the frame, but the
    // under-drawer rail and the deck are still real parts — same as the inset
    // desk (the cut list emits them for ANY framed desk).
    if (desk && framed) {
      const zf1 = fz0;
      const zf0 = zf1 - FRONT_T;
      const rg = s.frameWidth || 1.5;
      push("faceFrame", "frame", ff, x1 - ff, top - rg, top, zf0, zf1);
      push("carcass", "carcass", matT, x1 - matT, top - rg, top - rg + matT, 0, D,
        xEndDots(phBox, matT, x1 - matT, pocketsPerEnd(D), { y: [top - rg + matT, 1] }, 0, D));
    }
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
function addDrawerBoxes(
  out: BuildPart[],
  c: Cabinet,
  s: Settings,
  yT: number,
  blocking: SlideBlockingSpec[],
): void {
  const hasDrawers =
    c.frontStyle === "drawers" || c.frontStyle === "desk" || c.frontStyle === "door_drawer";
  if (!hasDrawers) return;
  const specs = drawerBoxSpecs(c, s);
  if (!specs.length) return;
  const dt = s.stocks[s.roleStock.drawerBox].thickness;
  const bt = s.stocks[s.roleStock.drawerBottom].thickness;
  const inset = isInset(c);
  // The first slot hangs under the TOP border — the (wider) face-frame top
  // rail when framed, the carcass edge when frameless — matching the cut list.
  const slotTop = inset ? topBorderWidth(c, s) : 0.125;
  const railGap = inset ? insetStackGap(c, s) : 0.125;
  const heights = getDrawerHeights(c, s);
  const W = c.width;
  const fz0 = c.depth - FRONT_T;
  const push = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    pockets?: PocketDot[],
  ) => {
    if (Math.abs(x1 - x0) < 0.01 || Math.abs(y1 - y0) < 0.01 || Math.abs(z1 - z0) < 0.01)
      return;
    out.push({ stage: "drawers", kind: "drawerBox", box: [x0, x1, y0, y1, z0, z1], ...(pockets?.length ? { pockets } : {}) });
  };
  // Front/back pockets sit on the NON-sanded OUTSIDE faces (the applied front /
  // the cabinet back hide them), 2 per end, screws exiting into the sides.
  const ph = s.pocketHoles && pocketSpec(s.stocks[s.roleStock.drawerBox]) != null;
  const faceDots = (x0: number, x1: number, y0: number, y1: number, fz: number, nz: 1 | -1): PocketDot[] | undefined => {
    if (!ph) return undefined;
    const inset = Math.min(1.75, (x1 - x0) / 4);
    const dots: PocketDot[] = [];
    for (const ex of [x0 + inset, x1 - inset]) {
      for (let i = 0; i < 2; i++) {
        dots.push({ x: ex, y: y0 + ((y1 - y0) * (i + 1)) / 3, z: fz, n: [0, 0, nz], along: "x" });
      }
    }
    return dots;
  };
  // The box hangs centred under its FRONT (between the slide planes), which in
  // a run bay is shifted off the carcass centre by the asymmetric stiles.
  const packL = blocking.find((b) => b.side === "left");
  let top = yT - slotTop;
  heights.forEach((dh, i) => {
    const sp = specs[i];
    if (!sp) return;
    const slotBottom = top - dh;
    const bx0 = packL ? packL.plane + 0.5 : W / 2 - sp.boxWidth / 2;
    const bx1 = bx0 + sp.boxWidth;
    const bz1 = fz0 - 0.25;
    const bz0 = Math.max(0.75, bz1 - sp.boxDepth);
    const by0 = slotBottom + 0.25;
    const by1 = Math.max(by0 + 1, Math.min(top - 0.25, by0 + sp.boxHeight));
    // Slide pack-out strips first — wall out to the slide line at each drawer.
    for (const pk of blocking) {
      const px0 = pk.side === "left" ? pk.plane - pk.thickness : pk.plane;
      const py0 = Math.max(carcassThickness(s), by0 - 0.875);
      push(px0, px0 + pk.thickness, py0, py0 + pk.width, bz0, bz1);
    }
    push(bx0, bx0 + dt, by0, by1, bz0, bz1); // left side
    push(bx1 - dt, bx1, by0, by1, bz0, bz1); // right side
    push(bx0, bx1, by0, by1, bz1 - dt, bz1, faceDots(bx0, bx1, by0, by1, bz1, 1)); // sub-front
    push(bx0, bx1, by0, by1, bz0, bz0 + dt, faceDots(bx0, bx1, by0, by1, bz0, -1)); // back
    push(bx0, bx1, by0, by0 + bt, bz0, bz1); // bottom
    top = slotBottom - (i < heights.length - 1 ? railGap : 0);
  });
}
