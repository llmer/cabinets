import { Cabinet, CabinetParts, Part, Settings } from "@/domain/types";
import { colorFor } from "@/theme";
import { CostBreakdown, buildCost } from "./cost";
import {
  HardwareCounts,
  ZERO_COUNTS,
  addCounts,
  countHardware,
  hardwareCost,
} from "./hardware";
import { typeLabel } from "./labels";
import {
  BoardItem,
  BoardPack,
  LinearItem,
  LinearPack,
  PackRect,
  StockPack,
  packBoards,
  packLinear,
  packStock,
} from "./packing";
import { FrameContext, bandingInchesPerPiece, genParts, mergeParts } from "./parts";
import {
  PocketSpec,
  ScrewTotal,
  frameJointEnds,
  frameJointsFor,
  pocketScrewTotals,
  pocketSpec,
} from "./pocketHoles";
import { Run, bayFrameContext, runsOf } from "./runs";
import { RunFrameJoints, genBaseParts, genRunFrameParts } from "./runParts";
import { StepGroup, genRunSteps, genSteps, runGroupLabel } from "./steps";
import { fmtLen } from "./units";

export interface CutPart {
  name: string;
  qty: number;
  qtyStr: string;
  lenStr: string;
  widStr: string;
  matTag: string;
  edgeStr: string;
  part: Part;
}

export interface CutGroup {
  id: string;
  name: string;
  typeLabel: string;
  color: string;
  dims: string;
  parts: CutPart[];
}

export interface Summary {
  count: number;
  baseRun: string;
  wallRun: string;
  baseRunRaw: number;
  wallRunRaw: number;
  sheetCount: number;
  /** Total store panel-saw rips planned across all sheets (0 when off). */
  storeCuts: number;
  yieldPct: number;
  yieldStr: string;
  pieces: number;
  totalAreaSqft: number;
  totalArea: string;
  bandLF: number;
  doors: number;
  drawers: number;
  hinges: number;
  slides: number;
  pulls: number;
  shelfPins: number;
  cost: string;
  costRaw: number;
  oversize: number;
  /** Linear parts that fit the boards on hand but ran out of them. */
  boardShort: number;
  framed: boolean;
  frameLF: number;
}

export interface Legend {
  id: string;
  name: string;
  color: string;
}

/** The project's pocket-hole demand, present when settings.pocketHoles is on. */
export interface PocketPlan {
  /** Merged screw demand — sheet-part pockets + every frame's actual joints. */
  totals: ScrewTotal[];
  /** Per frame (id = its run/cabinet cut group): joint counts + screws. */
  frames: Array<{ id: string; joints: RunFrameJoints; screws: number; spec: PocketSpec }>;
}

export interface Model {
  cabinetParts: CabinetParts[];
  cutGroups: CutGroup[];
  stepGroups: StepGroup[];
  packs: StockPack[];
  /** Linear (1D) cut layout for each hardwood/linear stock bought by profile. */
  linearPacks: LinearPack[];
  /** Rip-aware cut layout for each linear stock with actual boards on hand. */
  boardPacks: BoardPack[];
  /** Pocket-hole drill/screw plan — null unless settings.pocketHoles. */
  pocketPlan: PocketPlan | null;
  summary: Summary;
  cost: CostBreakdown;
  legend: Legend[];
}

function edgeStr(p: Part): string {
  if (p.bandAll) return "all 4 edges";
  if (p.bandFrontEdge > 0) return "front edge";
  return "—";
}

/** Name the synthetic run cut group by what it actually carries. */
function runGroupName(run: Run, s: Settings): string {
  const span = `${run.members[0].cabinet.name}–${run.members[run.members.length - 1].cabinet.name}`;
  const frame = s.continuousFaceFrame && run.framed;
  const base = s.separateBase && run.members.some((m) => m.hasBase);
  const what = frame && base ? "Face frame + base" : frame ? "Face frame" : "Toe-kick base";
  return `${what} · ${span}`;
}

/** Build the entire derived model from cabinets + settings. Pure. */
export function compute(cabinets: Cabinet[], s: Settings): Model {
  const u = s.units;
  const cabinetParts: CabinetParts[] = [];
  const cutGroups: CutGroup[] = [];
  const stepGroups: StepGroup[] = [];
  const legend: Legend[] = [];

  // rects grouped by sheet-stock id for nesting
  const rectsByStock = new Map<string, PackRect[]>();

  let pieces = 0;
  let bandLFInches = 0;
  let frameLFInches = 0;
  let counts: HardwareCounts = { ...ZERO_COUNTS };
  const areaByStock = new Map<string, number>();
  // Linear parts (hardwood face frame) per stock, each carrying its profile
  // width. Laid out later either on the boards actually on hand (rip plan) or
  // per width on standard boards (buy-by-profile).
  const linearByStock = new Map<string, BoardItem[]>();

  /**
   * Funnel one part into every accumulator (piece count, banding, hardwood feet,
   * sheet nesting, cut-list row). Shared by the per-cabinet pass and the
   * run-level pass so a run frame / base nests + costs exactly like box parts.
   */
  const ingestPart = (p: Part, color: string, label: string): CutPart => {
    pieces += p.qty;
    bandLFInches += p.qty * bandingInchesPerPiece(p);
    if (p.linear) {
      frameLFInches += p.qty * p.length;
      const arr = linearByStock.get(p.stockId) || [];
      for (let i = 0; i < p.qty; i++) {
        arr.push({ length: p.length, width: p.width, color, label, part: p.name });
      }
      linearByStock.set(p.stockId, arr);
    } else {
      areaByStock.set(
        p.stockId,
        (areaByStock.get(p.stockId) || 0) + p.qty * p.length * p.width,
      );
      const arr = rectsByStock.get(p.stockId) || [];
      for (let i = 0; i < p.qty; i++) {
        arr.push({ w: p.length, h: p.width, color, label, part: p.name });
      }
      rectsByStock.set(p.stockId, arr);
    }
    const tag = p.linear
      ? "hardwood"
      : p.stockId !== s.roleStock.carcass
        ? s.stocks[p.stockId].label
        : "";
    return {
      name: p.name,
      qty: p.qty,
      qtyStr: "×" + p.qty,
      lenStr: fmtLen(p.length, u),
      widStr: fmtLen(p.width, u),
      matTag: tag,
      edgeStr: edgeStr(p),
      part: p,
    };
  };

  // Derive the runs once. When a continuous frame is on, each framed bay hands
  // its face frame to the run pass and picks up its wider run opening.
  const runs = runsOf(cabinets, s);
  // A bay is "run-owned" when it sits in a multi-cabinet continuous framed run:
  // its box is built individually, but the join, the shared toe-kick base, the
  // ONE face frame and the inset fronts are all fitted at the run level.
  const runOf = new Map<string, Run>();
  for (const run of runs) for (const m of run.members) runOf.set(m.cabinet.id, run);
  const runOwned = (id: string): boolean => {
    const r = runOf.get(id);
    return !!r && s.continuousFaceFrame && r.framed && r.members.length > 1;
  };
  const frameCtx = new Map<string, FrameContext>();
  if (s.continuousFaceFrame) {
    for (const run of runs) {
      if (!run.framed) continue;
      const ms = run.members;
      // A joint shares ONE partition (the left bay owns it, the right bay drops
      // its side) only where the two bays line up — see membersSharePartition.
      ms.forEach((m, i) => frameCtx.set(m.cabinet.id, bayFrameContext(run, i, s)));
    }
  }

  cabinets.forEach((c, idx) => {
    const cp = genParts(c, s, frameCtx.get(c.id));
    cabinetParts.push(cp);
    const color = colorFor(idx);
    legend.push({ id: c.id, name: c.name, color });

    const cutParts: CutPart[] = cp.parts.map((p) => ingestPart(p, color, c.name));

    counts = addCounts(counts, countHardware(cp.parts, s.hardware));

    cutGroups.push({
      id: c.id,
      name: c.name,
      typeLabel: typeLabel(c.type),
      color,
      dims: `${fmtLen(c.width, u)} w × ${fmtLen(c.height, u)} h × ${fmtLen(c.depth, u)} d`,
      parts: cutParts,
    });
    // A run-owned bay gets its run group's label so its walkthrough can close
    // with a pointer to where the base/frame/fronts continue.
    const label = runOwned(c.id)
      ? runGroupLabel(runOf.get(c.id)!.members.map((m) => m.cabinet.name))
      : undefined;
    stepGroups.push(genSteps(cp, s, color, label));
  });

  // Run-level build steps: after the per-cabinet BOX groups above, one "assemble
  // the run + fit the ONE face frame + base" group per multi-cabinet continuous
  // framed run — mirroring the run cut group. Its 3D renders the whole run.
  runs.forEach((run, ri) => {
    if (!runOwned(run.members[0].cabinet.id)) return;
    const memberCPs = run.members.flatMap((m) => {
      const cp = cabinetParts.find((x) => x.cabinet.id === m.cabinet.id);
      return cp ? [cp] : [];
    });
    if (memberCPs.length) stepGroups.push(genRunSteps(run, memberCPs, s, colorFor(cabinets.length + ri)));
  });

  // Run-level pass: the continuous face frame and the separate toe-kick base —
  // parts that span a run, not a box — each as one synthetic cut group.
  runs.forEach((run, ri) => {
    const runParts: Part[] = [];
    if (s.continuousFaceFrame && run.framed) runParts.push(...genRunFrameParts(run, s));
    if (s.separateBase) runParts.push(...genBaseParts(run, s));
    if (!runParts.length) return;
    const color = colorFor(cabinets.length + ri);
    const name = runGroupName(run, s);
    const parts = mergeParts(runParts).map((p) => ingestPart(p, color, name));
    cutGroups.push({
      id: run.id,
      name,
      typeLabel: "Run",
      color,
      dims: `${fmtLen(run.x1 - run.x0, u)} run · ${run.members.length} ${run.members.length === 1 ? "bay" : "bays"}`,
      parts,
    });
    legend.push({ id: run.id, name, color });
  });

  // Nest each sheet stock independently.
  const packs: StockPack[] = [];
  let sheetCount = 0;
  let totalUsedArea = 0;
  let totalSheetCapacity = 0;
  let oversize = 0;
  // Stable order: by thickness desc so 3/4 shows first.
  const stockIds = [...rectsByStock.keys()].sort(
    (a, b) => s.stocks[b].thickness - s.stocks[a].thickness,
  );
  let storeCuts = 0;
  let boardShort = 0;
  for (const stockId of stockIds) {
    const stock = s.stocks[stockId];
    const rects = rectsByStock.get(stockId)!;
    const result = packStock(
      rects,
      stock.sheetW,
      stock.sheetH,
      s.kerf,
      s.allowRotate,
      s.storeBreakdown ? { trim: s.storeTrim } : undefined,
    );
    const sheetArea = stock.sheetW * stock.sheetH;
    packs.push({
      stockId,
      label: stock.label,
      sheetW: stock.sheetW,
      sheetH: stock.sheetH,
      sheets: result.sheets,
      oversize: result.oversize,
      usedArea: result.usedArea,
      sheetArea,
    });
    sheetCount += result.sheets.length;
    totalUsedArea += result.usedArea;
    totalSheetCapacity += result.sheets.length * sheetArea;
    oversize += result.oversize.length;
    // n strips = n-1 rips between them, +1 when the last rip frees an offcut —
    // which is exactly strips.length - 1 either way.
    for (const sh of result.sheets) if (sh.strips) storeCuts += sh.strips.length - 1;
  }

  // Lay the linear stock out — the face-frame cut plan. A stock with actual
  // boards on hand gets the rip-aware plan (crosscut → rip → crosscut, with
  // shortfall when the boards run out). Otherwise each cross-section width is
  // packed onto standard boards (stock.stockLength, default 8 ft) so you know
  // how much of each profile to buy.
  const linearPacks: LinearPack[] = [];
  const boardPacks: BoardPack[] = [];
  const stocksWithLinear = [...linearByStock.keys()].sort((a, b) => a.localeCompare(b));
  for (const stockId of stocksWithLinear) {
    const stock = s.stocks[stockId];
    const items = linearByStock.get(stockId)!;
    if (stock.boards && stock.boards.length > 0) {
      const result = packBoards(items, stock.boards, s.kerf);
      boardPacks.push({
        stockId,
        label: stock.label,
        thickness: stock.thickness,
        specs: stock.boards.map((b) => ({ ...b })),
        boards: result.boards,
        oversize: result.oversize,
        shortfall: result.shortfall,
        usedLength: result.usedLength,
      });
      oversize += result.oversize.length;
      boardShort += result.shortfall.length;
      continue;
    }
    const widths = [...new Set(items.map((it) => it.width))].sort((a, b) => a - b);
    for (const width of widths) {
      const group: LinearItem[] = items
        .filter((it) => it.width === width)
        .map(({ length, color, label, part }) => ({ length, color, label, part }));
      const boardLength = stock.stockLength || 96;
      const result = packLinear(group, boardLength, s.kerf);
      linearPacks.push({
        stockId,
        label: stock.label,
        thickness: stock.thickness,
        width,
        boardLength,
        boards: result.boards,
        oversize: result.oversize,
        usedLength: result.usedLength,
      });
      oversize += result.oversize.length;
    }
  }

  // Pocket-hole plan: sheet-part pockets by name + every frame's actual
  // joints, with the screw demand merged into one shopping-ready total.
  let pocketPlan: PocketPlan | null = null;
  if (s.pocketHoles) {
    const allParts = cutGroups.flatMap((g) => g.parts.map((p) => p.part));
    const totals = pocketScrewTotals(allParts, s);
    const ffSpec = pocketSpec(s.stocks[s.roleStock.faceFrame]);
    const frames = ffSpec
      ? frameJointsFor(cabinets, s).map((f) => ({
          ...f,
          screws: 2 * frameJointEnds(f.joints),
          spec: ffSpec,
        }))
      : [];
    const frameCount = frames.reduce((a, f) => a + f.screws, 0);
    if (frameCount > 0 && ffSpec) {
      const same = totals.find(
        (t) =>
          t.spec.setting === ffSpec.setting &&
          t.spec.screwLength === ffSpec.screwLength &&
          t.spec.thread === ffSpec.thread,
      );
      if (same) same.count += frameCount;
      else totals.push({ spec: ffSpec, count: frameCount });
      totals.sort((a, b) => b.count - a.count);
    }
    pocketPlan = { totals, frames };
  }

  const totalArea = [...areaByStock.values()].reduce((a, x) => a + x, 0);
  const yieldPct = totalSheetCapacity
    ? Math.round((totalUsedArea / totalSheetCapacity) * 100)
    : 0;

  const baseRunRaw = cabinets.filter((c) => c.type !== "wall").reduce((a, c) => a + c.width, 0);
  const wallRunRaw = cabinets.filter((c) => c.type === "wall").reduce((a, c) => a + c.width, 0);

  const cost = buildCost(packs, frameLFInches, bandLFInches, counts, s);

  const summary: Summary = {
    count: cabinets.length,
    baseRun: fmtLen(baseRunRaw, u),
    wallRun: fmtLen(wallRunRaw, u),
    baseRunRaw,
    wallRunRaw,
    sheetCount,
    storeCuts,
    yieldPct,
    yieldStr: yieldPct + "%",
    pieces,
    totalAreaSqft: +(totalArea / 144).toFixed(1),
    totalArea: (totalArea / 144).toFixed(1),
    bandLF: Math.ceil(bandLFInches / 12),
    doors: counts.doors,
    drawers: counts.drawers,
    hinges: counts.hinges,
    slides: counts.slides,
    pulls: counts.pulls,
    shelfPins: counts.shelfPins,
    cost: "$" + Math.round(cost.total),
    costRaw: cost.total,
    oversize,
    boardShort,
    framed: frameLFInches > 0,
    frameLF: Math.ceil(frameLFInches / 12),
  };

  return { cabinetParts, cutGroups, stepGroups, packs, linearPacks, boardPacks, pocketPlan, summary, cost, legend };
}

/** Hardware cost alone (handy for tests / summaries). */
export function hardwareTotal(cabinets: Cabinet[], s: Settings): number {
  let counts: HardwareCounts = { ...ZERO_COUNTS };
  for (const c of cabinets) {
    counts = addCounts(counts, countHardware(genParts(c, s).parts, s.hardware));
  }
  return hardwareCost(counts, s.hardware);
}
