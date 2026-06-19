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
import { PackRect, StockPack, packStock } from "./packing";
import { bandingInchesPerPiece, genParts } from "./parts";
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
  summary: Summary;
  cost: CostBreakdown;
  legend: Legend[];
}

function edgeStr(p: Part): string {
  if (p.bandAll) return "all 4 edges";
  if (p.bandFrontEdge > 0) return "front edge";
  return "—";
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

  cabinets.forEach((c, idx) => {
    const cp = genParts(c, s);
    cabinetParts.push(cp);
    const color = colorFor(idx);
    legend.push({ id: c.id, name: c.name, color });

    const cutParts: CutPart[] = cp.parts.map((p) => {
      pieces += p.qty;
      bandLFInches += p.qty * bandingInchesPerPiece(p);
      if (p.linear) {
        frameLFInches += p.qty * p.length;
      } else {
        areaByStock.set(
          p.stockId,
          (areaByStock.get(p.stockId) || 0) + p.qty * p.length * p.width,
        );
        const arr = rectsByStock.get(p.stockId) || [];
        for (let i = 0; i < p.qty; i++) {
          arr.push({ w: p.length, h: p.width, color, label: c.name, part: p.name });
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
    });

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

  return { cabinetParts, cutGroups, stepGroups, packs, summary, cost, legend };
}

/** Hardware cost alone (handy for tests / summaries). */
export function hardwareTotal(cabinets: Cabinet[], s: Settings): number {
  let counts: HardwareCounts = { ...ZERO_COUNTS };
  for (const c of cabinets) {
    counts = addCounts(counts, countHardware(genParts(c, s).parts, s.hardware));
  }
  return hardwareCost(counts, s.hardware);
}
