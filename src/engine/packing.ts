/**
 * Sheet nesting — shelf / first-fit-decreasing with optional 90° rotation,
 * accounting for saw kerf. Ported from the imported design's `packSheets` and
 * generalized so each physical stock is nested on its own sheet size.
 */

import { fmtLen, r3 } from "./units";

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

/* ------------------------------------------------------------------ */
/* Board plan — rip the parts out of the boards you actually have      */
/* ------------------------------------------------------------------ */

/** One size of board on hand (mirrors the domain's LinearBoardSpec). */
export interface BoardSpec {
  width: number;
  length: number;
  qty: number;
}

/** A linear part that knows the profile width it must be ripped to. */
export interface BoardItem extends LinearItem {
  width: number;
}

/** One rip strip within a segment; cut offsets run from the segment start. */
export interface BoardStrip {
  cuts: LinearCut[];
  used: number;
}

/**
 * A crosscut section of a board, ripped into parallel strips of ONE profile
 * width. The strip count never exceeds what the board's width yields:
 * floor((boardW + kerf) / (ripWidth + kerf)).
 */
export interface BoardSegment {
  /** Where the section starts along the board (inches). */
  offset: number;
  length: number;
  ripWidth: number;
  strips: BoardStrip[];
}

/** One physical board with its planned crosscut/rip segments. */
export interface PlannedBoard {
  width: number;
  length: number;
  segments: BoardSegment[];
  /** Length consumed off the board so far (crosscut kerfs included). */
  used: number;
}

export interface BoardPack {
  stockId: string;
  label: string;
  thickness: number;
  /** The boards on hand, as declared on the stock. */
  specs: BoardSpec[];
  /** Physical boards the plan actually uses. */
  boards: PlannedBoard[];
  /** Parts no board size can produce (too wide or too long). */
  oversize: BoardItem[];
  /** Parts that fit a board size but ran out of boards. */
  shortfall: BoardItem[];
  /** Total length of placed parts (inches), excluding kerfs + drops. */
  usedLength: number;
}

/**
 * Plan the linear parts onto the specific boards on hand: crosscut a segment
 * off a board, rip it into strips of one profile width, crosscut the parts
 * from the strips. Greedy, widest profile first — wide parts have the fewest
 * homes, so they claim board cross-section before narrow parts fill the rest.
 * Boards are chosen narrowest-adequate-first so a wide board isn't burned on
 * a part a narrow board could carry.
 */
export function packBoards(
  items: BoardItem[],
  specs: BoardSpec[],
  kerf: number,
): {
  boards: PlannedBoard[];
  oversize: BoardItem[];
  shortfall: BoardItem[];
  usedLength: number;
} {
  const oversize: BoardItem[] = [];
  const usable: BoardItem[] = [];
  const fitsSomeSpec = (it: BoardItem) =>
    specs.some((sp) => sp.width + EPS >= it.width && sp.length + EPS >= it.length);
  for (const it of items) (fitsSomeSpec(it) ? usable : oversize).push(it);

  const widths = [...new Set(usable.map((it) => it.width))].sort((a, b) => b - a);
  const pool = specs.map((sp) => ({ ...sp }));
  const boards: PlannedBoard[] = [];
  const shortfall: BoardItem[] = [];

  for (const w of widths) {
    const queue = usable.filter((it) => it.width === w).sort((a, b) => b.length - a.length);
    while (queue.length) {
      const it = queue[0];

      // Crosscut a new segment: pick the narrowest board that can carry the
      // longest waiting part — opened boards before fresh ones, tightest
      // remaining length first.
      type Cand = {
        board?: PlannedBoard;
        spec?: (typeof pool)[number];
        width: number;
        avail: number;
      };
      const cands: Cand[] = [];
      for (const b of boards) {
        const avail = b.length - b.used - (b.used > 0 ? kerf : 0);
        if (b.width + EPS >= w && avail + EPS >= it.length)
          cands.push({ board: b, width: b.width, avail });
      }
      for (const sp of pool) {
        if (sp.qty > 0 && sp.width + EPS >= w && sp.length + EPS >= it.length)
          cands.push({ spec: sp, width: sp.width, avail: sp.length });
      }
      if (cands.length === 0) {
        shortfall.push(queue.shift()!);
        continue;
      }
      cands.sort(
        (a, b) =>
          a.width - b.width ||
          (a.board ? 0 : 1) - (b.board ? 0 : 1) ||
          a.avail - b.avail,
      );
      const chosen = cands[0];
      let board = chosen.board;
      if (!board) {
        chosen.spec!.qty -= 1;
        board = { width: chosen.spec!.width, length: chosen.spec!.length, segments: [], used: 0 };
        boards.push(board);
      }

      // Rip the segment into as many strips of this width as the board yields.
      const offset = board.used > 0 ? r3(board.used + kerf) : 0;
      const cap = r3(board.length - offset);
      const nStrips = Math.floor((board.width + kerf + EPS) / (w + kerf));

      // First-fit-decreasing the queue into up to nStrips strips no longer
      // than `limit`, without touching the queue itself.
      const ffdInto = (limit: number): { strips: BoardStrip[]; placedIdx: number[] } => {
        const strips: BoardStrip[] = [];
        const placedIdx: number[] = [];
        queue.forEach((q, qi) => {
          let strip = strips.find(
            (st) => st.used + (st.cuts.length ? kerf : 0) + q.length <= limit + EPS,
          );
          if (!strip && strips.length < nStrips && q.length <= limit + EPS) {
            strip = { cuts: [], used: 0 };
            strips.push(strip);
          }
          if (strip) {
            const at = r3(strip.used + (strip.cuts.length ? kerf : 0));
            strip.cuts.push({ ...q, offset: at });
            strip.used = r3(at + q.length);
            placedIdx.push(qi);
          }
        });
        return { strips, placedIdx };
      };
      const maxUsed = (strips: BoardStrip[]) => Math.max(...strips.map((st) => st.used));
      const lengthsKey = (idx: number[]) =>
        idx.map((i2) => queue[i2].length).sort((a, b) => a - b).join(",");

      // MULTIFIT refinement: the segment is one crosscut across the whole
      // board, so binary-search the SHORTEST segment that still carries the
      // very same parts — a plain greedy can burn board length here and
      // strand a later (narrower) profile.
      let best = ffdInto(cap);
      const wanted = lengthsKey(best.placedIdx);
      let lo = Math.max(...best.placedIdx.map((i2) => queue[i2].length));
      let hi = maxUsed(best.strips);
      for (let iter = 0; iter < 30 && hi - lo > 1e-4; iter++) {
        const mid = (lo + hi) / 2;
        const trial = ffdInto(mid);
        if (trial.placedIdx.length === best.placedIdx.length && lengthsKey(trial.placedIdx) === wanted) {
          best = trial;
          hi = maxUsed(trial.strips);
        } else {
          lo = mid;
        }
      }

      const strips = best.strips;
      for (const qi of [...best.placedIdx].sort((a, b) => b - a)) queue.splice(qi, 1);
      const segLen = r3(maxUsed(strips));
      board.segments.push({ offset, length: segLen, ripWidth: w, strips });
      board.used = r3(offset + segLen);
    }
  }

  const usedLength = boards.reduce(
    (a, b) =>
      a +
      b.segments.reduce(
        (c, seg) => c + seg.strips.reduce((d, st) => d + st.cuts.reduce((e, x) => e + x.length, 0), 0),
        0,
      ),
    0,
  );
  return { boards, oversize, shortfall, usedLength };
}
