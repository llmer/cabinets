import { Part, Role, Settings } from "@/domain/types";
import { isInset, isOpenBox } from "./geometry";
import { Run, baseSegments } from "./runs";
import { r3 } from "./units";

/** A plain (un-banded) part on a given role's stock. */
function mkPart(
  name: string,
  qty: number,
  length: number,
  width: number,
  role: Role,
  s: Settings,
): Part {
  return {
    name,
    qty,
    length: r3(length),
    width: r3(width),
    role,
    stockId: s.roleStock[role],
    bandAll: false,
    bandFrontEdge: 0,
    linear: s.stocks[s.roleStock[role]].kind === "linear",
  };
}

/**
 * The ONE continuous face frame skinned across a run: shared stiles at every
 * joint (members + 1, not 2·members), a top rail per bay, a bottom rail per
 * closed bay (taller where it drops over a toe kick), and inset mid rails. Same
 * part NAMES as the per-cabinet frame, so the cut list / steps treat them
 * identically; lengths key off each bay's run opening, so the doubled joint
 * stiles collapse to one.
 */
export function genRunFrameParts(run: Run, s: Settings): Part[] {
  if (!run.framed) return [];
  const ff = s.frameWidth || 1.5;
  const parts: Part[] = [];
  const add = (name: string, qty: number, length: number, width: number) =>
    parts.push(mkPart(name, qty, length, width, "faceFrame", s));

  // Shared stiles — one between every pair of bays, plus the two run ends. Each
  // stile runs down to the LOWER frame bottom of the two bays it borders, so a
  // stile beside an appliance opening / desk reaches the floor.
  const ms = run.members;
  for (let i = 0; i <= ms.length; i++) {
    const left = ms[i - 1];
    const right = ms[i];
    const bottom = Math.min(left?.frameBottom ?? Infinity, right?.frameBottom ?? Infinity);
    add("Face-frame stile", 1, run.frameTop - bottom, ff);
  }

  for (const m of run.members) {
    const c = m.cabinet;
    const ow = m.openingWidth;
    add("Face-frame top rail", 1, ow, ff);
    // Closed bays get a bottom rail; over a toe kick it grows down to this bay's
    // frame bottom so the inset opening (and its fronts) keep their height. A
    // floor-standing closed bay just gets a normal rail — never a negative one.
    if (!isOpenBox(c)) {
      add("Face-frame bottom rail", 1, ow, r3(ff + Math.max(0, m.yB - m.frameBottom)));
    }
    if (isInset(c)) {
      const mid =
        c.frontStyle === "drawers" || c.frontStyle === "desk"
          ? c.drawerCount - 1
          : c.frontStyle === "door_drawer"
            ? 1
            : 0;
      if (mid > 0) add("Face-frame mid rail", mid, ow, ff);
    }
  }
  return parts;
}

/**
 * The separate toe-kick base: a plywood ladder (front fascia + back rail +
 * cross members) per contiguous toe-kicked segment, recessed `toeKickDepth` at
 * the front, plus a recessed side return on each exposed run end. On sheet
 * stock, so it nests and is priced per sheet.
 */
export function genBaseParts(run: Run, s: Settings): Part[] {
  if (run.lane !== "base") return [];
  const parts: Part[] = [];
  const h = s.toeKick;
  const add = (name: string, qty: number, length: number, width: number) =>
    parts.push(mkPart(name, qty, length, width, "base", s));

  for (const seg of baseSegments(run)) {
    const first = seg[0];
    const last = seg[seg.length - 1];
    const fi = run.members.indexOf(first);
    const li = run.members.indexOf(last);
    // Exposed at a run end, or wherever the base stops mid-run against a
    // non-based bay (open knee / appliance gap / floor-standing neighbour).
    // (first.leftEnd / last.rightEnd short-circuit the out-of-range lookups.)
    const leftExp = first.leftEnd || !run.members[fi - 1].hasBase;
    const rightExp = last.rightEnd || !run.members[li + 1].hasBase;
    const segWidth = last.x1 - first.x0;
    const fpW = r3(
      Math.max(0, segWidth - (leftExp ? s.toeKickSideRecess : 0) - (rightExp ? s.toeKickSideRecess : 0)),
    );
    const fpD = r3(Math.max(6, first.cabinet.depth - s.toeKickDepth));
    const crosses = Math.max(2, Math.ceil(fpW / 16) + 1);
    const returns = (leftExp ? 1 : 0) + (rightExp ? 1 : 0);
    add("Toe-kick fascia", 1, fpW, h);
    add("Base back rail", 1, fpW, h);
    add("Base cross member", crosses, fpD, h);
    if (returns > 0) add("Toe-kick return", returns, fpD, h);
  }
  return parts;
}
