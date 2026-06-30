import { create } from "zustand";
import {
  defaultCabinet,
  newProject,
  nextId,
} from "@/domain/defaults";
import {
  Cabinet,
  CabinetType,
  Construction,
  FrontStyle,
  HardwarePricing,
  Overlay,
  Project,
  Role,
  Settings,
  Stock,
  StockId,
} from "@/domain/types";
import { defaultHeights, evenHeights, withDrawerHeight } from "@/engine/drawers";
import {
  loadBuildProgress,
  loadProject,
  saveBuildProgress,
  saveProject,
} from "./persistence";

export type ViewId = "layout" | "cutlist" | "sheets" | "build" | "3d" | "settings";

/** Build view shows either the full step list or a focused, one-step walkthrough. */
export type BuildMode = "overview" | "guided";

/** Stable key for one assembly step: cabinet id + its 1-based step number. */
export function stepKey(cabinetId: string, n: number): string {
  return `${cabinetId}:${n}`;
}

const HISTORY_LIMIT = 60;
const BASE_ONLY_FRONTS: FrontStyle[] = ["drawers", "door_drawer", "desk"];

interface AppState {
  project: Project;
  view: ViewId;
  selectedId: string | null;
  dragId: string | null;
  showFronts: boolean;
  /** 3D only: tint each cabinet's fronts its legend colour (off = uniform wood). */
  tintCabinets: boolean;
  /** Free-form text drafts for number fields (committed on blur/Enter). */
  drafts: Record<string, string>;
  past: Project[];
  future: Project[];
  toast: string | null;

  /* build walkthrough (interaction state — never feeds compute) */
  buildMode: BuildMode;
  /** Steps the user has ticked off, keyed by stepKey(cabinetId, n). */
  buildDone: Record<string, boolean>;
  /** Position in the flattened step sequence while in guided mode. */
  buildCursor: number;

  /* selectors */
  cabinets: () => Cabinet[];
  settings: () => Settings;
  selected: () => Cabinet | null;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /* ui / navigation */
  setView: (v: ViewId) => void;
  selectCab: (id: string | null) => void;
  beginDrag: (id: string) => void;
  endDrag: () => void;
  setShowFronts: (v: boolean) => void;
  setTintCabinets: (v: boolean) => void;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  setToast: (msg: string | null) => void;

  /* build walkthrough */
  setBuildMode: (mode: BuildMode) => void;
  setBuildCursor: (i: number) => void;
  setStepDone: (key: string, done: boolean) => void;
  toggleStepDone: (key: string) => void;
  resetBuildProgress: () => void;

  /* project lifecycle */
  resetProject: () => void;
  loadProjectObj: (p: Project) => void;
  renameProject: (name: string) => void;
  undo: () => void;
  redo: () => void;

  /* cabinet mutations */
  updateCab: (id: string, patch: Partial<Cabinet>) => void;
  addCab: (type: CabinetType) => void;
  removeCab: (id: string) => void;
  duplicateCab: (id: string) => void;
  reorderBand: (band: "base" | "wall", orderedIds: string[], history?: boolean) => void;
  setCabinetType: (id: string, type: CabinetType) => void;
  setFrontStyle: (id: string, style: FrontStyle) => void;
  setOverlay: (id: string, overlay: Overlay) => void;
  setConstruction: (id: string, c: Construction) => void;
  setDrawerCount: (id: string, n: number) => void;
  resetDrawerHeights: (id: string) => void;
  setDrawerHeightAt: (id: string, i: number, value: number) => void;
  setConstructionAll: (mode: Construction) => void;
  setOverlayAll: (mode: Overlay) => void;
  setRunBreak: (id: string, on: boolean) => void;

  /* settings mutations */
  updateSettings: (patch: Partial<Settings>) => void;
  updateStock: (id: StockId, patch: Partial<Stock>) => void;
  setRoleStock: (role: Role, stockId: StockId) => void;
  updateHardware: (patch: Partial<HardwarePricing>) => void;
}

function bandOf(c: Cabinet): "base" | "wall" {
  return c.type === "wall" ? "wall" : "base";
}

const ALL_VIEWS: ViewId[] = ["layout", "cutlist", "sheets", "build", "3d", "settings"];

/** Initial view comes from the URL hash (#cutlist …) so tabs are deep-linkable. */
function initialView(): ViewId {
  if (typeof window === "undefined") return "layout";
  const h = window.location.hash.replace("#", "") as ViewId;
  return ALL_VIEWS.includes(h) ? h : "layout";
}

export const useStore = create<AppState>((set, get) => {
  /** Apply a new project; optionally record undo history + autosave. */
  function apply(next: Project, history = true) {
    next.updatedAt = Date.now();
    set((s) => {
      const base = {
        project: next,
        past: history ? [...s.past, s.project].slice(-HISTORY_LIMIT) : s.past,
        future: history ? [] : s.future,
      };
      return base;
    });
    saveProject(get().project);
  }

  /** Persist the current walkthrough progress under the active project's id. */
  function persistBuild(done: Record<string, boolean>) {
    const p = get().project;
    // The seed project gets a fresh random id every load until it is saved, so
    // pin it down now — otherwise progress keyed by id can't match on reload.
    saveProject(p);
    saveBuildProgress(p.id, done);
  }

  /** Mutate the cabinets list immutably. */
  function withCabinets(fn: (cabs: Cabinet[]) => Cabinet[], history = true) {
    const p = get().project;
    apply({ ...p, cabinets: fn(p.cabinets) }, history);
  }

  function patchCab(id: string, patch: Partial<Cabinet>) {
    withCabinets((cabs) => cabs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  const initialProject = loadProject();

  return {
    project: initialProject,
    view: initialView(),
    selectedId: null,
    dragId: null,
    showFronts: true,
    tintCabinets: false,
    drafts: {},
    past: [],
    future: [],
    toast: null,

    buildMode: "overview",
    buildDone: loadBuildProgress(initialProject.id),
    buildCursor: 0,

    cabinets: () => get().project.cabinets,
    settings: () => get().project.settings,
    selected: () => {
      const { project, selectedId } = get();
      return project.cabinets.find((c) => c.id === selectedId) ?? null;
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    setView: (v) => set({ view: v }),
    selectCab: (id) => set({ selectedId: id }),
    beginDrag: (id) => {
      // snapshot once so the whole drag is a single undo step
      const p = get().project;
      set((s) => ({
        dragId: id,
        selectedId: id,
        past: [...s.past, p].slice(-HISTORY_LIMIT),
        future: [],
      }));
    },
    endDrag: () => set({ dragId: null }),
    setShowFronts: (v) => set({ showFronts: v }),
    setTintCabinets: (v) => set({ tintCabinets: v }),
    setDraft: (key, value) =>
      set((s) => ({ drafts: { ...s.drafts, [key]: value } })),
    clearDraft: (key) =>
      set((s) => {
        const d = { ...s.drafts };
        delete d[key];
        return { drafts: d };
      }),
    setToast: (msg) => set({ toast: msg }),

    setBuildMode: (mode) => set({ buildMode: mode }),
    setBuildCursor: (i) => set({ buildCursor: Math.max(0, i) }),
    setStepDone: (key, done) =>
      set((s) => {
        if (!!s.buildDone[key] === done) return s;
        const next = { ...s.buildDone };
        if (done) next[key] = true;
        else delete next[key];
        persistBuild(next);
        return { buildDone: next };
      }),
    toggleStepDone: (key) =>
      set((s) => {
        const next = { ...s.buildDone };
        if (next[key]) delete next[key];
        else next[key] = true;
        persistBuild(next);
        return { buildDone: next };
      }),
    resetBuildProgress: () =>
      set(() => {
        persistBuild({});
        return { buildDone: {}, buildCursor: 0 };
      }),

    resetProject: () => {
      const p = newProject();
      apply(p);
      saveBuildProgress(p.id, {});
      set({
        selectedId: p.cabinets[0]?.id ?? null,
        view: "layout",
        drafts: {},
        buildDone: {},
        buildCursor: 0,
        buildMode: "overview",
      });
    },
    loadProjectObj: (p) => {
      apply(p);
      set({
        selectedId: p.cabinets[0]?.id ?? null,
        view: "layout",
        drafts: {},
        buildDone: loadBuildProgress(p.id),
        buildCursor: 0,
        buildMode: "overview",
      });
    },
    renameProject: (name) => apply({ ...get().project, name }, false),

    undo: () =>
      set((s) => {
        if (!s.past.length) return s;
        const prev = s.past[s.past.length - 1];
        const next = { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future] };
        saveProject(prev);
        return next;
      }),
    redo: () =>
      set((s) => {
        if (!s.future.length) return s;
        const nextProj = s.future[0];
        const next = { project: nextProj, past: [...s.past, s.project], future: s.future.slice(1) };
        saveProject(nextProj);
        return next;
      }),

    updateCab: (id, patch) => patchCab(id, patch),

    addCab: (type) => {
      const prefix = type === "wall" ? "W" : type === "tall" ? "T" : "B";
      const n = get().project.cabinets.filter((c) => c.type === type).length + 1;
      const cab: Cabinet = { id: nextId(), name: prefix + n, ...defaultCabinet(type) };
      withCabinets((cabs) => [...cabs, cab]);
      set({ selectedId: cab.id });
    },

    removeCab: (id) => {
      const remaining = get().project.cabinets.filter((c) => c.id !== id);
      withCabinets(() => remaining);
      if (get().selectedId === id)
        set({ selectedId: remaining[0]?.id ?? null });
    },

    duplicateCab: (id) => {
      const src = get().project.cabinets.find((c) => c.id === id);
      if (!src) return;
      const prefix = src.type === "wall" ? "W" : src.type === "tall" ? "T" : "B";
      const n = get().project.cabinets.filter((c) => c.type === src.type).length + 1;
      const copy: Cabinet = { ...src, id: nextId(), name: prefix + n };
      withCabinets((cabs) => {
        const i = cabs.findIndex((c) => c.id === id);
        const arr = cabs.slice();
        arr.splice(i + 1, 0, copy);
        return arr;
      });
      set({ selectedId: copy.id });
    },

    reorderBand: (band, orderedIds, history = false) => {
      withCabinets((cabs) => {
        let k = 0;
        return cabs.map((c) => (bandOf(c) === band ? byId(cabs, orderedIds[k++]) : c));
      }, history);
    },

    setCabinetType: (id, type) => {
      const sel = get().project.cabinets.find((c) => c.id === id);
      if (!sel) return;
      const patch: Partial<Cabinet> = { type };
      if (type !== "base" && BASE_ONLY_FRONTS.includes(sel.frontStyle))
        patch.frontStyle = "doors";
      if (type === "wall" && sel.depth >= 18) patch.depth = 12;
      if (type === "tall" && sel.height < 60) patch.height = 84;
      patchCab(id, patch);
    },

    setFrontStyle: (id, style) => {
      const sel = get().project.cabinets.find((c) => c.id === id);
      if (!sel) return;
      const patch: Partial<Cabinet> = { frontStyle: style };
      if (style === "desk") {
        patch.toeKick = false;
        patch.shelves = 0;
        if (sel.drawerCount < 1) patch.drawerCount = 1;
      }
      if (style === "opening") {
        patch.toeKick = false;
        patch.shelves = 0;
      }
      const tmp = { ...sel, ...patch };
      patch.drawerHeights = defaultHeights(tmp, get().project.settings);
      patchCab(id, patch);
    },

    setOverlay: (id, overlay) => {
      const sel = get().project.cabinets.find((c) => c.id === id);
      if (!sel) return;
      // Budget changes with overlay; reset drawer heights to a fresh even split.
      const tmp = { ...sel, overlay };
      patchCab(id, { overlay, drawerHeights: defaultHeights(tmp, get().project.settings) });
    },

    setConstruction: (id, c) => {
      const sel = get().project.cabinets.find((x) => x.id === id);
      if (!sel) return;
      const tmp = { ...sel, construction: c };
      patchCab(id, { construction: c, drawerHeights: defaultHeights(tmp, get().project.settings) });
    },

    setDrawerCount: (id, n) => {
      const sel = get().project.cabinets.find((c) => c.id === id);
      if (!sel) return;
      patchCab(id, {
        drawerCount: n,
        drawerHeights: evenHeights(sel, n, get().project.settings),
      });
    },

    resetDrawerHeights: (id) => {
      const sel = get().project.cabinets.find((c) => c.id === id);
      if (!sel) return;
      patchCab(id, { drawerHeights: defaultHeights(sel, get().project.settings) });
    },

    setDrawerHeightAt: (id, i, value) => {
      const sel = get().project.cabinets.find((c) => c.id === id);
      if (!sel) return;
      patchCab(id, {
        drawerHeights: withDrawerHeight(sel, get().project.settings, i, value),
      });
    },

    setRunBreak: (id, on) =>
      patchCab(id, on ? { runBreak: true } : { runBreak: undefined }),

    setConstructionAll: (mode) =>
      withCabinets((cabs) =>
        cabs.map((c) => {
          const next = { ...c, construction: mode };
          return { ...next, drawerHeights: defaultHeights(next, get().project.settings) };
        }),
      ),

    setOverlayAll: (mode) =>
      withCabinets((cabs) =>
        cabs.map((c) => {
          const next = { ...c, overlay: mode };
          return { ...next, drawerHeights: defaultHeights(next, get().project.settings) };
        }),
      ),

    updateSettings: (patch) =>
      apply({ ...get().project, settings: { ...get().project.settings, ...patch } }),

    updateStock: (id, patch) => {
      const s = get().project.settings;
      apply({
        ...get().project,
        settings: {
          ...s,
          stocks: { ...s.stocks, [id]: { ...s.stocks[id], ...patch } },
        },
      });
    },

    setRoleStock: (role, stockId) => {
      const s = get().project.settings;
      apply({
        ...get().project,
        settings: { ...s, roleStock: { ...s.roleStock, [role]: stockId } },
      });
    },

    updateHardware: (patch) => {
      const s = get().project.settings;
      apply({
        ...get().project,
        settings: { ...s, hardware: { ...s.hardware, ...patch } },
      });
    },
  };
});

function byId(cabs: Cabinet[], id: string): Cabinet {
  const c = cabs.find((x) => x.id === id);
  if (!c) throw new Error("reorder: missing cabinet " + id);
  return c;
}

/** Initialize selection to the first cabinet on first load. */
const initial = useStore.getState();
if (!initial.selectedId && initial.project.cabinets.length) {
  useStore.setState({ selectedId: initial.project.cabinets[0].id });
}
