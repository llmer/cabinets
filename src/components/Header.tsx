import { CSSProperties, useRef } from "react";
import { color, font } from "@/theme";
import { useModel } from "@/state/useModel";
import { useStore } from "@/state/store";
import {
  exportProjectFile,
  importProjectFile,
} from "@/state/persistence";
import { AgentBridge } from "./AgentBridge";
import { Button } from "./ui";

function Chip({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${color.border}`,
        borderRadius: 6,
        padding: "7px 13px",
        background: color.page,
        textAlign: "left",
        minWidth: 78,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: color.faint,
          whiteSpace: "nowrap",
          lineHeight: 1.5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 15,
          color: valueColor ?? color.inkStrong,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {value}
        {sub ? <span style={{ color: color.faint, fontSize: 11 }}> · {sub}</span> : null}
      </div>
    </div>
  );
}

const iconBtn: CSSProperties = {
  border: `1px solid ${color.border}`,
  background: color.panel,
  color: color.inkStrong,
  borderRadius: 5,
  padding: "7px 10px",
  fontFamily: font.mono,
  fontSize: 12,
  cursor: "pointer",
};

export function Header() {
  const { summary } = useModel();
  const project = useStore((s) => s.project);
  const units = useStore((s) => s.project.settings.units);
  const renameProject = useStore((s) => s.renameProject);
  const resetProject = useStore((s) => s.resetProject);
  const loadProjectObj = useStore((s) => s.loadProjectObj);
  const updateSettings = useStore((s) => s.updateSettings);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const setToast = useStore((s) => s.setToast);
  const live = useStore((s) => s.live);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="no-print"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "16px 28px",
        borderBottom: `1px solid ${color.border}`,
        background: color.panel,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg
          width="34"
          height="34"
          viewBox="0 0 80 80"
          fill="none"
          stroke={color.inkStrong}
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <rect x="12" y="14" width="56" height="52" rx="2" />
          <line x1="40" y1="14" x2="40" y2="66" />
          <circle cx="34" cy="40" r="1.6" fill={color.inkStrong} stroke="none" />
          <circle cx="46" cy="40" r="1.6" fill={color.inkStrong} stroke="none" />
          <line x1="12" y1="66" x2="68" y2="66" strokeWidth="3.4" />
          <line x1="18" y1="66" x2="18" y2="72" />
          <line x1="62" y1="66" x2="62" y2="72" />
        </svg>
        <div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: color.inkMuted,
              whiteSpace: "nowrap",
            }}
          >
            Cabinet builder · 32mm system
          </div>
          <div
            style={{
              fontFamily: font.serif,
              fontStyle: "italic",
              fontSize: 25,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
            }}
          >
            frame(less)
          </div>
        </div>
        <input
          value={project.name}
          onChange={(e) => renameProject(e.target.value)}
          aria-label="Project name"
          style={{
            border: `1px solid transparent`,
            borderBottom: `1px solid ${color.divider}`,
            background: "transparent",
            fontFamily: font.sans,
            fontSize: 14,
            color: color.inkMuted,
            padding: "4px 6px",
            marginLeft: 8,
            maxWidth: 200,
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {live && (
          <div
            title="The browser is following an agent's live MCP edits — changes you make here may be overwritten by the next update."
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 11px",
              borderRadius: 6,
              border: `1px solid ${color.rust}`,
              background: color.page,
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: "0.08em",
              color: color.rust,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: color.rust, display: "inline-block" }} />
            LIVE · following agent
          </div>
        )}
        <AgentBridge />
        <Chip label="Base run" value={summary.baseRun} />
        <Chip label="Sheets" value={String(summary.sheetCount)} sub={summary.yieldStr} />
        <Chip label="Est. material" value={summary.cost} valueColor={color.rust} />

        <div style={{ display: "flex", gap: 6, marginLeft: 6 }}>
          <button
            style={{ ...iconBtn, opacity: canUndo ? 1 : 0.4 }}
            onClick={undo}
            disabled={!canUndo}
            title="Undo"
          >
            ↶
          </button>
          <button
            style={{ ...iconBtn, opacity: canRedo ? 1 : 0.4 }}
            onClick={redo}
            disabled={!canRedo}
            title="Redo"
          >
            ↷
          </button>
          <div style={{ display: "flex", border: `1px solid ${color.border}`, borderRadius: 5, overflow: "hidden" }}>
            <button
              style={{ ...iconBtn, border: "none", borderRadius: 0, background: units === "in" ? color.inkStrong : color.panel, color: units === "in" ? color.onDark : color.inkStrong }}
              onClick={() => updateSettings({ units: "in" })}
              title="Inches"
            >
              in
            </button>
            <button
              style={{ ...iconBtn, border: "none", borderRadius: 0, background: units === "mm" ? color.inkStrong : color.panel, color: units === "mm" ? color.onDark : color.inkStrong }}
              onClick={() => updateSettings({ units: "mm" })}
              title="Millimetres"
            >
              mm
            </button>
          </div>
          <Button variant="mono" onClick={() => exportProjectFile(project)} title="Download project JSON">
            Export
          </Button>
          <Button variant="mono" onClick={() => fileRef.current?.click()} title="Open a project JSON">
            Import
          </Button>
          <Button
            variant="mono"
            onClick={() => {
              if (confirm("Start a new project? Unsaved changes are kept in undo history.")) resetProject();
            }}
            title="New project (seed kitchen)"
          >
            New
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const p = await importProjectFile(f);
                loadProjectObj(p);
                setToast(`Loaded “${p.name}”.`);
              } catch (err) {
                setToast(err instanceof Error ? err.message : "Import failed.");
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
