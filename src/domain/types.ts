/**
 * Domain model for the cabinet builder.
 *
 * All linear dimensions are stored internally in INCHES. The display unit
 * (inches-fractional or millimetres) is a presentation concern handled in
 * `engine/units.ts`; the math never changes. This mirrors how a real 32 mm
 * shop works in the US: design in inches, drill on the 32 mm grid.
 */

export type CabinetType = "base" | "wall" | "tall";

/**
 * How the front of the box is broken up.
 * - doors        : 1-N doors side by side
 * - drawers      : a stack of drawer fronts
 * - door_drawer  : one drawer on top, doors below
 * - desk         : drawer(s) on top over an open knee space (no bottom/back)
 * - opening      : an empty bay for an appliance/fridge (no front, no bottom/back)
 */
export type FrontStyle = "doors" | "drawers" | "door_drawer" | "desk" | "opening";

/** Box construction: frameless (Euro / 32 mm) or a hardwood face frame. */
export type Construction = "frameless" | "framed";

/**
 * How the door/drawer front sits relative to the box/frame, independent of
 * construction:
 * - full       : full-overlay — front sits proud, covering the face to a reveal
 * - inset_rail : railed inset — flush in the opening, a rail between every face
 * - inset      : full inset — flush in the opening, faces separated by gaps only
 */
export type Overlay = "full" | "inset_rail" | "inset";

export type Units = "in" | "mm";

export interface Cabinet {
  id: string;
  name: string;
  type: CabinetType;
  /** Outside dimensions, inches. Height includes the toe-kick for base/tall. */
  width: number;
  height: number;
  depth: number;
  frontStyle: FrontStyle;
  doorCount: number;
  drawerCount: number;
  shelves: number;
  /** Base/tall only. true = stands on a recessed toe kick; false = sits flush. */
  toeKick: boolean;
  construction: Construction;
  /** Full-overlay (proud) or inset (flush) fronts. */
  overlay: Overlay;
  /** Optional per-drawer FRONT heights (inches). When absent, an even split is used. */
  drawerHeights?: number[];
  /**
   * Start a new run *before* this cabinet — even when it would otherwise join
   * the previous one. The escape hatch for a corner, an appliance gap, an
   * island, or a separate wall, so a continuous face frame / toe-kick base
   * never spans a physical break. Absent = false (joins where contiguous).
   */
  runBreak?: boolean;
}

/* ------------------------------------------------------------------ */
/* Materials / stock                                                   */
/* ------------------------------------------------------------------ */

export type StockKind = "sheet" | "linear";

/** Part roles map onto a physical stock so parts of the same material nest together. */
export type Role =
  | "carcass"
  | "back"
  | "front"
  | "drawerBox"
  | "drawerBottom"
  | "faceFrame"
  /** Toe-kick base ladder + recessed fascia + side returns (run-level). */
  | "base";

export type StockId = string;

export interface Stock {
  id: StockId;
  label: string;
  kind: StockKind;
  thickness: number;
  /** Sheet goods only. */
  sheetW: number;
  sheetH: number;
  costPerSheet: number;
  /** Linear stock only (e.g. hardwood by the board foot of 1×). */
  costPerFoot: number;
}

/* ------------------------------------------------------------------ */
/* Hardware                                                            */
/* ------------------------------------------------------------------ */

export interface HardwarePricing {
  hingeEach: number;
  slidePairEach: number;
  pullEach: number;
  shelfPinEach: number;
  /** Count one pull per door + one per drawer front. */
  countPulls: boolean;
}

/* ------------------------------------------------------------------ */
/* Project settings                                                    */
/* ------------------------------------------------------------------ */

export interface Settings {
  units: Units;
  /** Reveal / gap between full-overlay fronts and around inset fronts (inches). */
  reveal: number;
  /** Toe-kick height (inches) and how far it is recessed from the front. */
  toeKick: number;
  toeKickDepth: number;
  /** How far the toe-kick is recessed on an exposed END of a run (inches). */
  toeKickSideRecess: number;
  /**
   * Skin one continuous face frame across each run of joined framed cabinets —
   * shared stiles at every joint, rails spanning each bay — instead of a
   * separate frame per box. Off = a frame per cabinet (the old behaviour).
   */
  continuousFaceFrame: boolean;
  /**
   * Model the toe kick as a real, separate plywood base "ladder" + recessed
   * fascia (with side returns on exposed ends) carried in the cut list, rather
   * than a bare height offset. Off = the toe kick is geometry only, no parts.
   */
  separateBase: boolean;
  /**
   * Height of the bottom of the face frame off the finished floor (inches).
   * The frame drops to here over a toe-kicked run, overhanging the recessed
   * toe-kick fascia below it. Only meaningful with a toe kick present.
   */
  faceFrameFloorGap: number;
  /** Height from finished floor to the bottom of wall cabinets (inches). */
  upperBottom: number;
  /** Finished counter height (guide line only). */
  counterH: number;
  /** Saw kerf used by the sheet nester (inches). */
  kerf: number;
  /** Allow parts to rotate 90° when nesting (off = respect grain direction). */
  allowRotate: boolean;
  /** Face-frame stile/rail width (inches). */
  frameWidth: number;
  /** Default construction applied to brand-new cabinets. */
  construction: Construction;
  /** Generate drawer-box parts (sides/front/back/bottom) in addition to fronts. */
  includeDrawerBoxes: boolean;
  /** Show counter / upper guide lines in the elevation. */
  showGuideLines: boolean;
  /** Cost of edge-banding per linear foot. */
  edgeBandPerFoot: number;
  /** Physical stocks, keyed by id. */
  stocks: Record<StockId, Stock>;
  /** Which stock each part role is cut from. */
  roleStock: Record<Role, StockId>;
  hardware: HardwarePricing;
}

/* ------------------------------------------------------------------ */
/* Project (the unit of save/load — local only, no DB)                 */
/* ------------------------------------------------------------------ */

export const SCHEMA_VERSION = 1;

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  cabinets: Cabinet[];
  settings: Settings;
}

/* ------------------------------------------------------------------ */
/* Engine output types                                                 */
/* ------------------------------------------------------------------ */

/** A single distinct part (with a quantity) in the cut list. */
export interface Part {
  name: string;
  qty: number;
  /** Length runs with the grain (the longer nominal dimension). */
  length: number;
  width: number;
  role: Role;
  stockId: StockId;
  /** Edge-band all four edges (doors / drawer fronts). */
  bandAll: boolean;
  /** Linear inches of single-edge banding on one piece (exposed front edges). */
  bandFrontEdge: number;
  /** True for solid hardwood (linear stock) — never nested in sheets. */
  linear: boolean;
}

/** Geometry derived once per cabinet and shared by parts/steps/3D. */
export interface CabinetGeometry {
  boxHeight: number;
  interiorWidth: number;
  carcassDepth: number;
  faceHeight: number;
  framed: boolean;
  inset: boolean;
  openBox: boolean;
}

export interface CabinetParts {
  cabinet: Cabinet;
  geometry: CabinetGeometry;
  parts: Part[];
}
