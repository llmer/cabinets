import { CSSProperties, ReactNode } from "react";
import { Cabinet, Settings } from "@/domain/types";
import {
  boxHeight,
  effectiveFrameWidth,
  faceHeight,
  insetStackGap,
  isFramed,
  isInset,
} from "@/engine/geometry";
import { drawerStackBudget, getDrawerHeights } from "@/engine/drawers";

/**
 * 2D elevation drawing of a single cabinet face. Ported from the imported
 * design's cabFaceFrameless / cabFaceFramed / cabFaceOpening renderers.
 */

const FRAME_BG = "#A9824F";
const HANDLE = "rgba(31,20,14,.45)";

/** Whether this cabinet sits at an exposed END of its run (for shared stiles). */
export interface RunEnds {
  leftEnd: boolean;
  rightEnd: boolean;
}

const SOLO_ENDS: RunEnds = { leftEnd: true, rightEnd: true };

export function renderFace(
  c: Cabinet,
  accent: string,
  ppi: number,
  tkPx: number,
  s: Settings,
  ends: RunEnds = SOLO_ENDS,
): ReactNode {
  if (c.frontStyle === "opening") return openingFace(c, ppi, tkPx, s, ends);
  if (isInset(c)) {
    // Side/top/bottom border: wide hardwood frame (framed) or thin box edge.
    // Between-face rail: a mid rail (framed / railed inset) or a thin reveal.
    const effFF = effectiveFrameWidth(c, s);
    const railFF = insetStackGap(c, s);
    const frameColor = isFramed(c) ? FRAME_BG : "#D8CCB2";
    return insetFace(c, accent, ppi, tkPx, s, effFF, railFF, frameColor, ends);
  }
  // Full overlay — fronts sit proud, covering the box/frame (frame hidden).
  return framelessFace(c, accent, ppi, tkPx, s);
}

/* ------------------------------------------------------------------ */
/* Frameless full-overlay                                              */
/* ------------------------------------------------------------------ */

function framelessFace(
  c: Cabinet,
  accent: string,
  _ppi: number,
  tkPx: number,
  s: Settings,
): ReactNode {
  const panel = (key: string) => (
    <div
      key={key}
      style={{
        flex: "1 1 0",
        background: accent + "14",
        border: "1px solid rgba(31,20,14,.4)",
        borderRadius: 1,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "44%",
          left: "50%",
          width: 2,
          height: "13%",
          background: HANDLE,
          transform: "translateX(-50%)",
          borderRadius: 1,
        }}
      />
    </div>
  );
  const drawerPanel = (key: string, grow: number) => (
    <div
      key={key}
      style={{
        flex: grow + " 0 0",
        background: accent + "14",
        border: "1px solid rgba(31,20,14,.4)",
        borderRadius: 1,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          width: "20%",
          height: 2,
          background: HANDLE,
          transform: "translateX(-50%)",
        }}
      />
    </div>
  );
  const wrap = (dir: "row" | "column", kids: ReactNode): ReactNode => (
    <div
      style={{
        position: "absolute",
        top: 3,
        left: 3,
        right: 3,
        bottom: 3 + tkPx,
        display: "flex",
        flexDirection: dir,
        gap: 2,
      }}
    >
      {kids}
    </div>
  );

  if (c.frontStyle === "desk") {
    const hs = getDrawerHeights(c, s);
    const boxH = boxHeight(c, s);
    const sum = hs.reduce((a, x) => a + x, 0);
    const frac = Math.max(0.1, Math.min(0.72, (sum + 1) / boxH));
    const drawers = hs.map((dh, i) => drawerPanel("dk" + i, dh));
    const top = (
      <div key="tk" style={{ flex: "0 0 " + frac * 100 + "%", display: "flex", flexDirection: "column", gap: 3 }}>
        {drawers}
      </div>
    );
    const open = (
      <div key="op" style={{ flex: "1 1 0", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 9, color: "#A89A82", paddingBottom: 3, letterSpacing: ".06em" }}>open</span>
      </div>
    );
    return wrap("column", [top, open]);
  }
  if (c.frontStyle === "drawers") {
    const hs = getDrawerHeights(c, s);
    const budget = drawerStackBudget(c, s);
    const sum = hs.reduce((a, x) => a + x, 0);
    const arr: ReactNode[] = hs.map((dh, i) => drawerPanel("d" + i, dh));
    if (budget - sum > 0.5) arr.push(<div key="rem" style={{ flex: budget - sum + " 0 0" }} />);
    return wrap("column", arr);
  }
  if (c.frontStyle === "door_drawer") {
    const dh = getDrawerHeights(c, s)[0];
    const fh = faceHeight(c, s);
    const doorH = Math.max(1, fh - dh - s.reveal);
    const doors: ReactNode[] = [];
    for (let i = 0; i < c.doorCount; i++) doors.push(panel("dd" + i));
    const top = drawerPanel("t", dh);
    const bottom = (
      <div key="b" style={{ flex: doorH + " 0 0", display: "flex", gap: 3 }}>
        {doors}
      </div>
    );
    return wrap("column", [top, bottom]);
  }
  const arr: ReactNode[] = [];
  for (let i = 0; i < c.doorCount; i++) arr.push(panel("dr" + i));
  return wrap("row", arr);
}

/* ------------------------------------------------------------------ */
/* Face frame (inset)                                                  */
/* ------------------------------------------------------------------ */

function insetFace(
  c: Cabinet,
  accent: string,
  ppi: number,
  tkPx: number,
  s: Settings,
  effFF: number,
  railFF: number,
  frameColor: string,
  ends: RunEnds,
): ReactNode {
  const ffpx = Math.max(2.5, effFF * ppi); // side stiles + bottom border
  // The top rail is usually wider than the stiles when framed.
  const topV = isFramed(c) ? s.faceFrameTop || 2 : effFF;
  const topPx = Math.max(2.5, topV * ppi);
  // A shared joint shows half a stile (its neighbour supplies the other half),
  // so a run of joined cabinets reads as one continuous frame.
  const leftFfpx = ends.leftEnd ? ffpx : Math.max(1.5, ffpx / 2);
  const rightFfpx = ends.rightEnd ? ffpx : Math.max(1.5, ffpx / 2);
  const railpx = Math.max(1, railFF * ppi); // rail/gap between stacked faces
  const rev = Math.max(0.8, 0.125 * ppi);
  const FRAME_BG = frameColor;
  const insetPanel = (key: string) => (
    <div
      key={key}
      style={{
        position: "absolute",
        top: rev,
        left: rev,
        right: rev,
        bottom: rev,
        background: accent + "1f",
        border: "1px solid rgba(31,20,14,.5)",
        borderRadius: 1,
      }}
    >
      <div style={{ position: "absolute", top: "44%", left: "50%", width: 2, height: "12%", background: "rgba(31,20,14,.5)", transform: "translateX(-50%)", borderRadius: 1 }} />
    </div>
  );
  const railEnd = (key: string, px: number = ffpx) => (
    <div key={key} style={{ flex: "0 0 " + px + "px", background: FRAME_BG, borderTop: "1px solid rgba(31,20,14,.25)", borderBottom: "1px solid rgba(31,20,14,.25)" }} />
  );
  const railMid = (key: string) => (
    <div key={key} style={{ flex: "0 0 " + railpx + "px", background: FRAME_BG, borderTop: "1px solid rgba(31,20,14,.25)", borderBottom: "1px solid rgba(31,20,14,.25)" }} />
  );
  const drawerMod = (key: string, grow: number) => (
    <div key={key} style={{ flex: grow + " 1 0", position: "relative", minHeight: 0 }}>{insetPanel("p")}</div>
  );
  const doorsMod = (key: string, grow: number, nd: number) => {
    const doors: ReactNode[] = [];
    for (let i = 0; i < nd; i++) doors.push(<div key={i} style={{ flex: "1 1 0", position: "relative" }}>{insetPanel("d" + i)}</div>);
    return (
      <div key={key} style={{ flex: grow + " 1 0", display: "flex", position: "relative", minHeight: 0 }}>{doors}</div>
    );
  };
  const openMod = (key: string, grow: number) => (
    <div key={key} style={{ flex: grow + " 1 0", display: "flex", alignItems: "flex-end", justifyContent: "center", minHeight: 0 }}>
      <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 9, color: "#A89A82", paddingBottom: 3, letterSpacing: ".06em" }}>open</span>
    </div>
  );

  const fs = c.frontStyle;
  let mods: ReactNode[] = [];
  if (fs === "doors") mods = [doorsMod("m0", 1, c.doorCount)];
  else if (fs === "drawers") {
    const hs = getDrawerHeights(c, s);
    const budget = drawerStackBudget(c, s);
    const sum = hs.reduce((a, x) => a + x, 0);
    mods = hs.map((dh, i) => drawerMod("m" + i, dh));
    if (budget - sum > 0.5) mods.push(openMod("rem", budget - sum));
  } else if (fs === "door_drawer") {
    const dh = getDrawerHeights(c, s)[0];
    const boxH = boxHeight(c, s);
    const doorsGrow = Math.max(1, boxH - topV - 2 * effFF - dh);
    mods = [drawerMod("m0", dh), doorsMod("m1", doorsGrow, c.doorCount)];
  } else if (fs === "desk") {
    const hs = getDrawerHeights(c, s);
    const sum = hs.reduce((a, x) => a + x, 0);
    mods = hs.map((dh, i) => drawerMod("m" + i, dh));
    mods.push(openMod("open", Math.max(1, boxHeight(c, s) - sum)));
  }
  const col: ReactNode[] = [railEnd("top", topPx)];
  mods.forEach((m, i) => {
    if (i > 0) col.push(railMid("r" + i));
    col.push(m);
  });
  if (fs !== "desk") col.push(railEnd("bot"));
  const stile = (side: "left" | "right") => (
    <div
      key={side}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side]: 0,
        width: side === "left" ? leftFfpx : rightFfpx,
        background: FRAME_BG,
        [side === "left" ? "borderRight" : "borderLeft"]: "1px solid rgba(31,20,14,.25)",
      } as CSSProperties}
    />
  );
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: tkPx }}>
      {stile("left")}
      {stile("right")}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: leftFfpx, right: rightFfpx, display: "flex", flexDirection: "column" }}>{col}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Appliance opening                                                   */
/* ------------------------------------------------------------------ */

function openingFace(c: Cabinet, ppi: number, tkPx: number, s: Settings, ends: RunEnds): ReactNode {
  const framed = (c.construction || "frameless") === "framed";
  const ffpx = Math.max(2.5, (s.frameWidth || 1.5) * ppi);
  const topPx = Math.max(2.5, (s.faceFrameTop || 2) * ppi); // wider top rail
  const leftFfpx = ends.leftEnd ? ffpx : Math.max(1.5, ffpx / 2);
  const rightFfpx = ends.rightEnd ? ffpx : Math.max(1.5, ffpx / 2);
  const kids: ReactNode[] = [];
  if (framed) {
    kids.push(<div key="sl" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: leftFfpx, background: FRAME_BG }} />);
    kids.push(<div key="sr" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: rightFfpx, background: FRAME_BG }} />);
    kids.push(<div key="tr" style={{ position: "absolute", top: 0, left: 0, right: 0, height: topPx, background: FRAME_BG }} />);
  }
  const pad = framed ? ffpx : 5;
  kids.push(
    <div
      key="void"
      style={{
        position: "absolute",
        top: framed ? topPx : 6,
        left: pad,
        right: pad,
        bottom: 4,
        border: "1.5px dashed rgba(31,20,14,.38)",
        borderRadius: 1,
        background: "rgba(31,20,14,.03)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 10, color: "#8C8073", letterSpacing: ".1em", textTransform: "uppercase" }}>opening</span>
    </div>,
  );
  return <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: tkPx }}>{kids}</div>;
}
