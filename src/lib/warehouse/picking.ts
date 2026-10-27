// Which pallets each open outbound should take. Pure function, shared by the
// office 3D view and the operator's picking list so both always agree.
//
// Rules: an outbound leaves from one warehouse, the one that can fill most of it;
// inside it, first expiring first out for lots, otherwise first in first out;
// ties go to the lower location so the route stays short.

export type PickableStock = {
  id: string;
  warehouseId: string;
  itemId: string;
  location: string;
  pallets: number;
  expiresAt: Date | null;
  receivedAt: Date | null;
};

export type OpenOrder = {
  id: string;
  number: number;
  date: Date;
  deadline: Date | null;
  lines: { itemId: string; pallets: number }[];
};

export type PickPlan = { warehouseId: string | null; stockIds: string[]; short: number };

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

  // The most urgent order gets first pick.
  const queue = [...orders].sort(
    (a, b) => time(a.deadline ?? a.date, 0) - time(b.deadline ?? b.date, 0) || a.number - b.number,
  );

  const taken = new Set<string>();
  const free = (itemId: string, warehouseId: string) =>
    (byItem.get(itemId) ?? []).filter((s) => s.warehouseId === warehouseId && !taken.has(s.id));

  const plans = new Map<string, PickPlan>();
  for (const order of queue) {
    let best: string | null = null;
    let bestFill = 0;
    for (const w of warehouses) {
      const fill = order.lines.reduce((sum, l) => sum + Math.min(l.pallets, free(l.itemId, w).reduce((p, s) => p + s.pallets, 0)), 0);
      if (fill > bestFill) [best, bestFill] = [w, fill];
    }

    const plan: PickPlan = { warehouseId: best, stockIds: [], short: 0 };
    for (const line of order.lines) {
      let missing = line.pallets;
      for (const s of best ? free(line.itemId, best) : []) {
        if (missing <= 0) break;
        taken.add(s.id);
        plan.stockIds.push(s.id);
        missing -= s.pallets;
      }
      plan.short += Math.max(0, missing);
    }
    plans.set(order.id, plan);
  }
  return plans;
}
