/**
 * Design tokens — lifted verbatim from the imported "Cabinet Builder" design
 * (claude.ai/design project d1a65654). Keeping them in one place means the UI
 * stays pixel-faithful to the source and is trivial to re-theme later.
 */

export const color = {
  // surfaces
  page: "#F6F0E1",
  panel: "#FBF7EC",
  panelAlt: "#EDE2C8",
  inset: "#F6F0E1",
  // ink
  ink: "#1A1410",
  inkStrong: "#1F140E",
  inkMuted: "#4A3F35",
  faint: "#8C8073",
  fainter: "#A89A82",
  onDark: "#F2E7CE",
  // borders
  border: "#B5A88E",
  divider: "#C9BFAF",
  rule: "#E0D5BE",
  // accents
  gold: "#C9A06B",
  rust: "#B05A3C",
  hardwood: "#A9824F",
  danger: "#8E2E20",
  green: "#6E8157",
  greenDeep: "#4A5C3A",
  walnut: "#6B432A",
} as const;

export const font = {
  serif: "'Newsreader', serif",
  sans: "'Geist', sans-serif",
  mono: "'Geist Mono', monospace",
} as const;

/** Per-cabinet swatch palette (cycled by index), from the original PAL array. */
export const PALETTE = [
  "#C9A06B",
  "#6E8157",
  "#B05A3C",
  "#6B432A",
  "#D89A3F",
  "#4A5C3A",
  "#8E2E20",
  "#8C8073",
] as const;

export function colorFor(i: number): string {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

/** 3D scene tokens. */
export const three = {
  background: "#EFE7D6",
  floor: 0xe2d7be,
  gridMajor: 0xc9bca0,
  gridMinor: 0xd8ccb2,
  edge: 0x4a3a2c,
  carcass: 0xd9c19a,
  carcassInterior: 0xe6d5b4,
  handle: 0x3a3027,
  frontTint: "#efe6d4",
} as const;
