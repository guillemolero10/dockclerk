// Which pallets each open outbound should take. Pure function, shared by the
// office 3D view and the operator's picking list so both always agree.
//
// Rules: an outbound leaves from one warehouse, the one that can fill most of it;
// inside it, first expiring first out for lots, otherwise first in first out;
// ties go to the lower location so the route stays short.
// Everything is counted in units. Whole rows are taken while the order still needs at least
// the whole row; what is left is taken from the next row ("take N boxes"), which stays behind
// as a loose pallet in its slot.

export type PickableStock = {
  id: string;
  warehouseId: string;
  itemId: string;
  location: string;
  /** Units on this row (a full pallet, or less for a loose pallet). */
  units: number;
  expiresAt: Date | null;
  receivedAt: Date | null;
  /** Already picked for this outbound. */
  outboundId: string | null;
};

export type OpenOrder = {
  id: string;
  number: number;
  date: Date;
  deadline: Date | null;
  lines: { itemId: string; units: number }[];
};

export type PickPlan = {
  warehouseId: string | null;
  /** Rows to take from (whole or in part), plus the ones already picked, in no particular order. */
  stockIds: string[];
  /** The ones already picked. */
  picked: string[];
  /** Rows of which only some units are taken: the row stays in its slot with the rest. */
  split: { stockId: string; units: number }[];
  /** Units that cannot be served from stock. */
  shortUnits: number;
  /** Same shortage in pallet positions (⌈shortUnits / units per pallet⌉), for screens that count pallets. */
  short: number;
};

const time = (d: Date | null, fallback: number) => (d ? d.getTime() : fallback);

export function allocatePicks(stock: PickableStock[], orders: OpenOrder[]): Map<string, PickPlan> {
  const byItem = new Map<string, PickableStock[]>();
  for (const s of stock) {
    if (!byItem.has(s.itemId)) byItem.set(s.itemId, []);
    byItem.get(s.itemId)!.push(s);
  }
  for (const list of byItem.values()) {
    list.sort(
      (a, b) =>
        time(a.expiresAt, Infinity) - time(b.expiresAt, Infinity) ||
        time(a.receivedAt, 0) - time(b.receivedAt, 0) ||
        a.location.localeCompare(b.location),
    );
  }
  const warehouses = [...new Set(stock.map((s) => s.warehouseId))].sort();
  // A full pallet of each item, to turn missing units into pallet positions.
  const perPallet = new Map<string, number>();
  for (const s of stock) perPallet.set(s.itemId, Math.max(perPallet.get(s.itemId) ?? 1, s.units));

  // The most urgent order gets first pick.
  const queue = [...orders].sort(
    (a, b) => time(a.deadline ?? a.date, 0) - time(b.deadline ?? b.date, 0) || a.number - b.number,
  );

  // Rows already picked belong to their outbound and nobody else. Units still free on each other row:
  // an order that takes part of a row leaves the rest for the next order.
  const left = new Map(stock.filter((s) => !s.outboundId).map((s) => [s.id, s.units]));
  const free = (itemId: string, warehouseId: string) =>
    (byItem.get(itemId) ?? []).filter((s) => s.warehouseId === warehouseId && (left.get(s.id) ?? 0) > 0);
  const freeUnits = (itemId: string, warehouseId: string) => free(itemId, warehouseId).reduce((sum, s) => sum + left.get(s.id)!, 0);

  const plans = new Map<string, PickPlan>();
  for (const order of queue) {
    const picked = stock.filter((s) => s.outboundId === order.id);
    const pickedOf = (itemId: string) => picked.filter((s) => s.itemId === itemId).reduce((sum, s) => sum + s.units, 0);

    // Once picking has started, the outbound stays in that building.
    let best: string | null = picked[0]?.warehouseId ?? null;
    if (!best) {
      let bestFill = 0;
      for (const w of warehouses) {
        const fill = order.lines.reduce((sum, l) => sum + Math.min(l.units, freeUnits(l.itemId, w)), 0);
        if (fill > bestFill) [best, bestFill] = [w, fill];
      }
    }

    const plan: PickPlan = { warehouseId: best, stockIds: picked.map((s) => s.id), picked: picked.map((s) => s.id), split: [], shortUnits: 0, short: 0 };
    for (const line of order.lines) {
      let missing = line.units - pickedOf(line.itemId);
      for (const s of best ? free(line.itemId, best) : []) {
        if (missing <= 0) break;
        const here = left.get(s.id)!;
        plan.stockIds.push(s.id);
        // Take the whole row while the order still needs all of it; otherwise only what is missing.
        const take = Math.min(missing, here);
        left.set(s.id, here - take);
        // A row another order already took part of is also a partial pick, even if this order takes all that is left.
        if (take < s.units) plan.split.push({ stockId: s.id, units: take });
        missing -= take;
      }
      if (missing > 0) {
        plan.shortUnits += missing;
        plan.short += Math.ceil(missing / (perPallet.get(line.itemId) ?? 1));
      }
    }
    plans.set(order.id, plan);
  }
  return plans;
}
