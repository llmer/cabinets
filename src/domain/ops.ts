/**
 * Pure project operations — the cabinet/settings mutation *rules*, extracted
 * from the Zustand store so they have exactly one home.
 *
 * Every function here is a pure transform: it takes the current `Cabinet[]`
 * (or `Settings`) plus arguments and returns a FRESH value, never mutating its
 * input. The store (`state/store.ts`) wraps these with undo history +
 * autosave; the headless MCP server (`mcp/`) calls them directly. Because both
 * front-ends share this module, a design produced by an agent and a design
 * produced by a human go through the identical budget-recompute and
 * front-style-clamp logic — they can never drift.
 *
 * The important business rules encoded here:
 *  - construction / overlay / frontStyle / drawerCount changes re-derive
 *    `drawerHeights` via `defaultHeights` / `evenHeights`; a `type` change only
 *    clamps dimensions + front style (heights self-heal at compute time);
 *  - `desk` / `opening` fronts force `toeKick=false` + `shelves=0`;
 *  - switching a base-only front onto a wall/tall cabinet falls back to doors.
 */
import { defaultCabinet, nextId } from "./defaults";
import {
  Cabinet,
  CabinetType,
  Construction,
  FrontStyle,
  HardwarePricing,
  Overlay,
  Role,
  Settings,
  Stock,
  StockId,
} from "./types";
import { defaultHeights, evenHeights, withDrawerHeight } from "@/engine/drawers";

/** Fronts that only make sense on a base cabinet (a wall/tall gets `doors`). */
const BASE_ONLY_FRONTS: FrontStyle[] = ["drawers", "door_drawer", "desk"];

/** Immutably replace one cabinet's fields, leaving the rest untouched. */
function replace(cabs: Cabinet[], id: string, patch: Partial<Cabinet>): Cabinet[] {
  return cabs.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/**
 * The open-box invariants a desk/opening front requires: it stands on the floor
 * (no toe kick) with no shelves, and a desk always keeps at least one drawer.
 * Applied on both creation and front-style changes so a fresh open-box cabinet
 * is correct from the start (not just flagged by the audit afterward).
 */
function frontStyleInvariants(c: Cabinet): Partial<Cabinet> {
  if (c.frontStyle === "desk") return { toeKick: false, shelves: 0, drawerCount: Math.max(1, c.drawerCount) };
  if (c.frontStyle === "opening") return { toeKick: false, shelves: 0 };
  return {};
}

/** The next auto-name for a new cabinet of `type` ("B3", "W2", "T1", …). */
export function nextName(cabs: Cabinet[], type: CabinetType): string {
  const prefix = type === "wall" ? "W" : type === "tall" ? "T" : "B";
  return prefix + (cabs.filter((c) => c.type === type).length + 1);
}

/**
 * Make `name` unique against the existing cabinets (append -2, -3, …). Names are
 * how a person / agent addresses a cabinet, so a collision would silently target
 * the wrong box; auto-names can collide after a remove, and callers may reuse one.
 */
export function uniqueName(cabs: Cabinet[], name: string): string {
  const taken = new Set(cabs.map((c) => c.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has(`${name}-${n}`.toLowerCase())) n++;
  return `${name}-${n}`;
}

/** Build a brand-new cabinet of `type` with a fresh id + unique auto name. */
export function makeNewCabinet(cabs: Cabinet[], type: CabinetType): Cabinet {
  return { id: nextId(), name: uniqueName(cabs, nextName(cabs, type)), ...defaultCabinet(type) };
}

/* ------------------------------------------------------------------ */
/* Cabinet-list operations                                             */
/* ------------------------------------------------------------------ */

/**
 * Append a new cabinet. `over` lets a caller (e.g. the MCP) seed dimensions or
 * a front style at creation time; when it touches a budget-affecting field and
 * doesn't supply explicit `drawerHeights`, the heights are re-derived so the
 * new box is internally consistent from the first frame.
 */
export function addCabinet(
  cabs: Cabinet[],
  settings: Settings,
  type: CabinetType,
  over: Partial<Cabinet> = {},
): { cabinets: Cabinet[]; cabinet: Cabinet } {
  // New cabinets take the project's default construction (the documented purpose
  // of settings.construction) unless the caller overrides it.
  const construction = over.construction ?? settings.construction ?? "frameless";
  let cab: Cabinet = { ...makeNewCabinet(cabs, type), ...over, construction };
  if (over.name) cab.name = uniqueName(cabs, over.name);
  // A seeded desk/opening must obey its open-box invariants immediately.
  cab = { ...cab, ...frontStyleInvariants(cab) };
  const customized = Object.keys(over).length > 0 || construction !== "frameless";
  if (customized && over.drawerHeights == null) {
    cab.drawerHeights = defaultHeights(cab, settings);
  }
  return { cabinets: [...cabs, cab], cabinet: cab };
}

/** Raw field patch — no budget recompute (matches the editor's direct edits). */
export function patchCabinet(cabs: Cabinet[], id: string, patch: Partial<Cabinet>): Cabinet[] {
  return replace(cabs, id, patch);
}

export function removeCabinet(cabs: Cabinet[], id: string): Cabinet[] {
  return cabs.filter((c) => c.id !== id);
}

/**
 * Move a cabinet to a new position in the list. Order is meaningful — runs are
 * derived by walking the list left-to-right — so this is how you re-sequence a
 * layout (insert a box mid-run, group two cabinets so they share a frame). The
 * target index is clamped into range; a missing id is a no-op.
 */
export function moveCabinet(cabs: Cabinet[], id: string, toIndex: number): Cabinet[] {
  const from = cabs.findIndex((c) => c.id === id);
  if (from < 0) return cabs;
  const arr = cabs.slice();
  const [c] = arr.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, arr.length));
  arr.splice(clamped, 0, c);
  return arr;
}

/** Duplicate a cabinet, inserting the copy right after it with a fresh id/name. */
export function duplicateCabinet(
  cabs: Cabinet[],
  id: string,
): { cabinets: Cabinet[]; cabinet: Cabinet | null } {
  const src = cabs.find((c) => c.id === id);
  if (!src) return { cabinets: cabs, cabinet: null };
  const copy: Cabinet = { ...src, id: nextId(), name: uniqueName(cabs, nextName(cabs, src.type)) };
  const i = cabs.findIndex((c) => c.id === id);
  const arr = cabs.slice();
  arr.splice(i + 1, 0, copy);
  return { cabinets: arr, cabinet: copy };
}

/** Change the cabinet type, clamping fronts/dims that no longer make sense. */
export function setCabinetType(cabs: Cabinet[], id: string, type: CabinetType): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  const patch: Partial<Cabinet> = { type };
  if (type !== "base" && BASE_ONLY_FRONTS.includes(sel.frontStyle)) patch.frontStyle = "doors";
  if (type === "wall" && sel.depth >= 18) patch.depth = 12;
  if (type === "tall" && sel.height < 60) patch.height = 84;
  return replace(cabs, id, patch);
}

/** Change the front style; desk/opening force their open-box invariants. */
export function setFrontStyle(
  cabs: Cabinet[],
  settings: Settings,
  id: string,
  style: FrontStyle,
): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  const patch: Partial<Cabinet> = {
    frontStyle: style,
    ...frontStyleInvariants({ ...sel, frontStyle: style }),
  };
  const tmp = { ...sel, ...patch };
  patch.drawerHeights = defaultHeights(tmp, settings);
  return replace(cabs, id, patch);
}

/** Change front fit (overlay); the stack budget moves, so reset heights. */
export function setOverlay(
  cabs: Cabinet[],
  settings: Settings,
  id: string,
  overlay: Overlay,
): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  const tmp = { ...sel, overlay };
  return replace(cabs, id, { overlay, drawerHeights: defaultHeights(tmp, settings) });
}

/** Change construction (frameless/framed); reset heights (budget moves). */
export function setConstruction(
  cabs: Cabinet[],
  settings: Settings,
  id: string,
  construction: Construction,
): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  const tmp = { ...sel, construction };
  return replace(cabs, id, { construction, drawerHeights: defaultHeights(tmp, settings) });
}

/** Change the drawer count and re-split the stack evenly. */
export function setDrawerCount(
  cabs: Cabinet[],
  settings: Settings,
  id: string,
  n: number,
): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  return replace(cabs, id, { drawerCount: n, drawerHeights: evenHeights(sel, n, settings) });
}

/** Reset a cabinet's drawer heights to the default split for its geometry. */
export function resetDrawerHeights(cabs: Cabinet[], settings: Settings, id: string): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  return replace(cabs, id, { drawerHeights: defaultHeights(sel, settings) });
}

/** Set one drawer's front height, clamped so the stack can't overflow. */
export function setDrawerHeightAt(
  cabs: Cabinet[],
  settings: Settings,
  id: string,
  i: number,
  value: number,
): Cabinet[] {
  const sel = cabs.find((c) => c.id === id);
  if (!sel) return cabs;
  return replace(cabs, id, { drawerHeights: withDrawerHeight(sel, settings, i, value) });
}

/** Toggle the per-cabinet run break (corner / appliance gap / island). */
export function setRunBreak(cabs: Cabinet[], id: string, on: boolean): Cabinet[] {
  return replace(cabs, id, on ? { runBreak: true } : { runBreak: undefined });
}

/** Apply one construction mode to every cabinet, re-deriving each budget. */
export function setConstructionAll(
  cabs: Cabinet[],
  settings: Settings,
  mode: Construction,
): Cabinet[] {
  return cabs.map((c) => {
    const next = { ...c, construction: mode };
    return { ...next, drawerHeights: defaultHeights(next, settings) };
  });
}

/** Apply one overlay/front-fit mode to every cabinet, re-deriving each budget. */
export function setOverlayAll(cabs: Cabinet[], settings: Settings, mode: Overlay): Cabinet[] {
  return cabs.map((c) => {
    const next = { ...c, overlay: mode };
    return { ...next, drawerHeights: defaultHeights(next, settings) };
  });
}

/* ------------------------------------------------------------------ */
/* Settings operations                                                 */
/* ------------------------------------------------------------------ */

export function updateSettings(s: Settings, patch: Partial<Settings>): Settings {
  return { ...s, ...patch };
}

export function updateStock(s: Settings, id: StockId, patch: Partial<Stock>): Settings {
  return { ...s, stocks: { ...s.stocks, [id]: { ...s.stocks[id], ...patch } } };
}

export function setRoleStock(s: Settings, role: Role, stockId: StockId): Settings {
  return { ...s, roleStock: { ...s.roleStock, [role]: stockId } };
}

export function updateHardware(s: Settings, patch: Partial<HardwarePricing>): Settings {
  return { ...s, hardware: { ...s.hardware, ...patch } };
}
