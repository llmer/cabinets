import { Settings } from "@/domain/types";
import { Model } from "@/engine/compute";
import { screwLabel } from "@/engine/pocketHoles";
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
      // Store-breakdown strips ride along as pseudo-rows: full sheet width,
      // H = the width to ask the store's panel saw for.
      (sheet.strips || []).forEach((st, j, strips) => {
        rows.push([
          pack.label,
          i + 1,
          st.offcut ? "— offcut —" : j < strips.length - 1 ? "— store rip strip —" : "— last strip —",
          "",
          0,
          +st.y.toFixed(3),
          pack.sheetW,
          +st.height.toFixed(3),
        ]);
      });
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
  if (model.summary.storeCuts > 0)
    lines.push(
      `(${model.summary.storeCuts} store panel-saw rips planned — bring the per-sheet rip widths from the Sheets page)`,
    );
  // Hardwood: with boards on hand the plan rips from those — nothing to buy
  // unless it comes up short. List what the plan consumes vs. what's on hand.
  for (const bp of model.boardPacks) {
    const byBoard = new Map<string, number>();
    for (const b of bp.boards) {
      const key = `${fmtLen(b.width, s.units)} × ${fmtLen(b.length, s.units)}`;
      byBoard.set(key, (byBoard.get(key) || 0) + 1);
    }
    const onHand = bp.specs
      .map((sp) => `${sp.qty}× ${fmtLen(sp.width, s.units)} × ${fmtLen(sp.length, s.units)}`)
      .join(", ");
    for (const [size, n] of byBoard) lines.push(`uses ${n} × ${bp.label} board (${size}) — of the ${onHand} on hand`);
    if (bp.shortfall.length > 0)
      lines.push(`⚠ buy more ${bp.label} — ${bp.shortfall.length} part(s) don't fit the boards on hand`);
  }
  if (summary.frameLF > 0 && model.boardPacks.length === 0)
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
  if (model.pocketPlan) {
    for (const t of model.pocketPlan.totals) {
      lines.push(
        `${t.count} × ${screwLabel(t.spec, s.units)} pocket screws (jig at ${fmtLen(t.spec.setting, s.units)}) — plus spares`,
      );
    }
  }
  lines.push("");
  lines.push("ESTIMATED COST");
  lines.push("--------------");
  for (const l of cost.lines) lines.push(`${l.label.padEnd(24)} ${l.detail.padEnd(18)} $${l.amount.toFixed(2)}`);
  lines.push(`${"TOTAL".padEnd(24)} ${"".padEnd(18)} $${cost.total.toFixed(2)}`);
  return lines.join("\n");
}
