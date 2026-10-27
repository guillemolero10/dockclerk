// Floor plan of a warehouse, worked out from the real measurements of the building.
// Shared by the seed, the server and the 3D view. Units are metres: x runs across
// the rack rows, z from the back wall (negative) to the dock wall (positive), y is up.
//
//   back wall
//   A | aisle | B C | aisle | D E | ... | aisle | last      ← as many rows as the width allows
//   ─────────────── cross aisle ───────────────
//   REC lanes (received, waiting for a slot)    EXP lanes (picked, waiting for the truck)
//   [inbound docks]                              [outbound docks]

// Pallet racking, the same in every building.
export const SLOT_W = 0.95; // pallet pitch along a row
export const LEVEL_H = 1.45;
export const RACK_D = 1.1;
export const BAY = 3; // pallets per beam
const BACK_TO_BACK = 0.1;
const WALL_GAP = 0.6;
const BACK_GAP = 1.2;

// Staging floor between the racks and the dock wall.
export const CROSS_AISLE_Z = 1.7;
export const LANE_Z0 = 3.9;
export const LANE_PITCH = 1.05;
export const LANE_SLOTS = 7;
const LANE_HALF = 0.75;
const DOCK_SPACING = 3.6;
export const DOCK_Z = LANE_Z0 + LANE_SLOTS * LANE_PITCH + 0.9;
const STAGING_DEPTH = DOCK_Z;

export type WarehouseDims = {
  /** Inside length, dock wall to back wall. */
  length: number;
  /** Inside width. */
  width: number;
  /** Clear height under the roof beams. */
  height: number;
  /** Set by the forklifts the warehouse uses. */
  aisleWidth: number;
  docks: number;
};

export const FORKLIFTS = [
  { label: "Counterbalance forklift", aisle: 3.6 },
  { label: "Reach truck", aisle: 3.0 },
  { label: "Very narrow aisle (VNA)", aisle: 1.9 },
];

export const LIMITS = {
  // Whole metres, so the form's 0.5 m steps land on valid values.
  length: { min: Math.ceil(STAGING_DEPTH + BACK_GAP + BAY * SLOT_W), max: 160 },
  width: { min: 9, max: 120 },
  height: { min: 3, max: 14 },
  docks: { min: 2, max: 12 },
};

export const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export type Location =
  | { kind: "rack"; row: string; position: number; level: number }
  | { kind: "floor"; zone: "REC" | "EXP"; lane: number };

export function rackCode(row: string, position: number, level: number) {
  return `${row}-${String(position).padStart(2, "0")}-${level}`;
}

export function parseLocation(code: string): Location | null {
  const rack = /^([A-Z])-(\d{2})-(\d)$/.exec(code);
  if (rack) return { kind: "rack", row: rack[1], position: Number(rack[2]), level: Number(rack[3]) };
  const floor = /^(REC|EXP)-(\d{1,2})$/.exec(code);
  if (floor) return { kind: "floor", zone: floor[1] as "REC" | "EXP", lane: Number(floor[2]) };
  return null;
}

export type Layout = ReturnType<typeof makeLayout>;

export function makeLayout(dims: WarehouseDims) {
  const { width, length, height, aisleWidth } = dims;

  // Rows: one against each side wall, back-to-back pairs in between, an aisle serving each pair of faces.
  const aisles = Math.max(1, Math.min(13, Math.floor((width - 2 * WALL_GAP + BACK_TO_BACK) / (aisleWidth + 2 * RACK_D + BACK_TO_BACK))));
  const rows = ROW_LETTERS.slice(0, aisles * 2);
  const used = 2 * RACK_D + (aisles - 1) * (2 * RACK_D + BACK_TO_BACK) + aisles * aisleWidth;
  const geometry = new Map<string, { x0: number; face: 1 | -1 }>();
  let x = -used / 2;
  rows.forEach((row, i) => {
    geometry.set(row, { x0: x, face: i % 2 === 0 ? 1 : -1 });
    x += RACK_D + (i % 2 === 0 ? aisleWidth : BACK_TO_BACK);
  });

  // Positions: whole bays that fit between the cross aisle and the back wall.
  const backZ = DOCK_Z - length;
  const bays = Math.max(1, Math.floor((-backZ - BACK_GAP) / (SLOT_W * BAY)));
  const positions = Math.min(99, bays * BAY);
  const levels = Math.max(1, Math.min(9, Math.floor((height - 0.6) / LEVEL_H)));

  // Docks: inbound on the left half, outbound on the right, two floor lanes each.
  const inbound = Math.ceil(dims.docks / 2);
  const outbound = Math.floor(dims.docks / 2);
  const spacing = (n: number) => Math.min(DOCK_SPACING, (width / 2 - WALL_GAP) / n);
  const dockRow = (n: number, center: number) => Array.from({ length: n }, (_, i) => center + (i - (n - 1) / 2) * spacing(n));
  const docks = [
    ...dockRow(inbound, -width / 4).map((dx, i) => ({ n: i + 1, x: dx, kind: "in" as const })),
    ...dockRow(outbound, width / 4).map((dx, i) => ({ n: inbound + i + 1, x: dx, kind: "out" as const })),
  ];
  const lanes = {
    REC: docks.filter((d) => d.kind === "in").flatMap((d) => [d.x - LANE_HALF, d.x + LANE_HALF]),
    EXP: docks.filter((d) => d.kind === "out").flatMap((d) => [d.x - LANE_HALF, d.x + LANE_HALF]),
  };

  const rowCenterX = (row: string) => geometry.get(row)!.x0 + RACK_D / 2;
  const rowFace = (row: string) => geometry.get(row)!.face;
  const aisleX = (row: string) => {
    const g = geometry.get(row)!;
    return g.face === 1 ? g.x0 + RACK_D + aisleWidth / 2 : g.x0 - aisleWidth / 2;
  };
  const positionZ = (position: number) => -(position - 0.5) * SLOT_W;
  const laneX = (zone: "REC" | "EXP", lane: number) => lanes[zone][lane - 1];

  return {
    dims,
    rows,
    positions,
    levels,
    capacity: rows.length * positions * levels,
    aisleXs: rows.filter((_, i) => i % 2 === 0).map(aisleX),
    rackDepthZ: positions * SLOT_W,
    rackTop: levels * LEVEL_H,
    docks,
    laneCount: { REC: lanes.REC.length, EXP: lanes.EXP.length },
    bounds: { minX: -width / 2, maxX: width / 2, minZ: backZ, maxZ: DOCK_Z },
    rowCenterX,
    rowFace,
    aisleX,
    positionZ,
    laneX,

    /** Whether a location code exists in this building. */
    contains(code: string) {
      const loc = parseLocation(code);
      if (!loc) return false;
      if (loc.kind === "floor") return loc.lane >= 1 && loc.lane <= lanes[loc.zone].length;
      return geometry.has(loc.row) && loc.position >= 1 && loc.position <= positions && loc.level >= 1 && loc.level <= levels;
    },

    /** Centre of the pallet's footprint, at floor/beam height. */
    rackSlotPosition(row: string, position: number, level: number) {
      return { x: rowCenterX(row), y: (level - 1) * LEVEL_H, z: positionZ(position) };
    },

    /** Pallets in a floor lane line up from the cross aisle towards the dock, then stack two high. */
    laneSlotPosition(zone: "REC" | "EXP", lane: number, index: number) {
      const along = index % LANE_SLOTS;
      const tier = Math.floor(index / LANE_SLOTS);
      return { x: laneX(zone, lane), y: tier * 1.25, z: LANE_Z0 + (along + 0.5) * LANE_PITCH };
    },

    /** Every rack slot in the order a person would fill the warehouse: row by row, front to back, bottom to top. */
    rackSlotsInFillOrder() {
      const slots: string[] = [];
      for (const row of rows) {
        for (let p = 1; p <= positions; p++) {
          for (let l = 1; l <= levels; l++) slots.push(rackCode(row, p, l));
        }
      }
      return slots;
    },
  };
}
