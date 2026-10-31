// Everything the seed can work out without the database, worked out first.
//
// prisma/seed.ts calls planSeed() BEFORE it wipes anything. If the history, the planted cases, the racks
// or the dock plan do not add up on the day it runs, planSeed throws and the database is left as it was.
// scripts/seed-days-check.ts calls the very same function for 100+ different dates.
//
// Pure: no database, no clock (the date and the time of day come in as arguments), no network.

import { DOCK_CLOSE_H, firstFree, slotMinutes, type Busy } from "../src/lib/dock/slots";
import { generatedCode } from "../src/lib/pallets/codes";
import { makeLayout } from "../src/lib/warehouse/layout";
import { MIXED_CASE, simulateHistory, type HistOutbound, type HistoryInput, type Remaining } from "./history";
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
  mixed: `inbound:${MIXED_CASE.key}`,
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
  for (const o of shippedToday) book(o.warehouse, "out", { outbound: o.key }, at(0, 6, 30), slotMinutes("out", o.pallets), { status: "DONE" });

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


// ─── Stock on the floor, with a pallet ID on every pallet ─────────────────────────────────────

/** Days of shelf life of the products that carry a best-before date: made three days before it came in, plus this. */
export const SHELF_LIFE: Record<string, number> = {
  "AGUA-15": 540, "REFR-NAR": 300, "HORCH-1L": 240, "CREMA-50": 900, "GEL-750": 900, "CHAMP-400": 900, "COLONIA-1": 900,
  "TURRON-DUR": 365, "TURRON-BLA": 300, POLVORON: 240, MAZAPAN: 270,
};
/** Days from today to the best-before date of the oldest lot of these items, so the expiry alert has something to say. */
const EXPIRING_SOON: [string, number][] = [["HORCH-1L", 19], ["MAZAPAN", 26]];

/** Supplier IDs on the five pallets of masterbatch that came off the truck this morning (they travel with the pallet). */
export const MORNING_CODES = ["GMV-0581", "GMV-0582", "GMV-0583", "GMV-0584", "GMV-0585"];
const MORNING = { clientCode: "C006", sku: "MB-ROJO", lot: "L2698-41", location: "REC-3" };

/** One row of the `Stock` table as the seed will write it (references to inbounds and outbounds are names, turned into ids by the seed). */
export type StockPlanRow = {
  warehouse: string;
  clientCode: string;
  sku: string;
  lot: string | null;
  expiresAt: Date | null;
  /** 1 per physical pallet; 0 on the rows of a mixed pallet after its head (the row with the biggest share). */
  pallets: 0 | 1;
  units: number;
  location: string;
  /** Key of the history inbound, or one of REF.morning / REF.mixed. */
  inbound: string;
  /** REF.prepared(...) for the pallets waiting in a dispatch lane. */
  outbound: string | null;
  palletCode: string;
  /** null = a pallet of its own; the rows of a mixed pallet add up to 1. */
  palletShare: number | null;
  /** The loose pallet (12 boxes of PELUCHE-30): the origin of the 28 boxes that left in PED-7002. */
  loose?: boolean;
};

/** The pallet ID of each piece that left on an outbound, in the order of `HistOutbound.shipped`. */
export type ShippedMeta = { palletCode: string; palletShare: null; splitFrom: string | null };

/** The delivery that brought the mixed pallet (the seed writes it as an inbound of its own, with one line per item). */
export type MixedDelivery = {
  inbound: string;
  clientCode: string;
  warehouse: string;
  received: Date;
  code: string;
  lines: { sku: string; lot: string; units: number; expiresAt: Date; share: number }[];
};

type CodeRow = { warehouse: string; location: string; /** Rows with the same group are one pallet. */ group?: string; /** Supplier ID, if it came with one. */ code?: string };

const lane = (location: string) => (location.startsWith("EXP-") ? 1 : location.startsWith("REC-") ? 2 : 0);

/**
 * Gives every pallet its ID. Pure.
 * - A row with a supplier `code` keeps it and takes no number.
 * - Rows of the same `group` share one code (a mixed pallet).
 * - The rest get `N1-000123`: one counter per building, starting at `firstNo[building]`, in the order of the slots
 *   (racks by row, position and level; then the dispatch lanes; then the receiving lanes).
 * Returns the codes in the order of `rows` and the next free number of each building.
 */
export function assignSeedCodes(rows: CodeRow[], firstNo: Record<string, number> = {}): { codes: string[]; next: Record<string, number> } {
  const next = { ...firstNo };
  const codes = new Array<string>(rows.length);
  const ofGroup = new Map<string, string>();
  const order = rows
    .map((_, i) => i)
    .sort((a, b) => lane(rows[a].location) - lane(rows[b].location) || rows[a].location.localeCompare(rows[b].location, "en", { numeric: true }) || a - b);
  for (const i of order) {
    const r = rows[i];
    const known = r.code ?? (r.group ? ofGroup.get(r.group) : undefined);
    if (known) codes[i] = known;
    else {
      const n = next[r.warehouse] ?? 1;
      next[r.warehouse] = n + 1;
      codes[i] = generatedCode(r.warehouse, n);
    }
    if (r.group) ofGroup.set(r.group, codes[i]);
  }
  return { codes, next };
}

/** Share of a pallet each row of a mixed pallet takes (boxes / boxes that fit on a pallet, over the sum), so they add up to 1. */
function sharesOf(lines: { units: number; unitsPerPallet: number }[]): number[] {
  const parts = lines.map((l) => l.units / l.unitsPerPallet);
  const sum = parts.reduce((a, b) => a + b, 0);
  return parts.map((p) => p / sum);
}

type Balance = Remaining & { mixed?: boolean };

/** Places every pallet of the building: the racks (spread like in a real warehouse), the dispatch lanes and the receiving lane. */
function planStock({ today, history, balances, prepared }: { today: Date; history: ReturnType<typeof simulateHistory>; balances: Balance[]; prepared: Balance[][] }) {
  const unitsPerPallet = new Map(clients.flatMap((c) => c.items.map((i) => [i[0], i[3]] as const)));
  const upp = (sku: string) => unitsPerPallet.get(sku)!;
  const lotIndex = new Map(historyItems().map((i) => [i.sku, i.lotIndex]));
  const day = (d: Date) => d.getTime();

  // Best-before dates: the oldest lot of the "expiring soon" items, otherwise made three days before it came in plus the shelf life.
  const soon = new Map(EXPIRING_SOON);
  const expiryOf = new Map<Balance, Date | null>();
  for (const w of warehouses) {
    for (const b of balances.filter((x) => x.pallets > 0 && warehouseOf(x.clientCode).code === w.code)) {
      const life = SHELF_LIFE[b.sku];
      let expiresAt: Date | null = null;
      if (b.lot && life) {
        const days = soon.get(b.sku);
        soon.delete(b.sku);
        expiresAt = days !== undefined ? new Date(today.getTime() + days * DAY) : new Date(day(b.received) + (life - 3) * DAY);
      }
      expiryOf.set(b, expiresAt);
    }
  }

  // The mixed pallet's delivery, two days ago. POLVORON's date is the nearest of all the polvorones in the building.
  const mixedWarehouse = warehouseOf(MIXED_CASE.clientCode).code;
  const received = new Date(today.getTime() + (-MIXED_CASE.daysAgo * 24 * 60 + 9 * 60 + 10) * MIN);
  const doy = Math.floor((received.getTime() - new Date(received.getFullYear(), 0, 1).getTime()) / DAY) + 1;
  const nearest = [...expiryOf.entries()].filter(([b, e]) => b.sku === "POLVORON" && e).map(([, e]) => e!.getTime()).sort((a, b) => a - b)[0];
  const shares = sharesOf(MIXED_CASE.lines.map((l) => ({ units: l.units, unitsPerPallet: upp(l.sku) })));
  const mixed: MixedDelivery = {
    inbound: REF.mixed,
    clientCode: MIXED_CASE.clientCode,
    warehouse: mixedWarehouse,
    received,
    code: MIXED_CASE.code,
    lines: MIXED_CASE.lines.map((l, i) => ({
      sku: l.sku,
      lot: `LM${String(received.getFullYear()).slice(2)}${String(doy).padStart(3, "0")}-${String(lotIndex.get(l.sku)).padStart(2, "0")}`,
      units: l.units,
      expiresAt: new Date(l.sku === "POLVORON" && nearest ? nearest - DAY : day(received) + (SHELF_LIFE[l.sku] - 3) * DAY),
      share: shares[i],
    })),
  };

  const rows: StockPlanRow[] = [];
  const racks: SeedPlan["racks"] = [];
  const rackRand = makeRand(7); // its own numbers: the layout does not shift when something else in the seed changes
  for (const w of warehouses) {
    const slots = makeLayout(w.dims).rackSlotsInFillOrder();
    const physical: Balance[] = balances.filter((b) => b.pallets > 0 && warehouseOf(b.clientCode).code === w.code);
    if (w.code === mixedWarehouse) {
      // Next to the customer's turrón, so it keeps to its stretch of racking.
      const at = physical.map((b) => b.sku).lastIndexOf(MIXED_CASE.lines[0].sku);
      const pseudo: Balance = { sku: MIXED_CASE.lines[0].sku, clientCode: MIXED_CASE.clientCode, inboundKey: REF.mixed, lot: null, pallets: 1, received, mixed: true };
      physical.splice(at < 0 ? physical.length : at + 1, 0, pseudo);
    }
    const total = physical.reduce((sum, b) => sum + b.pallets, 0);
    if (total > slots.length) throw new Error(`${w.code} too small: ${total} pallets for ${slots.length} slots`);
    racks.push({ warehouse: w.code, pallets: total, slots: slots.length });

    let slot = 0;
    let placed = 0;
    for (const b of physical) {
      for (let i = 0; i < b.pallets; i++) {
        // Skip a slot with the probability that spreads the free space evenly.
        while (slots.length - slot > total - placed && rackRand() < (slots.length - slot - (total - placed)) / (slots.length - slot)) slot++;
        const location = slots[slot++];
        placed++;
        if (b.mixed) {
          mixed.lines.forEach((l, k) => {
            rows.push({
              warehouse: w.code, clientCode: b.clientCode, sku: l.sku, lot: l.lot, expiresAt: l.expiresAt, pallets: k === 0 ? 1 : 0, units: l.units, location,
              inbound: REF.mixed, outbound: null, palletCode: "", palletShare: l.share,
            });
          });
          continue;
        }
        const isLoose = b.loose !== undefined && i === b.pallets - 1;
        rows.push({
          warehouse: w.code, clientCode: b.clientCode, sku: b.sku, lot: b.lot, expiresAt: expiryOf.get(b) ?? null, pallets: 1, units: isLoose ? b.loose! : upp(b.sku),
          location, inbound: b.inboundKey, outbound: null, palletCode: "", palletShare: null, ...(isLoose ? { loose: true } : {}),
        });
      }
    }
  }

  // Picked this morning and waiting in the next dispatch lane of their building (planSeed has already checked there are enough).
  const lanesUsed = new Map<string, number>();
  PREPARED_TODAY.forEach(([clientCode, sku], k) => {
    const warehouse = warehouseOf(clientCode).code;
    const n = (lanesUsed.get(warehouse) ?? 0) + 1;
    lanesUsed.set(warehouse, n);
    for (const b of prepared[k]) {
      rows.push({
        warehouse, clientCode, sku, lot: b.lot, expiresAt: null, pallets: 1, units: upp(sku), location: `EXP-${n}`,
        inbound: b.inboundKey, outbound: REF.prepared(sku), palletCode: "", palletShare: null,
      });
    }
  });

  // Unloaded at 7:40 this morning, still on the floor of the receiving lane until put away.
  const morningWarehouse = warehouseOf(MORNING.clientCode).code;
  MORNING_CODES.forEach(() => {
    rows.push({
      warehouse: morningWarehouse, clientCode: MORNING.clientCode, sku: MORNING.sku, lot: MORNING.lot, expiresAt: null, pallets: 1, units: upp(MORNING.sku),
      location: MORNING.location, inbound: REF.morning, outbound: null, palletCode: "", palletShare: null,
    });
  });

  // The pieces that already left carry the numbers 1…S of their building; the pallets inside follow.
  const shipped = new Map<string, ShippedMeta[]>();
  const counter = new Map<string, number>();
  const loose = rows.find((r) => r.loose);
  for (const o of outboundsInOrder(history).all) {
    shipped.set(o.key, o.shipped.map((p) => {
      const n = (counter.get(o.warehouse) ?? 0) + 1;
      counter.set(o.warehouse, n);
      const piece = p.units !== undefined && p.units < upp(p.sku);
      if (piece && !(loose && loose.sku === p.sku && loose.inbound === p.inboundKey)) throw new Error(`${o.key}: a piece of ${p.sku} left from a pallet that is not the loose one`);
      return { palletCode: generatedCode(o.warehouse, n), palletShare: null, splitFrom: null };
    }));
  }

  const { codes, next } = assignSeedCodes(
    rows.map((r, i) => ({
      warehouse: r.warehouse, location: r.location,
      ...(r.inbound === REF.mixed ? { group: MIXED_CASE.code, code: MIXED_CASE.code } : {}),
      ...(r.inbound === REF.morning ? { code: MORNING_CODES[i - rows.findIndex((x) => x.inbound === REF.morning)] } : {}),
    })),
    Object.fromEntries(warehouses.map((w) => [w.code, (counter.get(w.code) ?? 0) + 1])),
  );
  rows.forEach((r, i) => (r.palletCode = codes[i]));
  // The 28 boxes that left PED-7002 came off the loose pallet: they carry its ID in `splitFrom`.
  for (const o of outboundsInOrder(history).all) {
    o.shipped.forEach((p, k) => {
      if (p.units !== undefined && p.units < upp(p.sku)) shipped.get(o.key)![k].splitFrom = loose!.palletCode;
    });
  }
  const nextPalletNo = Object.fromEntries(warehouses.map((w) => [w.code, next[w.code] ?? (counter.get(w.code) ?? 0) + 1]));
  return { rows, racks, mixed, shipped, nextPalletNo };
}

const CODE = /^[A-Z0-9][A-Z0-9-]{3,23}$/;

/** What must hold for every pallet of the seed. Throws with the first thing that does not. */
export function checkStockPlan({ rows, shipped }: { rows: StockPlanRow[]; shipped: Map<string, ShippedMeta[]> }) {
  const unitsPerPallet = new Map(clients.flatMap((c) => c.items.map((i) => [i[0], i[3]] as const)));
  const byCode = new Map<string, StockPlanRow[]>();
  for (const r of rows) byCode.set(r.palletCode, [...(byCode.get(r.palletCode) ?? []), r]);
  for (const [code, group] of byCode) {
    if (!CODE.test(code)) throw new Error(`Pallet ID ${code} is not a valid ID`);
    const [first] = group;
    if (group.some((r) => r.warehouse !== first.warehouse || r.location !== first.location || r.clientCode !== first.clientCode || r.outbound !== first.outbound)) {
      throw new Error(`Pallet ${code}: its rows are not in one place, of one customer and one outbound`);
    }
    if (group.reduce((s, r) => s + r.pallets, 0) !== 1) throw new Error(`Pallet ${code}: it must have exactly one row that counts as the pallet`);
    if (group.length === 1) {
      if (first.palletShare !== null) throw new Error(`Pallet ${code}: a pallet of one item has no share`);
    } else {
      const sum = group.reduce((s, r) => s + (r.palletShare ?? NaN), 0);
      if (!(Math.abs(sum - 1) < 1e-9)) throw new Error(`Mixed pallet ${code}: the shares add up to ${sum}, want 1`);
      const head = group.reduce((best, r) => ((r.palletShare ?? 0) > (best.palletShare ?? 0) ? r : best), group[0]);
      if (head.pallets !== 1) throw new Error(`Mixed pallet ${code}: the row with the biggest share must be the one that counts`);
    }
  }
  for (const r of rows) {
    const max = unitsPerPallet.get(r.sku)!;
    if (r.units < 1 || r.units > max) throw new Error(`Pallet ${r.palletCode}: ${r.units} boxes of ${r.sku} (1 to ${max} fit)`);
  }
  // One pallet per rack slot (the lanes hold many).
  const racks = rows.filter((r) => lane(r.location) === 0);
  const slots = new Set(racks.map((r) => `${r.warehouse}|${r.location}`));
  if (racks.reduce((s, r) => s + r.pallets, 0) !== slots.size) throw new Error("Two pallets share a rack slot");
  const gone = [...shipped.values()].flat().map((s) => s.palletCode);
  if (new Set(gone).size !== gone.length) throw new Error("Two pieces that left carry the same pallet ID");
  if (gone.some((c) => byCode.has(c))) throw new Error("A pallet ID of a piece that left is also on a pallet inside");
}

export type SeedPlan = {
  history: ReturnType<typeof simulateHistory>;
  /** The booked part of today's and tomorrow's dock plan (the history's DONE slots are in `history.slots`). */
  dock: DockBooking[];
  /** Pallets on the racks of each building once the prepared outbounds have left them (mixed pallet included), against the racking slots it has. */
  racks: { warehouse: string; pallets: number; slots: number }[];
  /** Every row of `Stock` the seed writes, with its pallet ID. */
  stock: StockPlanRow[];
  /** Pallet ID of each piece on each past outbound (keyed like the history), in the order of `shipped`. */
  shipped: Map<string, ShippedMeta[]>;
  /** The next number `Warehouse.nextPalletNo` must hold, per building. */
  nextPalletNo: Record<string, number>;
  mixed: MixedDelivery;
};

/**
 * Works out the whole seed in memory and throws if anything does not fit.
 * `rand` is consumed exactly as the seed always did (the history comes first), so the caller can go on using it.
 */
export function planSeed({ today, now, rand }: { today: Date; now: number; rand: () => number }): SeedPlan {
  const history = simulateHistory({ today, now, rand, carriers: carriers.length, items: historyItems() });

  // What is left of each delivery is today's stock; the prepared outbounds take their pallets first, oldest first.
  const balances: Balance[] = history.remaining.map((r) => ({ ...r }));
  const prepared: Balance[][] = [];
  for (const [clientCode, sku, , pallets] of PREPARED_TODAY) {
    const taken = takeOldest(balances.filter((b) => b.sku === sku && b.clientCode === clientCode), pallets);
    if (!taken) throw new Error(`Not enough ${sku} for the prepared outbound of ${pallets} pallets`);
    prepared.push(taken);
  }

  // Every pallet gets its own rack slot and its own ID (the mixed pallet's rows share a slot and an ID).
  const { rows, racks, mixed, shipped, nextPalletNo } = planStock({ today, history, balances, prepared });
  checkStockPlan({ rows, shipped });

  const dock = planDock({ today, now, outbounds: outboundsInOrder(history).all });
  return { history, dock, racks, stock: rows, shipped, nextPalletNo, mixed };
}
