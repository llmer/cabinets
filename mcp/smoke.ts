/**
 * Live smoke test for the MCP server.
 *
 * Spawns the real server over stdio using the official MCP client, runs a full
 * designer → auditor → builder round-trip against the bundled maple-v2 project,
 * and asserts the responses. Exits non-zero on any failure. Run: `npm run mcp:smoke`.
 *
 * This is a subprocess integration check, deliberately OUTSIDE the vitest suite
 * (which is a fast, in-process node run) — it exercises the actual JSON-RPC
 * handshake, tool schemas and transport end to end.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "maple-v2.cabinets.json");
// Work on a throwaway COPY — autosave writes the opened file, so we must never
// point the test at the committed fixture. Also a throwaway live file.
const liveDir = mkdtempSync(join(tmpdir(), "cab-smoke-"));
const liveFile = join(liveDir, "live.cabinets.json");
const maple = join(liveDir, "maple-copy.cabinets.json");
const fixtureBefore = readFileSync(fixture, "utf8");
copyFileSync(fixture, maple);

let failures = 0;
const results: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  results.push(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

/** Pull the concatenated text out of a tool result. */
function textOf(res: { content?: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  return (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", resolve(root, "mcp/server.ts")],
    cwd: root,
    stderr: "inherit",
    env: { ...(process.env as Record<string, string>), CABINETS_LIVE_FILE: liveFile },
  });
  const client = new Client({ name: "cabinets-smoke", version: "1.0.0" });
  await client.connect(transport);

  // --- discovery ---
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name).sort();
  check("tools/list returns the full surface", toolNames.length >= 24, `${toolNames.length} tools`);
  for (const need of [
    "open_project",
    "add_cabinet",
    "update_cabinet",
    "audit_project",
    "get_cut_list",
    "get_build_steps",
    "explain",
  ]) {
    check(`tool "${need}" registered`, toolNames.includes(need));
  }

  const resources = await client.listResources();
  check("resources/list has project + reference", resources.resources.length >= 3, `${resources.resources.length}`);

  const prompts = await client.listPrompts();
  check("prompts/list has the 3 personas", prompts.prompts.length === 3, prompts.prompts.map((p) => p.name).join(","));

  // --- designer / auditor: open + inspect maple-v2 ---
  const opened = await client.callTool({ name: "open_project", arguments: { path: maple } });
  const openedText = textOf(opened as never);
  check("open_project loads maple-v2", !opened.isError && /maple-v2/.test(openedText), openedText.split("\n")[0]);

  const summary = textOf((await client.callTool({ name: "project_summary", arguments: {} })) as never);
  check("project_summary reports 3 cabinets", /Cabinets:\s+3/.test(summary));
  check("project_summary reports a cost", /Est\. cost:\s+\$\d/.test(summary));

  const list = textOf((await client.callTool({ name: "list_cabinets", arguments: {} })) as never);
  check("list_cabinets shows B1", /B1/.test(list));

  const audit = textOf((await client.callTool({ name: "audit_project", arguments: {} })) as never);
  check("audit_project runs on maple-v2", /Audit:/.test(audit), audit.split("\n")[0]);

  // --- designer: mutate ---
  const add = await client.callTool({
    name: "add_cabinet",
    arguments: { type: "base", name: "SINK", width: 36, frontStyle: "doors", doorCount: 2 },
  });
  check("add_cabinet appends a base", !add.isError && /Added SINK/.test(textOf(add as never)));

  // implicit autosave: the mutation should have streamed to the live file on disk
  const liveHasSink = (() => {
    try {
      return readFileSync(liveFile, "utf8").includes("SINK");
    } catch {
      return false;
    }
  })();
  check("edit autosaved to the live file (no explicit save)", liveHasSink);
  check("mutation response reports the autosave target", /autosaved/i.test(textOf(add as never)));

  const summary2 = textOf((await client.callTool({ name: "project_summary", arguments: {} })) as never);
  check("cabinet count grew to 4 after add", /Cabinets:\s+4/.test(summary2));

  // budget-affecting update must re-derive heights and succeed
  const upd = await client.callTool({
    name: "update_cabinet",
    arguments: { cabinet: "SINK", frontStyle: "drawers", drawerCount: 3 },
  });
  check("update_cabinet re-derives a drawer bank", !upd.isError && /drawer/i.test(textOf(upd as never)));

  // invalid drawer heights must be rejected with a helpful error
  const bad = await client.callTool({
    name: "update_cabinet",
    arguments: { cabinet: "SINK", drawerHeights: [99, 99, 99] },
  });
  check("update_cabinet rejects over-budget heights", bad.isError === true, textOf(bad as never).slice(0, 60));

  // a base-only front style on a wall cabinet must be rejected (UI parity)
  const wallDrawers = await client.callTool({
    name: "add_cabinet",
    arguments: { type: "wall", frontStyle: "drawers" },
  });
  check("add_cabinet rejects a base-only front on a wall", wallDrawers.isError === true);

  // combined dimension + drawer-count update re-derives against the NEW box height
  const combined = await client.callTool({
    name: "update_cabinet",
    arguments: { cabinet: "SINK", height: 45, drawerCount: 4 },
  });
  check("update_cabinet handles a combined height+count change", !combined.isError && /Drawer heights:/.test(textOf(combined as never)));

  // --- builder: cut list + steps ---
  const cut = textOf((await client.callTool({ name: "get_cut_list", arguments: { cabinet: "B1" } })) as never);
  check("get_cut_list for B1 lists parts", /Side panel|Bottom|Door|Drawer/.test(cut));
  check("get_cut_list for a framed cabinet includes its run face frame", /Face-frame/.test(cut));

  const csv = textOf((await client.callTool({ name: "get_cut_list", arguments: { format: "csv" } })) as never);
  check("get_cut_list csv has a header row", /Cabinet,Type,Part,Qty/.test(csv));
  const csvB1 = textOf((await client.callTool({ name: "get_cut_list", arguments: { cabinet: "B1", format: "csv" } })) as never);
  check("get_cut_list csv honors the cabinet filter", csvB1.split("\n").length < csv.split("\n").length);

  const steps = textOf((await client.callTool({ name: "get_build_steps", arguments: { cabinet: "B1" } })) as never);
  check("get_build_steps for B1 is ordered + staged", /\[sides\]/.test(steps) && /1\./.test(steps));
  check("get_build_steps includes the drawer-box table", /Drawer boxes/.test(steps));

  // reorder: move B3 to the front, confirm the table reflects it
  const moved = await client.callTool({ name: "move_cabinet", arguments: { cabinet: "B3", toIndex: 0 } });
  check("move_cabinet reorders the list", !moved.isError && /Moved B3 to position 0/.test(textOf(moved as never)));

  const shop = textOf((await client.callTool({ name: "get_shopping_list", arguments: {} })) as never);
  check("get_shopping_list totals a cost", /TOTAL/.test(shop) && /\$/.test(shop));

  // --- questioner: explain + reference resource ---
  const explain = await client.callTool({ name: "explain", arguments: { topic: "runs" } });
  check("explain runs returns the runs topic", /run/i.test(textOf(explain as never)));
  const explainSheets = await client.callTool({ name: "explain", arguments: { topic: "sheets" } });
  check("explain sheets/nesting topic exists", !explainSheets.isError && /yield/i.test(textOf(explainSheets as never)));
  const explainBad = await client.callTool({ name: "explain", arguments: { topic: "nope" } });
  check("explain rejects an unknown topic", explainBad.isError === true);

  const ref = await client.readResource({ uri: "cabinets://reference" });
  const ref0 = ref.contents[0];
  const refText = ref0 && "text" in ref0 ? String(ref0.text) : "";
  check("reference resource reads markdown", /domain reference/i.test(refText));

  // --- error handling: missing cabinet ---
  const missing = await client.callTool({ name: "get_cabinet", arguments: { cabinet: "ZZZ" } });
  check("get_cabinet on a bad id errors cleanly", missing.isError === true);

  // Autosave must never have touched the committed fixture (we opened a copy).
  check("the committed fixture is untouched by autosave", readFileSync(fixture, "utf8") === fixtureBefore);

  await client.close();
  rmSync(liveDir, { recursive: true, force: true });

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"} (${results.length} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke run crashed:", e);
  process.exit(1);
});
