/**
 * Agent-bridge tests: the pure origin/adopt gates, and a real WebSocket
 * round-trip against a live bridge on an ephemeral port (vitest runs in a
 * plain node environment, so actual loopback sockets are fine here).
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { newProject } from "@/domain/defaults";
import { Project } from "@/domain/types";
import { Bridge, isAllowedOrigin, shouldAdopt, startBridge } from "./bridge";
import { CabinetSession } from "./session";

describe("isAllowedOrigin", () => {
  it("allows the hosted app", () => {
    expect(isAllowedOrigin("https://llmer.github.io")).toBe(true);
  });
  it("allows localhost dev and preview on any port", () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost:4173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("https://localhost:8443")).toBe(true);
  });
  it("allows non-browser clients (no Origin header)", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
  it("refuses every other website", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("https://llmer.github.io.evil.com")).toBe(false);
    expect(isAllowedOrigin("http://llmer.github.io")).toBe(false); // https only
    expect(isAllowedOrigin("null")).toBe(false); // sandboxed / file:// pages
    expect(isAllowedOrigin("not a url")).toBe(false);
  });
  it("honours extra origins from the environment", () => {
    expect(isAllowedOrigin("https://cabinets.example.com", ["https://cabinets.example.com"])).toBe(true);
  });
});

describe("shouldAdopt", () => {
  const at = (updatedAt: number): Project => ({ ...newProject(), updatedAt });
  it("adopts only a strictly newer project (equal = echo, ignored)", () => {
    expect(shouldAdopt(at(2), at(1))).toBe(true);
    expect(shouldAdopt(at(1), at(1))).toBe(false);
    expect(shouldAdopt(at(1), at(2))).toBe(false);
  });
});

describe("startBridge (live socket)", () => {
  let bridge: Bridge | null = null;
  const sockets: WebSocket[] = [];

  afterEach(() => {
    for (const ws of sockets) ws.terminate();
    sockets.length = 0;
    bridge?.close();
    bridge = null;
  });

  function connect(port: number, origin?: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
    sockets.push(ws);
    return ws;
  }

  /** Collect parsed messages; await until the predicate holds (or time out). */
  function collect(ws: WebSocket): { messages: { type: string; project: Project }[]; until: (n: number) => Promise<void> } {
    const messages: { type: string; project: Project }[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    return {
      messages,
      until: (n) =>
        new Promise((resolve, reject) => {
          const t0 = Date.now();
          const tick = () => {
            if (messages.length >= n) return resolve();
            if (Date.now() - t0 > 4000) return reject(new Error(`timed out waiting for ${n} messages (got ${messages.length})`));
            setTimeout(tick, 10);
          };
          tick();
        }),
    };
  }

  it("snapshots on connect, adopts a newer push, broadcasts to others but never echoes", async () => {
    const session = new CabinetSession();
    bridge = await startBridge(session, { port: 0 });
    expect(bridge).not.toBeNull();

    const page = connect(bridge!.port, "http://localhost:5173");
    const other = connect(bridge!.port); // a second follower
    const pageRx = collect(page);
    const otherRx = collect(other);
    await pageRx.until(1);
    await otherRx.until(1);
    expect(pageRx.messages[0].type).toBe("project");
    expect(pageRx.messages[0].project.name).toBe(session.project.name);

    // The page pushes a NEWER project → the session adopts it verbatim…
    const edited: Project = { ...session.project, name: "pushed-from-page", updatedAt: session.project.updatedAt + 1000 };
    page.send(JSON.stringify({ type: "project", project: edited }));
    await otherRx.until(2);
    expect(session.project.name).toBe("pushed-from-page");
    expect(session.project.updatedAt).toBe(edited.updatedAt);
    // …the OTHER client hears about it, the sender gets no echo.
    expect(otherRx.messages[1].project.name).toBe("pushed-from-page");
    expect(pageRx.messages).toHaveLength(1);

    // A STALE push (same updatedAt) is ignored entirely — give it time to land.
    page.send(JSON.stringify({ type: "project", project: { ...edited, name: "stale" } }));
    await new Promise((r) => setTimeout(r, 150));
    expect(session.project.name).toBe("pushed-from-page");
    // An agent-side mutation broadcasts to everyone, sender included.
    session.rename("agent-edit");
    await pageRx.until(2);
    await otherRx.until(3);
    expect(session.project.name).toBe("agent-edit");
    expect(pageRx.messages[1].project.name).toBe("agent-edit");
    expect(otherRx.messages[2].project.name).toBe("agent-edit");
  });

  it("rejects a payload that fails validation without poisoning the session", async () => {
    const session = new CabinetSession();
    bridge = await startBridge(session, { port: 0 });
    const name = session.project.name;

    const page = connect(bridge!.port, "http://localhost:5173");
    const rx = collect(page);
    await rx.until(1);
    page.send(JSON.stringify({ type: "project", project: { updatedAt: Date.now() + 60_000, cabinets: "nope" } }));
    page.send("not even json");
    // Prove the server is still alive and unchanged: an agent edit still flows.
    session.rename("still-alive");
    await rx.until(2);
    expect(rx.messages[1].project.name).toBe("still-alive");
    expect(session.project.name).toBe("still-alive");
    expect(name).not.toBe("still-alive");
  });

  it("refuses browser connections from a disallowed origin", async () => {
    const session = new CabinetSession();
    bridge = await startBridge(session, { port: 0 });
    const ws = connect(bridge!.port, "https://evil.example.com");
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("refused"));
      ws.on("close", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
  });

  it("yields null (and keeps the server usable) when the port is taken", async () => {
    const session = new CabinetSession();
    bridge = await startBridge(session, { port: 0 });
    const second = await startBridge(new CabinetSession(), { port: bridge!.port });
    expect(second).toBeNull();
  });
});
