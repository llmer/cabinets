import { Part, Role, Settings } from "@/domain/types";
import { isInset, isOpenBox } from "./geometry";
import { Run, RunMember, baseSegments } from "./runs";
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
 * The ONE continuous face frame skinned across a run, built as a ladder: ONE
 * long top rail and ONE long bottom rail (per closed span) run the whole width,
 * and the shared stiles (members + 1, not 2·members) are captured BETWEEN them.
 * A stile rests on its bottom rail where both bays it borders are closed, and
 * runs on down to the floor beside an open bay (which has no bottom rail). Same
 * part NAMES as the per-cabinet frame, so the cut list / steps treat them
 * identically; mid-rail lengths key off each bay's run opening.
 */
export function genRunFrameParts(run: Run, s: Settings): Part[] {
  if (!run.framed) return [];
  const ff = s.frameWidth || 1.5;
  const topRail = s.faceFrameTop || 2; // the (wider) top rail across a framed run
  const ms = run.members;
  const parts: Part[] = [];
  const add = (name: string, qty: number, length: number, width: number) =>
    parts.push(mkPart(name, qty, length, width, "faceFrame", s));

  // ONE continuous top rail across the whole run — the top of the frame is a
  // single long board, and every stile hangs beneath it.
  const stileTop = r3(run.frameTop - topRail);
  add("Face-frame top rail", 1, r3(run.x1 - run.x0), topRail);

  // Continuous bottom rails — one long board per contiguous span of closed bays
  // that share a box + frame bottom (so a single board's height and position are
  // uniform). Open bays (appliance opening / desk knee) break the span and take
  // no bottom rail; over a toe kick the board grows down to the frame bottom.
  for (const seg of bottomRailSegments(ms)) {
    const first = seg[0];
    const last = seg[seg.length - 1];
    // Own the corners: at a run end the rail reaches the frame edge (the end
    // stile sits on it); against an open bay it butts into the full-height stile.
    const segLeft = first.leftEnd ? run.x0 : first.openingLeft;
    const segRight = last.rightEnd ? run.x1 : r3(last.openingLeft + last.openingWidth);
    add(
      "Face-frame bottom rail",
      1,
      r3(segRight - segLeft),
      r3(ff + Math.max(0, first.yB - first.frameBottom)),
    );
  }

  // Shared stiles — one between every pair of bays, plus the two run ends —
  // captured between the rails. Each rests on the higher of its two neighbours'
  // rail feet: a closed bay's stile sits on its bottom rail (box bottom + a rail
  // width); an open bay has none, so the stile runs on down to the floor.
  const sideFoot = (m: RunMember): number =>
    isOpenBox(m.cabinet) ? m.frameBottom : r3(m.yB + ff);
  for (let i = 0; i <= ms.length; i++) {
    const left = ms[i - 1];
    const right = ms[i];
    const foot = Math.min(left ? sideFoot(left) : Infinity, right ? sideFoot(right) : Infinity);
    add("Face-frame stile", 1, r3(stileTop - foot), ff);
  }

  // Inset mid rails still fit between the stiles at each bay's opening.
  for (const m of run.members) {
    const c = m.cabinet;
    if (!isInset(c)) continue;
    const mid =
      c.frontStyle === "drawers"
        ? c.drawerCount - 1
        : c.frontStyle === "desk"
          ? c.drawerCount // a rail between drawers PLUS one under the drawer
          : c.frontStyle === "door_drawer"
            ? 1
            : 0;
    if (mid > 0) add("Face-frame mid rail", mid, m.openingWidth, ff);
  }
  return parts;
}

/**
 * The pocket-hole joints in a run's ladder frame, derived from the SAME
 * stile/span logic as genRunFrameParts so the build guide and the screw
 * counts can never drift from the geometry. Each count is member ENDS that
 * get pockets (2 pockets/screws per end):
 * - every stile joins the continuous top rail (top end);
 * - a stile whose foot RESTS on a bottom rail joins it (bottom end) — a
 *   floor-running stile beside an open bay joins only at the top;
 * - a bottom-rail end that BUTTS a full-height stile mid-run (not a run end,
 *   where it reaches the frame edge under the end stile) gets pockets;
 * - every mid rail joins a stile at both ends.
 */
export interface RunFrameJoints {
  stileTopEnds: number;
  stileBottomEnds: number;
  railButtEnds: number;
  midRailEnds: number;
}

export function runFrameJoints(run: Run, s: Settings): RunFrameJoints {
  const ff = s.frameWidth || 1.5;
  const ms = run.members;
  if (!run.framed) return { stileTopEnds: 0, stileBottomEnds: 0, railButtEnds: 0, midRailEnds: 0 };

  const sideFoot = (m: RunMember): number =>
    isOpenBox(m.cabinet) ? m.frameBottom : r3(m.yB + ff);
  let stileBottomEnds = 0;
  for (let i = 0; i <= ms.length; i++) {
    const near = [ms[i - 1], ms[i]].filter((m): m is RunMember => !!m);
    const closed = near.filter((m) => !isOpenBox(m.cabinet));
    if (closed.length === 0) continue; // floor-running beside open bays only
    const foot = Math.min(...near.map(sideFoot));
    // The stile rests on a rail only when the LOWEST foot is a rail top — an
    // open neighbour with a lower frame bottom sends it past the rail to the floor.
    if (closed.some((m) => sideFoot(m) === foot)) stileBottomEnds++;
  }

  // A rail end butts the stile only when the stile passes DOWN past this
  // rail's top — beside an open bay (floor-running stile), or beside a closed
  // span whose own rail sits lower (the stile rests on THAT one; this rail
  // stops against its side). The lower rail's end runs under the resting
  // stile and needs no pockets; at a run end the rail reaches the frame edge.
  const butts = (neighbor: RunMember | undefined, self: RunMember): boolean =>
    !!neighbor && sideFoot(neighbor) < sideFoot(self);
  let railButtEnds = 0;
  for (const seg of bottomRailSegments(ms)) {
    const fi = ms.indexOf(seg[0]);
    const li = ms.indexOf(seg[seg.length - 1]);
    if (!seg[0].leftEnd && butts(ms[fi - 1], seg[0])) railButtEnds++;
    if (!seg[seg.length - 1].rightEnd && butts(ms[li + 1], seg[seg.length - 1])) railButtEnds++;
  }

  let midRailEnds = 0;
  for (const m of ms) {
    const c = m.cabinet;
    if (!isInset(c)) continue;
    const mid =
      c.frontStyle === "drawers"
        ? c.drawerCount - 1
        : c.frontStyle === "desk"
          ? c.drawerCount
          : c.frontStyle === "door_drawer"
            ? 1
            : 0;
    midRailEnds += 2 * Math.max(0, mid);
  }

  return { stileTopEnds: ms.length + 1, stileBottomEnds, railButtEnds, midRailEnds };
}

/**
 * Contiguous spans of closed bays that share a box + frame bottom — one
 * continuous bottom rail each. Open bays break a span (they carry no bottom
 * rail), and a change in box/frame bottom (a floor-standing bay beside a
 * toe-kicked one) starts a fresh board so each rail stays a single height.
 */
function bottomRailSegments(ms: RunMember[]): RunMember[][] {
  const segs: RunMember[][] = [];
  let cur: RunMember[] = [];
  const flush = () => {
    if (cur.length) segs.push(cur);
    cur = [];
  };
  for (const m of ms) {
    if (isOpenBox(m.cabinet)) {
      flush();
      continue;
    }
    const prev = cur[cur.length - 1];
    if (prev && (prev.yB !== m.yB || prev.frameBottom !== m.frameBottom)) flush();
    cur.push(m);
  }
  flush();
  return segs;
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
