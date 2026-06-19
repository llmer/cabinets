import { CSSProperties } from "react";
import { Cabinet, FrontStyle } from "@/domain/types";
import { color, colorFor, font } from "@/theme";
import {
  boxHeight,
  carcassDepth,
  faceHeight,
  interiorWidth,
  isFramed,
} from "@/engine/geometry";
import { drawerStackBudget, getDrawerHeights } from "@/engine/drawers";
import { fmtLen, parseLen, toDisplayNumber, unitLabel } from "@/engine/units";
import { frontStyleLabel, typeLabel } from "@/engine/labels";
import { useStore } from "@/state/store";
import {
  Button,
  Divider,
  FieldLabel,
  NumberField,
  Select,
  Serif,
  Stepper,
  Swatch,
  Toggle,
} from "@/components/ui";

const FRONTS_BASE: { value: FrontStyle; label: string }[] = [
  { value: "doors", label: "Doors" },
  { value: "drawers", label: "Drawer bank" },
  { value: "door_drawer", label: "Drawer over doors" },
  { value: "desk", label: "Open desk — drawer, open below" },
  { value: "opening", label: "Opening (appliance / fridge)" },
];
const FRONTS_OTHER: { value: FrontStyle; label: string }[] = [
  { value: "doors", label: "Doors" },
  { value: "opening", label: "Opening (appliance / fridge)" },
];

function clamp(v: number, mn: number, mx: number): number {
  if (isNaN(v)) return mn;
  return Math.max(mn, Math.min(mx, v));
}

export function Editor() {
  const sel = useStore((s) => s.selected());
  const s = useStore((st) => st.project.settings);
  const cabinets = useStore((st) => st.project.cabinets);
  const updateCab = useStore((st) => st.updateCab);
  const setCabinetType = useStore((st) => st.setCabinetType);
  const setConstruction = useStore((st) => st.setConstruction);
  const setOverlay = useStore((st) => st.setOverlay);
  const setFrontStyle = useStore((st) => st.setFrontStyle);
  const setDrawerCount = useStore((st) => st.setDrawerCount);
  const resetDrawerHeights = useStore((st) => st.resetDrawerHeights);
  const setDrawerHeightAt = useStore((st) => st.setDrawerHeightAt);
  const duplicateCab = useStore((st) => st.duplicateCab);
  const removeCab = useStore((st) => st.removeCab);

  if (!sel) {
    return (
      <Serif style={{ fontSize: 20, color: color.faint, lineHeight: 1.4 }}>
        Select a cabinet on the wall to edit it — or add one below.
      </Serif>
    );
  }

  const u = s.units;
  const idx = cabinets.findIndex((c) => c.id === sel.id);
  const accent = colorFor(idx);
  const framed = isFramed(sel);
  const overlayFull = sel.overlay === "full";
  const railed = sel.overlay === "inset_rail";
  const flush = sel.overlay === "inset";
  const isDesk = sel.frontStyle === "desk";
  const isOpening = sel.frontStyle === "opening";
  const tkOn = sel.toeKick !== false;
  const presetVals =
    sel.type === "wall"
      ? [12, 15, 18, 24, 30, 36]
      : sel.type === "tall"
        ? [18, 24, 30, 36]
        : [9, 12, 15, 18, 24, 30, 36];
  const frontOptions = sel.type === "base" ? FRONTS_BASE : FRONTS_OTHER;
  const hasDrawers = sel.frontStyle === "drawers" || isDesk || sel.frontStyle === "door_drawer";

  const commitDim = (key: keyof Cabinet, mn: number, mx: number) => (raw: string) => {
    const inches = parseLen(raw, u);
    if (isNaN(inches)) return;
    updateCab(sel.id, { [key]: clamp(inches, mn, mx) } as Partial<Cabinet>);
  };

  const geomInterior = interiorWidth(sel, s);
  const geomBox = boxHeight(sel, s);
  const geomDepth = carcassDepth(sel, s);

  // drawer rows + note
  let drawerRows: { label: string; value: number; i: number }[] = [];
  let drawerNote = "";
  if (hasDrawers) {
    const hs = getDrawerHeights(sel, s);
    drawerRows = hs.map((v, i) => ({
      label:
        sel.frontStyle === "door_drawer"
          ? "Top drawer"
          : "Drawer " + (i + 1) + (i === 0 ? " (top)" : ""),
      value: v,
      i,
    }));
    if (sel.frontStyle === "door_drawer") {
      const ff = s.frameWidth || 1.5;
      const doorH = framed
        ? +(geomBox - 3 * ff - hs[0]).toFixed(3)
        : +(faceHeight(sel, s) - hs[0] - s.reveal).toFixed(3);
      drawerNote = `Doors below fill the rest — ${fmtLen(doorH, u)} opening.`;
    } else {
      const budget = drawerStackBudget(sel, s);
      const left = +(budget - hs.reduce((a, x) => a + x, 0)).toFixed(3);
      drawerNote =
        left > 0.06 ? `${fmtLen(left, u)} of the opening still free` : "Opening fully used — at the limit.";
    }
  }

  const boxNote = isOpening
    ? `appliance opening — ${fmtLen(geomInterior, u)} wide × ${fmtLen(geomBox, u)} tall × ${fmtLen(sel.depth, u)} deep, sides + top only (no bottom, back or front)`
    : isDesk
      ? `open desk — ${fmtLen(geomInterior, u)} between legs × ${fmtLen(geomBox, u)} tall, no bottom or back`
      : `${fmtLen(geomInterior, u)} interior × ${fmtLen(geomBox, u)} tall × ${fmtLen(geomDepth, u)} deep${
          sel.type === "wall" ? "" : tkOn ? ` (on ${fmtLen(s.toeKick, u)} toe kick)` : " (flush, no toe kick)"
        }`;

  const dimCell = (label: string, key: "width" | "height" | "depth", mn: number, mx: number) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <NumberField
        draftKey={`${sel.id}:${key}`}
        value={toDisplayNumber(sel[key], u)}
        onCommit={commitDim(key, mn, mx)}
        step={u === "mm" ? 1 : 0.125}
      />
    </div>
  );

  const presetStyle = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? color.inkStrong : color.border}`,
    background: active ? color.inkStrong : color.panel,
    color: active ? color.onDark : color.inkStrong,
    borderRadius: 5,
    padding: "6px 11px",
    fontFamily: font.mono,
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: color.inkMuted }}>
          {typeLabel(sel.type)} · {sel.name}
        </div>
        <Swatch c={accent} size={14} />
      </div>
      <Serif style={{ fontSize: 24, marginBottom: 18 }}>
        {fmtLen(sel.width, u)} × {fmtLen(sel.height, u)} × {fmtLen(sel.depth, u)}
      </Serif>

      <FieldLabel>Cabinet type</FieldLabel>
      <Select
        value={sel.type}
        onChange={(e) => setCabinetType(sel.id, e.target.value as Cabinet["type"])}
        style={{ marginBottom: 16 }}
      >
        <option value="base">Base cabinet</option>
        <option value="wall">Wall / upper</option>
        <option value="tall">Tall / pantry</option>
      </Select>

      <FieldLabel>Construction</FieldLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <Toggle active={!framed} style={{ flex: 1 }} onClick={() => setConstruction(sel.id, "frameless")}>
          Frameless
        </Toggle>
        <Toggle active={framed} style={{ flex: 1 }} onClick={() => setConstruction(sel.id, "framed")}>
          Face frame
        </Toggle>
      </div>

      {!isOpening && (
        <>
          <FieldLabel>Front fit</FieldLabel>
          <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
            <Toggle active={overlayFull} style={{ flex: "1 1 30%", padding: "8px 6px", fontSize: 12 }} onClick={() => setOverlay(sel.id, "full")}>
              Full overlay
            </Toggle>
            <Toggle active={railed} style={{ flex: "1 1 30%", padding: "8px 6px", fontSize: 12 }} onClick={() => setOverlay(sel.id, "inset_rail")}>
              Railed inset
            </Toggle>
            <Toggle active={flush} style={{ flex: "1 1 30%", padding: "8px 6px", fontSize: 12 }} onClick={() => setOverlay(sel.id, "inset")}>
              Flush inset
            </Toggle>
          </div>
          <div style={{ fontFamily: font.mono, fontSize: 10, color: color.faint, marginBottom: 16 }}>
            {overlayFull
              ? "fronts sit proud over the box"
              : railed
                ? "flush in the openings · rail between every face"
                : "flush in the openings · gaps only, no rails"}
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        {dimCell(`Width (${unitLabel(u)})`, "width", 6, 48)}
        {dimCell(`Height (${unitLabel(u)})`, "height", 6, 96)}
        {dimCell(`Depth (${unitLabel(u)})`, "depth", 6, 30)}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
        {presetVals.map((v) => (
          <button key={v} onClick={() => updateCab(sel.id, { width: v })} style={presetStyle(sel.width === v)}>
            {fmtLen(v, u)}
          </button>
        ))}
      </div>

      <Divider style={{ margin: "4px 0 16px" }} />

      <FieldLabel>Front</FieldLabel>
      <Select
        value={sel.frontStyle}
        onChange={(e) => setFrontStyle(sel.id, e.target.value as FrontStyle)}
        style={{ marginBottom: 14 }}
      >
        {frontOptions.map((fo) => (
          <option key={fo.value} value={fo.value}>
            {fo.label}
          </option>
        ))}
      </Select>

      {(sel.frontStyle === "doors" || sel.frontStyle === "door_drawer") && (
        <Row label="Doors">
          <Stepper
            value={sel.doorCount}
            min={sel.doorCount <= 1}
            max={sel.doorCount >= 4}
            onDec={() => updateCab(sel.id, { doorCount: Math.max(1, sel.doorCount - 1) })}
            onInc={() => updateCab(sel.id, { doorCount: Math.min(4, sel.doorCount + 1) })}
          />
        </Row>
      )}

      {(sel.frontStyle === "drawers" || isDesk) && (
        <Row label="Drawers">
          <Stepper
            value={sel.drawerCount}
            min={sel.drawerCount <= 1}
            max={sel.drawerCount >= 6}
            onDec={() => setDrawerCount(sel.id, Math.max(1, sel.drawerCount - 1))}
            onInc={() => setDrawerCount(sel.id, Math.min(6, sel.drawerCount + 1))}
          />
        </Row>
      )}

      {hasDrawers && (
        <div style={{ marginBottom: 18, border: `1px solid ${color.divider}`, borderRadius: 6, padding: "12px 12px 6px", background: color.panel }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
            <span style={{ fontFamily: font.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.faint }}>
              Drawer front heights
            </span>
            <button
              onClick={() => resetDrawerHeights(sel.id)}
              style={{ border: "none", background: "transparent", color: color.greenDeep, fontFamily: font.mono, fontSize: 11, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, padding: 0 }}
            >
              even
            </button>
          </div>
          {drawerRows.map((dh) => (
            <div key={dh.i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: color.inkMuted }}>{dh.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <NumberField
                  draftKey={`${sel.id}:dh${dh.i}`}
                  value={toDisplayNumber(dh.value, u)}
                  step={u === "mm" ? 1 : 0.125}
                  align="right"
                  style={{ width: 74, background: color.page, padding: "6px 8px", fontSize: 13 }}
                  onCommit={(raw) => {
                    const inches = parseLen(raw, u);
                    if (!isNaN(inches)) setDrawerHeightAt(sel.id, dh.i, inches);
                  }}
                />
                <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint }}>{unitLabel(u)}</span>
              </div>
            </div>
          ))}
          <div style={{ fontFamily: font.mono, fontSize: 11, color: "#6E8157", padding: "2px 0 6px" }}>{drawerNote}</div>
        </div>
      )}

      {!isDesk && !isOpening && (
        <Row label="Shelves">
          <Stepper
            value={sel.shelves}
            min={sel.shelves <= 0}
            max={sel.shelves >= 8}
            onDec={() => updateCab(sel.id, { shelves: Math.max(0, sel.shelves - 1) })}
            onInc={() => updateCab(sel.id, { shelves: Math.min(8, sel.shelves + 1) })}
          />
        </Row>
      )}

      {sel.type !== "wall" && !isDesk && !isOpening && (
        <div style={{ marginBottom: 18 }}>
          <FieldLabel>Base</FieldLabel>
          <Toggle
            active={tkOn}
            style={{ width: "100%", textAlign: "left", padding: "9px 12px" }}
            onClick={() => updateCab(sel.id, { toeKick: !tkOn })}
          >
            {tkOn ? `Toe kick on · ${fmtLen(s.toeKick, u)} recess` : "Sits flush to floor"}
          </Toggle>
        </div>
      )}

      <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, background: color.panelAlt, borderRadius: 5, padding: "9px 11px", marginBottom: 18, lineHeight: 1.5 }}>
        Carcass box: {boxNote}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="ghost" style={{ flex: 1, padding: 9 }} onClick={() => duplicateCab(sel.id)}>
          Duplicate
        </Button>
        <Button variant="danger" style={{ flex: 1 }} onClick={() => removeCab(sel.id)}>
          Remove
        </Button>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint }}>
        {typeLabel(sel.type)} · {frontStyleLabel(sel.frontStyle)}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      {children}
    </div>
  );
}
