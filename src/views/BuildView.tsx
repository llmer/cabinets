import { color, font } from "@/theme";
import { constructionInfo } from "@/engine/labels";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { Button, MonoLabel, Serif, Swatch } from "@/components/ui";

export function BuildView() {
  const { summary, stepGroups } = useModel();
  const cabinets = useStore((s) => s.project.cabinets);
  const ci = constructionInfo(cabinets);

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

      {stepGroups.map((sg) => (
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
          </div>
        </div>
      ))}
    </div>
  );
}
