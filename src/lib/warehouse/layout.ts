// Floor plan of the demo warehouse, shared by the seed, the server and the 3D view.
// Units are metres. x runs across the rack rows, z from the back wall (negative)
// to the dock wall (positive), y is up.
//
//   back wall
//   A | aisle | B C | aisle | D E | aisle | F G | aisle | H      ← 8 rack rows, 21 positions deep, 5 levels
//   ─────────────────── cross aisle ───────────────────
//   REC-1..4 (received, waiting for a slot)    EXP-1..4 (picked, waiting for the truck)
//   [dock 1]  [dock 2]                          [dock 3]  [dock 4]

export const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type RowLetter = (typeof ROWS)[number];
export const POSITIONS = 21; // 7 bays of 3 pallets
export const LEVELS = 5;
export const RACK_CAPACITY = ROWS.length * POSITIONS * LEVELS;

export const SLOT_W = 0.95; // pallet pitch along a row
export const LEVEL_H = 1.45;
export const RACK_D = 1.1;
export const AISLE_W = 3.2;
export const BAY = 3;

const BACK_TO_BACK = 0.1;
const WIDTH = 2 * RACK_D + 3 * (2 * RACK_D + BACK_TO_BACK) + 4 * AISLE_W;

/** Left edge of each row, and which side its pallets face (+1 = towards +x). */
const ROW_GEOMETRY: Record<RowLetter, { x0: number; face: 1 | -1 }> = (() => {
  const out = {} as Record<RowLetter, { x0: number; face: 1 | -1 }>;
  let x = -WIDTH / 2;
  ROWS.forEach((row, i) => {
    out[row] = { x0: x, face: i % 2 === 0 ? 1 : -1 };
    x += RACK_D;
    // After an even-indexed row comes an aisle; after an odd one, its back-to-back partner.
    x += i % 2 === 0 ? AISLE_W : BACK_TO_BACK;
  });
  return out;
})();

export function rowCenterX(row: RowLetter) {
  return ROW_GEOMETRY[row].x0 + RACK_D / 2;
}

export function rowFace(row: RowLetter) {
  return ROW_GEOMETRY[row].face;
}

/** x of the centre line of the aisle that serves this row. */
export function aisleX(row: RowLetter) {
  const g = ROW_GEOMETRY[row];
  return g.face === 1 ? g.x0 + RACK_D + AISLE_W / 2 : g.x0 - AISLE_W / 2;
}

export const AISLE_XS = [0, 2, 4, 6].map((i) => aisleX(ROWS[i]));

export function positionZ(position: number) {
  return -(position - 0.5) * SLOT_W;
}

export const RACK_DEPTH_Z = POSITIONS * SLOT_W;
export const CROSS_AISLE_Z = 1.7;

// Floor lanes by the docks.
export const LANE_PITCH = 1.05;
export const LANE_SLOTS = 7;
export const LANE_Z0 = 3.9;
export const LANE_COUNT = 4;
// Two lanes per dock door, receiving on the left, dispatch on the right.
const REC_X = [-9.6, -8.1, -6.0, -4.5];
export function laneX(zone: "REC" | "EXP", lane: number) {
  const x = REC_X[lane - 1];
  return zone === "REC" ? x : -REC_X[LANE_COUNT - lane];
}
export const DOCK_Z = LANE_Z0 + LANE_SLOTS * LANE_PITCH + 0.9;
export const DOCKS = [
  { n: 1, x: (laneX("REC", 1) + laneX("REC", 2)) / 2, kind: "in" as const },
  { n: 2, x: (laneX("REC", 3) + laneX("REC", 4)) / 2, kind: "in" as const },
  { n: 3, x: (laneX("EXP", 1) + laneX("EXP", 2)) / 2, kind: "out" as const },
  { n: 4, x: (laneX("EXP", 3) + laneX("EXP", 4)) / 2, kind: "out" as const },
];

export const BOUNDS = {
  minX: -WIDTH / 2 - 1.2,
  maxX: WIDTH / 2 + 1.2,
  minZ: -RACK_DEPTH_Z - 1.2,
  maxZ: DOCK_Z,
};

export type Location =
  | { kind: "rack"; row: RowLetter; position: number; level: number }
  | { kind: "floor"; zone: "REC" | "EXP"; lane: number };

export function rackCode(row: RowLetter, position: number, level: number) {
  return `${row}-${String(position).padStart(2, "0")}-${level}`;
}

export function parseLocation(code: string): Location | null {
  const rack = /^([A-H])-(\d{2})-(\d)$/.exec(code);
  if (rack) return { kind: "rack", row: rack[1] as RowLetter, position: Number(rack[2]), level: Number(rack[3]) };
  const floor = /^(REC|EXP)-(\d)$/.exec(code);
  if (floor) return { kind: "floor", zone: floor[1] as "REC" | "EXP", lane: Number(floor[2]) };
  return null;
}

/** Centre of the pallet's footprint, at floor/beam height. */
export function rackSlotPosition(row: RowLetter, position: number, level: number) {
  return { x: rowCenterX(row), y: (level - 1) * LEVEL_H, z: positionZ(position) };
}

/** Pallets in a floor lane line up from the cross aisle towards the dock, then stack two high. */
export function laneSlotPosition(zone: "REC" | "EXP", lane: number, index: number) {
  const along = index % LANE_SLOTS;
  const tier = Math.floor(index / LANE_SLOTS);
  return { x: laneX(zone, lane), y: tier * 1.25, z: LANE_Z0 + (along + 0.5) * LANE_PITCH };
}

/** Every rack slot in the order a person would fill the warehouse: row by row, front to back, bottom to top. */
export function rackSlotsInFillOrder() {
  const slots: string[] = [];
  for (const row of ROWS) {
    for (let p = 1; p <= POSITIONS; p++) {
      for (let l = 1; l <= LEVELS; l++) slots.push(rackCode(row, p, l));
    }
  }
  return slots;
}
