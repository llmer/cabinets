import {
  DEFAULT_ROLE_STOCK,
  DEFAULT_SETTINGS,
  DEFAULT_STOCKS,
  newProject,
} from "@/domain/defaults";
import { Cabinet, Project, SCHEMA_VERSION, Settings } from "@/domain/types";

const STORAGE_KEY = "framecess.project.v1";

/**
 * Merge a possibly-old/partial settings blob onto the current defaults so that
 * projects saved by earlier versions pick up new fields without breaking.
 */
function migrateSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.stocks = { ...DEFAULT_STOCKS, ...(raw?.stocks || {}) };
  s.roleStock = { ...DEFAULT_ROLE_STOCK, ...(raw?.roleStock || {}) };
  s.hardware = { ...DEFAULT_SETTINGS.hardware, ...(raw?.hardware || {}) };
  return s;
}

function migrateCabinet(raw: Partial<Cabinet>): Cabinet {
  return {
    id: raw.id ?? "c" + Math.random().toString(36).slice(2),
    name: raw.name ?? "?",
    type: raw.type ?? "base",
    width: Number(raw.width) || 24,
    height: Number(raw.height) || 30,
    depth: Number(raw.depth) || 24,
    frontStyle: raw.frontStyle ?? "doors",
    doorCount: Number(raw.doorCount) || 1,
    drawerCount: Number(raw.drawerCount) || 1,
    shelves: raw.shelves == null ? 0 : Number(raw.shelves),
    toeKick: raw.toeKick !== false,
    construction: raw.construction === "framed" ? "framed" : "frameless",
    ...(Array.isArray(raw.drawerHeights) ? { drawerHeights: raw.drawerHeights } : {}),
  };
}

/** Validate + migrate an arbitrary parsed object into a Project. Throws on garbage. */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") throw new Error("Not a project file.");
  const obj = raw as Partial<Project>;
  if (!Array.isArray(obj.cabinets)) throw new Error("Missing cabinets array.");
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: obj.id ?? "p" + now.toString(36),
    name: obj.name ?? "Imported kitchen",
    createdAt: obj.createdAt ?? now,
    updatedAt: now,
    cabinets: obj.cabinets.map(migrateCabinet),
    settings: migrateSettings(obj.settings),
  };
}

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return newProject();
    return migrateProject(JSON.parse(raw));
  } catch {
    return newProject();
  }
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    /* storage full or unavailable — fail silently, app stays usable */
  }
}

export function clearStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Trigger a browser download of the project as a .json file. */
export function exportProjectFile(project: Project): void {
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "kitchen";
  a.href = url;
  a.download = `${safe}.cabinets.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a user-selected file and parse it into a Project. */
export function importProjectFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(migrateProject(JSON.parse(String(reader.result))));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Could not read file."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
}

/** Generic CSV/text download helper used by the cut-list & shopping exports. */
export function downloadText(filename: string, text: string, mime = "text/csv"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
