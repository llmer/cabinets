import { CSSProperties } from "react";
import { LinearBoardSpec, Role, Stock } from "@/domain/types";
import { color, font } from "@/theme";
import { parseLen, toDisplayNumber, unitLabel } from "@/engine/units";
import { DEFAULT_SETTINGS } from "@/domain/defaults";
import { useStore } from "@/state/store";
import {
  Button,
  Divider,
  FieldLabel,
  MonoLabel,
  NumberField,
  Select,
  Serif,
  Toggle,
} from "@/components/ui";

const ROLE_LABELS: Record<Role, string> = {
  carcass: "Carcass (sides, top/bottom, shelves)",
  back: "Back panel",
  front: "Doors & drawer fronts",
  drawerBox: "Drawer boxes",
  drawerBottom: "Drawer bottoms",
  faceFrame: "Face frames",
  base: "Toe-kick base & fascia",
};

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24, border: `1px solid ${color.border}`, borderRadius: 8, background: color.panel, overflow: "hidden" }}>
      <div style={{ padding: "13px 18px", background: color.panelAlt, borderBottom: `1px solid ${color.border}` }}>
        <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.06em" }}>{title}</span>
        {sub ? <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint, marginLeft: 10 }}>{sub}</span> : null}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

const grid3: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 };
const labelStyle: CSSProperties = { fontSize: 14 };

export function SettingsView() {
  const settings = useStore((s) => s.project.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateStock = useStore((s) => s.updateStock);
  const setRoleStock = useStore((s) => s.setRoleStock);
  const updateHardware = useStore((s) => s.updateHardware);
  const setToast = useStore((s) => s.setToast);
  const u = settings.units;

  const dimField = (key: keyof typeof settings, label: string, mn: number, mx: number) => (
    <div>
      <FieldLabel>{`${label} (${unitLabel(u)})`}</FieldLabel>
      <NumberField
        draftKey={`set:${String(key)}`}
        value={toDisplayNumber(settings[key] as number, u)}
        step={u === "mm" ? 1 : 0.0625}
        onCommit={(raw) => {
          const v = parseLen(raw, u);
          if (!isNaN(v)) updateSettings({ [key]: Math.max(mn, Math.min(mx, v)) } as never);
        }}
      />
    </div>
  );

  const costField = (value: number, label: string, onCommit: (n: number) => void, step = 0.25) => (
    <div key={`${label}:${value}`}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        step={step}
        min={0}
        defaultValue={value}
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onCommit(Math.max(0, v));
        }}
        className="mono"
        style={{ width: "100%", border: `1px solid ${color.border}`, background: color.page, borderRadius: 5, padding: "8px 9px", fontSize: 14 }}
      />
    </div>
  );

  const stockList: Stock[] = Object.values(settings.stocks);

  return (
    <div style={{ padding: "30px 36px", maxWidth: 920 }}>
      <MonoLabel>Project settings</MonoLabel>
      <Serif style={{ fontSize: 36, margin: "2px 0 18px" }}>Dial in your shop.</Serif>

      <Card title="Shop dimensions" sub="defaults that drive every cabinet">
        <div style={grid3}>
          {dimField("reveal", "Reveal / gap", 0, 1)}
          {dimField("toeKick", "Toe-kick height", 0, 8)}
          {dimField("toeKickDepth", "Toe-kick recess", 0, 6)}
          {dimField("upperBottom", "Floor → upper", 30, 80)}
          {dimField("counterH", "Counter height", 24, 48)}
          {dimField("frameWidth", "Frame / rail width", 0.75, 3)}
          {dimField("faceFrameTop", "Frame top rail", 0.75, 4)}
        </div>
      </Card>

      <Card title="Build defaults">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <div>
            <FieldLabel>New cabinets use</FieldLabel>
            <div style={{ display: "flex", gap: 6 }}>
              <Toggle active={settings.construction === "frameless"} onClick={() => updateSettings({ construction: "frameless" })}>
                Frameless
              </Toggle>
              <Toggle active={settings.construction === "framed"} onClick={() => updateSettings({ construction: "framed" })}>
                Face frame
              </Toggle>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.includeDrawerBoxes} onChange={(e) => updateSettings({ includeDrawerBoxes: e.target.checked })} />
            Generate drawer-box parts
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.pocketHoles} onChange={(e) => updateSettings({ pocketHoles: e.target.checked })} />
            Pocket-hole joinery in the build guide (jig settings + screws)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.showGuideLines} onChange={(e) => updateSettings({ showGuideLines: e.target.checked })} />
            Show elevation guide lines
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.allowRotate} onChange={(e) => updateSettings({ allowRotate: e.target.checked })} />
            Allow grain rotation when nesting
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.storeBreakdown} onChange={(e) => updateSettings({ storeBreakdown: e.target.checked })} />
            Plan store rip cuts (panel-saw breakdown)
          </label>
          {settings.storeBreakdown && dimField("storeTrim", "Store rip trim", 0, 4)}
        </div>
        {settings.storeBreakdown && (
          <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, marginTop: 10 }}>
            The sheet optimizer plans full-length rips the store&apos;s panel saw makes for you —
            easier to haul. Store cuts are rough, so every part keeps the trim allowance clear of
            them for a clean track-saw re-cut at home.
          </div>
        )}
      </Card>

      <Card title="Runs & toe-kick base" sub="how joined cabinets share a face frame and a base">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.continuousFaceFrame} onChange={(e) => updateSettings({ continuousFaceFrame: e.target.checked })} />
            Continuous face frame across each run
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.separateBase} onChange={(e) => updateSettings({ separateBase: e.target.checked })} />
            Separate toe-kick base (ladder + fascia)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...labelStyle, cursor: "pointer" }}>
            <input type="checkbox" checked={settings.sharedPartitions} onChange={(e) => updateSettings({ sharedPartitions: e.target.checked })} />
            Shared partitions between joined bays
          </label>
        </div>
        <div style={grid3}>
          {dimField("faceFrameFloorGap", "Frame off floor", 0, 8)}
          {dimField("toeKickSideRecess", "Toe-kick side recess", 0, 6)}
        </div>
        <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, marginTop: 10 }}>
          A run = contiguous joined cabinets of the same height &amp; depth. Mark “start a new run” on a
          cabinet in its editor to break one at a corner, an appliance gap, or a separate wall.
        </div>
      </Card>

      <Card title="Materials" sub="sheet goods nest on their own sizes; hardwood is sold by the foot">
        {stockList.map((stock) => (
          <div key={stock.id} style={{ marginBottom: 14 }}>
            <FieldLabel>{stock.label}</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: stock.kind === "sheet" ? "1.4fr 1fr 1fr 1fr 1fr" : "1.4fr 1fr 1fr", gap: 10, alignItems: "center" }}>
              <input
                defaultValue={stock.label}
                onBlur={(e) => updateStock(stock.id, { label: e.target.value || stock.label })}
                style={{ border: `1px solid ${color.border}`, background: color.page, borderRadius: 5, padding: "8px 9px", fontSize: 13 }}
              />
              {numCell(toDisplayNumber(stock.thickness, u), `Thick (${unitLabel(u)})`, (raw) => {
                const v = parseLen(raw, u);
                if (!isNaN(v)) updateStock(stock.id, { thickness: v });
              })}
              {stock.kind === "sheet" ? (
                <>
                  {numCell(toDisplayNumber(stock.sheetW, u), `Len (${unitLabel(u)})`, (raw) => {
                    const v = parseLen(raw, u);
                    if (!isNaN(v)) updateStock(stock.id, { sheetW: v });
                  })}
                  {numCell(toDisplayNumber(stock.sheetH, u), `Wid (${unitLabel(u)})`, (raw) => {
                    const v = parseLen(raw, u);
                    if (!isNaN(v)) updateStock(stock.id, { sheetH: v });
                  })}
                  {numCell(stock.costPerSheet, "$/sheet", (raw) => {
                    const v = parseFloat(raw);
                    if (!isNaN(v)) updateStock(stock.id, { costPerSheet: Math.max(0, v) });
                  }, true)}
                </>
              ) : (
                numCell(stock.costPerFoot, "$/ft", (raw) => {
                  const v = parseFloat(raw);
                  if (!isNaN(v)) updateStock(stock.id, { costPerFoot: Math.max(0, v) });
                }, true)
              )}
            </div>
            {stock.kind === "linear" && (
              <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: `2px solid ${color.border}` }}>
                <div style={{ fontFamily: font.mono, fontSize: 9, color: color.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".08em" }}>
                  Boards on hand — part widths are ripped from these (none = buy a board per width)
                </div>
                {(stock.boards || []).map((b, i) => (
                  <div key={`${stock.id}:${i}/${stock.boards!.length}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 6, maxWidth: 420 }}>
                    {numCell(toDisplayNumber(b.width, u), `Wid (${unitLabel(u)})`, (raw) => {
                      const v = parseLen(raw, u);
                      if (!isNaN(v) && v > 0) updateStock(stock.id, { boards: withBoard(stock.boards!, i, { width: v }) });
                    })}
                    {numCell(toDisplayNumber(b.length, u), `Len (${unitLabel(u)})`, (raw) => {
                      const v = parseLen(raw, u);
                      if (!isNaN(v) && v > 0) updateStock(stock.id, { boards: withBoard(stock.boards!, i, { length: v }) });
                    })}
                    {numCell(b.qty, "Qty", (raw) => {
                      const v = Math.round(parseFloat(raw));
                      if (!isNaN(v) && v > 0) updateStock(stock.id, { boards: withBoard(stock.boards!, i, { qty: v }) });
                    })}
                    <Button variant="mono" onClick={() => updateStock(stock.id, { boards: stock.boards!.filter((_, j) => j !== i) })}>
                      ✕
                    </Button>
                  </div>
                ))}
                <Button variant="mono" onClick={() => updateStock(stock.id, { boards: [...(stock.boards || []), { width: 3.5, length: 96, qty: 1 }] })}>
                  + board
                </Button>
              </div>
            )}
          </div>
        ))}
        <Divider style={{ margin: "8px 0 16px" }} />
        <FieldLabel>Which material each part is cut from</FieldLabel>
        <div style={grid3}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <div key={role}>
              <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, marginBottom: 5 }}>{ROLE_LABELS[role]}</div>
              <Select value={settings.roleStock[role]} onChange={(e) => setRoleStock(role, e.target.value)}>
                {stockList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Hardware & banding pricing">
        <div style={grid3}>
          {costField(settings.hardware.hingeEach, "$ / hinge", (v) => updateHardware({ hingeEach: v }))}
          {costField(settings.hardware.slidePairEach, "$ / slide pair", (v) => updateHardware({ slidePairEach: v }))}
          {costField(settings.hardware.pullEach, "$ / pull", (v) => updateHardware({ pullEach: v }))}
          {costField(settings.hardware.shelfPinEach, "$ / shelf pin", (v) => updateHardware({ shelfPinEach: v }), 0.05)}
          {costField(settings.edgeBandPerFoot, "$ / ft edge-band", (v) => updateSettings({ edgeBandPerFoot: v }), 0.05)}
          <label style={{ display: "flex", alignItems: "flex-end", gap: 8, ...labelStyle, cursor: "pointer", paddingBottom: 8 }}>
            <input type="checkbox" checked={settings.hardware.countPulls} onChange={(e) => updateHardware({ countPulls: e.target.checked })} />
            Count pulls / knobs
          </label>
        </div>
      </Card>

      <Button
        variant="ghost"
        onClick={() => {
          if (confirm("Reset all settings to defaults? Cabinets are kept.")) {
            updateSettings(structuredClone(DEFAULT_SETTINGS));
            setToast("Settings reset to defaults.");
          }
        }}
      >
        Reset settings to defaults
      </Button>
    </div>
  );
}

function withBoard(boards: LinearBoardSpec[], i: number, patch: Partial<LinearBoardSpec>): LinearBoardSpec[] {
  return boards.map((b, j) => (j === i ? { ...b, ...patch } : b));
}

function numCell(value: number, label: string, onCommit: (raw: string) => void, money = false) {
  return (
    <div key={`${label}:${value}`}>
      <div style={{ fontFamily: font.mono, fontSize: 9, color: color.faint, marginBottom: 3, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      <input
        type="number"
        step={money ? 0.5 : 0.0625}
        min={0}
        defaultValue={value}
        onBlur={(e) => onCommit(e.target.value)}
        className="mono"
        style={{ width: "100%", border: `1px solid ${color.border}`, background: color.page, borderRadius: 5, padding: "7px 8px", fontSize: 13 }}
      />
    </div>
  );
}
