/**
 * Pure layout for the pocket-hole 3D bench view: where the pockets sit on the
 * board being drilled. No three.js here — colocated golden tests pin it.
 *
 * Convention (matches the drill schedule): a part's pockets live near its two
 * LENGTH ends (that's where it joins its neighbours), spread evenly across the
 * width, ~1 3/4" in from the end so the drill body clears the edge. The board
 * is drawn lying on the bench with the DRILLED face up — exactly how you hold
 * it under the jig.
 */
import { Part } from "@/domain/types";
import { PocketRow } from "@/engine/pocketHoles";
import { r3 } from "@/engine/units";

export interface PocketMarker {
  /** Along the board's length (inches from the left end). */
  x: number;
  /** Across the board's width (inches from the near edge). */
  z: number;
  /** Which length-end the screw exits: -1 = left, 1 = right. */
  toward: -1 | 1;
}

export interface PocketBoardLayout {
  length: number;
  width: number;
  /** Board thickness for display — the jig setting (≈ the stock). */
  thickness: number;
  markers: PocketMarker[];
}

export function pocketBoardLayout(p: Part, row: PocketRow): PocketBoardLayout {
  const perEnd = Math.max(1, Math.round(row.perPiece / 2));
  const inset = Math.min(1.75, r3(p.length / 4));
  const markers: PocketMarker[] = [];
  for (const end of [0, 1] as const) {
    const x = end === 0 ? inset : r3(p.length - inset);
    for (let i = 0; i < perEnd; i++) {
      markers.push({
        x,
        z: r3((p.width * (i + 1)) / (perEnd + 1)),
        toward: end === 0 ? -1 : 1,
      });
    }
  }
  return { length: p.length, width: p.width, thickness: row.spec.setting, markers };
}
