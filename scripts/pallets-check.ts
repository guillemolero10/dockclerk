// Checks for quantities and picking in units (src/lib/pallets, src/lib/warehouse/picking.ts).
// Pure: no database, no keys, no network.
//
//   npx tsx scripts/pallets-check.ts
//
// Exit code 1 if any case fails, so it can run before recording the video.

import { describeUnits, heldPallets, readQuantity, splitUnits, toUnits } from "../src/lib/pallets/quantity";
import { checkBreakdown, cleanDrafts, expandPallets, fromNote, leadIndex, sharesOf, summarize, type ItemLite, type PalletDraft } from "../src/lib/pallets/breakdown";
import { freshCodes, generatedCode, parseCode } from "../src/lib/pallets/codes";
import { planRestore, type LaneRow } from "../src/lib/warehouse/restore";
import { allocatePicks, describeShortage, type OpenOrder, type PickableStock, type PickPlan } from "../src/lib/warehouse/picking";

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
const order = (units: number, itemId = "I1", id = "O1", unitsPerPallet = 40): OpenOrder => ({ id, number: 1, date: day(20), deadline: null, lines: [{ itemId, units, unitsPerPallet }] });

const lrow = (id: string, units: number, location: string, o: Partial<LaneRow> = {}): LaneRow => ({
  id, warehouseId: "W1", itemId: "H", clientId: "C1", lot: "L1", expiresAt: day(28), inboundId: "IN1", units, location, ...o,
});
const freeSlot = (n = 99) => {
  let i = 0;
  return (_r: LaneRow, taken: Set<string>) => {
    for (; i < n; i++) if (!taken.has(`Z-0${i}-1`)) return `Z-0${i}-1`;
    return null;
  };
};
const per = new Map([["H", 100]]);
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
  { name: "P8 recoger fila a fila en cualquier orden (como la PDA, recargando cada vez): siempre 250 y nada se pierde", check: () => {
    // The 250 of horchata: three rows of 100 and a pico of 50 somewhere else. Every order of picking must end with exactly 250 on the order.
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      let stock = [row(100, { id: "r1" }), row(100, { id: "r2" }), row(100, { id: "r3" }), row(50, { id: "pico" })];
      const total = stock.reduce((a, s) => a + s.units, 0);
      for (let step = 0; step < 10; step++) {
        const plan = planOf(stock, order(250));
        const todo = plan.stockIds.filter((id) => !plan.picked.includes(id));
        if (!todo.length) break;
        const id = todo[(seed + step) % todo.length]; // a different walk each seed
        const only: PickPlan = { ...plan, stockIds: [id], picked: [], split: plan.split.filter((p) => p.stockId === id) };
        stock = applyPlan(stock, only, "O1");
      }
      const onOrder = stock.filter((s) => s.outboundId === "O1").reduce((a, s) => a + s.units, 0);
      const all = stock.reduce((a, s) => a + s.units, 0);
      const left = planOf(stock, order(250));
      if (onOrder !== 250 || all !== total || left.shortUnits !== 0 || left.stockIds.length !== left.picked.length) {
        return `seed ${seed}: on order ${onOrder}, total ${all}/${total}, short ${left.shortUnits}, still to pick ${left.stockIds.length - left.picked.length}`;
      }
    }
    return null;
  } },
  { name: "P9 pedido de 60 con filas 12+40+40: coge el pico, un lleno y 8 del tercero; quedan 32 en su hueco", check: () => {
    const stock = [row(12, { id: "pico" }), row(40, { id: "f1" }), row(40, { id: "f2" })];
    const p = planOf(stock, order(60));
    const after = applyPlan(stock, p, "O1");
    const leftover = after.find((s) => s.id === "f2");
    return same({ split: p.split, f2: leftover?.units, picked: after.filter((s) => s.outboundId).reduce((a, s) => a + s.units, 0) }, { split: [{ stockId: "f2", units: 8 }], f2: 32, picked: 60 });
  } },
  { name: "R1 undo a pick: the split row joins its loose pallet again (50 + 50 = 100)", check: () => {
    const p = planRestore([lrow("exp", 50, "EXP-1")], [lrow("exp", 50, "EXP-1"), lrow("pico", 50, "B-02-1")], per, freeSlot());
    return same(p, { merges: [{ fromId: "exp", intoId: "pico", units: 50 }], moves: [] });
  } },
  { name: "R2 whole pallets go back to free slots, never to a taken one", check: () => {
    const lane = [lrow("a", 100, "EXP-1"), lrow("b", 100, "EXP-1")];
    const p = planRestore(lane, [...lane, lrow("x", 100, "Z-00-1", { itemId: "Q" })], per, (_r, t) => (["Z-00-1", "Z-01-1", "Z-02-1"].find((c) => !t.has(c)) ?? null));
    return same(p, { merges: [], moves: [{ id: "a", location: "Z-01-1" }, { id: "b", location: "Z-02-1" }] });
  } },
  { name: "R3 no join when it would pass a full pallet, or lot / expiry / delivery differ", check: () => {
    const lane = [lrow("e1", 60, "EXP-1"), lrow("e2", 50, "EXP-1", { lot: "L2" }), lrow("e3", 50, "EXP-1", { expiresAt: day(29) }), lrow("e4", 50, "EXP-1", { inboundId: "IN2" })];
    const p = planRestore(lane, [...lane, lrow("pico", 50, "B-02-1")], per, freeSlot());
    return same({ merges: p.merges.length, moves: p.moves.map((m) => m.id).sort() }, { merges: 0, moves: ["e1", "e2", "e3", "e4"] });
  } },
  { name: "R4 two split rows of the same lot: the first fills the loose pallet, the second goes to a slot", check: () => {
    const lane = [lrow("e1", 40, "EXP-1"), lrow("e2", 40, "EXP-1")];
    const p = planRestore(lane, [...lane, lrow("pico", 50, "B-02-1")], per, freeSlot());
    return same({ merges: p.merges, moves: p.moves.map((m) => m.id) }, { merges: [{ fromId: "e1", intoId: "pico", units: 40 }], moves: ["e2"] });
  } },
  { name: "R5 full building: the row waits in the receiving lane instead of getting lost", check: () => {
    const p = planRestore([lrow("a", 100, "EXP-1")], [lrow("a", 100, "EXP-1")], per, () => null);
    return same(p.moves, [{ id: "a", location: "REC-1" }]);
  } },
  { name: "R6 a shortage names the item: order 2 pallets + 20 boxes, 1 pallet in stock", check: () => {
    const p = planOf([row(100)], order(220));
    return same({ lines: p.shortLines, short: p.shortUnits }, { lines: [{ itemId: "I1", units: 120, unitsPerPallet: 40 }], short: 120 });
  } },
  { name: "S1 faltante sin palés llenos en stock: solo hay un pico de 12 y piden 100 (40 por palé) → 88 = 3 huecos, «2 palés + 8 cajas»", check: () => {
    const p = planOf([row(12, { id: "pico" })], order(100));
    return same(
      { units: p.shortUnits, slots: p.short, text: describeShortage(p.shortLines, () => ({ sku: "PELUCHE-30", unit: "BOX" })) },
      { units: 88, slots: 3, text: "2 palés + 8 cajas of PELUCHE-30" },
    );
  } },
  { name: "S2 artículo sin una sola fila en stock: 120 cajas (100 por palé) faltan como «1 palé + 20 cajas», no como 120 palés", check: () => {
    const p = planOf([row(40, { id: "otro", itemId: "I2" })], order(120, "I1", "O1", 100));
    return same(
      { slots: p.short, text: describeShortage(p.shortLines, () => ({ sku: "HORCH-1L", unit: "BOX" })), warehouse: p.warehouseId },
      { slots: 2, text: "1 palé + 20 cajas of HORCH-1L", warehouse: null },
    );
  } },
  { name: "S3 faltante en dos artículos: cada uno en su unidad (sacos, cajas) y unidades por palé", check: () => {
    const o: OpenOrder = { id: "O1", number: 1, date: day(20), deadline: null, lines: [{ itemId: "A", units: 60, unitsPerPallet: 55 }, { itemId: "B", units: 30, unitsPerPallet: 100 }] };
    const p = planOf([], o);
    const sku = new Map([["A", { sku: "PP-NAT", unit: "BAG" as const }], ["B", { sku: "PUZZLE-500", unit: "BOX" as const }]]);
    return same({ slots: p.short, text: describeShortage(p.shortLines, (id) => sku.get(id)) }, { slots: 3, text: "1 palé + 5 sacos of PP-NAT and 30 cajas of PUZZLE-500" });
  } },
];

// ---------- pallet by pallet: IDs, mixed pallets (breakdown.ts, codes.ts) ----------
const ITEMS: ItemLite[] = [
  { id: "AGUA", sku: "AGUA-15", unitsPerPallet: 84 },
  { id: "HORCH", sku: "HORCH-1L", unitsPerPallet: 100 },
  { id: "TURR", sku: "TURRON-BLA", unitsPerPallet: 70 },
  { id: "POLV", sku: "POLVORON", unitsPerPallet: 80 },
];
const one = (itemId: string, units: number, code: string | null = null, lot: string | null = "L1"): PalletDraft => ({ code, lines: [{ itemId, lot, expiresAt: null, units }] });
const errorsOf = (d: PalletDraft[], live: Record<string, string> = {}) => checkBreakdown(d, ITEMS, new Map(Object.entries(live))).errors;

const BREAKDOWN_CASES: Case[] = [
  { name: "P10 «38 × AGUA-15» + 2 de otra referencia: 40 palés válidos, resumen 38 y 2 palés", check: () => {
    const d = [...expandPallets({ itemId: "AGUA", lot: "L1", expiresAt: null, units: 84 }, 38), ...expandPallets({ itemId: "HORCH", lot: "H1", expiresAt: null, units: 100 }, 2)];
    return same({ n: d.length, errors: errorsOf(d), summary: summarize(d).map((s) => [s.itemId, s.pallets, s.units]) }, { n: 40, errors: [], summary: [["AGUA", 38, 3192], ["HORCH", 2, 200]] });
  } },
  { name: "P11 palé mixto 35 TURRON-BLA + 40 POLVORON: válido, shares 0,5 + 0,5, cabeza la primera, cada artículo cuenta 1 palé", check: () => {
    const d = [{ code: "OBR-JIJ-0042", lines: [{ itemId: "TURR", lot: "T1", expiresAt: "2026-12-01", units: 35 }, { itemId: "POLV", lot: "P1", expiresAt: null, units: 40 }] }];
    const sh = sharesOf(d[0].lines, ITEMS);
    return same({ errors: errorsOf(d), sh, lead: leadIndex(sh), summary: summarize(d).map((s) => [s.itemId, s.pallets]) }, { errors: [], sh: [0.5, 0.5], lead: 0, summary: [["TURR", 1], ["POLV", 1]] });
  } },
  { name: "P11b la cabeza es la de más share y un palé de una línea no tiene share", check: () => {
    const lines = [{ itemId: "TURR", lot: null, expiresAt: null, units: 20 }, { itemId: "POLV", lot: null, expiresAt: null, units: 40 }];
    const sh = sharesOf(lines, ITEMS) as number[];
    return same({ lead: leadIndex(sh), sum: Math.round((sh[0] + sh[1]) * 1e9) / 1e9, single: sharesOf([lines[0]], ITEMS) }, { lead: 1, sum: 1, single: [null] });
  } },
  { name: "P12 la misma matrícula dos veces en la lista → «is twice on this list»", check: () =>
    same(errorsOf([one("AGUA", 84, "GMV-0581"), one("AGUA", 84, "GMV-0582"), one("HORCH", 100, "GMV-0581")]), ["Pallet ID GMV-0581 is twice on this list."]) },
  { name: "P13 matrícula ya dentro del almacén → «already in the building (A-07-3)»", check: () =>
    same(errorsOf([one("AGUA", 84, "N1-000123")], { "N1-000123": "A-07-3" }), ["Pallet ID N1-000123 is already in the building (A-07-3)."]) },
  { name: "P14 no cabe en un palé: 120 cajas de AGUA-15 (84 máx.) y mixto 60 % + 55 % «more than full»; una línea de 0 cajas", check: () => {
    const mixed: PalletDraft = { code: null, lines: [{ itemId: "TURR", lot: null, expiresAt: null, units: 42 }, { itemId: "POLV", lot: null, expiresAt: null, units: 44 }] };
    return same([errorsOf([one("AGUA", 120)]), errorsOf([mixed]), errorsOf([one("AGUA", 0)]).length, errorsOf([]).length], [
      ["Pallet 1: 120 boxes of AGUA-15 do not fit on one pallet (84 max)."],
      ["Pallet 1 is more than full (60 % + 55 %)."],
      1, 1,
    ]);
  } },
  { name: "P14b límites: 67 palés, 5 líneas en un palé, fecha mala, artículo ajeno, mismo artículo y lote dos veces", check: () => {
    const many = Array.from({ length: 67 }, () => one("AGUA", 1));
    const five: PalletDraft = { code: null, lines: Array.from({ length: 5 }, (_, i) => ({ itemId: "AGUA", lot: `L${i}`, expiresAt: null, units: 1 })) };
    const bad: PalletDraft = { code: null, lines: [{ itemId: "AGUA", lot: null, expiresAt: "2026-13-45", units: 1 }] };
    const alien = one("ZZZ", 1);
    const twice: PalletDraft = { code: null, lines: [{ itemId: "AGUA", lot: "L", expiresAt: null, units: 1 }, { itemId: "AGUA", lot: "L", expiresAt: null, units: 1 }] };
    return same([errorsOf(many)[0], errorsOf([five])[0], errorsOf([bad]).length, errorsOf([alien]), errorsOf([twice])], [
      "A delivery has at most 66 pallets here (this one has 67).",
      "Pallet 1: at most 4 items on one pallet.",
      1,
      ["Pallet 1: that item is not one of this customer's."],
      ["Pallet 1: AGUA-15 is listed twice with the same lot and date."],
    ]);
  } },
  { name: "P15 fromNote con matrículas: 3 palés de AGUA con AA-1, AA-2, AA-3 y 1 de HORCH con AA-2 → 3 palés, el segundo mixto", check: () => {
    const d = fromNote([
      { sku: "AGUA-15", lot: "L1", pallets: 3, units: 252, palletCodes: ["aa-1", "AA-2", "AA-3"] },
      { sku: "HORCH-1L", lot: "H1", pallets: 1, units: 40, palletCodes: ["AA-2"] },
    ], ITEMS);
    return same(d.map((p) => [p.code, p.lines.map((l) => [l.itemId, l.units])]), [["AA-1", [["AGUA", 84]]], ["AA-2", [["AGUA", 84], ["HORCH", 40]]], ["AA-3", [["AGUA", 84]]]]);
  } },
  { name: "P15b fromNote: la 2.ª línea de un mixto sin columna de palés (solo cajas y la matrícula ya leída) se une a ese palé; sin matrícula conocida se deja fuera", check: () => {
    const d = fromNote([
      { sku: "AGUA-15", lot: "L1", pallets: 2, units: 120, palletCodes: ["AA-1", "MIX-0107"] },
      { sku: "HORCH-1L", lot: "H1", pallets: null, units: 30, palletCodes: ["mix-0107"] },
      { sku: "HORCH-1L", lot: "H2", pallets: null, units: 30, palletCodes: ["ZZ-9999"] },
    ], ITEMS);
    return same(d.map((p) => [p.code, p.lines.map((l) => [l.itemId, l.lot, l.units])]), [["AA-1", [["AGUA", "L1", 60]]], ["MIX-0107", [["AGUA", "L1", 60], ["HORCH", "H1", 30]]]]);
  } },
  { name: "P15c heldPallets: un mixto de dos líneas es 1 palé (no 2 picos); las demás filas, palé o pico por su artículo", check: () => {
    const per = new Map([["TURR", 70], ["POLV", 80], ["AGUA", 84]]);
    const r = (itemId: string, units: number, palletCode: string | null, palletShare: number | null) => ({ itemId, units, palletCode, palletShare, warehouseId: "w2" });
    return same(heldPallets([r("TURR", 35, "OBR-1", 0.5), r("POLV", 40, "OBR-1", 0.5), r("AGUA", 84, "N2-1", null), r("AGUA", 20, "N2-2", null)], per), { full: 2, picos: 1 });
  } },
  { name: "P16 fromNote sin matrículas: 250 cajas en 3 palés de 84 → 84 + 83 + 83; sin cajas, palés llenos; matrícula inválida se descarta", check: () => {
    const a = fromNote([{ sku: "AGUA-15", lot: null, pallets: 3, units: 250 }], ITEMS).map((p) => p.lines[0].units);
    const b = fromNote([{ sku: "HORCH-1L", lot: " H ", pallets: 2, units: null, palletCodes: ["??", "OK-1234"] }, { sku: "NOPE", lot: null, pallets: 4, units: null }], ITEMS);
    return same([a, b.map((p) => [p.code, p.lines[0].units, p.lines[0].lot])], [[84, 83, 83], [[null, 100, "H"], ["OK-1234", 100, "H"]]]);
  } },
  { name: "P17 matrículas: parseCode (mayúsculas, sin espacios, quita «(00)», vacío = ninguna, inválidas), generatedCode y freshCodes saltan las vivas", check: () => {
    const taken = new Set(["N1-000002"]);
    const f = freshCodes("N1", 1, 3, taken);
    return same([
      parseCode(" (00)n1-000123 "), parseCode("   "), parseCode("ab"), parseCode("a".repeat(30)).ok, parseCode("A B/C").ok, generatedCode("N1", 123),
      f, [...taken].sort(),
    ], [
      { ok: true, code: "N1-000123" }, { ok: true, code: null }, { ok: false, error: 'Pallet ID "AB" is not valid: 4 to 24 letters, digits or dashes.' }, false, false, "N1-000123",
      { codes: ["N1-000001", "N1-000003", "N1-000004"], used: 4 }, ["N1-000001", "N1-000002", "N1-000003", "N1-000004"],
    ]);
  } },
  { name: "P18 cleanDrafts: limpia el código y el lote; lo que no es una lista de palés con líneas se rechaza", check: () => {
    const ok = cleanDrafts([{ code: " gmv 0581 ", lines: [{ itemId: "AGUA", lot: " L1 ", expiresAt: "", units: 84 }] }, { code: "", lines: [{ itemId: "HORCH", units: 5 }] }]);
    const bad = [cleanDrafts("x"), cleanDrafts([null]), cleanDrafts([{ code: 7, lines: [] }]), cleanDrafts([{ code: null, lines: [{ itemId: "A", units: "5" }] }]), cleanDrafts([{ code: "ab", lines: [] }])].map((r) => r.ok);
    return same([ok.ok && ok.drafts, bad], [[{ code: "GMV0581", lines: [{ itemId: "AGUA", lot: "L1", expiresAt: null, units: 84 }] }, { code: null, lines: [{ itemId: "HORCH", lot: null, expiresAt: null, units: 5 }] }], [false, false, false, false, false]]);
  } },
];

// ---------- picking and putting back pallets with IDs ----------
let cseq = 0;
const crow = (id: string, itemId: string, units: number, code: string | null, o: Partial<PickableStock> = {}): PickableStock => ({
  id, warehouseId: "W1", itemId, location: "C-13-4", units, expiresAt: day(20 + ++cseq), receivedAt: day(1), outboundId: null, palletCode: code, ...o,
});
const mixedStock = () => [crow("t", "TURR", 35, "OBR-1"), crow("p", "POLV", 40, "OBR-1", { expiresAt: day(10) }), crow("solo", "AGUA", 84, "N1-000009", { location: "A-01-1" })];
const askFor = (...lines: [string, number][]): OpenOrder => ({ id: "O1", number: 1, date: day(20), deadline: null, lines: lines.map(([itemId, units]) => ({ itemId, units, unitsPerPallet: ({ TURR: 70, POLV: 80, AGUA: 84 } as Record<string, number>)[itemId] })) });
const crow2 = (id: string, itemId: string, units: number, location: string, o: Partial<LaneRow> = {}): LaneRow => ({
  id, warehouseId: "W1", itemId, clientId: "C8", lot: "L", expiresAt: day(28), inboundId: "IN1", units, location, palletCode: null, palletShare: null, pallets: 1, splitFrom: null, ...o,
});
const upp = new Map([["TURR", 70], ["POLV", 80], ["AGUA", 84]]);

const PICK_CASES: Case[] = [
  { name: "R7 pedido que se lleva las dos filas de un palé mixto → UN paso «pallet» con las dos filas y su matrícula; un palé sin mixto, también", check: () => {
    const p = planOf(mixedStock(), askFor(["TURR", 35], ["POLV", 40], ["AGUA", 84]));
    return same(p.steps, [
      { kind: "pallet", palletCode: "OBR-1", stockIds: ["t", "p"], location: "C-13-4" },
      { kind: "pallet", palletCode: "N1-000009", stockIds: ["solo"], location: "A-01-1" },
    ]);
  } },
  { name: "R8 pedido de una sola referencia del mixto (40 de POLVORON, la fila entera) → paso «boxes» mixed, y la fila entra en split aunque se lleve entera", check: () => {
    const p = planOf(mixedStock(), askFor(["POLV", 40]));
    return same({ steps: p.steps, split: p.split }, {
      steps: [{ kind: "boxes", stockId: "p", units: 40, palletCode: "OBR-1", location: "C-13-4", mixed: true }],
      split: [{ stockId: "p", units: 40 }],
    });
  } },
  { name: "R8b cajas sueltas (30 de AGUA de un palé de 84) → boxes no mixed; FEFO no cambia: el mixto que caduca antes sale primero", check: () => {
    const p = planOf(mixedStock(), askFor(["AGUA", 30]));
    const q = planOf([crow("late", "POLV", 80, "N1-000011", { expiresAt: day(25) }), ...mixedStock()], askFor(["POLV", 40]));
    return same([p.steps, q.steps.map((s) => (s.kind === "boxes" ? s.stockId : "pallet"))], [
      [{ kind: "boxes", stockId: "solo", units: 30, palletCode: "N1-000009", location: "A-01-1", mixed: false }],
      ["p"],
    ]);
  } },
  { name: "R8c tras recoger parte: el palé ya recogido no vuelve a salir como paso; el mixto con una fila reservada por otro pedido no se lleva «entero»", check: () => {
    const stock = mixedStock();
    const orders = [askFor(["TURR", 35]), { ...askFor(["POLV", 40], ["TURR", 0]), id: "O2", number: 2 }];
    const plans = allocatePicks(stock, orders);
    return same([plans.get("O1")!.steps.map((s) => s.kind), plans.get("O2")!.steps.map((s) => s.kind)], [["boxes"], ["boxes"]]);
  } },
  { name: "R9 Replay: la fila POLVORON sacada del mixto (splitFrom OBR-1) vuelve a su palé con su matrícula, y las dos filas se reparten 0,5 + 0,5", check: () => {
    const left = crow2("t", "TURR", 35, "C-13-4", { palletCode: "OBR-1", palletShare: null, pallets: 1 });
    const piece = crow2("p", "POLV", 40, "EXP-1", { palletCode: "N2-000162", splitFrom: "OBR-1" });
    const plan = planRestore([piece], [left, piece], upp, freeSlot());
    return same({ joins: plan.joins, moves: plan.moves, shares: plan.shares }, {
      joins: [{ id: "p", palletCode: "OBR-1", location: "C-13-4" }],
      moves: [],
      shares: [{ id: "p", pallets: 1, palletShare: 0.5 }, { id: "t", pallets: 0, palletShare: 0.5 }], // tie: the lowest id is the head
    });
  } },
  { name: "R9b Replay: cajas sacadas de una fila (splitFrom) se suman a la fila de origen; el palé queda de una línea (sin share)", check: () => {
    const rest = crow2("rest", "AGUA", 54, "A-01-1", { palletCode: "N1-000009" });
    const piece = crow2("piece", "AGUA", 30, "EXP-1", { palletCode: "N1-000200", splitFrom: "N1-000009" });
    const plan = planRestore([piece], [rest, piece], upp, freeSlot());
    return same({ merges: plan.merges, joins: plan.joins ?? null, shares: plan.shares }, { merges: [{ fromId: "piece", intoId: "rest", units: 30 }], joins: null, shares: [{ id: "rest", pallets: 1, palletShare: null }] });
  } },
  { name: "R10 cabeza recalculada: si la fila de más share es la que vuelve, pasa a ser la cabeza (y la otra queda en 0 palés); un palé entero sale de nuevo junto con su matrícula", check: () => {
    const rest = crow2("a", "TURR", 20, "C-13-4", { palletCode: "OBR-2", palletShare: null, pallets: 1 }); // 20/70 = 0,286
    const piece = crow2("b", "POLV", 40, "EXP-1", { palletCode: "N2-000300", splitFrom: "OBR-2" }); // 40/80 = 0,5
    const plan = planRestore([piece], [rest, piece], upp, freeSlot());
    const sh = plan.shares ?? [];
    const lead = sh.filter((x) => x.pallets === 1).map((x) => x.id);
    const sum = sh.reduce((a, x) => a + (x.palletShare ?? 0), 0);
    // A mixed pallet that left whole (pallet step) goes back whole: one slot for both rows, ID kept.
    const whole = planRestore([crow2("x", "TURR", 35, "EXP-1", { palletCode: "OBR-3", palletShare: 0.5, pallets: 1 }), crow2("y", "POLV", 40, "EXP-1", { palletCode: "OBR-3", palletShare: 0.5, pallets: 0 })], [], upp, freeSlot());
    return same({ lead, sum: Math.round(sum * 1e9) / 1e9, whole: whole.moves, noShares: whole.shares ?? null }, { lead: ["b"], sum: 1, whole: [{ id: "x", location: "Z-00-1" }, { id: "y", location: "Z-00-1" }], noShares: null });
  } },
  { name: "R10b pieza que ya no cabe en su palé de origen (más de 100 %) o cuyo origen ya no está: va a un hueco propio y no toca la matrícula", check: () => {
    const origin = crow2("o", "AGUA", 84, "A-01-1", { palletCode: "N1-000009" });
    const full = crow2("f", "TURR", 10, "EXP-1", { palletCode: "N2-1", splitFrom: "N1-000009" });
    const gone = crow2("g", "TURR", 10, "EXP-1", { palletCode: "N2-2", splitFrom: "ZZ-GONE-1" });
    const plan = planRestore([full, gone], [origin, full, gone], upp, freeSlot());
    return same({ moves: plan.moves.length, joins: plan.joins ?? null, shares: plan.shares ?? null }, { moves: 2, joins: null, shares: null });
  } },
];
CASES.push(...BREAKDOWN_CASES, ...PICK_CASES);

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
