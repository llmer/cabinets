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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
