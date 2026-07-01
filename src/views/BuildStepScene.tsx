import { useEffect, useRef, useState } from "react";
import { color, font } from "@/theme";
import { Cabinet, Settings } from "@/domain/types";
import { BuildStage } from "@/engine/steps";
import { CabinetScene } from "@/three/CabinetScene";

export interface BuildStepSceneProps {
  /** The focused cabinet for a per-cabinet box step. Omitted for a run step. */
  cabinet?: Cabinet;
  /** For a run-level step: render the whole assembled run instead of one box. */
  runCabinets?: Cabinet[];
  settings: Settings;
  /** The current step's assembly stage — drives which parts glow. */
  stage: BuildStage;
  /** Every stage reached at or before the current step — those parts are solid. */
  revealedStages: BuildStage[];
  /** Cabinet swatch colour, mixed into the front material. */
  accent: string;
  /** Stage label shown in the caption (e.g. "Drawers"). */
  stageLabel: string;
}

/** Steps whose work happens inside the box — default to the cutaway view. */
function interiorStage(stage: BuildStage): boolean {
  return stage === "drawers" || stage === "shelves";
}

/**
 * A RUN step opens on the joined carcasses and only shows the fitted frame +
 * fronts once the frame is glued on — so the whole-run render (which has no
 * per-part staging) still reads as a progression. Carcass for the join/base
 * beats and the "mill the frame on the bench" beat (the FIRST faceFrame step,
 * before it is fitted); the finished run from the "glue it on" beat onward.
 */
function runStepCarcass(stage: BuildStage, revealed: BuildStage[]): boolean {
  if (stage === "base") return true;
  if (stage === "faceFrame") return revealed.filter((s) => s === "faceFrame").length <= 1;
  return false;
}

/**
 * The build-tab's per-step 3D render. Mounts a {@link CabinetScene} in
 * build-focus mode and pushes the current cabinet + stage on every change, so a
 * visual learner watches the box assemble itself one step at a time.
 *
 * Loaded lazily (see BuildView) so Three.js stays out of the initial bundle.
 */
export function BuildStepScene({
  cabinet,
  runCabinets,
  settings,
  stage,
  revealedStages,
  accent,
  stageLabel,
}: BuildStepSceneProps) {
  const isRun = !!(runCabinets && runCabinets.length);
  const focusKey = isRun ? runCabinets!.map((c) => c.id).join(",") : cabinet?.id ?? "";
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CabinetScene | null>(null);
  const [failed, setFailed] = useState(false);
  const revealedKey = revealedStages.join(",");
  // A run step opens on the joined carcasses (join/base + milling), then shows
  // the fitted frame + fronts once it is glued on; a box step follows the
  // interior/cutaway rule.
  const [cutaway, setCutaway] = useState(
    isRun ? runStepCarcass(stage, revealedStages) : interiorStage(stage),
  );

  // create once
  useEffect(() => {
    if (!mountRef.current) return;
    try {
      sceneRef.current = new CabinetScene(mountRef.current);
    } catch (e) {
      console.error("Build 3D init failed:", e);
      setFailed(true);
      return;
    }
    const scene = sceneRef.current;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Default the cutaway on/off as the step's stage changes (user can override).
  useEffect(() => {
    setCutaway(isRun ? runStepCarcass(stage, revealedStages) : interiorStage(stage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, focusKey, revealedKey]);

  // push the focused cabinet (or whole run) + stage on any relevant change
  useEffect(() => {
    if (isRun && runCabinets) {
      // Run step: render the whole assembled run (the continuous frame is drawn
      // once across all bays); fronts hidden until the frame is fitted.
      sceneRef.current?.setRunFocus(runCabinets, settings, !cutaway);
    } else if (cabinet) {
      sceneRef.current?.setBuildFocus(cabinet, settings, stage, revealedStages, accent, !cutaway);
    }
    // revealedStages is keyed by revealedKey to avoid re-pushing on a fresh array ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, settings, stage, revealedKey, accent, cutaway]);

  const viewBtn: React.CSSProperties = {
    border: "none",
    borderRight: `1px solid ${color.border}`,
    background: color.panel,
    padding: "6px 11px",
    fontFamily: font.mono,
    fontSize: 11,
    cursor: "pointer",
    color: color.inkStrong,
  };

  return (
    <div className="no-print" style={{ marginTop: 14, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: font.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.faint }}>
          See it in 3D
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setCutaway((v) => !v)}
          style={{
            border: `1px solid ${color.border}`,
            borderRadius: 5,
            background: cutaway ? color.inkStrong : color.panel,
            color: cutaway ? color.onDark : color.inkStrong,
            padding: "6px 11px",
            fontFamily: font.mono,
            fontSize: 11,
            cursor: "pointer",
          }}
          title="Hide the fronts to see the drawer boxes and shelves inside"
        >
          {cutaway ? "Show fronts" : "Cutaway"}
        </button>
        <div style={{ display: "flex", border: `1px solid ${color.border}`, borderRadius: 5, overflow: "hidden" }}>
          <button style={viewBtn} onClick={() => sceneRef.current?.setView("iso")}>Iso</button>
          <button style={viewBtn} onClick={() => sceneRef.current?.setView("front")}>Front</button>
          <button style={{ ...viewBtn, borderRight: "none" }} onClick={() => sceneRef.current?.setView("top")}>Top</button>
        </div>
        <button
          onClick={() => sceneRef.current?.resetView()}
          style={{ ...viewBtn, border: `1px solid ${color.border}`, borderRadius: 5 }}
        >
          Reset
        </button>
      </div>

      <div
        ref={mountRef}
        style={{
          position: "relative",
          width: "100%",
          flex: 1,
          minHeight: 200,
          border: `1px solid ${color.border}`,
          borderRadius: 8,
          overflow: "hidden",
          background: color.page,
          cursor: failed ? "default" : "grab",
          display: failed ? "flex" : "block",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {failed && (
          <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 17, color: color.faint, textAlign: "center", padding: 24 }}>
            3D preview unavailable — your browser or device doesn&apos;t support WebGL.
            <div style={{ fontFamily: font.mono, fontStyle: "normal", fontSize: 12, marginTop: 8 }}>
              The written steps below still walk you through every cut.
            </div>
          </div>
        )}
      </div>

      {!failed && (
        <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 9, fontFamily: font.mono, fontSize: 11, color: color.faint }}>
          {isRun ? (
            // The whole-run render has no per-part glow, so don't imply one — just
            // say what the run shows at this beat (carcasses joined → frame on).
            <span>Whole run · {cutaway ? "boxes joined" : "one face frame + fronts fitted"}</span>
          ) : (
            <>
              <LegendDot c="#e6a23c" label={`This step · ${stageLabel}`} />
              <LegendDot c={color.border} label="Already built" />
              <LegendDot c="transparent" outline label="Still to come" />
            </>
          )}
          <span style={{ flex: 1 }} />
          <span>Drag to orbit · scroll to zoom</span>
        </div>
      )}
    </div>
  );
}

function LegendDot({ c, label, outline }: { c: string; label: string; outline?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: 3,
          background: c,
          border: outline ? `1px dashed ${color.fainter}` : `1px solid rgba(31,20,14,.35)`,
        }}
      />
      {label}
    </span>
  );
}
