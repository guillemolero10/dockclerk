// Which pallets each open outbound should take. Pure function, shared by the
// office 3D view and the operator's picking list so both always agree.
//
// Rules: an outbound leaves from one warehouse, the one that can fill most of it;
// inside it, first expiring first out for lots, otherwise first in first out;
// ties go to the lower location so the route stays short.
// Everything is counted in units. Whole rows are taken while the order still needs at least
// the whole row; what is left is taken from the next row ("take N boxes"), which stays behind
// as a loose pallet in its slot.

import { describeUnits, unitWordFor } from "../pallets/quantity";

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
  /** Pallet ID. Rows with the same ID are one physical (mixed) pallet. null/undefined = an old row without one. */
  palletCode?: string | null;
};

export type OpenOrder = {
  id: string;
  number: number;
  date: Date;
  deadline: Date | null;
  /** `unitsPerPallet` is the item's own figure (a full pallet), not what happens to be in stock. */
  lines: { itemId: string; units: number; unitsPerPallet: number }[];
};

/**
 * What the operator does, one step at a time. A pallet that leaves with all its rows is one `pallet` step (it keeps its ID);
 * anything else is a `boxes` step: those boxes go onto a new pallet with a new ID (a mixed pallet stays behind with the rest).
 */
export type PickStep =
  | { kind: "pallet"; palletCode: string | null; stockIds: string[]; location: string }
  | { kind: "boxes"; stockId: string; units: number; palletCode: string | null; location: string; mixed: boolean };

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
  /** Same shortage in pallet positions (⌈units / the item's units per pallet⌉, line by line). */
  short: number;
  /** The shortage by item, for screens that name what is missing (see `describeShortage`). */
  shortLines: { itemId: string; units: number; unitsPerPallet: number }[];
  /** The work still to do, grouped by physical pallet (rows already picked are not here). */
  steps: PickStep[];
};

/**
 * What is missing, in the item's own unit and sku, for the office screens: "2 palés + 20 cajas of PELUCHE-30"
 * (several lines joined by " and ").
 * A shortage of boxes is never written as pallets: 120 boxes of an item that has 100 per pallet are "1 palé + 20 cajas".
 */
export function describeShortage(
  lines: PickPlan["shortLines"],
  itemOf: (itemId: string) => { sku: string; unit: "PALLET" | "BOX" | "BAG" } | undefined,
) {
  return lines
    .map((l) => {
      const item = itemOf(l.itemId);
      return `${describeUnits(l.units, l.unitsPerPallet, item ? unitWordFor(item.unit) : "cajas")}${item ? ` of ${item.sku}` : ""}`;
    })
    .join(" and ");
}

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

    const plan: PickPlan = { warehouseId: best, stockIds: picked.map((s) => s.id), picked: picked.map((s) => s.id), split: [], shortUnits: 0, short: 0, shortLines: [], steps: [] };
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
        const perPallet = Math.max(1, line.unitsPerPallet);
        plan.shortLines.push({ itemId: line.itemId, units: missing, unitsPerPallet: perPallet });
        plan.short += Math.ceil(missing / perPallet);
      }
    }
    plan.steps = stepsOf(plan, stock);
    plans.set(order.id, plan);
  }
  return plans;
}

/**
 * Groups the rows still to pick by physical pallet. If the plan takes every row of a pallet whole, that is one `pallet` step.
 * Otherwise each row it touches is a `boxes` step and goes in `split` even when the whole row is taken (the pallet stays behind).
 */
function stepsOf(plan: PickPlan, stock: PickableStock[]): PickStep[] {
  const todo = plan.stockIds.filter((id) => !plan.picked.includes(id));
  const todoSet = new Set(todo);
  const byId = new Map(stock.map((s) => [s.id, s]));
  const cut = new Map(plan.split.map((p) => [p.stockId, p.units]));
  const steps: PickStep[] = [];
  const done = new Set<string>();
  for (const id of todo) {
    if (done.has(id)) continue;
    const row = byId.get(id)!;
    const code = row.palletCode ?? null;
    const siblings = code ? stock.filter((s) => s.palletCode === code && s.warehouseId === row.warehouseId) : [row];
    const whole = siblings.every((s) => !s.outboundId && todoSet.has(s.id) && !cut.has(s.id));
    if (whole) {
      siblings.forEach((s) => done.add(s.id));
      steps.push({ kind: "pallet", palletCode: code, stockIds: siblings.map((s) => s.id), location: row.location });
      continue;
    }
    done.add(id);
    const units = cut.get(id) ?? row.units;
    if (!cut.has(id)) plan.split.push({ stockId: id, units });
    steps.push({ kind: "boxes", stockId: id, units, palletCode: code, location: row.location, mixed: siblings.length > 1 });
  }
  return steps;
}
