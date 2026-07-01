import { Settings } from "@/domain/types";
import { Model } from "@/engine/compute";
import { fmtLen } from "@/engine/units";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRows(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Cut list as CSV. Dimensions are decimal inches (machine-friendly). */
export function cutListCsv(model: Model, s: Settings): string {
  const rows: (string | number)[][] = [
    ["Cabinet", "Type", "Part", "Qty", "Length (in)", "Width (in)", "Material", "Edge-band"],
  ];
  for (const g of model.cutGroups) {
    for (const p of g.parts) {
      rows.push([
        g.name,
        g.typeLabel,
        p.name,
        p.qty,
        p.part.length,
        p.part.width,
        s.stocks[p.part.stockId].label,
        p.edgeStr,
      ]);
    }
  }
  return csvRows(rows);
}

/** Per-sheet placement list as CSV (for an external optimizer / record). */
export function sheetsCsv(model: Model): string {
  const rows: (string | number)[][] = [
    ["Stock", "Sheet #", "Part", "Cabinet", "X (in)", "Y (in)", "W (in)", "H (in)"],
  ];
  for (const pack of model.packs) {
    pack.sheets.forEach((sheet, i) => {
      for (const pl of sheet.placements) {
        rows.push([
          pack.label,
          i + 1,
          pl.part,
          pl.label,
          +pl.x.toFixed(3),
          +pl.y.toFixed(3),
          +pl.w.toFixed(3),
          +pl.h.toFixed(3),
        ]);
      }
    });
  }
  return csvRows(rows);
}

/** Plain-text shopping / hardware list. */
export function shoppingListText(model: Model, s: Settings): string {
  const { summary, cost } = model;
  const lines: string[] = [];
  lines.push("SHOPPING LIST");
  lines.push("=============");
  for (const pack of model.packs) {
    if (pack.sheets.length === 0) continue;
    lines.push(`${pack.sheets.length} × ${pack.label} (${fmtLen(pack.sheetH, s.units)} × ${fmtLen(pack.sheetW, s.units)})`);
  }
  if (summary.frameLF > 0)
    lines.push(
      `${summary.frameLF} ft × ${fmtLen(s.frameWidth, s.units)} hardwood (face-frame stiles/rails; ${fmtLen(s.faceFrameTop, s.units)} top rails)`,
    );
  lines.push(`${summary.bandLF} ft × edge-banding`);
  lines.push("");
  lines.push("HARDWARE");
  lines.push("--------");
  lines.push(`${summary.hinges} hinges`);
  lines.push(`${summary.slides} drawer-slide pairs`);
  if (summary.pulls > 0) lines.push(`${summary.pulls} pulls / knobs`);
  lines.push(`${summary.shelfPins} shelf pins`);
  lines.push("");
  lines.push("ESTIMATED COST");
  lines.push("--------------");
  for (const l of cost.lines) lines.push(`${l.label.padEnd(24)} ${l.detail.padEnd(18)} $${l.amount.toFixed(2)}`);
  lines.push(`${"TOTAL".padEnd(24)} ${"".padEnd(18)} $${cost.total.toFixed(2)}`);
  return lines.join("\n");
}
