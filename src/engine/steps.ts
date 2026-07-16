import { CabinetParts, Settings, SlideBlockingSpec } from "@/domain/types";
import { bandingInchesPerPiece } from "./parts";
import { Run } from "./runs";
import { runFrameJoints } from "./runParts";
import { backThickness, effectiveFrameWidth, isRailInset } from "./geometry";
import { hingesForDoorHeight } from "./hardware";
import { typeLabel } from "./labels";
import { pocketSpec, pocketsPerEnd, screwLabel } from "./pocketHoles";
import { deskDeckTop } from "./drawers";
import { fmtLen, r3 } from "./units";

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
  /**
   * Present on a RUN-level group (genRunSteps): the ids of the cabinets whose
   * assembled run this group frames, so the walkthrough 3D renders the whole run
   * instead of a single box. Absent on per-cabinet groups.
   */
  runCabinetIds?: string[];
}

/**
 * Generate ordered assembly steps for one cabinet. Ported from the imported
 * design's `genSteps`. The 32/37/35/22.5 mm values are intrinsic to the 32 mm
 * system and stay metric; cabinet-specific measurements honour the unit toggle.
 */
export function genSteps(
  cp: CabinetParts,
  s: Settings,
  color: string,
  runLabel?: string,
): StepGroup {
  const { cabinet: c, geometry: g, parts } = cp;
  // In a multi-cabinet continuous run, the boxes are built individually and then
  // JOINED, and ONE face frame is fitted onto the whole assembled run — so the
  // placement (join + shared toe-kick base), the face frame, and the inset
  // fronts (which land in the frame) are all done at the RUN level (genRunSteps).
  // A run-owned bay's walkthrough therefore builds only its box + interior here;
  // `runLabel` names the run group so the bay can point the reader at it.
  const runFrame = runLabel != null;
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

  // Pocket-hole joinery (opt-in): jig settings + screws derived from the
  // stocks. A stock below the jig's 1/2" range gets NO spec — those joints
  // keep the generic wording rather than unsafe pocket advice.
  const ph = s.pocketHoles;
  const boxSpec = ph ? pocketSpec(s.stocks[s.roleStock.carcass]) : null;
  const boxScrews = boxSpec ? screwLabel(boxSpec, u) : "";
  const jigLine = (what: string) =>
    `Set the pocket-hole jig to ${fmtLen(boxSpec!.setting, u)} — the drill guide block AND the bit's stop collar — and drill the joinery pockets while the parts are still flat: ${what}. Every pocket goes in the NON-sanded face — the sanded face never takes a pocket.`;

  // A run-owned bay's walkthrough ends at the box, so close with a pointer —
  // otherwise the list reads as finished-but-missing its base/frame/fronts.
  // Same stage as the last real step, so each stage stays one contiguous block.
  const pushRunPointer = () => {
    if (runFrame)
      push(
        `${c.name}'s box is done. Everything this bay shares happens at the run level — the join into the run, the toe-kick base, the ONE continuous face frame and the fronts — so continue in "Face frame + base · ${runLabel}".`,
        steps[steps.length - 1].stage,
      );
  };

  if (c.frontStyle === "opening") {
    push(
      `Cut the 2 side panels and the top${c.type === "base" ? " stretchers plus two back stretchers" : " panel"} for the surround.`,
      "sides",
    );
    if (bandFt > 0)
      push(`Edge-band the exposed front edges (about ${bandFt} ft) and trim flush.`, "sides");
    if (boxSpec)
      push(
        jigLine(
          c.type === "base"
            ? "2 in each end of the two top stretchers and of both back stretchers (NON-sanded faces — they end up facing up / toward the wall)"
            : "a row across each end of the top panel's NON-sanded face (it becomes the top)",
        ),
        "carcass",
      );
    if (c.type === "base") {
      push(
        `Join the two 4" top stretchers between the side panels — the FRONT one first, flush with the side front edges, then the REAR one flush at the back${boxSpec ? ` (glue + ${boxScrews} pocket screws)` : ""}.`,
        "carcass",
      );
      push(
        `Set the two back stretchers on edge — first the upper one just under the rear top stretcher, then the lower one across the back at floor level${boxSpec ? ` (${boxScrews} pocket screws)` : ""}. They keep the open surround from racking; the bottom one also gives you a rail to screw to the wall studs. There is no bottom or front; the appliance slides into the open bay.`,
        "carcass",
      );
    } else {
      push(
        `Join the top panel between the side panels${boxSpec ? ` (glue + ${boxScrews} pocket screws)` : ""}. There is no bottom, back or front — the appliance slides into the open bay.`,
        "carcass",
      );
    }
    // Always confirm the appliance fits — the surround is sized to it, and this
    // is the ONLY place the walkthrough flags it (whether the bay is solo or a
    // run member whose placement/frame move to the run group).
    push(
      "Confirm the opening clears your appliance before you go further — measure its required width, depth and height plus the maker’s side and top clearances against this opening.",
      "carcass",
    );
    if (g.framed && !runFrame) {
      const openFF = ph ? pocketSpec(s.stocks[s.roleStock.faceFrame]) : null;
      push(
        openFF
          ? `Add the face-frame stiles and a top rail around the opening, flush to the outside edges — jig at ${fmtLen(openFF.setting, u)}, 2 pockets in the BACK of each stile's TOP end (they hang from the rail; there is no bottom rail), joined with ${screwLabel(openFF, u)} pocket screws.`
          : "Add the face-frame stiles and a top rail around the opening, flush to the outside edges.",
        "faceFrame",
      );
    }
    if (!runFrame)
      push(
        "Stand the surround in place, scribe it to the neighbouring cabinets or wall, and fasten.",
        "base",
      );
    pushRunPointer();
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
    if (boxSpec) {
      const deckRow = g.framed ? pocketsPerEnd(g.carcassDepth) : 0;
      push(
        jigLine(
          `2 in each end of the two top stretchers and of both back stretchers (NON-sanded faces — they end up facing up / toward the wall)${
            deckRow
              ? `, and ${deckRow} across each end of the drawer deck's NON-sanded face — it installs sanded face DOWN, so the pockets face up under the drawer and the open knee space below stays clean`
              : ""
          }`,
        ),
        "carcass",
      );
    }
    push(
      `Join the two 4" top stretchers between the side panels — the FRONT one first, flush with the side front edges, then the REAR one flush at the back (glue + ${boxSpec ? `${boxScrews} pocket screws` : "confirmat screws"}).`,
      "carcass",
    );
    push(
      `Set the two back stretchers on edge — first the upper one just under the rear top stretcher, then the lower one across the back at floor level${boxSpec ? ` (${boxScrews} pocket screws)` : ""}. They tie the sides together and stiffen the open box. There is no bottom; the knee space stays open, and the desktop caps the top to keep it square.`,
      "carcass",
    );
    if (g.framed) {
      // The deck line is stated only for inset/railed fits, where the frame
      // opening IS the front so the number is exact; a proud overlay front
      // shifts the stack off the frame math.
      const deckTop = deskDeckTop(c, s);
      const deckAt = g.inset
        ? `, its TOP face ${fmtLen(r3(g.boxHeight - deckTop), u)} down from the top edge of the sides (${fmtLen(deckTop, u)} off the floor)`
        : "";
      push(
        `Fit the deck panel across the interior just under the drawer — sanded face DOWN toward the open knee${deckAt}; it closes the drawer cavity off from below and the face-frame rail covers its front edge.${boxSpec ? ` Glue it in and drive the ${boxScrews} pocket screws from its TOP face down into the sides — the drawer hides them and the knee space stays clean.` : ""}`,
        "carcass",
      );
    }
    push(
      "Fasten the desk's top surface down through the top stretchers, checking the frame for square as you go. The work top is supplied separately — it isn't cut from the plywood in this list.",
      "desktop",
    );
  } else {
    if (boxSpec)
      push(
        jigLine(
          c.type === "base"
            ? `${pocketsPerEnd(g.carcassDepth)} across each end of the bottom's NON-sanded face (it becomes the underside), and 2 in each end of the two top stretchers' NON-sanded face (up, hidden under the counter)`
            : c.type === "wall"
              ? `${pocketsPerEnd(g.carcassDepth)} across each end of the top and of the bottom, always the NON-sanded face — the bottom installs sanded face DOWN because a wall cabinet's underside shows from below`
              : `${pocketsPerEnd(g.carcassDepth)} across each end of the bottom and of the top, always the NON-sanded face (underside of the bottom, top of the top — both hidden on a tall box)`,
        ),
        "carcass",
      );
    // An exposed run end is cut as a LONGER End panel that drops to the
    // face-frame floor line — the bottom does NOT follow it down, so spell out
    // the vertical registration (align the tops; the drop hangs below).
    const drop = Math.max(g.endDropLeft, g.endDropRight);
    const endNote =
      drop <= 0
        ? ""
        : g.endDropLeft > 0 && g.endDropRight > 0
          ? ` NOTE both sides are the longer End panels — they run ${fmtLen(drop, u)} past the box at the foot, down to the face-frame line. Keep the TOPS flush: the bottom's underside sits ${fmtLen(drop, u)} up from each foot.`
          : ` NOTE one side is the longer End panel — it runs ${fmtLen(drop, u)} past the box at the foot, down to the face-frame line, and goes on the run's ${g.endDropLeft > 0 ? "LEFT" : "RIGHT"} (exposed) end. Keep the TOPS flush: the bottom's underside lands flush with the plain side's foot, ${fmtLen(drop, u)} up from the End panel's foot.`;
    if (c.type === "base") {
      push(
        `Stand the two side panels on edge and join the BOTTOM between them — sanded face UP (the interior shows), front edges dead flush (glue + ${boxSpec ? `${boxScrews} pocket screws` : "confirmat screws or dowels, on the 32 mm lines"}).${endNote}`,
        "carcass",
      );
      push(
        `Add the two 4" top stretchers — the FRONT one first, flush with the side front edges, then the REAR one flush at the back${boxSpec ? ` (${boxScrews} pocket screws, pockets up)` : ""}. Measure the diagonals now, before the glue grabs.`,
        "carcass",
      );
    } else {
      push(
        c.type === "wall"
          ? `Stand the two side panels on edge and join the BOTTOM between them — sanded face DOWN (a wall cabinet's underside shows from below), front edges dead flush (glue + ${boxSpec ? `${boxScrews} pocket screws, pockets facing INSIDE` : "confirmat screws or dowels"}).`
          : `Stand the two side panels on edge and join the BOTTOM between them — sanded face UP (the interior shows), front edges dead flush (glue + ${boxSpec ? `${boxScrews} pocket screws` : "confirmat screws or dowels"}).${endNote}`,
        "carcass",
      );
      push(
        `Add the TOP between the sides — sanded face DOWN into the cabinet, front edge flush${boxSpec ? ` (${boxScrews} pocket screws, pockets on the top face)` : ""}. Measure the diagonals now, before the glue grabs.`,
        "carcass",
      );
    }
    push(
      `Check for square — measure both diagonals, they should match — then screw on the ${fmtLen(backThickness(s), u)} back. The back is what holds the box square, so don’t skip it.`,
      "back",
    );
  }

  // Placement (hang / set on the toe-kick base) is a per-cabinet step ONLY for a
  // standalone box. In a joined run the boxes are set + screwed together and the
  // shared base built at the run level (genRunSteps), so a run-owned bay skips it.
  if (!runFrame) {
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
      const ladderPh = boxSpec
        ? ` Pocket-screw the ladder together — 2 pockets per cross-member and side-return end (jig at ${fmtLen(boxSpec.setting, u)}), ${boxScrews} screws, pockets on the hidden back faces.`
        : "";
      push(
        s.separateBase
          ? `Build a separate toe-kick base — a ${fmtLen(s.toeKick, u)}-tall plywood ladder set back ~${fmtLen(s.toeKickDepth, u)} at the front and ~${fmtLen(s.toeKickSideRecess, u)} at any exposed end, with a fascia across the front.${ladderPh} Level it, set this cabinet on top and screw down through the bottom; the face frame laps down over it to ~${fmtLen(s.faceFrameFloorGap, u)} off the floor.${tallNote}`
          : `Build a toe-kick base — a simple ${fmtLen(s.toeKick, u)}-tall ladder set back ~${fmtLen(s.toeKickDepth, u)} from the front.${ladderPh} Level it, then set this cabinet on top and screw down through the bottom.${tallNote}`,
        "base",
      );
    }
    else
      push(
        "Set the finished box directly on the floor (no toe kick) and shim it dead level before fastening anything.",
        "base",
      );
  }

  if (g.framed && !runFrame) {
    // A standalone (non-run) cabinet: its own self-contained face frame. In a
    // joined run the ONE continuous frame is fitted at the run level instead.
    const ffw = s.frameWidth || 1.5;
    const ffTop = s.faceFrameTop || 2;
    {
      const railLen = c.width; // top + bottom rails run the full width of the box
      const midLen = c.width - 2 * ffw; // mid rails fit between the captured stiles
      const stileLen = Math.max(0, g.boxHeight - ffTop - (g.openBox ? 0 : ffw));
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
      // one continuous top rail + a bottom rail (none on an open box — open knee) +
      // the mid rails
      const fullRails = 1 + (g.openBox ? 0 : 1);
      const ffl = Math.ceil((ffStiles * stileLen + fullRails * railLen + midRails * midLen) / 12);
      push(
        `Cut ~${ffl} ft of 3/4" hardwood into one continuous top rail${g.openBox ? "" : " and bottom rail"} the full width of the box, ${ffStiles} stiles and ${midRails} mid rail${midRails === 1 ? "" : "s"} — ${fmtLen(ffw, u)} wide (${fmtLen(ffTop, u)} top rail).`,
        "faceFrame",
      );
      const ffSpec = ph ? pocketSpec(s.stocks[s.roleStock.faceFrame]) : null;
      const stilePhrase = g.openBox
        ? "each stile's TOP end only (with no bottom rail they run to the floor)"
        : "each stile end";
      push(
        ffSpec
          ? `Pocket-screw the frame on the bench — jig at ${fmtLen(ffSpec.setting, u)}, 2 pockets in the BACK of ${stilePhrase}${midRails > 0 ? " and of each mid-rail end" : ""}, joined with ${screwLabel(ffSpec, u)} pocket screws (fine thread bites hardwood; switch to coarse if your frame stock is a softwood like pine). The long rails run the full width${g.openBox ? "" : " and the stiles are captured between them"} — check it for square as you clamp.`
          : ph
            ? "Join the frame on the bench with glue and dowels or splines — the frame stock is below a pocket jig's 1/2\" range. The long rails run the full width and the stiles are captured between them — check it for square as you clamp."
            : "Pocket-screw the frame on the bench: the long rails run the full width and the stiles are captured between them — check it for square as you clamp.",
        "faceFrame",
      );
      push(
        "Glue and pin the assembled face frame onto the front of the box, flush to the outside edges.",
        "faceFrame",
      );
    }
  }

  const doors = parts.filter((p) => p.name === "Door").reduce((a, p) => a + p.qty, 0);
  const drw = parts.filter((p) => p.name === "Drawer front").reduce((a, p) => a + p.qty, 0);

  /* ---- interior fittings first (boxes, shelves), THEN the faces go on ---- */

  // 1. Drawer slides + boxes (the box only — the face is a later step).
  if (drw > 0) {
    const bw = fmtLen(c.width - 2 * effectiveFrameWidth(c, s) - 1, u);
    const bd = fmtLen(Math.floor(g.carcassDepth - 1), u);
    // Framed: the box clears the FACE-FRAME opening, so the walls get packed
    // out to the slide line first. Quote the per-side pack-out from the
    // geometry — it is asymmetric in a run (half stile at a joint, full stile
    // at an exposed end) — and say where the strips sit.
    const bl = g.slideBlocking;
    const blThick = (sp: SlideBlockingSpec) =>
      `${fmtLen(sp.thickness, u)}${sp.layers > 1 ? ` (${sp.layers} strips)` : ""}`;
    const slideNote = bl.length
      ? (() => {
          const sides =
            bl.length === 2 && bl[0].thickness !== bl[1].thickness
              ? `${blThick(bl[0])} proud on the LEFT and ${blThick(bl[1])} on the RIGHT — the box hangs centred under its front, not in the carcass`
              : `${blThick(bl[0])} proud on each side`;
          return ` — the box is sized to the face-frame opening, so first pack each wall out to the slide line with the ${fmtLen(bl[0].length, u)} × ${fmtLen(bl[0].width, u)} blocking strips from the cut list (one per slide per side), ${sides}; set each strip's bottom edge ~7/8" below its drawer opening (on a desk that is resting on the deck) and shim until the slide faces sit exactly ${fmtLen(0.5, u)} off the box on both sides, or skip the strips and use face-frame rear-mount sockets`;
        })()
      : "";
    // Frameless railed inset: the rails dividing the openings go in first.
    if (isRailInset(c) && !g.framed) {
      const railsN = c.frontStyle === "door_drawer" ? 1 : Math.max(0, drw - 1);
      if (railsN > 0)
        push(
          `Cut and fit the ${railsN} inset rail${railsN > 1 ? "s" : ""} that divide the drawer openings, flush to the carcass front${boxSpec ? ` — 2 pockets in each rail end (jig at ${fmtLen(boxSpec.setting, u)}, on the hidden top/back face), fastened with ${boxScrews} pocket screws` : ""}.`,
          "drawers",
        );
    }

    const boxT = fmtLen(s.stocks[s.roleStock.drawerBox].thickness, u);
    const botT = fmtLen(s.stocks[s.roleStock.drawerBottom].thickness, u);
    const drwSpec = ph ? pocketSpec(s.stocks[s.roleStock.drawerBox]) : null;
    push(`Mount the drawer slides dead level at each opening${slideNote}.`, "drawers");
    push(
      `Cut the parts for ${nN(drw, "drawer box", "drawer boxes")} (about ${bw} wide × ${bd} deep) — ${boxT} ply sides and front/back, ${botT} ply bottoms; the exact per-drawer sizes are in the table below.`,
      "drawers",
      "drawerBoxes",
    );
    push(
      drwSpec
        ? `Groove a slot sized to the ${botT} bottom stock (test the fit on an offcut) 1/4\" up from the bottom edge of all four box parts, then re-set the pocket jig to ${fmtLen(drwSpec.setting, u)} (guide block + collar) and drill 2 pockets in each end of the front and back pieces, on their NON-sanded (outside) faces — sanded faces point INTO the box — and keep them clear of the groove. Assemble in order: screw the FRONT between the two sides, slide the bottom into its groove dry (no glue), then close the box with the BACK — ${screwLabel(drwSpec, u)} pocket screws — and check for square.`
        : `Groove a slot sized to the ${botT} bottom stock (test the fit on an offcut) 1/4\" up from the bottom edge of all four box parts, then glue and pin the sides to the front and back, slide the bottom in dry (no glue) and check each box for square.`,
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

  // The faces land in the face frame, so in a joined run they go on at the run
  // level (after the ONE frame is fitted) — see genRunSteps. A standalone box
  // hangs its own doors / fronts / pulls here.
  if (!runFrame) {
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
  }

  pushRunPointer();
  return { ...head, steps };
}

/** Display label for a run group: "B1–B3" (3+) or "B1 + B2". Shared by the
 * run group's own name and the member bays' closing pointer, so they match. */
export function runGroupLabel(names: string[]): string {
  return names.length > 2 ? `${names[0]}–${names[names.length - 1]}` : names.join(" + ");
}

/**
 * Run-level assembly steps: after each box is built individually, the run is put
 * together and ONE continuous face frame (and the shared toe-kick base) is
 * fitted onto the whole assembled run — mirroring the "Run" cut group. Emitted
 * once per multi-cabinet continuous framed run; the member bays skip these beats.
 */
export function genRunSteps(
  run: Run,
  members: CabinetParts[],
  s: Settings,
  color: string,
): StepGroup {
  const u = s.units;
  const steps: Step[] = [];
  const push = (t: string, stage: BuildStage) => steps.push({ n: steps.length + 1, t, stage });

  const names = members.map((m) => m.cabinet.name);
  const label = runGroupLabel(names);
  const ffw = s.frameWidth || 1.5;
  const ffTop = s.faceFrameTop || 2;
  const runW = fmtLen(run.members.reduce((a, m) => a + m.cabinet.width, 0), u);
  const ph = s.pocketHoles;
  const baseSpec = ph ? pocketSpec(s.stocks[s.roleStock.base]) : null;
  const ffSpec = ph ? pocketSpec(s.stocks[s.roleStock.faceFrame]) : null;

  const wallRun = run.members.every((m) => m.cabinet.type === "wall");
  const anyToeKick =
    !wallRun &&
    run.members.some(
      (m) => m.cabinet.toeKick !== false && m.cabinet.frontStyle !== "opening" && m.cabinet.frontStyle !== "desk",
    );
  const doors = members.reduce(
    (a, m) => a + m.parts.filter((p) => p.name === "Door").reduce((x, p) => x + p.qty, 0),
    0,
  );
  const drw = members.reduce(
    (a, m) => a + m.parts.filter((p) => p.name === "Drawer front").reduce((x, p) => x + p.qty, 0),
    0,
  );

  // 1. Stand the finished boxes together and screw them into one run.
  push(
    wallRun
      ? `Screw the finished boxes (${names.join(", ")}) together through the abutting side panels into one solid ${runW} run, then find the studs and hang the whole run on a level ledger at ${fmtLen(s.upperBottom, u)} off the floor — drive screws through the back rails into every stud, keeping the run dead straight.`
      : `Stand the finished boxes side by side working left to right — ${names.join(", then ")} — clamp each joint with the FRONT faces dead flush, and screw them together through the abutting side panels into one solid ${runW} run. Check the whole run is straight and square before moving on.`,
    "base",
  );
  // 2. The shared toe-kick base under the toe-kicked bays (floor-standing bays sit on the floor).
  if (anyToeKick) {
    const ladderPh = baseSpec
      ? ` Pocket-screw the ladder together — 2 pockets per cross-member and side-return end (jig at ${fmtLen(baseSpec.setting, u)}), ${screwLabel(baseSpec, u)} screws on the hidden back faces.`
      : "";
    push(
      s.separateBase
        ? `Build the separate toe-kick base — a ${fmtLen(s.toeKick, u)}-tall plywood ladder set back ~${fmtLen(s.toeKickDepth, u)} at the front and ~${fmtLen(s.toeKickSideRecess, u)} at each exposed end, with a recessed fascia.${ladderPh} Level it, then set the run's toe-kicked cabinets on top and screw down; the floor-standing bays (appliance opening, desk) sit straight on the floor.`
        : `Build the ${fmtLen(s.toeKick, u)}-tall toe-kick base under the toe-kicked cabinets.${ladderPh} Level it and set the run on top; the floor-standing bays sit straight on the floor.`,
      "base",
    );
  }
  // 3. Cut the individual frame members to length.
  push(
    `Cut the face-frame members to length from the hardwood — the full-run ${fmtLen(ffTop, u)} top rail, the ${fmtLen(ffw, u)} stiles (one SHARED at every bay joint)${anyToeKick ? ", the bottom rail over each toe-kicked span" : ""}, and the mid rails where the fronts stack. Every piece is listed in the ${run.members.length}-bay Run cut list.`,
    "faceFrame",
  );
  // 4. Connect the separate members into ONE frame on the bench. With pocket
  // joinery on, spell out WHICH ends get pockets — a ladder frame's
  // floor-running stiles (beside open bays) join only at the top, and a bottom
  // rail that stops against one butts it end-on. Same joint model as the
  // shopping list (runFrameJoints), so the text and the screw count agree.
  const joints = ffSpec ? runFrameJoints(run, s) : null;
  const frameScrews = joints
    ? 2 * (joints.stileTopEnds + joints.stileBottomEnds + joints.railButtEnds + joints.midRailEnds)
    : 0;
  push(
    ffSpec && joints
      ? `Connect the members into ONE continuous frame for the whole ${runW} run on the bench — set the pocket jig to ${fmtLen(ffSpec.setting, u)} (guide block + collar) and drill 2 pockets in the BACK of every joining end: the TOP end of all ${joints.stileTopEnds} stiles${
          joints.stileBottomEnds > 0
            ? `, the bottom end of the ${joints.stileBottomEnds} that rest${joints.stileBottomEnds === 1 ? "s" : ""} on a bottom rail (floor-running stiles beside the open bays join only at the top)`
            : ""
        }${joints.midRailEnds > 0 ? ", both ends of every mid rail" : ""}${
          joints.railButtEnds > 0
            ? `, and the ${joints.railButtEnds} bottom-rail end${joints.railButtEnds === 1 ? "" : "s"} that butt${joints.railButtEnds === 1 ? "s" : ""} a full-height stile`
            : ""
        } — ${frameScrews} × ${screwLabel(ffSpec, u)} pocket screws in all (fine thread bites hardwood; use coarse for a softwood like pine). Assembly order: lay the top rail face-DOWN, stand every stile in position (pockets up) and screw their top ends, then the bottom rail against its resting stiles, then the mid rails. It is built up from separate pieces, NOT milled from one board, so clamp it flat and dead square — one frame, not a frame per box.`
      : `Connect the members into ONE continuous frame for the whole ${runW} run on the bench — ${ph ? "glue and dowel or spline every joint (the frame stock is below a pocket jig's 1/2\" range)" : "pocket-screw (or dowel) every joint"}, the long rails running the full width with the stiles captured between them and shared at every bay joint. It is built up from separate pieces, NOT milled from one board, so clamp it flat and dead square — one frame, not a frame per box.`,
    "faceFrame",
  );
  // 5. Attach the assembled frame to the face of the run.
  push(
    `Attach the assembled frame to the FRONT of the whole run — glue and pin it on flush to the outside edges${anyToeKick ? `; it laps down over the toe-kick base to ~${fmtLen(s.faceFrameFloorGap, u)} off the floor` : ""}. This one frame ties all ${run.members.length} bays together.`,
    "faceFrame",
  );
  // 6. Hang the doors — inset in the openings, or proud for full overlay.
  const allInset = members.every((m) => m.geometry.inset);
  if (doors > 0)
    push(
      allInset
        ? `Hang the ${doors} inset door${doors > 1 ? "s" : ""} in their frame openings with inset/clip hinges, setting an even 1/8" reveal on every side.`
        : `Hang the ${doors} door${doors > 1 ? "s" : ""} proud over the frame — bore the hinge cups 22.5 mm in from each door edge, mount them on full-overlay hinges, and dial an even 1/8" reveal between the fronts.`,
      "doors",
    );
  // 7. Attach the drawer fronts — flush inset, or proud for full overlay.
  if (drw > 0)
    push(
      allInset
        ? `Attach the ${drw} inset drawer front${drw > 1 ? "s" : ""} to their boxes — tack each to set an even 1/8" reveal all round, then screw from inside the box.`
        : `Attach the ${drw} drawer front${drw > 1 ? "s" : ""} proud of the frame — tack each to an even 1/8" reveal between the fronts, then screw from inside the box.`,
      "drawerFronts",
    );
  // 8. Fit the pulls across the run.
  if (doors + drw > 0)
    push(
      `Mark, drill and fasten the ${doors + drw} pull${doors + drw > 1 ? "s" : ""} across the run in a consistent line. Stand back — the run is done.`,
      "pulls",
    );

  return {
    id: `run-${run.members.map((m) => m.cabinet.id).join("-")}`,
    name: `Face frame + base · ${label} — the whole run`,
    typeLabel: "Run",
    color,
    dims: `${runW} run · ${run.members.length} bays`,
    steps,
    runCabinetIds: run.members.map((m) => m.cabinet.id),
  };
}
