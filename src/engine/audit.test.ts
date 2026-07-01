import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeCabinet } from "@/domain/defaults";
import { Cabinet, Settings } from "@/domain/types";
import { auditProject } from "./audit";

const S: Settings = DEFAULT_SETTINGS;
const codes = (cabs: Cabinet[], s: Settings = S) =>
  auditProject(cabs, s).findings.map((f) => f.code);

describe("audit", () => {
  it("flags an empty project and stops", () => {
    const r = auditProject([], S);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].code).toBe("no_cabinets");
    expect(r.ok).toBe(true); // info only, still buildable
  });

  it("gives a clean, healthy base cabinet no errors or warnings", () => {
    const c = makeCabinet("base", "B1", { width: 24, doorCount: 2, frontStyle: "doors" });
    const r = auditProject([c], S);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it("warns on a wide single door", () => {
    const c = makeCabinet("base", "B1", { width: 30, doorCount: 1, frontStyle: "doors" });
    const r = auditProject([c], S);
    expect(r.findings.some((f) => f.code === "wide_door" && f.level === "warn")).toBe(true);
    // two doors on the same box clears it
    const two = makeCabinet("base", "B2", { width: 30, doorCount: 2, frontStyle: "doors" });
    expect(codes([two])).not.toContain("wide_door");
  });

  it("errors when a drawer bank has no drawers", () => {
    const c = makeCabinet("base", "B1", { frontStyle: "drawers", drawerCount: 0 });
    const r = auditProject([c], S);
    expect(r.findings.some((f) => f.code === "front_count_mismatch" && f.level === "error")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("errors when there is no vertical room for the drawer stack", () => {
    // Many inset drawers on a short framed box exhausts the budget.
    const c = makeCabinet("base", "B1", {
      frontStyle: "drawers",
      construction: "framed",
      overlay: "inset",
      drawerCount: 30,
      height: 34.5,
    });
    expect(codes([c])).toContain("drawer_budget_negative");
  });

  it("errors on a panel that cannot fit any sheet", () => {
    // 120" wide exceeds a 96" sheet in both dimensions of the back panel.
    const c = makeCabinet("base", "B1", { width: 120, height: 60, doorCount: 2 });
    const r = auditProject([c], S);
    expect(r.findings.some((f) => f.code === "part_oversize" && f.level === "error")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("warns on a mixed toe-kick run only under a continuous frame", () => {
    const a = makeCabinet("base", "B1", { width: 24, toeKick: true, doorCount: 2, construction: "framed" });
    const b = makeCabinet("base", "B2", { width: 24, toeKick: false, doorCount: 2, construction: "framed" });
    expect(codes([a, b])).toContain("mixed_toekick_run");
    const b2: Cabinet = { ...b, runBreak: true };
    expect(codes([a, b2])).not.toContain("mixed_toekick_run");
    // frameless: no continuous frame is skinned, so no stepping frame → no flag
    const fa = makeCabinet("base", "B1", { width: 24, toeKick: true, doorCount: 2 });
    const fb = makeCabinet("base", "B2", { width: 24, toeKick: false, doorCount: 2 });
    expect(codes([fa, fb])).not.toContain("mixed_toekick_run");
    // framed but continuous frame turned off → also no flag
    expect(codes([a, b], { ...S, continuousFaceFrame: false })).not.toContain("mixed_toekick_run");
  });

  it("notes an appliance opening only when a continuous frame spans it", () => {
    const a = makeCabinet("base", "B1", { width: 24, doorCount: 2, construction: "framed" });
    const gap = makeCabinet("base", "GAP", { width: 33, frontStyle: "opening", construction: "framed" });
    expect(codes([a, gap])).toContain("appliance_opening_joined");
    // a run break isolates it; a frameless run emits no continuous frame
    expect(codes([a, { ...gap, runBreak: true }])).not.toContain("appliance_opening_joined");
    const fa = makeCabinet("base", "B1", { width: 24, doorCount: 2 });
    const fgap = makeCabinet("base", "GAP", { width: 33, frontStyle: "opening" });
    expect(codes([fa, fgap])).not.toContain("appliance_opening_joined");
  });

  it("catches a custom stack with a too-short front (not just the even split)", () => {
    const c = makeCabinet("base", "B1", {
      frontStyle: "drawers",
      drawerCount: 3,
      height: 34.5,
      drawerHeights: [1, 1, 27],
    });
    expect(codes([c])).toContain("drawer_too_short");
  });

  it("flags a desk with zero drawers", () => {
    const c = makeCabinet("base", "DESK", { frontStyle: "desk", drawerCount: 0, toeKick: false });
    const r = auditProject([c], S);
    expect(r.findings.some((f) => f.code === "front_count_mismatch" && f.level === "error")).toBe(true);
  });

  it("catches a framed opening that is too narrow even with a positive carcass interior", () => {
    // 3" wide framed: carcass interior 1.5\" > 0, but frame opening = 3 - 2*1.5 = 0.
    const c = makeCabinet("base", "B1", { width: 3, construction: "framed", doorCount: 1 });
    expect(codes([c])).toContain("too_narrow");
  });

  it("warns when the reveal is zero", () => {
    const c = makeCabinet("base", "B1", { doorCount: 2 });
    expect(codes([c], { ...S, reveal: 0 })).toContain("reveal_zero");
  });

  it("sorts findings errors-first and counts by level", () => {
    const bad = makeCabinet("base", "B1", { frontStyle: "drawers", drawerCount: 0, width: 30 });
    const r = auditProject([bad], S);
    expect(r.findings[0].level).toBe("error");
    expect(r.errors + r.warnings + r.infos).toBe(r.findings.length);
  });
});
