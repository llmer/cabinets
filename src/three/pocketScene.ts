/**
 * The Pockets tab's bench view: ONE board lying drill-face-up with its pocket
 * holes marked and the joining ends highlighted. Deliberately tiny compared to
 * CabinetScene — same conventions (render-on-demand, ResizeObserver, custom
 * drag orbit, dispose), no shared state. Loaded lazily so three.js stays out
 * of the initial bundle.
 */
import * as THREE from "three";
import { three as T } from "@/theme";
import { PocketBoardLayout } from "./pocketLayout";

const END_HIGHLIGHT = 0xe6a23c; // the joining ends the screws exit through
const POCKET = 0x3a3027;

interface Orbit {
  theta: number;
  phi: number;
  radius: number;
}

export class PocketScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private group = new THREE.Group();
  private ro: ResizeObserver;
  private orbit: Orbit = { theta: -0.65, phi: 1.12, radius: 40 };
  private baseRadius = 40;
  private container: HTMLElement;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.camera = new THREE.PerspectiveCamera(38, 1.6, 0.5, 800);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(30, 60, 40);
    this.scene.add(dir);
    this.scene.add(this.group);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    // A cancelled pointer stream or a release outside the window would strand
    // `dragging` — capture the pointer and treat cancel/blur as release.
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("blur", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.orbit.theta -= (e.clientX - this.lastX) * 0.008;
    this.orbit.phi = Math.min(1.5, Math.max(0.25, this.orbit.phi - (e.clientY - this.lastY) * 0.006));
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.render();
  };
  private onUp = () => {
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.orbit.radius = Math.min(this.baseRadius * 3, Math.max(this.baseRadius * 0.4, this.orbit.radius * (e.deltaY > 0 ? 1.1 : 0.9)));
    this.render();
  };

  /** Replace the scene with one board + its pocket markers. */
  setBoard(layout: PocketBoardLayout): void {
    this.clearGroup();
    const { length: L, width: W, thickness: t } = layout;

    // The board, drilled face UP on the bench. Joining (length) ends amber.
    const wood = new THREE.MeshLambertMaterial({ color: T.carcass });
    const end = new THREE.MeshLambertMaterial({ color: END_HIGHLIGHT });
    const box = new THREE.Mesh(new THREE.BoxGeometry(L, t, W), [end, end, wood, wood, wood, wood]);
    this.group.add(box);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(L, t, W)),
      new THREE.LineBasicMaterial({ color: T.edge, transparent: true, opacity: 0.55 }),
    );
    this.group.add(edges);

    // Pockets: a dark ellipse on the top face, long axis pointing at the exit
    // end, nudged AWAY from it (the ramp runs back from the joint).
    for (const m of layout.markers) {
      const ell = new THREE.Mesh(
        new THREE.CircleGeometry(0.32, 20),
        new THREE.MeshBasicMaterial({ color: POCKET }),
      );
      ell.scale.set(2.4, 1, 1);
      ell.rotation.x = -Math.PI / 2;
      ell.position.set(m.x - L / 2 - m.toward * 0.35, t / 2 + 0.02, m.z - W / 2);
      this.group.add(ell);
    }

    this.baseRadius = Math.max(L, W) * 1.15 + 8;
    this.orbit.radius = this.baseRadius;
    this.render();
  }

  private clearGroup(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => m?.dispose());
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    const { theta, phi, radius } = this.orbit;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("blur", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
    this.clearGroup();
    this.renderer.dispose();
    el.remove();
  }
}
