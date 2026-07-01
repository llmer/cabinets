/**
 * Sheet nesting — shelf / first-fit-decreasing with optional 90° rotation,
 * accounting for saw kerf. Ported from the imported design's `packSheets` and
 * generalized so each physical stock is nested on its own sheet size.
 */

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

export interface PackedSheet {
  placements: Placement[];
}

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
      const y = s.usedH + (s.shelves.length ? kerf : 0);
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

  return {
    sheets: sheets.map((s) => ({ placements: s.placements })),
    oversize,
    usedArea,
  };
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
