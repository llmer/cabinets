import { Units } from "@/domain/types";

/** Round to 3 decimals — the working precision used throughout the engine. */
export function r3(x: number): number {
  return +x.toFixed(3);
}

const MM_PER_IN = 25.4;

export function inToMm(x: number): number {
  return x * MM_PER_IN;
}
export function mmToIn(x: number): number {
  return x / MM_PER_IN;
}

/**
 * Format a decimal-inch value as a shop fraction (to the nearest 1/16").
 * Ported verbatim from the imported design's `toFrac`.
 */
export function toFrac(x: number | null | undefined): string {
  if (x == null || isNaN(x)) return "—";
  const neg = x < 0;
  x = Math.abs(x);
  const denom = 16;
  const total = Math.round(x * denom);
  const whole = Math.floor(total / denom);
  let n = total - whole * denom;
  let d = denom;
  while (n > 0 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  let s: string;
  if (n === 0) s = whole + '"';
  else if (whole === 0) s = n + "/" + d + '"';
  else s = whole + " " + n + "/" + d + '"';
  return (neg ? "-" : "") + s;
}

/** Format a millimetre value (rounded to 0.1 mm, trailing .0 cleaned). */
export function toMm(x: number | null | undefined): string {
  if (x == null || isNaN(x)) return "—";
  const mm = Math.round(inToMm(x) * 10) / 10;
  const s = Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
  return s + " mm";
}

/** Format a length for display in the active unit system. */
export function fmtLen(x: number | null | undefined, units: Units): string {
  return units === "mm" ? toMm(x) : toFrac(x);
}

/** Short unit label. */
export function unitLabel(units: Units): string {
  return units === "mm" ? "mm" : "in";
}

/**
 * Parse a length string the user typed. Accepts decimals, mixed fractions
 * (e.g. "24 1/2"), bare fractions ("3/4"), and millimetres when in mm mode.
 * Returns NaN if it cannot be parsed.
 */
export function parseLen(raw: string, units: Units): number {
  const txt = String(raw).trim().replace(/["”in]+$/i, "").replace(/mm$/i, "").trim();
  if (txt === "") return NaN;
  let inches: number;
  // mixed fraction: "24 1/2"
  const mixed = /^(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/.exec(txt);
  const frac = /^(-?\d+)\s*\/\s*(\d+)$/.exec(txt);
  if (mixed) {
    const whole = parseFloat(mixed[1]);
    const num = parseFloat(mixed[2]);
    const den = parseFloat(mixed[3]);
    const sign = whole < 0 ? -1 : 1;
    inches = whole + sign * (num / den);
  } else if (frac) {
    inches = parseFloat(frac[1]) / parseFloat(frac[2]);
  } else {
    inches = parseFloat(txt);
  }
  if (isNaN(inches)) return NaN;
  return units === "mm" ? mmToIn(inches) : inches;
}

/** Convert a stored inch value to the editable number shown in the active unit. */
export function toDisplayNumber(inches: number, units: Units): number {
  return units === "mm" ? Math.round(inToMm(inches) * 10) / 10 : inches;
}

/** Inverse of `toDisplayNumber` for committing edits. */
export function fromDisplayNumber(value: number, units: Units): number {
  return units === "mm" ? mmToIn(value) : value;
}
