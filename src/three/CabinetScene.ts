import * as THREE from "three";
import { Cabinet, Settings, SlideBlockingSpec } from "@/domain/types";
import { colorFor, three as T } from "@/theme";
import {
  backThickness,
  boxHeight,
  carcassThickness,
  effectiveFrameWidth,
  insetStackGap,
  isFramed,
  isInset,
  isOpenBox,
  isRailInset,
  topBorderWidth,
} from "@/engine/geometry";
import { getDrawerHeights } from "@/engine/drawers";
import { drawerBoxSpecs, slideBlockingSpecs } from "@/engine/parts";
import { fmtLen } from "@/engine/units";
import { Run, RunMember, bayFrameContext, membersSharePartition, runsOf } from "@/engine/runs";
import { BuildStage } from "@/engine/steps";
import { BuildEnds, BuildPart, BuildPartKind, buildBaseY, cabinetBuildParts } from "./buildModel";

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
  /** Which sides are exposed run ends (drop to the frame line). Omitted = both. */
  ends?: BuildEnds;
  /** Run-aware slide pack-out (from the cut-list geometry). Omitted = solo. */
  blocking?: SlideBlockingSpec[];
}

/** How a build part is drawn relative to the current step's stage. */
type PartMode = "built" | "current" | "ghost";

/** A completed corner-to-corner measurement, broadcast to the React readout. */
export interface MeasureResult {
  /** Straight-line distance between the two picked corners, in inches. */
  dist: number;
  /** Absolute run-axis / vertical / depth spans between the corners, in inches. */
  dx: number;
  dy: number;
  dz: number;
}

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
  private matPocket: THREE.MeshBasicMaterial;
  private frontMats: Record<string, THREE.MeshStandardMaterial> = {};

  private cabinets: Cabinet[] = [];
  private settings!: Settings;
  private showFronts = true;
  /** Tint each cabinet's fronts its own legend colour (off = one uniform wood). */
  private tintCabinets = false;

  /** When set, the scene renders this single cabinet staged for the build tab. */
  private focus: BuildFocus | null = null;
  private lastFocusId: string | null = null;
  private lastRunKey: string | null = null;

  /** Corner-to-corner measurement overlay (its own group so a model rebuild,
   * which only replaces `group`, leaves an active measurement in place). The
   * meshes are persistent — positioned/toggled per interaction — so live
   * hover-snapping and the rubber band cost no per-frame allocation. */
  private measureMode = false;
  private measurePts: THREE.Vector3[] = [];
  /** The corner currently under the cursor (drives the hover marker + rubber band). */
  private hoverPt: THREE.Vector3 | null = null;
  private measureGroup: THREE.Group;
  private measureLabel: HTMLDivElement;
  private matMeasure: THREE.MeshBasicMaterial;
  private matHover: THREE.MeshBasicMaterial;
  private lineMeasure: THREE.LineBasicMaterial;
  private lineRubber: THREE.LineDashedMaterial;
  private dotA: THREE.Mesh;
  private dotB: THREE.Mesh;
  private hoverMarker: THREE.Mesh;
  private spanLine: THREE.Line;
  private rubberLine: THREE.Line;
  private raycaster = new THREE.Raycaster();
  /** React readout hook, fired with the span on completion (null while pending). */
  onMeasure: ((r: MeasureResult | null) => void) | null = null;

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
    // Pocket-hole decals on the build walkthrough parts (settings.pocketHoles).
    this.matPocket = new THREE.MeshBasicMaterial({ color: T.handle, side: THREE.DoubleSide });

    this.orbit = { theta: 0.72, phi: 1.12, radius: 120, target: new THREE.Vector3() };
    this.group = new THREE.Group();
    scene.add(this.group);

    // Measurement overlay. Everything draws with depthTest off + a high
    // renderOrder so a span behind a door is never occluded. Objects are
    // persistent (positioned/toggled per interaction), so the live hover
    // marker and rubber band are allocation-free on pointer move.
    this.matMeasure = new THREE.MeshBasicMaterial({ color: 0xb05a3c, depthTest: false });
    this.matHover = new THREE.MeshBasicMaterial({ color: 0xc9a06b, depthTest: false, transparent: true, opacity: 0.92 });
    this.lineMeasure = new THREE.LineBasicMaterial({ color: 0xb05a3c, depthTest: false });
    this.lineRubber = new THREE.LineDashedMaterial({ color: 0xb05a3c, depthTest: false, transparent: true, opacity: 0.85, dashSize: 1.3, gapSize: 0.9 });
    this.dotA = this.measureDot(this.matMeasure, 0.5);
    this.dotB = this.measureDot(this.matMeasure, 0.5);
    this.hoverMarker = this.measureDot(this.matHover, 0.66);
    this.hoverMarker.renderOrder = 1000;
    this.spanLine = new THREE.Line(new THREE.BufferGeometry(), this.lineMeasure);
    this.spanLine.renderOrder = 999;
    this.spanLine.visible = false;
    this.rubberLine = new THREE.Line(new THREE.BufferGeometry(), this.lineRubber);
    this.rubberLine.renderOrder = 999;
    this.rubberLine.visible = false;
    this.measureGroup = new THREE.Group();
    this.measureGroup.add(this.dotA, this.dotB, this.hoverMarker, this.spanLine, this.rubberLine);
    scene.add(this.measureGroup);
    this.measureLabel = document.createElement("div");
    Object.assign(this.measureLabel.style, {
      position: "absolute",
      pointerEvents: "none",
      transform: "translate(-50%,-50%)",
      padding: "2px 7px",
      borderRadius: "4px",
      font: "12px 'Geist Mono', monospace",
      background: "rgba(31,20,14,0.92)",
      color: "#F2E7CE",
      border: "1px solid #B05A3C",
      whiteSpace: "nowrap",
      display: "none",
      zIndex: "5",
    } as Partial<CSSStyleDeclaration>);
    mount.appendChild(this.measureLabel);

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
    let downX = 0;
    let downY = 0;
    const onCtx = (e: Event) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      dragging = true;
      panning = e.button === 2 || e.button === 1 || e.shiftKey || e.metaKey;
      lx = e.clientX;
      ly = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = this.measureMode ? "crosshair" : panning ? "move" : "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      // Live corner-snap preview: track the corner under the cursor unless the
      // pointer is mid-drag (orbiting/panning), where a moving marker is noise.
      if (this.measureMode) {
        if (dragging) this.hideHover();
        else this.updateHover(e.clientX, e.clientY);
      }
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
      // A press that barely moved is a click, not an orbit — pick a corner.
      const click = this.measureMode && Math.hypot(e.clientX - downX, e.clientY - downY) < 5;
      dragging = false;
      panning = false;
      dom.style.cursor = this.measureMode ? "crosshair" : "grab";
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (click) this.measurePick(e.clientX, e.clientY);
    };
    const onLeave = () => {
      if (this.measureMode) this.hideHover();
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
    dom.addEventListener("pointerleave", onLeave);
    dom.addEventListener("wheel", onWheel, { passive: false });
    this.cleanupFns.push(() => {
      dom.removeEventListener("contextmenu", onCtx);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", end);
      dom.removeEventListener("pointercancel", end);
      dom.removeEventListener("pointerleave", onLeave);
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
   * Draw a bay's two face-frame stiles, captured between the continuous top and
   * bottom rails (`y1` is the stile top — the underside of the top rail). In a
   * continuous run each shared joint is ONE box centred on the joint, owned by
   * the LEFT bay (it overhangs a half-stile into the next bay, whose left stile
   * is therefore not drawn), so the joint carries one seamless stile — only the
   * run ends get an end stile.
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
    const frameFF = S.frameWidth || 1.5;
    const bayFB = continuous && rm ? rm.frameBottom : yB;
    const ri = run && rm ? run.members.indexOf(rm) : -1;
    // Stiles are captured between the rails: a closed bay's stile rests on its
    // bottom rail (box bottom + a rail width); an open bay (appliance opening /
    // desk) has no bottom rail, so the stile runs to the floor. A shared joint
    // stile takes the LOWER foot of the two bays it borders.
    const footOf = (m: RunMember) => (isOpenBox(m.cabinet) ? m.frameBottom : m.yB + frameFF);
    const thisFoot = openBox ? bayFB : yB + frameFF;
    const rn = ri >= 0 && run ? run.members[ri + 1] : undefined;
    const rightFoot = rn ? footOf(rn) : thisFoot;
    const leftStileBot = thisFoot;
    const rightStileBot = continuous && rm && !rm.rightEnd ? Math.min(thisFoot, rightFoot) : thisFoot;

    // An exposed end of a face-frame run drops its end panel to the frame
    // bottom, so from the side the panel lines up with the face frame.
    const sideDrop = continuous ? Math.max(0, yB - bayFB) : 0;
    const leftBot = sideDrop > 0 && rm?.leftEnd ? yB - sideDrop : yB;
    const rightBot = sideDrop > 0 && rm?.rightEnd ? yB - sideDrop : yB;
    // Shared partitions: adjacent bays that line up carry ONE 3/4" panel at the
    // joint (see membersSharePartition). The left bay owns it — drawn centred so
    // the stile laps both sides; the right bay drops its matching side.
    const prevM = run && ri > 0 ? run.members[ri - 1] : undefined;
    const nextM = run && ri >= 0 ? run.members[ri + 1] : undefined;
    const shareLeft = continuous && !!(rm && prevM && membersSharePartition(prevM, rm, S));
    const shareRight = continuous && !!(rm && nextM && membersSharePartition(rm, nextM, S));
    // Sides run the FULL depth (0..D): the front sits at the front plane (flush
    // with the front stretcher + proud face frame) and the rear stays flush with
    // the inset applied back — no recessed front, no protruding back tongue.
    if (!shareLeft) this.addBox(x0, x0 + matT, leftBot, yT, 0, D, carcass);
    if (shareRight) this.addBox(x1 - matT / 2, x1 + matT / 2, rightBot, yT, 0, D, carcass);
    else this.addBox(x1 - matT, x1, rightBot, yT, 0, D, carcass);
    // Interior panels stop at the shared partition's inner face — half a panel in
    // from the joint wherever a side is shared, else at the bay's own side.
    const iL = x0 + (shareLeft ? matT / 2 : matT);
    const iR = x1 - (shareRight ? matT / 2 : matT);
    if (!openBox) this.addBox(iL, iR, yB, yB + matT, 0, D, carcass);
    if (c.type === "base") {
      this.addBox(iL, iR, yT - matT, yT, 0, 4, carcass);
      this.addBox(iL, iR, yT - matT, yT, D - 4, D, carcass);
    } else {
      this.addBox(iL, iR, yT - matT, yT, 0, D, carcass);
    }
    // Open box (appliance opening / desk knee): a pair of back stretchers on
    // edge (at the back, z≈0) tie the two sides together — one just under the top
    // rear stretcher, one across the back at floor level. There is no back/bottom
    // to keep it square. Mirrors the cut-list stretchers.
    if (openBox && c.type === "base") {
      this.addBox(iL, iR, yT - matT - 4, yT - matT, 0, matT, carcass);
      this.addBox(iL, iR, yB, yB + 4, 0, matT, carcass);
    }
    // Applied back: inset between the sides (not full width) and captured at the
    // rear of the full-depth sides. Its top tucks just UNDER the top back
    // stretcher (a hair's lap, no coplanar seam) so the stretcher owns the
    // top-rear corner and the back reads as inset below it.
    if (!openBox) this.addBox(iL, iR, yB, yT - matT + 0.06, 0, backT, carcass);
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
          this.addBox(iL, iR, sy, sy + 0.75, backT, D - 1, this.matCarcassIn);
        }
      }
      this.addDrawerBoxes3D(c, x0, yT, fz0, ctx);
      return;
    }

    // ONE continuous top rail across a framed run: drawn once, on the first bay,
    // spanning run.x0..run.x1, so the top reads as a single board with no per-bay
    // seams (matches genRunFrameParts). Non-continuous frames draw a bay-width
    // rail in the branches below.
    if (continuous && run && rm?.leftEnd) {
      const ftop = S.faceFrameTop || 2;
      this.addBox(run.x0, run.x1, run.frameTop - ftop, run.frameTop, ffz0, ffz1, fm);
    }

    // Appliance opening: no front — just the face-frame surround when framed.
    if (opening) {
      if (framed) {
        const ff = S.frameWidth || 1.5;
        const ftop = S.faceFrameTop || 2;
        // Top rail is the continuous run board (drawn above); a solo opening draws
        // its own bay-width rail. Stiles are captured beneath it either way.
        if (!continuous) this.addBox(x0, x1, yT - ftop, yT, ffz0, ffz1, fm);
        this.addFrameStiles(x0, x1, leftStileBot, rightStileBot, yT - ftop, ffz0, ffz1, fm, ff, !!rm?.leftEnd, !!rm?.rightEnd, continuous);
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
        // Ladder frame: continuous top + bottom rails run the full bay width
        // (abutting the neighbours into one seamless run) with the stiles
        // captured between them, sat proud of the carcass (ffz*) so the overlap
        // never z-fights. The shared joint stile is one seamless box owned by the
        // left bay; over a toe kick the bottom rail grows down to the frame line.
        // A desk has no bottom rail (open knee).
        // Top rail: the continuous run board (drawn once above) in a run, else a
        // bay-width rail. Bottom rail still per bay (abuts its neighbours).
        if (!continuous) this.addBox(x0, x1, yT - ftop, yT, ffz0, ffz1, fm);
        if (!desk) this.addBox(x0, x1, bayFB, yB + ff, ffz0, ffz1, fm);
        this.addFrameStiles(x0, x1, leftStileBot, rightStileBot, yT - ftop, ffz0, ffz1, fm, ff, !!rm?.leftEnd, !!rm?.rightEnd, continuous);
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
          this.addBox(iL, iR, y - railGap, y - railGap + matT, 0, cd, fm);
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
      // Framed desk under full overlay: the frame hides behind the proud
      // fronts, but the DECK is real — it closes the drawer cavity off from
      // the open knee (the cut list emits it for ANY framed desk).
      if (desk && framed) {
        const rg = S.frameWidth || 1.5;
        this.addBox(iL, iR, top - rg, top - rg + matT, 0, cd, fm);
      }
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
  private addDrawerBoxes3D(
    c: Cabinet,
    x0: number,
    yT: number,
    fz0: number,
    ctx?: { run: Run; m: RunMember },
  ) {
    const hasDrawers =
      c.frontStyle === "drawers" || c.frontStyle === "desk" || c.frontStyle === "door_drawer";
    if (!hasDrawers) return;
    const S = this.settings;
    const specs = drawerBoxSpecs(c, S);
    if (!specs.length) return;
    const dt = S.stocks[S.roleStock.drawerBox].thickness;
    const bt = S.stocks[S.roleStock.drawerBottom].thickness;
    const inset = isInset(c);
    // First slot hangs under the TOP border (the wider face-frame top rail when
    // framed) and the box hangs centred under its FRONT between the slide
    // planes — run-aware, so a bay at a shared joint shifts like the cut list.
    const slotTop = inset ? topBorderWidth(c, S) : 0.125;
    const runOwned =
      !!ctx && ctx.run.framed && S.continuousFaceFrame && ctx.run.members.length > 1 && isFramed(c);
    const packs = slideBlockingSpecs(
      c,
      S,
      runOwned ? bayFrameContext(ctx.run, ctx.run.members.indexOf(ctx.m), S) : undefined,
    );
    const packL = packs.find((b) => b.side === "left");
    const railGap = inset ? insetStackGap(c, S) : 0.125;
    const heights = getDrawerHeights(c, S);
    const W = c.width;
    const m = this.matCarcassIn;
    let top = yT - slotTop;
    heights.forEach((dh, i) => {
      const sp = specs[i];
      if (!sp) return;
      const slotBottom = top - dh;
      const bx0 = x0 + (packL ? packL.plane + 0.5 : (W - sp.boxWidth) / 2);
      const bx1 = bx0 + sp.boxWidth;
      const bz1 = fz0 - 0.25;
      const bz0 = Math.max(0.75, bz1 - sp.boxDepth);
      const by0 = slotBottom + 0.25;
      const by1 = Math.max(by0 + 1, Math.min(top - 0.25, by0 + sp.boxHeight));
      // Slide pack-out strips — wall out to the slide line at each drawer.
      for (const pk of packs) {
        const px0 = x0 + (pk.side === "left" ? pk.plane - pk.thickness : pk.plane);
        const py0 = Math.max(carcassThickness(S), by0 - 0.875);
        this.addBox(px0, px0 + pk.thickness, py0, py0 + pk.width, bz0, bz1, m);
      }
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
    this.lastRunKey = null;
    this.cabinets = cabinets;
    this.settings = settings;
    this.showFronts = showFronts;
    this.tintCabinets = tintCabinets;
    this.rebuild();
  }

  /**
   * Render the whole assembled RUN for a run-level build step — every box joined
   * with the ONE continuous face frame drawn across all the joints (reusing the
   * main whole-run render, so it matches the 3D-view tab and the cut list).
   * `showFronts` false shows the joined carcasses before the frame + fronts go
   * on. The view refits once, when the run is first entered, so stepping through
   * the run's beats keeps a steady viewpoint.
   */
  setRunFocus(cabinets: Cabinet[], settings: Settings, showFronts: boolean) {
    const key = cabinets.map((c) => c.id).join(",");
    this.focus = null;
    this.lastFocusId = null;
    this.cabinets = cabinets;
    this.settings = settings;
    this.showFronts = showFronts;
    this.tintCabinets = false;
    if (this.lastRunKey !== key) {
      this.fitted = false; // frame the whole run on first entry
      this.lastRunKey = key;
    }
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
    ends?: BuildEnds,
    blocking?: SlideBlockingSpec[],
  ) {
    this.settings = settings;
    this.showFronts = showFronts;
    this.lastRunKey = null;
    this.focus = { cabinet, stage, revealed: new Set(revealedStages), accent, ends, blocking };
    this.rebuild();
  }

  /** Build the staged geometry for the focused cabinet. */
  private renderBuild(f: BuildFocus) {
    const parts = cabinetBuildParts(f.cabinet, this.settings, f.ends, f.blocking);
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
    // Pocket-hole decals — flat dark ellipses on the drilled face, long axis
    // pointing at the joining end the screw exits through. Ghosted parts skip
    // them (they'd just read as noise through the transparency).
    if (mode !== "ghost" && p.pockets?.length) {
      for (const dot of p.pockets) {
        const g2 = new THREE.CircleGeometry(0.27, 16);
        const el = new THREE.Mesh(g2, this.matPocket);
        el.scale.set(dot.along === "x" ? 2.1 : 1, dot.along === "y" ? 2.1 : 1, 1);
        const [nx, ny, nz] = dot.n;
        if (ny !== 0) el.rotation.x = ny > 0 ? -Math.PI / 2 : Math.PI / 2;
        else if (nz < 0) el.rotation.y = Math.PI;
        else if (nx !== 0) el.rotation.y = nx > 0 ? Math.PI / 2 : -Math.PI / 2;
        el.position.set(dot.x + nx * 0.03, dot.y + ny * 0.03, dot.z + nz * 0.03);
        this.group.add(el);
      }
    }
  }

  /** A small always-on-top sphere used for a committed point or the hover cursor. */
  private measureDot(mat: THREE.Material, r: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
    m.renderOrder = 999;
    m.visible = false;
    return m;
  }

  /** Enter/leave the corner-to-corner measurement mode. Leaving clears the span. */
  setMeasureMode(on: boolean) {
    this.measureMode = on;
    this.renderer.domElement.style.cursor = on ? "crosshair" : "grab";
    if (!on) {
      this.hideHover();
      this.clearMeasure();
    }
  }

  /** Drop the active measurement (both dots, the connector and the label). */
  clearMeasure() {
    this.measurePts = [];
    this.refreshMeasure();
  }

  /** Hide the live hover marker + rubber band (pointer left the canvas / dragging). */
  private hideHover() {
    this.hoverPt = null;
    this.hoverMarker.visible = false;
    this.rubberLine.visible = false;
  }

  /** Cast the cursor into the run, snap to the nearest corner, and preview it:
   *  a marker on that corner, plus a rubber band from the first committed point. */
  private updateHover(clientX: number, clientY: number) {
    this.hoverPt = this.measureRaycast(clientX, clientY);
    this.hoverMarker.visible = !!this.hoverPt;
    if (this.hoverPt) this.hoverMarker.position.copy(this.hoverPt);
    if (this.measurePts.length === 1 && this.hoverPt) {
      this.rubberLine.geometry.setFromPoints([this.measurePts[0], this.hoverPt]);
      this.rubberLine.computeLineDistances();
      this.rubberLine.visible = true;
    } else {
      this.rubberLine.visible = false;
    }
  }

  /** Commit the corner under the cursor as the next measurement point. */
  private measurePick(clientX: number, clientY: number) {
    const p = this.measureRaycast(clientX, clientY);
    if (!p) return; // clicking empty space is a no-op, not a stray point
    // A third click begins a fresh span rather than appending to a finished one.
    if (this.measurePts.length >= 2) this.measurePts = [];
    this.measurePts.push(p);
    this.refreshMeasure();
  }

  /** Position the committed dots + span line and broadcast the result. */
  private refreshMeasure() {
    const pts = this.measurePts;
    this.dotA.visible = pts.length >= 1;
    if (pts[0]) this.dotA.position.copy(pts[0]);
    this.dotB.visible = pts.length >= 2;
    if (pts[1]) this.dotB.position.copy(pts[1]);
    if (pts.length === 2) {
      this.spanLine.geometry.setFromPoints(pts);
      this.spanLine.visible = true;
      const [a, b] = pts;
      this.onMeasure?.({
        dist: a.distanceTo(b),
        dx: Math.abs(a.x - b.x),
        dy: Math.abs(a.y - b.y),
        dz: Math.abs(a.z - b.z),
      });
    } else {
      this.spanLine.visible = false;
      this.onMeasure?.(null);
    }
    if (pts.length !== 1) this.rubberLine.visible = false;
  }

  /** Ray a screen point into the run and snap the hit to its box's nearest corner. */
  private measureRaycast(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const meshes = this.group.children.filter((o) => (o as THREE.Mesh).isMesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? this.snapToCorner(hit) : null;
  }

  /** Snap a surface hit to the nearest of its box's 8 corners — the parts are
   *  axis-aligned boxes in an untransformed group, so world = local geometry. */
  private snapToCorner(hit: THREE.Intersection): THREE.Vector3 {
    const params = ((hit.object as THREE.Mesh).geometry as THREE.BoxGeometry).parameters;
    if (!params || params.width == null) return hit.point.clone();
    const c = (hit.object as THREE.Mesh).position;
    const half = new THREE.Vector3(params.width / 2, params.height / 2, params.depth / 2);
    let best = hit.point.clone();
    let bestD = Infinity;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const corner = new THREE.Vector3(c.x + sx * half.x, c.y + sy * half.y, c.z + sz * half.z);
          const d = corner.distanceToSquared(hit.point);
          if (d < bestD) {
            bestD = d;
            best = corner;
          }
        }
    return best;
  }

  /** Park the floating length label at the midpoint of the active segment —
   *  the committed span, or the live rubber band while placing the 2nd point. */
  private updateMeasureLabel() {
    const el = this.measureLabel;
    const pts = this.measurePts;
    const a = pts[0] ?? null;
    const b = pts.length === 2 ? pts[1] : pts.length === 1 ? this.hoverPt : null;
    if (!a || !b || a.distanceToSquared(b) < 1e-4) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    const ndc = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).project(this.camera);
    if (ndc.z > 1) {
      el.style.display = "none";
      return;
    }
    el.style.left = (ndc.x * 0.5 + 0.5) * this.mount.clientWidth + "px";
    el.style.top = (-ndc.y * 0.5 + 0.5) * this.mount.clientHeight + "px";
    el.textContent = fmtLen(a.distanceTo(b), this.settings.units);
    el.style.display = "block";
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
    this.updateMeasureLabel();
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanupFns.forEach((fn) => fn());
    [this.dotA, this.dotB, this.hoverMarker, this.spanLine, this.rubberLine].forEach((o) => o.geometry.dispose());
    this.matMeasure.dispose();
    this.matHover.dispose();
    this.lineMeasure.dispose();
    this.lineRubber.dispose();
    if (this.measureLabel.parentElement) this.measureLabel.parentElement.removeChild(this.measureLabel);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}
