import { describe, expect, it } from "vitest";
import { fmtLen, parseLen, toFrac, toMm } from "./units";

describe("toFrac", () => {
  it("formats whole inches", () => {
    expect(toFrac(24)).toBe('24"');
    expect(toFrac(0)).toBe('0"');
  });
  it("reduces fractions to lowest terms", () => {
    expect(toFrac(0.5)).toBe('1/2"');
    expect(toFrac(0.25)).toBe('1/4"');
    expect(toFrac(0.125)).toBe('1/8"');
    expect(toFrac(0.0625)).toBe('1/16"');
  });
  it("formats mixed numbers", () => {
    expect(toFrac(34.5)).toBe('34 1/2"');
    expect(toFrac(11.875)).toBe('11 7/8"');
    expect(toFrac(29.875)).toBe('29 7/8"');
  });
  it("rounds to the nearest 1/16", () => {
    expect(toFrac(23.26)).toBe('23 1/4"'); // 23.26 -> 23 4.16/16 -> 4/16
  });
  it("handles negatives and nullish", () => {
    expect(toFrac(-0.5)).toBe('-1/2"');
    expect(toFrac(NaN)).toBe("—");
    expect(toFrac(null)).toBe("—");
  });
});

describe("toMm / fmtLen", () => {
  it("converts inches to mm", () => {
    expect(toMm(1)).toBe("25.4 mm");
    expect(toMm(24)).toBe("609.6 mm");
  });
  it("respects the unit system", () => {
    expect(fmtLen(24, "in")).toBe('24"');
    expect(fmtLen(24, "mm")).toBe("609.6 mm");
  });
});

describe("parseLen", () => {
  it("parses decimals", () => {
    expect(parseLen("24", "in")).toBe(24);
    expect(parseLen("34.5", "in")).toBe(34.5);
  });
  it("parses mixed and bare fractions", () => {
    expect(parseLen("24 1/2", "in")).toBeCloseTo(24.5, 6);
    expect(parseLen("3/4", "in")).toBeCloseTo(0.75, 6);
    expect(parseLen('11 7/8"', "in")).toBeCloseTo(11.875, 6);
  });
  it("converts mm input back to inches", () => {
    expect(parseLen("609.6", "mm")).toBeCloseTo(24, 4);
  });
  it("returns NaN on garbage", () => {
    expect(parseLen("", "in")).toBeNaN();
    expect(parseLen("abc", "in")).toBeNaN();
  });
});
