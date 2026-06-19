import { Cabinet, CabinetType, FrontStyle } from "@/domain/types";

export function typeLabel(t: CabinetType): string {
  return t === "wall" ? "Wall" : t === "tall" ? "Tall / pantry" : "Base";
}

export function frontStyleLabel(f: FrontStyle): string {
  switch (f) {
    case "doors":
      return "Doors";
    case "drawers":
      return "Drawer bank";
    case "door_drawer":
      return "Drawer over doors";
    case "desk":
      return "Open desk";
    case "opening":
      return "Appliance opening";
  }
}

export interface ConstructionInfo {
  allFramed: boolean;
  allFrameless: boolean;
  label: string;
  note: string;
}

const NOTE_FRAMELESS =
  'Construction assumptions — frameless / Euro. 3/4" plywood throughout, no face frame. Applied 3/4" back (sides & top/bottom set 3/4" shallower so finished depth holds). Doors & drawer fronts are full-overlay, covering the box face to a 1/8" reveal. Base & tall boxes follow the toe-kick setting per cabinet. Verify against your own method before cutting.';
const NOTE_FRAMED =
  'Construction assumptions — face frame (framed). 3/4" plywood box (sides, bottom/top or stretchers, applied 3/4" back). A 1 1/2"-wide 3/4" hardwood face frame (stiles, rails, mid rails) is glued to the front; that stock is listed separately and is NOT nested in the plywood sheets. Doors and drawer fronts are inset, sized to the openings with a 1/8" reveal. Verify against your own method before cutting.';
const NOTE_MIXED =
  "Construction assumptions — mixed. Each cabinet carries its own frameless or face-frame setting (see its tag). Frameless cabinets are full-overlay 3/4\" plywood; face-frame cabinets add 1 1/2\" hardwood stiles & rails with inset fronts (listed separately, not nested in the sheets). Verify against your own method before cutting.";

/** Summarize whether the run is all frameless, all framed, or mixed. */
export function constructionInfo(cabinets: Cabinet[]): ConstructionInfo {
  const allFramed =
    cabinets.length > 0 && cabinets.every((c) => (c.construction || "frameless") === "framed");
  const allFrameless = cabinets.every((c) => (c.construction || "frameless") !== "framed");
  const label = allFramed ? "face frame" : allFrameless ? "frameless" : "mixed";
  const note = allFrameless ? NOTE_FRAMELESS : allFramed ? NOTE_FRAMED : NOTE_MIXED;
  return { allFramed, allFrameless, label, note };
}
