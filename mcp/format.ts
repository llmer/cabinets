/**
 * Text formatters — turn the derived model into compact, agent-readable text.
 *
 * Tool results are plain text, so this is where a Model becomes something an
 * LLM (or a human reading the transcript) can act on. Every formatter is pure:
 * (model | project | report) → string. Lengths render in the project's active
 * unit via the engine's `fmtLen`, so a mm project reads in mm.
 */
import { Cabinet, Project, Settings } from "@/domain/types";
import { AuditReport } from "@/engine/audit";
import { Model } from "@/engine/compute";
import { cabinetGeometry } from "@/engine/geometry";
import { constructionInfo, frontStyleLabel, typeLabel } from "@/engine/labels";
import { ripPlanText } from "@/engine/packing";
import { drawerBoxSpecs } from "@/engine/parts";
import { runsOf } from "@/engine/runs";
import { fmtLen } from "@/engine/units";

const L = (x: number, s: Settings) => fmtLen(x, s.units);

/** One-line headline used after mutations: cost + sheets + hardware at a glance. */
export function headline(model: Model, s: Settings): string {
  const sm = model.summary;
  return (
    `${sm.count} cabinet${sm.count === 1 ? "" : "s"} · ${sm.cost} · ` +
    `${sm.sheetCount} sheet${sm.sheetCount === 1 ? "" : "s"} (${sm.yieldStr} yield)` +
    (sm.frameLF > 0 ? ` · ${sm.frameLF} ft face frame` : "") +
    ` · ${sm.doors}D/${sm.drawers}Dr · ${L(sm.baseRunRaw, s)} base run`
  );
}

/** Project header: name, units, construction summary. */
export function projectHeader(project: Project): string {
  const { cabinets, settings } = project;
  const info = constructionInfo(cabinets);
  return [
    `Project: ${project.name}`,
    `Units: ${settings.units} · Construction: ${info.label}`,
  ].join("\n");
}

export function summaryText(project: Project, model: Model): string {
  const s = project.settings;
  const sm = model.summary;
  const info = constructionInfo(project.cabinets);
  const lines: string[] = [];
  lines.push(projectHeader(project));
  lines.push("");
  const runs = runsOf(project.cabinets, s);
  const runTotal = runs.length > 1 ? " (total across runs)" : "";
  lines.push(`Cabinets:     ${sm.count}`);
  lines.push(`Base run:     ${L(sm.baseRunRaw, s)}${runTotal}    Wall run: ${L(sm.wallRunRaw, s)}`);
  lines.push(`Sheets:       ${sm.sheetCount}  (${sm.yieldStr} yield, ${sm.totalArea} sq ft used)`);
  if (sm.frameLF > 0) lines.push(`Face frame:   ${sm.frameLF} ft hardwood`);
  lines.push(`Edge-band:    ${sm.bandLF} ft`);
  lines.push(
    `Hardware:     ${sm.doors} doors, ${sm.drawers} drawers, ${sm.hinges} hinges, ` +
      `${sm.slides} slide pairs, ${sm.pulls} pulls, ${sm.shelfPins} shelf pins`,
  );
  lines.push(`Est. cost:    ${sm.cost}`);
  if (sm.oversize > 0) lines.push(`⚠ Oversize:   ${sm.oversize} part(s) don't fit a sheet — run audit_project.`);
  if (runs.length > 1) {
    lines.push("");
    lines.push(`Runs (${runs.length}) — the run totals above span these physically-separate runs:`);
    for (const r of runs) {
      const names = `${r.members[0].cabinet.name}–${r.members[r.members.length - 1].cabinet.name}`;
      lines.push(`   ${r.lane.padEnd(4)} ${names.padEnd(11)} ${L(r.x1 - r.x0, s)} · ${r.members.length} ${r.members.length === 1 ? "bay" : "bays"}`);
    }
  }
  lines.push("");
  lines.push(info.note);
  return lines.join("\n");
}

/** Compact table of every cabinet + key attributes. */
export function cabinetTable(project: Project): string {
  const s = project.settings;
  if (project.cabinets.length === 0) return "(no cabinets)";
  const rows = project.cabinets.map((c, i) => {
    const dims = `${L(c.width, s)}×${L(c.height, s)}×${L(c.depth, s)}`;
    const fit = c.overlay === "full" ? "full" : c.overlay === "inset_rail" ? "railed" : "inset";
    const flags = [
      c.construction === "framed" ? "framed" : "frameless",
      fit,
      c.toeKick === false ? "no-kick" : "kick",
      c.runBreak ? "run-break" : "",
    ]
      .filter(Boolean)
      .join(",");
    return `${String(i + 1).padStart(2)}. ${c.name.padEnd(6)} ${typeLabel(c.type).padEnd(12)} ${dims.padEnd(20)} ${frontStyleLabel(c.frontStyle).padEnd(18)} d${c.doorCount}/dr${c.drawerCount}/sh${c.shelves}  ${flags}`;
  });
  return rows.join("\n");
}

/** Everything about one cabinet: fields, derived geometry, part + step counts. */
export function cabinetDetail(c: Cabinet, project: Project, model: Model): string {
  const s = project.settings;
  const g = cabinetGeometry(c, s);
  const cp = model.cabinetParts.find((x) => x.cabinet.id === c.id);
  const steps = model.stepGroups.find((x) => x.id === c.id);
  const pieces = cp ? cp.parts.reduce((a, p) => a + p.qty, 0) : 0;
  const lines: string[] = [];
  lines.push(`${c.name} — ${typeLabel(c.type)} · ${frontStyleLabel(c.frontStyle)}  (id ${c.id})`);
  lines.push(`Outside:   ${L(c.width, s)} w × ${L(c.height, s)} h × ${L(c.depth, s)} d`);
  lines.push(`Fit:       ${c.construction} · ${c.overlay}${c.runBreak ? " · run-break" : ""}`);
  lines.push(`Counts:    ${c.doorCount} door(s), ${c.drawerCount} drawer(s), ${c.shelves} shelf(ves)`);
  lines.push(`Toe kick:  ${c.toeKick === false ? "none (floor-standing)" : L(s.toeKick, s)}`);
  if (c.drawerHeights?.length) lines.push(`Drawer heights: ${c.drawerHeights.map((h) => L(h, s)).join(", ")}`);
  lines.push("");
  lines.push(`Derived:   box ${L(g.boxHeight, s)} h · interior ${L(g.interiorWidth, s)} w · carcass depth ${L(g.carcassDepth, s)}`);
  lines.push(`Cut list:  ${pieces} pieces in ${cp?.parts.length ?? 0} distinct parts · ${steps?.steps.length ?? 0} assembly steps`);
  const boxes = drawerBoxTable(c, s);
  if (boxes) lines.push("", boxes);
  return lines.join("\n");
}

/** Per-drawer box sizes — the table the drawer build step refers to. "" if none. */
export function drawerBoxTable(c: Cabinet, s: Settings): string {
  const specs = drawerBoxSpecs(c, s);
  if (specs.length === 0) return "";
  const lines = ["Drawer boxes (outside W × D × H · bottom W × L):"];
  for (const sp of specs) {
    lines.push(
      `   #${sp.index} front ${L(sp.frontHeight, s)}  box ${L(sp.boxWidth, s)} × ${L(sp.boxDepth, s)} × ${L(sp.boxHeight, s)}  ` +
        `bottom ${L(sp.bottomWidth, s)} × ${L(sp.bottomLength, s)}`,
    );
  }
  return lines.join("\n");
}

/** Cut list, grouped as the app groups it. `only` limits to the given group id(s). */
export function cutListText(model: Model, only?: string | string[]): string {
  const set = only == null ? null : new Set(Array.isArray(only) ? only : [only]);
  const groups = set ? model.cutGroups.filter((g) => set.has(g.id)) : model.cutGroups;
  if (groups.length === 0) return set ? "(no matching cut group)" : "(empty)";
  const lines: string[] = [];
  for (const g of groups) {
    lines.push(`### ${g.name} — ${g.typeLabel}  (${g.dims})`);
    for (const p of g.parts) {
      const mat = p.matTag ? `  [${p.matTag}]` : "";
      const edge = p.edgeStr !== "—" ? `  band:${p.edgeStr}` : "";
      lines.push(`   ${p.qtyStr.padEnd(4)} ${p.name.padEnd(22)} ${p.lenStr} × ${p.widStr}${mat}${edge}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Ordered assembly steps. `only` limits to one cabinet id. */
export function stepsText(model: Model, only?: string): string {
  const groups = only ? model.stepGroups.filter((g) => g.id === only) : model.stepGroups;
  if (groups.length === 0) return only ? "(no steps for that id)" : "(empty)";
  const lines: string[] = [];
  for (const g of groups) {
    lines.push(`### ${g.name} — ${g.typeLabel}  (${g.dims})`);
    for (const st of g.steps) lines.push(`   ${String(st.n).padStart(2)}. [${st.stage}] ${st.t}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function sheetsText(model: Model, s: Settings): string {
  const lines: string[] = [];
  for (const pack of model.packs) {
    if (pack.sheets.length === 0 && pack.oversize.length === 0) continue;
    lines.push(`${pack.label}: ${pack.sheets.length} sheet(s) of ${L(pack.sheetW, s)} × ${L(pack.sheetH, s)}`);
    pack.sheets.forEach((sh, i) => {
      const rips = sh.strips ? ` · ✂ ${ripPlanText(sh.strips, s.units)}` : "";
      lines.push(`   Sheet ${i + 1}: ${sh.placements.length} part(s)${rips}`);
    });
    for (const r of pack.oversize) {
      lines.push(`   ⚠ OVERSIZE: ${r.part} (${r.label}) ${L(r.w, s)} × ${L(r.h, s)} — won't fit`);
    }
  }
  lines.push("");
  lines.push(`Total: ${model.summary.sheetCount} sheet(s), ${model.summary.yieldStr} yield.`);
  if (model.summary.storeCuts > 0) {
    lines.push(
      `Store breakdown ON — ${model.summary.storeCuts} panel-saw rip(s) across all sheets. ` +
        `Rip widths are measured from the freshly cut edge, in order. Store cuts are rough: ` +
        `parts keep ${L(s.storeTrim, s)} clear of them to re-cut clean at home (explain "store_breakdown").`,
    );
  }
  return lines.join("\n");
}

export function costText(model: Model): string {
  const lines: string[] = ["Estimated cost", "".padEnd(48, "-")];
  for (const l of model.cost.lines) {
    lines.push(`${l.label.padEnd(26)} ${l.detail.padEnd(16)} $${l.amount.toFixed(2)}`);
  }
  lines.push("".padEnd(48, "-"));
  lines.push(`${"TOTAL".padEnd(26)} ${"".padEnd(16)} $${model.cost.total.toFixed(2)}`);
  lines.push("");
  lines.push("Materials + hardware only — no labour, finish, or waste factor.");
  return lines.join("\n");
}

export function materialsText(s: Settings): string {
  const lines: string[] = ["Stocks:"];
  for (const id of Object.keys(s.stocks)) {
    const st = s.stocks[id];
    const price = st.kind === "sheet" ? `$${st.costPerSheet}/sheet (${st.sheetW}×${st.sheetH})` : `$${st.costPerFoot}/ft`;
    lines.push(`   ${id.padEnd(9)} ${st.label.padEnd(22)} ${st.kind.padEnd(7)} ${L(st.thickness, s)}  ${price}`);
  }
  lines.push("");
  lines.push("Role → stock:");
  for (const role of Object.keys(s.roleStock)) lines.push(`   ${role.padEnd(13)} → ${s.roleStock[role as keyof typeof s.roleStock]}`);
  lines.push("");
  const h = s.hardware;
  lines.push("Hardware pricing:");
  lines.push(`   hinge $${h.hingeEach}  slide-pair $${h.slidePairEach}  pull $${h.pullEach}  shelf-pin $${h.shelfPinEach}  count-pulls:${h.countPulls}`);
  return lines.join("\n");
}

const LEVEL_ICON: Record<string, string> = { error: "✗", warn: "⚠", info: "•" };

export function auditText(report: AuditReport): string {
  if (report.findings.length === 0) return "✓ Audit clean — no issues found.";
  const lines: string[] = [
    `Audit: ${report.errors} error(s), ${report.warnings} warning(s), ${report.infos} note(s). ${report.ok ? "Buildable." : "Fix the errors before cutting."}`,
    "",
  ];
  for (const f of report.findings) {
    lines.push(`${LEVEL_ICON[f.level]} [${f.code}]${f.cabinet ? ` ${f.cabinet}:` : ""} ${f.message}`);
    if (f.fix) lines.push(`     → ${f.fix}`);
  }
  return lines.join("\n");
}
