# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

frame(less) is a local-first, browser-only cabinet builder for the 32 mm system.
No backend, no database: state lives in `localStorage` and round-trips through
`.json` files. React + Zustand + Three.js, bundled with Vite.

## Commands

```bash
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # tsc --noEmit (typecheck) then production bundle to dist/
npm run typecheck  # tsc --noEmit only
npm run test       # vitest run (engine + render suite, once)
npm run test:watch # vitest in watch mode
```

Run a single test file or a single case:

```bash
npx vitest run src/engine/cabinet.test.ts        # one file
npx vitest run -t "computes box height"          # one case by name
```

Requires Node 18+ (developed on Node 24). There is no linter configured; the
TypeScript compiler under `strict` (plus `noUnusedLocals`/`noUnusedParameters`)
is the gate — `npm run build` fails on any type or unused-symbol error.

The `@/*` import alias maps to `src/*`. It is declared in **both** `tsconfig.json`
(`paths`) and `vite.config.ts` (`resolve.alias`) — changing one without the other
breaks either the typecheck or the runtime.

## Architecture: the one-way data flow

The entire app is a pure function of two inputs — `cabinets[]` and `settings` —
rendered through a single derived model. Understand this pipeline before changing
anything:

```
domain/types.ts  →  Cabinet[] + Settings  (the only source of truth)
        │
   state/store.ts  Zustand: all mutations go through apply()
        │           → stamps updatedAt, pushes undo history, autosaves to localStorage
        │           → always produces FRESH references
        │
   state/useModel.ts  useMemo(compute, [cabinets, settings])
        │              recomputes only when those references change
        │
   engine/compute.ts  compute(cabinets, settings) → Model
        │              the single aggregator: parts + cut groups + nesting
        │              + steps + hardware counts + cost + summary + legend
        │
      views/*         read the Model, render. Never recompute domain math.
```

Because every store mutation creates new `cabinets`/`settings` references, the
`useMemo` in `useModel` is the memo boundary — keep mutations immutable or the UI
will silently stop updating (or recompute on every render).

### `engine/` is pure and framework-free

No React, no DOM. This is where all cabinet math lives, and it is fully
unit-tested with **golden values** (the original prototype's math was ported
verbatim and pinned). `engine/index.ts` re-exports every module. Pipeline of
modules feeding `compute`:

- `units` — fraction/mm formatting + parsing, and `r3()` (round to 3 decimals).
  **All dimensions are stored in inches**; mm is display-only and never touches
  the math. When computing a geometric value, round with `r3()` to match how
  existing values and the golden tests are written.
- `geometry` — box height (net of toe kick), interior width, carcass depth, face
  height; plus the predicates `isFramed`/`isInset`/`isRailInset`/`isOpenBox`.
- `drawers` — drawer-front height model (budget / even split / per-drawer clamp).
- `parts` — cut-list generation (carcass, fronts, face frame, drawer boxes).
  `genParts(c, s, frame?)` takes an optional `FrameContext`: when a continuous
  run frame owns the face frame, it suppresses the per-cabinet stiles/rails and
  re-keys the inset front WIDTH off the bay's run opening.
- `runs` / `runParts` — the **run model** (see below).
- `hardware`, `packing` (first-fit-decreasing sheet nesting), `cost`, `steps`,
  `labels`.

When adding engine math: write the function pure, export it from its module, and
add a golden-value test next to it (`*.test.ts` colocated in `src/engine/`).

### Runs — the unit that owns shared structure

Cabinets are independent boxes, but a real kitchen joins contiguous ones into a
**run** that shares ONE continuous face frame (shared stiles at every joint,
rails per bay) and ONE toe-kick base. A run is **derived, never stored**:
`runs.ts:runsOf(cabinets, s)` walks each lane (base/tall vs wall) in array order
— mirroring the renderers' `bx += c.width` — and breaks at a `Cabinet.runBreak`,
or a type/height/depth/construction change. The only persisted hint is the
per-cabinet `runBreak` escape hatch (corner / appliance gap / island), editable
in the cabinet editor.

`compute()` runs a per-cabinet pass then a **run-level pass**: `runParts.ts`
emits the continuous frame (`genRunFrameParts`: `members+1` shared stiles, a
per-bay bottom rail that grows down to `faceFrameFloorGap` over a toe kick) and
the separate base (`genBaseParts`: a ply ladder + recessed fascia + side returns
per contiguous toe-kicked segment). Both feed the SAME accumulators via an
extracted `ingestPart()` and appear as synthetic `"Run"` cut groups. Toggled by
`settings.continuousFaceFrame` / `separateBase` (both default ON; the geometry
`boxHeight` is unchanged so drawer budgets don't move). The 3D (`CabinetScene`)
and 2D (`Elevation`/`cabFace`) renderers re-derive the same run grouping so the
shared half-stiles and side-recessed base line up with the cut list.

### Two orthogonal cabinet axes

`construction` (`frameless` | `framed`) and `overlay` / front-fit (`full` |
`inset_rail` | `inset`) are **independent** — all four+ combinations must work.
Don't conflate them. Anything that changes the drawer-stack budget (construction,
overlay, frontStyle, drawerCount) must recompute `drawerHeights` via
`defaultHeights`/`evenHeights` — see the corresponding actions in `store.ts`,
which already do this.

### Persistence & migration

`state/persistence.ts` is the only place that touches `localStorage`
(`STORAGE_KEY = "framecess.project.v1"`) and JSON import/export. `migrateProject`
/ `migrateSettings` **forward-merge** any older or partial blob onto current
defaults, so older saved projects keep working. Consequence: when you add a field
to `Settings` or `Stock`, add it to `DEFAULT_SETTINGS`/`DEFAULT_STOCKS` in
`domain/defaults.ts` and the migration picks it up for free — but a new field on
`Cabinet` needs an explicit line in `migrateCabinet`. Bump `SCHEMA_VERSION` in
`domain/types.ts` for breaking changes.

### Materials model

`Stock` is a physical material; `Role` (carcass/back/front/drawerBox/…) maps to a
`StockId` via `settings.roleStock`. Parts sharing a stock nest together; `linear`
stock (hardwood face frame) is priced by the foot and never nested into sheets.

### UI specifics

- Six views (`layout`, `cutlist`, `sheets`, `build`, `3d`, `settings`) switch on
  `store.view` in `App.tsx`; the active tab is mirrored to the URL hash and is
  deep-linkable.
- The 3D view (`three/CabinetScene.ts`, `views/ThreeView.tsx`) is `lazy`-loaded so
  Three.js stays out of the initial bundle. Keep it that way.
- The build walkthrough's per-step 3D (`views/BuildStepScene.tsx`) reuses the same
  `CabinetScene` via its **build-focus** mode: `setBuildFocus` renders ONE cabinet
  staged for the current step — earlier stages solid, the current stage glowing,
  later stages ghosted (plus a cutaway that reveals drawer boxes/shelves). The
  staged geometry is a pure, unit-tested generator (`three/buildModel.ts`,
  `cabinetBuildParts`) keyed by the `BuildStage` that `engine/steps.ts` now tags
  onto every step. `BuildStepScene` is `lazy`-loaded too **and** gated behind a
  `mounted` flag in `BuildView`, so the node smoke test never instantiates a WebGL
  canvas. Built/ghost is decided by the set of stages actually reached in the
  cabinet's step list (not a global stage order) — an appliance surround is framed
  *before* it is stood in place, so `faceFrame` can precede `base`.
  Step order follows real assembly: all **interior** work (`drawers` boxes,
  `shelves` — the stages that auto-enable the cutaway) happens first, then the
  **faces** go on last (`doors` → `drawerFronts` → `pulls`). Keeping faces after
  the cutaway stages means a hung door is never hidden again, the drawer face gets
  its own visible "attach the front" beat, and the walkthrough ends on the
  finished box. Handles all live on the final `pulls` stage regardless of which
  face they sit on.
- Styling is inline via tokens from `theme.ts` — there is no CSS framework.
- Vitest runs in a `node` environment (see `vite.config.ts`), so there is no DOM.
  The render smoke test (`app.smoke.test.tsx`) works around this by
  `renderToString`-ing every non-3D view (server-side) to catch runtime throws the
  type-checker can't — extend it when adding a view.

### Mutation rules live in `domain/ops.ts` (shared by store + MCP)

The business rules that mutate a project — the drawer-stack budget recompute when
construction/overlay/frontStyle/drawerCount/type change, the desk/opening
open-box invariants, the type clamps — are **pure functions in `src/domain/ops.ts`**
(`(cabinets|settings, …args) → fresh value`). `state/store.ts` wraps them with
undo history + autosave; the headless MCP server calls them directly. Keep new
mutation logic here, not inlined in the store, so the UI and an agent can't drift.
`src/engine/audit.ts` is the pure design review (oversize parts, exhausted drawer
budgets, wide doors, mixed toe-kick runs, …) — golden-tested like the rest of the engine.

## Headless: the MCP server (`mcp/`)

`mcp/server.ts` exposes the builder over the [Model Context Protocol](https://modelcontextprotocol.io)
so an agent can design / audit / assist a build. It imports the **pure** engine +
`ops` (never React/DOM), holds one project in a `CabinetSession` (`mcp/session.ts`),
and round-trips it through the same `.cabinets.json` files. Run it with `npm run mcp`
(stdio via `tsx`, so the `@/*` alias resolves from `tsconfig.json` with no build
step); `.mcp.json` registers it for MCP clients. `npm run mcp:smoke` drives the
live server end-to-end. Formatters (`mcp/format.ts`) and the glossary
(`mcp/reference.ts`) turn the model into agent-readable text — they never recompute
domain math, same rule as the views. `mcp/` is in the root `tsconfig.json` include,
so `npm run typecheck`/`build` cover it; vitest also runs `mcp/**/*.test.ts` (the
session autosave suite), while the full stdio round-trip is the `npm run mcp:smoke`
subprocess check. Only JSON-RPC goes to stdout; logs go to stderr.

### Autosave + live preview

Every mutation autosaves the project to disk (`CabinetSession.persist()` writes the
working file — from `CABINETS_FILE` / open / save — plus a mirror to the
`CABINETS_LIVE_FILE`), mirroring the app's localStorage autosave, so `save_project`
is only for save-as/export. When `npm run dev` is running, the **dev-only** Vite
plugin `src/dev/cabinetsLivePlugin.ts` watches the live file and pushes it over the
HMR WebSocket to `src/state/liveSync.ts`, which folds it into the store via
`syncProject` (keeps the current view + selection, pushes undo so a live overwrite is
recoverable). The plugin is `apply:"serve"` and the listener is dynamically imported
behind `import.meta.hot`, so the production build never includes either — the
`.mcp.json` sets `CABINETS_LIVE_FILE=live.cabinets.json` (gitignored) and Vite watches
the same default.

## Domain caveat

Every view repeats it and so should any output: this estimates a cut list and is
**not a guarantee — verify against your own method before cutting.** The
construction assumptions (3/4" frameless box with applied back, 1 1/2" face frame
by the linear foot, reveal/inset behavior, drawer-box sizing, hinge/slide/pin
counts) are documented in `README.md` and are all configurable in Settings.
