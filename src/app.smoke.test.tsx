import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useStore, ViewId } from "@/state/store";
import { LayoutView } from "@/views/LayoutView";
import { CutListView } from "@/views/CutListView";
import { BoardPlanPack, SheetPack, SheetsView } from "@/views/SheetsView";
import { PocketSchedule, PocketsView } from "@/views/PocketsView";
import { compute } from "@/engine/compute";
import { makeCabinet } from "@/domain/defaults";
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
    pockets: PocketsView,
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

  it("renders the rip-aware hardwood board plan when boards are on hand", () => {
    const { settings } = useStore.getState().project;
    const framed = [
      makeCabinet("base", "B1", { width: 30, construction: "framed", overlay: "inset_rail" }),
      makeCabinet("base", "B2", { width: 24, construction: "framed", overlay: "inset_rail" }),
    ];
    const s = {
      ...settings,
      stocks: {
        ...settings.stocks,
        hardwood: { ...settings.stocks.hardwood, boards: [{ width: 5.5, length: 144, qty: 4 }] },
      },
    };
    const model = compute(framed, s);
    expect(model.boardPacks).toHaveLength(1);
    const html = renderToString(
      createElement(BoardPlanPack, { pack: model.boardPacks[0], units: "in", kerf: s.kerf }),
    );
    expect(html).toContain("boards on hand"); // the header line
    expect(html).toContain("rip "); // the ✂ caption under each board
  });

  it("renders the enabled pocket-hole schedule (SSR keeps the 3D subtree unmounted)", () => {
    // Like the store-breakdown case: the SSR snapshot can't carry a flipped
    // setting, so render the pure schedule with a pocketHoles-on model.
    const { settings } = useStore.getState().project;
    const framed = [
      makeCabinet("base", "B1", { width: 30, construction: "framed", overlay: "inset_rail", frontStyle: "door_drawer", drawerCount: 1 }),
      makeCabinet("base", "B2", { width: 24, construction: "framed", overlay: "inset_rail", frontStyle: "desk", drawerCount: 1, toeKick: false }),
    ];
    const s = { ...settings, pocketHoles: true };
    const model = compute(framed, s);
    expect(model.pocketPlan).toBeTruthy();
    const html = renderToString(createElement(PocketSchedule, { model, settings: s }));
    expect(html).toContain("Pockets go in"); // the schedule table
    expect(html).toContain("Face frame"); // the joint panel
    expect(html).not.toContain("Loading 3D"); // lazy subtree stays unmounted in SSR
  });

  it("reflects mutations through the store", () => {
    const before = useStore.getState().project.cabinets.length;
    useStore.getState().addCab("base");
    expect(useStore.getState().project.cabinets.length).toBe(before + 1);
    useStore.getState().undo();
    expect(useStore.getState().project.cabinets.length).toBe(before);
  });
});
