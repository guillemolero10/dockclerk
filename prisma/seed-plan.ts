// Everything the seed can work out without the database, worked out first.
//
// prisma/seed.ts calls planSeed() BEFORE it wipes anything. If the history, the planted cases, the racks
// or the dock plan do not add up on the day it runs, planSeed throws and the database is left as it was.
// scripts/seed-days-check.ts calls the very same function for 100+ different dates.
//
// Pure: no database, no clock (the date and the time of day come in as arguments), no network.

import { DOCK_CLOSE_H, firstFree, slotMinutes, type Busy } from "../src/lib/dock/slots";
import { makeLayout } from "../src/lib/warehouse/layout";
import { simulateHistory, type HistOutbound, type HistoryInput } from "./history";
import { BOOKED_TOMORROW, carriers, clients, PREPARED_TODAY, UPCOMING, warehouseOf, warehouses } from "./seed-data";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Deterministic pseudo-random numbers, so every run produces the same warehouse. */
export function makeRand(seed = 42) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Local midnight of a date: "today" for the seed. */
export function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The items the history is built for, in the order the seed creates them (the lot number follows that order). */
export function historyItems(): HistoryInput["items"] {
  let n = 0;
  return clients.flatMap((c) =>
    c.items.map(([sku, , , , tracksLot]) => {
      const w = warehouseOf(c.code);
      return { sku, clientCode: c.code, lotIndex: ++n, tracksLot, warehouse: w.code, docks: makeLayout(w.dims).docks };
    }),
  );
}

/** Takes `n` pallets from the rows in the order given (oldest first). Returns one row per pallet, or null if there are not enough. */
export function takeOldest<T extends { pallets: number }>(rows: T[], n: number): T[] | null {
  const free = rows.reduce((sum, r) => sum + Math.max(0, r.pallets), 0);
  if (free < n) return null;
  const taken: T[] = [];
  for (const r of rows) {
    while (r.pallets > 0 && taken.length < n) {
      r.pallets--;
      taken.push(r);
    }
  }
  return taken;
}

/** The past outbounds in the order the seed writes them: by date and deadline, then the planted cases. */
export function outboundsInOrder(history: { outbounds: HistOutbound[]; extraOutbounds: HistOutbound[] }) {
  const past = [...history.outbounds].sort((a, b) => a.date.getTime() - b.date.getTime() || a.deadline.getTime() - b.deadline.getTime());
  return { past, all: [...past, ...history.extraOutbounds] };
}

/** One booking of the dock plan. `inbound`/`outbound` are references the seed turns into ids. */
export type DockBooking = {
  warehouse: string;
  dock: number;
  start: Date;
  end: Date;
  status: "BOOKED" | "DONE";
  arrivedAt: Date | null;
  /** Index in `carriers`. */
  carrier: number | null;
  inbound?: string;
  outbound?: string;
};

/** References of the records the seed creates one by one (the history ones are keyed by the history itself). */
export const REF = {
  morning: "inbound:morning",
  expectedToys: "inbound:expected-toys",
  expectedDrinks: "inbound:expected-drinks",
  upcoming: (sku: string) => `outbound:upcoming:${sku}`,
  prepared: (sku: string) => `outbound:prepared:${sku}`,
};

/** Carriers of the trucks fixed for today (indexes in `carriers`). */
const MORNING_CARRIER = 1;
const TOYS_CARRIER = 0;
const DRINKS_CARRIER = 4;
const DRINKS_PALLETS = 18;

/**
 * Today's and tomorrow's dock plan. Some trucks are left without a slot on purpose,
 * so the clerk has something to schedule in the demo.
 * `now` is the clock time (ms): trucks of today are never booked in the past.
 */
export function planDock({ today, now, outbounds }: { today: Date; now: number; outbounds: HistOutbound[] }): DockBooking[] {
  const at = (dayOffset: number, h: number, m = 0) => new Date(today.getTime() + dayOffset * DAY + (h * 60 + m) * MIN);
  const busy = new Map<string, Busy[]>(warehouses.map((w) => [w.code, []]));
  const doors = (warehouse: string, kind: "in" | "out") =>
    makeLayout(warehouses.find((w) => w.code === warehouse)!.dims).docks.filter((d) => d.kind === kind).map((d) => d.n);
  const plan: DockBooking[] = [];

  function book(
    warehouse: string,
    kind: "in" | "out",
    link: { inbound: string } | { outbound: string },
    from: Date,
    minutes: number,
    extra: { status?: "BOOKED" | "DONE"; carrier?: number; dock?: number } = {},
  ) {
    const dayStart = startOfDay(from);
    const slot = firstFree(busy.get(warehouse)!, extra.dock ? [extra.dock] : doors(warehouse, kind), dayStart.getTime(), from.getTime(), minutes);
    if (!slot) throw new Error(`Seed dock plan does not fit: no free door in ${warehouse} for ${"inbound" in link ? link.inbound : link.outbound} (${minutes} min from ${from.toISOString()})`);
    busy.get(warehouse)!.push(slot);
    const status = extra.status ?? "BOOKED";
    plan.push({
      warehouse, dock: slot.dock, start: new Date(slot.start), end: new Date(slot.end), status,
      arrivedAt: status === "DONE" ? new Date(slot.start + 4 * MIN) : null, carrier: extra.carrier ?? null, ...link,
    });
  }

  // Done this morning.
  book(warehouseOf("C006").code, "in", { inbound: REF.morning }, at(0, 7, 30), slotMinutes("in", 5), { status: "DONE", carrier: MORNING_CARRIER, dock: 2 });
  // Outbounds shipped today (history order: the same every time).
  const shippedToday = outbounds.filter((o) => o.day >= -3 && o.date.getTime() >= today.getTime() && o.date.getTime() < at(1, 0).getTime());
  for (const o of shippedToday) book(o.warehouse, "out", { outbound: o.key }, at(0, 6, 30), slotMinutes("out", o.pallets));

  // Still to come today.
  // Never in the past, so the demo does not open with a late truck whatever time the data is reset.
  const halfHour = 30 * MIN;
  // Late in the day the slot is pulled back so it still ends before the dock closes.
  const soon = (h: number, minutes: number, after = 0) =>
    new Date(Math.min(at(0, DOCK_CLOSE_H).getTime() - minutes * MIN, Math.max(at(0, h).getTime(), Math.ceil((now + halfHour) / halfHour) * halfHour) + after));
  const toysMinutes = slotMinutes("in", null);
  const drinksMinutes = slotMinutes("in", DRINKS_PALLETS);
  book(warehouseOf("C001").code, "in", { inbound: REF.expectedToys }, soon(10, toysMinutes), toysMinutes, { carrier: TOYS_CARRIER, dock: 1 });
  book(warehouseOf("C004").code, "in", { inbound: REF.expectedDrinks }, soon(12, drinksMinutes, halfHour), drinksMinutes, { carrier: DRINKS_CARRIER });
  // The first prepared outbound is booked; the second still needs a door.
  const first = [...PREPARED_TODAY].sort((a, b) => a[4] - b[4])[0];
  book(warehouseOf(first[0]).code, "out", { outbound: REF.prepared(first[1]) }, new Date(at(0, 0).getTime() + first[4] * 60 * MIN - 3 * 60 * MIN), slotMinutes("out", first[3]));

  // Tomorrow: two pick-ups already booked, the rest waits for the clerk.
  for (const sku of BOOKED_TOMORROW) {
    const [clientCode, , , pallets, inDays, hour] = UPCOMING.find((u) => u[1] === sku)!;
    const deadline = new Date(at(inDays, 0).getTime() + hour * 60 * MIN);
    book(warehouseOf(clientCode).code, "out", { outbound: REF.upcoming(sku) }, new Date(deadline.getTime() - 3 * 60 * MIN), slotMinutes("out", pallets));
  }
  return plan;
}

export type SeedPlan = {
  history: ReturnType<typeof simulateHistory>;
  /** The booked part of today's and tomorrow's dock plan (the history's DONE slots are in `history.slots`). */
  dock: DockBooking[];
  /** Pallets on the racks of each building once the prepared outbounds have left them, against the racking slots it has. */
  racks: { warehouse: string; pallets: number; slots: number }[];
};

/**
 * Works out the whole seed in memory and throws if anything does not fit.
 * `rand` is consumed exactly as the seed always did (the history comes first), so the caller can go on using it.
 */
export function planSeed({ today, now, rand }: { today: Date; now: number; rand: () => number }): SeedPlan {
  const history = simulateHistory({ today, now, rand, carriers: carriers.length, items: historyItems() });

  // What is left of each delivery is today's stock; the prepared outbounds take their pallets first, oldest first.
  const balances = history.remaining.map((r) => ({ ...r }));
  for (const [clientCode, sku, , pallets] of PREPARED_TODAY) {
    const taken = takeOldest(balances.filter((b) => b.sku === sku && b.clientCode === clientCode), pallets);
    if (!taken) throw new Error(`Not enough ${sku} for the prepared outbound of ${pallets} pallets`);
  }

  // Every pallet gets its own rack slot.
  const racks = warehouses.map((w) => {
    const pallets = balances.filter((b) => warehouseOf(b.clientCode).code === w.code).reduce((sum, b) => sum + b.pallets, 0);
    const slots = makeLayout(w.dims).rackSlotsInFillOrder().length;
    if (pallets > slots) throw new Error(`${w.code} too small: ${pallets} pallets for ${slots} slots`);
    return { warehouse: w.code, pallets, slots };
  });

  const dock = planDock({ today, now, outbounds: outboundsInOrder(history).all });
  return { history, dock, racks };
}
