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
- `hardware`, `packing` (first-fit-decreasing sheet nesting), `cost`, `steps`,
  `labels`.

When adding engine math: write the function pure, export it from its module, and
add a golden-value test next to it (`*.test.ts` colocated in `src/engine/`).

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
- Styling is inline via tokens from `theme.ts` — there is no CSS framework.
- Vitest runs in a `node` environment (see `vite.config.ts`), so there is no DOM.
  The render smoke test (`app.smoke.test.tsx`) works around this by
  `renderToString`-ing every non-3D view (server-side) to catch runtime throws the
  type-checker can't — extend it when adding a view.

## Domain caveat

Every view repeats it and so should any output: this estimates a cut list and is
**not a guarantee — verify against your own method before cutting.** The
construction assumptions (3/4" frameless box with applied back, 1 1/2" face frame
by the linear foot, reveal/inset behavior, drawer-box sizing, hinge/slide/pin
counts) are documented in `README.md` and are all configurable in Settings.
