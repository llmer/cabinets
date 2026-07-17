/**
 * "Agent" header control: connect this page to the user's OWN agent session.
 *
 * The popover explains the bring-your-own-agent flow (their Claude Code /
 * Claude Desktop / Codex session spawns our MCP server locally; the server
 * opens a loopback WebSocket; this page follows it live) and holds the opt-in
 * toggle. Connection state itself lives in the store (`bridge`), driven by
 * state/bridgeSync.ts, so this component stays a plain view.
 */
import { CSSProperties, useState } from "react";
import { color, font } from "@/theme";
import { useStore } from "@/state/store";
import { bridgePort, disableBridge, enableBridge } from "@/state/bridgeSync";
import { Button } from "./ui";

const INSTALL_CMD = "claude mcp add cabinets -- npx -y github:llmer/cabinets";

const STATUS = {
  off: { dot: color.fainter, label: "Agent", title: "Connect your own AI agent session" },
  connecting: { dot: color.gold, label: "Agent …", title: "Waiting for a local agent session" },
  connected: { dot: color.green, label: "Agent · linked", title: "Following your local agent session" },
} as const;

const card: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  zIndex: 40,
  width: 360,
  padding: "14px 16px",
  border: `1px solid ${color.border}`,
  borderRadius: 8,
  background: color.panel,
  boxShadow: "0 6px 24px rgba(31,20,14,0.18)",
  textAlign: "left",
};

export function AgentBridge() {
  const status = useStore((s) => s.bridge);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const st = STATUS[status];
  const on = status !== "off";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={st.title}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          border: `1px solid ${status === "connected" ? color.green : color.border}`,
          background: color.panel,
          color: status === "connected" ? color.greenDeep : color.inkStrong,
          borderRadius: 5,
          padding: "7px 11px",
          fontFamily: font.mono,
          fontSize: 12,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.dot, display: "inline-block" }} />
        {st.label}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div style={card}>
            <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 19, marginBottom: 6 }}>
              Bring your own agent
            </div>
            <div style={{ fontFamily: font.sans, fontSize: 13, color: color.inkMuted, lineHeight: 1.5 }}>
              Add frame(less) to your own Claude Code, Claude Desktop or Codex session — it runs the
              cabinet tools on <em>your</em> machine, and this page follows the session live (your edits
              flow back too). Nothing is sent anywhere except between this tab and{" "}
              <span style={{ fontFamily: font.mono, fontSize: 12 }}>127.0.0.1:{bridgePort()}</span>.
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "10px 0",
                padding: "8px 10px",
                border: `1px solid ${color.divider}`,
                borderRadius: 6,
                background: color.inset,
              }}
            >
              <code style={{ fontFamily: font.mono, fontSize: 11.5, color: color.inkStrong, overflowX: "auto", whiteSpace: "nowrap", flex: 1 }}>
                {INSTALL_CMD}
              </code>
              <Button
                variant="mono"
                title="Copy command"
                onClick={() => {
                  navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  });
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontFamily: font.mono, fontSize: 11, color: status === "connected" ? color.greenDeep : color.faint }}>
                {status === "off" && "not connected"}
                {status === "connecting" && "waiting for your agent session…"}
                {status === "connected" && "linked — following your agent"}
              </div>
              <Button variant={on ? "mono" : "primary"} onClick={() => (on ? disableBridge() : enableBridge())}>
                {on ? "Disconnect" : "Connect"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
