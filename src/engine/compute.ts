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
import { LinearItem, LinearPack, PackRect, StockPack, packLinear, packStock } from "./packing";
import { FrameContext, bandingInchesPerPiece, genParts, mergeParts } from "./parts";
import { Run, membersSharePartition, runsOf } from "./runs";
import { genBaseParts, genRunFrameParts } from "./runParts";
import { StepGroup, genSteps } from "./steps";
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
  framed: boolean;
  frameLF: number;
}

export interface Legend {
  id: string;
  name: string;
  color: string;
}

export interface Model {
  cabinetParts: CabinetParts[];
  cutGroups: CutGroup[];
  stepGroups: StepGroup[];
  packs: StockPack[];
  /** Linear (1D) cut layout for each hardwood/linear stock. */
  linearPacks: LinearPack[];
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
  // Linear parts (hardwood face frame) grouped by stock + cross-section width, so
  // each board profile (3/4"×1 1/2", 3/4"×2", …) gets its own cut layout.
  const linearGroups = new Map<string, { stockId: string; width: number; items: LinearItem[] }>();

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
      const key = `${p.stockId}|${p.width}`;
      let g = linearGroups.get(key);
      if (!g) {
        g = { stockId: p.stockId, width: p.width, items: [] };
        linearGroups.set(key, g);
      }
      for (let i = 0; i < p.qty; i++) {
        g.items.push({ length: p.length, color, label, part: p.name });
      }
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
  const frameCtx = new Map<string, FrameContext>();
  if (s.continuousFaceFrame) {
    for (const run of runs) {
      if (!run.framed) continue;
      const ms = run.members;
      // A joint shares ONE partition (the left bay owns it, the right bay drops
      // its side) only where the two bays line up — see membersSharePartition.
      ms.forEach((m, i) =>
        frameCtx.set(m.cabinet.id, {
          emitFaceFrame: false,
          openingWidth: m.openingWidth,
          sideDrop: Math.max(0, m.yB - m.frameBottom),
          leftEnd: m.leftEnd,
          rightEnd: m.rightEnd,
          shareLeft: i > 0 && membersSharePartition(ms[i - 1], m, s),
          shareRight: i < ms.length - 1 && membersSharePartition(m, ms[i + 1], s),
        }),
      );
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
    stepGroups.push(genSteps(cp, s, color));
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
  for (const stockId of stockIds) {
    const stock = s.stocks[stockId];
    const rects = rectsByStock.get(stockId)!;
    const result = packStock(rects, stock.sheetW, stock.sheetH, s.kerf, s.allowRotate);
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
  }

  // Lay each linear profile out on standard boards — the face-frame cut plan,
  // one run of boards per cross-section so you know how much of each width to
  // buy. Board length comes from the stock (default 8 ft); a part longer than a
  // board is oversize, same as a sheet part that won't fit.
  const linearPacks: LinearPack[] = [];
  const groups = [...linearGroups.values()].sort(
    (a, b) => a.stockId.localeCompare(b.stockId) || a.width - b.width,
  );
  for (const g of groups) {
    const stock = s.stocks[g.stockId];
    const boardLength = stock.stockLength || 96;
    const result = packLinear(g.items, boardLength, s.kerf);
    linearPacks.push({
      stockId: g.stockId,
      label: stock.label,
      thickness: stock.thickness,
      width: g.width,
      boardLength,
      boards: result.boards,
      oversize: result.oversize,
      usedLength: result.usedLength,
    });
    oversize += result.oversize.length;
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
    framed: frameLFInches > 0,
    frameLF: Math.ceil(frameLFInches / 12),
  };

  return { cabinetParts, cutGroups, stepGroups, packs, linearPacks, summary, cost, legend };
}

/** Hardware cost alone (handy for tests / summaries). */
export function hardwareTotal(cabinets: Cabinet[], s: Settings): number {
  let counts: HardwareCounts = { ...ZERO_COUNTS };
  for (const c of cabinets) {
    counts = addCounts(counts, countHardware(genParts(c, s).parts, s.hardware));
  }
  return hardwareCost(counts, s.hardware);
}
