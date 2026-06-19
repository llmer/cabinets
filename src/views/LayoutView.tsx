import { color, font } from "@/theme";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { Button, MonoLabel, Toggle } from "@/components/ui";
import { Elevation } from "./Elevation";
import { Editor } from "./Editor";

export function LayoutView() {
  const { summary } = useModel();
  const cabinets = useStore((s) => s.project.cabinets);
  const addCab = useStore((s) => s.addCab);
  const setConstructionAll = useStore((s) => s.setConstructionAll);
  const setOverlayAll = useStore((s) => s.setOverlayAll);

  const allFramed = cabinets.length > 0 && cabinets.every((c) => (c.construction || "frameless") === "framed");
  const allFrameless = cabinets.every((c) => (c.construction || "frameless") !== "framed");
  const allInset = cabinets.length > 0 && cabinets.every((c) => c.overlay === "inset");
  const allFull = cabinets.every((c) => c.overlay !== "inset");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 332px", gap: 0, minHeight: "100%" }}>
      <div style={{ padding: "26px 28px", borderRight: `1px solid ${color.divider}` }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <MonoLabel>Wall elevation · front view</MonoLabel>
          <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint }}>drag a box to reorder · click to edit</div>
        </div>
        <div style={{ border: `1px solid ${color.border}`, borderRadius: 8, background: color.panel, padding: 18, overflowX: "auto" }}>
          <Elevation />
        </div>

        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: color.inkMuted }}>
            Construction (all)
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <Toggle active={allFrameless} style={{ padding: "7px 14px" }} onClick={() => setConstructionAll("frameless")}>
              Frameless
            </Toggle>
            <Toggle active={allFramed} style={{ padding: "7px 14px" }} onClick={() => setConstructionAll("framed")}>
              Face frame
            </Toggle>
          </div>
          <span style={{ fontFamily: font.mono, fontSize: 11, color: color.faint }}>sets every cabinet · or set one in its editor</span>
        </div>

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: color.inkMuted }}>
            Front fit (all)
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <Toggle active={allFull} style={{ padding: "7px 14px" }} onClick={() => setOverlayAll("full")}>
              Full overlay
            </Toggle>
            <Toggle active={allInset} style={{ padding: "7px 14px" }} onClick={() => setOverlayAll("inset")}>
              Inset
            </Toggle>
          </div>
          <span style={{ fontFamily: font.mono, fontSize: 11, color: color.faint }}>overlay sits proud · inset sits flush</span>
        </div>

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: color.inkMuted }}>
            Add to run
          </span>
          <Button variant="primary" style={{ padding: "9px 15px" }} onClick={() => addCab("base")}>
            + Base
          </Button>
          <Button variant="ghost" style={{ padding: "9px 15px" }} onClick={() => addCab("wall")}>
            + Wall
          </Button>
          <Button variant="ghost" style={{ padding: "9px 15px" }} onClick={() => addCab("tall")}>
            + Tall
          </Button>
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 22, flexWrap: "wrap", fontFamily: font.mono, fontSize: 11, color: color.inkMuted }}>
          <span><b style={{ color: color.inkStrong }}>{summary.count}</b> cabinets</span>
          <span>base run <b style={{ color: color.inkStrong }}>{summary.baseRun}</b></span>
          <span>upper run <b style={{ color: color.inkStrong }}>{summary.wallRun}</b></span>
          <span>{summary.doors} doors · {summary.drawers} drawers</span>
        </div>
      </div>

      <div style={{ padding: "26px 24px", background: color.page }}>
        <Editor />
      </div>
    </div>
  );
}
