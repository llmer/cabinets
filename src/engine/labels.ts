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
  allFull: boolean;
  allInset: boolean;
  label: string;
  note: string;
}

const BOX_FRAMELESS =
  'Frameless / Euro — 3/4" plywood throughout, no face frame; applied 3/4" back (sides & top/bottom set 3/4" shallower so finished depth holds).';
const BOX_FRAMED =
  'Face frame — 3/4" plywood box plus a 1 1/2"-wide 3/4" hardwood face frame (stiles, rails, mid rails) glued to the front; that stock is listed separately and is NOT nested in the plywood sheets.';
const BOX_MIXED =
  "Mixed construction — each cabinet carries its own frameless / face-frame setting (see its tag); hardwood face-frame stock is listed separately, not nested in the sheets.";

const FIT_FULL = ' Fronts are full-overlay, covering the box/frame to a 1/8" reveal.';
const FIT_INSET = ' Fronts are inset, sized to the openings with a 1/8" reveal.';
const FIT_MIXED = " Front fit (full-overlay vs inset) is set per cabinet.";
const VERIFY = " Verify against your own method before cutting.";

/** Summarize the run's construction + front fit (all-framed / all-inset / mixed). */
export function constructionInfo(cabinets: Cabinet[]): ConstructionInfo {
  const allFramed =
    cabinets.length > 0 && cabinets.every((c) => (c.construction || "frameless") === "framed");
  const allFrameless = cabinets.every((c) => (c.construction || "frameless") !== "framed");
  const allFull = cabinets.every((c) => c.overlay !== "inset");
  const allInset = cabinets.length > 0 && cabinets.every((c) => c.overlay === "inset");

  const constr = allFramed ? "face frame" : allFrameless ? "frameless" : "mixed";
  const fit = allFull ? "full overlay" : allInset ? "inset" : "mixed fit";
  const label = `${constr} · ${fit}`;

  const box = allFrameless ? BOX_FRAMELESS : allFramed ? BOX_FRAMED : BOX_MIXED;
  const fitNote = allFull ? FIT_FULL : allInset ? FIT_INSET : FIT_MIXED;
  return { allFramed, allFrameless, allFull, allInset, label, note: box + fitNote + VERIFY };
}
