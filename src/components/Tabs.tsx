import { color, font } from "@/theme";
import { ViewId, useStore } from "@/state/store";

const TABS: { key: ViewId; label: string }[] = [
  { key: "layout", label: "Layout" },
  { key: "cutlist", label: "Cut list" },
  { key: "sheets", label: "Sheets" },
  { key: "build", label: "Build" },
  { key: "3d", label: "3D view" },
  { key: "settings", label: "Settings" },
];

export function Tabs() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <div
      className="no-print"
      style={{
        display: "flex",
        gap: 4,
        padding: "0 28px",
        borderBottom: `1px solid ${color.divider}`,
        background: color.page,
        flexWrap: "wrap",
      }}
    >
      {TABS.map((t) => {
        const active = view === t.key;
        return (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            style={{
              border: "none",
              background: "transparent",
              borderBottom: `2px solid ${active ? color.inkStrong : "transparent"}`,
              color: active ? color.ink : color.faint,
              fontSize: 14,
              fontWeight: active ? 600 : 400,
              padding: "13px 16px",
              cursor: "pointer",
              fontFamily: font.sans,
              letterSpacing: "0.01em",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
