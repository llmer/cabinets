import {
  Cabinet,
  CabinetType,
  Project,
  Role,
  SCHEMA_VERSION,
  Settings,
  Stock,
  StockId,
} from "./types";

/* ------------------------------------------------------------------ */
/* Physical stocks                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_STOCKS: Record<StockId, Stock> = {
  ply34: {
    id: "ply34",
    label: '3/4" plywood',
    kind: "sheet",
    thickness: 0.75,
    sheetW: 96,
    sheetH: 48,
    costPerSheet: 55,
    costPerFoot: 0,
  },
  ply12: {
    id: "ply12",
    label: '1/2" plywood',
    kind: "sheet",
    thickness: 0.5,
    sheetW: 96,
    sheetH: 48,
    costPerSheet: 45,
    costPerFoot: 0,
  },
  ply14: {
    id: "ply14",
    label: '1/4" plywood',
    kind: "sheet",
    thickness: 0.25,
    sheetW: 96,
    sheetH: 48,
    costPerSheet: 32,
    costPerFoot: 0,
  },
  hardwood: {
    id: "hardwood",
    label: '3/4" hardwood (1×)',
    kind: "linear",
    thickness: 0.75,
    sheetW: 0,
    sheetH: 0,
    costPerSheet: 0,
    costPerFoot: 3.25,
  },
};

/**
 * Default role → stock mapping.
 *
 * Carcass, back and fronts all default to 3/4" plywood — this reproduces the
 * imported design's math exactly (applied 3/4" back nested with the box parts).
 * Drawer boxes and bottoms use thinner plywood; face frames are solid hardwood.
 * Any of these can be re-pointed in Settings (e.g. back → 1/4").
 */
export const DEFAULT_ROLE_STOCK: Record<Role, StockId> = {
  carcass: "ply34",
  back: "ply34",
  front: "ply34",
  drawerBox: "ply12",
  drawerBottom: "ply14",
  faceFrame: "hardwood",
  // Toe-kick base ladder + fascia: 3/4" ply, so it nests into sheets and is
  // priced per sheet (not the by-the-foot hardwood line).
  base: "ply34",
};

export const DEFAULT_SETTINGS: Settings = {
  units: "in",
  reveal: 0.125,
  toeKick: 4.5,
  toeKickDepth: 3,
  toeKickSideRecess: 2,
  continuousFaceFrame: true,
  separateBase: true,
  faceFrameFloorGap: 3.25,
  upperBottom: 54,
  counterH: 36,
  kerf: 0.125,
  allowRotate: true,
  frameWidth: 1.5,
  faceFrameTop: 2,
  construction: "frameless",
  includeDrawerBoxes: true,
  showGuideLines: true,
  edgeBandPerFoot: 0.35,
  stocks: DEFAULT_STOCKS,
  roleStock: DEFAULT_ROLE_STOCK,
  hardware: {
    hingeEach: 4.0,
    slidePairEach: 14.0,
    pullEach: 3.5,
    shelfPinEach: 0.15,
    countPulls: true,
  },
};

/* ------------------------------------------------------------------ */
/* Per-type cabinet defaults                                           */
/* ------------------------------------------------------------------ */

export function defaultCabinet(type: CabinetType): Omit<Cabinet, "id" | "name"> {
  if (type === "wall") {
    return {
      type,
      width: 24,
      height: 30,
      depth: 12,
      frontStyle: "doors",
      doorCount: 2,
      drawerCount: 3,
      shelves: 2,
      toeKick: false,
      construction: "frameless",
      overlay: "full",
    };
  }
  if (type === "tall") {
    return {
      type,
      width: 24,
      height: 84,
      depth: 24,
      frontStyle: "doors",
      doorCount: 2,
      drawerCount: 3,
      shelves: 4,
      toeKick: true,
      construction: "frameless",
      overlay: "full",
    };
  }
  return {
    type,
    width: 24,
    height: 34.5,
    depth: 24,
    frontStyle: "doors",
    doorCount: 2,
    drawerCount: 3,
    shelves: 1,
    toeKick: true,
    construction: "frameless",
    overlay: "full",
  };
}

let _uid = 0;
export function nextId(prefix = "c"): string {
  _uid += 1;
  return `${prefix}${Date.now().toString(36)}${_uid}`;
}

export function makeCabinet(
  type: CabinetType,
  name: string,
  over: Partial<Cabinet> = {},
): Cabinet {
  return { id: nextId(), name, ...defaultCabinet(type), ...over };
}

/** Seed run — matches the imported design's starting kitchen. */
export function seedCabinets(): Cabinet[] {
  return [
    makeCabinet("base", "B1", { width: 30, doorCount: 2, shelves: 1 }),
    makeCabinet("base", "B2", { width: 18, frontStyle: "drawers", drawerCount: 3 }),
    makeCabinet("base", "B3", { width: 33, doorCount: 2, shelves: 1 }),
    makeCabinet("tall", "T1", { width: 24, height: 84, shelves: 4 }),
    makeCabinet("wall", "W1", { width: 30, doorCount: 2, shelves: 2 }),
    makeCabinet("wall", "W2", { width: 18, doorCount: 1, shelves: 2 }),
  ];
}

export function newProject(name = "Untitled kitchen"): Project {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nextId("p"),
    name,
    createdAt: now,
    updatedAt: now,
    cabinets: seedCabinets(),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

export function emptyProject(name = "Untitled kitchen"): Project {
  const p = newProject(name);
  p.cabinets = [];
  return p;
}
