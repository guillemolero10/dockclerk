// Six months of warehouse life, so the analyst has something to study.
//
// How it is built:
// 1. Demand: every item ships orders following its season, the weekday and some noise.
// 2. Replenishment is worked out *backwards* from the stock the demo needs today: walking back
//    day by day, a delivery is placed whenever the stock would climb above its high mark.
//    Read forwards, stock runs down and a truck refills it, and it ends exactly at today's
//    figure without ever going negative.
// 3. Forwards again, each shipment takes the oldest lots first, so every pallet that left
//    keeps its lot (traceability) and what is left is today's stock, lot by lot.
// 4. Every truck gets a dock slot without overlaps and an arrival time.
//
// Planted on purpose, so the demo never depends on luck (all data is invented):
// - toys and turrón climb towards Christmas; drinks and sandals peaked in summer;
// - MUNECA-CL demand doubles while its stock is low (stock-out coming);
// - turrón, polvorones and marzipan pile up in N2 ahead of the season (N2 fills up);
// - Rápidos Carrasqueta arrives late on Mondays;
// - delivery notes from the toy maker's Ibi warehouse often do not match the pallets on the truck;
// - Rutas del Vinalopó delivers more damaged pallets than the other carriers;
// - Polímeros Serra Mariola keeps a lot of slow stock (much space, little movement).
// Planted for the pallet and billing demo (plantPalletCases; they use no random numbers and exist on every date):
// - 23 pallets of puzzles came in on the 20th of last month and 2 left on the 2nd of this one. This delivery is
//   *added* on top of the simulated history (the 21 pallets still in the building are held back from PUZZLE-500's
//   target, see PLANTED_STOCK), so it never depends on what the random history happens to contain;
// - one loose pallet of 12 boxes of PELUCHE-30 (a 28-box order took the rest of its pallet).

import { firstFree, slotMinutes, type Busy } from "../src/lib/dock/slots";

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

export const HISTORY_DAYS = 182;

type Season = "flat" | "christmas" | "summer" | "winter" | "turron";

/** Demand profile: pallets a day on an ordinary weekday, season, pallets per order. */
export const DEMAND: Record<string, { rate: number; season: Season; order: [number, number]; buildUp?: boolean }> = {
  "PELUCHE-30": { rate: 0.9, season: "christmas", order: [2, 8] },
  "PELUCHE-50": { rate: 0.5, season: "christmas", order: [2, 6] },
  "MUNECA-CL": { rate: 0.75, season: "christmas", order: [2, 6] },
  "PUZZLE-500": { rate: 0.8, season: "christmas", order: [2, 8] },
  "PP-NAT": { rate: 1.2, season: "flat", order: [4, 12] },
  "PE-AD": { rate: 0.12, season: "flat", order: [2, 5] },
  "ABS-NEG": { rate: 0.15, season: "flat", order: [2, 5] },
  "ZAP-RUN-42": { rate: 0.8, season: "flat", order: [1, 6] },
  "ZAP-RUN-40": { rate: 0.7, season: "flat", order: [1, 6] },
  "BOTA-INV": { rate: 0.6, season: "winter", order: [1, 6] },
  "SAND-VER": { rate: 0.7, season: "summer", order: [1, 6] },
  "AGUA-15": { rate: 1.6, season: "summer", order: [3, 10] },
  "REFR-NAR": { rate: 1.3, season: "summer", order: [3, 10] },
  "HORCH-1L": { rate: 0.7, season: "summer", order: [2, 6] },
  "TOALLA-BL": { rate: 0.7, season: "flat", order: [1, 5] },
  "SABANA-90": { rate: 0.6, season: "flat", order: [1, 5] },
  "MANTA-SOF": { rate: 0.4, season: "winter", order: [1, 5] },
  "PVC-BLA": { rate: 1.0, season: "flat", order: [2, 8] },
  "MB-ROJO": { rate: 0.5, season: "flat", order: [2, 6] },
  "PS-CRIS": { rate: 0.6, season: "flat", order: [2, 8] },
  "CREMA-50": { rate: 0.6, season: "flat", order: [1, 4] },
  "GEL-750": { rate: 0.7, season: "flat", order: [1, 4] },
  "CHAMP-400": { rate: 0.7, season: "flat", order: [1, 4] },
  "COLONIA-1": { rate: 0.3, season: "flat", order: [1, 4] },
  "TURRON-DUR": { rate: 0.6, season: "turron", order: [2, 10] },
  "TURRON-BLA": { rate: 0.4, season: "turron", order: [2, 8], buildUp: true },
  POLVORON: { rate: 0.4, season: "turron", order: [2, 8], buildUp: true },
  MAZAPAN: { rate: 0.3, season: "turron", order: [2, 8], buildUp: true },
};

/** Pallets in the building today, before the prepared and requested outbounds take theirs. N1 ≈ 77 %, N2 ≈ 90 %. */
export const TODAY_STOCK: Record<string, number> = {
  "PELUCHE-30": 34, "PELUCHE-50": 22, "MUNECA-CL": 14, "PUZZLE-500": 30,
  "PP-NAT": 40, "PE-AD": 58, "ABS-NEG": 46,
  "ZAP-RUN-42": 24, "ZAP-RUN-40": 20, "BOTA-INV": 30, "SAND-VER": 26,
  "AGUA-15": 30, "REFR-NAR": 24, "HORCH-1L": 14,
  "TOALLA-BL": 22, "SABANA-90": 18, "MANTA-SOF": 30,
  "PVC-BLA": 26, "MB-ROJO": 12, "PS-CRIS": 20,
  "CREMA-50": 16, "GEL-750": 18, "CHAMP-400": 20, "COLONIA-1": 12,
  "TURRON-DUR": 18, "TURRON-BLA": 40, POLVORON: 42, MAZAPAN: 36,
};

/** The billing case: this many pallets came in on the 20th of last month and `leaving` of them go out on the 2nd of this one. */
export const PUZZLE_CASE = { sku: "PUZZLE-500", clientCode: "C001", pallets: 23, leaving: 2, key: "in-case-puzzle" } as const;

/**
 * Pallets of today's stock that are not simulated: plantPalletCases adds them as a delivery of their own,
 * so the simulated part of that item targets TODAY_STOCK minus this and the total stays what the table above says.
 */
export const PLANTED_STOCK: Record<string, number> = { [PUZZLE_CASE.sku]: PUZZLE_CASE.pallets - PUZZLE_CASE.leaving };

/** Where each customer's goods usually go. */
export const DESTINATIONS: Record<string, string[]> = {
  C001: ["D0412", "D0413", "D0950", "D0520"],
  C002: ["D0800", "D0801", "D0802"],
  C003: ["D0700", "D0701", "D0520", "D0521"],
  C004: ["D0412", "D0413", "D0520", "D0521", "D0610"],
  C005: ["D0700", "D0701", "D0951"],
  C006: ["D0800", "D0801", "D0802"],
  C007: ["D0900", "D0901", "D0610"],
  C008: ["D0610", "D0611", "D0412", "D0520"],
};

/** The plants each customer's goods come from. */
export const PLANTS: Record<string, string[]> = {
  C001: ["Juguetes Levante – Fábrica Onil", "Juguetes Levante – Almacén Ibi"],
  C002: ["Polímeros Serra Mariola – Planta Alcoy"],
  C003: ["Calzados Vinalopó Sur – Fábrica Elda", "Calzados Vinalopó Sur – Taller Petrer"],
  C004: ["Bebidas Montgó – Planta de Pedreguer"],
  C005: ["Textil Biar – Fábrica Biar"],
  C006: ["Granzas del Mediterráneo – Planta Villena"],
  C007: ["Cosmética Aitana – Laboratorio Alcoy"],
  C008: ["Dulces Carrascal – Obrador Jijona", "Dulces Carrascal – Planta Castalla"],
};

// Planted patterns (see the header).
const LATE_CARRIER = 1; // Rápidos Carrasqueta
const DAMAGE_CARRIER = 4; // Rutas del Vinalopó
const MISMATCH_PLANT = "Juguetes Levante – Almacén Ibi";

const TRUCK = 33; // pallets in a full trailer
const WEEKDAY = [0, 1.3, 1.1, 1.0, 1.0, 0.8, 0.15]; // Sunday … Saturday

export type HistoryInput = {
  today: Date; // local midnight
  /** The clock, in ms: nothing "shipped" is dated after it. Defaults to the real time (tests pass a simulated one). */
  now?: number;
  rand: () => number;
  items: { sku: string; clientCode: string; lotIndex: number; tracksLot: boolean; warehouse: string; docks: { n: number; kind: "in" | "out" }[] }[];
  carriers: number;
};

export type HistInbound = {
  key: string;
  day: number;
  date: Date;
  sku: string;
  clientCode: string;
  warehouse: string;
  lot: string | null;
  expected: number;
  pallets: number;
  carrier: number;
  supplier: string;
  incident: string | null;
};

/** One pallet (or part of one) on a truck. `units` is empty for a whole pallet. */
export type ShippedPallet = { sku: string; lot: string | null; inboundKey: string; units?: number };

export type HistOutbound = {
  key: string;
  day: number;
  date: Date;
  deadline: Date;
  sku: string;
  clientCode: string;
  warehouse: string;
  pallets: number;
  /** Exact units when the order is not made of whole pallets. */
  units?: number;
  consignee: string;
  carrier: number;
  shipped: ShippedPallet[];
  /** When the truck really left. */
  shippedAt: Date;
};

export type HistSlot = { warehouse: string; dock: number; start: Date; end: Date; arrivedAt: Date; carrier: number; inbound?: string; outbound?: string };

/** `loose`: one of the `pallets` rows holds only that many units (a loose pallet). */
export type Remaining = { sku: string; clientCode: string; inboundKey: string; lot: string | null; pallets: number; received: Date; loose?: number };

function seasonFactor(season: Season, date: Date) {
  const doy = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / DAY) + 1;
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  switch (season) {
    case "flat":
      return 1;
    case "christmas":
      return doy < 244 ? 1 : 1 + 1.4 * Math.min(1, (doy - 244) / 91);
    case "summer":
      return 0.55 + 1.2 * Math.exp(-(((doy - 200) / 40) ** 2));
    case "winter":
      return 0.35 + 1.3 * sigmoid((doy - 265) / 12);
    case "turron":
      return 0.15 + 2.2 * sigmoid((doy - 285) / 10);
  }
}

export function simulateHistory({ today, now = Date.now(), rand, items, carriers }: HistoryInput) {
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const poisson = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let k = 0;
    for (let p = rand(); p > limit; p *= rand()) k++;
    return k;
  };
  const dateOf = (day: number) => new Date(today.getTime() + day * DAY);
  const first = -HISTORY_DAYS;

  const inbounds: HistInbound[] = [];
  const outbounds: HistOutbound[] = [];
  const remaining: Remaining[] = [];

  for (const item of items) {
    const d = DEMAND[item.sku];
    const meanOrder = (d.order[0] + d.order[1]) / 2;
    // Local daily rate, used for the replenishment marks.
    const rateOn = (day: number) => d.rate * seasonFactor(d.season, dateOf(day));
    // MUNECA-CL: a TV campaign doubles its demand over the last five weeks.
    const boost = (day: number) => (item.sku === "MUNECA-CL" && day > -35 ? 1 + Math.min(1, (day + 35) / 21) : 1);

    // 1. Orders, day by day (today only until the morning trucks have left).
    const out = new Map<number, number[]>();
    for (let day = first; day <= 0; day++) {
      const date = dateOf(day);
      const lambda = (rateOn(day) * boost(day) * WEEKDAY[date.getDay()]) / meanOrder;
      const orders = day === 0 ? Math.min(1, poisson(lambda)) : poisson(lambda);
      if (orders) out.set(day, Array.from({ length: orders }, () => between(d.order[0], d.order[1])));
    }

    // 2. Deliveries, backwards from today's stock.
    const deliveries = new Map<number, number>();
    const target = TODAY_STOCK[item.sku] - (PLANTED_STOCK[item.sku] ?? 0);
    let level = target;
    for (let day = 0; day >= first; day--) {
      const shipped = (out.get(day) ?? []).reduce((s, q) => s + q, 0);
      const start = level + shipped; // stock this morning if no truck came
      let high: number;
      let low: number;
      let canDeliver = true;
      if (d.buildUp) {
        // Production runs ahead of the season: stock climbs from early summer to today's level.
        const ramp = Math.max(0, Math.min(1, (day + 130) / 130));
        high = 8 + (target - 8) * ramp;
        low = Math.max(2, high - 6);
        canDeliver = dateOf(day).getDay() === 2; // production ships on Tuesdays
      } else {
        // Min/max replenishment around the item's usual level: refill when it runs low,
        // up to a bit above today's stock. Slow items get months of headroom.
        const headroom = d.rate < 0.3 ? Math.round(d.rate * 110) : 0;
        low = Math.max(2, Math.round(target * 0.6));
        high = Math.max(low + 6, Math.round(target * 1.3)) + headroom;
      }
      if (day < 0 && canDeliver && start > high) {
        deliveries.set(day, start - Math.round(low));
        level = Math.round(low);
      } else {
        level = start;
      }
    }
    // Whatever stood in the building before the window came in just before it.
    if (level > 0) deliveries.set(first - between(3, 9), level);

    // Split deliveries into trucks and record them.
    const lotFor = (date: Date, n: number) => {
      const doy = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / DAY) + 1;
      return `L${String(date.getFullYear()).slice(2)}${String(doy).padStart(3, "0")}-${String(item.lotIndex).padStart(2, "0")}${n ? String.fromCharCode(64 + n) : ""}`;
    };
    for (const [day, qty] of [...deliveries.entries()].sort((a, b) => a[0] - b[0])) {
      let left = qty;
      let n = 0;
      while (left > 0) {
        const pallets = Math.min(TRUCK, left);
        left -= pallets;
        const date = new Date(dateOf(day).getTime() + between(6 * 60, 13 * 60) * MIN);
        // Rutas del Vinalopó brings about a third of the deliveries; the Ibi warehouse ships most of the toys.
        const carrier = rand() < 0.3 ? DAMAGE_CARRIER : between(0, carriers - 2);
        const plants = PLANTS[item.clientCode];
        const supplier = plants.includes(MISMATCH_PLANT) && rand() < 0.65 ? MISMATCH_PLANT : pick(plants.filter((p) => p !== MISMATCH_PLANT));
        const mismatch = rand() < (supplier === MISMATCH_PLANT ? 0.45 : 0.03);
        const damaged = !mismatch && rand() < (carrier === DAMAGE_CARRIER ? 0.18 : 0.015);
        const missing = mismatch ? between(1, 2) : 0;
        inbounds.push({
          key: `in-${item.sku}-${day}-${n}`,
          day,
          date,
          sku: item.sku,
          clientCode: item.clientCode,
          warehouse: item.warehouse,
          lot: item.tracksLot ? lotFor(dateOf(day - 3), n) : null, // made three days before it came in
          expected: pallets + missing,
          pallets,
          carrier,
          supplier,
          incident: mismatch
            ? `Albarán ${pallets + missing} palés, recibidos ${pallets}`
            : damaged
              ? `${between(1, 2)} palés con cajas aplastadas`
              : null,
        });
        n++;
      }
    }

    // 3. Forwards: each shipment takes the oldest pallets first.
    const mine = inbounds.filter((i) => i.sku === item.sku).sort((a, b) => a.date.getTime() - b.date.getTime());
    const stack = mine.map((i) => ({ i, left: i.pallets }));
    for (let day = first; day <= 0; day++) {
      for (const qty of out.get(day) ?? []) {
        const shipped: ShippedPallet[] = [];
        for (const s of stack) {
          if (s.i.day > day || shipped.length === qty) continue;
          while (s.left > 0 && shipped.length < qty) {
            s.left--;
            shipped.push({ sku: item.sku, lot: s.i.lot, inboundKey: s.i.key });
          }
        }
        if (shipped.length < qty) throw new Error(`History of ${item.sku} runs out of stock on day ${day}`);
        const date = dateOf(day);
        const deadline = new Date(date.getTime() + between(9, 17) * 60 * MIN);
        outbounds.push({
          key: `out-${item.sku}-${day}-${outbounds.length}`,
          day,
          date,
          deadline,
          shippedAt: new Date(Math.min(deadline.getTime(), now)),
          sku: item.sku,
          clientCode: item.clientCode,
          warehouse: item.warehouse,
          pallets: qty,
          consignee: pick(DESTINATIONS[item.clientCode]),
          carrier: pick(Array.from({ length: carriers }, (_, i) => i)),
          shipped,
        });
      }
    }
    for (const s of stack.filter((x) => x.left > 0)) {
      remaining.push({ sku: item.sku, clientCode: item.clientCode, inboundKey: s.i.key, lot: s.i.lot, pallets: s.left, received: s.i.date });
    }
  }

  // 4. Dock slots, day by day per building, and when each truck really turned up.
  const slots: HistSlot[] = [];
  const docksOf = new Map(items.map((i) => [i.warehouse, i.docks]));
  const byDay = new Map<string, { kind: "in" | "out"; key: string; warehouse: string; pallets: number; carrier: number; from: Date }[]>();
  for (const i of inbounds) {
    if (i.day >= 0 || i.day < first) continue;
    const k = `${i.warehouse}|${i.day}`;
    byDay.set(k, [...(byDay.get(k) ?? []), { kind: "in", key: i.key, warehouse: i.warehouse, pallets: i.pallets, carrier: i.carrier, from: i.date }]);
  }
  for (const o of outbounds) {
    if (o.day >= 0) continue; // today's trucks are booked with the rest of today's plan
    // Most pick-ups are wanted first thing; Monday mornings are the crush.
    const hour = rand() < 0.62 ? between(7, 10) : between(11, 17);
    const from = new Date(o.date.getTime() + hour * 60 * MIN + between(0, 3) * 15 * MIN);
    const k = `${o.warehouse}|${o.day}`;
    byDay.set(k, [...(byDay.get(k) ?? []), { kind: "out", key: o.key, warehouse: o.warehouse, pallets: o.pallets, carrier: o.carrier, from }]);
  }
  for (const [k, trucks] of byDay) {
    const [warehouse, dayText] = k.split("|");
    const dayStart = dateOf(Number(dayText)).getTime();
    const busy: Busy[] = [];
    const docks = docksOf.get(warehouse)!;
    for (const t of trucks.sort((a, b) => a.from.getTime() - b.from.getTime())) {
      const minutes = slotMinutes(t.kind, t.pallets);
      const slot = firstFree(busy, docks.filter((d) => d.kind === t.kind).map((d) => d.n), dayStart, t.from.getTime(), minutes);
      if (!slot) continue; // a full day: the truck came without a booking, as happens
      busy.push(slot);
      const start = new Date(slot.start);
      const monday = start.getDay() === 1;
      const delay = t.carrier === LATE_CARRIER && monday ? 18 + 14 * normal() : 11 * normal();
      slots.push({
        warehouse,
        dock: slot.dock,
        start,
        end: new Date(slot.end),
        arrivedAt: new Date(slot.start + Math.round(delay) * MIN),
        carrier: t.carrier,
        ...(t.kind === "in" ? { inbound: t.key } : { outbound: t.key }),
      });
    }
  }

  const extraOutbounds = plantPalletCases({ today, now, items, inbounds, slots, remaining });
  return { inbounds, outbounds, extraOutbounds, slots, remaining };
}

/**
 * Two cases for the pallet and billing demo, planted on top of the finished history.
 * They use no random numbers and need nothing from the history, so they exist on every date and
 * every other figure stays as it was.
 */
function plantPalletCases({
  today, now, items, inbounds, slots, remaining,
}: { today: Date; now: number; items: HistoryInput["items"]; inbounds: HistInbound[]; slots: HistSlot[]; remaining: Remaining[] }): HistOutbound[] {
  const extra: HistOutbound[] = [];
  const dayNumber = (date: Date) => Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - today.getTime()) / DAY);
  const outbound = (key: string, date: Date, sku: string, pallets: number, units: number | undefined, shipped: ShippedPallet[]): HistOutbound => {
    const from = inbounds.find((i) => i.key === shipped[0].inboundKey)!;
    return {
      key, day: dayNumber(date), date, deadline: new Date(date.getTime() + 11 * 60 * MIN), shippedAt: new Date(Math.min(date.getTime() + 10 * 60 * MIN, now)),
      sku, clientCode: from.clientCode, warehouse: from.warehouse, pallets, units, consignee: DESTINATIONS[from.clientCode][0], carrier: 0, shipped,
    };
  };

  // 23 pallets in on the 20th of last month; 2 of them leave on the 2nd of this month (or today, if it is the 1st).
  const puzzle = items.find((i) => i.sku === PUZZLE_CASE.sku && i.clientCode === PUZZLE_CASE.clientCode);
  if (!puzzle) throw new Error(`The items have no ${PUZZLE_CASE.sku} of ${PUZZLE_CASE.clientCode} to plant the billing case on`);
  const arrived = new Date(today.getFullYear(), today.getMonth() - 1, 20, 9, 30);
  const delivery: HistInbound = {
    key: PUZZLE_CASE.key, day: dayNumber(arrived), date: arrived, sku: PUZZLE_CASE.sku, clientCode: PUZZLE_CASE.clientCode, warehouse: puzzle.warehouse, lot: null,
    expected: PUZZLE_CASE.pallets, pallets: PUZZLE_CASE.pallets, carrier: 0, supplier: PLANTS[PUZZLE_CASE.clientCode][0], incident: null,
  };
  inbounds.push(delivery);
  // Its row of stock goes next to the other puzzles, so the customer keeps its stretch of racking.
  const row: Remaining = { sku: PUZZLE_CASE.sku, clientCode: PUZZLE_CASE.clientCode, inboundKey: delivery.key, lot: null, pallets: PUZZLE_CASE.pallets - PUZZLE_CASE.leaving, received: arrived };
  const same = remaining.map((r, i) => ({ r, i })).filter(({ r }) => r.sku === PUZZLE_CASE.sku);
  const after = same.filter(({ r }) => r.received.getTime() <= arrived.getTime()).pop();
  remaining.splice(after ? after.i + 1 : same.length ? same[0].i : remaining.length, 0, row);
  // A door for the truck, if one is free at that hour (otherwise it "came without a booking", as happens).
  const dayStart = new Date(arrived.getFullYear(), arrived.getMonth(), arrived.getDate()).getTime();
  const busy: Busy[] = slots
    .filter((s) => s.warehouse === puzzle.warehouse && s.start.getTime() >= dayStart && s.start.getTime() < dayStart + DAY)
    .map((s) => ({ dock: s.dock, start: s.start.getTime(), end: s.end.getTime() }));
  const door = firstFree(busy, puzzle.docks.filter((d) => d.kind === "in").map((d) => d.n), dayStart, arrived.getTime(), slotMinutes("in", PUZZLE_CASE.pallets));
  if (door) {
    slots.push({ warehouse: puzzle.warehouse, dock: door.dock, start: new Date(door.start), end: new Date(door.end), arrivedAt: new Date(door.start + 3 * MIN), carrier: 0, inbound: delivery.key });
  }
  const leaves = new Date(today.getFullYear(), today.getMonth(), Math.min(2, today.getDate()));
  extra.push(outbound("out-case-puzzle", leaves, PUZZLE_CASE.sku, PUZZLE_CASE.leaving, undefined,
    Array.from({ length: PUZZLE_CASE.leaving }, () => ({ sku: PUZZLE_CASE.sku, lot: null, inboundKey: delivery.key }))));

  // One loose pallet: a 28-box order took part of a pallet of the newest PELUCHE-30 delivery, 12 boxes stay on the rack.
  const toys = remaining.filter((r) => r.sku === "PELUCHE-30" && r.pallets > 0).sort((a, b) => b.received.getTime() - a.received.getTime())[0];
  if (!toys) throw new Error("History has no PELUCHE-30 stock to plant the loose pallet on");
  toys.loose = 12;
  const source = inbounds.find((i) => i.key === toys.inboundKey)!;
  const orderDay = Math.min(-1, source.day + 2);
  extra.push(outbound("out-case-peluche", new Date(today.getTime() + orderDay * DAY), "PELUCHE-30", 1, 28, [
    { sku: "PELUCHE-30", lot: null, inboundKey: toys.inboundKey, units: 28 },
  ]));
  return extra;
}
