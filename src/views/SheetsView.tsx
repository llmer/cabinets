import { color, font } from "@/theme";
import { constructionInfo } from "@/engine/labels";
import { fmtLen, toFrac } from "@/engine/units";
import { BoardPack, LinearPack, StockPack, ripPlanText } from "@/engine/packing";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import { sheetsCsv } from "@/state/exporters";
import { downloadText } from "@/state/persistence";
import { Button, MonoLabel, Serif, Swatch, Toggle } from "@/components/ui";

/** One stock's sheet diagrams. Exported for the render smoke test (SSR reads the
 *  zustand hook's initial snapshot, so the full view can't render a flipped
 *  store-breakdown setting — this pure component can). */
export function SheetPack({ pack, units, kerf, rot }: { pack: StockPack; units: "in" | "mm"; kerf: number; rot: boolean }) {
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
              {(sheet.strips || []).map((st, k, strips) =>
                k < strips.length - 1 ? (
                  <div
                    key={`rip${k}`}
                    title={`store rip · strip of ${toFrac(st.height)}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: Math.max(0, (st.y + st.height) * sc - 1),
                      borderTop: `2px dashed ${color.danger}`,
                      pointerEvents: "none",
                    }}
                  />
                ) : null,
              )}
              {(sheet.strips || [])
                .filter((st) => st.offcut)
                .map((st, k) => (
                  <div
                    key={`off${k}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: st.y * sc,
                      height: st.height * sc,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: font.mono,
                      fontSize: 9,
                      letterSpacing: ".1em",
                      color: color.faint,
                      pointerEvents: "none",
                    }}
                  >
                    OFFCUT · {fmtLen(st.height, units)}
                  </div>
                ))}
            </div>
            {sheet.strips ? (
              <div style={{ fontFamily: font.mono, fontSize: 10, color: color.danger, marginTop: 5, maxWidth: Wpx }}>
                ✂ {ripPlanText(sheet.strips, units)}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hardwood (linear) cut plan — each board drawn as a bar with its cuts end to end. */
function LinearBoardPack({ pack, units }: { pack: LinearPack; units: "in" | "mm" }) {
  if (!pack.boards.length) return null; // oversize-only runs surface in the top warning
  const sc = 430 / pack.boardLength; // px per inch — same scale as the sheet diagrams
  const capacity = pack.boards.length * pack.boardLength;
  const packYield = capacity ? Math.round((pack.usedLength / capacity) * 100) : 0;
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted, marginBottom: 12, letterSpacing: ".04em" }}>
        {pack.label} · <strong style={{ color: color.hardwood }}>{fmtLen(pack.width, units)} wide</strong> · {pack.boards.length} board{pack.boards.length === 1 ? "" : "s"} of {fmtLen(pack.boardLength, units)} · {packYield}% yield
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pack.boards.map((b, i) => (
          <div key={i}>
            <div style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: ".06em", color: color.inkMuted, marginBottom: 6 }}>
              Board {i + 1} / {pack.boards.length} · drop {fmtLen(Math.max(0, pack.boardLength - b.used), units)}
            </div>
            <div style={{ position: "relative", width: pack.boardLength * sc, height: 30, background: color.panel, border: `1px solid ${color.inkStrong}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(31,20,14,.06)" }}>
              {b.cuts.map((c, j) => {
                const w = c.length * sc;
                return (
                  <div
                    key={j}
                    title={`${c.label} · ${c.part} · ${toFrac(c.length)}`}
                    style={{
                      position: "absolute",
                      left: c.offset * sc,
                      top: 0,
                      bottom: 0,
                      width: Math.max(1, w - 1),
                      background: c.color + "40",
                      border: `1px solid ${c.color}`,
                      borderRadius: 1,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {w > 34 ? (
                      <span style={{ fontFamily: font.mono, fontSize: 9, color: color.inkStrong }}>{fmtLen(c.length, units)}</span>
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

/**
 * Rip-aware hardwood plan — the boards actually on hand, each drawn to scale
 * with its crosscut segments (dashed lines) and the rip strips inside them.
 * Exported for the render smoke test (the SSR snapshot can't carry a stock
 * with boards, so the test renders this pure component directly).
 */
export function BoardPlanPack({ pack, units, kerf }: { pack: BoardPack; units: "in" | "mm"; kerf: number }) {
  const maxLen = Math.max(...pack.boards.map((b) => b.length), 1);
  const sc = 430 / maxLen; // px per inch along the board
  // Area-based yield: parts on parallel rip strips sum past a board's LENGTH,
  // so length-based yield could read over 100%.
  const usedArea = pack.boards.reduce(
    (a, b) =>
      a +
      b.segments.reduce(
        (c, seg) =>
          c +
          seg.strips.reduce(
            (d, st) => d + st.cuts.reduce((e, x) => e + x.length, 0) * seg.ripWidth,
            0,
          ),
        0,
      ),
    0,
  );
  const capacity = pack.boards.reduce((a, b) => a + b.length * b.width, 0);
  const packYield = capacity ? Math.round((usedArea / capacity) * 100) : 0;
  const onHand = pack.specs
    .map((sp) => `${sp.qty}× ${fmtLen(sp.width, units)} × ${fmtLen(sp.length, units)}`)
    .join(" · ");
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted, marginBottom: 12, letterSpacing: ".04em" }}>
        {pack.label} · <strong style={{ color: color.hardwood }}>boards on hand: {onHand}</strong> · uses{" "}
        {pack.boards.length} board{pack.boards.length === 1 ? "" : "s"} · {packYield}% yield
      </div>
      {(pack.shortfall.length > 0 || pack.oversize.length > 0) && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: color.danger, border: `1px solid ${color.danger}`, background: color.panel, borderRadius: 6, padding: "10px 14px", marginBottom: 14 }}>
          {pack.oversize.map((it, i) => (
            <div key={`ov${i}`}>
              ⚠ {it.part} ({fmtLen(it.length, units)} × {fmtLen(it.width, units)}) is bigger than every board on hand.
            </div>
          ))}
          {pack.shortfall.map((it, i) => (
            <div key={`sh${i}`}>
              ⚠ {it.part} ({fmtLen(it.length, units)} × {fmtLen(it.width, units)}) doesn&apos;t fit — the boards ran out.
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pack.boards.map((b, i) => {
          const Hpx = Math.max(22, b.width * 12); // board width, to scale-ish
          return (
            <div key={i}>
              <div style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: ".06em", color: color.inkMuted, marginBottom: 6 }}>
                Board {i + 1} / {pack.boards.length} · {fmtLen(b.width, units)} × {fmtLen(b.length, units)} · drop{" "}
                {fmtLen(Math.max(0, b.length - b.used), units)}
              </div>
              <div style={{ position: "relative", width: b.length * sc, height: Hpx, background: color.panel, border: `1px solid ${color.inkStrong}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(31,20,14,.06)" }}>
                {b.segments.map((seg, si) => (
                  <div key={si}>
                    {seg.strips.map((st, ri) => {
                      const top = (ri * (seg.ripWidth + kerf) * Hpx) / b.width;
                      const h = (seg.ripWidth * Hpx) / b.width;
                      return st.cuts.map((c, ci) => (
                        <div
                          key={`${si}-${ri}-${ci}`}
                          title={`${c.label} · ${c.part} · ${toFrac(c.length)} × ${toFrac(seg.ripWidth)}`}
                          style={{
                            position: "absolute",
                            left: (seg.offset + c.offset) * sc,
                            top,
                            width: Math.max(1, c.length * sc - 1),
                            height: Math.max(1, h - 1),
                            background: c.color + "40",
                            border: `1px solid ${c.color}`,
                            borderRadius: 1,
                            overflow: "hidden",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {c.length * sc > 34 ? (
                            <span style={{ fontFamily: font.mono, fontSize: 9, color: color.inkStrong }}>{fmtLen(c.length, units)}</span>
                          ) : null}
                        </div>
                      ));
                    })}
                    <div
                      title={`crosscut · segment of ${toFrac(seg.length)} ripped at ${toFrac(seg.ripWidth)}`}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: Math.max(0, (seg.offset + seg.length) * sc - 1),
                        borderLeft: `2px dashed ${color.danger}`,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: font.mono, fontSize: 10, color: color.inkMuted, marginTop: 5 }}>
                ✂{" "}
                {b.segments
                  .map(
                    (seg) =>
                      `${fmtLen(seg.length, units)} @ rip ${seg.strips.length}× ${fmtLen(seg.ripWidth, units)}`,
                  )
                  .join(" → ")}
              </div>
            </div>
          );
        })}
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
  const { summary, packs, linearPacks, boardPacks, legend } = model;
  const ci = constructionInfo(cabinets);
  const u = settings.units;

  const kerfDelta = (d: number) =>
    updateSettings({ kerf: Math.max(0, +(settings.kerf + d).toFixed(3)) });
  // Same 0–4" range the Settings field and the MCP schema enforce.
  const trimDelta = (d: number) =>
    updateSettings({ storeTrim: Math.min(4, Math.max(0, +(settings.storeTrim + d).toFixed(3))) });

  return (
    <div style={{ padding: "30px 36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <MonoLabel>
            Sheet optimizer · {ci.label} · {fmtLen(settings.stocks.ply34.sheetH, u)} × {fmtLen(settings.stocks.ply34.sheetW, u)} sheets
          </MonoLabel>
          <Serif style={{ fontSize: 36, marginTop: 2 }}>
            {summary.sheetCount} sheets, {summary.yieldStr} yield.
            {summary.storeCuts > 0 ? ` ${summary.storeCuts} store rips.` : ""}
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
          <Toggle active={settings.storeBreakdown} style={{ fontFamily: font.mono, fontSize: 12, padding: "7px 13px" }} onClick={() => updateSettings({ storeBreakdown: !settings.storeBreakdown })}>
            {settings.storeBreakdown ? "Store rips: ON" : "Store rips: OFF"}
          </Toggle>
          {settings.storeBreakdown && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: font.mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: color.faint }}>Edge trim</span>
              <div style={{ display: "flex", border: `1px solid ${color.border}`, borderRadius: 5, overflow: "hidden" }}>
                <button onClick={() => trimDelta(-0.125)} style={{ border: "none", background: color.panel, padding: "6px 11px", cursor: "pointer", color: color.inkStrong }}>−</button>
                <span style={{ fontFamily: font.mono, fontSize: 13, minWidth: 56, textAlign: "center", alignSelf: "center" }}>{fmtLen(settings.storeTrim, u)}</span>
                <button onClick={() => trimDelta(0.125)} style={{ border: "none", background: color.panel, padding: "6px 11px", cursor: "pointer", color: color.inkStrong }}>+</button>
              </div>
            </div>
          )}
          <Button variant="mono" onClick={() => downloadText(`${slug(projectName)}-sheets.csv`, sheetsCsv(model))}>
            Export CSV
          </Button>
        </div>
      </div>

      {settings.storeBreakdown && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted, border: `1px solid ${color.border}`, background: color.panel, borderRadius: 6, padding: "10px 14px", marginBottom: 18 }}>
          ✂ Store breakdown: have the store&apos;s panel saw rip each sheet into the full-length strips
          shown (dashed lines) — in order, each width measured from the freshly cut edge. Store cuts
          are rough: every part keeps {fmtLen(settings.storeTrim, u)} clear of them, so you re-cut each
          strip edge clean with your track saw at home. Factory sheet edges are used as-is.
        </div>
      )}

      {summary.oversize > 0 && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: color.danger, border: `1px solid ${color.danger}`, background: color.panel, borderRadius: 6, padding: "10px 14px", marginBottom: 18 }}>
          ⚠ {summary.oversize} part(s) won&apos;t fit the stock — split them, or use a larger sheet/board.
        </div>
      )}

      {summary.boardShort > 0 && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: color.danger, border: `1px solid ${color.danger}`, background: color.panel, borderRadius: 6, padding: "10px 14px", marginBottom: 18 }}>
          ⚠ {summary.boardShort} hardwood part(s) don&apos;t fit the boards on hand — buy another board
          (details in the board plan below).
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

      {boardPacks.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: `1px solid ${color.divider}`, paddingTop: 20 }}>
            <MonoLabel>Hardwood cut plan · ripped from the boards on hand</MonoLabel>
          </div>
          <div style={{ fontFamily: font.mono, fontSize: 13, color: color.inkMuted, marginBottom: 20 }}>
            Crosscut each dashed segment off the board, rip it into the strips shown, then cut the
            parts to length from the strips.
          </div>
          {boardPacks.map((pack) => (
            <BoardPlanPack key={pack.stockId} pack={pack} units={u} kerf={settings.kerf} />
          ))}
        </>
      )}

      {linearPacks.some((p) => p.boards.length) && (
        <>
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: `1px solid ${color.divider}`, paddingTop: 20 }}>
            <MonoLabel>Hardwood cut plan · by the board, not nested in sheets</MonoLabel>
          </div>
          <div style={{ fontFamily: font.mono, fontSize: 13, color: color.inkMuted, marginBottom: 20 }}>
            <strong style={{ color: color.inkStrong }}>Buy:</strong>{" "}
            {linearPacks
              .filter((p) => p.boards.length)
              .map((p) => `${p.boards.length}× ${fmtLen(p.thickness, u)} × ${fmtLen(p.width, u)}`)
              .join(" · ")}
            {" — all "}
            {fmtLen(linearPacks.find((p) => p.boards.length)!.boardLength, u)} boards
          </div>
          {linearPacks.map((pack) => <LinearBoardPack key={`${pack.stockId}-${pack.width}`} pack={pack} units={u} />)}
        </>
      )}
    </div>
  );
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "kitchen";
}
