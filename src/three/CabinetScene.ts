import * as THREE from "three";
import { Cabinet, Settings } from "@/domain/types";
import { colorFor, three as T } from "@/theme";
import {
  backThickness,
  boxHeight,
  carcassThickness,
  effectiveFrameWidth,
  insetStackGap,
  isFramed,
  isInset,
  isRailInset,
} from "@/engine/geometry";
import { getDrawerHeights } from "@/engine/drawers";
import { drawerBoxSpecs } from "@/engine/parts";
import { Run, RunMember, runsOf } from "@/engine/runs";
import { BuildStage } from "@/engine/steps";
import { BuildPart, BuildPartKind, buildBaseY, cabinetBuildParts } from "./buildModel";

type ViewPreset = "iso" | "front" | "top";

/** A single neutral maple used for every front when per-cabinet tint is off. */
const UNIFORM_FRONT = "#d9c19a";

/** One cabinet rendered up to a given assembly step, for the build walkthrough. */
interface BuildFocus {
  cabinet: Cabinet;
  /** The current step's stage — its parts glow. */
  stage: BuildStage;
  /** Every stage reached at or before the current step — its parts are solid. */
  revealed: Set<BuildStage>;
  accent: string;
}

/** How a build part is drawn relative to the current step's stage. */
type PartMode = "built" | "current" | "ghost";

interface Orbit {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

/**
 * Three.js renderer for the whole run. Ported from the imported design's 3D
 * code (custom orbit/pan/zoom, box geometry per cabinet). One instance owns a
 * canvas mounted into a container element.
 */
export class CabinetScene {
  private mount: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private group: THREE.Group;
  private orbit: Orbit;
  private raf = 0;
  private ro: ResizeObserver;
  private fitted = false;
  private runDims = { maxX: 90, maxTop: 90, maxD: 24 };

  private edgeMat: THREE.LineBasicMaterial;
  private edgeHi: THREE.LineBasicMaterial;
  private matCarcass: THREE.MeshStandardMaterial;
  private matCarcassIn: THREE.MeshStandardMaterial;
  private matHandle: THREE.MeshStandardMaterial;
  private matGhost: THREE.MeshStandardMaterial;
  private matHighlight: THREE.MeshStandardMaterial;
  private frontMats: Record<string, THREE.MeshStandardMaterial> = {};

  private cabinets: Cabinet[] = [];
  private settings!: Settings;
  private showFronts = true;
  /** Tint each cabinet's fronts its own legend colour (off = one uniform wood). */
  private tintCabinets = false;

  /** When set, the scene renders this single cabinet staged for the build tab. */
  private focus: BuildFocus | null = null;
  private lastFocusId: string | null = null;

  private cleanupFns: Array<() => void> = [];

  constructor(mount: HTMLElement) {
    this.mount = mount;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(T.background);
    // Tight near/far ratio keeps depth-buffer precision high (avoids z-fighting
    // on the carcass joints). The run is ~tens of inches; orbit radius caps at 900.
    this.camera = new THREE.PerspectiveCamera(42, 1.6, 4, 3000);

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.style.display = "block";
    // setSize(..., false) leaves the canvas CSS size unset, so on a HiDPI screen
    // (pixelRatio > 1) the element would lay out at its buffer size — twice the
    // mount — and get clipped to a corner. Pin it to fill the mount instead.
    r.domElement.style.width = "100%";
    r.domElement.style.height = "100%";
    mount.appendChild(r.domElement);

    // lights
    scene.add(new THREE.HemisphereLight(0xfff6e2, 0xb9a888, 0.95));
    const dir = new THREE.DirectionalLight(0xfff2da, 0.85);
    dir.position.set(-120, 200, 160);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    // Bias away shadow acne on the large flat door/drawer faces.
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.4;
    const sc = dir.shadow.camera;
    sc.left = -200;
    sc.right = 200;
    sc.top = 200;
    sc.bottom = -200;
    sc.near = 1;
    sc.far = 900;
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.25);
    dir2.position.set(140, 120, -100);
    scene.add(dir2);

    // floor + grid
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: T.floor, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(2400, 80, T.gridMajor, T.gridMinor);
    grid.position.y = 0.05;
    scene.add(grid);

    // materials
    this.edgeMat = new THREE.LineBasicMaterial({ color: T.edge, transparent: true, opacity: 0.32 });
    // Brighter edge for the part(s) added by the current build step.
    this.edgeHi = new THREE.LineBasicMaterial({ color: 0x5a3310, transparent: true, opacity: 0.6 });
    this.matCarcass = new THREE.MeshStandardMaterial({ color: T.carcass, roughness: 0.82, metalness: 0.02 });
    this.matCarcassIn = new THREE.MeshStandardMaterial({ color: T.carcassInterior, roughness: 0.85 });
    this.matHandle = new THREE.MeshStandardMaterial({ color: T.handle, roughness: 0.5, metalness: 0.4 });
    // Build walkthrough: faint "not yet" ghost + glowing "this step" highlight.
    this.matGhost = new THREE.MeshStandardMaterial({
      color: T.carcass,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      roughness: 1,
    });
    this.matHighlight = new THREE.MeshStandardMaterial({
      color: 0xe6a23c,
      emissive: 0xc9802b,
      emissiveIntensity: 0.55,
      roughness: 0.45,
      metalness: 0.05,
    });

    this.orbit = { theta: 0.72, phi: 1.12, radius: 120, target: new THREE.Vector3() };
    this.group = new THREE.Group();
    scene.add(this.group);

    this.attachControls(r.domElement);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
    this.loop();
  }

  private attachControls(dom: HTMLCanvasElement) {
    let dragging = false;
    let panning = false;
    let lx = 0;
    let ly = 0;
    const onCtx = (e: Event) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      dragging = true;
      panning = e.button === 2 || e.button === 1 || e.shiftKey || e.metaKey;
      lx = e.clientX;
      ly = e.clientY;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = panning ? "move" : "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const o = this.orbit;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      if (panning) {
        const k = o.radius * 0.0016;
        const right = new THREE.Vector3().subVectors(this.camera.position, o.target).cross(this.camera.up).normalize();
        const up = new THREE.Vector3().copy(this.camera.up).normalize();
        o.target.addScaledVector(right, -dx * k);
        o.target.addScaledVector(up, dy * k);
      } else {
        o.theta -= dx * 0.008;
        o.phi -= dy * 0.008;
        o.phi = Math.max(0.12, Math.min(1.52, o.phi));
      }
      lx = e.clientX;
      ly = e.clientY;
    };
    const end = (e: PointerEvent) => {
      dragging = false;
      panning = false;
      dom.style.cursor = "grab";
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = this.orbit;
      o.radius *= Math.exp(e.deltaY * 0.0011);
      o.radius = Math.max(24, Math.min(900, o.radius));
    };
    dom.addEventListener("contextmenu", onCtx);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
    dom.addEventListener("wheel", onWheel, { passive: false });
    this.cleanupFns.push(() => {
      dom.removeEventListener("contextmenu", onCtx);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", end);
      dom.removeEventListener("pointercancel", end);
      dom.removeEventListener("wheel", onWheel);
    });
  }

  private hexMix(a: string, b: string, t: number): number {
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
    return (c[0] << 16) | (c[1] << 8) | c[2];
  }

  private frontMat(accent: string): THREE.MeshStandardMaterial {
    if (!this.frontMats[accent]) {
      this.frontMats[accent] = new THREE.MeshStandardMaterial({ color: this.hexMix(accent, T.frontTint, 0.5), roughness: 0.62, metalness: 0.03 });
    }
    return this.frontMats[accent];
  }

  /**
   * Draw a bay's two face-frame stiles. In a continuous run each shared joint is
   * ONE box centred on the joint, owned by the LEFT bay (it overhangs a
   * half-stile into the next bay, whose left stile is therefore not drawn). That
   * makes the run frame one seamless piece — only the run ends get an end stile.
   */
  private addFrameStiles(
    x0: number,
    x1: number,
    leftY0: number,
    rightY0: number,
    y1: number,
    fz0: number,
    fz1: number,
    fm: THREE.Material,
    ff: number,
    leftEnd: boolean,
    rightEnd: boolean,
    continuous: boolean,
  ) {
    // Left stile: a full end stile at a run start; mid-run it's covered by the
    // previous bay's joint stile, so skip it.
    if (!continuous || leftEnd) this.addBox(x0, x0 + ff, leftY0, y1, fz0, fz1, fm);
    // Right stile: one box centred on a shared joint, else a full end stile —
    // dropped to whichever neighbouring bay reaches lower.
    if (continuous && !rightEnd) this.addBox(x1 - ff / 2, x1 + ff / 2, rightY0, y1, fz0, fz1, fm);
    else this.addBox(x1 - ff, x1, rightY0, y1, fz0, fz1, fm);
  }

  private addBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material) {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 0.01 || h < 0.01 || d < 0.01) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeMat);
    e.position.copy(m.position);
    this.group.add(e);
  }

  private addCabinet3D(c: Cabinet, x0: number, idx: number, ctx?: { run: Run; m: RunMember }) {
    const S = this.settings;
    const matT = carcassThickness(S);
    const backT = backThickness(S);
    const W = c.width;
    const D = c.depth;
    const boxH = boxHeight(c, S);
    const framed = isFramed(c);
    const opening = c.frontStyle === "opening";
    const desk = c.frontStyle === "desk";
    const openBox = opening || desk;
    const yB = c.type === "wall" ? S.upperBottom : c.toeKick !== false && !openBox ? S.toeKick : 0;
    const yT = yB + boxH;
    // Run context: one continuous frame across the joins (shared half-stiles,
    // a bottom that drops to the toe kick) and a shared, side-recessed base.
    const rm = ctx?.m;
    const run = ctx?.run;
    const continuous = !!run && run.framed && S.continuousFaceFrame && framed;
    const cd = openBox ? D : D - backT;
    const x1 = x0 + W;
    const carcass = this.matCarcass;

    // Per-bay frame bottom: a toe-kicked bay stops at the toe-kick line, a
    // floor-standing bay (appliance opening / desk) runs its frame to the floor.
    // A shared joint stile takes the LOWER of the two bays it borders.
    const bayFB = continuous && rm ? rm.frameBottom : yB;
    const ri = run && rm ? run.members.indexOf(rm) : -1;
    const nextFB = ri >= 0 && run && run.members[ri + 1] ? run.members[ri + 1].frameBottom : bayFB;
    const leftStileBot = bayFB;
    const rightStileBot = continuous && rm && !rm.rightEnd ? Math.min(bayFB, nextFB) : bayFB;

    // An exposed end of a face-frame run drops its end panel to the frame
    // bottom, so from the side the panel lines up with the face frame.
    const sideDrop = continuous ? Math.max(0, yB - bayFB) : 0;
    const leftBot = sideDrop > 0 && rm?.leftEnd ? yB - sideDrop : yB;
    const rightBot = sideDrop > 0 && rm?.rightEnd ? yB - sideDrop : yB;
    this.addBox(x0, x0 + matT, leftBot, yT, 0, cd, carcass);
    this.addBox(x1 - matT, x1, rightBot, yT, 0, cd, carcass);
    if (!openBox) this.addBox(x0 + matT, x1 - matT, yB, yB + matT, 0, cd, carcass);
    if (c.type === "base") {
      this.addBox(x0 + matT, x1 - matT, yT - matT, yT, 0, 4, carcass);
      this.addBox(x0 + matT, x1 - matT, yT - matT, yT, cd - 4, cd, carcass);
    } else {
      this.addBox(x0 + matT, x1 - matT, yT - matT, yT, 0, cd, carcass);
    }
    // Back sits between the sides (not full width) so it doesn't share faces
    // with the side panels — eliminates corner z-fighting.
    if (!openBox) this.addBox(x0 + matT, x1 - matT, yB, yT, 0, backT, carcass);
    // Toe-kick base: recessed from the FRONT, and (with a separate base) set in
    // on the exposed END sides of the run too — the box-on-a-base look.
    if (c.type !== "wall" && c.toeKick !== false && !openBox && yB > 0) {
      const lr = S.separateBase && rm?.leftEnd ? S.toeKickSideRecess : 0;
      const rr = S.separateBase && rm?.rightEnd ? S.toeKickSideRecess : 0;
      this.addBox(x0 + lr, x1 - rr, 0, yB, 0, Math.max(matT, D - S.toeKickDepth), carcass);
    }

    const fm = this.frontMat(this.tintCabinets ? colorFor(idx) : UNIFORM_FRONT);
    const fz0 = D - 0.75;
    const fz1 = D;
    // The applied face frame sits a hair PROUD of the carcass and laps slightly
    // behind it, so no frame face is ever coplanar with a carcass face — kills
    // the z-fighting where a stile/rail overlaps a side panel or top stretcher.
    const ffz0 = fz0 - 0.1;
    const ffz1 = fz1 + 0.06;
    const gap = 0.125;

    // Fronts hidden: reveal the interior — adjustable shelves + drawer boxes.
    if (!this.showFronts) {
      if (!openBox && c.shelves > 0) {
        for (let i = 1; i <= c.shelves; i++) {
          const sy = yB + matT + ((boxH - 2 * matT) * i) / (c.shelves + 1);
          this.addBox(x0 + matT, x1 - matT, sy, sy + 0.75, backT, cd - 1, this.matCarcassIn);
        }
      }
      this.addDrawerBoxes3D(c, x0, yT, fz0);
      return;
    }

    // Appliance opening: no front — just the face-frame surround when framed.
    if (opening) {
      if (framed) {
        const ff = S.frameWidth || 1.5;
        const ftop = S.faceFrameTop || 2;
        const ffL = continuous && rm ? (rm.leftEnd ? ff : ff / 2) : ff;
        const ffR = continuous && rm ? (rm.rightEnd ? ff : ff / 2) : ff;
        this.addFrameStiles(x0, x1, leftStileBot, rightStileBot, yT, ffz0, ffz1, fm, ff, !!rm?.leftEnd, !!rm?.rightEnd, continuous);
        this.addBox(x0 + ffL, x1 - ffR, yT - ftop, yT, ffz0, ffz1, fm);
      }
      return;
    }

    const cabCenter = (x0 + x1) / 2;
    const hbar = (xa: number, xb: number, ya: number, yb: number, vertical: boolean) => {
      if (vertical) {
        // door pull on the inner (opening) edge, toward the cabinet centerline
        const hx = (xa + xb) / 2 < cabCenter ? xb - 1.4 : xa + 0.9;
        this.addBox(hx, hx + 0.5, (ya + yb) / 2 - 2.4, (ya + yb) / 2 + 2.4, fz1, fz1 + 0.5, this.matHandle);
      } else {
        const hy = yb - 1.0;
        this.addBox((xa + xb) / 2 - 2.6, (xa + xb) / 2 + 2.6, hy, hy + 0.5, fz1, fz1 + 0.5, this.matHandle);
      }
    };

    if (isInset(c)) {
      // Border around the opening: face-frame stile (framed) or box edge.
      const ff = effectiveFrameWidth(c, S);
      const ftop = framed ? S.faceFrameTop || 2 : ff; // (wider) top rail when framed
      const railGap = insetStackGap(c, S); // mid rail (framed/railed) or reveal
      const hasRails = framed || isRailInset(c);
      const railMat = framed ? fm : this.matCarcass;
      // Shared half-stiles at the joins; each drops to its bay's frame bottom.
      const ffL = continuous && rm ? (rm.leftEnd ? ff : ff / 2) : ff;
      const ffR = continuous && rm ? (rm.rightEnd ? ff : ff / 2) : ff;
      const rl = x0 + ffL;
      const rr = x1 - ffR;
      if (framed) {
        // visible hardwood frame perimeter (one continuous frame across the run:
        // shared joint stiles are single seamless boxes, owned by the left bay),
        // sat proud of the carcass (ffz*) so the overlap never z-fights.
        this.addFrameStiles(x0, x1, leftStileBot, rightStileBot, yT, ffz0, ffz1, fm, ff, !!rm?.leftEnd, !!rm?.rightEnd, continuous);
        this.addBox(rl, rr, yT - ftop, yT, ffz0, ffz1, fm);
        // Bottom rail spans from the lower of (this bay's frame bottom, box
        // bottom) up to the opening — a desk has no bottom rail (open knee).
        if (!desk) this.addBox(rl, rr, Math.min(bayFB, yB), yB + ff, ffz0, ffz1, fm);
      }
      // Inset fronts sit flush with the frame / box face, a hair proud-recessed.
      const iz0 = fz0;
      const iz1 = fz1 - 0.06;
      const ol = x0 + ffL + gap;
      const or = x1 - ffR - gap;
      const drawRail = (yA: number, yB2: number) => {
        if (hasRails) this.addBox(rl, rr, yA, yB2, iz0, iz1, railMat);
      };
      if (c.frontStyle === "doors") {
        const nd = c.doorCount;
        for (let i = 0; i < nd; i++) {
          const a = ol + ((or - ol) * i) / nd + gap / 2;
          const b = ol + ((or - ol) * (i + 1)) / nd - gap / 2;
          this.addBox(a, b, yB + ff + gap, yT - ftop - gap, iz0, iz1, fm);
          hbar(a, b, yB + ff, yT - ftop, true);
        }
      } else {
        const hs = getDrawerHeights(c, S);
        let y = yT - ftop;
        hs.forEach((dh, i) => {
          this.addBox(ol, or, y - dh, y, iz0, iz1, fm);
          hbar(ol, or, y - dh, y, false);
          y -= dh;
          if (i < hs.length - 1) {
            drawRail(y - railGap, y);
            y -= railGap;
          }
        });
        // A framed desk gets a rail under the drawer + a deck panel that closes
        // the drawer cavity off from the open knee below. Draw the rail in the
        // PROUD face-frame plane (ffz*, like the top rail — not the recessed
        // inset plane) so it covers the deck and reads as one flush piece.
        if (desk && framed) {
          this.addBox(rl, rr, y - railGap, y, ffz0, ffz1, fm);
          this.addBox(x0 + matT, x1 - matT, y - railGap, y - railGap + matT, 0, cd, fm);
        }
        if (c.frontStyle === "door_drawer") {
          drawRail(y - railGap, y);
          y -= railGap;
          const nd = c.doorCount;
          const bot = yB + ff;
          for (let i = 0; i < nd; i++) {
            const a = ol + ((or - ol) * i) / nd + gap / 2;
            const b = ol + ((or - ol) * (i + 1)) / nd - gap / 2;
            this.addBox(a, b, bot + gap, y, iz0, iz1, fm);
            hbar(a, b, bot, y, true);
          }
        }
      }
      return;
    }

    // full overlay — fronts proud over the box/frame (frame hidden if framed)
    const ol = x0 + gap;
    const or = x1 - gap;
    const ot = yT - gap;
    const ob = yB + gap;
    if (c.frontStyle === "doors") {
      const nd = c.doorCount;
      for (let i = 0; i < nd; i++) {
        const a = ol + ((or - ol) * i) / nd + gap / 2;
        const b = ol + ((or - ol) * (i + 1)) / nd - gap / 2;
        this.addBox(a, b, ob, ot, fz0, fz1, fm);
        hbar(a, b, ob, ot, true);
      }
    } else if (c.frontStyle === "drawers" || desk) {
      let top = ot;
      const hs = getDrawerHeights(c, S);
      hs.forEach((dh) => {
        this.addBox(ol, or, top - dh + gap / 2, top, fz0, fz1, fm);
        hbar(ol, or, top - dh, top, false);
        top -= dh;
      });
    } else if (c.frontStyle === "door_drawer") {
      const dh = getDrawerHeights(c, S)[0];
      this.addBox(ol, or, ot - dh + gap / 2, ot, fz0, fz1, fm);
      hbar(ol, or, ot - dh, ot, false);
      const nd = c.doorCount;
      const dt = ot - dh - gap;
      for (let i = 0; i < nd; i++) {
        const a = ol + ((or - ol) * i) / nd + gap / 2;
        const b = ol + ((or - ol) * (i + 1)) / nd - gap / 2;
        this.addBox(a, b, ob, dt, fz0, fz1, fm);
        hbar(a, b, ob, dt, true);
      }
    }
  }

  /** Open drawer boxes drawn inside the carcass when fronts are hidden. */
  private addDrawerBoxes3D(c: Cabinet, x0: number, yT: number, fz0: number) {
    const hasDrawers =
      c.frontStyle === "drawers" || c.frontStyle === "desk" || c.frontStyle === "door_drawer";
    if (!hasDrawers) return;
    const S = this.settings;
    const specs = drawerBoxSpecs(c, S);
    if (!specs.length) return;
    const dt = S.stocks[S.roleStock.drawerBox].thickness;
    const bt = S.stocks[S.roleStock.drawerBottom].thickness;
    const inset = isInset(c);
    const ff = inset ? effectiveFrameWidth(c, S) : 0.125;
    const railGap = inset ? insetStackGap(c, S) : 0.125;
    const heights = getDrawerHeights(c, S);
    const W = c.width;
    const m = this.matCarcassIn;
    let top = yT - ff;
    heights.forEach((dh, i) => {
      const sp = specs[i];
      if (!sp) return;
      const slotBottom = top - dh;
      const bx0 = x0 + (W - sp.boxWidth) / 2;
      const bx1 = bx0 + sp.boxWidth;
      const bz1 = fz0 - 0.25;
      const bz0 = Math.max(0.75, bz1 - sp.boxDepth);
      const by0 = slotBottom + 0.25;
      const by1 = Math.max(by0 + 1, Math.min(top - 0.25, by0 + sp.boxHeight));
      this.addBox(bx0, bx0 + dt, by0, by1, bz0, bz1, m); // left side
      this.addBox(bx1 - dt, bx1, by0, by1, bz0, bz1, m); // right side
      this.addBox(bx0, bx1, by0, by1, bz1 - dt, bz1, m); // sub-front
      this.addBox(bx0, bx1, by0, by1, bz0, bz0 + dt, m); // back
      this.addBox(bx0, bx1, by0, by0 + bt, bz0, bz1, m); // bottom
      top = slotBottom - (i < heights.length - 1 ? railGap : 0);
    });
  }

  private rebuild() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.group = new THREE.Group();
    this.scene.add(this.group);

    if (this.focus) {
      this.renderBuild(this.focus);
      return;
    }

    const cabs = this.cabinets;
    // Derive runs so the continuous frame + shared toe-kick base render once,
    // shared across the joins — the same grouping the cut list uses.
    const ctx = new Map<string, { run: Run; m: RunMember }>();
    for (const run of runsOf(cabs, this.settings))
      for (const m of run.members) ctx.set(m.cabinet.id, { run, m });
    let bx = 0;
    cabs.filter((c) => c.type !== "wall").forEach((c) => {
      this.addCabinet3D(c, bx, cabs.indexOf(c), ctx.get(c.id));
      bx += c.width;
    });
    let wx = 0;
    cabs.filter((c) => c.type === "wall").forEach((c) => {
      this.addCabinet3D(c, wx, cabs.indexOf(c), ctx.get(c.id));
      wx += c.width;
    });
    const maxX = Math.max(bx, wx, 30);
    let maxTop = 40;
    cabs.forEach((c) => {
      const t = (c.type === "wall" ? this.settings.upperBottom : 0) + c.height;
      if (t > maxTop) maxTop = t;
    });
    const maxD = Math.max(24, ...cabs.map((c) => c.depth));
    this.runDims = { maxX, maxTop, maxD };
    if (!this.fitted) {
      this.fitView();
      this.fitted = true;
    }
  }

  setData(cabinets: Cabinet[], settings: Settings, showFronts: boolean, tintCabinets = false) {
    this.focus = null;
    this.cabinets = cabinets;
    this.settings = settings;
    this.showFronts = showFronts;
    this.tintCabinets = tintCabinets;
    this.rebuild();
  }

  /**
   * Render ONE cabinet built up to `stage` for the build-tab walkthrough:
   * earlier stages solid, this stage glowing, later stages ghosted. `showFronts`
   * false flips to a cutaway that reveals the drawer boxes / shelves inside.
   */
  setBuildFocus(
    cabinet: Cabinet,
    settings: Settings,
    stage: BuildStage,
    revealedStages: BuildStage[],
    accent: string,
    showFronts: boolean,
  ) {
    this.settings = settings;
    this.showFronts = showFronts;
    this.focus = { cabinet, stage, revealed: new Set(revealedStages), accent };
    this.rebuild();
  }

  /** Build the staged geometry for the focused cabinet. */
  private renderBuild(f: BuildFocus) {
    const parts = cabinetBuildParts(f.cabinet, this.settings);
    for (const p of parts) {
      // Cutaway gate: fronts hide the interior, so show one or the other.
      if (this.showFronts) {
        if (p.kind === "shelf" || p.kind === "drawerBox") continue;
      } else if (p.kind === "front" || p.kind === "handle") {
        continue;
      }
      // The current step's stage glows; stages already reached are solid; stages
      // still ahead are ghosted. Driven by the real step order (handles e.g. an
      // appliance surround whose face frame precedes "stand it in place").
      const mode: PartMode =
        p.stage === f.stage ? "current" : f.revealed.has(p.stage) ? "built" : "ghost";
      this.addBuildPart(p, mode, f.accent);
    }

    // Frame the lone cabinet; only refit when switching to a different box so
    // stepping through stages keeps a steady viewpoint.
    if (this.lastFocusId !== f.cabinet.id) {
      this.focusFit(f.cabinet);
      this.lastFocusId = f.cabinet.id;
    }
  }

  /** Center and frame a single focused cabinet for the build walkthrough. */
  private focusFit(c: Cabinet) {
    const top =
      buildBaseY(c, this.settings) +
      boxHeight(c, this.settings) +
      (c.frontStyle === "desk" ? carcassThickness(this.settings) : 0);
    this.orbit.target.set(c.width / 2, top / 2, c.depth / 2);
    // Fit the box's bounding sphere to the (vertical) FOV, with breathing room.
    this.orbit.radius = Math.hypot(c.width, top, c.depth) * 1.35;
  }

  private materialForKind(kind: BuildPartKind, accent: string): THREE.Material {
    switch (kind) {
      case "front":
      case "frame":
        return this.frontMat(accent);
      case "handle":
        return this.matHandle;
      case "shelf":
      case "drawerBox":
        return this.matCarcassIn;
      default:
        return this.matCarcass; // carcass / back / toeKick
    }
  }

  private addBuildPart(p: BuildPart, mode: PartMode, accent: string) {
    const [x0, x1, y0, y1, z0, z1] = p.box;
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 0.01 || h < 0.01 || d < 0.01) return;
    const mat =
      mode === "current"
        ? this.matHighlight
        : mode === "ghost"
          ? this.matGhost
          : this.materialForKind(p.kind, accent);
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    if (mode !== "ghost") {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(m);
    if (mode !== "ghost") {
      const e = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        mode === "current" ? this.edgeHi : this.edgeMat,
      );
      e.position.copy(m.position);
      this.group.add(e);
    }
  }

  fitView() {
    const d = this.runDims;
    this.orbit.target.set(d.maxX / 2, d.maxTop * 0.46, d.maxD / 2);
    this.orbit.radius = Math.max(d.maxX, d.maxTop, 48) * 1.45;
  }

  setView(preset: ViewPreset) {
    const o = this.orbit;
    if (preset === "iso") {
      o.theta = 0.72;
      o.phi = 1.12;
    } else if (preset === "front") {
      o.theta = 0.0001;
      o.phi = 1.5;
    } else if (preset === "top") {
      o.theta = 0.0001;
      o.phi = 0.18;
    }
  }

  resetView() {
    if (this.focus) this.focusFit(this.focus.cabinet);
    else this.fitView();
    this.setView("iso");
  }

  private resize() {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const o = this.orbit;
    const c = this.camera;
    const sp = Math.sin(o.phi);
    const cp = Math.cos(o.phi);
    c.position.set(
      o.target.x + o.radius * sp * Math.sin(o.theta),
      o.target.y + o.radius * cp,
      o.target.z + o.radius * sp * Math.cos(o.theta),
    );
    c.lookAt(o.target);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanupFns.forEach((fn) => fn());
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}
