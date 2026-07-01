import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newProject } from "@/domain/defaults";
import * as ops from "@/domain/ops";
import { Project } from "@/domain/types";
import { CabinetSession } from "./session.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cab-session-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const readProject = (p: string): Project => JSON.parse(readFileSync(p, "utf8"));

describe("CabinetSession autosave", () => {
  it("autosaves to the working file on every mutation", () => {
    const wp = join(dir, "work.cabinets.json");
    const s = new CabinetSession({ workingPath: wp });
    expect(existsSync(wp)).toBe(false); // not written until a change
    const before = s.cabinets.length;
    s.setCabinets(ops.addCabinet(s.cabinets, s.settings, "base").cabinets);
    expect(existsSync(wp)).toBe(true);
    expect(readProject(wp).cabinets.length).toBe(before + 1);
  });

  it("mirrors to the live file (distinct from the working file)", () => {
    const wp = join(dir, "work.json");
    const live = join(dir, "live.json");
    const s = new CabinetSession({ workingPath: wp, liveFile: live });
    s.rename("Kitchen A");
    expect(readProject(wp).name).toBe("Kitchen A");
    expect(readProject(live).name).toBe("Kitchen A");
    expect(s.persistenceNote()).toContain("live");
  });

  it("only writes the live file when working == live (no double write)", () => {
    const live = join(dir, "same.json");
    const s = new CabinetSession({ workingPath: live, liveFile: live });
    s.setSettings(ops.updateSettings(s.settings, { reveal: 0.0625 }));
    expect(readProject(live).settings.reveal).toBe(0.0625);
  });

  it("open() streams to live but does NOT rewrite the source until an edit", () => {
    const src = join(dir, "src.cabinets.json");
    const live = join(dir, "live.json");
    writeFileSync(src, JSON.stringify(newProject("Opened"), null, 2));
    const srcBefore = readFileSync(src, "utf8");
    const s = new CabinetSession({ liveFile: live });
    s.open(src);
    expect(s.workingPath).toBe(src);
    expect(readFileSync(src, "utf8")).toBe(srcBefore); // opening is read-only for the source
    expect(readProject(live).name).toBe("Opened"); // but streamed live immediately
    s.rename("Edited");
    expect(readProject(src).name).toBe("Edited"); // the first edit persists to the opened file
  });

  it("save(path) is a save-as that retargets autosave", () => {
    const s = new CabinetSession();
    expect(s.autosaving).toBe(false);
    const dest = join(dir, "export.cabinets.json");
    s.save(dest);
    expect(s.workingPath).toBe(dest);
    s.rename("After save");
    expect(readProject(dest).name).toBe("After save");
  });

  it("save() with no path and no target throws", () => {
    const s = new CabinetSession();
    expect(() => s.save()).toThrow();
  });

  it("autosave failures are swallowed (a mutation never throws on write error)", () => {
    // A path whose parent directory doesn't exist → writeFileSync throws internally.
    const bad = join(dir, "nope", "deep", "x.json");
    const s = new CabinetSession({ workingPath: bad });
    expect(() => s.setCabinets(ops.addCabinet(s.cabinets, s.settings, "base").cabinets)).not.toThrow();
    expect(existsSync(bad)).toBe(false);
  });

  it("with no files, reports in-memory only", () => {
    const s = new CabinetSession();
    expect(s.persistenceNote()).toMatch(/in memory/i);
  });

  it("new_project (loadNew) does NOT clobber the opened working file", () => {
    const src = join(dir, "keep.cabinets.json");
    writeFileSync(src, JSON.stringify(newProject("Keep"), null, 2));
    const s = new CabinetSession();
    s.open(src);
    s.rename("Kept edit");
    expect(readProject(src).name).toBe("Kept edit");
    s.loadNew("Fresh");
    expect(s.workingPath).toBeNull(); // no longer autosaving to the old file
    expect(readProject(src).name).toBe("Kept edit"); // the old file is untouched
    expect(s.project.name).toBe("Fresh");
  });

  it("resumes an existing working file on construction instead of overwriting it", () => {
    const wp = join(dir, "resume.cabinets.json");
    writeFileSync(wp, JSON.stringify(newProject("Resumed"), null, 2));
    const s = new CabinetSession({ workingPath: wp });
    expect(s.project.name).toBe("Resumed"); // loaded, not a fresh seed
  });

  it("surfaces an autosave write failure in persistenceNote", () => {
    const bad = join(dir, "missing", "x.cabinets.json");
    const s = new CabinetSession({ workingPath: bad });
    s.setCabinets(ops.addCabinet(s.cabinets, s.settings, "base").cabinets);
    expect(s.persistenceNote()).toMatch(/FAILED/);
  });

  it("reports live-preview-only when there is a live file but no working file", () => {
    const s = new CabinetSession({ liveFile: join(dir, "live.cabinets.json") });
    expect(s.persistenceNote()).toMatch(/live preview only/i);
  });

  it("rejects non-.json paths (open, save, and env working file)", () => {
    const s = new CabinetSession();
    expect(() => s.save(join(dir, "notes.txt"))).toThrow(/\.json/);
    expect(() => s.open(join(dir, "notes.txt"))).toThrow(/\.json/);
    expect(() => new CabinetSession({ workingPath: join(dir, "x.txt") })).toThrow(/\.json/);
  });
});
