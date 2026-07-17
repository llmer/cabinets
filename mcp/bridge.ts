/**
 * Agent bridge: a localhost WebSocket relay between the MCP session and the
 * BROWSER app (including the hosted GitHub Pages deployment).
 *
 * The dev workflow streams agent edits to the browser through a Vite plugin
 * over the HMR socket — which only exists under `npm run dev`. This bridge is
 * the production-equivalent pipe: the MCP server (running on the USER'S
 * machine, spawned by their own Claude Code / Codex session) listens on
 * 127.0.0.1, and the page — local or https://llmer.github.io/cabinets/ —
 * connects out to it. Browsers exempt loopback from mixed-content blocking, so
 * an https page may open ws://127.0.0.1.
 *
 * Sync model: whole-project JSON both ways, last-write-wins on `updatedAt`
 * (both the store and the session stamp it on every mutation).
 *  - server → page: initial snapshot on connect + every session change
 *  - page → server: adopted only when strictly NEWER, validated through the
 *    same migrate + compute gate as `open_project`, and never echoed back to
 *    the sender (everyone ELSE gets the broadcast)
 *
 * Security: binds 127.0.0.1 only, and browser connections must present an
 * allowed Origin — any website can attempt connections to localhost ports, so
 * the allowlist (the hosted app + local dev/preview origins) is what keeps a
 * random tab from reading or rewriting the project. Connections WITHOUT an
 * Origin header are allowed: those are local processes (tests, tooling), which
 * could reach this port regardless.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { migrateProject } from "@/state/persistence";
import { compute } from "@/engine/compute";
import { Project } from "@/domain/types";
import { CabinetSession } from "./session.js";

/** Keep in sync with BRIDGE_PORT in src/state/bridgeSync.ts. */
export const DEFAULT_BRIDGE_PORT = 5178;

/** The hosted app, plus local dev (5173) / preview (4173) on any port. */
const ALLOWED_HOSTED_ORIGINS = ["https://llmer.github.io"];

/**
 * Origin gate for browser connections. `undefined` (no Origin header) is a
 * non-browser local client and passes; the string "null" (sandboxed/file://
 * pages) does not. Extra origins can be granted via CABINETS_BRIDGE_ORIGINS.
 */
export function isAllowedOrigin(origin: string | undefined, extra: string[] = []): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  return [...ALLOWED_HOSTED_ORIGINS, ...extra].includes(url.origin);
}

/** Last-write-wins: adopt an incoming project only when strictly newer. */
export function shouldAdopt(incoming: Project, current: Project): boolean {
  return incoming.updatedAt > current.updatedAt;
}

export interface Bridge {
  port: number;
  close: () => void;
}

export interface BridgeOptions {
  /** Port to listen on (0 picks a free one — used by tests). */
  port?: number;
  /** Extra allowed browser origins (CABINETS_BRIDGE_ORIGINS, comma-separated). */
  extraOrigins?: string[];
}

/**
 * Start the bridge for a session. Resolves with the bound port, or null when
 * the port is taken (a second agent session is already serving — the app can
 * only follow one, so we log and carry on rather than failing the MCP server).
 */
export function startBridge(session: CabinetSession, opts: BridgeOptions = {}): Promise<Bridge | null> {
  const wanted = opts.port ?? DEFAULT_BRIDGE_PORT;
  const extra = opts.extraOrigins ?? [];

  const http = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("frame(less) agent bridge — connect via WebSocket\n");
  });
  const wss = new WebSocketServer({ noServer: true });

  // While the session adopts a page's push, suppress the resulting broadcast
  // to that same socket — everyone else still hears it. persist()/changed()
  // run synchronously, so this flag cannot leak across events.
  let suppress: WebSocket | null = null;

  const unsubscribe = session.subscribe((p) => {
    const msg = JSON.stringify({ type: "project", project: p });
    for (const c of wss.clients) {
      if (c !== suppress && c.readyState === WebSocket.OPEN) c.send(msg);
    }
  });

  http.on("upgrade", (req, socket, head) => {
    if (!isAllowedOrigin(req.headers.origin, extra)) {
      console.error(`[bridge] refused a connection from origin ${req.headers.origin}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "project", project: session.project }));
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type !== "project" || !msg.project) return;
        // Same gate as open_project: migrate, then validate the derived model
        // BEFORE committing, so a bad payload can't poison the session.
        const project = migrateProject(msg.project);
        compute(project.cabinets, project.settings);
        // migrateProject restamps updatedAt to "now" (right for file imports);
        // last-write-wins needs the SENDER's stamp, so restore it when sane.
        const sent = Number((msg.project as { updatedAt?: unknown }).updatedAt);
        if (Number.isFinite(sent)) project.updatedAt = sent;
        if (!shouldAdopt(project, session.project)) return;
        suppress = ws;
        try {
          session.adopt(project);
        } finally {
          suppress = null;
        }
      } catch (e) {
        console.error("[bridge] rejected an update from the page:", (e as Error).message);
      }
    });
    ws.on("error", (e) => console.error("[bridge] socket error:", e.message));
  });

  return new Promise((resolvePromise) => {
    http.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        console.error(
          `[bridge] port ${wanted} is already in use (another agent session?) — ` +
            "continuing WITHOUT the browser bridge.",
        );
      } else {
        console.error("[bridge] failed to start:", e.message);
      }
      unsubscribe();
      resolvePromise(null);
    });
    // Loopback only — never reachable from the network.
    http.listen(wanted, "127.0.0.1", () => {
      const port = (http.address() as AddressInfo).port;
      resolvePromise({
        port,
        close: () => {
          unsubscribe();
          for (const c of wss.clients) c.terminate();
          wss.close();
          http.close();
        },
      });
    });
  });
}
