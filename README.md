# frame(less) — cabinet builder

[![CI](https://github.com/llmer/cabinets/actions/workflows/ci.yml/badge.svg)](https://github.com/llmer/cabinets/actions/workflows/ci.yml)
[![Deploy](https://github.com/llmer/cabinets/actions/workflows/deploy.yml/badge.svg)](https://github.com/llmer/cabinets/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](package.json)
[![MCP](https://img.shields.io/badge/MCP-server%20included-8A2BE2)](mcp/README.md)

**Try it live → [llmer.github.io/cabinets](https://llmer.github.io/cabinets/)**

> **Disclaimer:** everything this tool produces — dimensions, cut lists, sheet
> nesting, hardware counts, costs, build steps — is an **estimate for reference
> only**, with **no guarantee** of correctness or fitness for your build. Check
> the math against your own method, your actual materials and your site
> measurements before you commit to cutting or buying anything.

A local-first cabinet builder for the **32 mm system**. Lay out a run of base,
wall and tall cabinets; the app derives a complete cut list, nests the parts onto
sheet goods, prices the materials and hardware, writes step-by-step assembly
instructions, and renders the whole run in 3D.

Everything runs in the browser. There is **no backend and no database** — your
work autosaves to `localStorage` and round-trips through plain `.json` files.

This is a production implementation of the imported *Cabinet Builder* design
(claude.ai/design). The original prototype's cabinet math was ported verbatim
and pinned with unit tests; the architecture, materials model, hardware/cost
estimation, units, persistence and exports were built out around it.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production bundle to dist/
npm run preview    # serve the production build
npm run test       # run the engine + render test suite (vitest)
npm run typecheck  # tsc --noEmit
npm run mcp        # start the MCP server (stdio) — see "AI agents" below
npm run mcp:smoke  # drive the MCP server end-to-end and assert
```

Requires Node 18+ (developed on Node 24).

## CI & deployment

Two GitHub Actions workflows live in [`.github/workflows/`](.github/workflows/):

- **[CI](.github/workflows/ci.yml)** — on every push and pull request:
  typecheck, the full vitest suite (engine golden values + render smoke + MCP
  session), a production build, and the MCP stdio smoke test.
- **[Deploy](.github/workflows/deploy.yml)** — every push to `main` builds the
  app and publishes it to **GitHub Pages** at
  [llmer.github.io/cabinets](https://llmer.github.io/cabinets/). The workflow
  sets `BASE_PATH=/cabinets/` so Vite emits asset URLs for the project subpath;
  local dev and self-hosted builds are unaffected.

Since the app is fully static (no backend), the Pages deployment *is* the
production release — your projects still live only in your browser.

## AI agents (MCP server) — bring your own

frame(less) ships an **[MCP](https://modelcontextprotocol.io) server** so an AI
agent can drive the tool directly — designing a kitchen, auditing a design, and
walking a build — using the *same* engine and mutation rules as the app. Your
agent, your subscription: it plugs into the session you already have (Claude
Code, Claude Desktop, Codex — any MCP client). There are no API keys and no
hosted inference; everything runs on your machine.

### Use it with the hosted app — no clone needed

1. Open **[llmer.github.io/cabinets](https://llmer.github.io/cabinets/)** and
   click **Agent** in the header.
2. Add the server to your agent (the popover has a copy button):

   ```bash
   claude mcp add cabinets -- npx -y github:llmer/cabinets
   ```

3. Click **Connect**. The page now follows your agent session live — ask it to
   lay out a kitchen and watch the layout, cut list, sheets and 3D update as it
   works. Your in-page edits flow back to the agent too.

How it works: your MCP client spawns the server locally (npx builds it straight
from this repo — nothing is published or hosted), and the server opens a
WebSocket **bridge on `127.0.0.1:5178`** that the page dials out to. The
connection is strictly opt-in, loopback-only, and origin-checked (only this
app's origins may connect), and project data never travels anywhere except
between that tab and the local process. Sync is last-write-wins with undo — see
[`mcp/README.md`](mcp/README.md) for the protocol and the
`CABINETS_BRIDGE*` environment knobs.

### Working in the repo

The server is registered in [`.mcp.json`](.mcp.json); open the repo in an
MCP-capable client and enable the **cabinets** server, or run `npm run mcp`
and point your own client at stdio. It exposes ~27 tools across four jobs —
**design** (`add_cabinet`, `update_cabinet`, `set_run_break`, `apply_to_all`),
**audit** (`audit_project`, `project_summary`), **build** (`get_cut_list`,
`get_sheets`, `get_build_steps`, `get_shopping_list`), and **explain**
(`explain`, `list_materials`) — plus `cabinets://` resources and one prompt per
persona. Full catalog: [`mcp/README.md`](mcp/README.md).

**Live preview.** Edits **autosave** (no explicit save step). With `npm run dev`
running, changes also stream over the dev server's HMR socket (a dev-only Vite
plugin); the agent bridge above works in every build, dev or hosted.

## Features

**Layout** — front-elevation of the run. Drag boxes to reorder within their band
(base/tall vs. wall), click to edit. Per-cabinet editor: type, construction,
W×H×D with width presets, front style, door/drawer/shelf counts, individual
drawer-front heights (clamped so the stack never overflows), toe-kick, duplicate
and remove. Counter and upper guide lines.

**Front styles** — doors, drawer bank, drawer-over-doors, open desk (drawers over
an open knee space), and an appliance/fridge opening (no front, bottom or back).

**Construction** — frameless (Euro) or face frame (hardwood stiles & rails),
**independent** of the front fit (**full overlay** vs **inset**). All four
combinations work — including face-frame full-overlay, the most common American
kitchen style — set per cabinet or across the whole run.

**Cut list** — every part grouped by cabinet with quantities, dimensions, material
tag and edge-banding. Includes drawer-box parts (sides, front/back, bottom).
Itemized material + hardware cost estimate. Export to **CSV**, a plain-text
**shopping list**, or **print**.

**Sheets** — first-fit-decreasing nesting with saw-kerf accounting and optional
grain rotation, shown per material. Oversize-part warnings. Export placements to
CSV. Optional **store breakdown** mode plans the full-length rips a store's
panel saw (e.g. Home Depot) makes before the sheet leaves the store — strips
are easier to haul, and every part keeps a configurable trim allowance clear of
each rough store cut so you re-cut those edges clean with a track saw at home.

**Build** — ordered assembly steps per cabinet (32 mm drilling, joinery, banding,
hanging, hinges, slides, shelves) plus a consolidated shopping list.

**3D view** — Three.js render of the run with orbit / pan / zoom, iso/front/top
presets, and a show/hide-fronts toggle. Lazy-loaded so Three.js isn't in the
initial bundle.

**Throughout** — inches ↔ millimetres toggle, undo/redo, project rename, new /
import / export, and a Settings tab for the material library, part→material
mapping, hardware/banding pricing and shop defaults.

## Architecture

```
src/
  domain/      types + defaults (Cabinet, Settings, Stock, Project)
  engine/      pure, framework-free math (fully unit-tested)
    units      fraction/mm formatting + parsing
    geometry   box height, interior, carcass depth, face height
    drawers    drawer-front height model (budget / even split / clamping)
    parts      cut-list generation (carcass, fronts, face frame, drawer boxes)
    hardware   hinge / slide / pull / shelf-pin counts
    packing    sheet nesting
    cost       itemized material + hardware estimate
    steps      assembly instructions
    compute    aggregates the above into one view model
  state/       Zustand store (undo/redo), localStorage persistence, exporters
  three/       CabinetScene — the WebGL renderer
  components/  Header, Tabs, shared UI primitives
  views/       Layout, Cut list, Sheets, Build, 3D, Settings
  theme.ts     design tokens lifted from the imported design
```

The `engine/` layer is pure and has no React/DOM dependency, so the cabinet math
is independently testable and reusable. The UI reads a single memoized `compute`
model; every store mutation produces fresh references so the model recomputes
only when cabinets or settings actually change.

## Construction assumptions (the math)

- Dimensions are stored in **inches**; the mm toggle is display-only — the math
  never changes.
- **Frameless**: 3/4" plywood box; applied 3/4" back (sides & top/bottom set 3/4"
  shallower so finished depth holds).
- **Face frame**: adds a 1 1/2" hardwood face frame (listed separately by the
  linear foot, *not* nested in the plywood sheets).
- **Front fit** is a separate axis with three options: *full overlay* (fronts
  proud, covering the box/frame to a 1/8" reveal); *railed inset* (flush in the
  openings with a rail between every stacked face — listed as "Inset rail" parts,
  32 mm rows shift back ~56 mm); and *flush inset* (flush, gaps only, no rails).
- **Drawer boxes** get their own plan: the Build view lists each box's
  W×D×H, the side / front-back / bottom part sizes, and a short build note
  (1/2" ply sides, 1/4" captured bottom, 1" narrower than the opening).
- Base cabinets use two 4" top stretchers; wall/tall use a full top.
- Drawer boxes default to 1/2" ply sides with a 1/4" captured bottom, 1" narrower
  than the opening for side-mount slides. Toggle off in Settings.
- **Framed drawer bays** also list "Slide blocking strip" parts — 4"-wide ply
  pack-outs that bring each carcass wall flush with the slide line of the frame
  opening (the box hangs centred under its front, so at a run joint the shared
  half-stile side takes a thinner strip than an exposed end). The drawer build
  step quotes the per-side thickness.
- Hinges per door scale with height (2 / 3 / 4 / 5). One slide pair per drawer;
  one pull per door and drawer (configurable); four pins per adjustable shelf.

All of this is configurable in Settings, and every view repeats the caveat:
**verify against your own method before cutting.**

## Data & persistence

The active project autosaves to `localStorage` on every change. Use Export to
download a versioned `.json`, Import to load one. Older files are migrated onto
the current settings schema on load. No data leaves the machine.

## License

[MIT](LICENSE) — this tool estimates a cut list and is **not a guarantee;
verify against your own method before cutting.**
