import { Settings } from "@/domain/types";
import { HardwareCounts } from "./hardware";
import { StockPack } from "./packing";

export interface CostLine {
  key: string;
  label: string;
  detail: string;
  amount: number;
}

export interface CostBreakdown {
  lines: CostLine[];
  total: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Build an itemized material + hardware cost estimate. Sheet goods are charged
 * per whole sheet, hardwood by the linear foot, banding by the foot, and each
 * hardware line at its unit price.
 */
export function buildCost(
  packs: StockPack[],
  frameLFInches: number,
  bandLFInches: number,
  counts: HardwareCounts,
  s: Settings,
): CostBreakdown {
  const lines: CostLine[] = [];

  for (const p of packs) {
    if (p.sheets.length === 0) continue;
    const stock = s.stocks[p.stockId];
    const amount = p.sheets.length * stock.costPerSheet;
    lines.push({
      key: `stock:${p.stockId}`,
      label: stock.label,
      detail: `${p.sheets.length} sheet${p.sheets.length > 1 ? "s" : ""} × ${money(stock.costPerSheet)}`,
      amount,
    });
  }

  if (frameLFInches > 0) {
    const ft = frameLFInches / 12;
    const stock = s.stocks[s.roleStock.faceFrame];
    const amount = ft * stock.costPerFoot;
    lines.push({
      key: "hardwood",
      label: "Face-frame hardwood",
      detail: `${Math.ceil(ft)} ft × ${money(stock.costPerFoot)}`,
      amount,
    });
  }

  if (bandLFInches > 0) {
    const ft = bandLFInches / 12;
    const amount = ft * s.edgeBandPerFoot;
    lines.push({
      key: "banding",
      label: "Edge-banding",
      detail: `${Math.ceil(ft)} ft × ${money(s.edgeBandPerFoot)}`,
      amount,
    });
  }

  const hw = s.hardware;
  const hwLine = (key: string, label: string, qty: number, each: number) => {
    if (qty <= 0) return;
    lines.push({ key, label, detail: `${qty} × ${money(each)}`, amount: qty * each });
  };
  hwLine("hinges", "Hinges", counts.hinges, hw.hingeEach);
  hwLine("slides", "Drawer-slide pairs", counts.slides, hw.slidePairEach);
  hwLine("pulls", "Pulls / knobs", counts.pulls, hw.pullEach);
  hwLine("shelfPins", "Shelf pins", counts.shelfPins, hw.shelfPinEach);

  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { lines, total };
}
