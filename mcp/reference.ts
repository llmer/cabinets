/**
 * Domain reference + glossary for the MCP.
 *
 * This is the knowledge the "someone in the middle of the design asking
 * questions about the build" persona reaches for. It's surfaced two ways:
 *  - as an MCP resource (`reference://domain`) the client can attach for context;
 *  - through the `explain` tool, which returns one topic at a time.
 *
 * Keep it in sync with the model in `src/domain/types.ts` and README.md.
 */

export interface Topic {
  title: string;
  body: string;
}

export const TOPICS: Record<string, Topic> = {
  overview: {
    title: "What this tool models",
    body: [
      "frame(less) turns a row of cabinet definitions into a full build package:",
      "a cut list, sheet-nesting layout, hardware + cost estimate, and ordered",
      "assembly steps. Everything is derived from just two inputs — the list of",
      "cabinets and the project settings — so changing one number re-derives the",
      "whole plan. Dimensions are stored in inches; millimetres are display-only.",
      "",
      "This is an estimate of a cut list, NOT a guarantee — verify against your",
      "own method before cutting.",
    ].join("\n"),
  },
  cabinet_types: {
    title: "Cabinet types",
    body: [
      "- base : floor cabinet, ~34.5\" tall incl. toe kick, ~24\" deep, holds the counter.",
      "- wall : upper cabinet, hung off the floor (see upperBottom), ~12\" deep.",
      "- tall : pantry / oven / broom cabinet, full height (~84\"), floor-standing.",
      "Height for base/tall INCLUDES the toe kick; the finished box is that minus the kick.",
    ].join("\n"),
  },
  front_style: {
    title: "Front styles",
    body: [
      "- doors       : one or more doors side by side.",
      "- drawers     : a stack of drawer fronts (a drawer bank).",
      "- door_drawer : one drawer on top over doors below.",
      "- desk        : drawer(s) over an OPEN knee space — no bottom, no back.",
      "- opening     : an empty bay for an appliance/fridge — no front, no bottom, no back.",
    ].join("\n"),
  },
  construction: {
    title: "Construction: frameless vs. framed",
    body: [
      "Two orthogonal axes describe a front. This is the first: the BOX.",
      "- frameless (Euro / 32 mm): a plain 3/4\" plywood box, no face frame.",
      "- framed: the plywood box PLUS a solid-hardwood face frame (stiles + rails)",
      "  glued to the front. That hardwood is priced by the foot and never nested",
      "  into the plywood sheets.",
      "Construction is independent of front fit (overlay) — all combinations work.",
    ].join("\n"),
  },
  overlay: {
    title: "Front fit: full / railed-inset / inset",
    body: [
      "The second axis: how the front sits relative to the box/frame.",
      "- full        : full-overlay — the front sits proud, covering the face to a reveal.",
      "- inset_rail  : railed inset — flush in the opening, a rail between every stacked face.",
      "- inset       : full inset — flush in the opening, faces separated by reveals only.",
      "Overlay is independent of construction. Changing it moves the drawer-stack",
      "budget, so drawer heights are re-split automatically.",
    ].join("\n"),
  },
  reveal: {
    title: "Reveal",
    body: [
      "The gap between full-overlay fronts (and around inset fronts). Default 1/8\"",
      "(0.125\"). A reveal of 0 makes neighbouring fronts butt together with no gap;",
      "much over 3/16\" starts to look loose.",
    ].join("\n"),
  },
  toe_kick: {
    title: "Toe kick + separate base",
    body: [
      "The recessed notch a base/tall cabinet stands on so your toes clear the",
      "front. `toeKick` (height, default 4.5\") is subtracted from the cabinet",
      "height to get the finished box. With `separateBase` on, the kick is modelled",
      "as a real plywood ladder + recessed fascia carried in the cut list, rather",
      "than a bare height offset. Desks and appliance openings stand on the floor",
      "with no toe kick.",
    ].join("\n"),
  },
  runs: {
    title: "Runs — shared face frame + base",
    body: [
      "Contiguous cabinets of the same type/height/depth/construction join into a",
      "RUN that shares ONE continuous face frame (shared stiles at every joint,",
      "rails per bay) and ONE toe-kick base. Runs are derived automatically by",
      "walking the cabinet list in order. Break a run — at a corner, an appliance",
      "gap, or an island — by setting `runBreak` on the cabinet that starts the new",
      "run, so the frame and base never span a physical break.",
    ].join("\n"),
  },
  drawer_budget: {
    title: "Drawer-stack budget",
    body: [
      "The vertical room available to the drawer fronts. It depends on the front fit:",
      "- full overlay (the default): the box height minus only the reveals between the",
      "  fronts — no rail or edge is subtracted, since the fronts cover the box.",
      "- inset (railed or flush): the box height minus the (wider) top rail, the",
      "  frame/box edges, and a mid rail or reveal between each stacked front.",
      "- desk: the drawers sit up top and keep ~22\" of open knee clearance below.",
      "Heights default to an even split of that budget and are clamped so a stack can",
      "never overflow its opening; set explicit per-drawer heights to vary them (e.g. a",
      "shallow top drawer over deeper ones).",
    ].join("\n"),
  },
  sheets: {
    title: "Sheet nesting + yield",
    body: [
      "Parts sharing a sheet stock are packed onto that stock's sheet size by a",
      "first-fit-decreasing nester. YIELD is the placed-part area as a percent of the",
      "sheets used — higher means less waste. What moves it:",
      "- kerf: the saw-blade width lost at every cut.",
      "- grain / allow-rotate: with rotation off (grain locked) parts can't spin to",
      "  fill gaps, so yield drops; with it on they nest tighter.",
      "- part vs. sheet size: one tall 84\" panel or an odd width can strand most of a",
      "  second sheet, so a small width change can save a whole sheet.",
      "- oversize: a part larger than any sheet won't fit at all (the audit errors).",
      "Read the layout with get_sheets; the audit flags a low yield with the levers.",
    ].join("\n"),
  },
  store_breakdown: {
    title: "Store breakdown (panel-saw rips)",
    body: [
      "With storeBreakdown on, the nester packs each sheet as full-length horizontal",
      "strips and plans the rip cuts a store's panel saw (e.g. Home Depot) makes",
      "before the sheet leaves the store — strips are far easier to haul than a",
      "4×8 sheet, and every part is then track-sawed out of its strip at home.",
      "Rip widths are asked for IN ORDER, each measured from the freshly cut edge.",
      "A store cut is rough, so it is never kept as a part edge: every part stays",
      "at least storeTrim (default 1/2\") clear of each store-cut strip edge,",
      "leaving material for one clean track-saw pass. Factory sheet edges are",
      "trusted as-is, same as regular nesting. A leftover wider than 4\" is freed",
      "as a labelled offcut; smaller remainders stay on the last strip. Expect a",
      "slightly lower yield / an extra sheet sometimes — that's the trim's cost.",
      "Settings: storeBreakdown (off by default), storeTrim. See get_sheets.",
    ].join("\n"),
  },
  materials: {
    title: "Materials, roles + stock",
    body: [
      "A `Stock` is a physical material (a sheet good priced per sheet, or linear",
      "hardwood priced per foot). A `Role` (carcass, back, front, drawerBox,",
      "drawerBottom, faceFrame, base) is mapped to a stock via roleStock. Parts",
      "sharing a stock nest together on its sheet size; linear hardwood is never",
      "nested. Re-point any role to a different stock in settings (e.g. back → 1/4\").",
    ].join("\n"),
  },
  system_32mm: {
    title: "The 32 mm system",
    body: [
      "A shop convention: two vertical rows of holes on 32 mm centres on the inside",
      "of each side panel carry shelf pins, hinge plates and drawer-slide screws.",
      "You design in inches and drill on the 32 mm grid. The intrinsic 32/37/35/22.5",
      "mm figures in the assembly steps stay metric on purpose.",
    ].join("\n"),
  },
};

/** The full reference as one markdown document (the `reference://domain` resource). */
export function referenceMarkdown(): string {
  const parts = ["# frame(less) — domain reference", ""];
  for (const key of Object.keys(TOPICS)) {
    const t = TOPICS[key];
    parts.push(`## ${t.title}  \n\`${key}\``, "", t.body, "");
  }
  parts.push(
    "---",
    "Estimates a cut list; not a guarantee — verify against your own method before cutting.",
  );
  return parts.join("\n");
}

export const TOPIC_KEYS = Object.keys(TOPICS) as [string, ...string[]];
