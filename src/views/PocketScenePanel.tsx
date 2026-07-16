import { useEffect, useRef, useState } from "react";
import { color, font } from "@/theme";
import { Part } from "@/domain/types";
import { PocketRow } from "@/engine/pocketHoles";
import { PocketScene } from "@/three/pocketScene";
import { pocketBoardLayout } from "@/three/pocketLayout";

/**
 * The Pockets tab's 3D bench view — one selected board, drilled face up,
 * pockets marked, joining ends highlighted. Loaded lazily (see PocketsView)
 * so three.js stays out of the initial bundle.
 */
export function PocketScenePanel({ part, row }: { part: Part; row: PocketRow }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PocketScene | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;
    try {
      sceneRef.current = new PocketScene(mountRef.current);
    } catch (e) {
      console.error("Pocket 3D init failed:", e);
      setFailed(true);
      return;
    }
    const scene = sceneRef.current;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBoard(pocketBoardLayout(part, row));
  }, [part, row]);

  return (
    <div className="no-print">
      <div
        ref={mountRef}
        style={{
          position: "relative",
          width: "100%",
          height: 260,
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
          <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 15, color: color.faint, textAlign: "center", padding: 20 }}>
            3D preview unavailable — the table still tells you every face.
          </div>
        )}
      </div>
      {!failed && (
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 7, fontFamily: font.mono, fontSize: 11, color: color.faint }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: "#e6a23c", border: "1px solid rgba(31,20,14,.35)" }} />
            joining ends
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 8, borderRadius: "50%", background: "#3a3027" }} />
            pockets (this face up on the bench)
          </span>
          <span style={{ flex: 1 }} />
          <span>drag · scroll</span>
        </div>
      )}
    </div>
  );
}
