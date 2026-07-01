import { useEffect, useRef, useState } from "react";
import { color, font } from "@/theme";
import { CabinetScene, MeasureResult } from "@/three/CabinetScene";
import { useStore } from "@/state/store";
import { Button, MonoLabel, Serif, Toggle } from "@/components/ui";
import { constructionInfo } from "@/engine/labels";
import { fmtLen } from "@/engine/units";

export function ThreeView() {
  const cabinets = useStore((s) => s.project.cabinets);
  const settings = useStore((s) => s.project.settings);
  const showFronts = useStore((s) => s.showFronts);
  const setShowFronts = useStore((s) => s.setShowFronts);
  const tintCabinets = useStore((s) => s.tintCabinets);
  const setTintCabinets = useStore((s) => s.setTintCabinets);
  const setConstructionAll = useStore((s) => s.setConstructionAll);
  const setOverlayAll = useStore((s) => s.setOverlayAll);
  const ci = constructionInfo(cabinets);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CabinetScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [measure, setMeasure] = useState(false);
  const [span, setSpan] = useState<MeasureResult | null>(null);

  // create once
  useEffect(() => {
    if (!mountRef.current) return;
    try {
      sceneRef.current = new CabinetScene(mountRef.current);
    } catch (e) {
      console.error("3D init failed:", e);
      setFailed(true);
      return;
    }
    const scene = sceneRef.current;
    scene.onMeasure = setSpan;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // push data on change
  useEffect(() => {
    sceneRef.current?.setData(cabinets, settings, showFronts, tintCabinets);
  }, [cabinets, settings, showFronts, tintCabinets]);

  // toggle the click-to-measure overlay
  useEffect(() => {
    sceneRef.current?.setMeasureMode(measure);
  }, [measure]);

  const viewBtn: React.CSSProperties = {
    border: "none",
    borderRight: `1px solid ${color.border}`,
    background: color.panel,
    padding: "8px 13px",
    fontFamily: font.mono,
    fontSize: 12,
    cursor: "pointer",
    color: color.inkStrong,
  };

  return (
    <div style={{ padding: "22px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <MonoLabel>Rendered run · {ci.label}</MonoLabel>
          <Serif style={{ fontSize: 30, marginTop: 2 }}>See the whole run in the round.</Serif>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button
            variant="mono"
            style={{ background: showFronts ? "transparent" : color.inkStrong, color: showFronts ? color.inkStrong : color.onDark }}
            onClick={() => setShowFronts(!showFronts)}
          >
            {showFronts ? "Hide fronts" : "Show fronts"}
          </Button>
          <Button
            variant="mono"
            style={{ background: tintCabinets ? color.inkStrong : "transparent", color: tintCabinets ? color.onDark : color.inkStrong }}
            onClick={() => setTintCabinets(!tintCabinets)}
          >
            {tintCabinets ? "Tint: per cabinet" : "Tint: uniform"}
          </Button>
          <div style={{ display: "flex", border: `1px solid ${color.border}`, borderRadius: 5, overflow: "hidden" }}>
            <button style={viewBtn} onClick={() => sceneRef.current?.setView("iso")}>Iso</button>
            <button style={viewBtn} onClick={() => sceneRef.current?.setView("front")}>Front</button>
            <button style={{ ...viewBtn, borderRight: "none" }} onClick={() => sceneRef.current?.setView("top")}>Top</button>
          </div>
          <Toggle active={measure} style={{ padding: "8px 13px", fontFamily: font.mono, fontSize: 12 }} onClick={() => setMeasure((m) => !m)}>
            {measure ? "Measuring…" : "Measure"}
          </Toggle>
          <Button variant="ghost" style={{ padding: "8px 13px", fontFamily: font.mono, fontSize: 12 }} onClick={() => sceneRef.current?.resetView()}>
            Reset
          </Button>
        </div>
      </div>

      {/* Construction + fit, drivable here so the render reacts live */}
      <div className="no-print" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: color.faint }}>Construction</span>
          <Toggle active={ci.allFrameless} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setConstructionAll("frameless")}>Frameless</Toggle>
          <Toggle active={ci.allFramed} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setConstructionAll("framed")}>Face frame</Toggle>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: color.faint }}>Front fit</span>
          <Toggle active={ci.allFull} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setOverlayAll("full")}>Full overlay</Toggle>
          <Toggle active={ci.allRailInset} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setOverlayAll("inset_rail")}>Railed inset</Toggle>
          <Toggle active={ci.allFlushInset} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setOverlayAll("inset")}>Flush inset</Toggle>
        </div>
      </div>

      <div
        ref={mountRef}
        style={{ position: "relative", width: "100%", height: 600, border: `1px solid ${color.border}`, borderRadius: 8, overflow: "hidden", background: color.page, cursor: failed ? "default" : "grab", display: failed ? "flex" : "block", alignItems: "center", justifyContent: "center" }}
      >
        {failed && (
          <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 20, color: color.faint, textAlign: "center", padding: 24 }}>
            3D preview unavailable — your browser or device doesn&apos;t support WebGL.
            <div style={{ fontFamily: font.mono, fontStyle: "normal", fontSize: 12, marginTop: 8 }}>
              The Layout, Cut list, Sheets and Build views still work.
            </div>
          </div>
        )}
      </div>
      {measure && (
        <div className="no-print" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", border: `1px solid ${color.border}`, borderRadius: 6, background: color.panel, padding: "10px 14px" }}>
          {span ? (
            <>
              <span style={{ fontFamily: font.serif, fontSize: 24, color: color.inkStrong, lineHeight: 1 }}>{fmtLen(span.dist, settings.units)}</span>
              <span style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, letterSpacing: ".03em" }}>
                run {fmtLen(span.dx, settings.units)} · height {fmtLen(span.dy, settings.units)} · depth {fmtLen(span.dz, settings.units)}
              </span>
              <Button variant="mono" style={{ marginLeft: "auto" }} onClick={() => sceneRef.current?.clearMeasure()}>Clear</Button>
            </>
          ) : (
            <span style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted }}>
              Hover to snap a corner, click to set it, then click the second. Drag still orbits.
            </span>
          )}
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 18, fontFamily: font.mono, fontSize: 11, color: color.faint, letterSpacing: ".03em", alignItems: "center" }}>
        <span><b style={{ color: color.inkMuted }}>Drag</b> to orbit</span>
        <span>
          <span style={{ display: "inline-block", border: `1px solid ${color.border}`, background: color.panel, borderRadius: 4, padding: "1px 6px", color: color.inkMuted, marginRight: 5 }}>Shift</span>
          + drag or right-drag to pan
        </span>
        <span><b style={{ color: color.inkMuted }}>Scroll</b> to zoom</span>
        <span><b style={{ color: color.inkMuted }}>Reset</b> re-centers the run</span>
      </div>
    </div>
  );
}
