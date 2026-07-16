import { Suspense, lazy, useEffect } from "react";
import { color, font } from "@/theme";
import { useStore } from "@/state/store";
import { Header } from "@/components/Header";
import { Tabs } from "@/components/Tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LayoutView } from "@/views/LayoutView";
import { CutListView } from "@/views/CutListView";
import { SheetsView } from "@/views/SheetsView";
import { PocketsView } from "@/views/PocketsView";
import { BuildView } from "@/views/BuildView";
import { SettingsView } from "@/views/SettingsView";

// Three.js is heavy — only load it when the 3D tab is opened.
const ThreeView = lazy(() =>
  import("@/views/ThreeView").then((m) => ({ default: m.ThreeView })),
);

function Toast() {
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div
      className="no-print"
      style={{
        position: "fixed",
        bottom: 22,
        left: "50%",
        transform: "translateX(-50%)",
        background: color.inkStrong,
        color: color.onDark,
        fontFamily: font.mono,
        fontSize: 13,
        padding: "10px 18px",
        borderRadius: 7,
        boxShadow: "0 8px 24px rgba(31,20,14,.28)",
        zIndex: 100,
      }}
      onClick={() => setToast(null)}
    >
      {toast}
    </div>
  );
}

export function App() {
  const view = useStore((s) => s.view);

  // Keep the URL hash in sync with the active tab (deep-linkable). The initial
  // view is read from the hash at store creation, so first paint is correct.
  useEffect(() => {
    if (window.location.hash.replace("#", "") !== view) {
      window.history.replaceState(null, "", `#${view}`);
    }
  }, [view]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: color.page,
        color: color.ink,
        fontFamily: font.sans,
        fontSize: 16,
      }}
    >
      <Header />
      <Tabs />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <ErrorBoundary
          resetKey={view}
          label={view === "3d" ? "3D preview unavailable — your browser may not support WebGL." : undefined}
        >
          {view === "layout" && <LayoutView />}
          {view === "cutlist" && <CutListView />}
          {view === "sheets" && <SheetsView />}
          {view === "pockets" && <PocketsView />}
          {view === "build" && <BuildView />}
          {view === "3d" && (
            <Suspense
              fallback={
                <div style={{ padding: 40, fontFamily: font.serif, fontStyle: "italic", fontSize: 20, color: color.faint }}>
                  Loading 3D…
                </div>
              }
            >
              <ThreeView />
            </Suspense>
          )}
          {view === "settings" && <SettingsView />}
        </ErrorBoundary>
      </div>
      <Toast />
    </div>
  );
}
