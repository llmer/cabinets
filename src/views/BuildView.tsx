import { CSSProperties, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { color, font } from "@/theme";
import { Cabinet, Settings, Units } from "@/domain/types";
import { constructionInfo } from "@/engine/labels";
import { drawerBoxSpecs } from "@/engine/parts";
import { fmtLen } from "@/engine/units";
import { BuildStage, Step, StepGroup } from "@/engine/steps";
import { useModel } from "@/state/useModel";
import { stepKey, useStore } from "@/state/store";
import { Button, MonoLabel, Serif, Swatch, Toggle } from "@/components/ui";

// Three.js is heavy — load the per-step 3D render lazily (its own chunk) so it
// stays out of the initial bundle, exactly like the standalone 3D tab.
const BuildStepScene = lazy(() =>
  import("@/views/BuildStepScene").then((m) => ({ default: m.BuildStepScene })),
);

/** Short, human label for each assembly stage (shown in the 3D legend). */
const STAGE_LABEL: Record<BuildStage, string> = {
  sides: "Side panels",
  carcass: "Carcass",
  back: "Back",
  desktop: "Desktop",
  base: "Toe kick / set",
  faceFrame: "Face frame",
  drawers: "Drawer boxes",
  shelves: "Shelves",
  doors: "Doors",
  drawerFronts: "Drawer fronts",
  pulls: "Pulls & knobs",
};

type DrawerSpec = ReturnType<typeof drawerBoxSpecs>[number];

/** One assembly step flattened into a single linear walkthrough sequence. */
interface FlatStep {
  gi: number;
  groupId: string;
  groupName: string;
  typeLabel: string;
  dims: string;
  color: string;
  step: Step;
  key: string;
  idxInGroup: number;
  groupCount: number;
  specs: DrawerSpec[];
  framed: boolean;
  /** The source cabinet, for the per-step 3D render (absent if it went away). */
  cabinet?: Cabinet;
}

export function BuildView() {
  const { summary, stepGroups, cabinetParts } = useModel();
  const settings = useStore((s) => s.project.settings);
  const cabinets = useStore((s) => s.project.cabinets);

  const buildMode = useStore((s) => s.buildMode);
  const buildDone = useStore((s) => s.buildDone);
  const buildCursor = useStore((s) => s.buildCursor);
  const setBuildMode = useStore((s) => s.setBuildMode);
  const setBuildCursor = useStore((s) => s.setBuildCursor);
  const setStepDone = useStore((s) => s.setStepDone);
  const toggleStepDone = useStore((s) => s.toggleStepDone);
  const resetBuildProgress = useStore((s) => s.resetBuildProgress);

  const ci = constructionInfo(cabinets);
  const u = settings.units;

  // Flatten every cabinet's steps into one ordered sequence, carrying the
  // group context + per-cabinet drawer specs so each step is self-contained.
  const flat = useMemo<FlatStep[]>(() => {
    const out: FlatStep[] = [];
    stepGroups.forEach((sg, gi) => {
      const cp = cabinetParts.find((c) => c.cabinet.id === sg.id);
      const specs = cp ? drawerBoxSpecs(cp.cabinet, settings) : [];
      const framed = cp?.geometry.framed ?? false;
      const cabinet = cp?.cabinet;
      sg.steps.forEach((step, idxInGroup) => {
        out.push({
          gi,
          groupId: sg.id,
          groupName: sg.name,
          typeLabel: sg.typeLabel,
          dims: sg.dims,
          color: sg.color,
          step,
          key: stepKey(sg.id, step.n),
          idxInGroup,
          groupCount: sg.steps.length,
          specs,
          framed,
          cabinet,
        });
      });
    });
    return out;
  }, [stepGroups, cabinetParts, settings]);

  const total = flat.length;
  const doneCount = flat.reduce((a, f) => a + (buildDone[f.key] ? 1 : 0), 0);
  const allDone = total > 0 && doneCount === total;

  const firstIncomplete = () => {
    const i = flat.findIndex((f) => !buildDone[f.key]);
    return i >= 0 ? i : 0;
  };

  // Keep the cursor inside the sequence as the design changes underneath it.
  const cursor = total === 0 ? 0 : Math.min(buildCursor, total - 1);

  const startWalkthrough = () => {
    setBuildCursor(firstIncomplete());
    setBuildMode("guided");
  };

  const jumpToGroup = (gi: number) => {
    const inGroup = flat
      .map((f, i) => ({ f, i }))
      .filter((x) => x.f.gi === gi);
    if (inGroup.length === 0) return;
    const target = inGroup.find((x) => !buildDone[x.f.key]) ?? inGroup[0];
    setBuildCursor(target.i);
    setBuildMode("guided");
  };

  return (
    <div style={{ padding: "30px 36px", maxWidth: 880 }}>
      <div
        className="no-print"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}
      >
        <div>
          <MonoLabel>Assembly · {ci.label}</MonoLabel>
          <Serif style={{ fontSize: 36, margin: "2px 0 4px" }}>Build it, one box at a time.</Serif>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex" }}>
            <Toggle
              active={buildMode === "overview"}
              onClick={() => setBuildMode("overview")}
              style={{ borderRadius: "5px 0 0 5px" }}
            >
              Overview
            </Toggle>
            <Toggle
              active={buildMode === "guided"}
              onClick={() => setBuildMode("guided")}
              style={{ borderRadius: "0 5px 5px 0", borderLeft: "none" }}
            >
              Guided
            </Toggle>
          </div>
          {buildMode === "overview" && (
            <Button variant="mono" onClick={() => window.print()}>
              Print
            </Button>
          )}
        </div>
      </div>

      {/* Overall progress + walkthrough entry */}
      {total > 0 && (
        <div
          className="no-print"
          style={{ display: "flex", alignItems: "center", gap: 14, margin: "6px 0 18px", flexWrap: "wrap" }}
        >
          <div style={{ flex: "1 1 260px", minWidth: 200 }}>
            <ProgressBar value={doneCount} total={total} />
          </div>
          <div style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted, whiteSpace: "nowrap" }}>
            {doneCount} / {total} steps
          </div>
          {buildMode === "overview" && (
            <Button variant="primary" onClick={startWalkthrough}>
              {doneCount === 0 ? "Start walkthrough" : allDone ? "Review walkthrough" : "Resume walkthrough"}
            </Button>
          )}
          {doneCount > 0 && (
            <Button variant="mono" onClick={resetBuildProgress}>
              Reset progress
            </Button>
          )}
        </div>
      )}

      <div style={{ fontSize: 14, color: color.inkMuted, marginBottom: 4, maxWidth: 640 }}>
        Shopping list: {summary.sheetCount} sheets of 3/4&quot; ply · {summary.bandLF} ft edge-banding · {summary.hinges} hinges ·{" "}
        {summary.slides} drawer-slide pairs · {summary.shelfPins} shelf pins · a box of confirmat (or 1 1/4&quot;) screws &amp; glue.
      </div>
      {summary.framed && (
        <div style={{ fontSize: 14, color: color.hardwood, marginBottom: 8, maxWidth: 640 }}>
          Plus ~{summary.frameLF} ft of 1 1/2&quot; × 3/4&quot; hardwood for the face frames.
        </div>
      )}

      {total === 0 ? (
        <Serif style={{ fontSize: 20, color: color.faint, marginTop: 28 }}>
          Add a cabinet on the Layout tab and the build steps appear here.
        </Serif>
      ) : buildMode === "guided" ? (
        <GuidedWalkthrough
          flat={flat}
          cursor={cursor}
          total={total}
          allDone={allDone}
          buildDone={buildDone}
          settings={settings}
          u={u}
          setBuildCursor={setBuildCursor}
          setStepDone={setStepDone}
          toggleStepDone={toggleStepDone}
          resetBuildProgress={resetBuildProgress}
          jumpToGroup={jumpToGroup}
        />
      ) : (
        <Overview
          flat={flat}
          stepGroups={stepGroups}
          buildDone={buildDone}
          allDone={allDone}
          settings={settings}
          u={u}
          toggleStepDone={toggleStepDone}
          jumpToGroup={jumpToGroup}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview — the full scannable / printable step list                 */
/* ------------------------------------------------------------------ */

function Overview({
  flat,
  stepGroups,
  buildDone,
  allDone,
  settings,
  u,
  toggleStepDone,
  jumpToGroup,
}: {
  flat: FlatStep[];
  stepGroups: StepGroup[];
  buildDone: Record<string, boolean>;
  allDone: boolean;
  settings: Settings;
  u: Units;
  toggleStepDone: (key: string) => void;
  jumpToGroup: (gi: number) => void;
}) {
  return (
    <>
      {allDone && <DoneBanner />}
      {stepGroups.map((sg, gi) => {
        const groupSteps = flat.filter((f) => f.gi === gi);
        const groupDone = groupSteps.reduce((a, f) => a + (buildDone[f.key] ? 1 : 0), 0);
        const specs = groupSteps[0]?.specs ?? [];
        const framed = groupSteps[0]?.framed ?? false;
        return (
          <div
            key={sg.id}
            style={{ margin: "22px 0", border: `1px solid ${color.border}`, borderRadius: 8, background: color.panel, overflow: "hidden" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", background: color.panelAlt, borderBottom: `1px solid ${color.border}` }}>
              <Swatch c={sg.color} />
              <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.06em" }}>{sg.name}</span>
              <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint }}>{sg.typeLabel} · {sg.dims}</span>
              <span
                className="no-print"
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}
              >
                <span style={{ fontFamily: font.mono, fontSize: 11, color: groupDone === sg.steps.length ? color.green : color.faint }}>
                  {groupDone}/{sg.steps.length} done
                </span>
                <Button variant="mono" onClick={() => jumpToGroup(gi)}>
                  {groupDone === sg.steps.length ? "Review" : groupDone > 0 ? "Resume" : "Walk through"}
                </Button>
              </span>
            </div>
            <div style={{ padding: "8px 18px 16px" }}>
              {sg.steps.map((st) => {
                const key = stepKey(sg.id, st.n);
                const done = !!buildDone[key];
                return (
                  <div key={st.n} style={{ display: "flex", gap: 14, padding: "11px 0", borderBottom: `1px solid ${color.rule}` }}>
                    <StepCircle n={st.n} done={done} onClick={() => toggleStepDone(key)} />
                    <div
                      style={{
                        fontSize: 14,
                        lineHeight: 1.55,
                        paddingTop: 2,
                        color: done ? color.faint : color.ink,
                        textDecoration: done ? "line-through" : "none",
                        textDecorationColor: color.fainter,
                      }}
                    >
                      {st.t}
                    </div>
                  </div>
                );
              })}

              {specs.length > 0 && <DrawerTable specs={specs} settings={settings} framed={framed} u={u} />}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Guided — one focused step at a time                                 */
/* ------------------------------------------------------------------ */

function GuidedWalkthrough({
  flat,
  cursor,
  total,
  allDone,
  buildDone,
  settings,
  u,
  setBuildCursor,
  setStepDone,
  toggleStepDone,
  resetBuildProgress,
  jumpToGroup,
}: {
  flat: FlatStep[];
  cursor: number;
  total: number;
  allDone: boolean;
  buildDone: Record<string, boolean>;
  settings: Settings;
  u: Units;
  setBuildCursor: (i: number) => void;
  setStepDone: (key: string, done: boolean) => void;
  toggleStepDone: (key: string) => void;
  resetBuildProgress: () => void;
  jumpToGroup: (gi: number) => void;
}) {
  const cur = flat[cursor];
  const done = !!buildDone[cur.key];

  // 3D render preference + a mount gate so server-side rendering (the smoke
  // test) never instantiates Three.js / a WebGL canvas.
  const [show3d, setShow3d] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const goPrev = () => setBuildCursor(Math.max(0, cursor - 1));
  const goNext = () => setBuildCursor(Math.min(total - 1, cursor + 1));
  const completeAndNext = () => {
    setStepDone(cur.key, true);
    if (cursor < total - 1) {
      setBuildCursor(cursor + 1);
    } else {
      // last step done — sweep back to the first step still left undone, if any
      const next = flat.findIndex((f, i) => i !== cursor && !buildDone[f.key]);
      if (next >= 0) setBuildCursor(next);
    }
  };

  // Keyboard navigation: ← back, → skip forward, Enter/Space mark done & next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        completeAndNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const groupStepNo = cur.idxInGroup + 1;

  return (
    <div className="no-print" style={{ marginTop: 4 }}>
      {allDone && <DoneBanner onReset={resetBuildProgress} />}

      {/* Cabinet rail — progress per box, click to jump */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {dedupeGroups(flat).map((g) => {
          const inGroup = flat.filter((f) => f.gi === g.gi);
          const gDone = inGroup.reduce((a, f) => a + (buildDone[f.key] ? 1 : 0), 0);
          const complete = gDone === inGroup.length;
          const active = g.gi === cur.gi;
          return (
            <button
              key={g.groupId}
              onClick={() => jumpToGroup(g.gi)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                border: `1px solid ${active ? color.inkStrong : color.border}`,
                background: active ? color.panelAlt : color.panel,
                borderRadius: 999,
                padding: "5px 11px",
                cursor: "pointer",
                fontFamily: font.mono,
                fontSize: 11,
                color: color.inkStrong,
              }}
            >
              <Swatch c={g.color} size={10} />
              <span style={{ fontWeight: active ? 700 : 500 }}>{g.groupName}</span>
              <span style={{ color: complete ? color.green : color.faint }}>
                {complete ? "✓" : `${gDone}/${inGroup.length}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* The focused step card. Fixed height + a flex-filling 3D keep the control
          bar pinned at the bottom, so it never moves as the step text / table
          change between steps. */}
      <div
        style={{
          border: `1px solid ${color.border}`,
          borderLeft: `5px solid ${cur.color}`,
          borderRadius: 10,
          background: color.panel,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...(show3d && mounted ? { height: "clamp(500px, 66vh, 640px)" } : {}),
        }}
      >
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "13px 22px", background: color.panelAlt, borderBottom: `1px solid ${color.border}`, flexWrap: "wrap" }}>
          <Swatch c={cur.color} />
          <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.06em" }}>{cur.groupName}</span>
          <span style={{ fontFamily: font.mono, fontSize: 12, color: color.faint }}>{cur.typeLabel} · {cur.dims}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setShow3d((v) => !v)}
              style={{
                border: `1px solid ${color.border}`,
                borderRadius: 5,
                background: show3d ? color.inkStrong : color.panel,
                color: show3d ? color.onDark : color.inkStrong,
                padding: "5px 10px",
                fontFamily: font.mono,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {show3d ? "Hide 3D" : "Show 3D"}
            </button>
            <span style={{ fontFamily: font.mono, fontSize: 11, color: color.faint }}>
              Step {groupStepNo} of {cur.groupCount} · {cursor + 1}/{total} overall
            </span>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", padding: "22px 24px 4px" }}>
          <div style={{ flexShrink: 0, display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div
              style={{
                flex: "none",
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: `1.5px solid ${done ? color.green : color.inkStrong}`,
                background: done ? color.green : color.page,
                color: done ? color.onDark : color.inkStrong,
                fontFamily: font.mono,
                fontSize: 17,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {done ? "✓" : cur.step.n}
            </div>
            <div style={{ fontSize: 20, lineHeight: 1.5, color: color.ink, paddingTop: 4 }}>{cur.step.t}</div>
          </div>

          {show3d && mounted && cur.cabinet && (
            <Suspense
              fallback={
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    marginTop: 16,
                    border: `1px solid ${color.border}`,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: font.serif,
                    fontStyle: "italic",
                    color: color.faint,
                  }}
                >
                  Loading 3D…
                </div>
              }
            >
              <BuildStepScene
                cabinet={cur.cabinet}
                settings={settings}
                stage={cur.step.stage}
                revealedStages={flat
                  .filter((f) => f.gi === cur.gi && f.idxInGroup <= cur.idxInGroup)
                  .map((f) => f.step.stage)}
                accent={cur.color}
                stageLabel={STAGE_LABEL[cur.step.stage]}
              />
            </Suspense>
          )}
        </div>

        {/* Controls — pinned at the bottom of the fixed-height card */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${color.rule}`, display: "flex", gap: 10, alignItems: "center", padding: "14px 24px", flexWrap: "wrap" }}>
          <Button variant="mono" onClick={goPrev} disabled={cursor === 0} style={{ opacity: cursor === 0 ? 0.45 : 1 }}>
            ← Back
          </Button>
          <Button variant="ghost" onClick={goNext} disabled={cursor === total - 1} style={{ opacity: cursor === total - 1 ? 0.45 : 1 }}>
            Skip →
          </Button>
          <span style={{ flex: 1 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: font.mono, fontSize: 12, color: color.inkMuted, cursor: "pointer" }}>
            <input type="checkbox" checked={done} onChange={() => toggleStepDone(cur.key)} />
            Done
          </label>
          <Button variant="primary" onClick={completeAndNext}>
            {done ? "Next step →" : cursor === total - 1 ? "✓ Mark done" : "✓ Mark done & next"}
          </Button>
        </div>
      </div>

      {/* Drawer-size reference lives below the card, so it never shifts the
          controls when it appears on the "cut the box parts" step. */}
      {cur.step.kind === "drawerBoxes" && cur.specs.length > 0 && (
        <DrawerTable specs={cur.specs} settings={settings} framed={cur.framed} u={u} />
      )}

      <div style={{ fontFamily: font.mono, fontSize: 11, color: color.fainter, marginTop: 12, textAlign: "center" }}>
        ← / → to move · Enter or Space to mark done &amp; advance
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
/* ------------------------------------------------------------------ */

function DoneBanner({ onReset }: { onReset?: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        border: `1px solid ${color.green}`,
        background: "rgba(110,129,87,.12)",
        borderRadius: 10,
        padding: "16px 20px",
        margin: "8px 0 18px",
      }}
    >
      <span style={{ fontSize: 22 }}>✓</span>
      <div style={{ flex: 1 }}>
        <Serif style={{ fontSize: 20, color: color.greenDeep }}>Every step is checked off.</Serif>
        <div style={{ fontSize: 13, color: color.inkMuted }}>
          Nice work — remember this is an estimate, so verify against your own method before final assembly.
        </div>
      </div>
      {onReset && (
        <Button variant="mono" onClick={onReset}>
          Reset progress
        </Button>
      )}
    </div>
  );
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: 8, borderRadius: 999, background: color.rule, overflow: "hidden", border: `1px solid ${color.rule}` }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color.green, transition: "width .25s ease" }} />
    </div>
  );
}

function StepCircle({ n, done, onClick }: { n: number; done: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={done}
      title={done ? "Mark not done" : "Mark done"}
      className="no-print"
      style={{
        flex: "none",
        width: 26,
        height: 26,
        borderRadius: "50%",
        border: `1px solid ${done ? color.green : color.border}`,
        background: done ? color.green : color.page,
        color: done ? color.onDark : color.inkStrong,
        fontFamily: font.mono,
        fontSize: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {done ? "✓" : n}
    </button>
  );
}

function DrawerTable({
  specs,
  settings,
  framed,
  u,
}: {
  specs: DrawerSpec[];
  settings: Settings;
  framed: boolean;
  u: Units;
}) {
  const dcell: CSSProperties = { padding: "7px 12px", fontFamily: font.mono, fontSize: 13 };
  const dhead: CSSProperties = {
    ...dcell,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: color.faint,
    textAlign: "left",
    fontWeight: 500,
  };
  return (
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
        {framed
          ? "Each box is sized to the face-frame opening — bridge the side-mount slides out to the carcass with rear sockets or ~1\" spacers."
          : "Each box is 1\" narrower than its opening to clear the side-mount slides."}
      </div>
    </div>
  );
}

/** First flat step of each group, in order — used to render the cabinet rail. */
function dedupeGroups(flat: FlatStep[]): FlatStep[] {
  const seen = new Set<number>();
  const out: FlatStep[] = [];
  for (const f of flat) {
    if (!seen.has(f.gi)) {
      seen.add(f.gi);
      out.push(f);
    }
  }
  return out;
}
