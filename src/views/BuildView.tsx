import { color, font } from "@/theme";
import { constructionInfo } from "@/engine/labels";
import { drawerBoxSpecs } from "@/engine/parts";
import { fmtLen } from "@/engine/units";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { Button, MonoLabel, Serif, Swatch } from "@/components/ui";

export function BuildView() {
  const { summary, stepGroups, cabinetParts } = useModel();
  const settings = useStore((s) => s.project.settings);
  const cabinets = useStore((s) => s.project.cabinets);
  const ci = constructionInfo(cabinets);
  const u = settings.units;

  const specsById = new Map(
    cabinetParts.map((cp) => [cp.cabinet.id, drawerBoxSpecs(cp.cabinet, settings)] as const),
  );

  const dcell: React.CSSProperties = { padding: "7px 12px", fontFamily: font.mono, fontSize: 13 };
  const dhead: React.CSSProperties = {
    ...dcell,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: color.faint,
    textAlign: "left",
    fontWeight: 500,
  };

  return (
    <div style={{ padding: "30px 36px", maxWidth: 880 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <MonoLabel>Assembly · {ci.label}</MonoLabel>
          <Serif style={{ fontSize: 36, margin: "2px 0 4px" }}>Build it, one box at a time.</Serif>
        </div>
        <Button variant="mono" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div style={{ fontSize: 14, color: color.inkMuted, marginBottom: 4, maxWidth: 640 }}>
        Shopping list: {summary.sheetCount} sheets of 3/4&quot; ply · {summary.bandLF} ft edge-banding · {summary.hinges} hinges ·{" "}
        {summary.slides} drawer-slide pairs · {summary.shelfPins} shelf pins · a box of confirmat (or 1 1/4&quot;) screws &amp; glue.
      </div>
      {summary.framed && (
        <div style={{ fontSize: 14, color: color.hardwood, marginBottom: 8, maxWidth: 640 }}>
          Plus ~{summary.frameLF} ft of 1 1/2&quot; × 3/4&quot; hardwood for the face frames.
        </div>
      )}

      {stepGroups.map((sg) => {
        const specs = specsById.get(sg.id) ?? [];
        const framed = cabinetParts.find((cp) => cp.cabinet.id === sg.id)?.geometry.framed ?? false;
        return (
          <div key={sg.id} style={{ margin: "22px 0", border: `1px solid ${color.border}`, borderRadius: 8, background: color.panel, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", background: color.panelAlt, borderBottom: `1px solid ${color.border}` }}>
              <Swatch c={sg.color} />
              <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.06em" }}>{sg.name}</span>
              <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint }}>{sg.typeLabel} · {sg.dims}</span>
            </div>
            <div style={{ padding: "8px 18px 16px" }}>
              {sg.steps.map((st) => (
                <div key={st.n} style={{ display: "flex", gap: 14, padding: "11px 0", borderBottom: `1px solid ${color.rule}` }}>
                  <div style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", border: `1px solid ${color.border}`, background: color.page, fontFamily: font.mono, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", color: color.inkStrong }}>
                    {st.n}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.55, paddingTop: 2 }}>{st.t}</div>
                </div>
              ))}

              {specs.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontFamily: font.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.faint, marginBottom: 6 }}>
                    Drawer boxes · {settings.stocks[settings.roleStock.drawerBox].label} sides, {settings.stocks[settings.roleStock.drawerBottom].label} bottom
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", background: color.page, border: `1px solid ${color.rule}`, borderRadius: 6 }}>
                    <thead>
                      <tr>
                        <th style={dhead}>Drawer</th>
                        <th style={dhead}>Front H</th>
                        <th style={dhead}>Box W × D × H</th>
                        <th style={dhead}>2 sides</th>
                        <th style={dhead}>2 fr/bk</th>
                        <th style={dhead}>Bottom</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specs.map((sp) => (
                        <tr key={sp.index} style={{ borderTop: `1px solid ${color.rule}` }}>
                          <td style={dcell}>#{sp.index}</td>
                          <td style={dcell}>{fmtLen(sp.frontHeight, u)}</td>
                          <td style={dcell}>
                            {fmtLen(sp.boxWidth, u)} × {fmtLen(sp.boxDepth, u)} × {fmtLen(sp.boxHeight, u)}
                          </td>
                          <td style={dcell}>{fmtLen(sp.boxDepth, u)} × {fmtLen(sp.boxHeight, u)}</td>
                          <td style={dcell}>{fmtLen(sp.boxWidth - 2 * sp.sideThickness, u)} × {fmtLen(sp.boxHeight, u)}</td>
                          <td style={dcell}>{fmtLen(sp.bottomWidth, u)} × {fmtLen(sp.bottomLength, u)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontFamily: font.mono, fontSize: 11, color: color.faint, marginTop: 6, lineHeight: 1.5 }}>
                    Groove the 1/4&quot; bottom 1/4&quot; up from the bottom edge of all four box parts; glue + pin the sides to the
                    front &amp; back, slide the bottom in (no glue), check square, then mount on the slides.
                    {framed
                      ? " The box is sized to the face-frame opening — bridge the side-mount slides out to the carcass with rear sockets or ~1\" spacers."
                      : " The box is 1\" narrower than the opening for the slides."}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
