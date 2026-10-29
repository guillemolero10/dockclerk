// Checks that the seed does not depend on the day it runs. Pure: no database, no keys, no network.
//
//   TZ=Europe/Madrid npx tsx scripts/seed-days-check.ts              45 days back and 60 days ahead of today
//   TZ=Europe/Madrid npx tsx scripts/seed-days-check.ts --back=10 --ahead=10
//   TZ=Europe/Madrid npx tsx scripts/seed-days-check.ts --quiet      only the failing dates and the summary
//   TZ=Europe/Madrid npx tsx scripts/seed-days-check.ts --break      breaks the planted billing case on purpose: it must exit 1
//
// Why it exists: the seed used to need a lucky 23-pallet delivery in its random history, so it failed on many dates
// (the freeze day, 2 Nov, was one) and, because it wipes first, left the production database empty.
// Now `planSeed()` (prisma/seed-plan.ts) works everything out in memory before `wipe()`. For each date, at three
// times of day (the dock plan depends on the clock), this script runs the same planSeed() the seed runs and checks:
//   - it does not throw (history, planted cases, racks, dock plan);
//   - the billing case: 23 pallets in on the 20th of last month, 21 still inside, 2 out on the 2nd (PED-7001);
//   - the loose pallet: 12 boxes of PELUCHE-30 left by a 28-box order (PED-7002);
//   - every delivery adds up in units (in = out + here), today's stock is the table, the racks fit;
//   - the dock plan: inside opening hours, no overlaps, nothing in the past;
//   - the real billing engine, in memory: the 21 + 2 rows of last month's bill, and all 8 customers add up;
//   - the analyst's analyses run on the simulated data (the headline is printed; the real report needs the database).
// The first line below guards the order in seed.ts: planSeed() must run before wipe().
//
// Exit code: 0 all dates pass, 1 any fails, 2 not run with the Madrid time zone.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../src/lib/analyst/analyses";
import type { AnalystData } from "../src/lib/analyst/data";
import { billPeriod, type TariffInput } from "../src/lib/billing/compute";
import { period, ymdOfDay } from "../src/lib/billing/calendar";
import { buildStays, type PalletKind } from "../src/lib/billing/stays";
import { DOCK_CLOSE_H, DOCK_OPEN_H } from "../src/lib/dock/slots";
import { makeLayout } from "../src/lib/warehouse/layout";
import { PUZZLE_CASE, TODAY_STOCK } from "../prisma/history";
import { AMERICAN_ITEMS, CONTACTS, PREPARED_TODAY, UPCOMING, carriers, clients, tariffs, warehouseOf, warehouses } from "../prisma/seed-data";
import { REF, makeRand, outboundsInOrder, planSeed, startOfDay, takeOldest, type SeedPlan } from "../prisma/seed-plan";

process.env.TZ = "Europe/Madrid"; // the seed runs on Guillermo's Mac, in Madrid time
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (zone !== "Europe/Madrid" || new Date(2026, 6, 1, 12).getTimezoneOffset() !== -120 || new Date(2026, 11, 1, 12).getTimezoneOffset() !== -60) {
  console.error(`Run it with the Madrid time zone: TZ=Europe/Madrid npx tsx scripts/seed-days-check.ts (this process is on ${zone}).`);
  process.exit(2);
}

const arg = (name: string, fallback: number) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = found ? Number(found.split("=")[1]) : fallback;
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--${name} must be a whole number of days`);
    process.exit(2);
  }
  return n;
};
const BACK = arg("back", 45);
const AHEAD = arg("ahead", 60);
const QUIET = process.argv.includes("--quiet");
const BREAK = process.argv.includes("--break");

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** Minutes after midnight: just after midnight, midday and ten to eight in the evening (the dock closes at 20:00). */
const CLOCKS = [5, 12 * 60, 19 * 60 + 50];

const unitsPerPallet = new Map(clients.flatMap((c) => c.items.map((i) => [i[0], i[3]] as const)));
const upp = (sku: string) => unitsPerPallet.get(sku)!;
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const label = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// ─── 0. seed.ts must plan before it wipes ─────────────────────────────────────────────────────
function seedPlansFirst(): string | null {
  const text = readFileSync(join(__dirname, "../prisma/seed.ts"), "utf8");
  const main = text.slice(text.indexOf("async function main()"));
  const plan = main.indexOf("planSeed(");
  const wipe = main.indexOf("await wipe()");
  if (plan < 0 || wipe < 0) return "seed.ts must call planSeed() and wipe() inside main()";
  if (plan > wipe) return "seed.ts calls wipe() before planSeed(): a failing day would leave the database empty";
  if (/await db\./.test(main.slice(0, wipe))) return "seed.ts touches the database before planSeed() has passed";
  return null;
}

// ─── 1. the planted cases ─────────────────────────────────────────────────────────────────────
function plantedCases(plan: SeedPlan, today: Date): string[] {
  const h = plan.history;
  const bad: string[] = [];
  const delivery = h.inbounds.find((i) => i.key === PUZZLE_CASE.key);
  if (!delivery) return ["billing case: there is no 23-pallet delivery of PUZZLE-500"];
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 20);
  if (delivery.sku !== PUZZLE_CASE.sku || delivery.clientCode !== PUZZLE_CASE.clientCode) bad.push(`billing case: the delivery is ${delivery.sku} of ${delivery.clientCode}`);
  if (delivery.pallets !== 23 || delivery.expected !== 23) bad.push(`billing case: the delivery has ${delivery.pallets} pallets (expected ${delivery.expected}), want 23`);
  if (ymdOf(delivery.date) !== ymdOf(lastMonth)) bad.push(`billing case: the delivery is dated ${ymdOf(delivery.date)}, want ${ymdOf(lastMonth)}`);
  if (delivery.incident !== null || delivery.lot !== null) bad.push("billing case: the delivery should have no incident and no lot");
  const inside = h.remaining.filter((r) => r.inboundKey === delivery.key).reduce((s, r) => s + r.pallets, 0);
  if (inside !== 21) bad.push(`billing case: ${inside} pallets still inside, want 21`);
  const leaving = h.extraOutbounds[0];
  const leavesOn = new Date(today.getFullYear(), today.getMonth(), Math.min(2, today.getDate()));
  if (!leaving || leaving.key !== "out-case-puzzle") bad.push("billing case: the first planted outbound (PED-7001) is not the puzzle one");
  else {
    if (leaving.pallets !== 2 || leaving.shipped.length !== 2 || leaving.shipped.some((p) => p.inboundKey !== delivery.key || p.sku !== PUZZLE_CASE.sku)) bad.push("billing case: the outbound must take 2 pallets of that delivery");
    if (ymdOf(leaving.date) !== ymdOf(leavesOn)) bad.push(`billing case: the 2 pallets leave on ${ymdOf(leaving.date)}, want ${ymdOf(leavesOn)}`);
    if (leaving.clientCode !== PUZZLE_CASE.clientCode) bad.push("billing case: the outbound belongs to another customer");
  }

  const loose = h.remaining.filter((r) => r.sku === "PELUCHE-30" && r.loose !== undefined);
  const peluche = h.extraOutbounds[1];
  if (loose.length !== 1 || loose[0].loose !== 12) bad.push(`loose pallet: ${loose.length} loose rows of PELUCHE-30 (want one with 12 boxes)`);
  else if (!peluche || peluche.key !== "out-case-peluche" || peluche.units !== 28 || peluche.shipped.length !== 1 || peluche.shipped[0].units !== 28 || peluche.shipped[0].inboundKey !== loose[0].inboundKey) {
    bad.push("loose pallet: the second planted outbound (PED-7002) must take 28 boxes from the delivery of the loose pallet");
  }
  if (h.extraOutbounds.length !== 2) bad.push(`${h.extraOutbounds.length} planted outbounds, want 2`);
  return bad;
}

// ─── 2. everything adds up in units ───────────────────────────────────────────────────────────
function adds(plan: SeedPlan): string[] {
  const h = plan.history;
  const bad: string[] = [];
  const outs = outboundsInOrder(h).all;
  const dayOf = new Map(h.inbounds.map((i) => [i.key, i.day]));
  for (const i of h.inbounds) {
    const received = i.pallets * upp(i.sku);
    const gone = outs.flatMap((o) => o.shipped).filter((p) => p.inboundKey === i.key).reduce((s, p) => s + (p.units ?? upp(p.sku)), 0);
    const here = h.remaining.filter((r) => r.inboundKey === i.key).reduce((s, r) => s + (r.pallets - (r.loose !== undefined ? 1 : 0)) * upp(r.sku) + (r.loose ?? 0), 0);
    if (i.pallets <= 0 || i.expected < i.pallets) bad.push(`delivery ${i.key}: ${i.pallets} pallets of ${i.expected} expected`);
    if (received !== gone + here) bad.push(`delivery ${i.key}: ${received} units in, ${gone} out + ${here} here`);
  }
  for (const o of outs) {
    const units = o.shipped.reduce((s, p) => s + (p.units ?? upp(p.sku)), 0);
    if (units !== (o.units ?? o.pallets * upp(o.sku))) bad.push(`outbound ${o.key}: ${units} units on the truck, ${o.units ?? o.pallets * upp(o.sku)} ordered`);
    if (o.shipped.some((p) => (dayOf.get(p.inboundKey) ?? Infinity) > o.day)) bad.push(`outbound ${o.key}: ships goods that had not arrived yet`);
  }
  for (const [sku, want] of Object.entries(TODAY_STOCK)) {
    const rows = h.remaining.filter((r) => r.sku === sku).reduce((s, r) => s + r.pallets, 0);
    if (rows !== want) bad.push(`${sku}: ${rows} pallets in stock, the table says ${want}`);
  }
  const preparedIn = (code: string) => PREPARED_TODAY.filter((p) => warehouseOf(p[0]).code === code).reduce((s, p) => s + p[3], 0);
  for (const r of plan.racks) {
    const want = Object.entries(TODAY_STOCK).filter(([sku]) => warehouseOf(clients.find((c) => c.items.some((i) => i[0] === sku))!.code).code === r.warehouse).reduce((s, [, n]) => s + n, 0) - preparedIn(r.warehouse);
    if (r.pallets !== want) bad.push(`${r.warehouse}: ${r.pallets} pallets on the racks, want ${want}`);
  }
  return bad;
}

// ─── 3. the dock plan ─────────────────────────────────────────────────────────────────────────
function dock(plan: SeedPlan, today: Date, now: number): string[] {
  const bad: string[] = [];
  const known = new Set<string>([REF.morning, REF.expectedToys, REF.expectedDrinks, ...PREPARED_TODAY.map((p) => REF.prepared(p[1])), ...UPCOMING.map((u) => REF.upcoming(u[1]))]);
  for (const o of outboundsInOrder(plan.history).all) known.add(o.key);
  const day = (d: Date) => startOfDay(d).getTime();
  plan.dock.forEach((b, i) => {
    const ref = b.inbound ?? b.outbound ?? "?";
    if (!known.has(ref)) bad.push(`dock: booking points at ${ref}, which does not exist`);
    if ((b.inbound ? 1 : 0) + (b.outbound ? 1 : 0) !== 1) bad.push(`dock: ${ref} must link to exactly one inbound or outbound`);
    if (b.start >= b.end) bad.push(`dock: ${ref} ends before it starts`);
    const open = day(b.start) + DOCK_OPEN_H * 60 * MIN;
    const close = day(b.start) + DOCK_CLOSE_H * 60 * MIN;
    if (b.start.getTime() < open || b.end.getTime() > close) bad.push(`dock: ${ref} is outside opening hours`);
    if (b.carrier !== null && !carriers[b.carrier]) bad.push(`dock: ${ref} has a carrier that does not exist`);
    plan.dock.slice(i + 1).forEach((c) => {
      if (c.warehouse === b.warehouse && c.dock === b.dock && c.start < b.end && b.start < c.end) bad.push(`dock: ${ref} and ${c.inbound ?? c.outbound} overlap at door ${b.dock} of ${b.warehouse}`);
    });
    // Today's expected trucks are never booked in the past (unless the day is nearly over and the slot was pulled back to the closing time).
    const today_ = day(b.start) === today.getTime();
    if ((ref === REF.expectedToys || ref === REF.expectedDrinks) && today_ && b.start.getTime() < now && b.end.getTime() !== close) bad.push(`dock: ${ref} is booked in the past`);
  });
  if (!plan.dock.some((b) => b.inbound === REF.expectedToys) || !plan.dock.some((b) => b.inbound === REF.expectedDrinks)) bad.push("dock: today's expected trucks have no door");
  return bad;
}

// ─── 4. the real billing engine on the simulated records ──────────────────────────────────────
function billing(plan: SeedPlan, today: Date): string[] {
  const h = plan.history;
  const bad: string[] = [];
  const thisMonth = ymdOf(today).slice(0, 7);
  const prevMonth = ymdOfDay(period(thisMonth).start - 1).slice(0, 7);
  const outs = outboundsInOrder(h).all;
  const balances = h.remaining.map((r) => ({ ...r }));
  // The prepared outbounds' pallets are still stock rows (in the dispatch lanes) until they are shipped.
  const staged = PREPARED_TODAY.flatMap(([clientCode, sku, , pallets]) => (takeOldest(balances.filter((b) => b.sku === sku && b.clientCode === clientCode), pallets) ?? []).map((b) => ({ ...b, pallets: 1, loose: undefined })));

  for (const c of clients) {
    const items = c.items.map((i) => ({ id: i[0], sku: i[0], unitsPerPallet: i[3], palletType: (AMERICAN_ITEMS.has(i[0]) ? "AMERICAN" : "EURO") as PalletKind }));
    const mine = h.inbounds.filter((i) => i.clientCode === c.code);
    const inbounds = mine.map((i, n) => ({ id: i.key, number: n + 1, clientDocRef: null, date: i.date, receivedAt: i.date }));
    const outbounds = outs
      .filter((o) => o.clientCode === c.code)
      .map((o, n) => ({
        number: n + 1, status: o.day < -3 ? "CLOSED" : "SHIPPED", date: o.date, shippedAt: o.shippedAt,
        shipped: o.shipped.map((p) => ({ itemId: p.sku, sku: p.sku, lot: p.lot, units: p.units ?? upp(p.sku), location: "EXP-1", inboundId: p.inboundKey })),
      }));
    const stock = [
      ...balances.filter((b) => b.clientCode === c.code).flatMap((b) => Array.from({ length: b.pallets }, (_, i) => ({ itemId: b.sku, lot: b.lot, units: b.loose !== undefined && i === b.pallets - 1 ? b.loose : upp(b.sku), inboundId: b.inboundKey }))),
      ...staged.filter((b) => b.clientCode === c.code).map((b) => ({ itemId: b.sku, lot: b.lot, units: upp(b.sku), inboundId: b.inboundKey })),
    ];
    const t = tariffs[c.code];
    const tariff: TariffInput = { inPerPallet: t.inPerPallet, outPerPallet: t.outPerPallet, storagePrice: t.storagePrice, storageByType: (t.storageByType ?? {}) as TariffInput["storageByType"], factorPct: 100, vatPct: 21, partialPallets: t.partialPallets };

    for (const month of [prevMonth, thisMonth]) {
      const p = period(month);
      const bill = billPeriod({ stays: buildStays({ items, inbounds, outbounds, stock, periodStart: p.start }), handling: [], tariff, period: p });
      const r = bill.checks;
      if (!r.detailMatches) bad.push(`billing ${c.code} ${month}: the detail does not add up to the summary`);
      if (r.warnings.length) bad.push(`billing ${c.code} ${month}: ${r.warnings.join(" / ")}`);
      if (bill.totalCents !== bill.baseCents + bill.vatCents || bill.baseCents !== bill.lines.reduce((s, l) => s + l.cents, 0)) bad.push(`billing ${c.code} ${month}: base + VAT is not the total`);
      if (month === prevMonth && bill.baseCents <= 0) bad.push(`billing ${c.code} ${month}: nothing to charge`);
      if (c.code !== PUZZLE_CASE.clientCode) continue;

      // The planted case, as billing-seed-check.ts sees it with the database.
      // A random puzzle delivery can also land on the 20th: the case is the entry of 23 pallets, found by its number.
      const caseNumber = inbounds.findIndex((i) => i.id === PUZZLE_CASE.key) + 1;
      const rows = bill.detail.filter((d) => d.sku === PUZZLE_CASE.sku && d.inDate === `${prevMonth}-20` && d.inboundNumber === caseNumber);
      const exit = `${thisMonth}-${String(Math.min(2, today.getDate())).padStart(2, "0")}`;
      if (month === prevMonth) {
        const storage = rows.filter((d) => d.concept === "storage");
        const open = storage.find((d) => d.exitDate === null);
        const going = storage.find((d) => d.exitDate !== null);
        if (storage.length !== 2) bad.push(`billing case ${month}: ${storage.length} storage rows for the 23-pallet delivery, want 2`);
        if (open?.pallets !== 21) bad.push(`billing case ${month}: the open row has ${open?.pallets} pallets, want 21`);
        if (going?.pallets !== 2) bad.push(`billing case ${month}: the leaving row has ${going?.pallets} pallets, want 2`);
        if (going && going.exitDate !== exit) bad.push(`billing case ${month}: the 2 pallets leave on ${going.exitDate}, want ${exit}`);
        if (open && going && (open.days !== going.days || !open.days)) bad.push(`billing case ${month}: both rows should have the same, positive, days (${open.days} / ${going.days})`);
        if (open && open.days && open.palletDays !== 21 * open.days) bad.push(`billing case ${month}: open pallet-days ${open.palletDays}`);
        if (going && going.days && going.palletDays !== 2 * going.days) bad.push(`billing case ${month}: leaving pallet-days ${going.palletDays}`);
        if (rows.some((d) => d.concept === "out")) bad.push(`billing case ${month}: the 2 pallets must not be charged as an exit before they leave`);
        if (!rows.some((d) => d.concept === "in" && d.pallets === 23)) bad.push(`billing case ${month}: the entry of 23 pallets is missing`);
      } else {
        const out = rows.find((d) => d.concept === "out" && d.exitDate === exit);
        if (out?.pallets !== 2) bad.push(`billing case ${month}: the 2 pallets are not charged as an exit on ${exit} (${out?.pallets})`);
      }
    }
  }
  return bad;
}

// ─── 5. the analyst on the simulated records ──────────────────────────────────────────────────
/** An in-memory copy of what loadAnalystData reads after a seed. Locations are spread evenly (the seed spreads them at random). */
function analystData(plan: SeedPlan, today: Date, now: Date): AnalystData {
  const h = plan.history;
  const balances = h.remaining.map((r) => ({ ...r }));
  const stock: AnalystData["stock"] = [];
  const lanes = new Map<string, number>();
  for (const [clientCode, sku, , pallets] of PREPARED_TODAY) {
    const warehouse = warehouseOf(clientCode).code;
    const lane = (lanes.get(warehouse) ?? 0) + 1;
    lanes.set(warehouse, lane);
    for (const b of takeOldest(balances.filter((x) => x.sku === sku), pallets) ?? []) {
      stock.push({ id: `staged-${stock.length}`, warehouseId: warehouse, clientId: clientCode, itemId: sku, location: `EXP-${lane}`, pallets: 1, outboundId: `prepared-${sku}`, received: b.received });
    }
  }
  for (const w of warehouses) {
    const slots = makeLayout(w.dims).rackSlotsInFillOrder();
    const mine = balances.filter((b) => warehouseOf(b.clientCode).code === w.code);
    const total = mine.reduce((s, b) => s + b.pallets, 0);
    let k = 0;
    for (const b of mine) {
      for (let i = 0; i < b.pallets; i++) {
        stock.push({ id: `rack-${stock.length}`, warehouseId: w.code, clientId: b.clientCode, itemId: b.sku, location: slots[Math.floor((k++ * slots.length) / total)], pallets: 1, outboundId: null, received: b.received });
      }
    }
  }
  const morning = new Date(today.getTime() + (7 * 60 + 40) * MIN);
  for (let i = 0; i < 5; i++) stock.push({ id: `rec-${i}`, warehouseId: warehouseOf("C006").code, clientId: "C006", itemId: "MB-ROJO", location: "REC-3", pallets: 1, outboundId: null, received: morning });

  const outbounds: AnalystData["outbounds"] = outboundsInOrder(h).all.map((o) => ({
    id: o.key, date: o.date, clientId: o.clientCode, warehouseId: o.warehouse, status: o.day < -3 ? ("CLOSED" as const) : ("SHIPPED" as const), lines: [{ itemId: o.sku, pallets: o.pallets }],
  }));
  for (const [clientCode, sku, , pallets, inDays] of UPCOMING) {
    outbounds.push({ id: `upcoming-${sku}`, date: new Date(today.getTime() + inDays * DAY), clientId: clientCode, warehouseId: warehouseOf(clientCode).code, status: "REQUESTED", lines: [{ itemId: sku, pallets }] });
  }
  for (const [clientCode, sku, , pallets] of PREPARED_TODAY) {
    outbounds.push({ id: `prepared-${sku}`, date: today, clientId: clientCode, warehouseId: warehouseOf(clientCode).code, status: "PREPARED", lines: [{ itemId: sku, pallets }] });
  }

  const inbounds: AnalystData["inbounds"] = h.inbounds.map((i) => ({
    id: i.key, date: i.date, clientId: i.clientCode, warehouseId: i.warehouse, supplier: i.supplier, carrier: carriers[i.carrier][0],
    expected: i.expected, received: i.pallets, incident: i.incident, status: "CLOSED" as const, lines: [{ itemId: i.sku, pallets: i.pallets }],
  }));
  const open = (id: string, clientCode: string, date: Date, status: "EXPECTED" | "RECEIVED", expected: number | null, carrier: number | null, lines: { itemId: string; pallets: number }[]) =>
    inbounds.push({ id, date, clientId: clientCode, warehouseId: warehouseOf(clientCode).code, supplier: null, carrier: carrier === null ? null : carriers[carrier][0], expected, received: status === "RECEIVED" ? expected : null, incident: null, status, lines });
  open("morning", "C006", morning, "RECEIVED", 5, 1, [{ itemId: "MB-ROJO", pallets: 5 }]);
  open("expected-toys", "C001", today, "EXPECTED", null, 0, []);
  open("expected-drinks", "C004", today, "EXPECTED", 18, 4, []);
  open("expected-tomorrow", "C007", new Date(today.getTime() + DAY), "EXPECTED", 10, null, []);

  const since = now.getTime() - 182 * DAY;
  return {
    now,
    days: 182,
    warehouses: warehouses.map((w) => ({ id: w.code, code: w.code, name: w.name, dims: w.dims })),
    clients: clients.map((c) => ({ id: c.code, code: c.code, name: c.name, contact: CONTACTS[c.code] })),
    items: clients.flatMap((c) => c.items.map((i) => ({ id: i[0], clientId: c.code, sku: i[0], description: i[1], unitsPerPallet: i[3] }))),
    stock,
    outbounds,
    inbounds: inbounds.filter((i) => i.date.getTime() >= since),
    slots: h.slots.filter((s) => s.start.getTime() >= since).map((s) => ({ warehouseId: s.warehouse, startsAt: s.start, arrivedAt: s.arrivedAt, carrier: carriers[s.carrier][0], kind: s.inbound ? ("in" as const) : ("out" as const) })),
  };
}

/** What the demo is built around: the analyst should find one of these first (outside the summer-drinks season). */
const planted = (id: string) => id === "space-N2" || id === "stockout-MUNECA-CL" || id.startsWith("carrier-Rápidos Carrasqueta") || id.startsWith("quality-");

// ─── run ──────────────────────────────────────────────────────────────────────────────────────
let failed = 0;
let failedDates = 0;
const headlines = new Map<string, number>();
let plantedFirst = 0;
let plantedTop3 = 0;
let dates = 0;

const order = seedPlansFirst();
console.log(`${order ? "FAIL" : "PASS"}  seed.ts works everything out (planSeed) before it wipes anything${order ? `\n      -> ${order}` : ""}`);
if (order) failed++;

const start = startOfDay(new Date());
for (let d = -BACK; d <= AHEAD; d++) {
  const today = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
  const problems: string[] = [];
  let main: SeedPlan | null = null;
  let note = "";
  for (const clock of CLOCKS) {
    const now = today.getTime() + clock * MIN;
    let plan: SeedPlan;
    try {
      plan = planSeed({ today, now, rand: makeRand() });
    } catch (error) {
      problems.push(`planSeed at ${hhmm(clock)} threw: ${(error as Error).message}`);
      continue;
    }
    if (BREAK && clock === CLOCKS[1]) plan.history.inbounds = plan.history.inbounds.filter((i) => i.key !== PUZZLE_CASE.key); // the break: no 23-pallet delivery
    if (clock === CLOCKS[1]) {
      main = plan;
      problems.push(...plantedCases(plan, today), ...adds(plan), ...billing(plan, today));
    }
    problems.push(...dock(plan, today, now).map((p) => `${p} (at ${hhmm(clock)})`));
  }
  if (main) {
    try {
      const noon = new Date(today.getTime() + CLOCKS[1] * MIN);
      const { findings } = analyze(analystData(main, today, noon));
      if (!findings.length) problems.push("analyst: no findings at all");
      else {
        headlines.set(findings[0].id, (headlines.get(findings[0].id) ?? 0) + 1);
        if (planted(findings[0].id)) plantedFirst++;
        if (findings.slice(0, 3).some((f) => planted(f.id))) plantedTop3++;
        note = `headline ${findings[0].id}`;
      }
    } catch (error) {
      problems.push(`analyst threw: ${(error as Error).message}`);
    }
  }
  dates++;
  const unique = [...new Set(problems)];
  if (unique.length) failedDates++;
  if (unique.length || !QUIET) console.log(`${unique.length ? "FAIL" : "PASS"}  ${label(today)}${unique.length ? "" : `  (${CLOCKS.length} clock times; ${note})`}${unique.map((p) => `\n      -> ${p}`).join("")}`);
}

const share = [...headlines.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`).join(", ");
console.log(`\nAnalyst headline on ${dates} dates: ${share}`);
console.log(`A planted pattern is the headline on ${plantedFirst}/${dates} dates and among the top 3 on ${plantedTop3}/${dates} (information only: the real report needs the database).`);
const bad = failed + failedDates;
console.log(`\n${bad ? "FAIL" : "PASS"}: ${dates - failedDates}/${dates} dates pass${order ? "; seed.ts does not plan before it wipes" : ""}${BREAK ? " (--break: failures are expected)" : ""}`);
process.exit(bad ? 1 : 0);
