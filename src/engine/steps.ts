import { CabinetParts, Settings } from "@/domain/types";
import { bandingInchesPerPiece } from "./parts";
import { effectiveFrameWidth, isRailInset } from "./geometry";
import { hingesForDoorHeight } from "./hardware";
import { typeLabel } from "./labels";
import { fmtLen } from "./units";

/**
 * A step may carry a `kind` so the interactive walkthrough can attach the
 * matching reference panel (e.g. the per-drawer box sizing table) to it.
 */
export type StepKind = "drawerBoxes";

/**
 * The construction phase a step belongs to. The build-tab 3D render uses this
 * to show the cabinet assembled *up to* the current step — parts of earlier
 * stages solid, the current stage glowing, later stages ghosted. The order in
 * `BUILD_STAGES` is the physical assembly order and must stay monotonic with
 * the steps `genSteps` emits, so `three/buildModel.ts` can light up the right
 * pieces for each step.
 */
export type BuildStage =
  | "sides" // cut / drill / band the two side panels
  | "carcass" // close the box: bottom + top / stretchers
  | "back" // the applied back that squares the box
  | "desktop" // the desk writing surface
  | "base" // set on the toe kick / level on the floor / hang on the wall
  | "faceFrame" // mill + glue on the hardwood face frame
  | "drawers" // mount slides + build the drawer boxes (interior)
  | "shelves" // drop in the adjustable shelves (interior)
  | "doors" // bore hinges + hang the doors
  | "drawerFronts" // attach the drawer faces to the boxes
  | "pulls"; // drill + fasten the pulls / knobs — the last thing on

// Order = assembly order. The faces (doors, drawerFronts, pulls) come AFTER the
// interior (drawers boxes, shelves) so the cutaway used while fitting boxes never
// hides a face that's already on, and the walkthrough ends on the finished box.
export const BUILD_STAGES: BuildStage[] = [
  "sides",
  "carcass",
  "back",
  "desktop",
  "base",
  "faceFrame",
  "drawers",
  "shelves",
  "doors",
  "drawerFronts",
  "pulls",
];

/** Position of a stage in the assembly order (lower = earlier). */
export function stageOrder(s: BuildStage): number {
  return BUILD_STAGES.indexOf(s);
}

export interface Step {
  n: number;
  t: string;
  /** Which construction phase this step belongs to (drives the build 3D). */
  stage: BuildStage;
  kind?: StepKind;
}

export interface StepGroup {
  id: string;
  name: string;
  typeLabel: string;
  color: string;
  dims: string;
  steps: Step[];
}

/**
 * Generate ordered assembly steps for one cabinet. Ported from the imported
 * design's `genSteps`. The 32/37/35/22.5 mm values are intrinsic to the 32 mm
 * system and stay metric; cabinet-specific measurements honour the unit toggle.
 */
export function genSteps(cp: CabinetParts, s: Settings, color: string): StepGroup {
  const { cabinet: c, geometry: g, parts } = cp;
  const u = s.units;
  const steps: Step[] = [];
  const push = (t: string, stage: BuildStage, kind?: StepKind) =>
    steps.push({ n: steps.length + 1, t, stage, kind });
  // "the drawer box" for one, "3 drawer boxes" for many (avoids "the 1 …").
  const nN = (n: number, sing: string, plur: string) =>
    n === 1 ? `the ${sing}` : `${n} ${plur}`;

  const pieces = parts.reduce((a, p) => a + p.qty, 0);
  const bandFt = Math.ceil(
    parts.reduce((a, p) => a + p.qty * bandingInchesPerPiece(p), 0) / 12,
  );
  const dims = `${fmtLen(c.width, u)} × ${fmtLen(c.height, u)} × ${fmtLen(c.depth, u)}`;
  const head = { id: c.id, name: c.name, typeLabel: typeLabel(c.type), color, dims };

  if (c.frontStyle === "opening") {
    push(
      `Cut the 2 side panels and the top${c.type === "base" ? " stretchers plus two back stretchers" : " panel"} for the surround.`,
      "sides",
    );
    if (bandFt > 0)
      push(`Edge-band the exposed front edges (about ${bandFt} ft) and trim flush.`, "sides");
    push(
      c.type === "base"
        ? "Join the two top stretchers between the side panels, then set the two back stretchers on edge — one just under the rear top stretcher and one across the back at floor level. They tie the sides together and keep the open surround from racking; the bottom one also gives you a rail to screw to the wall studs. There is no bottom or front; the appliance slides into the open bay."
        : "Join the top panel between the side panels. There is no bottom, back or front — the appliance slides into the open bay.",
      "carcass",
    );
    if (g.framed)
      push(
        "Add the face-frame stiles and a top rail around the opening, flush to the outside edges.",
        "faceFrame",
      );
    push(
      "Stand the surround in place, scribe it to the neighbouring cabinets or wall, and fasten. Confirm the opening clears your appliance — measure its required width, depth and height plus the maker’s side and top clearances before you build.",
      "base",
    );
    return { ...head, steps };
  }

  push(
    `Cut all ${pieces} panels for ${c.name} from the cut list. Label each piece as it comes off the saw — it saves you twice.`,
    "sides",
  );
  push(
    isRailInset(c)
      ? "Drill the 32 mm system holes: two vertical rows on the inside of each side panel, ~56 mm in from the front (37 mm + face thickness, so railed-inset faces land flush) and 37 mm from the back, 32 mm on centre. These carry your shelf pins, hinge plates and slide screws."
      : "Drill the 32 mm system holes: two vertical rows on the inside of each side panel, 37 mm in from the front and back edges, 32 mm on centre. These carry your shelf pins, hinge plates and slide screws.",
    "sides",
  );
  if (bandFt > 0)
    push(
      `Iron edge-banding onto every exposed front edge — about ${bandFt} ft for this box — and trim flush.`,
      "sides",
    );

  if (c.frontStyle === "desk") {
    push(
      'Join the two 4" top stretchers between the side panels, then set two back stretchers on edge — one just under the rear top stretcher and one across the back at floor level (glue + confirmat screws). They tie the sides together and stiffen the open box. There is no bottom; the knee space stays open, and the desktop caps the top to keep it square.',
      "carcass",
    );
    if (g.framed)
      push(
        "Fit a deck panel across the interior just under the drawer — it closes the drawer cavity off from the open knee below; the face-frame rail faces its front edge.",
        "carcass",
      );
    push(
      "Fasten the desktop down through the top stretchers, checking the frame for square as you go.",
      "desktop",
    );
  } else {
    if (c.type === "base")
      push(
        'Join the bottom and the two 4" top stretchers between the side panels (glue + confirmat screws or dowels, on the 32 mm lines). Keep front faces dead flush.',
        "carcass",
      );
    else
      push(
        "Join the top and bottom between the side panels (glue + confirmat screws or dowels). Keep front faces dead flush.",
        "carcass",
      );
    push(
      "Check for square — measure both diagonals, they should match — then screw on the 3/4\" back. The back is what holds the box square, so don’t skip it.",
      "back",
    );
  }

  if (c.type === "wall")
    push(
      `Find the studs and strike a level line at ${fmtLen(s.upperBottom, u)} off the floor. Hang the cabinet on a temporary ledger, then drive screws through the back rail into every stud.`,
      "base",
    );
  else if (c.frontStyle === "desk")
    push(
      "Stand the unit on its side panels and shim level on the floor — the legs run straight to the ground, no toe kick.",
      "base",
    );
  else if (c.toeKick !== false) {
    const tallNote =
      c.type === "tall"
        ? " Then anchor the top back into the wall studs — a tall cabinet must be screwed to the wall so it can’t tip."
        : "";
    push(
      s.separateBase
        ? `Build a separate toe-kick base — a ${fmtLen(s.toeKick, u)}-tall plywood ladder set back ~${fmtLen(s.toeKickDepth, u)} at the front and ~${fmtLen(s.toeKickSideRecess, u)} at any exposed end, with a fascia across the front. Level it, set this cabinet on top and screw down through the bottom; the face frame laps down over it to ~${fmtLen(s.faceFrameFloorGap, u)} off the floor.${tallNote}`
        : `Build a toe-kick base — a simple ${fmtLen(s.toeKick, u)}-tall ladder set back ~${fmtLen(s.toeKickDepth, u)} from the front — level it, then set this cabinet on top and screw down through the bottom.${tallNote}`,
      "base",
    );
  }
  else
    push(
      "Set the finished box directly on the floor (no toe kick) and shim it dead level before fastening anything.",
      "base",
    );

  if (g.framed) {
    // Frame counts come from geometry, not the parts list: under a continuous
    // run frame the stiles/rails are emitted once at the run level, so this box
    // carries none — but the walkthrough still narrates milling its section.
    const ffw = s.frameWidth || 1.5;
    const railLen = c.width - 2 * ffw;
    const ffStiles = 2;
    const midRails = g.inset
      ? c.frontStyle === "drawers"
        ? Math.max(0, c.drawerCount - 1)
        : c.frontStyle === "desk"
          ? c.drawerCount
          : c.frontStyle === "door_drawer"
            ? 1
            : 0
      : 0;
    // top + bottom (none on a desk — open knee) + the mid rails
    const ffRails = 1 + (g.openBox ? 0 : 1) + midRails;
    const ffl = Math.ceil((ffStiles * g.boxHeight + ffRails * railLen) / 12);
    push(
      `Cut ~${ffl} ft of 3/4" hardwood into ${ffStiles} stile${ffStiles > 1 ? "s" : ""} and ${ffRails} rail${ffRails > 1 ? "s" : ""} — ${fmtLen(ffw, u)} wide (${fmtLen(s.faceFrameTop || 2, u)} top rail), each sized to the front of the box.`,
      "faceFrame",
    );
    push(
      "Pocket-screw the stiles and rails into one flat face frame on the bench, checking it for square as you clamp.",
      "faceFrame",
    );
    push(
      "Glue and pin the assembled face frame onto the front of the box, flush to the outside edges.",
      "faceFrame",
    );
  }

  const doors = parts.filter((p) => p.name === "Door").reduce((a, p) => a + p.qty, 0);
  const drw = parts.filter((p) => p.name === "Drawer front").reduce((a, p) => a + p.qty, 0);

  /* ---- interior fittings first (boxes, shelves), THEN the faces go on ---- */

  // 1. Drawer slides + boxes (the box only — the face is a later step).
  if (drw > 0) {
    const bw = fmtLen(c.width - 2 * effectiveFrameWidth(c, s) - 1, u);
    const bd = fmtLen(Math.floor(g.carcassDepth - 1), u);
    const slideNote = g.framed
      ? ' — bridge the side-mount slides out to the carcass with rear sockets or ~1" spacers, since the box is sized to the face-frame opening'
      : "";
    // Frameless railed inset: the rails dividing the openings go in first.
    if (isRailInset(c) && !g.framed) {
      const railsN = c.frontStyle === "door_drawer" ? 1 : Math.max(0, drw - 1);
      if (railsN > 0)
        push(
          `Cut and fit the ${railsN} inset rail${railsN > 1 ? "s" : ""} that divide the drawer openings, flush to the carcass front.`,
          "drawers",
        );
    }

    push(`Mount the drawer slides dead level at each opening${slideNote}.`, "drawers");
    push(
      `Cut the parts for ${nN(drw, "drawer box", "drawer boxes")} (about ${bw} wide × ${bd} deep) — 1/2\" ply sides and front/back, 1/4\" ply bottoms; the exact per-drawer sizes are in the table below.`,
      "drawers",
      "drawerBoxes",
    );
    push(
      `Groove a 1/4\" slot 1/4\" up from the bottom edge of all four box parts, then glue and pin the sides to the front and back, slide the 1/4\" bottom in dry (no glue) and check each box for square.`,
      "drawers",
    );
    push(
      `Hang ${nN(drw, "drawer box", "drawer boxes")} on the slides and check ${drw === 1 ? "it glides" : "each one glides"} smoothly.`,
      "drawers",
    );
  }

  // 2. Adjustable shelves go in through the open front, before it is closed up.
  if (c.shelves > 0 && !g.openBox)
    push(
      `Drop in ${c.shelves} adjustable shelf${c.shelves > 1 ? "es" : ""} on pins at your chosen heights.`,
      "shelves",
    );

  // 3. Hang the doors.
  if (doors > 0) {
    const maxDoorH = Math.max(
      0,
      ...parts.filter((p) => p.name === "Door").map((p) => p.width),
    );
    const hingesPer = hingesForDoorHeight(maxDoorH);
    if (g.inset)
      push(
        `Bore 35 mm hinge cups (${hingesPer} per door) and hang ${doors} inset door${doors > 1 ? "s" : ""} ${g.framed ? "inside the frame openings" : "flush in the box openings"} with inset/clip hinges, setting an even 1/8" reveal on every side.`,
        "doors",
      );
    else
      push(
        `Bore 35 mm hinge cups (${hingesPer} per door) 22.5 mm in from the door edge. Mount ${doors} full-overlay door${doors > 1 ? "s" : ""} and dial the reveal to an even 1/8" between them.`,
        "doors",
      );
  }

  // 4. Attach the drawer FACES to their boxes — its own step, set to the reveal.
  if (drw > 0)
    push(
      `Attach ${nN(drw, "drawer front", "drawer fronts")}: tack each face onto its box with a dab of hot-melt or double-sided tape to set an even 1/8" reveal all round, open the drawer and drive two screws from inside the box, then peel and repeat.`,
      "drawerFronts",
    );

  // 5. Drill + fasten the pulls — the very last thing to go on.
  const nPulls = doors + drw;
  if (nPulls > 0)
    push(
      `Mark, drill and fasten ${nN(nPulls, "pull", "pulls")} — keep ${nPulls === 1 ? "it" : "them"} in a consistent line (centred on the drawer fronts, an even inset on the door stiles). Stand back: the box is done.`,
      "pulls",
    );

  return { ...head, steps };
}
