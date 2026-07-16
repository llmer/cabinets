/**
 * Design audit — pure, framework-free checks that turn silent geometry into
 * actionable warnings. This is the domain expertise a human shop-hand would
 * bring to a plan review: "that single door is too wide", "this bank leaves the
 * drawers 2 inches tall", "that panel won't fit on a sheet", "the appliance gap
 * is sharing a face frame with its neighbours".
 *
 * It reads the SAME derived model the rest of the app renders (`compute`), so
 * an agent auditing a project sees exactly what the builder will cut. Nothing
 * here mutates; it only reports.
 */
import { Cabinet, Settings } from "@/domain/types";
import { Model, compute } from "./compute";
import { drawerStackBudget, getDrawerHeights } from "./drawers";
import { effectiveFrameWidth, isFramed, isOpenBox } from "./geometry";
import { runsOf } from "./runs";
import { r3 } from "./units";

export type AuditLevel = "error" | "warn" | "info";

export interface AuditFinding {
  level: AuditLevel;
  /** Stable machine code (e.g. "wide_door") for programmatic handling. */
  code: string;
  /** Human-readable, one-line statement of the issue. */
  message: string;
  /** Suggested remedy, when there's an obvious one. */
  fix?: string;
  /** Scope, when the finding is about one cabinet or run. */
  cabinet?: string;
  cabinetId?: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  errors: number;
  warnings: number;
  infos: number;
  /** True when there are no ERROR-level findings (design is buildable). */
  ok: boolean;
}

/** A door wider than this (inches) tends to sag / rack over time. */
const MAX_SINGLE_DOOR_W = 24;
/** Warn when a drawer front ends up shorter than this (inches). */
const MIN_DRAWER_FRONT_H = 3;
/** Flag sheet yields below this as wasteful. */
const LOW_YIELD_PCT = 55;

const inch = (x: number): string => `${+x.toFixed(3)}"`;

function hasDrawers(c: Cabinet): boolean {
  return c.frontStyle === "drawers" || c.frontStyle === "desk" || c.frontStyle === "door_drawer";
}

/**
 * Audit a project. Pass a precomputed `model` to avoid recomputing when the
 * caller already has one; otherwise it is derived here.
 */
export function auditProject(cabinets: Cabinet[], s: Settings, model?: Model): AuditReport {
  const m = model ?? compute(cabinets, s);
  const out: AuditFinding[] = [];
  const push = (f: AuditFinding) => out.push(f);
  const scope = (c: Cabinet) => ({ cabinet: c.name, cabinetId: c.id });

  /* ---- project-level ---- */
  if (cabinets.length === 0) {
    push({
      level: "info",
      code: "no_cabinets",
      message: "The project has no cabinets yet.",
      fix: "Add a base, wall or tall cabinet to get started.",
    });
    return finalize(out);
  }

  // Reveal sanity (affects every overlay front + inset gap).
  if (s.reveal <= 0) {
    push({
      level: "warn",
      code: "reveal_zero",
      message: `Reveal is ${inch(s.reveal)} — adjacent fronts will butt together with no gap.`,
      fix: "Set a reveal around 1/8\" (0.125) so doors and drawers don't bind.",
    });
  } else if (s.reveal > 0.25) {
    push({
      level: "info",
      code: "reveal_large",
      message: `Reveal is ${inch(s.reveal)}, wider than the usual 1/8\"–3/16\".`,
    });
  }

  // Oversize panels — a part that fits on no sheet. Hard stop for the builder.
  for (const pack of m.packs) {
    for (const r of pack.oversize) {
      push({
        level: "error",
        code: "part_oversize",
        message: `"${r.part}" for ${r.label} is ${inch(r.w)} × ${inch(r.h)} and won't fit a ${pack.label} sheet (${inch(pack.sheetW)} × ${inch(pack.sheetH)}).`,
        fix: "Split the panel with a seam, choose a larger sheet, or shrink the cabinet.",
      });
    }
  }

  // Hardwood boards on hand — parts the declared boards can't produce.
  for (const bp of m.boardPacks) {
    for (const r of bp.oversize) {
      push({
        level: "error",
        code: "board_oversize",
        message: `"${r.part}" for ${r.label} needs ${inch(r.length)} × ${inch(r.width)} and no ${bp.label} board on hand is that big.`,
        fix: "Add a longer/wider board to the stock's board list, or shrink the part.",
      });
    }
    if (bp.shortfall.length > 0) {
      const lf = Math.ceil(bp.shortfall.reduce((a, x) => a + x.length, 0) / 12);
      push({
        level: "warn",
        code: "board_shortfall",
        message: `${bp.label}: ${bp.shortfall.length} part(s) (~${lf} lf) don't fit the boards on hand — the boards run out.`,
        fix: "Buy another board and add it in Settings → Materials (or via update_stock boards).",
      });
    }
  }

  // Sheet yield — informational nudge when a lot of material is offcut.
  if (m.summary.sheetCount >= 1 && m.summary.yieldPct > 0 && m.summary.yieldPct < LOW_YIELD_PCT) {
    push({
      level: "info",
      code: "low_yield",
      message: `Sheet yield is ${m.summary.yieldPct}% across ${m.summary.sheetCount} sheet${m.summary.sheetCount > 1 ? "s" : ""} — a lot of offcut.`,
      fix: s.allowRotate
        ? "Nudge cabinet widths, add a smaller sheet stock for the offcuts, or accept that tall panels strand fill."
        : "Turn on 'allow rotate' in Settings to nest tighter, or nudge cabinet widths.",
    });
  }

  /* ---- per-cabinet ---- */
  const partsById = new Map(m.cabinetParts.map((cp) => [cp.cabinet.id, cp.parts]));
  for (const c of cabinets) {
    // Front style vs. count coherence.
    if ((c.frontStyle === "drawers" || c.frontStyle === "desk") && c.drawerCount < 1) {
      push({ level: "error", code: "front_count_mismatch", message: `${c.name} (${c.frontStyle === "desk" ? "desk" : "drawer bank"}) has no drawers.`, fix: "Set at least one drawer.", ...scope(c) });
    }
    if ((c.frontStyle === "doors" || c.frontStyle === "door_drawer") && c.doorCount < 1) {
      push({ level: "error", code: "front_count_mismatch", message: `${c.name} has doors in its front style but 0 doors.`, fix: "Set at least one door, or switch the front style.", ...scope(c) });
    }
    if (c.frontStyle === "door_drawer" && c.drawerCount < 1) {
      push({ level: "warn", code: "front_count_mismatch", message: `${c.name} is drawer-over-doors but has 0 drawers.`, fix: "Set one drawer, or switch to plain doors.", ...scope(c) });
    }

    // Open-box fronts must stand on the floor (no toe kick).
    if (isOpenBox(c) && c.toeKick === true) {
      push({ level: "warn", code: "open_box_toekick", message: `${c.name} (${c.frontStyle}) has a toe kick, but a desk/opening stands on the floor.`, fix: "Turn the toe kick off so the height math and legs are right.", ...scope(c) });
    }

    // Front opening — the sides (frameless) or the face-frame stiles (framed) must
    // leave a usable opening. For framed cabinets the frame opening is the tighter
    // constraint than the carcass interior, so measure it directly.
    const opening = r3(c.width - 2 * effectiveFrameWidth(c, s));
    if (opening <= 0) {
      push({ level: "error", code: "too_narrow", message: `${c.name} is ${inch(c.width)} wide — the ${isFramed(c) ? "face-frame stiles" : "side panels"} leave no opening.`, fix: "Widen the cabinet.", ...scope(c) });
    } else if (opening < 6) {
      push({ level: "warn", code: "too_narrow", message: `${c.name} has only ${inch(opening)} of front opening — very tight for hardware.`, ...scope(c) });
    }

    // Depth sanity.
    if (c.type !== "wall" && c.depth < 12) {
      push({ level: "info", code: "shallow_base", message: `${c.name} is only ${inch(c.depth)} deep — shallow for a base/tall cabinet.`, ...scope(c) });
    }
    if (c.type === "wall" && c.depth > 20) {
      push({ level: "info", code: "deep_wall", message: `${c.name} is ${inch(c.depth)} deep — unusually deep for a wall cabinet.`, ...scope(c) });
    }

    // Drawer stack budget.
    if (hasDrawers(c) && c.drawerCount >= 1) {
      const budget = drawerStackBudget(c, s);
      if (budget <= 0) {
        push({ level: "error", code: "drawer_budget_negative", message: `${c.name} has no vertical room for its ${c.drawerCount} drawer${c.drawerCount > 1 ? "s" : ""} (budget ${inch(budget)}).`, fix: "Reduce the drawer count, or the top-rail / knee reserve.", ...scope(c) });
      } else {
        // Use the ACTUAL resolved fronts, not the even split, so a custom stack
        // with a too-short front (e.g. [1, 1, 27]) is still caught.
        const heights = getDrawerHeights(c, s);
        const shortest = heights.length ? Math.min(...heights) : 0;
        if (shortest > 0 && shortest < MIN_DRAWER_FRONT_H) {
          push({ level: "warn", code: "drawer_too_short", message: `${c.name} has a drawer front about ${inch(shortest)} tall — quite short.`, fix: "Use fewer/taller drawers, or a taller box.", ...scope(c) });
        }
      }
      // Flag ANY silent refit the engine will do — wrong length, an under-min
      // front, or over budget — so what get_cabinet shows matches what's cut.
      if (Array.isArray(c.drawerHeights) && c.drawerHeights.length) {
        const resolved = getDrawerHeights(c, s);
        const stored = c.drawerHeights;
        const refit =
          stored.length !== resolved.length ||
          stored.some((x, i) => Math.abs(x - resolved[i]) > 0.03);
        if (refit) {
          push({ level: "info", code: "drawer_heights_refit", message: `${c.name}'s saved drawer heights don't fit and are auto-adjusted to ${resolved.map((h) => inch(h)).join(", ")}.`, fix: "Re-split the drawer heights to clear this.", ...scope(c) });
        }
      }
    }

    // Wide doors (from the actual cut list — handles overlay/inset/run widths).
    const parts = partsById.get(c.id) ?? [];
    let widest = 0;
    for (const p of parts) if (p.name === "Door") widest = Math.max(widest, p.length);
    if (widest > MAX_SINGLE_DOOR_W) {
      push({ level: "warn", code: "wide_door", message: `${c.name} has a door about ${inch(widest)} wide — over ${MAX_SINGLE_DOOR_W}" a single door can sag or warp.`, fix: "Split it into a pair of doors, or add a mid-stile.", ...scope(c) });
    }
  }

  /* ---- run-level ---- */
  for (const run of runsOf(cabinets, s)) {
    if (run.lane !== "base") continue;
    // Both checks are only real problems when a CONTINUOUS face frame is actually
    // skinned across the run (framed boxes + the toggle on). A frameless run — or
    // one with the continuous frame off — emits no shared frame to span the gap or
    // step over a mixed toe kick, so flagging it would be a false positive.
    const sharedFrame = s.continuousFaceFrame && run.framed;
    if (!sharedFrame) continue;

    const closed = run.members.filter((mm) => !isOpenBox(mm.cabinet) && mm.cabinet.type !== "wall");
    const kicks = new Set(closed.map((mm) => mm.cabinet.toeKick !== false));
    if (kicks.size > 1) {
      const span = `${run.members[0].cabinet.name}–${run.members[run.members.length - 1].cabinet.name}`;
      push({
        level: "warn",
        code: "mixed_toekick_run",
        message: `Run ${span} mixes toe-kicked and floor-standing cabinets under one continuous face frame — the frame bottom will step.`,
        fix: "Give the odd cabinet a run break, or match the toe-kick setting across the run.",
      });
    }
    // Appliance opening sitting under the continuous frame, which skins the gap.
    for (const mm of run.members) {
      if (mm.cabinet.frontStyle === "opening" && run.members.length > 1) {
        push({
          level: "info",
          code: "appliance_opening_joined",
          message: `Appliance opening ${mm.cabinet.name} sits under the run's continuous face frame, which skins across the gap.`,
          fix: "If it's a freestanding appliance gap (fridge, range), set a run break so the frame doesn't span it.",
          ...scope(mm.cabinet),
        });
      }
    }
  }

  return finalize(out);
}

function finalize(findings: AuditFinding[]): AuditReport {
  const order: Record<AuditLevel, number> = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  const infos = findings.filter((f) => f.level === "info").length;
  return { findings, errors, warnings, infos, ok: errors === 0 };
}
