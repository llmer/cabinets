import { Cabinet, Settings } from "@/domain/types";
import { boxHeight, isFramed, isOpenBox } from "./geometry";
import { r3 } from "./units";

/**
 * A "run" is a contiguous row of cabinets that are physically joined and so
 * share structure: ONE continuous face frame skinned across the joints, and
 * ONE toe-kick base they all sit on. Runs are *derived*, never stored — the
 * only persisted hint is the per-cabinet `runBreak` escape hatch.
 *
 * Grouping mirrors how the renderers lay the row out (`bx += c.width` within a
 * lane), so member x-positions line up with `three/CabinetScene` and
 * `views/Elevation`. A run breaks at a `runBreak`, at a lane/type change (a
 * tall pantry never shares a base frame with the bases), or at a height/depth
 * change (a continuous frame can only span a uniform front plane).
 */
export interface RunMember {
  cabinet: Cabinet;
  /** Index in the original `cabinets[]` — used for the legend colour. */
  index: number;
  /** Global cumulative x within the lane (inches), matching the renderers. */
  x0: number;
  x1: number;
  /** Box bottom / top off the floor (inches). */
  yB: number;
  boxTop: number;
  /** This member is at an exposed END of the run (left / right). */
  leftEnd: boolean;
  rightEnd: boolean;
  /**
   * Inset opening width for this bay inside the *run* frame: a full stile on an
   * exposed end, a shared half-stile at an interior joint. Wider than the old
   * per-box `W - 2·frameWidth` at every shared joint.
   */
  openingWidth: number;
  /** Global x of this bay's opening left edge (for rendering). */
  openingLeft: number;
  /** Contributes a toe-kick base segment (closed, toe-kicked base/tall). */
  hasBase: boolean;
  /**
   * Where THIS bay's face frame stops off the floor: `faceFrameFloorGap` over a
   * toe kick (overhanging the recessed fascia), else the box bottom — so an
   * appliance opening or open desk runs its frame all the way to the floor. A
   * shared stile takes the lower of its two bays.
   */
  frameBottom: number;
}

export interface Run {
  id: string;
  lane: "base" | "wall";
  framed: boolean;
  members: RunMember[];
  /** Global span of the run within its lane. */
  x0: number;
  x1: number;
  /** Continuous face-frame top off the floor (uniform across the run). */
  frameTop: number;
}

function laneOf(c: Cabinet): "base" | "wall" {
  return c.type === "wall" ? "wall" : "base";
}

/** A closed, toe-kicked base/tall cabinet that sits on a real toe-kick base. */
function isBased(c: Cabinet): boolean {
  return c.type !== "wall" && c.toeKick !== false && !isOpenBox(c);
}

/** Box bottom off the floor (inches): toe-kick lift, upper height, or floor. */
function memberYB(c: Cabinet, s: Settings): number {
  if (c.type === "wall") return s.upperBottom;
  return isBased(c) ? s.toeKick : 0;
}

/** Two adjacent cabinets in a lane belong to the same run. */
function joins(prev: Cabinet, c: Cabinet): boolean {
  if (c.runBreak === true) return false;
  if (prev.type !== c.type) return false; // a tall never joins a base frame
  if (isFramed(prev) !== isFramed(c)) return false;
  if (prev.height !== c.height) return false; // uniform front plane only
  if (prev.depth !== c.depth) return false;
  return true;
}

interface Slot {
  c: Cabinet;
  index: number;
  x0: number;
  x1: number;
}

function buildRun(group: Slot[], lane: "base" | "wall", s: Settings, seq: number): Run {
  const ff = s.frameWidth || 1.5;
  const framed = isFramed(group[0].c);
  const tops = group.map((g) => memberYB(g.c, s) + boxHeight(g.c, s));
  const frameTop = Math.max(...tops);

  const members: RunMember[] = group.map((g, i) => {
    const leftEnd = i === 0;
    const rightEnd = i === group.length - 1;
    // Shared stiles: a full stile on an exposed end, half a stile at a joint.
    const leftBorder = framed ? (leftEnd ? ff : ff / 2) : 0;
    const rightBorder = framed ? (rightEnd ? ff : ff / 2) : 0;
    return {
      cabinet: g.c,
      index: g.index,
      x0: g.x0,
      x1: g.x1,
      yB: memberYB(g.c, s),
      boxTop: r3(memberYB(g.c, s) + boxHeight(g.c, s)),
      leftEnd,
      rightEnd,
      openingWidth: r3(g.c.width - leftBorder - rightBorder),
      openingLeft: r3(g.x0 + leftBorder),
      hasBase: isBased(g.c),
      // Toe-kicked bays stop at the frame-floor gap; floor-standing bays (an
      // appliance opening / open desk) run their frame to the floor.
      frameBottom: r3(isBased(g.c) ? s.faceFrameFloorGap : memberYB(g.c, s)),
    };
  });

  return {
    id: `run:${lane}:${seq}`,
    lane,
    framed,
    members,
    x0: group[0].x0,
    x1: group[group.length - 1].x1,
    frameTop: r3(frameTop),
  };
}

/** Group cabinets into derived runs (base lane, then wall lane). Pure. */
export function runsOf(cabinets: Cabinet[], s: Settings): Run[] {
  const runs: Run[] = [];
  let seq = 0;
  for (const lane of ["base", "wall"] as const) {
    const laneCabs = cabinets
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => laneOf(c) === lane);
    let x = 0;
    let group: Slot[] = [];
    const flush = () => {
      if (group.length) runs.push(buildRun(group, lane, s, seq++));
      group = [];
    };
    laneCabs.forEach(({ c, index }, i) => {
      if (i > 0 && !joins(laneCabs[i - 1].c, c)) flush();
      group.push({ c, index, x0: x, x1: x + c.width });
      x += c.width;
    });
    flush();
  }
  return runs;
}

/** Contiguous spans of toe-kicked members within a run — one base ladder each. */
export function baseSegments(run: Run): RunMember[][] {
  const segs: RunMember[][] = [];
  let cur: RunMember[] = [];
  for (const m of run.members) {
    if (m.hasBase) {
      cur.push(m);
    } else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}
