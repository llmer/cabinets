/**
 * End-to-end validation of the agent bridge in a REAL browser:
 *   production build served by `vite preview`  ⇄  ws://127.0.0.1  ⇄  the
 *   npx-packaged MCP server driven over stdio by a real MCP client.
 *
 * Proves, in Chromium:
 *  1. the page connects from the Agent popover and adopts the agent's project
 *  2. an agent edit (rename, add_cabinet) appears live in the UI
 *  3. a human edit in the page flows back into the MCP session
 *
 * Playwright is deliberately NOT a devDependency (this never runs in CI, and
 * scripts/ is outside the tsconfig/vitest scope). One-time setup, then run:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm run build:mcp && npx vite build
 *   npx tsx scripts/e2e-bridge.mts        # screenshots land in .e2e-shots/
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = resolve(root, ".e2e-shots");
mkdirSync(SHOTS, { recursive: true });

const PREVIEW_URL = "http://localhost:4173/";
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function waitFor(fn: () => Promise<boolean>, ms = 8000, label = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

// --- serve the production build ---
const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], {
  cwd: root,
  stdio: "ignore",
});
// A crashed earlier run must not leave the port squatted for the next one.
const cleanup: (() => void)[] = [() => preview.kill()];
process.on("exit", () => cleanup.forEach((fn) => { try { fn(); } catch { /* gone */ } }));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
await waitFor(async () => (await fetch(PREVIEW_URL)).ok, 15000, "vite preview");

// --- the "agent": a real MCP client driving the packaged server over stdio ---
const env = { ...process.env } as Record<string, string>;
delete env.CABINETS_FILE;
env.CABINETS_LIVE_FILE = `${SHOTS}/live.cabinets.json`;
const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(root, "bin/frameless-mcp.mjs")],
  env,
  stderr: "pipe",
});
const agent = new Client({ name: "e2e", version: "0.0.0" });
cleanup.push(() => void agent.close());
await agent.connect(transport);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await agent.callTool({ name, arguments: args })) as { content: { text?: string }[]; isError?: boolean };
  const text = res.content?.map((c) => c.text ?? "").join("\n") ?? "";
  if (res.isError) throw new Error(`${name} failed: ${text.slice(0, 200)}`);
  return text;
};

// Give the session a recognizable state BEFORE the page ever connects.
await call("rename_project", { name: "agent-designed-kitchen" });

// --- the browser ---
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(PREVIEW_URL);
await page.waitForSelector('input[aria-label="Project name"]');
await page.screenshot({ path: `${SHOTS}/1-initial.png` });

// 1. connect from the Agent popover
await page.getByRole("button", { name: "Agent" }).click();
check("popover shows the npx command", await page.getByText("github:llmer/cabinets").isVisible());
await page.screenshot({ path: `${SHOTS}/2-popover.png` });
await page.getByRole("button", { name: "Connect", exact: true }).click();
await waitFor(async () => page.getByText("linked — following your agent").isVisible(), 8000, "bridge link");
check("status shows linked", true);

// first snapshot adopted: the page now shows the AGENT's project
await waitFor(
  async () => (await page.inputValue('input[aria-label="Project name"]')) === "agent-designed-kitchen",
  8000,
  "snapshot adoption",
);
check("page adopted the agent session's project on connect", true);
check("LIVE chip appeared", await page.getByText("LIVE · following agent").isVisible());
await page.screenshot({ path: `${SHOTS}/3-connected.png` });
// dismiss the popover (click-away backdrop) before touching the page beneath
await page.mouse.click(720, 600);

// 2. live agent edits → page
const baseRunBefore = await page.getByText("Base run", { exact: true }).locator("..").textContent();
await call("add_cabinet", { type: "base" });
await waitFor(
  async () => (await page.getByText("Base run", { exact: true }).locator("..").textContent()) !== baseRunBefore,
  8000,
  "base-run chip update after add_cabinet",
);
check("agent add_cabinet updated the page live", true, `\"${baseRunBefore?.trim()}\" → \"${(await page.getByText("Base run", { exact: true }).locator("..").textContent())?.trim()}\"`);

await call("rename_project", { name: "renamed-by-agent" });
await waitFor(
  async () => (await page.inputValue('input[aria-label="Project name"]')) === "renamed-by-agent",
  8000,
  "agent rename in page",
);
check("agent rename updated the page live", true);
await page.screenshot({ path: `${SHOTS}/4-agent-edit.png` });

// 3. human edit in the page → agent session
await page.fill('input[aria-label="Project name"]', "renamed-in-browser");
await waitFor(async () => (await call("get_project")).includes("renamed-in-browser"), 8000, "page edit reaching the session");
check("page edit reached the MCP session", true);
await page.screenshot({ path: `${SHOTS}/5-page-edit.png` });

// 4. reconnect resilience: kill nothing, just disconnect from the UI
await page.getByRole("button", { name: /Agent · linked/ }).click();
await page.getByRole("button", { name: "Disconnect", exact: true }).click();
await waitFor(async () => page.getByText("not connected").isVisible(), 5000, "disconnect");
check("disconnect returns to off", true);

await browser.close();
await agent.close();
preview.kill();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
