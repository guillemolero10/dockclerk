// The 3D warehouse, in plain three.js. React owns the meaning (colours, picks,
// selection); this class only draws what it is told and reports hovers and clicks.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  AISLE_W, BAY, BOUNDS, DOCKS, DOCK_Z, LANE_COUNT, LANE_PITCH, LANE_SLOTS, LANE_Z0, LEVELS, LEVEL_H, POSITIONS, RACK_D,
  RACK_DEPTH_Z, ROWS, SLOT_W, laneSlotPosition, laneX, parseLocation, rackSlotPosition, rowCenterX, rowFace,
} from "@/lib/warehouse/layout";
import type { RoutePoint } from "@/lib/warehouse/route";

export type ScenePallet = { id: string; loc: string; color: string };

const INK = "#15130f";
const CONCRETE = "#e7e4da";
const SLAB = "#d9d4c5";
const WALL = "#cdc6b4";
const PAINT = "#f0c000";
const WOOD = "#c19a5b";
const YELLOW = "#ffd100";
const MAX_PALLETS = 1100;
const RACK_TOP = LEVELS * LEVEL_H;

const VIEW_DIR = new THREE.Vector3(0.62, 0.78, 0.86).normalize(); // from the docks, high on the right

const BASE_H = 0.14;
const LOAD = { x: 1.04, z: 0.74 };

/** Stable 0..1 number per pallet so load heights vary but never flicker between refreshes. */
function hash01(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export class WarehouseScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private family = "sans-serif";

  private base: THREE.InstancedMesh;
  private load: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private picked: THREE.InstancedMesh;
  private chevrons: THREE.InstancedMesh;
  private hoverBox: THREE.LineSegments;
  private selectBox: THREE.LineSegments;
  private selectPin: THREE.Group;
  private markers = new THREE.Group();

  private pallets: (ScenePallet & { pos: THREE.Vector3; h: number })[] = [];
  private byId = new Map<string, number>();
  private picks: string[] = [];
  private route: RoutePoint[] = [];
  private selected: string | null = null;
  private hovered: string | null = null;

  private pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downAt: { x: number; y: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private lastClient = { x: 0, y: 0 };
  private targetGoal: THREE.Vector3 | null = null;
  private positionGoal: THREE.Vector3 | null = null;
  private zoomGoal: number | null = null;
  private disposed = false;

  onHover: (id: string | null, x: number, y: number) => void = () => {};
  onPick: (id: string | null) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(CONCRETE);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minZoom = 0.55;
    this.controls.maxZoom = 5;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.3;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("start", () => {
      this.targetGoal = this.positionGoal = null;
      this.zoomGoal = null;
    });
    this.resetView(false);

    this.addLights();
    this.addBuilding();
    this.addRacks();

    // Pallets: wooden base + load, one instance each.
    const baseGeo = this.track(new THREE.BoxGeometry(1.16, BASE_H, 0.8));
    const loadGeo = this.track(new THREE.BoxGeometry(LOAD.x, 1, LOAD.z));
    this.base = new THREE.InstancedMesh(baseGeo, this.track(new THREE.MeshLambertMaterial({ color: WOOD })), MAX_PALLETS);
    this.load = new THREE.InstancedMesh(loadGeo, this.track(new THREE.MeshLambertMaterial({ color: "#ffffff" })), MAX_PALLETS);
    for (const mesh of [this.base, this.load]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.scene.add(mesh);
    }
    this.load.setColorAt(0, new THREE.Color("#ffffff"));

    // Pallets to pick, drawn solid on top of the x-rayed stock so racks never hide them.
    this.picked = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(LOAD.x + 0.02, 1, LOAD.z + 0.02)),
      this.track(new THREE.MeshLambertMaterial({ color: YELLOW })),
      200,
    );
    this.picked.count = 0;
    this.picked.frustumCulled = false;
    this.picked.castShadow = true;
    this.scene.add(this.picked);

    // Halo around the pallets to pick.
    const glowMat = this.track(new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.4, depthWrite: false }));
    this.glow = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(1.3, 1.2, 0.92)), glowMat, 200);
    this.glow.count = 0;
    this.glow.frustumCulled = false; // its instances change, so its bounds would go stale
    this.scene.add(this.glow);

    // Marching chevrons along the picking route.
    const chevron = new THREE.Shape([
      new THREE.Vector2(-0.14, 0.17), new THREE.Vector2(0.02, 0.17), new THREE.Vector2(0.18, 0),
      new THREE.Vector2(0.02, -0.17), new THREE.Vector2(-0.14, -0.17), new THREE.Vector2(0.02, 0),
    ]);
    const chevronGeo = this.track(new THREE.ShapeGeometry(chevron));
    chevronGeo.scale(1.6, 1.6, 1);
    chevronGeo.rotateX(-Math.PI / 2);
    this.chevrons = new THREE.InstancedMesh(chevronGeo, this.track(new THREE.MeshBasicMaterial({ color: INK })), 600);
    this.chevrons.count = 0;
    this.chevrons.frustumCulled = false;
    this.chevrons.position.y = 0.03;
    this.scene.add(this.chevrons);

    const boxEdges = this.track(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.26, 1.3, 0.9)));
    this.hoverBox = new THREE.LineSegments(boxEdges, this.track(new THREE.LineBasicMaterial({ color: INK })));
    this.selectBox = new THREE.LineSegments(boxEdges, this.track(new THREE.LineBasicMaterial({ color: INK })));
    this.hoverBox.visible = this.selectBox.visible = false;
    this.scene.add(this.hoverBox, this.selectBox);

    this.selectPin = new THREE.Group();
    const cone = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.38, 0.8, 4)), this.track(new THREE.MeshLambertMaterial({ color: INK })));
    cone.rotation.x = Math.PI;
    cone.castShadow = true;
    this.selectPin.add(cone);
    this.selectPin.visible = false;
    this.scene.add(this.selectPin, this.markers);

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.handleMove);
    el.addEventListener("pointerdown", this.handleDown);
    el.addEventListener("pointerup", this.handleUp);
    el.addEventListener("pointerleave", this.handleLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);

    // Signs need the brand font loaded before they are painted.
    const family = getComputedStyle(document.body).getPropertyValue("--font-barlow-condensed").trim();
    if (family) this.family = family;
    document.fonts.load(`700 64px ${this.family}`).finally(() => {
      if (!this.disposed) this.addSigns();
    });
  }

  // ---------- public API ----------

  setPallets(list: ScenePallet[]) {
    const laneCount = new Map<string, number>();
    this.pallets = [];
    for (const p of list) {
      const loc = parseLocation(p.loc);
      if (!loc) continue;
      let pos: { x: number; y: number; z: number };
      if (loc.kind === "rack") {
        pos = rackSlotPosition(loc.row, loc.position, loc.level);
      } else {
        const i = laneCount.get(p.loc) ?? 0;
        laneCount.set(p.loc, i + 1);
        pos = laneSlotPosition(loc.zone, loc.lane, i);
      }
      this.pallets.push({ ...p, pos: new THREE.Vector3(pos.x, pos.y, pos.z), h: 0.78 + hash01(p.id) * 0.3 });
      if (this.pallets.length >= MAX_PALLETS) break;
    }
    this.byId = new Map(this.pallets.map((p, i) => [p.id, i]));

    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    this.pallets.forEach((p, i) => {
      m.makeTranslation(p.pos.x, p.pos.y + BASE_H / 2, p.pos.z);
      this.base.setMatrixAt(i, m);
      m.makeScale(1, p.h, 1).setPosition(p.pos.x, p.pos.y + BASE_H + p.h / 2, p.pos.z);
      this.load.setMatrixAt(i, m);
      this.load.setColorAt(i, color.set(p.color));
    });
    for (const mesh of [this.base, this.load]) {
      mesh.count = this.pallets.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
    if (this.load.instanceColor) this.load.instanceColor.needsUpdate = true;
    this.updatePicks();
    this.updateSelection();
  }

  /** Pallets to pick in order, and the route to walk. */
  setPicks(ids: string[], route: RoutePoint[]) {
    this.picks = ids;
    this.route = route;
    this.updatePicks();
    // Frame the pallets and the walk to them from the dispatch lane.
    const points = ids.map((id) => this.pallets[this.byId.get(id) ?? -1]?.pos).filter(Boolean);
    if (points.length) this.frame([...points, ...route.map(([x, z]) => new THREE.Vector3(x, 0, z))]);
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.updateSelection();
  }

  resetView(animate = true) {
    const target = new THREE.Vector3(0, 0, (BOUNDS.minZ + BOUNDS.maxZ) / 2);
    const position = target.clone().add(VIEW_DIR.clone().multiplyScalar(90));
    this.zoomGoal = 1;
    if (animate) {
      this.targetGoal = target;
      this.positionGoal = position;
      return;
    }
    // First load: start slightly zoomed out and settle in.
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.zoom = 0.82;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.handleMove);
    el.removeEventListener("pointerdown", this.handleDown);
    el.removeEventListener("pointerup", this.handleUp);
    el.removeEventListener("pointerleave", this.handleLeave);
    this.controls.dispose();
    this.clearMarkers();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ---------- drawing ----------

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, shadows = true) {
    const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), this.track(new THREE.MeshLambertMaterial({ color })));
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#bdb6a4", 2.1));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.3);
    sun.position.set(-16, 34, 22);
    sun.target.position.set(0, 0, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
  }

  private addBuilding() {
    const w = BOUNDS.maxX - BOUNDS.minX;
    const d = BOUNDS.maxZ - BOUNDS.minZ + 0.6;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ + 0.6) / 2;

    // Floor slab, outlined like a plan.
    const slab = this.box(w + 0.6, 0.5, d + 0.6, SLAB, 0, -0.25, cz, false);
    const outline = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(slab.geometry)), this.track(new THREE.LineBasicMaterial({ color: INK })));
    outline.position.copy(slab.position);
    this.scene.add(outline);

    // Cutaway walls: full height at the back and left, low at the docks, open on the right.
    const panels = this.panelTexture();
    const wallMat = this.track(new THREE.MeshLambertMaterial({ color: WALL, map: panels }));
    const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(w + 0.6, 9, 0.3)), wallMat);
    back.position.set(0, 4.5, BOUNDS.minZ - 0.15);
    const left = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, 9, d)), wallMat);
    left.position.set(BOUNDS.minX - 0.15, 4.5, cz - 0.3);
    for (const wall of [back, left]) {
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.scene.add(wall);
    }

    // Dock wall: low parapet with four doors.
    const doorW = 2.7;
    const edges = [BOUNDS.minX - 0.3, ...DOCKS.flatMap((dk) => [dk.x - doorW / 2, dk.x + doorW / 2]), BOUNDS.maxX + 0.3];
    for (let i = 0; i < edges.length; i += 2) {
      const len = edges[i + 1] - edges[i];
      if (len > 0.05) this.box(len, 1.1, 0.3, WALL, edges[i] + len / 2, 0.55, DOCK_Z + 0.15);
    }
    for (const dk of DOCKS) {
      this.box(0.22, 4.4, 0.34, INK, dk.x - doorW / 2 - 0.11, 2.2, DOCK_Z + 0.15);
      this.box(0.22, 4.4, 0.34, INK, dk.x + doorW / 2 + 0.11, 2.2, DOCK_Z + 0.15);
      this.box(doorW + 0.66, 0.55, 0.34, INK, dk.x, 4.4, DOCK_Z + 0.15);
      // Dock leveller with safety stripes.
      const leveller = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(doorW - 0.2, 1.3)),
        this.track(new THREE.MeshLambertMaterial({ map: this.hazardTexture() })),
      );
      leveller.rotation.x = -Math.PI / 2;
      leveller.position.set(dk.x, 0.012, DOCK_Z - 0.65);
      leveller.receiveShadow = true;
      this.scene.add(leveller);
    }

    // Floor paint: aisle edges, cross aisle, staging lanes.
    const paint = this.track(new THREE.MeshLambertMaterial({ color: PAINT }));
    const stripe = (x0: number, z0: number, x1: number, z1: number, width = 0.08) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, 0.01, width)), paint);
      m.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
      m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    for (const row of ROWS) {
      const x = rowCenterX(row) + rowFace(row) * (RACK_D / 2 + 0.14);
      stripe(x, 0.15, x, -RACK_DEPTH_Z);
    }
    stripe(BOUNDS.minX + 0.2, LANE_Z0 - 0.45, BOUNDS.maxX - 0.2, LANE_Z0 - 0.45, 0.12);
    for (const zone of ["REC", "EXP"] as const) {
      for (let lane = 1; lane <= LANE_COUNT; lane++) {
        const x = laneX(zone, lane);
        const z1 = LANE_Z0 + LANE_SLOTS * LANE_PITCH;
        stripe(x - 0.66, LANE_Z0 - 0.05, x - 0.66, z1);
        stripe(x + 0.66, LANE_Z0 - 0.05, x + 0.66, z1);
      }
    }
  }

  private addRacks() {
    const frames = POSITIONS / BAY + 1;
    const postH = RACK_TOP + 0.15;
    const posts = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(0.09, postH, 0.09)),
      this.track(new THREE.MeshLambertMaterial({ color: "#2b2924" })),
      ROWS.length * frames * 2,
    );
    const beamLevels = LEVELS; // under levels 2..5, plus a top tie
    const beams = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(0.07, 0.13, BAY * SLOT_W - 0.09)),
      this.track(new THREE.MeshLambertMaterial({ color: "#3b3830" })),
      ROWS.length * (POSITIONS / BAY) * beamLevels * 2,
    );
    const m = new THREE.Matrix4();
    let p = 0;
    let b = 0;
    for (const row of ROWS) {
      const cx = rowCenterX(row);
      for (let f = 0; f < frames; f++) {
        const z = -f * BAY * SLOT_W;
        for (const dx of [-RACK_D / 2 + 0.045, RACK_D / 2 - 0.045]) {
          posts.setMatrixAt(p++, m.makeTranslation(cx + dx, postH / 2, z));
        }
      }
      for (let bay = 0; bay < POSITIONS / BAY; bay++) {
        const z = -(bay * BAY + BAY / 2) * SLOT_W;
        for (let l = 2; l <= LEVELS + 1; l++) {
          const y = (l - 1) * LEVEL_H - 0.065;
          for (const dx of [-RACK_D / 2 + 0.045, RACK_D / 2 - 0.045]) {
            beams.setMatrixAt(b++, m.makeTranslation(cx + dx, y, z));
          }
        }
      }
    }
    for (const mesh of [posts, beams]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }
  }

  private addSigns() {
    // Hanging aisle letters, yellow on black like real warehouse signage.
    for (const row of ROWS) {
      this.sign(row, 0.95, 0.95, rowCenterX(row), RACK_TOP + 1.25, 0.25, { bg: YELLOW, fg: INK });
    }
    const recX = (laneX("REC", 1) + laneX("REC", LANE_COUNT)) / 2;
    const expX = (laneX("EXP", 1) + laneX("EXP", LANE_COUNT)) / 2;
    this.sign("RECEIVING", 4.2, 0.75, recX, 5.6, LANE_Z0 + 1.2, { bg: INK, fg: YELLOW });
    this.sign("DISPATCH", 4.2, 0.75, expX, 5.6, LANE_Z0 + 1.2, { bg: INK, fg: YELLOW });
    for (const dk of DOCKS) this.sign(`DOCK ${dk.n}`, 2.9, 0.62, dk.x, 4.4, DOCK_Z + 0.34, { bg: INK, fg: YELLOW, border: false });

    // Lane numbers painted on the floor at the head of each lane.
    for (const zone of ["REC", "EXP"] as const) {
      for (let lane = 1; lane <= LANE_COUNT; lane++) {
        const label = this.plane(`${zone} ${lane}`, 1.2, 0.36, { bg: null, fg: INK });
        label.rotation.x = -Math.PI / 2;
        label.position.set(laneX(zone, lane), 0.014, LANE_Z0 - 0.2);
        this.scene.add(label);
      }
    }
    // Aisle numbers at the mouth of each aisle.
    [0, 2, 4, 6].forEach((i, n) => {
      const x = rowCenterX(ROWS[i]) + RACK_D / 2 + AISLE_W / 2;
      const label = this.plane(`AISLE ${n + 1}`, 1.8, 0.42, { bg: null, fg: INK });
      label.rotation.x = -Math.PI / 2;
      label.position.set(x, 0.014, 0.75);
      this.scene.add(label);
    });
  }

  private sign(text: string, w: number, h: number, x: number, y: number, z: number, colors: { bg: string; fg: string; border?: boolean }) {
    const mesh = this.plane(text, w, h, colors);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    // Back face in plain ink so it reads as a board from behind.
    const back = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, h)), this.track(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })));
    back.position.copy(mesh.position);
    this.scene.add(back);
  }

  private plane(text: string, w: number, h: number, o: { bg: string | null; fg: string; border?: boolean }) {
    const tex = this.textTexture(text, w, h, o);
    const mat = this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: !o.bg, depthWrite: !!o.bg }));
    return new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, h)), mat);
  }

  private textTexture(text: string, w: number, h: number, o: { bg: string | null; fg: string; border?: boolean }, keep = true) {
    const px = 160;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * px);
    canvas.height = Math.round(h * px);
    const ctx = canvas.getContext("2d")!;
    if (o.bg) {
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (o.border !== false) {
        ctx.lineWidth = canvas.height * 0.08;
        ctx.strokeStyle = o.fg;
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth);
      }
    }
    ctx.fillStyle = o.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = canvas.height * (text.length === 1 ? 0.78 : 0.62);
    ctx.font = `700 ${size}px ${this.family}`;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.06, canvas.width * 0.9);
    const tex = new THREE.CanvasTexture(canvas);
    if (keep) this.track(tex);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  private hazardTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = YELLOW;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = INK;
    for (let x = -128; x < 384; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 24, 128);
      ctx.lineTo(x + 152, 0);
      ctx.lineTo(x + 128, 0);
      ctx.fill();
    }
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private panelTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = "#e4dfd2";
    for (let x = 0; x < 1024; x += 64) ctx.fillRect(x, 0, 3, 256);
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    return tex;
  }

  // ---------- picks, selection, interaction ----------

  private clearMarkers() {
    for (const child of [...this.markers.children]) {
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture };
        mat?.map?.dispose();
        mat?.dispose();
      });
      this.markers.remove(child);
    }
  }

  private updatePicks() {
    this.clearMarkers();
    const m = new THREE.Matrix4();
    const stacked = new Map<string, number>();
    let n = 0;
    this.picks.forEach((id, i) => {
      const p = this.pallets[this.byId.get(id) ?? -1];
      if (!p) return;
      this.picked.setMatrixAt(n, m.makeScale(1, p.h, 1).setPosition(p.pos.x, p.pos.y + BASE_H + p.h / 2, p.pos.z));
      this.glow.setMatrixAt(n++, m.makeTranslation(p.pos.x, p.pos.y + 0.6, p.pos.z));

      // Numbered tag floating above the racking, with a drop line to the pallet.
      // Pallets on the same column (different levels) stack their tags.
      const column = `${p.pos.x},${p.pos.z}`;
      const k = stacked.get(column) ?? 0;
      stacked.set(column, k + 1);
      const top = p.pos.y + BASE_H + p.h;
      const tagY = Math.max(RACK_TOP + 2.3, top + 1.6) + k * 1.05;
      // Not tracked: these textures go away with the markers on the next update.
      const tex = this.textTexture(String(i + 1), 0.8, 0.8, { bg: YELLOW, fg: INK }, false);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      tag.scale.set(0.95, 0.95, 1);
      tag.position.set(p.pos.x, tagY, p.pos.z);
      tag.renderOrder = 10;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.pos.x, top + 0.05, p.pos.z), new THREE.Vector3(p.pos.x, tagY - 0.5, p.pos.z)]),
        new THREE.LineBasicMaterial({ color: INK }),
      );
      this.markers.add(tag, line);
    });
    this.glow.count = this.picked.count = n;
    this.glow.instanceMatrix.needsUpdate = this.picked.instanceMatrix.needsUpdate = true;

    // X-ray the rest of the stock while picking.
    const xray = n > 0;
    for (const [mesh, opacity] of [[this.load, 0.3], [this.base, 0.35]] as const) {
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (mat.transparent === xray) continue;
      mat.transparent = xray;
      mat.opacity = xray ? opacity : 1;
      mat.depthWrite = !xray;
      mat.needsUpdate = true;
      mesh.castShadow = !xray;
    }
  }

  private updateSelection() {
    const p = this.selected ? this.pallets[this.byId.get(this.selected) ?? -1] : undefined;
    this.selectBox.visible = this.selectPin.visible = !!p;
    if (!p) return;
    this.selectBox.position.set(p.pos.x, p.pos.y + 0.62, p.pos.z);
    this.selectPin.position.set(p.pos.x, RACK_TOP + 1.4, p.pos.z);
  }

  private frame(points: THREE.Vector3[]) {
    if (!points.length) return;
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    center.y = RACK_TOP / 2; // mid-height, so the tags above the racks stay on screen
    this.targetGoal = center;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 8);
    this.zoomGoal = THREE.MathUtils.clamp(30 / (span + 8), 1, 2);
  }

  private handleMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerDirty = true;
    this.lastClient = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  private handleDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private handleUp = (e: PointerEvent) => {
    if (!this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 5) return;
    this.onPick(this.hit());
  };

  private handleLeave = () => {
    this.pointerDirty = false;
    this.setHover(null);
  };

  private hit(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.load, false)[0];
    return hit?.instanceId !== undefined ? this.pallets[hit.instanceId]?.id ?? null : null;
  }

  private setHover(id: string | null) {
    if (id === this.hovered && id === null) return;
    this.hovered = id;
    const p = id ? this.pallets[this.byId.get(id) ?? -1] : undefined;
    this.hoverBox.visible = !!p;
    if (p) this.hoverBox.position.set(p.pos.x, p.pos.y + 0.62, p.pos.z);
    this.renderer.domElement.style.cursor = p ? "pointer" : "";
    this.onHover(id, this.lastClient.x, this.lastClient.y);
  }

  /** Pixels covered by overlay panels on the left; the plan centres in the space that is left. */
  setLeftInset(px: number) {
    this.leftInset = px;
    this.resize();
  }
  private leftInset = 0;

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    // Fit the whole floor plan in the free area, whatever its shape.
    const free = Math.max(w - this.leftInset, w * 0.5);
    const view = Math.max(32, 45 / (free / h));
    this.camera.left = (-view * (w / h)) / 2;
    this.camera.right = (view * (w / h)) / 2;
    this.camera.top = view / 2;
    this.camera.bottom = -view / 2;
    this.camera.setViewOffset(w, h, -(w - free) / 2, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  private tick = (time: number) => {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();

    const ease = 1 - Math.pow(0.002, dt);
    if (this.targetGoal) {
      const before = this.controls.target.clone();
      this.controls.target.lerp(this.targetGoal, ease);
      // Reset swings the camera back to the default angle; framing picks keeps the user's angle.
      if (this.positionGoal) this.camera.position.lerp(this.positionGoal, ease);
      else this.camera.position.add(this.controls.target.clone().sub(before));
      if (this.controls.target.distanceTo(this.targetGoal) < 0.02) this.targetGoal = this.positionGoal = null;
    }
    if (this.zoomGoal !== null) {
      this.camera.zoom += (this.zoomGoal - this.camera.zoom) * (1 - Math.pow(0.004, dt));
      this.camera.updateProjectionMatrix();
      if (Math.abs(this.camera.zoom - this.zoomGoal) < 0.002) this.zoomGoal = null;
    }
    this.controls.update();

    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.hit());
    }

    // Pulse the halos, bob the selection pin, march the route.
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.22 * Math.sin(t * 4);
    if (this.selectPin.visible) this.selectPin.children[0].position.y = Math.sin(t * 3) * 0.15;
    this.drawRoute(t);

    this.renderer.render(this.scene, this.camera);
  };

  private drawRoute(t: number) {
    if (this.route.length < 2) {
      this.chevrons.count = 0;
      return;
    }
    const spacing = 0.7;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    let walked = 0;
    let next = (t * 1.6) % spacing;
    for (let i = 1; i < this.route.length && n < 600; i++) {
      const [x0, z0] = this.route[i - 1];
      const [x1, z1] = this.route[i];
      const len = Math.hypot(x1 - x0, z1 - z0);
      q.setFromAxisAngle(up, Math.atan2(-(z1 - z0), x1 - x0));
      while (next <= walked + len && n < 600) {
        const f = (next - walked) / len;
        m.compose(new THREE.Vector3(x0 + (x1 - x0) * f, 0, z0 + (z1 - z0) * f), q, one);
        this.chevrons.setMatrixAt(n++, m);
        next += spacing;
      }
      walked += len;
    }
    this.chevrons.count = n;
    this.chevrons.instanceMatrix.needsUpdate = true;
  }
}
