/**
 * Dev-only Vite plugin: live-stream a project file into the running app.
 *
 * The MCP server autosaves the project an agent is editing to a "live" file
 * (see mcp/session.ts). This plugin watches that file and pushes its contents
 * to the browser over Vite's existing WebSocket, so the app updates in real
 * time — no page reload, no manual Import. It's `apply: "serve"`, so it exists
 * only in the dev server and never touches the production build (keeping the
 * app's no-backend promise intact).
 *
 * Protocol (custom Vite HMR events):
 *   server → client : "cabinets:live"          payload = the file text
 *   client → server : "cabinets:live:request"  (ask for the current contents)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

export const LIVE_EVENT = "cabinets:live";
export const LIVE_REQUEST = "cabinets:live:request";

/** The file the plugin watches (CABINETS_LIVE_FILE env, else ./live.cabinets.json). */
export function liveFilePath(): string {
  return resolve(process.cwd(), process.env.CABINETS_LIVE_FILE || "live.cabinets.json");
}

export function cabinetsLive(): Plugin {
  const file = liveFilePath();
  let server: ViteDevServer | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const push = (): void => {
    if (!server) return;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return; // file not created yet — nothing to push
    }
    server.ws.send({ type: "custom", event: LIVE_EVENT, data: text });
  };

  // Coalesce the burst of writes an agent makes (autosave fires per mutation).
  const pushDebounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, 80);
  };

  return {
    name: "cabinets-live",
    apply: "serve",
    configureServer(s) {
      server = s;
      s.watcher.add(file);
      s.watcher.on("change", (p) => {
        if (resolve(p) === file) pushDebounced();
      });
      s.watcher.on("add", (p) => {
        if (resolve(p) === file) pushDebounced();
      });
      // The app asks for the current state as soon as it connects.
      s.ws.on(LIVE_REQUEST, () => push());
      s.config.logger.info(`\n  \x1b[36m➜  cabinets-live:\x1b[0m watching ${file} → browser`);
    },
  };
}
