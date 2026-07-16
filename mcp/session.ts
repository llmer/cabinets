/**
 * Session controller for the MCP server.
 *
 * Holds the ONE mutable thing the headless server owns: the current project.
 * It's the Node analogue of the browser's localStorage round-trip — but where
 * the browser autosaves to localStorage on every change, this autosaves to a
 * FILE on every change, so an agent's edits persist implicitly (no explicit
 * "save" step) and can stream to a running dev server.
 *
 * Two write targets, both optional:
 *  - `workingPath` — the project's own file (what open/save track). Autosaved.
 *  - `liveFile`    — a dev preview file the Vite plugin watches; mirrored on
 *                    every change so the browser reflects the agent live,
 *                    whatever file is open. Set via the CABINETS_LIVE_FILE env.
 * Everything derived (model, audit) is recomputed on demand from the pure engine.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { emptyProject, newProject } from "@/domain/defaults";
import { Cabinet, Project, Settings } from "@/domain/types";
import { AuditReport, auditProject } from "@/engine/audit";
import { Model, compute } from "@/engine/compute";
import { migrateProject } from "@/state/persistence";

export interface SessionOptions {
  /** Default autosave target (e.g. the CABINETS_FILE env). Resumed on boot if it exists. */
  workingPath?: string | null;
  /** Dev live-preview file mirrored on every change (the CABINETS_LIVE_FILE env). */
  liveFile?: string | null;
}

/** Resolve a path and require a `.json` extension — a cheap guard so a stray
 * agent-supplied path can't clobber source files or arbitrary non-JSON targets. */
export function safeJsonPath(p: string): string {
  const abs = resolvePath(p);
  if (!/\.json$/i.test(abs)) throw new Error(`Path must be a .json file: ${p}`);
  return abs;
}

export class CabinetSession {
  project: Project;
  /** Absolute path the project autosaves to (open/save track this), or null. */
  workingPath: string | null;
  /** Absolute dev live-preview path, mirrored on every change (or null). */
  readonly liveFile: string | null;
  /** Message from the last failed autosave write (cleared on success). */
  private lastError: string | null = null;

  constructor(opts: SessionOptions = {}, project?: Project) {
    this.workingPath = opts.workingPath ? safeJsonPath(opts.workingPath) : null;
    this.liveFile = opts.liveFile ? safeJsonPath(opts.liveFile) : null;
    // Resume an existing working file (CABINETS_FILE) rather than overwriting it
    // on the first edit; a corrupt/unreadable one falls back to a fresh project.
    // Deliberately writes nothing here — the browser follows the agent's actual
    // edits, not the session's initial state, so a stale live file is left alone.
    if (!project && this.workingPath && existsSync(this.workingPath)) {
      try {
        const p = migrateProject(JSON.parse(readFileSync(this.workingPath, "utf8")));
        compute(p.cabinets, p.settings);
        this.project = p;
      } catch (e) {
        console.error(`could not resume ${this.workingPath}:`, (e as Error).message);
        this.project = newProject();
      }
    } else {
      this.project = project ?? newProject();
    }
  }

  get cabinets(): Cabinet[] {
    return this.project.cabinets;
  }
  get settings(): Settings {
    return this.project.settings;
  }

  /** The derived model — parts, nesting, steps, cost, summary. Recomputed fresh. */
  model(): Model {
    return compute(this.project.cabinets, this.project.settings);
  }

  /** Design audit, reusing a freshly-computed model. */
  audit(): AuditReport {
    return auditProject(this.project.cabinets, this.project.settings, this.model());
  }

  /** True when edits persist to a durable working file (not just the preview). */
  get autosaving(): boolean {
    return this.workingPath != null;
  }

  /** One line describing where edits go — shown after mutations. */
  persistenceNote(): string {
    if (this.workingPath && this.lastError) {
      return `⚠ autosave FAILED → ${baseName(this.workingPath)} (${this.lastError}) — see server log`;
    }
    if (this.workingPath) {
      const live =
        this.liveFile && this.liveFile !== this.workingPath ? ` + ${baseName(this.liveFile)} (live)` : "";
      return `autosaved → ${baseName(this.workingPath)}${live}`;
    }
    if (this.liveFile) {
      return `live preview only → ${baseName(this.liveFile)} — save_project <path.json> to keep this`;
    }
    return "in memory only — save_project <path.json> to persist";
  }

  private writeTo(target: string): void {
    // Write atomically (temp + rename) so a watcher / live reader never sees a
    // torn, half-written JSON. rename on the same filesystem is atomic, and it's
    // exactly the temp-then-rename pattern chokidar's `atomic` handling expects.
    const tmp = `${target}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.project, null, 2) + "\n");
    renameSync(tmp, target);
  }

  /**
   * Best-effort autosave to the working file, then mirror to the live file.
   * Swallows write errors (records them for `persistenceNote`) so a mutation
   * never fails just because a file couldn't be written — but the failure IS
   * surfaced back to the caller, not silently claimed as saved.
   */
  private persist(): void {
    this.lastError = null;
    try {
      if (this.workingPath) this.writeTo(this.workingPath);
    } catch (e) {
      this.lastError = (e as Error).message;
      console.error(`autosave to ${this.workingPath} failed:`, this.lastError);
    }
    this.mirrorLive();
  }

  /** Write ONLY the live preview file (used on open/save so the source file the
   * user just opened isn't silently rewritten until they actually change it). */
  private mirrorLive(): void {
    try {
      if (this.liveFile && this.liveFile !== this.workingPath) this.writeTo(this.liveFile);
    } catch (e) {
      console.error(`live mirror to ${this.liveFile} failed:`, (e as Error).message);
    }
  }

  /** Replace the cabinet list immutably (stamps updatedAt) + autosave. */
  setCabinets(cabinets: Cabinet[]): void {
    this.project = { ...this.project, cabinets, updatedAt: Date.now() };
    this.persist();
  }

  /** Replace the settings immutably (stamps updatedAt) + autosave. */
  setSettings(settings: Settings): void {
    this.project = { ...this.project, settings, updatedAt: Date.now() };
    this.persist();
  }

  rename(name: string): void {
    this.project = { ...this.project, name, updatedAt: Date.now() };
    this.persist();
  }

  /** Resolve a cabinet by id first, then case-insensitive name. */
  resolve(idOrName: string): Cabinet | null {
    const byId = this.project.cabinets.find((c) => c.id === idOrName);
    if (byId) return byId;
    const lc = idOrName.trim().toLowerCase();
    return this.project.cabinets.find((c) => c.name.toLowerCase() === lc) ?? null;
  }

  /** Load + migrate a project from a JSON file; that file becomes the autosave target. */
  open(path: string): void {
    const abs = safeJsonPath(path);
    const raw = JSON.parse(readFileSync(abs, "utf8"));
    const project = migrateProject(raw);
    // Validate the derived model BEFORE committing, so a corrupt file throws
    // without poisoning the current session.
    compute(project.cabinets, project.settings);
    this.project = project;
    this.workingPath = abs;
    this.lastError = null;
    // Stream what we opened to the browser, but do NOT rewrite the source file —
    // opening should be read-only until the first actual edit autosaves it.
    this.mirrorLive();
  }

  /**
   * Explicit save / export. With a path it's a save-as (that file becomes the new
   * autosave target); with none it flushes to the current working file. Unlike
   * autosave, this throws on failure so the caller learns it didn't write.
   */
  save(path?: string): string {
    const target = path ? safeJsonPath(path) : this.workingPath;
    if (!target) throw new Error("No path given and no working file yet — pass a .json path.");
    this.writeTo(target);
    this.workingPath = target;
    this.lastError = null;
    this.mirrorLive(); // working file already written; keep the live mirror in step
    return target;
  }

  /**
   * Start a fresh project (seeded, or empty). It is IN-MEMORY ONLY until an
   * explicit save — `workingPath` is cleared, so this can never clobber a file
   * you had opened. It still streams to the live preview.
   */
  loadNew(name?: string, empty = false): void {
    this.project = empty ? emptyProject(name) : newProject(name);
    this.workingPath = null;
    this.lastError = null;
    this.persist(); // workingPath is null → writes the live mirror only
  }
}

function baseName(p: string): string {
  return p.split("/").pop() || p;
}
