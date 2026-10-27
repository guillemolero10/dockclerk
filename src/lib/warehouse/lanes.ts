// Where things go on the floor: which lane a delivery or an outbound uses,
// and which free rack slot a received pallet should be put away in.

import { parseLocation, type Layout } from "./layout";

type Placed = { location: string; outboundId?: string | null };

const lanePallets = (stock: Placed[], code: string) => stock.filter((s) => s.location === code).length;

/** Dispatch lane of an outbound: where its pallets already are, else the emptiest one. */
export function dispatchLane(layout: Layout, stock: Placed[], outboundId: string) {
  const mine = stock.find((s) => s.outboundId === outboundId && s.location.startsWith("EXP-"));
  if (mine) return Number(mine.location.slice(4));
  const lanes = Array.from({ length: layout.laneCount.EXP }, (_, i) => i + 1);
  return lanes.reduce((best, lane) => (lanePallets(stock, `EXP-${lane}`) < lanePallets(stock, `EXP-${best}`) ? lane : best), 1);
}

/** Receiving lane next to an inbound dock door: the emptier of its two lanes. */
export function receivingLane(layout: Layout, stock: Placed[], dock: number) {
  const doors = layout.docks.filter((d) => d.kind === "in");
  const index = Math.max(0, doors.findIndex((d) => d.n === dock));
  const lanes = [index * 2 + 1, index * 2 + 2].filter((l) => l <= layout.laneCount.REC);
  return lanes.reduce((best, lane) => (lanePallets(stock, `REC-${lane}`) < lanePallets(stock, `REC-${best}`) ? lane : best), lanes[0] ?? 1);
}

/**
 * Free rack slot for a pallet: next to where that customer already keeps goods,
 * lower levels first (quicker for the forklift), else the first free slot in the building.
 */
export function suggestSlot(layout: Layout, occupied: Set<string>, customerLocations: string[]) {
  const free = layout.rackSlotsInFillOrder().filter((code) => !occupied.has(code));
  if (!free.length) return null;
  const mine = customerLocations.map(parseLocation).filter((l) => l?.kind === "rack") as { row: string; position: number; level: number }[];
  if (!mine.length) return free[0];

  const rowIndex = (row: string) => layout.rows.indexOf(row);
  let best = free[0];
  let bestScore = Infinity;
  for (const code of free) {
    const slot = parseLocation(code) as { row: string; position: number; level: number };
    const near = Math.min(...mine.map((m) => Math.abs(rowIndex(m.row) - rowIndex(slot.row)) * 4 + Math.abs(m.position - slot.position)));
    const score = near + (slot.level - 1) * 0.8;
    if (score < bestScore) [best, bestScore] = [code, score];
  }
  return best;
}
