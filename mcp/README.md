# frame(less) MCP server

An [MCP](https://modelcontextprotocol.io) server that hands the cabinet builder
to an AI agent, so it can **design**, **audit** and **assist a build** — not just
answer questions about it, but actually drive the tool: add cabinets, change
construction, re-nest sheets, cost the job, and read the assembly steps back.

It runs the **same pure engine and mutation rules the browser app uses**
(`src/engine`, `src/domain/ops.ts`), so a plan an agent produces here is
identical to one you'd build by hand in the UI, and round-trips through the same
`.cabinets.json` files. No backend, no database — the server holds one project
in memory and reads/writes it to disk on request, mirroring the app's
localStorage round-trip.

## The three personas

The surface is designed around who's asking:

| Persona | "I want to…" | Reach for |
| --- | --- | --- |
| **Designer** | lay out a kitchen, try framed vs. frameless, split a run at a corner | `new_project`, `add_cabinet`, `update_cabinet`, `set_run_break`, `apply_to_all` |
| **Reviewer / auditor** | catch problems before cutting | `audit_project`, `project_summary`, `get_cabinet` |
| **Builder** | take it to the shop | `get_cut_list`, `get_sheets`, `get_build_steps`, `get_shopping_list`, `get_cost_breakdown` |
| **Questioner** (mid-design) | understand *why* | `explain`, `list_materials`, the `reference://` resource |

Each persona also has a one-click **prompt** (`plan_kitchen`, `audit_design`,
`build_walkthrough`) that seeds the right workflow.

## Setup

The server is already registered for this repo in [`.mcp.json`](../.mcp.json):

```jsonc
{ "mcpServers": { "cabinets": { "command": "npx", "args": ["tsx", "mcp/server.ts"] } } }
```

- **Claude Code / Claude Desktop / Cursor**: open this repo; the client detects
  `.mcp.json` and offers to enable the **cabinets** server. Approve it.
- **Anything else**: run `npm run mcp` (stdio) and point your client at it.

First run needs the dependencies installed (`npm install`); `tsx` runs the
TypeScript directly, resolving the `@/*` alias from `tsconfig.json` — no build step.

Verify it end-to-end at any time:

```bash
npm run mcp:smoke   # spawns the server, drives a full designer→builder round-trip
```

## Tools

**Project lifecycle**
- `open_project { path }` — load + migrate a `.cabinets.json` and make it current.
- `new_project { name?, empty? }` — start fresh (seeded, or blank).
- `save_project { path? }` — write the project back to disk (defaults to the opened file).
- `get_project` — the raw project JSON.
- `project_summary` — cabinets, runs, sheets + yield, hardware, face-frame footage, cost.
- `rename_project { name }`.

**Design**
- `list_cabinets` — a compact table of every cabinet.
- `get_cabinet { cabinet }` — one cabinet in full: fields, derived geometry, part/step counts.
- `add_cabinet { type, name?, width?, height?, depth?, frontStyle?, doorCount?, drawerCount?, shelves?, toeKick?, construction?, overlay?, runBreak?, drawerHeights? }`.
- `update_cabinet { cabinet, …same fields }` — budget-affecting changes re-derive drawer heights exactly as the UI does.
- `remove_cabinet { cabinet }` · `duplicate_cabinet { cabinet }`.
- `move_cabinet { cabinet, toIndex }` — reorder a cabinet (runs derive from list order).
- `set_run_break { cabinet, on }` — start a new run before a cabinet (corner / appliance gap / island).
- `apply_to_all { construction?, overlay? }` — bulk construction / front-fit.

**Settings & materials**
- `update_settings { … }` — reveal, toe kick + recesses, face-frame widths, kerf, run frame/base toggles, units, guide heights, edge-band price.
- `list_materials` — stock library, role→stock mapping, hardware pricing.
- `set_role_stock { role, stockId }` · `update_stock { id, … }` · `update_hardware { … }`.

**Build**
- `get_cut_list { cabinet?, format? }` — grouped parts (or one cabinet/run); `format:"csv"` for an optimizer.
- `get_sheets { format? }` — nesting: sheets per stock, yield, oversize flags; `format:"csv"` for placements.
- `get_build_steps { cabinet? }` — ordered, stage-tagged assembly steps.
- `get_shopping_list` — sheets, hardwood, banding, hardware, total.
- `get_cost_breakdown` — itemized cost.

**Audit & explain**
- `audit_project` — buildability + design review (oversize panels, exhausted drawer budgets, sag-prone doors, low yield, mixed toe-kick runs, appliance gaps sharing a frame, front/count mismatches).
- `explain { topic }` — a domain term (`runs`, `overlay`, `toe_kick`, `drawer_budget`, `system_32mm`, …).

Cabinets are addressable by **id or name** (`"B1"`), so an agent can work the way
you'd talk about the kitchen. Every mutating tool echoes a one-line headline
(cost · sheets · yield · hardware) so the agent always sees the impact of a change.

## Resources

- `cabinets://project` — the live project as JSON (the source of truth).
- `cabinets://cutlist.csv` — the current cut list as decimal-inch CSV.
- `cabinets://reference` — the domain reference (types, construction vs. fit, runs, the 32 mm system).

## Design notes

- **One source of truth for mutations.** The rules that used to live only inside
  the Zustand store (drawer-height re-derivation on construction/overlay/front/count
  changes, desk/opening open-box invariants, type clamps) were extracted to the
  pure `src/domain/ops.ts`. The store and this server both call it, so the UI and
  an agent can never drift.
- **Pure engine, reused.** `compute()` and `auditProject()` are framework-free and
  unit-tested with golden values; the server just formats their output.
- **stdio hygiene.** Only JSON-RPC goes to stdout; logs go to stderr.
- **It's an estimate.** Every summary repeats it: this estimates a cut list and is
  not a guarantee — verify against your own method before cutting.
