/**
 * frame(less) MCP server.
 *
 * Exposes the cabinet builder to an AI agent as tools + resources + prompts so
 * it can DESIGN a kitchen, AUDIT a design, and ASSIST a build — the three
 * personas the project cares about. It drives the very same pure engine and
 * mutation ops the browser app uses (see src/engine + src/domain/ops), so a
 * plan an agent produces here is identical to one a human produces in the UI,
 * and round-trips through the same `.cabinets.json` files.
 *
 * Transport is stdio: run it from an MCP client (Claude Code, etc.) via the
 * `.mcp.json` at the repo root. Never write to stdout except protocol — logs
 * go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Cabinet, FrontStyle } from "@/domain/types";
import * as ops from "@/domain/ops";
import { drawerStackBudget } from "@/engine/drawers";
import { runsOf } from "@/engine/runs";
import { cutListCsv, sheetsCsv, shoppingListText } from "@/state/exporters";

import { CabinetSession } from "./session.js";
import {
  auditText,
  cabinetDetail,
  cabinetTable,
  costText,
  cutListText,
  drawerBoxTable,
  headline,
  materialsText,
  sheetsText,
  stepsText,
  summaryText,
} from "./format.js";
import { TOPICS, referenceMarkdown } from "./reference.js";

/* ------------------------------------------------------------------ */
/* Result helpers                                                      */
/* ------------------------------------------------------------------ */

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

// Edits autosave to CABINETS_FILE (if set) and mirror to CABINETS_LIVE_FILE (a
// dev preview file the Vite plugin watches) — so an agent's work persists
// implicitly and streams to a running browser. Both are optional.
const session = new CabinetSession({
  workingPath: process.env.CABINETS_FILE || null,
  liveFile: process.env.CABINETS_LIVE_FILE || null,
});

/** Text appended after a mutation: the fresh headline + where it autosaved. */
const afterChange = (): string =>
  `\n\n→ ${headline(session.model(), session.settings)}  ·  ${session.persistenceNote()}`;

/* ------------------------------------------------------------------ */
/* Shared validators                                                   */
/* ------------------------------------------------------------------ */

const zType = z.enum(["base", "wall", "tall"]);
const zFront = z.enum(["doors", "drawers", "door_drawer", "desk", "opening"]);
const zConstruction = z.enum(["frameless", "framed"]);
const zOverlay = z.enum(["full", "inset_rail", "inset"]);
const zRole = z.enum(["carcass", "back", "front", "drawerBox", "drawerBottom", "faceFrame", "base"]);
/** A filesystem path that must be a .json file (guards against clobbering non-project files). */
const jsonPath = z.string().min(1).regex(/\.json$/i, "path must end in .json");

/** The editable fields common to add_cabinet / update_cabinet. */
const cabinetFields = {
  name: z.string().min(1).max(40).optional(),
  type: zType.optional(),
  width: z.number().positive().max(120).optional(),
  height: z.number().positive().max(120).optional(),
  depth: z.number().positive().max(48).optional(),
  frontStyle: zFront.optional(),
  doorCount: z.number().int().min(0).max(8).optional(),
  drawerCount: z.number().int().min(0).max(16).optional(),
  shelves: z.number().int().min(0).max(24).optional(),
  toeKick: z.boolean().optional(),
  construction: zConstruction.optional(),
  overlay: zOverlay.optional(),
  runBreak: z.boolean().optional(),
  drawerHeights: z.array(z.number().positive()).max(16).optional(),
};

type CabinetPatch = {
  name?: string;
  type?: "base" | "wall" | "tall";
  width?: number;
  height?: number;
  depth?: number;
  frontStyle?: "doors" | "drawers" | "door_drawer" | "desk" | "opening";
  doorCount?: number;
  drawerCount?: number;
  shelves?: number;
  toeKick?: boolean;
  construction?: "frameless" | "framed";
  overlay?: "full" | "inset_rail" | "inset";
  runBreak?: boolean;
  drawerHeights?: number[];
};

/** Front styles that only make sense on a base cabinet (mirrors the UI). */
const BASE_ONLY_FRONTS: FrontStyle[] = ["drawers", "door_drawer", "desk"];

/** Reject a base-only front style on a wall/tall cabinet (the UI forbids it). */
function frontStyleError(c: Cabinet): string | null {
  if (c.type !== "base" && BASE_ONLY_FRONTS.includes(c.frontStyle)) {
    return `${c.name}: front style "${c.frontStyle}" is only valid on a base cabinet; a ${c.type} cabinet uses "doors" or "opening".`;
  }
  return null;
}

/** Which derived run a cabinet belongs to (its shared frame/base cut group id). */
function runIdFor(cabinetId: string): string | null {
  for (const run of runsOf(session.cabinets, session.settings)) {
    if (run.members.some((m) => m.cabinet.id === cabinetId)) return run.id;
  }
  return null;
}

/** Validate an explicit drawer-heights array against a cabinet's budget. */
function validateHeights(c: Cabinet, hs: number[]): string | null {
  const hasDrawers =
    c.frontStyle === "drawers" || c.frontStyle === "desk" || c.frontStyle === "door_drawer";
  if (!hasDrawers) return `${c.name} has no drawers, so drawer heights don't apply.`;
  const expected = c.frontStyle === "door_drawer" ? 1 : c.drawerCount;
  if (hs.length !== expected) return `Expected ${expected} height(s) for ${c.name}, got ${hs.length}.`;
  if (hs.some((h) => h < 0.9)) return `Every drawer front must be at least ~1" tall.`;
  const budget = drawerStackBudget(c, session.settings);
  const sum = hs.reduce((a, x) => a + x, 0);
  if (sum > budget + 0.03) {
    return `Those heights sum to ${sum.toFixed(3)}", over the ${budget.toFixed(3)}" stack budget for ${c.name}.`;
  }
  return null;
}

/**
 * Apply a patch to one cabinet, routing budget-affecting fields through the
 * ops that re-derive drawer heights (so the result matches the UI exactly),
 * and raw fields through a plain patch. Mutates the session on success.
 */
function applyCabinetUpdate(target: Cabinet, p: CabinetPatch): void {
  const id = target.id;
  const s = session.settings;
  let cabs = session.cabinets;

  // 1) Raw fields FIRST — especially height / toeKick, which move the vertical
  //    drawer-stack budget. Applying them before the budget ops below means a
  //    combined call like {height, drawerCount} re-splits against the FINAL box,
  //    not the pre-change one.
  const raw: Partial<Cabinet> = {};
  if (p.name !== undefined) raw.name = ops.uniqueName(cabs.filter((c) => c.id !== id), p.name);
  if (p.width !== undefined) raw.width = p.width;
  if (p.height !== undefined) raw.height = p.height;
  if (p.depth !== undefined) raw.depth = p.depth;
  if (p.shelves !== undefined) raw.shelves = p.shelves;
  if (p.doorCount !== undefined) raw.doorCount = p.doorCount;
  if (p.toeKick !== undefined) raw.toeKick = p.toeKick;
  if (Object.keys(raw).length) cabs = ops.patchCabinet(cabs, id, raw);

  // 2) Budget-affecting ops — they re-derive drawer heights against step 1's geometry.
  if (p.type !== undefined) cabs = ops.setCabinetType(cabs, id, p.type);
  if (p.construction !== undefined) cabs = ops.setConstruction(cabs, s, id, p.construction);
  if (p.overlay !== undefined) cabs = ops.setOverlay(cabs, s, id, p.overlay);
  if (p.frontStyle !== undefined) cabs = ops.setFrontStyle(cabs, s, id, p.frontStyle);
  if (p.drawerCount !== undefined) cabs = ops.setDrawerCount(cabs, s, id, p.drawerCount);
  if (p.runBreak !== undefined) cabs = ops.setRunBreak(cabs, id, p.runBreak);

  // 3) Re-assert the type/front invariant the UI enforces — a combined
  //    {type:'wall', frontStyle:'drawers'} could otherwise slip a base-only front
  //    onto a wall/tall box (setCabinetType only clamps the pre-change front).
  const afterOps = cabs.find((c) => c.id === id)!;
  const frontErr = frontStyleError(afterOps);
  if (frontErr) throw new Error(frontErr);

  // 4) Explicit heights win, validated against the fully-patched cabinet.
  if (p.drawerHeights !== undefined) {
    const err = validateHeights(afterOps, p.drawerHeights);
    if (err) throw new Error(err);
    cabs = ops.patchCabinet(cabs, id, { drawerHeights: p.drawerHeights });
  }
  session.setCabinets(cabs);
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = new McpServer(
  { name: "framecess-cabinets", version: "1.0.0" },
  {
    instructions:
      "Design, audit and assist cabinet builds for the 32 mm system. Open a " +
      ".cabinets.json with `open_project` (or start one with `new_project`), " +
      "shape it with the design tools, sanity-check it with `audit_project`, " +
      "and read the build with `get_cut_list` / `get_build_steps`. Call " +
      "`explain` for domain terms.\n" +
      "Edits AUTOSAVE — every change writes back to the working file (and, when a " +
      "dev server is running, streams live to the browser). You do NOT need to call " +
      "`save_project` while editing; use it only to save-as / export to another path.\n" +
      "Everything is an ESTIMATE — verify before cutting.",
  },
);

const RO = { readOnlyHint: true } as const;
const RW = { readOnlyHint: false } as const;

/* ---- project lifecycle ---- */

server.registerTool(
  "project_summary",
  {
    title: "Project summary",
    description:
      "Headline numbers for the current project: cabinet count, runs, sheets + yield, " +
      "hardware tally, face-frame footage and estimated cost, plus the construction note.",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(summaryText(session.project, session.model())),
);

server.registerTool(
  "open_project",
  {
    title: "Open a project file",
    description:
      "Load and migrate a .cabinets.json project from a filesystem path and make it the " +
      "current project. This REPLACES the in-memory project — save_project first if you have " +
      "unsaved changes. Older/partial files are forward-migrated onto current defaults.",
    inputSchema: { path: jsonPath },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ path }) => {
    try {
      session.open(path);
    } catch (e) {
      return fail(`Could not open "${path}": ${(e as Error).message}`);
    }
    const a = session.audit();
    return text(
      `Opened ${session.workingPath} · ${session.persistenceNote()}\n\n${summaryText(session.project, session.model())}\n\n` +
        `Audit: ${a.errors} error(s), ${a.warnings} warning(s), ${a.infos} note(s).`,
    );
  },
);

server.registerTool(
  "new_project",
  {
    title: "New project",
    description:
      "Start a fresh project, DISCARDING the current in-memory one (save_project first if it " +
      "has unsaved changes). Seeded with a small example run by default; pass empty:true for a " +
      "blank project. The fresh project is in-memory only until you save — it never overwrites " +
      "a file you had open. Pass `path` to save it (and autosave there) immediately.",
    inputSchema: {
      name: z.string().min(1).optional(),
      empty: z.boolean().optional(),
      path: jsonPath.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ name, empty, path }) => {
    session.loadNew(name, empty ?? false);
    if (path) session.save(path);
    return text(
      `Started "${session.project.name}" · ${session.persistenceNote()}.\n\n${summaryText(session.project, session.model())}`,
    );
  },
);

server.registerTool(
  "save_project",
  {
    title: "Save-as / export to a file",
    description:
      "Save-as / export the current project to a path. You do NOT need this while editing — " +
      "edits autosave to the working file. Use it to write a copy to a new path (which then " +
      "becomes the working file), or with no path to flush the current one. Overwrites the target.",
    inputSchema: { path: jsonPath.optional() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ path }) => {
    try {
      const written = session.save(path);
      return text(`Saved ${session.cabinets.length} cabinet(s) to ${written} · ${session.persistenceNote()}`);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

server.registerTool(
  "get_project",
  {
    title: "Get raw project JSON",
    description: "Return the current project as pretty-printed JSON (the .cabinets.json contents).",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(JSON.stringify(session.project, null, 2)),
);

server.registerTool(
  "rename_project",
  {
    title: "Rename project",
    description: "Set the project's display name.",
    inputSchema: { name: z.string().min(1) },
    annotations: RW,
  },
  async ({ name }) => {
    session.rename(name);
    return text(`Renamed to "${name}".`);
  },
);

/* ---- design ---- */

server.registerTool(
  "list_cabinets",
  {
    title: "List cabinets",
    description: "A compact table of every cabinet: dimensions, front style, construction/fit, counts and flags.",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(cabinetTable(session.project)),
);

server.registerTool(
  "get_cabinet",
  {
    title: "Inspect one cabinet",
    description: "Full detail for a single cabinet (by id or name): stored fields, derived geometry, part + step counts.",
    inputSchema: { cabinet: z.string().min(1) },
    annotations: RO,
  },
  async ({ cabinet }) => {
    const c = session.resolve(cabinet);
    if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
    return text(cabinetDetail(c, session.project, session.model()));
  },
);

server.registerTool(
  "add_cabinet",
  {
    title: "Add a cabinet",
    description:
      "Append a new cabinet of the given type. Optional fields seed its dimensions, front " +
      "style, counts and construction; drawer heights are derived automatically unless given.",
    inputSchema: { ...cabinetFields, type: zType },
    annotations: RW,
  },
  async ({ type, ...over }) => {
    // Validate any explicit heights against the would-be cabinet later; strip for creation first.
    const heights = over.drawerHeights;
    const cleaned: Partial<Cabinet> = { ...over };
    delete (cleaned as CabinetPatch).drawerHeights;
    const { cabinets, cabinet } = ops.addCabinet(session.cabinets, session.settings, type, cleaned);
    const frontErr = frontStyleError(cabinet);
    if (frontErr) return fail(frontErr);
    if (heights) {
      const err = validateHeights(cabinet, heights);
      if (err) return fail(err);
      cabinet.drawerHeights = heights;
    }
    session.setCabinets(cabinets);
    return text(`Added ${cabinet.name} (${cabinet.type}, id ${cabinet.id}).${afterChange()}`);
  },
);

server.registerTool(
  "update_cabinet",
  {
    title: "Update a cabinet",
    description:
      "Change fields on a cabinet (by id or name). Budget-affecting changes (type, " +
      "construction, overlay, front style, drawer count) re-derive drawer heights the same " +
      "way the app does. Pass drawerHeights to set them explicitly (validated against the budget).",
    inputSchema: { cabinet: z.string().min(1), ...cabinetFields },
    annotations: RW,
  },
  async ({ cabinet, ...patch }) => {
    const c = session.resolve(cabinet);
    if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
    try {
      applyCabinetUpdate(c, patch);
    } catch (e) {
      return fail((e as Error).message);
    }
    const updated = session.resolve(c.id)!;
    return text(`${cabinetDetail(updated, session.project, session.model())}${afterChange()}`);
  },
);

server.registerTool(
  "remove_cabinet",
  {
    title: "Remove a cabinet",
    description: "Delete a cabinet (by id or name) from the project.",
    inputSchema: { cabinet: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ cabinet }) => {
    const c = session.resolve(cabinet);
    if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
    session.setCabinets(ops.removeCabinet(session.cabinets, c.id));
    return text(`Removed ${c.name}.${afterChange()}`);
  },
);

server.registerTool(
  "duplicate_cabinet",
  {
    title: "Duplicate a cabinet",
    description: "Copy a cabinet (by id or name); the copy is inserted right after it with a fresh id + name.",
    inputSchema: { cabinet: z.string().min(1) },
    annotations: RW,
  },
  async ({ cabinet }) => {
    const c = session.resolve(cabinet);
    if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
    const { cabinets, cabinet: copy } = ops.duplicateCabinet(session.cabinets, c.id);
    if (!copy) return fail("Duplicate failed.");
    session.setCabinets(cabinets);
    return text(`Duplicated ${c.name} → ${copy.name}.${afterChange()}`);
  },
);

server.registerTool(
  "move_cabinet",
  {
    title: "Reorder a cabinet",
    description:
      "Move a cabinet (by id or name) to a new 0-based position in the list. Order is " +
      "meaningful — runs are derived left-to-right — so use this to insert a box mid-run or " +
      "group cabinets so they share a face frame. The index is clamped into range.",
    inputSchema: { cabinet: z.string().min(1), toIndex: z.number().int().min(0) },
    annotations: RW,
  },
  async ({ cabinet, toIndex }) => {
    const c = session.resolve(cabinet);
    if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
    session.setCabinets(ops.moveCabinet(session.cabinets, c.id, toIndex));
    return text(`Moved ${c.name} to position ${toIndex}.\n\n${cabinetTable(session.project)}${afterChange()}`);
  },
);

server.registerTool(
  "set_run_break",
  {
    title: "Set / clear a run break",
    description:
      "Toggle the run-break escape hatch on a cabinet — start a new run BEFORE it so a " +
      "continuous face frame / toe-kick base won't span a corner, appliance gap or island.",
    inputSchema: { cabinet: z.string().min(1), on: z.boolean() },
    annotations: RW,
  },
  async ({ cabinet, on }) => {
    const c = session.resolve(cabinet);
    if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
    session.setCabinets(ops.setRunBreak(session.cabinets, c.id, on));
    return text(`Run break ${on ? "set on" : "cleared from"} ${c.name}.${afterChange()}`);
  },
);

server.registerTool(
  "apply_to_all",
  {
    title: "Bulk construction / fit",
    description: "Apply one construction (frameless/framed) and/or one overlay/fit to every cabinet at once.",
    inputSchema: { construction: zConstruction.optional(), overlay: zOverlay.optional() },
    annotations: RW,
  },
  async ({ construction, overlay }) => {
    if (!construction && !overlay) return fail("Pass construction and/or overlay.");
    let cabs = session.cabinets;
    if (construction) cabs = ops.setConstructionAll(cabs, session.settings, construction);
    if (overlay) cabs = ops.setOverlayAll(cabs, session.settings, overlay);
    session.setCabinets(cabs);
    return text(`Applied ${[construction, overlay].filter(Boolean).join(" + ")} to all.${afterChange()}`);
  },
);

/* ---- settings / materials ---- */

server.registerTool(
  "update_settings",
  {
    title: "Update project settings",
    description:
      "Patch project-wide settings: reveal, toe kick + recesses, face-frame widths, kerf, " +
      "run frame/base toggles, drawer-box generation, guide heights, units, edge-band price, " +
      "and `construction` (the default frameless/framed applied to NEW cabinets).",
    inputSchema: {
      units: z.enum(["in", "mm"]).optional(),
      reveal: z.number().min(0).max(2).optional(),
      toeKick: z.number().min(0).max(16).optional(),
      toeKickDepth: z.number().min(0).max(12).optional(),
      toeKickSideRecess: z.number().min(0).max(12).optional(),
      faceFrameFloorGap: z.number().min(0).max(16).optional(),
      frameWidth: z.number().positive().max(6).optional(),
      faceFrameTop: z.number().positive().max(8).optional(),
      kerf: z.number().min(0).max(1).optional(),
      allowRotate: z.boolean().optional(),
      continuousFaceFrame: z.boolean().optional(),
      separateBase: z.boolean().optional(),
      includeDrawerBoxes: z.boolean().optional(),
      upperBottom: z.number().min(0).max(120).optional(),
      counterH: z.number().min(0).max(60).optional(),
      edgeBandPerFoot: z.number().min(0).max(50).optional(),
      construction: zConstruction.optional(),
    },
    annotations: RW,
  },
  async (patch) => {
    const keys = Object.keys(patch);
    if (keys.length === 0) return fail("Pass at least one setting to change.");
    session.setSettings(ops.updateSettings(session.settings, patch));
    return text(`Updated settings: ${keys.join(", ")}.${afterChange()}`);
  },
);

server.registerTool(
  "list_materials",
  {
    title: "List materials + pricing",
    description: "The stock library, the role→stock mapping, and hardware unit prices.",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(materialsText(session.settings)),
);

server.registerTool(
  "set_role_stock",
  {
    title: "Point a part role at a stock",
    description: "Map a part role (carcass, back, front, drawerBox, drawerBottom, faceFrame, base) to a stock id.",
    inputSchema: { role: zRole, stockId: z.string().min(1) },
    annotations: RW,
  },
  async ({ role, stockId }) => {
    if (!session.settings.stocks[stockId]) return fail(`No stock "${stockId}". See list_materials.`);
    session.setSettings(ops.setRoleStock(session.settings, role, stockId));
    return text(`Role ${role} now cuts from ${stockId}.${afterChange()}`);
  },
);

server.registerTool(
  "update_stock",
  {
    title: "Edit a stock",
    description: "Change a stock's label, thickness, sheet size or price.",
    inputSchema: {
      id: z.string().min(1),
      label: z.string().max(60).optional(),
      thickness: z.number().positive().max(4).optional(),
      sheetW: z.number().min(0).max(240).optional(),
      sheetH: z.number().min(0).max(240).optional(),
      costPerSheet: z.number().min(0).max(100000).optional(),
      costPerFoot: z.number().min(0).max(100000).optional(),
    },
    annotations: RW,
  },
  async ({ id, ...patch }) => {
    if (!session.settings.stocks[id]) return fail(`No stock "${id}". See list_materials.`);
    session.setSettings(ops.updateStock(session.settings, id, patch));
    return text(`Updated stock ${id}.${afterChange()}`);
  },
);

server.registerTool(
  "update_hardware",
  {
    title: "Edit hardware pricing",
    description: "Change per-unit hardware prices and whether pulls are counted.",
    inputSchema: {
      hingeEach: z.number().min(0).optional(),
      slidePairEach: z.number().min(0).optional(),
      pullEach: z.number().min(0).optional(),
      shelfPinEach: z.number().min(0).optional(),
      countPulls: z.boolean().optional(),
    },
    annotations: RW,
  },
  async (patch) => {
    if (Object.keys(patch).length === 0) return fail("Pass at least one hardware field.");
    session.setSettings(ops.updateHardware(session.settings, patch));
    return text(`Updated hardware pricing.${afterChange()}`);
  },
);

/* ---- build ---- */

server.registerTool(
  "get_cut_list",
  {
    title: "Cut list",
    description:
      "The full cut list grouped by cabinet + run (or one cabinet/run by id/name). " +
      "format:'csv' returns machine-friendly decimal-inch CSV for an optimizer.",
    inputSchema: { cabinet: z.string().optional(), format: z.enum(["text", "csv"]).optional() },
    annotations: RO,
  },
  async ({ cabinet, format }) => {
    const model = session.model();
    let ids: string[] | undefined;
    if (cabinet) {
      const c = session.resolve(cabinet);
      if (c) {
        // Include the cabinet AND its run's shared frame/base group, so the parts
        // the per-cabinet steps tell you to cut actually appear here.
        const runId = runIdFor(c.id);
        ids = runId && model.cutGroups.some((g) => g.id === runId) ? [c.id, runId] : [c.id];
      } else if (model.cutGroups.some((g) => g.id === cabinet)) {
        ids = [cabinet]; // a run id passed directly
      } else {
        return fail(`No cabinet or run "${cabinet}". Try list_cabinets.`);
      }
    }
    if (format === "csv") {
      const m = ids ? { ...model, cutGroups: model.cutGroups.filter((g) => ids!.includes(g.id)) } : model;
      return text(cutListCsv(m, session.settings));
    }
    return text(cutListText(model, ids));
  },
);

server.registerTool(
  "get_sheets",
  {
    title: "Sheet nesting",
    description: "How the parts nest onto sheet goods: sheets per stock, yield, oversize flags. format:'csv' for placements.",
    inputSchema: { format: z.enum(["text", "csv"]).optional() },
    annotations: RO,
  },
  async ({ format }) => {
    const model = session.model();
    if (format === "csv") return text(sheetsCsv(model));
    return text(sheetsText(model, session.settings));
  },
);

server.registerTool(
  "get_build_steps",
  {
    title: "Assembly steps",
    description:
      "Ordered, real-assembly-order build steps for every cabinet (or one by id/name), each " +
      "tagged with its construction stage (sides → carcass → … → pulls).",
    inputSchema: { cabinet: z.string().optional() },
    annotations: RO,
  },
  async ({ cabinet }) => {
    const model = session.model();
    if (cabinet) {
      const c = session.resolve(cabinet);
      if (!c) return fail(`No cabinet "${cabinet}". Try list_cabinets.`);
      // The drawer step references "the table below" — provide it for one cabinet.
      const table = drawerBoxTable(c, session.settings);
      return text(stepsText(model, c.id) + (table ? `\n\n${table}` : ""));
    }
    return text(stepsText(model));
  },
);

server.registerTool(
  "get_shopping_list",
  {
    title: "Shopping list",
    description: "A plain-text shopping list: sheets, hardwood, edge-banding, hardware counts and the cost total.",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(shoppingListText(session.model(), session.settings)),
);

server.registerTool(
  "get_cost_breakdown",
  {
    title: "Cost breakdown",
    description: "The itemized materials + hardware cost estimate (no labour / finish / waste).",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(costText(session.model())),
);

/* ---- audit + explain ---- */

server.registerTool(
  "audit_project",
  {
    title: "Audit the design",
    description:
      "Review the whole project for buildability + design issues: oversize panels, exhausted " +
      "drawer budgets, wide sag-prone doors, low sheet yield, mixed toe-kick runs, appliance " +
      "gaps sharing a frame, front/count mismatches. Errors block a clean build; warnings + notes advise.",
    inputSchema: {},
    annotations: RO,
  },
  async () => text(auditText(session.audit())),
);

server.registerTool(
  "explain",
  {
    title: "Explain a domain term",
    description:
      "Explain a cabinet/32 mm-system concept. Topics: " + Object.keys(TOPICS).join(", ") + ".",
    inputSchema: { topic: z.string().min(1) },
    annotations: RO,
  },
  async ({ topic }) => {
    const t = TOPICS[topic];
    if (!t) return fail(`Unknown topic "${topic}". Available: ${Object.keys(TOPICS).join(", ")}.`);
    return text(`${t.title}\n\n${t.body}`);
  },
);

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

server.registerResource(
  "current-project",
  "cabinets://project",
  {
    title: "Current project (JSON)",
    description: "The live project as .cabinets.json — the source of truth the tools read + mutate.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(session.project, null, 2) }],
  }),
);

server.registerResource(
  "cut-list-csv",
  "cabinets://cutlist.csv",
  {
    title: "Current cut list (CSV)",
    description: "The current project's cut list as decimal-inch CSV for an external optimizer.",
    mimeType: "text/csv",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/csv", text: cutListCsv(session.model(), session.settings) }],
  }),
);

server.registerResource(
  "domain-reference",
  "cabinets://reference",
  {
    title: "Domain reference",
    description: "How the model works: cabinet types, construction vs. fit, runs, toe kick, drawer budget, the 32 mm system.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: referenceMarkdown() }],
  }),
);

/* ------------------------------------------------------------------ */
/* Prompts — the three personas, as one-click entry points            */
/* ------------------------------------------------------------------ */

server.registerPrompt(
  "plan_kitchen",
  {
    title: "Designer: plan a kitchen from a brief",
    description: "Guide the DESIGNER persona: turn a plain-language brief into a cabinet run.",
    argsSchema: { brief: z.string().optional() },
  },
  ({ brief }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "You are helping DESIGN a kitchen with the frame(less) cabinet tools.\n" +
            (brief ? `Brief: ${brief}\n\n` : "\n") +
            "Start with `new_project` (or `open_project` to continue one). Read " +
            "`explain overview` and `explain runs` if unsure. Add cabinets left-to-right " +
            "with `add_cabinet`, set run breaks at corners/appliances, then call " +
            "`audit_project` and `project_summary` and report the plan + cost. Confirm " +
            "wall dimensions with me before finalizing — this is an estimate, not a guarantee.",
        },
      },
    ],
  }),
);

server.registerPrompt(
  "audit_design",
  {
    title: "Reviewer: audit a design",
    description: "Guide the AUDIT persona: open a file and review it for problems.",
    argsSchema: { path: z.string().optional() },
  },
  ({ path }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            (path ? `Open ${path} with \`open_project\`. ` : "Using the current project, ") +
            "run `audit_project` and walk each finding: what it means, why it matters, and " +
            "the concrete fix (with the tool call that applies it). Then give `project_summary` " +
            "and a go / no-go for cutting.",
        },
      },
    ],
  }),
);

server.registerPrompt(
  "build_walkthrough",
  {
    title: "Builder: walk the build",
    description: "Guide the BUILDER persona: cut list + ordered assembly for the shop.",
    argsSchema: { cabinet: z.string().optional() },
  },
  ({ cabinet }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Act as a shop assistant for the BUILD. First `audit_project` (don't cut if there " +
            "are errors). Then `get_shopping_list`, then `get_cut_list`" +
            (cabinet ? ` for ${cabinet}` : "") +
            ", then `get_build_steps`" +
            (cabinet ? ` for ${cabinet}` : "") +
            ". Read the steps in order, explaining the 32 mm hole pattern and any drawer-box " +
            "sizes as they come up. Remind me to verify measurements before every cut.",
        },
      },
    ],
  }),
);

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("frame(less) MCP server ready on stdio.");
  // Log the RESOLVED absolute paths so a cwd mismatch with the dev server (which
  // watches CABINETS_LIVE_FILE relative to ITS cwd) is diagnosable.
  console.error(`  autosave working file: ${session.workingPath ?? "(none — save_project to set one)"}`);
  console.error(`  live preview file:     ${session.liveFile ?? "(none — set CABINETS_LIVE_FILE for live)"}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
