import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useStore, ViewId } from "@/state/store";
import { LayoutView } from "@/views/LayoutView";
import { CutListView } from "@/views/CutListView";
import { SheetPack, SheetsView } from "@/views/SheetsView";
import { compute } from "@/engine/compute";
import { BuildView } from "@/views/BuildView";
import { SettingsView } from "@/views/SettingsView";
import { Header } from "@/components/Header";

/**
 * Server-render every non-3D view against the seed project. This exercises the
 * full render tree + the compute engine and fails loudly on any runtime throw,
 * which the type-checker alone can't catch. (ThreeView is excluded — it needs a
 * real WebGL canvas.)
 */
describe("app render smoke test", () => {
  const views: Record<Exclude<ViewId, "3d">, () => JSX.Element> = {
    layout: LayoutView,
    cutlist: CutListView,
    sheets: SheetsView,
    build: BuildView,
    settings: SettingsView,
  };

  it("renders the header with the seed summary", () => {
    const html = renderToString(createElement(Header));
    expect(html).toContain("frame(less)");
    expect(html).toContain("Base run");
  });

  for (const [view, Comp] of Object.entries(views)) {
    it(`renders the ${view} view without throwing`, () => {
      const html = renderToString(createElement(Comp));
      expect(html.length).toBeGreaterThan(50);
    });
  }

  it("renders rip strips in the sheet diagrams when store breakdown is on", () => {
    // renderToString reads zustand's server snapshot, pinned at store creation,
    // so a flipped setting can't reach the full SheetsView here — render the
    // pure SheetPack with a breakdown-mode model instead.
    const { cabinets, settings } = useStore.getState().project;
    const model = compute(cabinets, { ...settings, storeBreakdown: true });
    expect(model.summary.storeCuts).toBeGreaterThan(0);
    const pack = model.packs.find((p) => p.sheets.length > 0)!;
    expect(pack.sheets[0].strips!.length).toBeGreaterThan(1);
    const html = renderToString(
      createElement(SheetPack, { pack, units: "in", kerf: settings.kerf, rot: settings.allowRotate }),
    );
    expect(html).toContain("rips "); // the ✂ caption under each sheet
    expect(html).toContain("dashed"); // the rip cut lines across the diagram
  });

  it("reflects mutations through the store", () => {
    const before = useStore.getState().project.cabinets.length;
    useStore.getState().addCab("base");
    expect(useStore.getState().project.cabinets.length).toBe(before + 1);
    useStore.getState().undo();
    expect(useStore.getState().project.cabinets.length).toBe(before);
  });
});
