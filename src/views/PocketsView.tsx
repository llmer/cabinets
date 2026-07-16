import { Suspense, lazy, useEffect, useState } from "react";
import { color, font } from "@/theme";
import { fmtLen } from "@/engine/units";
import { PocketRow, pocketRow, screwLabel } from "@/engine/pocketHoles";
import { Part, Settings } from "@/domain/types";
import { Model } from "@/engine/compute";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { MonoLabel, Serif, Swatch } from "@/components/ui";

// Three.js stays out of the initial bundle — the bench view loads on demand,
// and only after mount so the node smoke test never touches WebGL.
const PocketScenePanel = lazy(() =>
  import("./PocketScenePanel").then((m) => ({ default: m.PocketScenePanel })),
);

interface SelRow {
  groupId: string;
  index: number;
  part: Part;
  row: PocketRow;
  label: string;
}

/** The tab shell: the enable prompt, or the schedule once the setting is on. */
export function PocketsView() {
  const model = useModel();
  const settings = useStore((s) => s.project.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  if (!model.pocketPlan) {
    return (
      <div style={{ padding: "30px 36px" }}>
        <MonoLabel>Pocket holes</MonoLabel>
        <Serif style={{ fontSize: 36, marginTop: 2 }}>Pocket-hole joinery is off.</Serif>
        <p style={{ fontFamily: font.mono, fontSize: 13, color: color.inkMuted, maxWidth: 560, lineHeight: 1.6 }}>
          Turn it on and the build guide walks every joint with jig settings and matching screws,
          and this tab becomes the drill schedule: which pieces, how many pockets, which face.
        </p>
        <button
          onClick={() => updateSettings({ pocketHoles: true })}
          style={{ border: `1px solid ${color.inkStrong}`, background: color.panel, borderRadius: 6, padding: "10px 18px", fontFamily: font.mono, fontSize: 13, cursor: "pointer", color: color.inkStrong }}
        >
          Enable pocket-hole joinery
        </button>
      </div>
    );
  }
  return <PocketSchedule model={model} settings={settings} />;
}

/**
 * The pocket-hole schedule: which pieces get pockets, how many, in WHICH face
 * (always the hidden one, so the sanded show face lands where it's visible),
 * the jig setting per stock, the screws to drive — and a 3D bench view of the
 * selected board. Pure against (model, settings) and exported for the render
 * smoke test (SSR keeps `mounted` false, so the lazy 3D subtree never loads);
 * never recomputes domain math.
 */
export function PocketSchedule({ model, settings }: { model: Model; settings: Settings }) {
  const [mounted, setMounted] = useState(false);
  const [sel, setSel] = useState<{ groupId: string; index: number } | null>(null);
  useEffect(() => setMounted(true), []);

  const u = settings.units;
  const plan = model.pocketPlan!;

  // One flat list of drillable rows, grouped for display.
  const groups = model.cutGroups
    .map((g) => ({
      g,
      rows: g.parts
        .map((p, index) => {
          const row = pocketRow(p.part, settings, g.typeLabel === "Wall");
          return row
            ? ({ groupId: g.id, index, part: p.part, row, label: `${p.qtyStr} ${p.name} ${p.lenStr} × ${p.widStr}` } as SelRow)
            : null;
        })
        .filter((x): x is SelRow => x != null),
      frame: plan.frames.find((f) => f.id === g.id),
    }))
    .filter((x) => x.rows.length > 0 || x.frame);

  const allRows = groups.flatMap((x) => x.rows);
  const active =
    (sel && allRows.find((r) => r.groupId === sel.groupId && r.index === sel.index)) || allRows[0];

  const totalScrews = plan.totals.reduce((a, t) => a + t.count, 0);
  const settingsUsed = [...new Set(plan.totals.map((t) => t.spec.setting))].sort((a, b) => b - a);

  const th: React.CSSProperties = { fontFamily: font.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: color.faint, textAlign: "left", padding: "6px 14px 6px 0" };
  const td: React.CSSProperties = { fontFamily: font.mono, fontSize: 12.5, color: color.ink, padding: "7px 14px 7px 0", verticalAlign: "top" };

  return (
    <div style={{ padding: "30px 36px" }}>
      <MonoLabel>
        Pocket-hole schedule · jig stops {settingsUsed.map((x) => fmtLen(x, u)).join(" + ")}
      </MonoLabel>
      <Serif style={{ fontSize: 36, margin: "2px 0 14px" }}>
        {totalScrews} screws, {plan.totals.length} kind{plan.totals.length === 1 ? "" : "s"}.
      </Serif>

      <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted, border: `1px solid ${color.border}`, background: color.panel, borderRadius: 6, padding: "10px 14px", marginBottom: 14, maxWidth: 980, lineHeight: 1.6 }}>
        <strong style={{ color: color.inkStrong }}>One rule: every pocket is drilled into the
        NON-sanded face. The sanded face never takes a pocket.</strong> The rows below tell you
        which way the sanded face points when the piece goes in. Set the jig&apos;s drill guide
        block AND the bit&apos;s stop collar to the same stop; drill everything for one stop before
        re-setting. Click a piece to see it on the bench.
      </div>

      <div style={{ fontFamily: font.mono, fontSize: 13, color: color.inkStrong, marginBottom: 22 }}>
        <strong>Buy:</strong>{" "}
        {plan.totals
          .map((t) => `${t.count} × ${screwLabel(t.spec, u)} (jig at ${fmtLen(t.spec.setting, u)})`)
          .join("  ·  ")}
        {" — plus spares"}
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 560px", minWidth: 0 }}>
          {groups.map(({ g, rows, frame }) => (
            <div key={g.id} style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Swatch c={g.color} size={12} />
                <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600 }}>{g.name}</span>
                <span style={{ fontFamily: font.mono, fontSize: 11, color: color.faint }}>{g.dims}</span>
              </div>
              {rows.length > 0 && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th}>Piece</th>
                      <th style={th}>Pockets each</th>
                      <th style={th}>Pockets go in</th>
                      <th style={th}>Sanded face</th>
                      <th style={th}>Jig</th>
                      <th style={th}>Screw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const isActive = active === r;
                      return (
                        <tr
                          key={`${r.groupId}:${r.index}`}
                          onClick={() => setSel({ groupId: r.groupId, index: r.index })}
                          style={{
                            borderTop: `1px solid ${color.divider}`,
                            cursor: "pointer",
                            background: isActive ? color.panelAlt : "transparent",
                          }}
                        >
                          <td style={{ ...td, fontWeight: isActive ? 600 : 400 }}>{r.label}</td>
                          <td style={td}>{r.row.perPiece}</td>
                          <td style={td}>{r.row.face}</td>
                          <td style={{ ...td, color: color.inkMuted }}>{r.row.showFace}</td>
                          <td style={td}>{fmtLen(r.row.spec.setting, u)}</td>
                          <td style={td}>{screwLabel(r.row.spec, u)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {frame && (
                <div style={{ fontFamily: font.mono, fontSize: 12.5, color: color.inkMuted, border: `1px dashed ${color.border}`, borderRadius: 6, padding: "10px 14px", marginTop: 8, lineHeight: 1.7 }}>
                  <strong style={{ color: color.hardwood }}>Face frame</strong> — pockets in the BACK
                  of each joining end, jig at {fmtLen(frame.spec.setting, u)},{" "}
                  {frame.screws} × {screwLabel(frame.spec, u)}:
                  <br />
                  · top end of all {frame.joints.stileTopEnds} stiles
                  {frame.joints.stileBottomEnds > 0 && (
                    <> · bottom end of the {frame.joints.stileBottomEnds} that rest on a bottom rail
                    (floor-running stiles join only at the top)</>
                  )}
                  {frame.joints.midRailEnds > 0 && <> · both ends of every mid rail ({frame.joints.midRailEnds} ends)</>}
                  {frame.joints.railButtEnds > 0 && (
                    <> · the {frame.joints.railButtEnds} bottom-rail end{frame.joints.railButtEnds === 1 ? "" : "s"} butting a full-height stile</>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {active && mounted && (
          <div className="no-print" style={{ flex: "0 1 400px", minWidth: 320, position: "sticky", top: 20 }}>
            <div style={{ fontFamily: font.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.faint, marginBottom: 8 }}>
              On the bench · drilled face up
            </div>
            <Suspense
              fallback={
                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.serif, fontStyle: "italic", color: color.faint, border: `1px solid ${color.border}`, borderRadius: 8 }}>
                  Loading 3D…
                </div>
              }
            >
              <PocketScenePanel part={active.part} row={active.row} />
            </Suspense>
            <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkStrong, marginTop: 10, lineHeight: 1.7 }}>
              <strong>{active.label}</strong>
              <br />
              {active.row.perPiece} pockets in the {active.row.face} — {active.row.perPiece / 2} at
              each highlighted end. Jig at {fmtLen(active.row.spec.setting, u)},{" "}
              {screwLabel(active.row.spec, u)} screws.
              <br />
              <span style={{ color: color.inkMuted }}>{active.row.showFace}.</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 15, color: color.faint, marginTop: 8 }}>
        Estimates — verify jig and screw choices against your stock before drilling.
      </div>
    </div>
  );
}
