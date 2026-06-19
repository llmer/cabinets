import * as THREE from "three";
import { Cabinet, Settings } from "@/domain/types";
import { colorFor, three as T } from "@/theme";
import { boxHeight, backThickness, carcassThickness, isFramed } from "@/engine/geometry";
import { getDrawerHeights } from "@/engine/drawers";

type ViewPreset = "iso" | "front" | "top";

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
  private matCarcass: THREE.MeshStandardMaterial;
  private matCarcassIn: THREE.MeshStandardMaterial;
  private matHandle: THREE.MeshStandardMaterial;
  private frontMats: Record<string, THREE.MeshStandardMaterial> = {};

  private cabinets: Cabinet[] = [];
  private settings!: Settings;
  private showFronts = true;

  private cleanupFns: Array<() => void> = [];

  constructor(mount: HTMLElement) {
    this.mount = mount;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(T.background);
    this.camera = new THREE.PerspectiveCamera(42, 1.6, 1, 9000);

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.style.display = "block";
    mount.appendChild(r.domElement);

    // lights
    scene.add(new THREE.HemisphereLight(0xfff6e2, 0xb9a888, 0.95));
    const dir = new THREE.DirectionalLight(0xfff2da, 0.85);
    dir.position.set(-120, 200, 160);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
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
    this.matCarcass = new THREE.MeshStandardMaterial({ color: T.carcass, roughness: 0.82, metalness: 0.02 });
    this.matCarcassIn = new THREE.MeshStandardMaterial({ color: T.carcassInterior, roughness: 0.85 });
    this.matHandle = new THREE.MeshStandardMaterial({ color: T.handle, roughness: 0.5, metalness: 0.4 });

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

  private addCabinet3D(c: Cabinet, x0: number, idx: number) {
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
    const cd = openBox ? D : D - backT;
    const x1 = x0 + W;
    const carcass = this.matCarcass;

    this.addBox(x0, x0 + matT, yB, yT, 0, cd, carcass);
    this.addBox(x1 - matT, x1, yB, yT, 0, cd, carcass);
    if (!openBox) this.addBox(x0 + matT, x1 - matT, yB, yB + matT, 0, cd, carcass);
    if (c.type === "base") {
      this.addBox(x0 + matT, x1 - matT, yT - matT, yT, 0, 4, carcass);
      this.addBox(x0 + matT, x1 - matT, yT - matT, yT, cd - 4, cd, carcass);
    } else {
      this.addBox(x0 + matT, x1 - matT, yT - matT, yT, 0, cd, carcass);
    }
    if (!openBox) this.addBox(x0, x1, yB, yT, 0, backT, carcass);
    if (c.type !== "wall" && c.toeKick !== false && !openBox && yB > 0) {
      this.addBox(x0, x1, 0, yB, 3, 3 + matT, carcass);
    }
    if (!this.showFronts && !openBox && c.shelves > 0) {
      for (let i = 1; i <= c.shelves; i++) {
        const sy = yB + matT + ((boxH - 2 * matT) * i) / (c.shelves + 1);
        this.addBox(x0 + matT, x1 - matT, sy, sy + 0.75, backT, cd - 1, this.matCarcassIn);
      }
    }
    if (!this.showFronts || opening) return;

    const fm = this.frontMat(colorFor(idx));
    const fz0 = D - 0.75;
    const fz1 = D;
    const gap = 0.125;
    const hbar = (xa: number, xb: number, ya: number, yb: number, vertical: boolean) => {
      if (vertical) {
        const hx = xb - 1.1;
        this.addBox(hx, hx + 0.5, (ya + yb) / 2 - 2.2, (ya + yb) / 2 + 2.2, fz1, fz1 + 0.45, this.matHandle);
      } else {
        const hy = yb - 1.0;
        this.addBox((xa + xb) / 2 - 2.2, (xa + xb) / 2 + 2.2, hy, hy + 0.5, fz1, fz1 + 0.45, this.matHandle);
      }
    };

    if (framed) {
      const ff = S.frameWidth || 1.5;
      this.addBox(x0, x0 + ff, yB, yT, fz0, fz1, fm);
      this.addBox(x1 - ff, x1, yB, yT, fz0, fz1, fm);
      this.addBox(x0 + ff, x1 - ff, yT - ff, yT, fz0, fz1, fm);
      if (!desk) this.addBox(x0 + ff, x1 - ff, yB, yB + ff, fz0, fz1, fm);
      const iz0 = fz0 - 0.5;
      const iz1 = fz0 + 0.1;
      const ol = x0 + ff + gap;
      const or = x1 - ff - gap;
      if (c.frontStyle === "doors") {
        const nd = c.doorCount;
        for (let i = 0; i < nd; i++) {
          const a = ol + ((or - ol) * i) / nd + gap / 2;
          const b = ol + ((or - ol) * (i + 1)) / nd - gap / 2;
          this.addBox(a, b, yB + ff + gap, yT - ff - gap, iz0, iz1, fm);
          hbar(a, b, yB + ff, yT - ff, true);
        }
      } else {
        let top = yT - ff - gap;
        const hs = getDrawerHeights(c, S);
        hs.forEach((dh) => {
          this.addBox(ol, or, top - dh + gap / 2, top, iz0, iz1, fm);
          hbar(ol, or, top - dh, top, false);
          top -= dh;
        });
        if (c.frontStyle === "door_drawer") {
          const nd = c.doorCount;
          const bot = yB + ff + gap;
          for (let i = 0; i < nd; i++) {
            const a = ol + ((or - ol) * i) / nd + gap / 2;
            const b = ol + ((or - ol) * (i + 1)) / nd - gap / 2;
            this.addBox(a, b, bot, top - gap, iz0, iz1, fm);
            hbar(a, b, bot, top, true);
          }
        }
      }
      return;
    }

    // frameless full-overlay
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

  private rebuild() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.group = new THREE.Group();
    this.scene.add(this.group);

    const cabs = this.cabinets;
    let bx = 0;
    cabs.filter((c) => c.type !== "wall").forEach((c) => {
      this.addCabinet3D(c, bx, cabs.indexOf(c));
      bx += c.width;
    });
    let wx = 0;
    cabs.filter((c) => c.type === "wall").forEach((c) => {
      this.addCabinet3D(c, wx, cabs.indexOf(c));
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

  setData(cabinets: Cabinet[], settings: Settings, showFronts: boolean) {
    this.cabinets = cabinets;
    this.settings = settings;
    this.showFronts = showFronts;
    this.rebuild();
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
    this.fitView();
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
