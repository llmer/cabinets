/**
 * Pocket-hole joinery planning — Kreg-style jig settings and screw selection.
 *
 * The rules the whole module encodes (they match the standard Kreg chart):
 * - The jig's guide block AND the bit's stop collar are both set to the
 *   thickness of the piece the pockets are DRILLED in, snapped to the jig's
 *   1/2"–1 1/2" stops (1/8" steps). 23/32" ply is drilled at the 3/4" stop.
 *   Stock meaningfully thinner than 1/2" is BELOW the jig's range — no spec
 *   is produced for it, and callers fall back to pin-and-glue wording.
 * - Screw length follows the chart for that setting (3/4" → 1 1/4", …).
 * - Thread follows the material the screw bites into: fine for hardwood,
 *   coarse for plywood/softwood. Here every planned joint is same-stock
 *   (bottom→sides, stile→rail, drawer front→sides), so the drilled part's
 *   stock decides: linear (hardwood) → fine, sheet → coarse. If the frame
 *   stock is actually a softwood (pine 1×), use coarse instead.
 *
 * Face-frame joints are NOT counted from part names — a ladder frame's
 * floor-running stiles join only at the top — they come from the run model
 * via `runFrameJoints` (see framePocketScrews below).
 */
import { Cabinet, Part, Settings, Stock } from "@/domain/types";
import { isFramed, isInset, isOpenBox } from "./geometry";
import { runsOf } from "./runs";
import { RunFrameJoints, runFrameJoints } from "./runParts";
import { fmtLen } from "./units";

export interface PocketSpec {
  /** Jig guide-block + collar setting (inches) — the drilled piece's thickness. */
  setting: number;
  /** Matching screw length (inches) from the standard chart. */
  screwLength: number;
  thread: "coarse" | "fine";
}

/** The jig's thinnest supported stock — 15/32 sheet ply still rounds up safely. */
const MIN_STOCK = 0.4375;

/** Snap a stock thickness to the jig's 1/2"–1 1/2" stops in 1/8" steps. */
export function jigSetting(thickness: number): number | null {
  if (thickness < MIN_STOCK) return null; // below the jig's range — don't pretend
  const snapped = Math.round(thickness * 8) / 8;
  return Math.min(1.5, Math.max(0.5, snapped));
}

/** Standard screw-length chart, keyed by the jig setting (largest stop ≤ setting wins). */
const SCREW_CHART: Array<[number, number]> = [
  [0.5, 1],
  [0.625, 1],
  [0.75, 1.25],
  [0.875, 1.5],
  [1, 1.5],
  [1.125, 1.5],
  [1.25, 2],
  [1.5, 2.5],
];

export function screwLength(setting: number): number {
  let len = SCREW_CHART[0][1];
  for (const [stop, l] of SCREW_CHART) if (stop <= setting + 1e-6) len = l;
  return len;
}

/** The jig + screw spec for pockets drilled in this stock; null = stock too thin. */
export function pocketSpec(stock: Stock): PocketSpec | null {
  const setting = jigSetting(stock.thickness);
  if (setting == null) return null;
  return {
    setting,
    screwLength: screwLength(setting),
    thread: stock.kind === "linear" ? "fine" : "coarse",
  };
}

/**
 * '1 1/4" coarse-thread' — the label steps and the shopping list share.
 * Screws are sold by nominal size, so mm projects get the package number
 * (1 1/4" → 32 mm), not a raw unit conversion.
 */
export function screwLabel(spec: PocketSpec, units: "in" | "mm"): string {
  const len =
    units === "mm" ? `${Math.round(spec.screwLength * 25.4)} mm` : fmtLen(spec.screwLength, "in");
  return `${len} ${spec.thread}-thread`;
}

/** Pockets along one panel-end row: one every ~8", never fewer than 2. */
export function pocketsPerEnd(edge: number): number {
  return Math.max(2, Math.ceil(edge / 8));
}

/* ------------------------------------------------------------------ */
/* Screw totals — how many of each screw the whole project needs       */
/* ------------------------------------------------------------------ */

export interface ScrewTotal {
  spec: PocketSpec;
  count: number;
}

/**
 * Which SHEET parts get pockets drilled in them, and how many per part:
 * panels (bottom/top/deck) carry a row per end sized by their depth; narrow
 * rails/stretchers get 2 per end. Backs, shelves and fronts are fastened
 * another way and get none. Face-frame members are counted separately
 * (framePocketScrews) because their joint count depends on the run shape.
 */
function pocketsForPart(p: Part): number {
  switch (p.name) {
    // panels joined into the sides: a row across each end (width = their depth)
    case "Bottom":
    case "Top":
    case "Drawer deck":
      return 2 * pocketsPerEnd(p.width);
    // stretchers, divider rails and base ladder members: 2 per end
    case "Top stretcher":
    case "Back stretcher":
    case "Back bottom stretcher":
    case "Inset rail":
    case "Base cross member":
    case "Toe-kick return":
      return 2 * 2;
    // drawer box fronts/backs pocket into the sides: 2 per corner
    case "Drawer box front/back":
      return 2 * pocketsPerEnd(p.width);
    default:
      return 0;
  }
}

/**
 * Aggregate pocket-screw demand across a flat part list (per-cabinet parts +
 * the run groups' base parts), bucketed by spec. Stock below the jig's range
 * contributes nothing. Counts are exact for the planned pockets — buy a box
 * anyway; spares always get used.
 */
export function pocketScrewTotals(parts: Part[], s: Settings): ScrewTotal[] {
  const buckets = new Map<string, ScrewTotal>();
  const bucket = (spec: PocketSpec, count: number) => {
    const key = `${spec.setting}|${spec.screwLength}|${spec.thread}`;
    const b = buckets.get(key);
    if (b) b.count += count;
    else buckets.set(key, { spec, count });
  };
  for (const p of parts) {
    const per = pocketsForPart(p);
    if (per === 0) continue;
    const spec = pocketSpec(s.stocks[p.stockId]);
    if (spec) bucket(spec, per * p.qty);
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

/** Total joined member ends in a frame's joint set. */
export function frameJointEnds(j: RunFrameJoints): number {
  return j.stileTopEnds + j.stileBottomEnds + j.railButtEnds + j.midRailEnds;
}

/**
 * Every face frame in the project with its joint counts — run frames via
 * `runFrameJoints` (floor-running stiles join only at the top, bottom-rail
 * ends butt full-height stiles), solo frames from the cabinet's shape. The
 * `id` matches the cut/step group the frame belongs to (run id or cabinet id).
 */
export function frameJointsFor(
  cabinets: Cabinet[],
  s: Settings,
): Array<{ id: string; joints: RunFrameJoints }> {
  if (s.continuousFaceFrame) {
    return runsOf(cabinets, s)
      .filter((run) => run.framed)
      .map((run) => ({ id: run.id, joints: runFrameJoints(run, s) }));
  }
  const out: Array<{ id: string; joints: RunFrameJoints }> = [];
  for (const c of cabinets) {
    if (!isFramed(c)) continue;
    const openBox = isOpenBox(c); // desk / appliance opening: no bottom rail
    const mid =
      isInset(c) && !openBox
        ? c.frontStyle === "drawers"
          ? Math.max(0, c.drawerCount - 1)
          : c.frontStyle === "door_drawer"
            ? 1
            : 0
        : isInset(c) && c.frontStyle === "desk"
          ? c.drawerCount
          : 0;
    out.push({
      id: c.id,
      joints: {
        stileTopEnds: 2,
        stileBottomEnds: openBox ? 0 : 2,
        railButtEnds: 0,
        midRailEnds: 2 * mid,
      },
    });
  }
  return out;
}

/**
 * Pocket screws for the face frame(s), counted from the frame's actual
 * joints. 2 screws per joined member end.
 */
export function framePocketScrews(cabinets: Cabinet[], s: Settings): number {
  return frameJointsFor(cabinets, s).reduce((a, f) => a + 2 * frameJointEnds(f.joints), 0);
}

/* ------------------------------------------------------------------ */
/* Per-part drill schedule — which face, how many, which screw         */
/* ------------------------------------------------------------------ */

export interface PocketRow {
  /**
   * The face the pockets are drilled in — ALWAYS the non-sanded face (the
   * sanded face never takes a pocket), plus where that face ends up.
   */
  face: string;
  /** Which way the sanded (show) face points when the piece is installed. */
  showFace: string;
  /** Pockets per piece. */
  perPiece: number;
  spec: PocketSpec;
}

/**
 * Drill-face guidance per part. ONE rule, no exceptions: pockets go in the
 * NON-sanded face; the sanded face is the show face and points at whatever
 * is most visible. Each row spells out the resulting orientation.
 * Pass `wall: true` for a wall cabinet's parts — ITS bottom is seen from
 * BELOW, so the sanded face points down and the pockets end up inside.
 * Face-frame members are not per-part rows (their joint count depends on the
 * run shape — see frameJointsFor); returns null for them and for parts that
 * take no pockets.
 */
export function pocketRow(p: Part, s: Settings, wall = false): PocketRow | null {
  const perPiece = pocketsForPart(p);
  if (perPiece === 0) return null;
  const spec = pocketSpec(s.stocks[p.stockId]);
  if (!spec) return null;
  const faces: Record<string, [string, string]> = {
    Bottom: wall
      ? ["NON-sanded face — it ends up facing UP, inside the cabinet", "sanded face DOWN (a wall cabinet's underside shows from below)"]
      : ["NON-sanded face — it becomes the underside", "sanded face UP (the cabinet interior shows)"],
    Top: ["NON-sanded face — it becomes the top", "sanded face DOWN into the cabinet"],
    // A desk deck's underside is the OPEN KNEE SPACE — the drawer hides the top.
    "Drawer deck": ["NON-sanded face — it faces UP under the drawer", "sanded face DOWN toward the open knee space"],
    "Top stretcher": ["NON-sanded face — up, hidden under the counter/top", "sanded face down into the cabinet"],
    "Back stretcher": ["NON-sanded face — toward the wall", "sanded face into the cabinet"],
    "Back bottom stretcher": ["NON-sanded face — toward the wall", "sanded face into the cabinet"],
    "Inset rail": ["NON-sanded face — up or back, never the front edge", "sanded face out (the front edge shows)"],
    "Base cross member": ["NON-sanded face — either way, all of it hides in the base", "no show face inside the toe-kick"],
    "Toe-kick return": ["NON-sanded face — it faces inward", "sanded face OUT (it shows at the run end)"],
    "Drawer box front/back": [
      "NON-sanded (outside) faces",
      "sanded faces INSIDE the box — that's what you see when the drawer is open",
    ],
  };
  const f = faces[p.name];
  if (!f) return null;
  return { face: f[0], showFace: f[1], perPiece, spec };
}
