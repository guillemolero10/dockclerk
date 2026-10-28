// Checks for quantities and picking in units (src/lib/pallets, src/lib/warehouse/picking.ts).
// Pure: no database, no keys, no network.
//
//   npx tsx scripts/pallets-check.ts
//
// Exit code 1 if any case fails, so it can run before recording the video.

import { describeUnits, readQuantity, splitUnits, toUnits } from "../src/lib/pallets/quantity";
import { allocatePicks, type OpenOrder, type PickableStock, type PickPlan } from "../src/lib/warehouse/picking";

type Case = { name: string; check: () => string | null };

const same = (got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return g === w ? null : `got ${g}, expected ${w}`;
};

/** "2,5 palés" of an item with `perPallet` per pallet, all the way to the text the office reads. */
function asked(amount: number, unit: "pallets" | "units", perPallet: number, word = "cajas") {
  const r = toUnits(amount, unit, perPallet);
  if (!("units" in r)) return r;
  const s = splitUnits(r.units, perPallet);
  return { units: r.units, full: s.full, loose: s.loose, text: describeUnits(r.units, perPallet, word) };
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
let seq = 0;
const row = (units: number, o: Partial<PickableStock> = {}): PickableStock => ({
  id: o.id ?? `s${++seq}`, warehouseId: "W1", itemId: "I1", location: o.location ?? `A-0${seq}-1`, units,
  expiresAt: null, receivedAt: day(1 + seq), outboundId: null, ...o,
});
const order = (units: number, itemId = "I1", id = "O1"): OpenOrder => ({ id, number: 1, date: day(20), deadline: null, lines: [{ itemId, units }] });
const planOf = (stock: PickableStock[], o: OpenOrder) => allocatePicks(stock, [o]).get(o.id)!;

/** What pickPallet does to the rows, without a database: whole rows move, split rows give up units to a new row. */
function applyPlan(stock: PickableStock[], plan: PickPlan, outboundId: string): PickableStock[] {
  const out: PickableStock[] = [];
  for (const s of stock) {
    if (!plan.stockIds.includes(s.id) || plan.picked.includes(s.id)) { out.push(s); continue; }
    const part = plan.split.find((p) => p.stockId === s.id);
    if (!part) { out.push({ ...s, outboundId, location: "EXP-1" }); continue; }
    out.push({ ...s, units: s.units - part.units });
    out.push({ ...s, id: `${s.id}-picked`, units: part.units, outboundId, location: "EXP-1" });
  }
  return out;
}

const CASES: Case[] = [
  { name: "Q1 2,5 palés de PELUCHE-30 (40) → 100 = 2 palés + 20 cajas", check: () => same(asked(2.5, "pallets", 40), { units: 100, full: 2, loose: 20, text: "2 palés + 20 cajas" }) },
  { name: "Q2 «2 palés y medio» de HORCH-1L (100) → 250 = 2 + 50", check: () => {
    const q = readQuantity("2 palés y medio");
    return q ? same(asked(q.amount, q.unit, 100), { units: 250, full: 2, loose: 50, text: "2 palés + 50 cajas" }) : "not read";
  } },
  { name: "Q3 «medio palé» de PUZZLE-500 (60) → 30 cajas", check: () => {
    const q = readQuantity("medio palé");
    return q ? same(asked(q.amount, q.unit, 60), { units: 30, full: 0, loose: 30, text: "30 cajas" }) : "not read";
  } },
  { name: "Q4a 130 cajas de PELUCHE-30 → 3 palés + 10 cajas", check: () => same(asked(130, "units", 40), { units: 130, full: 3, loose: 10, text: "3 palés + 10 cajas" }) },
  { name: "Q4b 120 cajas de PELUCHE-30 → 3 palés", check: () => same(asked(120, "units", 40), { units: 120, full: 3, loose: 0, text: "3 palés" }) },
  { name: "Q5 1,5 palés de PP-NAT (55 sacos) → error, opciones 82 y 83", check: () => same(asked(1.5, "pallets", 55, "sacos"), { error: "not a whole number of units", options: [82, 83] }) },
  { name: "Q6 «media docena de palés» → 6 palés", check: () => same(readQuantity("Mandad media docena de palés de agua"), { amount: 6, unit: "pallets" }) },
  { name: "Q7a cero o negativo → error", check: () => same([toUnits(0, "pallets", 40), toUnits(-2, "units", 40), toUnits(Number.NaN, "units", 40)].map((r) => "error" in r), [true, true, true]) },
  { name: "Q7b «-5 palés» no se lee como 5", check: () => same(readQuantity("Mandad -5 palés de PELUCHE-30"), null) },
  { name: "Q8 frases: «2,5», «palé y medio», «130 cajas», «40 sacos», «4 de horchata», «1.360 cajas»", check: () =>
    same(
      ["2,5 palés de X", "palé y medio de X", "130 cajas de X", "40 sacos de X", "4 de horchata", "1.360 cajas de X", "dos palés de X", "hola"].map(readQuantity),
      [
        { amount: 2.5, unit: "pallets" }, { amount: 1.5, unit: "pallets" }, { amount: 130, unit: "units" }, { amount: 40, unit: "units" },
        { amount: 4, unit: "pallets" }, { amount: 1360, unit: "units" }, { amount: 2, unit: "pallets" }, null,
      ],
    ) },
  { name: "Q9 describeUnits en singular y a cero", check: () => same([describeUnits(41, 40), describeUnits(1, 40), describeUnits(0, 40)], ["1 palé + 1 caja", "1 caja", "0 cajas"]) },

  { name: "P1 pico 12 + 3 llenos, piden 100 → pico + 2 llenos + divide 8, faltan 0", check: () => {
    const stock = [row(12, { id: "pico", receivedAt: day(1) }), row(40, { id: "a" }), row(40, { id: "b" }), row(40, { id: "c" })];
    const p = planOf(stock, order(100));
    return same({ ids: p.stockIds, split: p.split, short: p.shortUnits }, { ids: ["pico", "a", "b", "c"], split: [{ stockId: "c", units: 8 }], short: 0 });
  } },
  { name: "P2 caduca antes pero llegó después → sale primero (FEFO gana a FIFO)", check: () => {
    const stock = [row(40, { id: "old", receivedAt: day(1), expiresAt: day(28) }), row(40, { id: "fresh", receivedAt: day(9), expiresAt: day(12) })];
    return same(planOf(stock, order(40)).stockIds, ["fresh"]);
  } },
  { name: "P3 fila de 40, piden 30 → divide 30, queda pico de 10", check: () => {
    const stock = [row(40, { id: "a" })];
    const p = planOf(stock, order(30));
    const after = applyPlan(stock, p, "O1");
    return same({ split: p.split, left: after.find((s) => s.id === "a")!.units }, { split: [{ stockId: "a", units: 30 }], left: 10 });
  } },
  { name: "P4 piden más de lo libre → shortUnits (y huecos) correctos", check: () => {
    const stock = [row(12, { id: "pico" }), row(40, { id: "a" })];
    const p = planOf(stock, order(100));
    return same({ short: p.shortUnits, slots: p.short, ids: p.stockIds, split: p.split }, { short: 48, slots: 2, ids: ["pico", "a"], split: [] });
  } },
  { name: "P5 tras recoger P1: filas = antes + divisiones; unidades totales iguales", check: () => {
    const stock = [row(12, { id: "pico", receivedAt: day(1) }), row(40, { id: "a" }), row(40, { id: "b" }), row(40, { id: "c" })];
    const p = planOf(stock, order(100));
    const after = applyPlan(stock, p, "O1");
    const units = (rows: PickableStock[]) => rows.reduce((sum, s) => sum + s.units, 0);
    const picked = after.filter((s) => s.outboundId === "O1");
    return same(
      { rows: after.length, total: units(after), picked: units(picked) },
      { rows: stock.length + p.split.length, total: units(stock), picked: 100 },
    );
  } },
  { name: "P6 recalcular tras recoger parte: el pedido ya no pide nada más", check: () => {
    const stock = [row(40, { id: "a" })];
    const first = planOf(stock, order(30));
    const again = planOf(applyPlan(stock, first, "O1"), order(30));
    return same({ short: again.shortUnits, split: again.split, picked: again.picked.length }, { short: 0, split: [], picked: 1 });
  } },
  { name: "P7 dos pedidos no se pisan una misma fila", check: () => {
    const stock = [row(40, { id: "a" })];
    const o1 = order(30, "I1", "O1");
    const o2 = { ...order(30, "I1", "O2"), number: 2 };
    const plans = allocatePicks(stock, [o1, o2]);
    return same({ first: plans.get("O1")!.split, second: plans.get("O2")!.shortUnits }, { first: [{ stockId: "a", units: 30 }], second: 20 });
  } },
];

let failed = 0;
for (const c of CASES) {
  let miss: string | null;
  try {
    miss = c.check();
  } catch (err) {
    miss = `threw ${err instanceof Error ? err.message : String(err)}`;
  }
  if (miss) failed++;
  console.log(`${miss ? "FAIL" : "pass"}  ${c.name}${miss ? `\n      ${miss}` : ""}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} pass`);
process.exit(failed ? 1 : 0);
