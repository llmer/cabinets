import { color, font } from "@/theme";
import { constructionInfo } from "@/engine/labels";
import { fmtLen, toFrac } from "@/engine/units";
import { StockPack } from "@/engine/packing";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { sheetsCsv } from "@/state/exporters";
import { downloadText } from "@/state/persistence";
import { Button, MonoLabel, Serif, Swatch, Toggle } from "@/components/ui";

function SheetPack({ pack, units, kerf, rot }: { pack: StockPack; units: "in" | "mm"; kerf: number; rot: boolean }) {
  void kerf;
  void rot;
  const sc = 430 / pack.sheetW;
  const Wpx = pack.sheetW * sc;
  const Hpx = pack.sheetH * sc;
  const packYield = pack.sheets.length ? Math.round((pack.usedArea / (pack.sheets.length * pack.sheetArea)) * 100) : 0;
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted, marginBottom: 12, letterSpacing: ".04em" }}>
        {pack.label} · {pack.sheets.length} sheet{pack.sheets.length === 1 ? "" : "s"} · {packYield}% yield
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 26 }}>
        {pack.sheets.map((sheet, i) => (
          <div key={i} style={{ flex: "none" }}>
            <div style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: ".06em", color: color.inkMuted, marginBottom: 6 }}>
              Sheet {i + 1} / {pack.sheets.length} · {fmtLen(pack.sheetH, units)} × {fmtLen(pack.sheetW, units)}
            </div>
            <div style={{ position: "relative", width: Wpx, height: Hpx, background: color.panel, border: `1px solid ${color.inkStrong}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(31,20,14,.06)" }}>
              {sheet.placements.map((p, j) => {
                const pw = p.w * sc;
                const ph = p.h * sc;
                const showTxt = pw > 52 && ph > 20;
                return (
                  <div
                    key={j}
                    title={`${p.label} · ${p.part} · ${toFrac(p.w)} × ${toFrac(p.h)}`}
                    style={{
                      position: "absolute",
                      left: p.x * sc,
                      top: p.y * sc,
                      width: Math.max(1, pw - 1),
                      height: Math.max(1, ph - 1),
                      background: p.color + "40",
                      border: `1px solid ${p.color}`,
                      borderRadius: 1,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {showTxt ? (
                      <span style={{ fontFamily: font.mono, fontSize: 9, color: color.inkStrong, textAlign: "center", lineHeight: 1.2, padding: "1px 2px" }}>
                        {fmtLen(p.w, units)} × {fmtLen(p.h, units)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SheetsView() {
  const model = useModel();
  const settings = useStore((s) => s.project.settings);
  const cabinets = useStore((s) => s.project.cabinets);
  const projectName = useStore((s) => s.project.name);
  const updateSettings = useStore((s) => s.updateSettings);
  const { summary, packs, legend } = model;
  const ci = constructionInfo(cabinets);
  const u = settings.units;

  const kerfDelta = (d: number) =>
    updateSettings({ kerf: Math.max(0, +(settings.kerf + d).toFixed(3)) });

  return (
    <div style={{ padding: "30px 36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <MonoLabel>
            Sheet optimizer · {ci.label} · {fmtLen(settings.stocks.ply34.sheetH, u)} × {fmtLen(settings.stocks.ply34.sheetW, u)} sheets
          </MonoLabel>
          <Serif style={{ fontSize: 36, marginTop: 2 }}>
            {summary.sheetCount} sheets, {summary.yieldStr} yield.
          </Serif>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: color.faint }}>Kerf</span>
            <div style={{ display: "flex", border: `1px solid ${color.border}`, borderRadius: 5, overflow: "hidden" }}>
              <button onClick={() => kerfDelta(-0.0625)} style={{ border: "none", background: color.panel, padding: "6px 11px", cursor: "pointer", color: color.inkStrong }}>−</button>
              <span style={{ fontFamily: font.mono, fontSize: 13, minWidth: 56, textAlign: "center", alignSelf: "center" }}>{fmtLen(settings.kerf, u)}</span>
              <button onClick={() => kerfDelta(0.0625)} style={{ border: "none", background: color.panel, padding: "6px 11px", cursor: "pointer", color: color.inkStrong }}>+</button>
            </div>
          </div>
          <Toggle active={settings.allowRotate} style={{ fontFamily: font.mono, fontSize: 12, padding: "7px 13px" }} onClick={() => updateSettings({ allowRotate: !settings.allowRotate })}>
            {settings.allowRotate ? "Grain: rotation OK" : "Grain: locked"}
          </Toggle>
          <Button variant="mono" onClick={() => downloadText(`${slug(projectName)}-sheets.csv`, sheetsCsv(model))}>
            Export CSV
          </Button>
        </div>
      </div>

      {summary.oversize > 0 && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: color.danger, border: `1px solid ${color.danger}`, background: color.panel, borderRadius: 6, padding: "10px 14px", marginBottom: 18 }}>
          ⚠ {summary.oversize} part(s) won&apos;t fit a single sheet — split them or order a larger panel.
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        {legend.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: font.mono, fontSize: 12, color: color.inkMuted }}>
            <Swatch c={l.color} size={12} />
            {l.name}
          </div>
        ))}
      </div>

      {packs.length === 0 ? (
        <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 20, color: color.faint }}>
          No sheet parts yet — add a cabinet.
        </div>
      ) : (
        packs.map((pack) => <SheetPack key={pack.stockId} pack={pack} units={u} kerf={settings.kerf} rot={settings.allowRotate} />)
      )}
    </div>
  );
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "kitchen";
}
