/**
 * Session controller for the MCP server.
 *
 * Holds the ONE mutable thing the headless server owns: the current project
 * (plus the file it was opened from / last saved to). It's the Node analogue of
 * the browser's localStorage round-trip — an agent `open`s a `.cabinets.json`,
 * mutates it through the pure ops, and `save`s it back. Everything derived
 * (model, audit) is recomputed on demand from the pure engine, exactly as the
 * app's `useModel` memo does.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { emptyProject, newProject } from "@/domain/defaults";
import { Cabinet, Project, Settings } from "@/domain/types";
import { AuditReport, auditProject } from "@/engine/audit";
import { Model, compute } from "@/engine/compute";
import { migrateProject } from "@/state/persistence";

export class CabinetSession {
  project: Project;
  /** Absolute path this project was opened from / last saved to. */
  lastPath: string | null = null;

  constructor(project?: Project) {
    this.project = project ?? newProject();
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

  /** Replace the cabinet list immutably (stamps updatedAt). */
  setCabinets(cabinets: Cabinet[]): void {
    this.project = { ...this.project, cabinets, updatedAt: Date.now() };
  }

  /** Replace the settings immutably (stamps updatedAt). */
  setSettings(settings: Settings): void {
    this.project = { ...this.project, settings, updatedAt: Date.now() };
  }

  rename(name: string): void {
    this.project = { ...this.project, name, updatedAt: Date.now() };
  }

  /** Resolve a cabinet by id first, then case-insensitive name. */
  resolve(idOrName: string): Cabinet | null {
    const byId = this.project.cabinets.find((c) => c.id === idOrName);
    if (byId) return byId;
    const lc = idOrName.trim().toLowerCase();
    return this.project.cabinets.find((c) => c.name.toLowerCase() === lc) ?? null;
  }

  /** Load + migrate a project from a JSON file, tracking its path. */
  open(path: string): void {
    const abs = resolvePath(path);
    const raw = JSON.parse(readFileSync(abs, "utf8"));
    const project = migrateProject(raw);
    // Validate the derived model BEFORE committing, so a corrupt file throws
    // without poisoning the current session.
    compute(project.cabinets, project.settings);
    this.project = project;
    this.lastPath = abs;
  }

  /** Write the current project to `path` (or the last path). Returns the path. */
  save(path?: string): string {
    const target = path ? resolvePath(path) : this.lastPath;
    if (!target) throw new Error("No path given and this project hasn't been opened or saved yet.");
    writeFileSync(target, JSON.stringify(this.project, null, 2) + "\n");
    this.lastPath = target;
    return target;
  }

  /** Start a fresh project (seeded, or empty). */
  loadNew(name?: string, empty = false): void {
    this.project = empty ? emptyProject(name) : newProject(name);
    this.lastPath = null;
  }
}
