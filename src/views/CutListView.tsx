import { color, font } from "@/theme";
import { constructionInfo } from "@/engine/labels";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { cutListCsv, shoppingListText } from "@/state/exporters";
import { downloadText } from "@/state/persistence";
import { Button, MonoLabel, Serif, Swatch } from "@/components/ui";

const th: React.CSSProperties = {
  padding: "9px 18px",
  fontWeight: 500,
  fontFamily: font.mono,
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: color.faint,
  textAlign: "left",
};

export function CutListView() {
  const model = useModel();
  const settings = useStore((s) => s.project.settings);
  const cabinets = useStore((s) => s.project.cabinets);
  const projectName = useStore((s) => s.project.name);
  const { summary, cutGroups, cost } = model;
  const ci = constructionInfo(cabinets);

  return (
    <div style={{ padding: "30px 36px", maxWidth: 1100 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <MonoLabel>Cut list · {ci.label}</MonoLabel>
          <Serif style={{ fontSize: 36, margin: "2px 0 4px" }}>Every part, every panel.</Serif>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="mono" onClick={() => downloadText(`${slug(projectName)}-cutlist.csv`, cutListCsv(model, settings))}>
            Export CSV
          </Button>
          <Button variant="mono" onClick={() => downloadText(`${slug(projectName)}-shopping.txt`, shoppingListText(model, settings), "text/plain")}>
            Shopping list
          </Button>
          <Button variant="mono" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>
      <div style={{ fontSize: 14, color: color.inkMuted, marginBottom: 22, maxWidth: 640 }}>
        {summary.count} cabinets · {summary.pieces} pieces · {summary.totalArea} sq ft of panel · {summary.bandLF} ft of edge-banding.
      </div>

      {cutGroups.map((g) => (
        <div key={g.id} style={{ marginBottom: 26, border: `1px solid ${color.border}`, borderRadius: 8, overflow: "hidden", background: color.panel }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", background: color.panelAlt, borderBottom: `1px solid ${color.border}` }}>
            <Swatch c={g.color} />
            <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.06em" }}>{g.name}</span>
            <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint }}>{g.typeLabel} · {g.dims}</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={th}>Part</th>
                <th style={th}>Qty</th>
                <th style={th}>Length</th>
                <th style={th}>Width</th>
                <th style={th}>Edge-band</th>
              </tr>
            </thead>
            <tbody>
              {g.parts.map((p, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${color.rule}` }}>
                  <td style={{ padding: "9px 18px" }}>
                    {p.name}{" "}
                    {p.matTag ? <span style={{ fontFamily: font.mono, fontSize: 11, color: color.hardwood }}>{p.matTag}</span> : null}
                  </td>
                  <td style={{ padding: "9px 12px", fontFamily: font.mono, color: color.inkMuted }}>{p.qtyStr}</td>
                  <td style={{ padding: "9px 12px", fontFamily: font.mono }}>{p.lenStr}</td>
                  <td style={{ padding: "9px 12px", fontFamily: font.mono }}>{p.widStr}</td>
                  <td style={{ padding: "9px 12px", fontFamily: font.mono, color: color.faint, fontSize: 12 }}>{p.edgeStr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Cost breakdown */}
      <div style={{ marginBottom: 26, border: `1px solid ${color.border}`, borderRadius: 8, overflow: "hidden", background: color.panel }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", background: color.panelAlt, borderBottom: `1px solid ${color.border}` }}>
          <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.06em" }}>Estimated material & hardware</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            {cost.lines.map((l) => (
              <tr key={l.key} style={{ borderTop: `1px solid ${color.rule}` }}>
                <td style={{ padding: "9px 18px" }}>{l.label}</td>
                <td style={{ padding: "9px 12px", fontFamily: font.mono, color: color.faint }}>{l.detail}</td>
                <td style={{ padding: "9px 18px", fontFamily: font.mono, textAlign: "right" }}>${l.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${color.border}` }}>
              <td style={{ padding: "11px 18px", fontWeight: 600 }}>Total</td>
              <td />
              <td style={{ padding: "11px 18px", fontFamily: font.mono, textAlign: "right", color: color.rust, fontWeight: 600 }}>
                ${cost.total.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, lineHeight: 1.6, borderTop: `1px solid ${color.divider}`, paddingTop: 14, maxWidth: 760 }}>
        {ci.note}
      </div>
    </div>
  );
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "kitchen";
}
