import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Dev only: follow an agent's live MCP edits. Dynamically imported behind the
// import.meta.hot guard so it is tree-shaken out of the production bundle.
if (import.meta.hot) {
  import("./state/liveSync")
    .then((m) => m.initLiveSync())
    .catch((e) => console.warn("[cabinets-live] failed to start:", e));
}

// All builds: resume the agent bridge (Header → Agent) if the user enabled it —
// the production counterpart of the dev live sync above (see state/bridgeSync).
import("./state/bridgeSync")
  .then((m) => m.initBridgeSync())
  .catch((e) => console.warn("[agent-bridge] failed to start:", e));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
