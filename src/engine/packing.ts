/**
 * Sheet nesting — shelf / first-fit-decreasing with optional 90° rotation,
 * accounting for saw kerf. Ported from the imported design's `packSheets` and
 * generalized so each physical stock is nested on its own sheet size.
 */

import { fmtLen } from "./units";

export interface PackRect {
  w: number;
  h: number;
  color: string;
  label: string;
  part: string;
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label: string;
  part: string;
}

interface Shelf {
  y: number;
  x: number;
  height: number;
  count: number;
}

/**
 * One piece a store rip cut produces — a full-length horizontal band of the
 * sheet. Parts inside it keep at least the trim allowance clear of every
 * store-cut (rough) edge; only factory sheet edges are trusted as-is.
 */
export interface SheetStrip {
  /** Where the piece starts across the sheet height (inches). */
  y: number;
  /** Height of the piece — what you ask the store to rip. */
  height: number;
  /** Leftover stock above the last parts strip; carries no parts. */
  offcut?: boolean;
}

export interface PackedSheet {
  placements: Placement[];
  /** Present when store-breakdown mode planned full-length rip cuts. */
  strips?: SheetStrip[];
}

/** Store-breakdown mode: rip each sheet into shelf-aligned strips at the store. */
export interface BreakdownOptions {
  /** Clean-up allowance kept between a part and each store-cut edge (inches). */
  trim: number;
}

/** Don't bother freeing an offcut narrower than this — absorb it into the last strip. */
const MIN_OFFCUT = 4;

export interface StockPack {
  stockId: string;
  label: string;
  sheetW: number;
  sheetH: number;
  sheets: PackedSheet[];
  oversize: PackRect[];
  /** Total area of placed parts (sq in). */
  usedArea: number;
  /** Area of one sheet (sq in). */
  sheetArea: number;
}

const EPS = 1e-6;

export function packStock(
  rects: PackRect[],
  sheetW: number,
  sheetH: number,
  kerf: number,
  rot: boolean,
  breakdown?: BreakdownOptions,
): { sheets: PackedSheet[]; oversize: PackRect[]; usedArea: number } {
  const items = rects.slice().sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const sheets: Array<PackedSheet & { shelves: Shelf[]; usedH: number }> = [];
  const oversize: PackRect[] = [];

  const orients = (it: PackRect): Array<[number, number]> =>
    rot && Math.abs(it.w - it.h) > EPS
      ? [
          [it.w, it.h],
          [it.h, it.w],
        ]
      : [[it.w, it.h]];

  const tryPlace = (
    s: PackedSheet & { shelves: Shelf[]; usedH: number },
    it: PackRect,
  ): boolean => {
    for (const sh of s.shelves) {
      for (const [w, h] of orients(it)) {
        const x = sh.x + (sh.count ? kerf : 0);
        if (h <= sh.height + EPS && x + w <= sheetW + EPS) {
          sh.x = x + w;
          sh.count++;
          s.placements.push({ x, y: sh.y, w, h, color: it.color, label: it.label, part: it.part });
          return true;
        }
      }
    }
    for (const [w, h] of orients(it)) {
      // Breakdown mode: a new shelf sits above the planned rip that frees the
      // shelf below — trim above those parts, the store blade's kerf, then
      // trim again so no part keeps the rough store-cut edge as its own.
      const lead = breakdown ? kerf + 2 * breakdown.trim : kerf;
      const y = s.usedH + (s.shelves.length ? lead : 0);
      if (w <= sheetW + EPS && y + h <= sheetH + EPS) {
        s.shelves.push({ y, x: w, height: h, count: 1 });
        s.usedH = y + h;
        s.placements.push({ x: 0, y, w, h, color: it.color, label: it.label, part: it.part });
        return true;
      }
    }
    return false;
  };

  for (const it of items) {
    let placed = false;
    for (const s of sheets) {
      if (tryPlace(s, it)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      const fits =
        (it.w <= sheetW + EPS && it.h <= sheetH + EPS) ||
        (rot && it.h <= sheetW + EPS && it.w <= sheetH + EPS);
      if (!fits) {
        oversize.push(it);
        continue;
      }
      const s = { placements: [], shelves: [], usedH: 0 };
      sheets.push(s);
      tryPlace(s, it);
    }
  }

  const usedArea = sheets.reduce(
    (a, s) => a + s.placements.reduce((b, p) => b + p.w * p.h, 0),
    0,
  );

  // Turn each sheet's shelves into the store rip plan: one full-length strip
  // per shelf, the rip line sitting `trim` above the shelf's tallest part.
  // The rip above the topmost shelf only happens when it frees an offcut
  // worth keeping; otherwise that strip runs to the factory edge.
  const stripsFor = (shelves: Shelf[]): SheetStrip[] => {
    const trim = breakdown!.trim;
    const strips: SheetStrip[] = [];
    let start = 0;
    shelves.forEach((sh, i) => {
      const cut = sh.y + sh.height + trim;
      if (i < shelves.length - 1) {
        strips.push({ y: start, height: cut - start });
        start = cut + kerf;
      } else if (cut + kerf + MIN_OFFCUT <= sheetH + EPS) {
        strips.push({ y: start, height: cut - start });
        strips.push({ y: cut + kerf, height: sheetH - cut - kerf, offcut: true });
      } else {
        strips.push({ y: start, height: sheetH - start });
      }
    });
    return strips;
  };

  return {
    sheets: sheets.map((s) =>
      breakdown
        ? { placements: s.placements, strips: stripsFor(s.shelves) }
        : { placements: s.placements },
    ),
    oversize,
    usedArea,
  };
}

/**
 * The instruction line for one sheet's rip plan — what to ask the store for,
 * in cutting order, each width measured from the freshly cut edge. Shared by
 * the sheets view and the MCP formatter so the two never drift. The LAST
 * strip's height is what remains after the final rip, not a rip to request.
 */
export function ripPlanText(strips: SheetStrip[], units: "in" | "mm"): string {
  const cuts = strips.length - 1;
  if (cuts < 1) return "no rips — carry as-is";
  const widths = strips
    .slice(0, cuts)
    .map((st) => fmtLen(st.height, units))
    .join(" → ");
  const last = strips[cuts];
  return `rips ${widths} · leaves ${fmtLen(last.height, units)}${last.offcut ? " offcut" : ""}`;
}

/* ------------------------------------------------------------------ */
/* Linear (1D) nesting — hardwood boards cut to length                 */
/* ------------------------------------------------------------------ */

/** One part to cut from a board (a length, tagged like a PackRect). */
export interface LinearItem {
  length: number;
  color: string;
  label: string;
  part: string;
}

/** A part placed on a board at a start offset. */
export interface LinearCut extends LinearItem {
  /** Start position along the board (inches). */
  offset: number;
}

/** One physical board with its cuts laid out end to end (kerf between). */
export interface LinearBoard {
  cuts: LinearCut[];
  /** End of the last cut — board length minus this is the drop/waste. */
  used: number;
}

export interface LinearPack {
  stockId: string;
  label: string;
  /** Cross-section of this run of boards — one pack per distinct profile. */
  thickness: number;
  width: number;
  /** Standard stock length one board is cut from (inches). */
  boardLength: number;
  boards: LinearBoard[];
  /** Parts longer than a whole board — can't be cut from one. */
  oversize: LinearItem[];
  /** Total length of placed parts (inches), excluding kerf + drops. */
  usedLength: number;
}

/**
 * First-fit-decreasing 1D bin packing: lay each linear part onto the first
 * board with room, else start a new board. A saw kerf is consumed between
 * adjacent cuts on a board. Parts longer than a board are reported oversize.
 * Mirrors `packStock` for sheet goods, one dimension down.
 */
export function packLinear(
  items: LinearItem[],
  boardLength: number,
  kerf: number,
): { boards: LinearBoard[]; oversize: LinearItem[]; usedLength: number } {
  const sorted = items.slice().sort((a, b) => b.length - a.length);
  const boards: LinearBoard[] = [];
  const oversize: LinearItem[] = [];

  for (const it of sorted) {
    if (it.length > boardLength + EPS) {
      oversize.push(it);
      continue;
    }
    let placed = false;
    for (const b of boards) {
      const lead = b.cuts.length ? kerf : 0;
      if (b.used + lead + it.length <= boardLength + EPS) {
        const offset = b.used + lead;
        b.cuts.push({ ...it, offset });
        b.used = offset + it.length;
        placed = true;
        break;
      }
    }
    if (!placed) boards.push({ cuts: [{ ...it, offset: 0 }], used: it.length });
  }

  const usedLength = boards.reduce(
    (a, b) => a + b.cuts.reduce((c, x) => c + x.length, 0),
    0,
  );
  return { boards, oversize, usedLength };
}
