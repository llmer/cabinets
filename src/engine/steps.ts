import { CabinetParts, Settings } from "@/domain/types";
import { bandingInchesPerPiece } from "./parts";
import { isRailInset } from "./geometry";
import { hingesForDoorHeight } from "./hardware";
import { typeLabel } from "./labels";
import { fmtLen } from "./units";

export interface Step {
  n: number;
  t: string;
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
  const push = (t: string) => steps.push({ n: steps.length + 1, t });

  const pieces = parts.reduce((a, p) => a + p.qty, 0);
  const bandFt = Math.ceil(
    parts.reduce((a, p) => a + p.qty * bandingInchesPerPiece(p), 0) / 12,
  );
  const dims = `${fmtLen(c.width, u)} × ${fmtLen(c.height, u)} × ${fmtLen(c.depth, u)}`;
  const head = { id: c.id, name: c.name, typeLabel: typeLabel(c.type), color, dims };

  if (c.frontStyle === "opening") {
    push(
      `Cut the 2 side panels and the top${c.type === "base" ? " stretchers" : " panel"} for the surround.`,
    );
    if (bandFt > 0)
      push(`Edge-band the exposed front edges (about ${bandFt} ft) and trim flush.`);
    push(
      `${c.type === "base" ? "Join the top stretchers" : "Join the top panel"} between the side panels. There is no bottom, back or front — the appliance slides into the open bay.`,
    );
    if (g.framed)
      push("Add the face-frame stiles and a top rail around the opening, flush to the outside edges.");
    push(
      "Stand the surround in place, scribe it to the neighbouring cabinets or wall, and fasten. Confirm the opening clears your appliance — measure its required width, depth and height plus the maker’s side and top clearances before you build.",
    );
    return { ...head, steps };
  }

  push(
    `Cut all ${pieces} panels for ${c.name} from the cut list. Label each piece as it comes off the saw — it saves you twice.`,
  );
  push(
    isRailInset(c)
      ? "Drill the 32 mm system holes: two vertical rows on the inside of each side panel, ~56 mm in from the front (37 mm + face thickness, so railed-inset faces land flush) and 37 mm from the back, 32 mm on centre. These carry your shelf pins, hinge plates and slide screws."
      : "Drill the 32 mm system holes: two vertical rows on the inside of each side panel, 37 mm in from the front and back edges, 32 mm on centre. These carry your shelf pins, hinge plates and slide screws.",
  );
  if (bandFt > 0)
    push(
      `Iron edge-banding onto every exposed front edge — about ${bandFt} ft for this box — and trim flush.`,
    );

  if (c.frontStyle === "desk") {
    push(
      'Join the two 4" top stretchers between the side panels (glue + confirmat screws). There is no bottom and no back — the knee space stays open, so the desktop plus a corner brace keep it square.',
    );
    push("Fasten the desktop down through the top stretchers, checking the frame for square as you go.");
  } else {
    if (c.type === "base")
      push(
        'Join the bottom and the two 4" top stretchers between the side panels (glue + confirmat screws or dowels, on the 32 mm lines). Keep front faces dead flush.',
      );
    else
      push(
        "Join the top and bottom between the side panels (glue + confirmat screws or dowels). Keep front faces dead flush.",
      );
    push(
      "Check for square — measure both diagonals, they should match — then screw on the 3/4\" back. The back is what holds the box square, so don’t skip it.",
    );
  }

  if (c.type === "wall")
    push(
      `Find the studs and strike a level line at ${fmtLen(s.upperBottom, u)} off the floor. Hang the cabinet on a temporary ledger, then drive screws through the back rail into every stud.`,
    );
  else if (c.frontStyle === "desk")
    push(
      "Stand the unit on its side panels and shim level on the floor — the legs run straight to the ground, no toe kick.",
    );
  else if (c.toeKick !== false)
    push(
      `Build a toe-kick base — a simple ${fmtLen(s.toeKick, u)}-tall ladder set back ~${fmtLen(s.toeKickDepth, u)} from the front — level it, then set this cabinet on top and screw down through the bottom.`,
    );
  else
    push(
      "Set the finished box directly on the floor (no toe kick) and shim it dead level before fastening anything.",
    );

  if (g.framed) {
    const ffl = Math.ceil(
      parts.filter((p) => p.linear).reduce((a, p) => a + p.qty * p.length, 0) / 12,
    );
    push(
      `Mill the face frame from ~${ffl} ft of 1 1/2" hardwood. Pocket-screw the stiles and rails into a flat frame, then glue and pin it to the front of the box, flush to the outside edges.`,
    );
  }

  const doors = parts.filter((p) => p.name === "Door").reduce((a, p) => a + p.qty, 0);
  if (doors > 0) {
    const maxDoorH = Math.max(
      0,
      ...parts.filter((p) => p.name === "Door").map((p) => p.width),
    );
    const hingesPer = hingesForDoorHeight(maxDoorH);
    if (g.inset)
      push(
        `Bore 35 mm hinge cups (${hingesPer} per door) and hang ${doors} inset door${doors > 1 ? "s" : ""} ${g.framed ? "inside the frame openings" : "flush in the box openings"} with inset/clip hinges, setting an even 1/8" reveal on every side.`,
      );
    else
      push(
        `Bore 35 mm hinge cups (${hingesPer} per door) 22.5 mm in from the door edge. Mount ${doors} full-overlay door${doors > 1 ? "s" : ""} and dial the reveal to an even 1/8" between them.`,
      );
  }

  const drw = parts
    .filter((p) => p.name === "Drawer front")
    .reduce((a, p) => a + p.qty, 0);
  if (drw > 0) {
    const bw = fmtLen(g.interiorWidth - 1, u);
    const bd = fmtLen(Math.floor(g.carcassDepth - 1), u);
    push(
      `Mount drawer slides dead level at each opening. Build ${drw} drawer box${drw > 1 ? "es" : ""} (${bw} wide × ${bd} deep, 1/2\" ply sides with a 1/4\" captured bottom — see the per-drawer sizes below), fit them, then attach the fronts to a 1/8" reveal.`,
    );
  }

  if (c.shelves > 0)
    push(
      `Drop in ${c.shelves} adjustable shelf${c.shelves > 1 ? "es" : ""} on pins at your chosen heights. Done.`,
    );

  return { ...head, steps };
}
