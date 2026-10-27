// The 3D warehouse, in plain three.js. React owns the meaning (colours, picks,
// selection); this class only draws the building it is given and reports hovers and clicks.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BAY, DOCK_Z, LANE_PITCH, LANE_SLOTS, LANE_Z0, LEVEL_H, RACK_D, SLOT_W, parseLocation, type Layout } from "@/lib/warehouse/layout";
import type { RoutePoint } from "@/lib/warehouse/route";

export type ScenePallet = { id: string; loc: string; color: string };

const INK = "#15130f";
const CONCRETE = "#e7e4da";
const SLAB = "#d9d4c5";
const WALL = "#cdc6b4";
const PAINT = "#f0c000";
const WOOD = "#c19a5b";
const YELLOW = "#ffd100";
const VIEW_DIR = new THREE.Vector3(0.62, 0.78, 0.86).normalize(); // from the docks, high on the right

const BASE_H = 0.14;
const LOAD = { x: 1.04, z: 0.74 };
const DIM_GAP = 2.6; // how far outside the walls the dimension lines run

/** Stable 0..1 number per pallet so load heights vary but never flicker between refreshes. */
function hash01(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const metres = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} m`;

export class WarehouseScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private family = "sans-serif";
  private home: THREE.Vector3;
  /** Half-size of the box that must fit on screen at zoom 1. */
  private extent: THREE.Vector3;

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
  private leftInset = 0;
  private disposed = false;

  onHover: (id: string | null, x: number, y: number) => void = () => {};
  onPick: (id: string | null) => void = () => {};

  constructor(
    private container: HTMLElement,
    private layout: Layout,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    // What the camera frames: the building plus its dimension lines.
    const b = layout.bounds;
    const box = new THREE.Box3(new THREE.Vector3(b.minX - 2.5, 0, b.minZ - 0.3), new THREE.Vector3(b.maxX + DIM_GAP + 2, layout.dims.height, b.maxZ + DIM_GAP + 2));
    this.home = box.getCenter(new THREE.Vector3());
    this.extent = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    this.scene.background = new THREE.Color(CONCRETE);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minZoom = 0.55;
    this.controls.maxZoom = 6;
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
    const room = layout.capacity + (layout.laneCount.REC + layout.laneCount.EXP) * LANE_SLOTS * 2;
    this.base = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(1.16, BASE_H, 0.8)), this.track(new THREE.MeshLambertMaterial({ color: WOOD })), room);
    this.load = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(LOAD.x, 1, LOAD.z)), this.track(new THREE.MeshLambertMaterial({ color: "#ffffff" })), room);
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
      300,
    );
    // Halo around them.
    this.glow = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(1.3, 1.2, 0.92)),
      this.track(new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.4, depthWrite: false })),
      300,
    );
    // Marching chevrons along the picking route.
    const chevron = new THREE.Shape([
      new THREE.Vector2(-0.14, 0.17), new THREE.Vector2(0.02, 0.17), new THREE.Vector2(0.18, 0),
      new THREE.Vector2(0.02, -0.17), new THREE.Vector2(-0.14, -0.17), new THREE.Vector2(0.02, 0),
    ]);
    const chevronGeo = this.track(new THREE.ShapeGeometry(chevron));
    chevronGeo.scale(1.6, 1.6, 1);
    chevronGeo.rotateX(-Math.PI / 2);
    this.chevrons = new THREE.InstancedMesh(chevronGeo, this.track(new THREE.MeshBasicMaterial({ color: INK })), 1500);
    this.chevrons.position.y = 0.03;
    // Their instances change all the time, so their bounds would go stale: never cull them.
    for (const mesh of [this.picked, this.glow, this.chevrons]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    this.picked.castShadow = true;

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
      if (!this.layout.contains(p.loc) || this.pallets.length >= this.load.instanceMatrix.count) continue;
      const loc = parseLocation(p.loc)!;
      let pos: { x: number; y: number; z: number };
      if (loc.kind === "rack") {
        pos = this.layout.rackSlotPosition(loc.row, loc.position, loc.level);
      } else {
        const i = laneCount.get(p.loc) ?? 0;
        laneCount.set(p.loc, i + 1);
        pos = this.layout.laneSlotPosition(loc.zone, loc.lane, i);
      }
      this.pallets.push({ ...p, pos: new THREE.Vector3(pos.x, pos.y, pos.z), h: 0.78 + hash01(p.id) * 0.3 });
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

  /** Pixels covered by overlay panels on the left; the plan centres in the space that is left. */
  setLeftInset(px: number) {
    this.leftInset = px;
    this.resize();
  }

  resetView(animate = true) {
    const position = this.home.clone().add(VIEW_DIR.clone().multiplyScalar(160));
    this.zoomGoal = 1;
    if (animate) {
      this.targetGoal = this.home.clone();
      this.positionGoal = position;
      return;
    }
    // First load: start slightly zoomed out and settle in.
    this.controls.target.copy(this.home);
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

  /** Flat strip on the floor from one point to another. */
  private strip(material: THREE.Material, x0: number, z0: number, x1: number, z1: number, width: number, y = 0.006) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, 0.01, width)), material);
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  private addLights() {
    const b = this.layout.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#bdb6a4", 2.1));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.3);
    const center = new THREE.Vector3(0, 0, (b.minZ + b.maxZ) / 2);
    sun.position.copy(center).add(new THREE.Vector3(-16, 34, 22).multiplyScalar(Math.max(1, span / 34)));
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = span * 0.75 + 4;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -half;
    sun.shadow.camera.right = sun.shadow.camera.top = half;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = sun.position.distanceTo(center) + half * 2;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
  }

  private addBuilding() {
    const b = this.layout.bounds;
    const wallH = this.layout.dims.height + 0.6;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cz = (b.minZ + b.maxZ) / 2;

    // Floor slab, outlined like a plan.
    const slab = this.box(w + 0.6, 0.5, d + 0.6, SLAB, 0, -0.25, cz, false);
    const outline = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(slab.geometry)), this.track(new THREE.LineBasicMaterial({ color: INK })));
    outline.position.copy(slab.position);
    this.scene.add(outline);

    // Cutaway walls: full height at the back and left, low at the docks, open on the right.
    const wallMat = this.track(new THREE.MeshLambertMaterial({ color: WALL, map: this.panelTexture(w) }));
    const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(w + 0.6, wallH, 0.3)), wallMat);
    back.position.set(0, wallH / 2, b.minZ - 0.15);
    const left = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, wallH, d + 0.6)), wallMat);
    left.position.set(b.minX - 0.15, wallH / 2, cz);
    for (const wall of [back, left]) {
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.scene.add(wall);
    }

    // Dock wall: low parapet with the doors.
    const doorW = 2.7;
    const doorH = Math.min(4.4, wallH - 0.4);
    const edges = [b.minX - 0.3, ...this.layout.docks.flatMap((dk) => [dk.x - doorW / 2, dk.x + doorW / 2]), b.maxX + 0.3];
    for (let i = 0; i < edges.length; i += 2) {
      const len = edges[i + 1] - edges[i];
      if (len > 0.05) this.box(len, 1.1, 0.3, WALL, edges[i] + len / 2, 0.55, DOCK_Z + 0.15);
    }
    const hazard = this.track(new THREE.MeshLambertMaterial({ map: this.hazardTexture() }));
    for (const dk of this.layout.docks) {
      this.box(0.22, doorH, 0.34, INK, dk.x - doorW / 2 - 0.11, doorH / 2, DOCK_Z + 0.15);
      this.box(0.22, doorH, 0.34, INK, dk.x + doorW / 2 + 0.11, doorH / 2, DOCK_Z + 0.15);
      this.box(doorW + 0.66, 0.55, 0.34, INK, dk.x, doorH, DOCK_Z + 0.15);
      // Dock leveller with safety stripes.
      const leveller = new THREE.Mesh(this.track(new THREE.PlaneGeometry(doorW - 0.2, 1.3)), hazard);
      leveller.rotation.x = -Math.PI / 2;
      leveller.position.set(dk.x, 0.012, DOCK_Z - 0.65);
      leveller.receiveShadow = true;
      this.scene.add(leveller);
    }

    // Floor paint: aisle edges, cross aisle, staging lanes.
    const paint = this.track(new THREE.MeshLambertMaterial({ color: PAINT }));
    for (const row of this.layout.rows) {
      const x = this.layout.rowCenterX(row) + this.layout.rowFace(row) * (RACK_D / 2 + 0.14);
      this.strip(paint, x, 0.15, x, -this.layout.rackDepthZ, 0.08);
    }
    this.strip(paint, b.minX + 0.2, LANE_Z0 - 0.45, b.maxX - 0.2, LANE_Z0 - 0.45, 0.12);
    for (const zone of ["REC", "EXP"] as const) {
      for (let lane = 1; lane <= this.layout.laneCount[zone]; lane++) {
        const x = this.layout.laneX(zone, lane);
        const z1 = LANE_Z0 + LANE_SLOTS * LANE_PITCH;
        this.strip(paint, x - 0.66, LANE_Z0 - 0.05, x - 0.66, z1, 0.08);
        this.strip(paint, x + 0.66, LANE_Z0 - 0.05, x + 0.66, z1, 0.08);
      }
    }
  }

  private addRacks() {
    const { rows, positions, levels, rackTop } = this.layout;
    const frames = positions / BAY + 1;
    const postH = rackTop + 0.15;
    const posts = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(0.09, postH, 0.09)),
      this.track(new THREE.MeshLambertMaterial({ color: "#2b2924" })),
      rows.length * frames * 2,
    );
    // Beams under levels 2..top, plus a tie on top.
    const beams = new THREE.InstancedMesh(
      this.track(new THREE.BoxGeometry(0.07, 0.13, BAY * SLOT_W - 0.09)),
      this.track(new THREE.MeshLambertMaterial({ color: "#3b3830" })),
      rows.length * (positions / BAY) * levels * 2,
    );
    const m = new THREE.Matrix4();
    let p = 0;
    let n = 0;
    for (const row of rows) {
      const cx = this.layout.rowCenterX(row);
      for (let f = 0; f < frames; f++) {
        const z = -f * BAY * SLOT_W;
        for (const dx of [-RACK_D / 2 + 0.045, RACK_D / 2 - 0.045]) posts.setMatrixAt(p++, m.makeTranslation(cx + dx, postH / 2, z));
      }
      for (let bay = 0; bay < positions / BAY; bay++) {
        const z = -(bay * BAY + BAY / 2) * SLOT_W;
        for (let l = 2; l <= levels + 1; l++) {
          for (const dx of [-RACK_D / 2 + 0.045, RACK_D / 2 - 0.045]) beams.setMatrixAt(n++, m.makeTranslation(cx + dx, (l - 1) * LEVEL_H - 0.065, z));
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
    const { rows, rackTop, dims, bounds: b } = this.layout;
    const ceiling = dims.height - 0.4;
    // Hanging aisle letters, yellow on black like real warehouse signage.
    for (const row of rows) {
      this.sign(row, 0.95, 0.95, this.layout.rowCenterX(row), Math.min(rackTop + 1.25, ceiling), 0.25, { bg: YELLOW, fg: INK });
    }
    const middle = (zone: "REC" | "EXP") => (this.layout.laneX(zone, 1) + this.layout.laneX(zone, this.layout.laneCount[zone])) / 2;
    const zoneSignW = Math.min(4.2, (b.maxX - b.minX) / 2 - 1);
    this.sign("RECEIVING", zoneSignW, 0.75, middle("REC"), Math.min(5.6, ceiling), LANE_Z0 + 1.2, { bg: INK, fg: YELLOW });
    this.sign("DISPATCH", zoneSignW, 0.75, middle("EXP"), Math.min(5.6, ceiling), LANE_Z0 + 1.2, { bg: INK, fg: YELLOW });
    const doorH = Math.min(4.4, dims.height + 0.2);
    for (const dk of this.layout.docks) this.sign(`DOCK ${dk.n}`, 2.9, 0.62, dk.x, doorH, DOCK_Z + 0.34, { bg: INK, fg: YELLOW, border: false });

    // Lane numbers painted on the floor at the head of each lane.
    for (const zone of ["REC", "EXP"] as const) {
      for (let lane = 1; lane <= this.layout.laneCount[zone]; lane++) {
        this.floorText(`${zone} ${lane}`, 1.2, 0.36, this.layout.laneX(zone, lane), LANE_Z0 - 0.2);
      }
    }
    // Aisle numbers at the mouth of each aisle.
    this.layout.aisleXs.forEach((x, i) => this.floorText(`AISLE ${i + 1}`, 1.8, 0.42, x, 0.75));

    this.addDimensions();
  }

  /** Architect-style dimension lines: width along the docks, length along the open side, clear height. */
  private addDimensions() {
    const { bounds: b, dims } = this.layout;
    const ink = this.track(new THREE.MeshBasicMaterial({ color: INK }));
    const tick = (x: number, z: number, angle: number) => {
      const t = this.strip(ink, x - 0.3, z, x + 0.3, z, 0.06, 0.02);
      t.rotation.y = angle + Math.PI / 4;
    };

    // Width, in front of the dock wall.
    const zW = b.maxZ + 0.3 + DIM_GAP;
    this.strip(ink, b.minX, zW, b.maxX, zW, 0.05, 0.02);
    for (const x of [b.minX, b.maxX]) {
      this.strip(ink, x, b.maxZ + 0.6, x, zW + 0.4, 0.03, 0.02);
      tick(x, zW, 0);
    }
    this.floorText(metres(dims.width), 5, 1.3, 0, zW + 1.0);

    // Length, along the open right side.
    const xL = b.maxX + 0.3 + DIM_GAP;
    this.strip(ink, xL, b.minZ, xL, b.maxZ, 0.05, 0.02);
    for (const z of [b.minZ, b.maxZ]) {
      this.strip(ink, b.maxX + 0.6, z, xL + 0.4, z, 0.03, 0.02);
      tick(xL, z, Math.PI / 2);
    }
    const lengthLabel = this.floorText(metres(dims.length), 5, 1.3, xL + 1.0, (b.minZ + b.maxZ) / 2);
    lengthLabel.rotation.z = Math.PI / 2;

    // Clear height, at the front corner of the left wall.
    const corner = new THREE.Vector3(b.minX - 1.1, 0, b.maxZ + 0.3);
    const post = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, dims.height, 0.05)), ink);
    post.position.set(corner.x, dims.height / 2, corner.z);
    this.scene.add(post);
    for (const y of [0.02, dims.height]) {
      const t = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.6, 0.05, 0.05)), ink);
      t.position.set(corner.x, y, corner.z);
      this.scene.add(t);
    }
    const tex = this.textTexture(`${metres(dims.height)} clear`, 5.2, 1.1, { bg: null, fg: INK });
    const label = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: tex })));
    label.scale.set(5.2, 1.1, 1);
    label.position.set(corner.x - 2.9, dims.height / 2, corner.z);
    this.scene.add(label);
  }

  private floorText(text: string, w: number, h: number, x: number, z: number) {
    const label = this.plane(text, w, h, { bg: null, fg: INK });
    label.rotation.x = -Math.PI / 2;
    label.position.set(x, 0.014, z);
    this.scene.add(label);
    return label;
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

  /** Vertical joints of the cladding panels, one every 2 m or so. */
  private panelTexture(length: number) {
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
    tex.repeat.set(Math.max(1, length / 32), 1);
    return tex;
  }

  // ---------- picks, selection, interaction ----------

  private clearMarkers() {
    for (const child of [...this.markers.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material & { map?: THREE.Texture };
      mat?.map?.dispose();
      mat?.dispose();
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
      if (!p || n >= 300) return;
      this.picked.setMatrixAt(n, m.makeScale(1, p.h, 1).setPosition(p.pos.x, p.pos.y + BASE_H + p.h / 2, p.pos.z));
      this.glow.setMatrixAt(n++, m.makeTranslation(p.pos.x, p.pos.y + 0.6, p.pos.z));

      // Numbered tag floating above the racking, with a drop line to the pallet.
      // Pallets on the same column (different levels) stack their tags.
      const column = `${p.pos.x},${p.pos.z}`;
      const k = stacked.get(column) ?? 0;
      stacked.set(column, k + 1);
      const top = p.pos.y + BASE_H + p.h;
      const tagY = Math.max(this.layout.rackTop + 2.3, top + 1.6) + k * 1.05;
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
    this.selectPin.position.set(p.pos.x, this.layout.rackTop + 1.4, p.pos.z);
  }

  private frame(points: THREE.Vector3[]) {
    if (!points.length) return;
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    center.y = this.layout.rackTop / 2; // mid-height, so the tags above the racks stay on screen
    this.targetGoal = center;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 8);
    const whole = Math.max(this.extent.x, this.extent.z) * 2;
    this.zoomGoal = THREE.MathUtils.clamp((whole * 0.85) / (span + 8), 1, 2.5);
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

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);

    // Size the view so the whole building fits the free area at zoom 1, whatever its proportions.
    const forward = VIEW_DIR.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward);
    const e = this.extent;
    const across = (v: THREE.Vector3) => e.x * Math.abs(v.x) + e.y * Math.abs(v.y) + e.z * Math.abs(v.z);
    const free = Math.max(w - this.leftInset, w * 0.5);
    const view = Math.max(across(up) * 2, (across(right) * 2 * h) / free) * 1.08;

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
    const max = this.chevrons.instanceMatrix.count;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    let walked = 0;
    let next = (t * 1.6) % spacing;
    for (let i = 1; i < this.route.length && n < max; i++) {
      const [x0, z0] = this.route[i - 1];
      const [x1, z1] = this.route[i];
      const len = Math.hypot(x1 - x0, z1 - z0);
      q.setFromAxisAngle(yAxis, Math.atan2(-(z1 - z0), x1 - x0));
      while (next <= walked + len && n < max) {
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
