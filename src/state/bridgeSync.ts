/**
 * Agent bridge (browser side): follow a LOCAL MCP session from anywhere the
 * app is served — including the hosted GitHub Pages build.
 *
 * The user's own agent session (Claude Code, Claude Desktop, Codex — any MCP
 * client) spawns the frame(less) MCP server on their machine; that server
 * opens a loopback WebSocket (mcp/bridge.ts). This module dials
 * ws://127.0.0.1:<port> from the page and keeps the store and the session in
 * step: incoming projects fold in through `syncProject` (undo is pushed, view
 * and selection are kept), local edits stream back. Last-write-wins on
 * `updatedAt`, mirroring the server's gate.
 *
 * Strictly OPT-IN and persisted: the page never dials localhost until the user
 * enables it (Header → Agent), and the choice is remembered so a reload
 * reconnects. While enabled, a dropped connection retries with backoff — the
 * natural flow is "enable once, then start/stop your agent whenever".
 */
import { migrateProject } from "./persistence";
import { useStore } from "./store";

export type BridgeStatus = "off" | "connecting" | "connected";

/** Keep in sync with DEFAULT_BRIDGE_PORT in mcp/bridge.ts. */
const DEFAULT_PORT = 5178;
const ENABLED_KEY = "framecess.bridge.v1";
const PORT_KEY = "framecess.bridge.port";
const RETRY_MS = 2500;
/** Trailing debounce so a drag (many mutations) sends one project, not fifty. */
const SEND_DEBOUNCE_MS = 200;

let ws: WebSocket | null = null;
let enabled = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
/** updatedAt of the last project APPLIED from the bridge — its store update
 * must not be sent straight back (the server also ignores non-newer pushes,
 * so this is belt and braces against echo loops). */
let lastApplied = 0;
let subscribed = false;

export function bridgePort(): number {
  const stored = Number(localStorage.getItem(PORT_KEY));
  return Number.isInteger(stored) && stored > 0 ? stored : DEFAULT_PORT;
}

function setStatus(bridge: BridgeStatus): void {
  if (useStore.getState().bridge !== bridge) useStore.setState({ bridge });
}

function send(project: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "project", project }));
  }
}

function watchStore(): void {
  if (subscribed) return;
  subscribed = true;
  let prev = useStore.getState().project;
  useStore.subscribe((state) => {
    if (state.project === prev) return;
    prev = state.project;
    if (state.project.updatedAt === lastApplied) return; // this change WAS the bridge's
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => send(useStore.getState().project), SEND_DEBOUNCE_MS);
  });
}

function connect(): void {
  if (!enabled || ws) return;
  setStatus("connecting");
  const sock = new WebSocket(`ws://127.0.0.1:${bridgePort()}`);
  ws = sock;

  // The first snapshot of every connection force-applies: enabling the bridge
  // MEANS "follow the agent session". The page's own work stays recoverable —
  // syncProject pushes undo and never writes localStorage. (We deliberately do
  // NOT push our project on connect: loadProject restamps updatedAt on every
  // page load, so a stale reloaded page would otherwise clobber live agent work.)
  let first = true;

  sock.onopen = () => setStatus("connected");

  sock.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg?.type !== "project" || !msg.project) return;
      const project = migrateProject(msg.project);
      // migrateProject restamps updatedAt (right for imports); last-write-wins
      // needs the SESSION's stamp — same restore the server does.
      const sent = Number(msg.project.updatedAt);
      if (Number.isFinite(sent)) project.updatedAt = sent;
      // After the snapshot: strictly newer only (an equal stamp is our own echo).
      if (!first && project.updatedAt <= useStore.getState().project.updatedAt) return;
      first = false;
      lastApplied = project.updatedAt;
      useStore.getState().syncProject(project, true);
    } catch (e) {
      console.warn("[agent-bridge] ignored an unreadable update:", (e as Error).message);
    }
  };

  sock.onclose = () => {
    if (ws !== sock) return; // superseded (disable/re-enable)
    ws = null;
    if (!enabled) {
      setStatus("off");
      return;
    }
    // Keep quietly retrying — the user may simply not have started their
    // agent session yet, and this is exactly the "waiting to connect" state.
    setStatus("connecting");
    retryTimer = setTimeout(connect, RETRY_MS);
  };
  sock.onerror = () => sock.close();
}

export function enableBridge(): void {
  enabled = true;
  try {
    localStorage.setItem(ENABLED_KEY, "on");
  } catch {
    /* private mode — the toggle just won't persist */
  }
  watchStore();
  connect();
}

export function disableBridge(): void {
  enabled = false;
  try {
    localStorage.setItem(ENABLED_KEY, "off");
  } catch {
    /* ignore */
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  ws?.close();
  ws = null;
  setStatus("off");
}

/** Boot hook (main.tsx): resume the connection if the user left it enabled. */
export function initBridgeSync(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(ENABLED_KEY) === "on") enableBridge();
  } catch {
    /* ignore */
  }
}
