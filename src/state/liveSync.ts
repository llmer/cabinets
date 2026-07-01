/**
 * Dev-only live sync: receive project updates streamed from the MCP server.
 *
 * The `cabinets-live` Vite plugin (src/dev/cabinetsLivePlugin.ts) watches the
 * file an agent is editing and pushes it over Vite's HMR socket. Here we listen
 * for that push and fold it into the store, so the whole app — layout, cut list,
 * sheets, 3D — updates live while an agent works, with no reload.
 *
 * This module is dynamically imported only when `import.meta.hot` exists (dev),
 * so it is never part of the production bundle.
 */
import { migrateProject } from "./persistence";
import { useStore } from "./store";

const LIVE_EVENT = "cabinets:live";
const LIVE_REQUEST = "cabinets:live:request";

let started = false;

export function initLiveSync(): void {
  const hot = import.meta.hot;
  // Guard against double-registration across HMR re-runs — otherwise a single
  // push would apply (and inflate undo) once per stale listener.
  if (!hot || started) return;
  started = true;

  hot.on(LIVE_EVENT, (text: string) => {
    try {
      const project = migrateProject(JSON.parse(text));
      useStore.getState().syncProject(project);
    } catch (e) {
      // A partial/mid-write read is possible; ignore and wait for the next push.
      console.warn("[cabinets-live] ignored an unreadable update:", (e as Error).message);
    }
  });

  // Ask for the current state as soon as we connect, so opening the browser
  // shows whatever the agent has already built (the store's syncProject ignores
  // a push that's older than the current project, so a stale file is skipped).
  hot.send(LIVE_REQUEST);
  console.info("[cabinets-live] connected — the browser will follow the agent's edits.");
}
