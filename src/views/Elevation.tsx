import { useRef } from "react";
import { Cabinet } from "@/domain/types";
import { color, colorFor, font } from "@/theme";
import { fmtLen } from "@/engine/units";
import { useStore } from "@/state/store";
import { renderFace } from "./cabFace";

function bandOf(c: Cabinet): "base" | "wall" {
  return c.type === "wall" ? "wall" : "base";
}

export function Elevation() {
  const cabinets = useStore((s) => s.project.cabinets);
  const s = useStore((st) => st.project.settings);
  const selectedId = useStore((st) => st.selectedId);
  const dragId = useStore((st) => st.dragId);
  const selectCab = useStore((st) => st.selectCab);
  const beginDrag = useStore((st) => st.beginDrag);
  const endDrag = useStore((st) => st.endDrag);
  const reorderBand = useStore((st) => st.reorderBand);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<Record<string, number>>({});

  const bases = cabinets.filter((c) => c.type !== "wall");
  const walls = cabinets.filter((c) => c.type === "wall");
  const baseRun = bases.reduce((a, c) => a + c.width, 0);
  const wallRun = walls.reduce((a, c) => a + c.width, 0);
  const runW = Math.max(baseRun, wallRun, 30);
  let overall = 90;
  bases.forEach((c) => (overall = Math.max(overall, c.height)));
  walls.forEach((c) => (overall = Math.max(overall, s.upperBottom + c.height)));
  let ppi = Math.min(960 / runW, 470 / overall);
  ppi = Math.max(2.4, Math.min(7, ppi));
  const Wpx = runW * ppi;
  const Hpx = overall * ppi;

  const layout: Record<string, number> = {};

  function onMove(e: React.PointerEvent, c: Cabinet) {
    if (dragId !== c.id || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const band = bandOf(c);
    const members = cabinets.filter((m) => bandOf(m) === band);
    let target = 0;
    members.forEach((m) => {
      if (m.id !== c.id && (layoutRef.current[m.id] ?? 0) < x) target++;
    });
    const ord = members.map((m) => m.id);
    const from = ord.indexOf(c.id);
    if (from === target) return;
    ord.splice(from, 1);
    ord.splice(target, 0, c.id);
    reorderBand(band, ord);
  }

  function CabNode({ c, left, top }: { c: Cabinet; left: number; top: number }) {
    const idx = cabinets.findIndex((x) => x.id === c.id);
    const accent = colorFor(idx);
    const w = c.width * ppi;
    const hgt = c.height * ppi;
    const sel = selectedId === c.id;
    const drag = dragId === c.id;
    const tkPx =
      c.type !== "wall" && c.toeKick !== false && c.frontStyle !== "desk" && c.frontStyle !== "opening"
        ? s.toeKick * ppi
        : 0;
    const tkStrip =
      c.type !== "wall" && c.toeKick !== false && c.frontStyle !== "desk" ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.max(2, s.toeKick * ppi),
            background: "rgba(31,20,14,.13)",
            borderTop: "1px solid rgba(31,20,14,.4)",
            pointerEvents: "none",
          }}
        />
      ) : null;
    return (
      <div
        data-cab={c.id}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          beginDrag(c.id);
        }}
        onPointerMove={(e) => onMove(e, c)}
        onPointerUp={(e) => {
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          if (dragId) endDrag();
        }}
        onClick={() => selectCab(c.id)}
        style={{
          position: "absolute",
          left,
          top,
          width: w,
          height: hgt,
          background: accent + "26",
          border: `1px solid ${sel ? color.inkStrong : "rgba(31,20,14,.55)"}`,
          outline: sel ? `2px solid ${color.gold}` : "none",
          outlineOffset: 1,
          boxShadow: drag ? "0 10px 26px rgba(31,20,14,.30)" : "none",
          opacity: drag ? 0.92 : 1,
          cursor: "grab",
          touchAction: "none",
          boxSizing: "border-box",
          borderRadius: 2,
          transition: "box-shadow .15s, outline-color .15s",
          zIndex: drag ? 30 : sel ? 10 : 1,
        }}
      >
        <div style={{ position: "absolute", top: 4, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 6 }}>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: Math.max(8, Math.min(11, w / 6)),
              color: "#3B271B",
              letterSpacing: ".03em",
              whiteSpace: "nowrap",
              background: "rgba(251,247,236,.8)",
              padding: "0px 5px",
              borderRadius: 3,
            }}
          >
            {c.name} · {fmtLen(c.width, s.units)}
          </span>
        </div>
        {renderFace(c, accent, ppi, tkPx, s)}
        {tkStrip}
      </div>
    );
  }

  const nodes: React.ReactNode[] = [];
  if (s.showGuideLines) {
    [
      { lvl: s.counterH, label: "counter " + fmtLen(s.counterH, s.units) },
      { lvl: s.upperBottom, label: "uppers " + fmtLen(s.upperBottom, s.units) },
    ].forEach((gd, i) => {
      const y = (overall - gd.lvl) * ppi;
      nodes.push(
        <div key={"gd" + i} style={{ position: "absolute", left: 0, right: 0, top: y, borderTop: `1px dashed ${color.divider}`, pointerEvents: "none" }}>
          <span style={{ position: "absolute", right: 0, top: -15, fontFamily: font.mono, fontSize: 9, color: "#A89A82", letterSpacing: ".05em" }}>{gd.label}</span>
        </div>,
      );
    });
  }

  let bx = 0;
  bases.forEach((c) => {
    const x = bx;
    bx += c.width;
    layout[c.id] = (x + c.width / 2) * ppi;
    nodes.push(<CabNode key={c.id} c={c} left={x * ppi} top={(overall - c.height) * ppi} />);
  });
  let wx = 0;
  walls.forEach((c) => {
    const x = wx;
    wx += c.width;
    layout[c.id] = (x + c.width / 2) * ppi;
    nodes.push(<CabNode key={c.id} c={c} left={x * ppi} top={(overall - (s.upperBottom + c.height)) * ppi} />);
  });
  layoutRef.current = layout;

  return (
    <div style={{ minWidth: "min-content" }}>
      <div ref={containerRef} style={{ position: "relative", width: Wpx, height: Hpx + 3, minWidth: "100%" }}>
        {nodes}
        <div style={{ position: "absolute", left: -6, right: -6, top: Hpx, height: 3, background: color.inkStrong, pointerEvents: "none" }} />
      </div>
    </div>
  );
}
