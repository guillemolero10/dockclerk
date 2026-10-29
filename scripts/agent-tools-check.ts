// Checks for what the clerk's tools say about quantities and bills. Pure: no database, no model, no keys, no network.
//
//   npx tsx scripts/agent-tools-check.ts
//
// Covers convert_quantity, the figures guard (what a reply may contain), the Spanish formats, the shape of
// bill_so_far / explain_charge and the plan B classification of billing questions.
// Exit code 1 if any case fails, so it can run before recording the video.

import { billingIntent, ddmm, eurosEs, monthFromText, numEs, resolveWindow, shapeBill, shapeExplain, type BillIn, type DetailIn } from "../src/lib/agent/bill-format";
import { convertLog, convertQuantity, type ConvertItem } from "../src/lib/agent/convert";
import { amountInMessage, figures, inventedFigures, messageQuantities, unitsGrounded } from "../src/lib/agent/guard";
import { buildLine, checkModelUnits, vouchConversion, withUnits } from "../src/lib/agent/lines";
import { draftMessage, outboundDraft } from "../src/lib/agent/rules";
import { billPeriod, type TariffInput } from "../src/lib/billing/compute";
import { dayOfYmd, period } from "../src/lib/billing/calendar";
import type { Stay } from "../src/lib/billing/stays";
import { clients as seedClients } from "../prisma/seed-data";
import { norm, tradeName } from "../src/lib/agent/words";

type Case = { name: string; check: () => string | null | undefined | Promise<string | null> };

const same = (got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return g === w ? null : `got ${g}, expected ${w}`;
};

const PELUCHE: ConvertItem = { sku: "PELUCHE-30", unitsPerPallet: 40, unit: "BOX" };
const HORCH: ConvertItem = { sku: "HORCH-1L", unitsPerPallet: 100, unit: "BOX" };
const PUZZLE: ConvertItem = { sku: "PUZZLE-500", unitsPerPallet: 60, unit: "BOX" };
const PPNAT: ConvertItem = { sku: "PP-NAT", unitsPerPallet: 55, unit: "BAG" };

// ---------- a real bill from the billing engine, to shape and to guard ----------
const tariff: TariffInput = { inPerPallet: 1, outPerPallet: 1, storagePrice: 0.1, storageByType: { AMERICAN: 0.2 }, factorPct: 100, vatPct: 21, partialPallets: "FRACTION" };
const stays = (n: number, o: { inbound: number; inYmd: string; outYmd?: string }): Stay[] =>
  Array.from({ length: n }, () => ({
    inboundId: `in${o.inbound}`, inboundNumber: o.inbound, docRef: null, itemId: "I1", sku: "PUZZLE-500", lot: "L-2310", palletType: "EURO" as const,
    units: 60, perPallet: 60, inDay: dayOfYmd(o.inYmd), inKnown: true, outDay: o.outYmd ? dayOfYmd(o.outYmd) : null, outboundNumber: o.outYmd ? 7002 : null,
  }));
// 23 pallets come in on 20/05; 2 of them leave on 08/06. Month of May: 21 + 2 rows, 276 pallet·days.
const may = period("2026-05");
const result = billPeriod({ stays: [...stays(21, { inbound: 1043, inYmd: "2026-05-20" }), ...stays(2, { inbound: 1043, inYmd: "2026-05-20", outYmd: "2026-06-08" })], handling: [], tariff, period: may });
const bill: BillIn = { p: may, toDate: false, status: "draft", rule: result.rule, lines: result.lines, baseCents: result.baseCents, vatPct: result.vatPct, vatCents: result.vatCents, totalCents: result.totalCents };
const shaped = shapeBill(bill);
const detail = result.detail as unknown as DetailIn[];
const bigBill: BillIn = { ...bill, lines: [{ concept: "storage", label: "Storage, euro pallets", quantity: 12846, unit: "pallet·day", price: 0.1, cents: 128460 }], baseCents: 128460, vatCents: 0, vatPct: 0, totalCents: 128460 };

const fakeClient = { id: "c1", code: "C001", name: "Juguetes Levante", contact: "Marta" };
const asMessage = (body: string) => ({ id: "m", channel: "EMAIL", fromName: "Marta Pérez (Juguetes Levante)", fromAddress: null, clientId: "c1", subject: null, body, audioUrl: null, attachmentUrl: null, receivedAt: new Date(), status: "NEW", client: fakeClient }) as never;
const TODAY = "2026-10-28";

/**
 * What the model's `units` become: the same glue as settle() in muse.ts (buildLine → checkModelUnits → outboundDraft), without the database.
 * `converted` are the units convert_quantity returned for this item in the conversation; `free` the stock free to promise.
 */
const draftFromModel = (item: ConvertItem, units: number, body: string, converted: number[] = [], free = 100_000, wholeOptions?: number[]) => {
  const info = { id: `id-${item.sku}`, sku: item.sku, description: item.sku, unitsPerPallet: item.unitsPerPallet, unit: item.unit };
  const line = checkModelUnits(buildLine(info, units, free, wholeOptions), body, converted);
  const seed = outboundDraft(asMessage(body), fakeClient as never, [line], [{ id: "d1", name: "SuperBahía – Alicante", city: "Alicante" }], null, []);
  return { line, doubts: seed.doubts, values: seed.doubts.flatMap((d) => d.options.map((o) => o.value)) };
};

// ---------- the model's order for the seeded customers (real SKUs, descriptions and units per pallet) ----------
const catalogOf = (code: string) =>
  seedClients.find((c) => c.code === code)!.items.map(([sku, description, unit, unitsPerPallet]) => ({ sku, description, unit, unitsPerPallet }));
/** A line of the model's final answer; `asked` is the convert_quantity call it made first (amount, unit), if any. */
type ModelLine = { sku: string; units: number; asked?: [number, "pallets" | "units"] };
/**
 * What the model's lines become, through the same glue as muse.ts (vouchConversion → buildLine → checkModelUnits → outboundDraft),
 * with the customer's real catalog so each quantity of the message can be tied to its product. No database, no model.
 */
const orderFromModel = (code: string, body: string, lines: ModelLine[]) => {
  const catalog = catalogOf(code);
  const converted = new Map<string, number[]>();
  const drafted = lines.map((l) => {
    const item = catalog.find((i) => i.sku === l.sku)!;
    if (l.asked) vouchConversion(converted, item, convertQuantity(item, l.asked[0], l.asked[1]), l.asked[0], l.asked[1], body, catalog);
    return checkModelUnits(buildLine({ id: `id-${l.sku}`, ...item }, l.units, 1_000_000), body, converted.get(l.sku) ?? [], catalog);
  });
  const seed = outboundDraft(asMessage(body), fakeClient as never, drafted, [{ id: "d1", name: "SuperBahía – Alicante", city: "Alicante" }], null, []);
  return { fields: seed.doubts.map((d) => d.field), values: Object.fromEntries(seed.doubts.map((d) => [d.field, d.options.map((o) => o.value)])) as Record<string, string[]> };
};
/** Correct answers of the model for messages that must raise no doubt, both ways: converting first and sending the units straight. */
type Good = { id: string; code: string; body: string; lines: ModelLine[] };
const noDoubts = (rows: Good[]) =>
  rows.flatMap((r) => [
    { id: r.id, fields: orderFromModel(r.code, r.body, r.lines).fields },
    { id: `${r.id} (sin convert_quantity)`, fields: orderFromModel(r.code, r.body, r.lines.map((l) => ({ sku: l.sku, units: l.units }))).fields },
  ]).filter((x) => x.fields.length).map((x) => `${x.id}: ${x.fields.join(",")}`);

const VIDEO: Good[] = [
  { id: "V1 PELUCHE-30 12 palés", code: "C001", body: "Buenas, mañana mandad 12 palés de la ref. PELUCHE-30 a Hipermercados Turia, que lleguen antes de las 10. Gracias, Marta.",
    lines: [{ sku: "PELUCHE-30", units: 480, asked: [12, "pallets"] }] },
  { id: "V2 agua 6 palés + horchata 2,5", code: "C004", body: "Hola! Para el jueves necesito 6 palés de agua de litro y medio para SuperBahía Alicante. Y si puede ser 2 palés y medio de horchata también 👍",
    lines: [{ sku: "AGUA-15", units: 504, asked: [6, "pallets"] }, { sku: "HORCH-1L", units: 250, asked: [2.5, "pallets"] }] },
  { id: "V4 gel de 750, 3 palés", code: "C007", body: "Necesito sacar 3 palés de gel de 750 para Perfumerías Lucentum el viernes por la mañana.",
    lines: [{ sku: "GEL-750", units: 210, asked: [3, "pallets"] }] },
];
const EVAL: Good[] = [
  { id: "N1 dos palets + 5 de puzzles de 500 piezas", code: "C001", body: "Hola, necesitaríamos que salgan dos palets de muñecas clásicas y 5 de puzzles de 500 piezas hacia Hipermercados Turia el viernes. Gracias.",
    lines: [{ sku: "MUNECA-CL", units: 96, asked: [2, "pallets"] }, { sku: "PUZZLE-500", units: 300, asked: [5, "pallets"] }] },
  { id: "N2 media docena de palés de agua", code: "C004", body: "Toni aquí. Mandadme media docena de palés de agua de litro y medio a SuperBahía Alicante el lunes",
    lines: [{ sku: "AGUA-15", units: 504, asked: [6, "pallets"] }] },
  { id: "N7 40 palés de PP natural", code: "C002", body: "Necesito 40 palés de PP natural en Inyectados Castalla pasado mañana por la mañana",
    lines: [{ sku: "PP-NAT", units: 2200, asked: [40, "pallets"] }] },
  { id: "N8 10 de mazapán y 5 de polvorones", code: "C008", body: "Mandad 10 palés de mazapán y 5 de polvorones a Costablanca Castellón antes del viernes",
    lines: [{ sku: "MAZAPAN", units: 800, asked: [10, "pallets"] }, { sku: "POLVORON", units: 400, asked: [5, "pallets"] }] },
  { id: "N9 3 de zapatilla running talla 42", code: "C003", body: "oye, mañana a primera hora saca 3 de zapatilla running talla 42 para Hogar y Más Barcelona",
    lines: [{ sku: "ZAP-RUN-42", units: 108, asked: [3, "pallets"] }] },
  { id: "Q1 2,5 palés de PELUCHE-30", code: "C001", body: "Mandad 2,5 palés de PELUCHE-30 a SuperBahía Alicante el viernes", lines: [{ sku: "PELUCHE-30", units: 100, asked: [2.5, "pallets"] }] },
  { id: "Q2 2 palés y medio de horchata", code: "C004", body: "Toni aquí. Mandadme 2 palés y medio de horchata a SuperBahía Alicante el lunes", lines: [{ sku: "HORCH-1L", units: 250, asked: [2.5, "pallets"] }] },
  { id: "130 cajas de PELUCHE-30", code: "C001", body: "Mandad 130 cajas de PELUCHE-30 a SuperBahía Alicante el viernes", lines: [{ sku: "PELUCHE-30", units: 130, asked: [130, "units"] }] },
  { id: "campaña: 20 palés de turrón duro y 15 de blando", code: "C008", body: "Hola equipo, para la semana que viene vamos a necesitar 20 palés de turrón duro y 15 de blando para Grupo Costablanca Elche. ¿Tenéis suficiente stock?",
    lines: [{ sku: "TURRON-DUR", units: 1400, asked: [20, "pallets"] }, { sku: "TURRON-BLA", units: 1050, asked: [15, "pallets"] }] },
  { id: "portal: 8 palés de refresco de naranja", code: "C004", body: "Mandad 8 palés de refresco de naranja a Hipermercados Turia Quart para el miércoles.", lines: [{ sku: "REFR-NAR", units: 640, asked: [8, "pallets"] }] },
  { id: "10 palés de PP natural del lote más antiguo", code: "C002", body: "Por favor, preparad 10 palés de PP natural del lote más antiguo para Inyectados Castalla, recogida mañana a primera hora.", lines: [{ sku: "PP-NAT", units: 550, asked: [10, "pallets"] }] },
];

const CASES: Case[] = [
  // ----- convert_quantity -----
  { name: "Q1 2,5 palés de PELUCHE-30 (40) → 100 · 2 + 20", check: () => {
    const r = convertQuantity(PELUCHE, 2.5, "pallets");
    return "error" in r ? r.error : same({ u: r.units, f: r.fullPallets, l: r.looseUnits, t: r.text, e: r.palletEquivalent }, { u: 100, f: 2, l: 20, t: "2 palés + 20 cajas", e: 2.5 });
  } },
  { name: "Q2 2,5 palés de HORCH-1L (100) → 250 · «2 palés + 50 cajas» y la línea del log", check: () => {
    const r = convertQuantity(HORCH, 2.5, "pallets");
    return "error" in r ? r.error : same({ u: r.units, log: convertLog("HORCH-1L", 2.5, "pallets", r) }, { u: 250, log: "convert_quantity(HORCH-1L, 2.5 pallets) → 2 palés + 50 cajas" });
  } },
  { name: "Q3 medio palé de PUZZLE-500 (60) → 30 cajas", check: () => {
    const r = convertQuantity(PUZZLE, 0.5, "pallets");
    return "error" in r ? r.error : same({ u: r.units, t: r.text }, { u: 30, t: "30 cajas" });
  } },
  { name: "Q4 130 cajas de PELUCHE-30 → 3 palés + 10 cajas", check: () => {
    const r = convertQuantity(PELUCHE, 130, "units");
    return "error" in r ? r.error : same({ u: r.units, t: r.text }, { u: 130, t: "3 palés + 10 cajas" });
  } },
  { name: "Q5 1,5 palés de PP-NAT (55 sacos) → error con opciones 82 y 83", check: () => {
    const r = convertQuantity(PPNAT, 1.5, "pallets");
    return "error" in r ? same({ options: r.options.map((o) => o.units), text: r.options.map((o) => o.text), error: r.error }, { options: [82, 83], text: ["1 palé + 27 sacos", "1 palé + 28 sacos"], error: "1.5 pallets is not a whole number of sacos" }) : "should be an error";
  } },
  { name: "Q7 cero, negativo, texto: error sin opciones", check: () => {
    const bad = [convertQuantity(PELUCHE, 0, "pallets"), convertQuantity(PELUCHE, -3, "units"), convertQuantity(PELUCHE, "mucho", "units"), convertQuantity(PELUCHE, null, "units")];
    return bad.every((r) => "error" in r && r.options.length === 0) ? null : JSON.stringify(bad);
  } },
  { name: "Q8 el modelo manda «2,5» como texto y la unidad como «palés» o «boxes»", check: () => {
    const a = convertQuantity(HORCH, "2,5", "palés");
    const b = convertQuantity(HORCH, "130", "boxes");
    return "error" in a || "error" in b ? "error" : same([a.units, b.units], [250, 130]);
  } },

  // ----- guard of figures -----
  { name: "G1 acepta «1.284,60 €» si la herramienta lo devolvió (en el texto y como número)", check: () => {
    const asText = JSON.stringify({ text: "total 1.284,60 €", total: 1284.6 });
    const asNumber = JSON.stringify({ total: 1284.6 });
    return same([inventedFigures("Llevas 1.284,60 € este mes.", [asText]), inventedFigures("Llevas 1.284,60 € este mes.", [asNumber])], [[], []]);
  } },
  { name: "G2 acepta «1284,60 €» sin punto de miles", check: () => same(inventedFigures("El total es 1284,60 €", [JSON.stringify({ total: 1284.6 })]), []) },
  { name: "G3 rechaza una cifra inventada (1.290,00 o 1.284,61)", check: () => {
    const src = [JSON.stringify({ total: 1284.6, totalText: "1.284,60 €" })];
    return same([inventedFigures("Llevas 1.290,00 €", src), inventedFigures("Llevas 1.284,61 €", src)], [["1290"], ["1284.61"]]);
  } },
  { name: "G4 «276 palés·día» sí, «277 palés·día» no", check: () => {
    const src = [JSON.stringify({ palletDays: 276 })];
    return same([inventedFigures("Son 276 palés·día.", src), inventedFigures("Son 277 palés·día.", src)], [[], ["277"]]);
  } },
  { name: "G5 fechas «08/11» y «8 de noviembre» sí desde «2026-11-08»; «09/11» no", check: () => {
    const src = [JSON.stringify({ exit: "2026-11-08" })];
    return same([inventedFigures("Salen el 08/11.", src), inventedFigures("Salen el 8 de noviembre.", src), inventedFigures("Salen el 09/11.", src)], [[], [], ["9"]]);
  } },
  { name: "G6 decimales de JSON (30.24, 0.125) y su forma española", check: () => {
    const src = [JSON.stringify({ amount: 30.24, price: 0.125 })];
    return same([inventedFigures("Son 30,24 € a 0,125 €", src), inventedFigures("Son 30,25 €", src)], [[], ["30.25"]]);
  } },
  { name: "G7 miles españoles en la respuesta («1.360») y en el mensaje del cliente", check: () => same(inventedFigures("Hay 1.360 cajas", [JSON.stringify({ freeUnits: 1360 })]), []) },
  { name: "G8 el guardián lee bien los números sueltos", check: () => same(figures("2,5 palés, 1.284,60 € y 08/11"), ["2.5", "1284.6", "8", "11"]) },
  { name: "G9 todo texto que fabrica el código pasa su propio guardián (el JSON de la herramienta es la fuente)", check: () => {
    const bad = [shaped.text, shapeBill(bigBill).text, String(shapeExplain(detail, may, { inbound: 1043 }, "draft").text)]
      .map((t, i) => inventedFigures(t, [JSON.stringify([shaped, shapeBill(bigBill), shapeExplain(detail, may, { inbound: 1043 }, "draft")][i])]))
      .flat();
    return same(bad, []);
  } },

  // ----- the model's units go through the guard (muse.ts → settle) -----
  { name: "M1 cifra inventada del modelo (77 con «3 palés» de horchata y sin convert_quantity) → duda units:HORCH-1L con 300 (el mensaje) y 77", check: () => {
    const d = draftFromModel(HORCH, 77, "Mandad 3 palés de horchata a SuperBahía Alicante el lunes");
    return same({ fields: d.doubts.map((x) => x.field), values: d.values, flagged: Boolean(d.line.unconfirmed) }, { fields: ["units:HORCH-1L"], values: ["300", "77"], flagged: true });
  } },
  { name: "M2 cifra del mensaje (130 cajas) → sin duda", check: () => same(draftFromModel(PELUCHE, 130, "Mandad 130 cajas de PELUCHE-30 a SuperBahía Alicante el viernes").doubts, []) },
  { name: "M2b cifra escrita sin palabra de unidad («Mandad 120 PELUCHE-30») → sin duda; el 30 del SKU no vale", check: () => {
    const ok = draftFromModel(PELUCHE, 120, "Mandad 120 PELUCHE-30 a SuperBahía Alicante").doubts.length;
    const sku = draftFromModel(PELUCHE, 30, "Mandad 120 PELUCHE-30 a SuperBahía Alicante").doubts.length;
    return same({ ok, sku }, { ok: 0, sku: 1 });
  } },
  { name: "M3 cifra que sale de convert_quantity (2,5 palés de HORCH-1L → 250) → sin duda, aunque el mensaje no tenga un 250", check: () => {
    const q = convertQuantity(HORCH, 2.5, "pallets");
    const units = "units" in q ? q.units : -1;
    return same({ units, doubts: draftFromModel(HORCH, units, "Toni aquí. Mandadme 2 palés y medio de horchata a SuperBahía Alicante el lunes", [units]).doubts }, { units: 250, doubts: [] });
  } },
  { name: "M3b el modelo se salta convert_quantity pero la cifra es la que el código lee del mensaje («2 palés y medio» = 250) → sin duda", check: () =>
    same(draftFromModel(HORCH, 250, "Mandadme 2 palés y medio de horchata").doubts, []) },
  { name: "M3c convert_quantity de OTRO artículo no vale (250 de HORCH-1L no avala 250 de PELUCHE-30)", check: () =>
    same(unitsGrounded(250, 40, "Mandad peluche a Alicante", []), false) },
  { name: "M4 «3 palés» y el modelo pone 3 unidades → duda (3 no es 3 cajas) con 180 (3 palés de PUZZLE-500) y 3", check: () => {
    const d = draftFromModel(PUZZLE, 3, "Mandad 3 palés de puzzle a SuperBahía Alicante");
    return same({ fields: d.doubts.map((x) => x.field), values: d.values }, { fields: ["units:PUZZLE-500"], values: ["180", "3"] });
  } },
  { name: "M5 horas, fechas y referencias no avalan una cantidad (10 en «antes de las 10», 3 en «3 de noviembre», 4523 en «pedido 4523»)", check: () =>
    same([
      draftFromModel(PUZZLE, 10, "Mandad puzzle a SuperBahía Alicante antes de las 10:00").doubts.length,
      draftFromModel(PUZZLE, 3, "Mandad puzzle a SuperBahía Alicante el 3 de noviembre").doubts.length,
      draftFromModel(PUZZLE, 4523, "Mandad puzzle a SuperBahía Alicante, pedido 4523").doubts.length,
    ], [1, 1, 1]) },
  { name: "M5b «el 3 de noviembre» no se lee como 3 palés: la duda no ofrece «lo que dice el mensaje»", check: () =>
    same(draftFromModel(PUZZLE, 77, "Mandad puzzle a SuperBahía Alicante el 3 de noviembre").values, ["77"]) },
  { name: "M6 cantidad no entera (1,5 palés de PP-NAT): una sola duda, con las opciones 82 y 83 que calculó el código", check: () => {
    const d = draftFromModel(PPNAT, 82, "Mandad 1,5 palés de PP natural a SuperBahía Alicante", [82, 83], 100_000, [82, 83]);
    return same({ fields: d.doubts.map((x) => x.field), values: d.values, flagged: Boolean(d.line.unconfirmed) }, { fields: ["units:PP-NAT"], values: ["82", "83"], flagged: false });
  } },
  { name: "M7 cifra inventada y además poco stock → una sola duda units:SKU (no dos), con las opciones de stock", check: () => {
    const d = draftFromModel(HORCH, 77, "Mandad 3 palés de horchata a SuperBahía Alicante", [], 50);
    return same({ fields: d.doubts.map((x) => x.field), values: d.values, says: /not in the message/.test(d.doubts[0]?.question ?? "") }, { fields: ["units:HORCH-1L"], values: ["50", "77"], says: true });
  } },
  { name: "M8 la persona elige una opción → la línea ya no queda marcada y los palés se recalculan", check: () => {
    const flagged = draftFromModel(HORCH, 77, "Mandad 3 palés de horchata a SuperBahía Alicante").line;
    const chosen = withUnits(flagged, 300);
    return same({ was: Boolean(flagged.unconfirmed), now: Boolean(chosen.unconfirmed), units: chosen.units, pallets: chosen.pallets, text: chosen.text }, { was: true, now: false, units: 300, pallets: 3, text: "3 palés" });
  } },
  { name: "M9 dos cantidades en el mensaje: sin lectura propia del mensaje (no se sabe a cuál línea pertenece), solo la cifra del modelo", check: () => {
    const d = draftFromModel(HORCH, 77, "Mandad 3 palés de horchata y 40 cajas de peluche a SuperBahía Alicante");
    return same(d.values, ["77"]);
  } },

  // ----- the model's units: a number only counts when the message reads it as a quantity of THAT item -----
  { name: "U1 «gel de 750» (mensaje 4 del vídeo): 750 es ml; si el modelo pone 750 cajas → duda con lo que dice el mensaje (210) y 750", check: () => {
    const body = "Necesito sacar 3 palés de gel de 750 para Perfumerías Lucentum el viernes por la mañana.";
    const bad = orderFromModel("C007", body, [{ sku: "GEL-750", units: 750 }]);
    const noQty = orderFromModel("C007", "Necesito sacar gel de 750 para Perfumerías Lucentum el viernes", [{ sku: "GEL-750", units: 750 }]);
    return same({ bad: [bad.fields, bad.values["units:GEL-750"]], noQty: [noQty.fields, noQty.values["units:GEL-750"]] },
      { bad: [["units:GEL-750"], ["210", "750"]], noQty: [["units:GEL-750"], ["750"]] });
  } },
  { name: "U2 matrícula 2210: no es una cantidad (con «4 palés» → duda con 128 y 2210; sin cantidad → duda), 4 palés de toallas sí", check: () => {
    const body = "Buenas, mañana pasa nuestro camión a recoger 4 palés de toallas blancas, matrícula 2210 HBK";
    const bad = orderFromModel("C005", body, [{ sku: "TOALLA-BL", units: 2210 }]);
    const noQty = orderFromModel("C005", "Mañana pasa nuestro camión a recoger toallas, matrícula 2210 HBK", [{ sku: "TOALLA-BL", units: 2210 }]);
    const good = orderFromModel("C005", body, [{ sku: "TOALLA-BL", units: 128, asked: [4, "pallets"] }]);
    return same({ bad: [bad.fields, bad.values["units:TOALLA-BL"]], noQty: noQty.fields, good: good.fields }, { bad: [["units:TOALLA-BL"], ["128", "2210"]], noQty: ["units:TOALLA-BL"], good: [] });
  } },
  { name: "U3 medidas, teléfono, kilómetros, porcentajes y años no son cantidades (ml, L, kg, cm, 965 123 456, 3 km, 20 %, 2027)", check: () => {
    const body = "Mandad crema de 50 ml, gel de 2 L y champú de 25 kg, caja de 40 cm, llamad al 965 123 456, está a 3 km, 20 % de descuento, año 2027";
    const wrong = [50, 2, 25, 40, 965, 123, 456, 3, 20, 2027].filter((n) => orderFromModel("C007", body, [{ sku: "GEL-750", units: n }]).fields.length === 0);
    return same(wrong, []);
  } },
  { name: "U4 líneas cruzadas (N8: mazapán 10, polvorones 5): el modelo las cambia (400 y 800) → una duda por línea con lo que dice el mensaje; bien puestas → ninguna", check: () => {
    const body = "Mandad 10 palés de mazapán y 5 de polvorones a Costablanca Castellón antes del viernes";
    const crossed = orderFromModel("C008", body, [{ sku: "MAZAPAN", units: 400 }, { sku: "POLVORON", units: 800 }]);
    const fine = orderFromModel("C008", body, [{ sku: "MAZAPAN", units: 800 }, { sku: "POLVORON", units: 400 }]);
    return same({ crossed: [crossed.fields, crossed.values["units:MAZAPAN"], crossed.values["units:POLVORON"]], fine: fine.fields },
      { crossed: [["units:MAZAPAN", "units:POLVORON"], ["800", "400"], ["400", "800"]], fine: [] });
  } },
  { name: "U4b solo una línea cruzada: 800 en polvorones (los 10 palés son de mazapán) → duda en polvorones; mazapán bien → sin duda", check: () => {
    const d = orderFromModel("C008", "Mandad 10 palés de mazapán y 5 de polvorones a Costablanca Castellón antes del viernes", [{ sku: "MAZAPAN", units: 800 }, { sku: "POLVORON", units: 800 }]);
    return same({ fields: d.fields, says: d.values["units:POLVORON"] }, { fields: ["units:POLVORON"], says: ["400", "800"] });
  } },
  { name: "U5 convert_quantity solo vale con la cantidad que escribió el cliente para ese artículo (amountInMessage)", check: () => {
    const horch = catalogOf("C004");
    const n8 = catalogOf("C008");
    const h = horch.find((i) => i.sku === "HORCH-1L")!;
    const maz = n8.find((i) => i.sku === "MAZAPAN")!;
    const msg = "Toni aquí. Mandadme 2 palés y medio de horchata a SuperBahía Alicante el lunes";
    const n8msg = "Mandad 10 palés de mazapán y 5 de polvorones a Costablanca Castellón antes del viernes";
    return same([
      amountInMessage(2.5, "pallets", msg, h, horch), // lo que dijo
      amountInMessage(3, "pallets", msg, h, horch), // inventada
      amountInMessage(250, "units", msg, h, horch), // el resultado, no lo que dijo
      amountInMessage(2.5, "units", msg, h, horch), // otra unidad
      amountInMessage(10, "pallets", n8msg, maz, n8), // la suya
      amountInMessage(5, "pallets", n8msg, maz, n8), // la de polvorones
    ], [true, false, false, false, true, false]);
  } },
  { name: "U5b el modelo pide convert_quantity con una cantidad inventada (3 palés de horchata, el cliente dijo 2 y medio) y pone 300 → duda con 250 y 300 (antes pasaba por venir de convert_quantity)", check: () => {
    const d = orderFromModel("C004", "Toni aquí. Mandadme 2 palés y medio de horchata a SuperBahía Alicante el lunes", [{ sku: "HORCH-1L", units: 300, asked: [3, "pallets"] }]);
    return same({ fields: d.fields, values: d.values["units:HORCH-1L"] }, { fields: ["units:HORCH-1L"], values: ["250", "300"] });
  } },
  { name: "U5c convert_quantity con la cantidad de la otra línea (N8: 5 palés de mazapán, 10 de polvorones) → dudas en las dos líneas", check: () => {
    const d = orderFromModel("C008", "Mandad 10 palés de mazapán y 5 de polvorones a Costablanca Castellón antes del viernes",
      [{ sku: "MAZAPAN", units: 400, asked: [5, "pallets"] }, { sku: "POLVORON", units: 800, asked: [10, "pallets"] }]);
    return same(d.fields, ["units:MAZAPAN", "units:POLVORON"]);
  } },
  { name: "U5d vouchConversion apunta las unidades solo si la cantidad es del cliente (y las opciones de «1,5 palés» de PP-NAT: 82 y 83)", check: () => {
    const pp = catalogOf("C002");
    const item = pp.find((i) => i.sku === "PP-NAT")!;
    const msg = "Mandad 1,5 palés de PP natural a Inyectados Castalla el viernes";
    const mine = new Map<string, number[]>();
    const okMine = vouchConversion(mine, item, convertQuantity(item, 1.5, "pallets"), 1.5, "pallets", msg, pp);
    const made = new Map<string, number[]>();
    const okMade = vouchConversion(made, item, convertQuantity(item, 2, "pallets"), 2, "pallets", msg, pp);
    return same({ okMine, mine: mine.get("PP-NAT"), okMade, made: made.get("PP-NAT") ?? null }, { okMine: true, mine: [82, 83], okMade: false, made: null });
  } },
  { name: "U6 los 3 mensajes del vídeo con pedido (V1 peluche, V2 agua + horchata, V4 gel) no dan ninguna duda de unidades, con y sin convert_quantity", check: () => same(noDoubts(VIDEO), []) },
  { name: "U7 N1, N2, N7, N8, N9, Q1, Q2, «130 cajas», la campaña de turrón, el portal de Toni y PP natural: ninguna duda de unidades, con y sin convert_quantity", check: () => same(noDoubts(EVAL), []) },
  { name: "U8 el código del SKU enlaza la cifra: «120 PELUCHE-30», «120 x PELUCHE-30», «PELUCHE-30: 120», «PELUCHE-30 x 120», «1.360 PELUCHE-30» sí; el 30 del SKU no", check: () => {
    const ask = (body: string, units: number) => orderFromModel("C001", body, [{ sku: "PELUCHE-30", units }]).fields.length;
    return same([
      ask("Mandad 120 PELUCHE-30 a SuperBahía Alicante", 120), ask("Mandad 120 x PELUCHE-30 a SuperBahía Alicante", 120),
      ask("Mandad PELUCHE-30: 120 a SuperBahía Alicante", 120), ask("Mandad PELUCHE-30 x 120 a SuperBahía Alicante", 120),
      ask("Mandad 1.360 PELUCHE-30 a SuperBahía Alicante", 1360), ask("Mandad 120 PELUCHE-30 a SuperBahía Alicante", 30),
    ], [0, 0, 0, 0, 0, 1]);
  } },
  { name: "U9 con dos productos en el mensaje, cada línea ofrece SU cantidad («3 palés de horchata y 40 cajas de agua»: horchata dice 300)", check: () => {
    const d = orderFromModel("C004", "Mandad 3 palés de horchata y 40 cajas de agua a SuperBahía Alicante", [{ sku: "HORCH-1L", units: 77 }, { sku: "AGUA-15", units: 40 }]);
    return same({ fields: d.fields, says: d.values["units:HORCH-1L"] }, { fields: ["units:HORCH-1L"], says: ["300", "77"] });
  } },
  { name: "U10 si no se puede asociar con seguridad, no bloquea: «3 palés de peluche» (30 o 50), «10 palés de mazapán y polvorones» (¿cada uno o entre los dos?), sin «de»", check: () => {
    const peluche = orderFromModel("C001", "Mandad 3 palés de peluche a SuperBahía Alicante", [{ sku: "PELUCHE-30", units: 120 }, { sku: "PELUCHE-50", units: 90 }]).fields;
    const list = orderFromModel("C008", "Mandad 10 palés de mazapán y polvorones a Costablanca Castellón", [{ sku: "MAZAPAN", units: 800 }, { sku: "POLVORON", units: 800 }]).fields;
    const noDe = orderFromModel("C008", "Mandad 10 palés mazapán y 5 palés polvorones a Costablanca Castellón", [{ sku: "MAZAPAN", units: 400 }, { sku: "POLVORON", units: 800 }]).fields;
    return same({ peluche, list, noDe }, { peluche: [], list: [], noDe: [] });
  } },
  { name: "U11 messageQuantities: de «3 palés de gel de 750 ml» solo sale 3 palés (ni 750 ni el resto de cifras)", check: () => {
    const gel = catalogOf("C007");
    return same(messageQuantities("Necesito sacar 3 palés de gel de 750 ml, 25 kg, el 3 de noviembre, a las 10:30, pedido 4523", gel.find((i) => i.sku === "GEL-750"), gel), [{ amount: 3, unit: "pallets" }]);
  } },
  { name: "U12 un pedido en inglés se lee igual que el español: «Send 3 pallets of PELUCHE-30», «two and a half pallets of horchata», «half a pallet», «100 boxes of PELUCHE-30»", check: () => {
    const ask = (code: string, sku: string, units: number, body: string, asked?: [number, "pallets" | "units"]) => orderFromModel(code, body, [{ sku, units, asked }]).fields.length;
    return same([
      ask("C001", "PELUCHE-30", 120, "Please send 3 pallets of PELUCHE-30 to SuperBahía Alicante on Friday", [3, "pallets"]),
      ask("C004", "HORCH-1L", 250, "Send two and a half pallets of horchata to SuperBahía Alicante on Monday", [2.5, "pallets"]),
      ask("C004", "HORCH-1L", 200, "Send two pallets of horchata to SuperBahía Alicante on Monday", [2, "pallets"]),
      ask("C001", "PUZZLE-500", 30, "Send half a pallet of puzzle-500 to SuperBahía Alicante", [0.5, "pallets"]),
      ask("C001", "PELUCHE-30", 100, "Send 100 boxes of PELUCHE-30 to SuperBahía Alicante", [100, "units"]),
      ask("C001", "PELUCHE-30", 160, "Please send 3 pallets of PELUCHE-30 to SuperBahía Alicante on Friday"), // 4 pallets: invented
    ], [0, 0, 0, 0, 0, 1]);
  } },
  { name: "U13 números en letra de 21 en adelante y europalets: «treinta y cinco palés», «cincuenta cajas», «veinticinco europalets»; el guardián sigue exigiendo que cuadre", check: () => {
    const ask = (code: string, sku: string, units: number, body: string, asked?: [number, "pallets" | "units"]) => orderFromModel(code, body, [{ sku, units, asked }]).fields.length;
    return same([
      ask("C002", "PP-NAT", 1925, "Necesito treinta y cinco palés de PP natural en Castalla", [35, "pallets"]),
      ask("C001", "PELUCHE-30", 50, "Mandad cincuenta cajas de PELUCHE-30 a Alicante", [50, "units"]),
      ask("C002", "PP-NAT", 1375, "Mandad veinticinco europalets de PP natural a Castalla", [25, "pallets"]),
      ask("C002", "PP-NAT", 1925, "Mandad treinta palés de PP natural a Castalla", [35, "pallets"]), // 30, not 35
    ], [0, 0, 0, 1]);
  } },

  // ----- Spanish formats -----
  { name: "E1 euros: 128460 → «1.284,60 €», 5 → «0,05 €», 1234567 → «12.345,67 €», 5500 → «55,00 €»", check: () => same([eurosEs(128460), eurosEs(5), eurosEs(1234567), eurosEs(5500)], ["1.284,60 €", "0,05 €", "12.345,67 €", "55,00 €"]) },
  { name: "E2 números y fechas: 276 → «276», 19.5 → «19,5», 12846 → «12.846», «2026-11-08» → «08/11»", check: () => same([numEs(276), numEs(19.5), numEs(12846), ddmm("2026-11-08")], ["276", "19,5", "12.846", "08/11"]) },

  // ----- shape of the tools -----
  { name: "S1 bill_so_far: las cifras de la herramienta son las del motor (base, IVA, total) como número y como texto", check: () =>
    same({ base: shaped.base, vat: shaped.vat, total: shaped.total, totalText: shaped.totalText, status: shaped.status },
      { base: result.baseCents / 100, vat: result.vatCents / 100, total: result.totalCents / 100, totalText: eurosEs(result.totalCents), status: "draft" }) },
  { name: "S2 bill_so_far: 276 palé·día y «27,60 €» en el texto; el caso «21 + 2» de mayo suma 276", check: () =>
    result.palletDays === 276 && shaped.text.includes("almacenaje (palés europeos) 276 palés·día") && shaped.text.includes("27,60 €") ? null : `${result.palletDays} · ${shaped.text}` },
  { name: "S3 bill_so_far: importes de miles salen con punto («1.284,60 €») y la línea trae precio y cantidad", check: () => {
    const s = shapeBill(bigBill);
    return s.text.includes("1.284,60 €") && s.lines[0].amount === 1284.6 && s.lines[0].amountText === "1.284,60 €" && s.lines[0].quantity === 12846 ? null : s.text;
  } },
  { name: "S4 bill_so_far sin movimientos: dice que no hay y no inventa líneas", check: () => {
    const s = shapeBill({ ...bill, lines: [], baseCents: 0, vatCents: 0, totalCents: 0 });
    return s.lines.length === 0 && s.text.includes("sin movimientos") ? null : s.text;
  } },
  { name: "S5 bill_so_far: el estado se dice (borrador / aprobada / sin preparar)", check: () =>
    same([shapeBill({ ...bill, status: "approved" }).text.includes("aprobada"), shapeBill({ ...bill, status: "not prepared" }).text.includes("sin preparar"), shaped.text.includes("borrador")], [true, true, true]) },
  { name: "X1 explain_charge entrada 1043 (mayo): 2 × 12 que salen el 08/06 y 21 × 12 sin salida, 276 palé·día", check: () => {
    const e = shapeExplain(detail, may, { inbound: 1043 }, "draft");
    if ("error" in e) return e.error;
    const rows = e.rows.map((r) => ({ p: r.pallets, d: r.days, from: r.from, exit: r.exit, pd: r.palletDays, a: r.amount }));
    return same({ rows, pd: e.palletDays }, { rows: [{ p: 2, d: 12, from: "2026-05-20", exit: "2026-06-08", pd: 24, a: 2.4 }, { p: 21, d: 12, from: "2026-05-20", exit: null, pd: 252, a: 25.2 }], pd: 276 });
  } },
  { name: "X2 explain_charge: el texto dice «sin salida» y «sale el 08/06»; por lote igual que por entrada", check: () => {
    const byInbound = shapeExplain(detail, may, { inbound: 1043 }, "draft");
    const byLot = shapeExplain(detail, may, { lot: "l-2310" }, "draft");
    const t = String(byInbound.text);
    return t.includes("sin salida") && t.includes("sale el 08/06") && String(byLot.text).replace("Lote l-2310", "Entrada 1043") === t ? null : `${t} | ${byLot.text}`;
  } },
  { name: "X3 explain_charge: entrada que no existe → error (el modelo la pasa a una persona)", check: () => ("error" in shapeExplain(detail, may, { inbound: 999 }, "draft") ? null : "should be an error") },
  { name: "X4 explain_charge: «desde» no es anterior al periodo (goods de abril, mes de mayo → desde el 01/05)", check: () => {
    const d: DetailIn[] = [{ ...detail[0], concept: "storage", inDate: "2026-04-10", inboundNumber: 5, pallets: 3, days: 31, palletDays: 93, exitDate: null, cents: 930 }];
    const e = shapeExplain(d, may, { inbound: 5 }, "approved");
    return "error" in e ? e.error : same(e.rows[0].from, "2026-05-01");
  } },

  // ----- period -----
  { name: "W1 sin mes = mes en curso hasta hoy (1–28 oct)", check: () => {
    const w = resolveWindow(undefined, TODAY);
    return "error" in w ? w.error : same({ f: w.p.first, l: w.p.last, d: w.p.days, td: w.toDate }, { f: "2026-10-01", l: "2026-10-28", d: 28, td: true });
  } },
  { name: "W2 mes pasado entero; mes en curso nombrado = hasta hoy", check: () => {
    const a = resolveWindow("2026-09", TODAY);
    const b = resolveWindow("2026-10", TODAY);
    return "error" in a || "error" in b ? "error" : same([a.p.last, a.toDate, b.p.last, b.toDate], ["2026-09-30", false, "2026-10-28", true]);
  } },
  { name: "W3 mes futuro o mal escrito → error", check: () => same([resolveWindow("2026-11", TODAY), resolveWindow("2026-13", TODAY), resolveWindow("septiembre", TODAY), resolveWindow(5, TODAY)].map((w) => "error" in w), [true, true, true, true]) },

  // ----- plan B: which question is it -----
  { name: "F1 «¿cuánto llevo de almacenaje este mes?» → bill_so_far (mes en curso)", check: () => same(billingIntent("¿Cuánto llevo de almacenaje este mes?", TODAY), { kind: "amount" }) },
  { name: "F1b «prefactura» y «palés·día» → bill_so_far; mes con nombre → ese mes", check: () => same([billingIntent("¿Me pasáis la prefactura de septiembre?", TODAY), billingIntent("cuántos palés·día llevo?", TODAY)], [{ kind: "amount", month: "2026-09" }, { kind: "amount" }]) },
  { name: "F2 «¿por qué 276 palés·día de la entrada 1043?» → explain_charge(inbound 1043)", check: () => same(billingIntent("¿Por qué me cobráis 276 palés·día de la entrada 1043?", TODAY), { kind: "explain", inbound: 1043 }) },
  { name: "F2b «entrada nº 1043», «lote L-2310» y sin número → bill_so_far", check: () => same([
    billingIntent("¿Por qué cobráis tanto almacenaje de la entrada nº 1043?", TODAY),
    billingIntent("Explicadme los palés·día del lote L-2310", TODAY),
    billingIntent("¿Por qué 276 palés·día de la entrada N?", TODAY),
  ], [{ kind: "explain", inbound: 1043 }, { kind: "explain", lot: "l-2310" }, { kind: "amount" }]) },
  { name: "F3 «no nos ha llegado la factura de septiembre» (el mensaje sembrado) → persona", check: () => same(billingIntent("Hola, no nos ha llegado la factura de septiembre, ¿nos la podéis reenviar?", TODAY), { kind: "human" }) },
  { name: "F3b reclamar, pagar, reenviar → persona aunque pregunten por el almacenaje", check: () => same([
    billingIntent("Reclamamos el almacenaje de octubre, hay un error en el cargo", TODAY),
    billingIntent("Queremos pagar la factura, ¿a qué cuenta?", TODAY),
    billingIntent("¿Podéis enviarme otra vez la prefactura?", TODAY),
  ].map((i) => i?.kind), ["human", "human", "human"]) },
  { name: "F4 pedidos y preguntas de stock no son de facturación", check: () => same([
    billingIntent("Mandad 2 palés de PELUCHE-30 a SuperBahía Alicante el viernes", TODAY),
    billingIntent("¿Cuántos palés me quedan de puzzle?", TODAY),
    billingIntent("Se me ha olvidado el día de la entrega", TODAY),
  ], [null, null, null]) },
  { name: "F5 mes con nombre: septiembre, mes pasado (también en enero), este mes", check: () => same([monthFromText("en septiembre", TODAY), monthFromText("el mes pasado", TODAY), monthFromText("el mes pasado", "2026-01-15"), monthFromText("este mes", TODAY), monthFromText("en diciembre", TODAY), monthFromText("en octubre", TODAY)], ["2026-09", "2026-09", "2025-12", undefined, "2025-12", undefined]) },
  { name: "F7 nombre comercial sin forma jurídica: los 8 clientes del seed, «S.L.U.» y «S. A.»; «¿Cuánto lleva Bebidas Montgó…?» lo contiene", check: () => same([
    seedClients.map((c) => tradeName(c.name)).every((n) => n.length > 3 && !/[.,]$/.test(n) && !/\bs\.?\s?[al]\b/.test(n)),
    tradeName("Bebidas Montgó, S.A."), tradeName("Polímeros Serra Mariola, S.L."), tradeName("Ejemplo Uno S.L.U."), tradeName("Ejemplo Dos, S. A."),
    norm("¿Cuánto lleva Bebidas Montgó de almacenaje este mes?").includes(tradeName("Bebidas Montgó, S.A.")),
  ], [true, "bebidas montgo", "polimeros serra mariola", "ejemplo uno", "ejemplo dos", true]) },
  { name: "F6 el motor de reglas manda a una persona el mensaje sembrado de la factura (sin tocar la BD)", check: async () => {
    const [d] = await draftMessage(asMessage("Hola, no nos ha llegado la factura de septiembre, ¿nos la podéis reenviar?"));
    return d.kind === "NEEDS_HUMAN" ? null : `got ${d.kind}`;
  } },
  { name: "F6b el motor de reglas manda a una persona un pago o una reclamación (sin tocar la BD)", check: async () => {
    const kinds = [
      (await draftMessage(asMessage("Queremos pagar la factura, ¿a qué cuenta?")))[0].kind,
      (await draftMessage(asMessage("Reclamamos el almacenaje de octubre")))[0].kind,
    ];
    return same(kinds, ["NEEDS_HUMAN", "NEEDS_HUMAN"]);
  } },
];

async function main() {
  let failed = 0;
  for (const c of CASES) {
    let miss: string | null;
    try {
      miss = (await c.check()) ?? null;
    } catch (err) {
      miss = `threw ${err instanceof Error ? err.message : String(err)}`;
    }
    if (miss) failed++;
    console.log(`${miss ? "FAIL" : "pass"}  ${c.name}${miss ? `\n      ${miss}` : ""}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} pass`);
  process.exit(failed ? 1 : 0);
}

main();
