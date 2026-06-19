import { HardwarePricing, Part } from "@/domain/types";

/**
 * Hinges per door, banded by door height (inches). Frameless overlay practice:
 * up to 40" → 2, to 60" → 3, to 78" → 4, taller → 5.
 */
export function hingesForDoorHeight(h: number): number {
  if (h <= 40) return 2;
  if (h <= 60) return 3;
  if (h <= 78) return 4;
  return 5;
}

export interface HardwareCounts {
  doors: number;
  drawers: number;
  hinges: number;
  /** Drawer-slide pairs (one per drawer). */
  slides: number;
  pulls: number;
  shelfPins: number;
}

/** Tally hardware from a flat list of cut-list parts. */
export function countHardware(parts: Part[], pricing: HardwarePricing): HardwareCounts {
  let doors = 0;
  let drawers = 0;
  let hinges = 0;
  let slides = 0;
  let shelves = 0;
  for (const p of parts) {
    if (p.name === "Door") {
      doors += p.qty;
      hinges += p.qty * hingesForDoorHeight(p.width);
    } else if (p.name === "Drawer front") {
      drawers += p.qty;
      slides += p.qty;
    } else if (p.name === "Adjustable shelf") {
      shelves += p.qty;
    }
  }
  const pulls = pricing.countPulls ? doors + drawers : 0;
  const shelfPins = shelves * 4;
  return { doors, drawers, hinges, slides, pulls, shelfPins };
}

export function addCounts(a: HardwareCounts, b: HardwareCounts): HardwareCounts {
  return {
    doors: a.doors + b.doors,
    drawers: a.drawers + b.drawers,
    hinges: a.hinges + b.hinges,
    slides: a.slides + b.slides,
    pulls: a.pulls + b.pulls,
    shelfPins: a.shelfPins + b.shelfPins,
  };
}

export const ZERO_COUNTS: HardwareCounts = {
  doors: 0,
  drawers: 0,
  hinges: 0,
  slides: 0,
  pulls: 0,
  shelfPins: 0,
};

export function hardwareCost(counts: HardwareCounts, pricing: HardwarePricing): number {
  return (
    counts.hinges * pricing.hingeEach +
    counts.slides * pricing.slidePairEach +
    counts.pulls * pricing.pullEach +
    counts.shelfPins * pricing.shelfPinEach
  );
}
