# frame(less) — cabinet builder

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
```

Requires Node 18+ (developed on Node 24).

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
CSV.

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
- Hinges per door scale with height (2 / 3 / 4 / 5). One slide pair per drawer;
  one pull per door and drawer (configurable); four pins per adjustable shelf.

All of this is configurable in Settings, and every view repeats the caveat:
**verify against your own method before cutting.**

## Data & persistence

The active project autosaves to `localStorage` on every change. Use Export to
download a versioned `.json`, Import to load one. Older files are migrated onto
the current settings schema on load. No data leaves the machine.
